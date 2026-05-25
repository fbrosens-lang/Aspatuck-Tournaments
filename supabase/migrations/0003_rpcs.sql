-- Aspatuck Tournaments — player-callable RPCs
-- All functions are SECURITY DEFINER and run as the function owner, bypassing
-- RLS. They re-check authorization explicitly using auth.uid() and the
-- helper functions in 0002_rls_policies.sql.

-- ---------- internal helpers (not exposed to the API) ----------

-- Resolve or create a 'member' participant row for the given user in the
-- given tournament. Returns the participant id.
create or replace function public.ensure_member_participant(
  p_tournament_id uuid,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_profile record;
begin
  select id into v_id
    from participants
   where tournament_id = p_tournament_id and user_id = p_user_id;
  if v_id is not null then
    return v_id;
  end if;

  select full_name, contact_email, date_of_birth
    into v_profile
    from profiles
   where id = p_user_id;
  if not found then
    raise exception 'profile not found for user %', p_user_id;
  end if;

  insert into participants (
    tournament_id, kind, user_id, display_name, email, date_of_birth, created_by
  ) values (
    p_tournament_id, 'member', p_user_id,
    v_profile.full_name, v_profile.contact_email, v_profile.date_of_birth, p_user_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Compute the effective registration deadline for a division (override falls
-- back to the tournament's deadline). NULL means no deadline.
create or replace function public.division_effective_deadline(p_division_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(d.registration_deadline_override, t.registration_deadline)
    from divisions d join tournaments t on t.id = d.tournament_id
   where d.id = p_division_id;
$$;

-- Compute integer age at a given as-of date. Returns NULL if dob is NULL.
create or replace function public.age_at(p_dob date, p_as_of date)
returns smallint
language sql
immutable
as $$
  select case
    when p_dob is null then null
    else (extract(year from age(p_as_of, p_dob))::smallint)
  end;
$$;

-- Enforce a division's eligibility requirements for a participant. Raises if
-- the participant fails (NULL DOB when DOB is required, age outside the
-- min/max range, registration past the deadline). p_bypass=true skips all
-- checks; the calling RPC is responsible for authorizing the bypass.
create or replace function public.assert_division_eligibility(
  p_division_id uuid,
  p_participant_id uuid,
  p_bypass boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_div record;
  v_part record;
  v_deadline timestamptz;
  v_age smallint;
begin
  if p_bypass then
    return;
  end if;

  select d.requires_dob, d.min_age, d.max_age, t.start_date
    into v_div
    from divisions d join tournaments t on t.id = d.tournament_id
   where d.id = p_division_id;
  if not found then
    raise exception 'division not found';
  end if;

  select p.date_of_birth into v_part
    from participants p where p.id = p_participant_id;
  if not found then
    raise exception 'participant not found';
  end if;

  v_deadline := public.division_effective_deadline(p_division_id);
  if v_deadline is not null and now() > v_deadline then
    raise exception 'registration deadline has passed';
  end if;

  if v_div.requires_dob and v_part.date_of_birth is null then
    raise exception 'this division requires a date of birth on the participant';
  end if;

  v_age := public.age_at(v_part.date_of_birth, v_div.start_date);
  if v_div.min_age is not null and (v_age is null or v_age < v_div.min_age) then
    raise exception 'participant does not meet minimum age (%) for this division', v_div.min_age;
  end if;
  if v_div.max_age is not null and v_age is not null and v_age > v_div.max_age then
    raise exception 'participant exceeds maximum age (%) for this division', v_div.max_age;
  end if;
end;
$$;

-- ---------- player-callable RPCs ----------

-- Self-register the calling user for a singles division.
create or replace function public.register_for_division(p_division_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_div record;
  v_participant_id uuid;
  v_entry_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select d.id, d.tournament_id, d.kind, d.status
    into v_div
    from divisions d where d.id = p_division_id;
  if not found then
    raise exception 'division not found';
  end if;
  if v_div.kind <> 'singles' then
    raise exception 'use register_team_for_division for doubles divisions';
  end if;
  if v_div.status <> 'open' then
    raise exception 'this division is no longer accepting registrations';
  end if;

  v_participant_id := public.ensure_member_participant(v_div.tournament_id, v_uid);

  perform public.assert_division_eligibility(p_division_id, v_participant_id, false);

  insert into entries (division_id, participant_id, status)
       values (p_division_id, v_participant_id, 'confirmed')
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;

-- Self-register the calling user as captain of a doubles team. The partner is
-- looked up by email; they must already have an account. The team is created
-- with invite_status='pending' and a single entry row with status='pending';
-- the partner accepts via accept_partner_invite to confirm.
create or replace function public.register_team_for_division(
  p_division_id uuid,
  p_partner_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_div record;
  v_partner_user_id uuid;
  v_captain_participant_id uuid;
  v_partner_participant_id uuid;
  v_team_id uuid;
  v_entry_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select d.id, d.tournament_id, d.kind, d.status
    into v_div
    from divisions d where d.id = p_division_id;
  if not found then
    raise exception 'division not found';
  end if;
  if v_div.kind <> 'doubles' then
    raise exception 'use register_for_division for singles divisions';
  end if;
  if v_div.status <> 'open' then
    raise exception 'this division is no longer accepting registrations';
  end if;

  select id into v_partner_user_id
    from profiles
   where lower(contact_email) = lower(p_partner_email);
  if v_partner_user_id is null then
    raise exception 'no account found for partner email %', p_partner_email;
  end if;
  if v_partner_user_id = v_uid then
    raise exception 'you cannot be your own doubles partner';
  end if;

  v_captain_participant_id := public.ensure_member_participant(v_div.tournament_id, v_uid);
  v_partner_participant_id := public.ensure_member_participant(v_div.tournament_id, v_partner_user_id);

  perform public.assert_division_eligibility(p_division_id, v_captain_participant_id, false);
  perform public.assert_division_eligibility(p_division_id, v_partner_participant_id, false);

  insert into teams (division_id, captain_participant_id, partner_participant_id, invite_status)
       values (p_division_id, v_captain_participant_id, v_partner_participant_id, 'pending')
    returning id into v_team_id;

  insert into entries (division_id, team_id, status)
       values (p_division_id, v_team_id, 'pending')
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;

-- Partner accepts the doubles invite; the team becomes confirmed and its
-- entry transitions from 'pending' to 'confirmed'.
create or replace function public.accept_partner_invite(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_team record;
  v_partner_user_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select t.id, t.invite_status, t.partner_participant_id, p.user_id
    into v_team
    from teams t
    join participants p on p.id = t.partner_participant_id
   where t.id = p_team_id;
  if not found then
    raise exception 'team not found';
  end if;
  if v_team.user_id is null or v_team.user_id <> v_uid then
    raise exception 'only the invited partner can accept this invite';
  end if;
  if v_team.invite_status <> 'pending' then
    raise exception 'this invite is no longer pending';
  end if;

  update teams set invite_status = 'accepted' where id = p_team_id;
  update entries set status = 'confirmed' where team_id = p_team_id and status = 'pending';
end;
$$;

create or replace function public.decline_partner_invite(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_team record;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select t.id, t.invite_status, p.user_id
    into v_team
    from teams t
    join participants p on p.id = t.partner_participant_id
   where t.id = p_team_id;
  if not found then
    raise exception 'team not found';
  end if;
  if v_team.user_id is null or v_team.user_id <> v_uid then
    raise exception 'only the invited partner can decline this invite';
  end if;
  if v_team.invite_status <> 'pending' then
    raise exception 'this invite is no longer pending';
  end if;

  update teams set invite_status = 'declined' where id = p_team_id;
  update entries set status = 'withdrawn', withdrawn_at = now()
   where team_id = p_team_id and status = 'pending';
end;
$$;

-- Withdraw an entry the caller controls. For singles: caller must be the
-- linked participant. For doubles: caller must be captain or partner.
create or replace function public.withdraw_self(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_entry record;
  v_allowed boolean;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select e.id, e.participant_id, e.team_id, e.status
    into v_entry
    from entries e where e.id = p_entry_id;
  if not found then
    raise exception 'entry not found';
  end if;
  if v_entry.status = 'withdrawn' then
    return;
  end if;

  if v_entry.participant_id is not null then
    select (p.user_id = v_uid) into v_allowed
      from participants p where p.id = v_entry.participant_id;
  else
    select (pc.user_id = v_uid or pp.user_id = v_uid) into v_allowed
      from teams t
      left join participants pc on pc.id = t.captain_participant_id
      left join participants pp on pp.id = t.partner_participant_id
     where t.id = v_entry.team_id;
  end if;

  if not coalesce(v_allowed, false) then
    raise exception 'you do not have permission to withdraw this entry';
  end if;

  update entries set status = 'withdrawn', withdrawn_at = now() where id = p_entry_id;

  -- Walkover any unplayed match the entry was a side of.
  update matches m
     set winner_entry_id = case when m.entry_a_id = p_entry_id then m.entry_b_id else m.entry_a_id end,
         status = 'confirmed'
   where (m.entry_a_id = p_entry_id or m.entry_b_id = p_entry_id)
     and m.status = 'pending'
     and m.entry_a_id is not null
     and m.entry_b_id is not null;
end;
$$;

-- Lightweight validation of a sets jsonb payload. Returns the inferred winner
-- entry (entry_a or entry_b) or raises if the payload is malformed.
create or replace function public.validate_sets_payload(
  p_match_id uuid,
  p_sets jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_set jsonb;
  v_sets_a int := 0;
  v_sets_b int := 0;
  v_a int;
  v_b int;
  v_count int;
begin
  select entry_a_id, entry_b_id into v_match
    from matches where id = p_match_id;
  if not found then
    raise exception 'match not found';
  end if;
  if v_match.entry_a_id is null or v_match.entry_b_id is null then
    raise exception 'match is not ready to receive a score';
  end if;
  if jsonb_typeof(p_sets) <> 'array' then
    raise exception 'sets must be a JSON array';
  end if;

  v_count := jsonb_array_length(p_sets);
  if v_count = 0 or v_count > 5 then
    raise exception 'sets array must have between 1 and 5 entries';
  end if;

  for v_set in select * from jsonb_array_elements(p_sets) loop
    v_a := (v_set ->> 'games_a')::int;
    v_b := (v_set ->> 'games_b')::int;
    if v_a is null or v_b is null or v_a < 0 or v_b < 0 then
      raise exception 'each set must have non-negative integer games_a and games_b';
    end if;
    if v_a = v_b then
      raise exception 'a set cannot end tied (%-%)', v_a, v_b;
    end if;
    if v_a > v_b then v_sets_a := v_sets_a + 1; else v_sets_b := v_sets_b + 1; end if;
  end loop;

  if v_sets_a = v_sets_b then
    raise exception 'overall set count is tied';
  end if;
  return case when v_sets_a > v_sets_b then v_match.entry_a_id else v_match.entry_b_id end;
end;
$$;

-- Replace the stored sets for a match with the given payload, in order.
create or replace function public.replace_match_sets(
  p_match_id uuid,
  p_sets jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set jsonb;
  v_n int := 0;
begin
  delete from match_sets where match_id = p_match_id;
  for v_set in select * from jsonb_array_elements(p_sets) loop
    v_n := v_n + 1;
    insert into match_sets (match_id, set_number, games_a, games_b, tiebreak_a, tiebreak_b)
    values (
      p_match_id,
      v_n,
      (v_set ->> 'games_a')::int,
      (v_set ->> 'games_b')::int,
      nullif(v_set ->> 'tiebreak_a', '')::int,
      nullif(v_set ->> 'tiebreak_b', '')::int
    );
  end loop;
end;
$$;

-- Either player in a match reports the score. State machine:
--   pending  -> reported   (first report stored, awaits opponent confirmation)
--   reported -> confirmed  (opponent confirms with matching sets/winner)
--   reported -> disputed   (opponent reports different sets/winner)
-- Confirmed/overridden/disputed matches reject player reports; the TD must
-- override.
create or replace function public.report_match_score(
  p_match_id uuid,
  p_sets jsonb,
  p_winner_entry_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_match record;
  v_inferred_winner uuid;
  v_existing_sets jsonb;
  v_existing_winner uuid;
  v_matches boolean;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if not public.is_player_in_match(v_uid, p_match_id) then
    raise exception 'you are not a participant in this match';
  end if;

  select m.id, m.status, m.entry_a_id, m.entry_b_id, m.reported_by
    into v_match
    from matches m where m.id = p_match_id;
  if not found then
    raise exception 'match not found';
  end if;
  if v_match.status in ('confirmed', 'overridden', 'disputed') then
    raise exception 'this match has already been finalized; ask the tournament director for a correction';
  end if;

  v_inferred_winner := public.validate_sets_payload(p_match_id, p_sets);
  if v_inferred_winner <> p_winner_entry_id then
    raise exception 'declared winner does not match the set scores';
  end if;
  if p_winner_entry_id not in (v_match.entry_a_id, v_match.entry_b_id) then
    raise exception 'winner must be a participant in the match';
  end if;

  if v_match.status = 'pending' then
    perform public.replace_match_sets(p_match_id, p_sets);
    update matches
       set winner_entry_id = p_winner_entry_id,
           status = 'reported',
           reported_by = v_uid,
           reported_at = now()
     where id = p_match_id;
    insert into score_audit (match_id, changed_by, change_type, new_winner, new_sets)
         values (p_match_id, v_uid, 'reported', p_winner_entry_id, p_sets);
    return 'reported';
  end if;

  -- status = 'reported'
  if v_match.reported_by = v_uid then
    -- Same player re-submitting: just overwrite their own report.
    perform public.replace_match_sets(p_match_id, p_sets);
    update matches
       set winner_entry_id = p_winner_entry_id,
           reported_at = now()
     where id = p_match_id;
    insert into score_audit (match_id, changed_by, change_type, new_winner, new_sets)
         values (p_match_id, v_uid, 'reported', p_winner_entry_id, p_sets);
    return 'reported';
  end if;

  -- Different player confirming or contesting.
  select coalesce(jsonb_agg(jsonb_build_object(
            'set_number', set_number,
            'games_a', games_a,
            'games_b', games_b,
            'tiebreak_a', tiebreak_a,
            'tiebreak_b', tiebreak_b
         ) order by set_number), '[]'::jsonb)
    into v_existing_sets
    from match_sets where match_id = p_match_id;

  select winner_entry_id into v_existing_winner from matches where id = p_match_id;

  v_matches := v_existing_winner = p_winner_entry_id
           and public.sets_equal(v_existing_sets, p_sets);

  if v_matches then
    update matches set status = 'confirmed' where id = p_match_id;
    insert into score_audit (match_id, changed_by, change_type, new_winner, new_sets)
         values (p_match_id, v_uid, 'confirmed', p_winner_entry_id, p_sets);
    perform public.advance_winner(p_match_id);
    return 'confirmed';
  else
    update matches set status = 'disputed' where id = p_match_id;
    insert into score_audit (match_id, changed_by, change_type,
                              previous_winner, new_winner,
                              previous_sets, new_sets)
         values (p_match_id, v_uid, 'reported',
                 v_existing_winner, p_winner_entry_id,
                 v_existing_sets, p_sets);
    return 'disputed';
  end if;
end;
$$;

-- Compare two sets payloads (game-by-game). Tiebreak fields are ignored for
-- the MVP — TD can intervene if a tiebreak score is contested.
create or replace function public.sets_equal(p_a jsonb, p_b jsonb)
returns boolean
language sql
immutable
as $$
  with a as (
    select (s ->> 'games_a')::int as ga, (s ->> 'games_b')::int as gb,
           row_number() over () as rn
      from jsonb_array_elements(p_a) s
  ),
  b as (
    select (s ->> 'games_a')::int as ga, (s ->> 'games_b')::int as gb,
           row_number() over () as rn
      from jsonb_array_elements(p_b) s
  )
  select jsonb_array_length(p_a) = jsonb_array_length(p_b)
     and not exists (
       select 1 from a full outer join b using (rn)
        where a.ga is distinct from b.ga or a.gb is distinct from b.gb
     );
$$;

-- Advance the winner of a confirmed/overridden match into the next round's
-- slot. Round-1 byes are pre-resolved at draw generation time, so this only
-- needs to handle non-bye advancement.
create or replace function public.advance_winner(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_next_round smallint;
  v_next_slot smallint;
  v_side text;
begin
  select division_id, bracket, round, slot, winner_entry_id
    into v_match from matches where id = p_match_id;
  if not found or v_match.winner_entry_id is null then
    return;
  end if;

  v_next_round := v_match.round + 1;
  v_next_slot := v_match.slot / 2;
  v_side := case when v_match.slot % 2 = 0 then 'a' else 'b' end;

  if v_side = 'a' then
    update matches
       set entry_a_id = v_match.winner_entry_id
     where division_id = v_match.division_id
       and bracket = v_match.bracket
       and round = v_next_round
       and slot = v_next_slot;
  else
    update matches
       set entry_b_id = v_match.winner_entry_id
     where division_id = v_match.division_id
       and bracket = v_match.bracket
       and round = v_next_round
       and slot = v_next_slot;
  end if;
end;
$$;

-- ---------- grants ----------

grant execute on function public.register_for_division(uuid)                            to authenticated;
grant execute on function public.register_team_for_division(uuid, text)                 to authenticated;
grant execute on function public.accept_partner_invite(uuid)                            to authenticated;
grant execute on function public.decline_partner_invite(uuid)                           to authenticated;
grant execute on function public.withdraw_self(uuid)                                    to authenticated;
grant execute on function public.report_match_score(uuid, jsonb, uuid)                  to authenticated;

-- Internal helpers — keep callable from RPCs only (default role is owner;
-- explicitly revoke from anon/authenticated to avoid accidental exposure).
revoke execute on function public.ensure_member_participant(uuid, uuid)                 from public;
revoke execute on function public.division_effective_deadline(uuid)                     from public;
revoke execute on function public.age_at(date, date)                                    from public;
revoke execute on function public.assert_division_eligibility(uuid, uuid, boolean)      from public;
revoke execute on function public.replace_match_sets(uuid, jsonb)                       from public;
revoke execute on function public.validate_sets_payload(uuid, jsonb)                    from public;
revoke execute on function public.sets_equal(jsonb, jsonb)                              from public;
revoke execute on function public.advance_winner(uuid)                                  from public;
