-- Aspatuck Tournaments — TD-side "enter a solo player" RPC for doubles.
--
-- Today the TD can enter a doubles team (td_enter_team_from_club_members)
-- but has no way to enter a single directory member waiting for a partner.
-- The public solo-doubles signup RPC (register_solo_for_doubles_tournament,
-- migration 0045) creates the right shape (status='unpaired') for the
-- player themselves, but a TD can't impersonate via that path because it
-- keys off auth.uid().
--
-- This RPC mirrors td_enter_club_member but: (a) only accepts doubles
-- tournaments, (b) creates the entry as 'unpaired' so the TD can pair
-- the player with another solo later via td_pair_solo_entries, and
-- (c) bypasses requirements at TD discretion like the other td_enter_*
-- helpers.

create or replace function public.td_enter_solo_member_in_doubles(
  p_tournament_id uuid,
  p_club_member_id uuid,
  p_bypass_requirements boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t record;
  v_participant_id uuid;
  v_entry_id uuid;
  v_name text;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;

  select kind into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'doubles' then
    raise exception 'td_enter_solo_member_in_doubles is only for doubles tournaments';
  end if;

  v_participant_id := public.td_ensure_participant_from_club_member(
    p_tournament_id, p_club_member_id, v_uid);
  perform public.assert_tournament_eligibility(p_tournament_id, v_participant_id, p_bypass_requirements);

  -- Reject if this participant already has an active singleton entry,
  -- or is on an active team. Same defense as the public solo-signup
  -- path; gives the TD a clear error instead of a duplicate row.
  if exists (
    select 1 from entries
     where tournament_id = p_tournament_id
       and participant_id = v_participant_id
       and status <> 'withdrawn'
  ) then
    select full_name into v_name from club_members where id = p_club_member_id;
    raise exception '% is already in the roster', coalesce(v_name, 'this player');
  end if;
  if exists (
    select 1
      from entries e
      join teams t on t.id = e.team_id
     where e.tournament_id = p_tournament_id
       and e.status <> 'withdrawn'
       and (t.captain_participant_id = v_participant_id
            or t.partner_participant_id = v_participant_id)
  ) then
    select full_name into v_name from club_members where id = p_club_member_id;
    raise exception '% is already on a team in this tournament', coalesce(v_name, 'this player');
  end if;

  insert into entries (tournament_id, participant_id, status, added_by_td_id)
       values (p_tournament_id, v_participant_id, 'unpaired', v_uid)
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;

grant execute on function public.td_enter_solo_member_in_doubles(uuid, uuid, boolean)
  to authenticated;
