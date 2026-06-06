-- 0050_td_add_team_to_bye_slot.sql
--
-- Doubles equivalent of 0043_td_add_player_to_bye_slot: lets the TD drop
-- a brand-new team into an existing first-round bye slot without
-- regenerating the bracket. The team that was getting the free pass now
-- has to play this new R1 match. Without this RPC, the only way to get
-- a late team into a doubles draw was to regenerate (destroying reported
-- scores) — so TDs would either avoid adding late teams or accept the
-- regen cost. The Roster page's post-draw banner pointed at the Draw
-- page for a bye fill that didn't exist for doubles; this RPC + the
-- matching UI close that gap.
--
-- Behaviour mirrors td_add_player_to_bye_slot exactly:
--   * Locks the bye match and the R2 match it auto-advances into.
--   * Refuses if R2 already played (TD must withdraw + regenerate then).
--   * Creates participants for captain + partner, the team, and the
--     entry — same path td_enter_team_from_club_members takes.
--   * Unwinds the bye winner's auto-advance from R2 so they must actually
--     beat the new team to progress.

create or replace function public.td_add_team_to_bye_slot(
  p_tournament_id uuid,
  p_captain_club_member_id uuid,
  p_partner_club_member_id uuid,
  p_match_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t record;
  v_match record;
  v_captain_pid uuid;
  v_partner_pid uuid;
  v_team_id uuid;
  v_entry_id uuid;
  v_next_round smallint;
  v_next_slot smallint;
  v_next_side text;
  v_next_match record;
  v_cap_name text;
  v_par_name text;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;
  if p_captain_club_member_id = p_partner_club_member_id then
    raise exception 'captain and partner must be different club members';
  end if;

  select kind into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'doubles' then
    raise exception 'this RPC is only for doubles tournaments';
  end if;

  -- Lock the bye match row for the rest of this transaction so a
  -- concurrent fill / regenerate can't race us into a half-baked state.
  select id, tournament_id, bracket, round, slot,
         entry_a_id, entry_b_id, winner_entry_id, status
    into v_match
    from matches
   where id = p_match_id
   for update;
  if not found then
    raise exception 'match not found';
  end if;
  if v_match.tournament_id <> p_tournament_id then
    raise exception 'match does not belong to this tournament';
  end if;
  if v_match.round <> 1 then
    raise exception 'can only fill byes in the first round';
  end if;
  if (v_match.entry_a_id is not null and v_match.entry_b_id is not null)
     or (v_match.entry_a_id is null and v_match.entry_b_id is null) then
    raise exception 'this match is not a bye';
  end if;

  -- Locate the R2 match the bye winner was auto-advanced into. The slot
  -- math mirrors advance_winner so we walk the same edge in reverse.
  v_next_round := v_match.round + 1;
  v_next_slot  := v_match.slot / 2;
  v_next_side  := case when v_match.slot % 2 = 0 then 'a' else 'b' end;

  select id, status, entry_a_id, entry_b_id
    into v_next_match
    from matches
   where tournament_id = p_tournament_id
     and bracket = v_match.bracket
     and round  = v_next_round
     and slot   = v_next_slot
   for update;

  if found and v_next_match.status <> 'pending' then
    raise exception
      'the bye winner has already played in a later round — '
      'withdraw the team and regenerate the draw instead';
  end if;

  -- Ensure both partners as participants (creates rows the first time,
  -- reuses any existing participant + relinks profile accounts the same
  -- way td_enter_team_from_club_members does). Bypass requirements
  -- because a TD is acting on behalf of both players post-draw.
  v_captain_pid := public.td_ensure_participant_from_club_member(
    p_tournament_id, p_captain_club_member_id, v_uid);
  v_partner_pid := public.td_ensure_participant_from_club_member(
    p_tournament_id, p_partner_club_member_id, v_uid);

  perform public.assert_tournament_eligibility(p_tournament_id, v_captain_pid, true);
  perform public.assert_tournament_eligibility(p_tournament_id, v_partner_pid, true);

  -- Either partner already in the roster (active entry) means the TD
  -- almost certainly already tried to add this team via the Roster page
  -- and ended up here without withdrawing the stranded entry first.
  -- Refuse rather than create a silent duplicate.
  if exists (
    select 1 from entries e
     where e.tournament_id = p_tournament_id
       and e.status <> 'withdrawn'
       and (
         e.participant_id in (v_captain_pid, v_partner_pid)
         or e.team_id in (
           select t.id from teams t
            where t.tournament_id = p_tournament_id
              and (t.captain_participant_id in (v_captain_pid, v_partner_pid)
                or t.partner_participant_id in (v_captain_pid, v_partner_pid))
         )
       )
  ) then
    select full_name into v_cap_name from club_members where id = p_captain_club_member_id;
    select full_name into v_par_name from club_members where id = p_partner_club_member_id;
    raise exception
      '% or % is already in the roster — withdraw the existing entry on the Roster page first',
      coalesce(v_cap_name, 'captain'), coalesce(v_par_name, 'partner');
  end if;

  insert into teams (tournament_id, captain_participant_id, partner_participant_id, invite_status)
       values (p_tournament_id, v_captain_pid, v_partner_pid, 'accepted')
    returning id into v_team_id;

  insert into entries (tournament_id, team_id, status, added_by_td_id)
       values (p_tournament_id, v_team_id, 'confirmed', v_uid)
    returning id into v_entry_id;

  -- Slot the new team into whichever side of the bye match is empty,
  -- then turn it back into a real pending match.
  if v_match.entry_a_id is null then
    update matches
       set entry_a_id     = v_entry_id,
           winner_entry_id = null,
           status         = 'pending'
     where id = v_match.id;
  else
    update matches
       set entry_b_id     = v_entry_id,
           winner_entry_id = null,
           status         = 'pending'
     where id = v_match.id;
  end if;

  -- Pull the bye winner back out of R2. They re-enter the bracket only
  -- if they actually beat the new team.
  if found then
    if v_next_side = 'a' then
      update matches set entry_a_id = null where id = v_next_match.id;
    else
      update matches set entry_b_id = null where id = v_next_match.id;
    end if;
  end if;

  return v_entry_id;
end;
$$;

grant execute on function public.td_add_team_to_bye_slot(uuid, uuid, uuid, uuid) to authenticated;
