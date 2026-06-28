-- 0066_double_bye_r2_guard.sql
--
-- Tighten the R2-already-played guard in td_pair_team_into_bye_slot.
-- 0065 skipped that check for the double-bye case on the (wrong)
-- assumption that "no previous bye winner means nothing to clobber."
-- But R2 can still carry the residue of a played match whose
-- participants were later withdrawn — match_sets rows are gone, but
-- match.status stays 'confirmed' and winner_entry_id can be set even
-- after _unwind_entry_from_matches cleared the side pointers. Letting
-- the double-bye path through would silently overwrite that R2 slot
-- with the new bye-winner and produce a confusing "confirmed but
-- partly populated" match in the displayed bracket.
--
-- The right rule is the same for both: refuse if R2 isn't pristine,
-- with the same "withdraw + regenerate" escape hatch.

create or replace function public.td_pair_team_into_bye_slot(
  p_tournament_id uuid,
  p_match_id uuid,
  p_captain_club_member_id uuid,
  p_captain_unpaired_entry_id uuid,
  p_partner_club_member_id uuid,
  p_partner_unpaired_entry_id uuid,
  p_handicap smallint default null
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
  v_captain_entry record;
  v_partner_entry record;
  v_team_id uuid;
  v_entry_id uuid;
  v_next_round smallint;
  v_next_slot smallint;
  v_next_side text;
  v_next_match record;
  v_cap_name text;
  v_par_name text;
  v_double_bye boolean;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;

  select kind, solo_only into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'doubles' then
    raise exception 'this RPC is only for doubles tournaments';
  end if;

  if (p_captain_club_member_id is null) = (p_captain_unpaired_entry_id is null) then
    raise exception 'captain must be either a club member or an unpaired entry, not both';
  end if;
  if (p_partner_club_member_id is null) = (p_partner_unpaired_entry_id is null) then
    raise exception 'partner must be either a club member or an unpaired entry, not both';
  end if;

  if p_handicap is not null and not v_t.solo_only then
    raise exception 'team handicaps are only used in Calcutta-style tournaments';
  end if;
  if p_handicap is not null and (p_handicap < -40 or p_handicap > 40) then
    raise exception 'handicap must be between -40 and 40';
  end if;

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
  if v_match.entry_a_id is not null and v_match.entry_b_id is not null then
    raise exception 'this match already has both sides filled';
  end if;

  v_double_bye := v_match.entry_a_id is null and v_match.entry_b_id is null;

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

  -- Same R2 guard for both single- and double-bye cases. R2 must be
  -- pristine: anything else means a played-match residue we'd be
  -- silently overwriting.
  if v_next_match.id is not null and v_next_match.status <> 'pending' then
    raise exception
      'a later round has already been played from this slot — '
      'withdraw the team and regenerate the draw instead';
  end if;

  if p_captain_unpaired_entry_id is not null then
    select id, tournament_id, participant_id, team_id, status
      into v_captain_entry
      from entries where id = p_captain_unpaired_entry_id
      for update;
    if not found or v_captain_entry.tournament_id <> p_tournament_id then
      raise exception 'captain entry not found in this tournament';
    end if;
    if v_captain_entry.status <> 'unpaired'
       or v_captain_entry.participant_id is null
       or v_captain_entry.team_id is not null then
      raise exception 'captain entry is not an unpaired solo';
    end if;
    v_captain_pid := v_captain_entry.participant_id;
  else
    v_captain_pid := public.td_ensure_participant_from_club_member(
      p_tournament_id, p_captain_club_member_id, v_uid);
    perform public.assert_tournament_eligibility(p_tournament_id, v_captain_pid, true);
  end if;

  if p_partner_unpaired_entry_id is not null then
    select id, tournament_id, participant_id, team_id, status
      into v_partner_entry
      from entries where id = p_partner_unpaired_entry_id
      for update;
    if not found or v_partner_entry.tournament_id <> p_tournament_id then
      raise exception 'partner entry not found in this tournament';
    end if;
    if v_partner_entry.status <> 'unpaired'
       or v_partner_entry.participant_id is null
       or v_partner_entry.team_id is not null then
      raise exception 'partner entry is not an unpaired solo';
    end if;
    v_partner_pid := v_partner_entry.participant_id;
  else
    v_partner_pid := public.td_ensure_participant_from_club_member(
      p_tournament_id, p_partner_club_member_id, v_uid);
    perform public.assert_tournament_eligibility(p_tournament_id, v_partner_pid, true);
  end if;

  if v_captain_pid = v_partner_pid then
    raise exception 'captain and partner must be different players';
  end if;

  if exists (
    select 1 from entries e
     where e.tournament_id = p_tournament_id
       and e.status <> 'withdrawn'
       and (
         e.participant_id = v_captain_pid
         or e.team_id in (
           select t.id from teams t
            where t.tournament_id = p_tournament_id
              and (t.captain_participant_id = v_captain_pid
                or t.partner_participant_id = v_captain_pid)
         )
       )
       and (p_captain_unpaired_entry_id is null or e.id <> p_captain_unpaired_entry_id)
  ) then
    select display_name into v_cap_name from participants where id = v_captain_pid;
    raise exception
      '% is already in the roster — withdraw the existing entry on the Roster page first',
      coalesce(v_cap_name, 'captain');
  end if;

  if exists (
    select 1 from entries e
     where e.tournament_id = p_tournament_id
       and e.status <> 'withdrawn'
       and (
         e.participant_id = v_partner_pid
         or e.team_id in (
           select t.id from teams t
            where t.tournament_id = p_tournament_id
              and (t.captain_participant_id = v_partner_pid
                or t.partner_participant_id = v_partner_pid)
         )
       )
       and (p_partner_unpaired_entry_id is null or e.id <> p_partner_unpaired_entry_id)
  ) then
    select display_name into v_par_name from participants where id = v_partner_pid;
    raise exception
      '% is already in the roster — withdraw the existing entry on the Roster page first',
      coalesce(v_par_name, 'partner');
  end if;

  insert into teams (
    tournament_id, captain_participant_id, partner_participant_id,
    invite_status, handicap
  ) values (
    p_tournament_id, v_captain_pid, v_partner_pid, 'accepted', p_handicap
  ) returning id into v_team_id;

  insert into entries (tournament_id, team_id, status, added_by_td_id)
       values (p_tournament_id, v_team_id, 'confirmed', v_uid)
    returning id into v_entry_id;

  if p_captain_unpaired_entry_id is not null then
    delete from entries where id = p_captain_unpaired_entry_id;
  end if;
  if p_partner_unpaired_entry_id is not null then
    delete from entries where id = p_partner_unpaired_entry_id;
  end if;

  if v_double_bye then
    update matches
       set entry_a_id      = v_entry_id,
           winner_entry_id = v_entry_id,
           status          = 'confirmed'
     where id = v_match.id;
    perform public.advance_winner(v_match.id);
  else
    if v_match.entry_a_id is null then
      update matches
         set entry_a_id      = v_entry_id,
             winner_entry_id = null,
             status          = 'pending'
       where id = v_match.id;
    else
      update matches
         set entry_b_id      = v_entry_id,
             winner_entry_id = null,
             status          = 'pending'
       where id = v_match.id;
    end if;
    if v_next_match.id is not null then
      if v_next_side = 'a' then
        update matches set entry_a_id = null where id = v_next_match.id;
      else
        update matches set entry_b_id = null where id = v_next_match.id;
      end if;
    end if;
  end if;

  return v_entry_id;
end;
$$;

grant execute on function public.td_pair_team_into_bye_slot(
  uuid, uuid, uuid, uuid, uuid, uuid, smallint
) to authenticated;
