-- 0045_solo_in_doubles_signup.sql
--
-- Lets a player sign up for a doubles tournament without a partner.
-- The entry sits in 'unpaired' state (see 0044) until the TD pairs
-- them with another solo player on the Roster page, which produces a
-- regular confirmed team entry via td_pair_solo_entries.
--
-- Unpaired entries are intentionally excluded from generate_draw (it
-- filters for status='confirmed') and from confirmedCount on the
-- Roster page, so the TD physically can't generate the bracket while
-- anyone is still solo.

-- --------- Solo sign-up (player-facing) ---------

create or replace function public.register_solo_for_doubles_tournament(
  p_tournament_id uuid
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
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select id, kind, draw_status into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'doubles' then
    raise exception 'solo signup is only for doubles tournaments';
  end if;
  if v_t.draw_status <> 'open' then
    raise exception 'this tournament is no longer accepting registrations';
  end if;

  v_participant_id := public.ensure_member_participant(p_tournament_id, v_uid);
  perform public.assert_tournament_eligibility(p_tournament_id, v_participant_id, false);

  -- Refuse if I'm already on the roster in any active capacity —
  -- either as a solo, as a captain, or as a partner. Withdrawing the
  -- existing entry first is the clean path; this RPC stays narrow.
  if exists (
    select 1 from entries e
     where e.tournament_id = p_tournament_id
       and e.participant_id = v_participant_id
       and e.status <> 'withdrawn'
  ) then
    raise exception 'you are already in this tournament';
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
    raise exception 'you are already part of a team in this tournament';
  end if;

  insert into entries (tournament_id, participant_id, status)
       values (p_tournament_id, v_participant_id, 'unpaired')
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;

grant execute on function public.register_solo_for_doubles_tournament(uuid) to authenticated;


-- --------- TD pairs two solos into a confirmed team ---------

create or replace function public.td_pair_solo_entries(
  p_tournament_id uuid,
  p_entry_a_id uuid,
  p_entry_b_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t record;
  v_a record;
  v_b record;
  v_team_id uuid;
  v_entry_id uuid;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;

  select id, kind, draw_status into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'doubles' then
    raise exception 'pairing is only for doubles tournaments';
  end if;
  if v_t.draw_status <> 'open' then
    -- Pairing necessarily produces a new entry, which would then need
    -- to be drawn into the bracket. Once the draw exists we can't
    -- safely splice a new team in without regenerating.
    raise exception 'pairing must happen before the draw is generated';
  end if;

  if p_entry_a_id = p_entry_b_id then
    raise exception 'pick two different players';
  end if;

  -- Lock both rows so we can't race a withdrawal or a parallel pair
  -- call into a state where one entry is double-consumed.
  select id, tournament_id, participant_id, team_id, status
    into v_a
    from entries where id = p_entry_a_id
    for update;
  if not found or v_a.tournament_id <> p_tournament_id then
    raise exception 'first entry not found in this tournament';
  end if;
  if v_a.status <> 'unpaired' or v_a.participant_id is null or v_a.team_id is not null then
    raise exception 'first entry is not an unpaired solo';
  end if;

  select id, tournament_id, participant_id, team_id, status
    into v_b
    from entries where id = p_entry_b_id
    for update;
  if not found or v_b.tournament_id <> p_tournament_id then
    raise exception 'second entry not found in this tournament';
  end if;
  if v_b.status <> 'unpaired' or v_b.participant_id is null or v_b.team_id is not null then
    raise exception 'second entry is not an unpaired solo';
  end if;

  -- Build the team auto-accepted: the TD is doing this on behalf of
  -- both players, so we skip the invite ping-pong that
  -- register_team_from_directory creates.
  insert into teams (tournament_id, captain_participant_id, partner_participant_id, invite_status)
       values (p_tournament_id, v_a.participant_id, v_b.participant_id, 'accepted')
    returning id into v_team_id;

  insert into entries (tournament_id, team_id, status, added_by_td_id)
       values (p_tournament_id, v_team_id, 'confirmed', v_uid)
    returning id into v_entry_id;

  -- The two solo entries are now consumed. We delete rather than mark
  -- 'withdrawn' so the two players don't appear twice on the roster.
  delete from entries where id in (p_entry_a_id, p_entry_b_id);

  return v_entry_id;
end;
$$;

grant execute on function public.td_pair_solo_entries(uuid, uuid, uuid) to authenticated;
