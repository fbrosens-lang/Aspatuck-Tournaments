-- Aspatuck Tournaments — TD/admin-only RPCs
-- All functions are SECURITY DEFINER. Each checks authorization via the
-- helpers in 0002_rls_policies.sql before doing any work. Draw edits write
-- to bracket_audit; score overrides write to score_audit.

-- ---------- helpers ----------

-- Canonical seeding-position order for a bracket of the given power-of-two
-- size. Returns an int[] where positions[i] = the seed number that occupies
-- bracket row i (1-indexed).
create or replace function public.seed_positions(p_size int)
returns int[]
language plpgsql
immutable
as $$
declare
  v_positions int[];
  v_next int[];
  v_size int;
  v_p int;
begin
  if p_size = 1 then return array[1]; end if;
  if p_size < 2 or (p_size & (p_size - 1)) <> 0 then
    raise exception 'bracket size must be a power of 2 (got %)', p_size;
  end if;

  v_positions := array[1, 2];
  v_size := 2;
  while v_size < p_size loop
    v_size := v_size * 2;
    v_next := '{}'::int[];
    foreach v_p in array v_positions loop
      v_next := v_next || v_p;
      v_next := v_next || (v_size + 1 - v_p);
    end loop;
    v_positions := v_next;
  end loop;
  return v_positions;
end;
$$;

create or replace function public.next_pow2(p_n int)
returns int
language sql
immutable
as $$
  with vals(i) as (
    select unnest(array[1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024])
  )
  select min(i) from vals where i >= p_n;
$$;

-- ---------- participants & entries ----------

create or replace function public.td_add_guest_participant(
  p_tournament_id uuid,
  p_name text,
  p_email text,
  p_dob date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'guest display name is required';
  end if;

  insert into participants (tournament_id, kind, display_name, email, date_of_birth, created_by)
       values (p_tournament_id, 'guest', trim(p_name), nullif(trim(p_email), ''), p_dob, v_uid)
    returning id into v_id;

  return v_id;
end;
$$;

-- Enter an existing member (looked up by their user_id) into a singles
-- division on behalf of the TD. p_bypass_requirements=true skips DOB/age/
-- deadline checks.
create or replace function public.td_enter_member(
  p_division_id uuid,
  p_user_id uuid,
  p_bypass_requirements boolean
)
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
  if not public.is_td_of_division(v_uid, p_division_id) then
    raise exception 'not authorized';
  end if;

  select tournament_id, kind, status into v_div from divisions where id = p_division_id;
  if not found then raise exception 'division not found'; end if;
  if v_div.kind <> 'singles' then
    raise exception 'use td_enter_team for doubles divisions';
  end if;

  v_participant_id := public.ensure_member_participant(v_div.tournament_id, p_user_id);
  perform public.assert_division_eligibility(p_division_id, v_participant_id, p_bypass_requirements);

  insert into entries (division_id, participant_id, status, added_by_td_id)
       values (p_division_id, v_participant_id, 'confirmed', v_uid)
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;

-- Enter a (typically guest) participant into a singles division. The
-- participant must already exist in the division's tournament.
create or replace function public.td_enter_guest(
  p_division_id uuid,
  p_participant_id uuid,
  p_bypass_requirements boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_div record;
  v_part record;
  v_entry_id uuid;
begin
  if not public.is_td_of_division(v_uid, p_division_id) then
    raise exception 'not authorized';
  end if;

  select tournament_id, kind into v_div from divisions where id = p_division_id;
  if not found then raise exception 'division not found'; end if;
  if v_div.kind <> 'singles' then
    raise exception 'use td_enter_team for doubles divisions';
  end if;

  select tournament_id into v_part from participants where id = p_participant_id;
  if not found then raise exception 'participant not found'; end if;
  if v_part.tournament_id <> v_div.tournament_id then
    raise exception 'participant belongs to a different tournament';
  end if;

  perform public.assert_division_eligibility(p_division_id, p_participant_id, p_bypass_requirements);

  insert into entries (division_id, participant_id, status, added_by_td_id)
       values (p_division_id, p_participant_id, 'confirmed', v_uid)
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;

-- Enter a doubles team on behalf of the TD. Both participants must exist in
-- the same tournament as the division. The team is immediately accepted
-- (invite_status='accepted') because the TD is vouching for both sides.
create or replace function public.td_enter_team(
  p_division_id uuid,
  p_captain_participant_id uuid,
  p_partner_participant_id uuid,
  p_bypass_requirements boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_div record;
  v_team_id uuid;
  v_entry_id uuid;
begin
  if not public.is_td_of_division(v_uid, p_division_id) then
    raise exception 'not authorized';
  end if;

  select tournament_id, kind into v_div from divisions where id = p_division_id;
  if not found then raise exception 'division not found'; end if;
  if v_div.kind <> 'doubles' then
    raise exception 'this division is not doubles';
  end if;

  if (select count(*) from participants
       where id in (p_captain_participant_id, p_partner_participant_id)
         and tournament_id = v_div.tournament_id) <> 2 then
    raise exception 'both participants must belong to this tournament';
  end if;
  if p_captain_participant_id = p_partner_participant_id then
    raise exception 'captain and partner must be different participants';
  end if;

  perform public.assert_division_eligibility(p_division_id, p_captain_participant_id, p_bypass_requirements);
  perform public.assert_division_eligibility(p_division_id, p_partner_participant_id, p_bypass_requirements);

  insert into teams (division_id, captain_participant_id, partner_participant_id, invite_status)
       values (p_division_id, p_captain_participant_id, p_partner_participant_id, 'accepted')
    returning id into v_team_id;

  insert into entries (division_id, team_id, status, added_by_td_id)
       values (p_division_id, v_team_id, 'confirmed', v_uid)
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;

-- TD withdraws an entry. Walkovers are applied to any unplayed match the
-- entry was a side of (same logic as withdraw_self).
create or replace function public.td_withdraw_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_division_id uuid;
begin
  select division_id into v_division_id from entries where id = p_entry_id;
  if not found then raise exception 'entry not found'; end if;
  if not public.is_td_of_division(v_uid, v_division_id) then
    raise exception 'not authorized';
  end if;

  update entries set status = 'withdrawn', withdrawn_at = now() where id = p_entry_id;

  update matches m
     set winner_entry_id = case when m.entry_a_id = p_entry_id then m.entry_b_id else m.entry_a_id end,
         status = 'confirmed'
   where (m.entry_a_id = p_entry_id or m.entry_b_id = p_entry_id)
     and m.status = 'pending'
     and m.entry_a_id is not null
     and m.entry_b_id is not null;

  insert into bracket_audit (division_id, changed_by, change_type, notes, snapshot)
       values (v_division_id, v_uid, 'edited',
               'withdrew entry ' || p_entry_id::text,
               jsonb_build_object('entry_id', p_entry_id));
end;
$$;

-- ---------- draw editing ----------

-- Swap two entries everywhere they appear in matches. Both entries must
-- belong to the same division.
create or replace function public.td_swap_entries(
  p_entry_a uuid,
  p_entry_b uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_division_id uuid;
  v_other uuid;
begin
  if p_entry_a = p_entry_b then
    raise exception 'cannot swap an entry with itself';
  end if;

  select division_id into v_division_id from entries where id = p_entry_a;
  if not found then raise exception 'entry % not found', p_entry_a; end if;
  select division_id into v_other from entries where id = p_entry_b;
  if not found then raise exception 'entry % not found', p_entry_b; end if;
  if v_division_id <> v_other then
    raise exception 'entries belong to different divisions';
  end if;
  if not public.is_td_of_division(v_uid, v_division_id) then
    raise exception 'not authorized';
  end if;

  -- Use a temporary sentinel so we don't collide while swapping.
  update matches set entry_a_id = '00000000-0000-0000-0000-000000000000'
   where entry_a_id = p_entry_a and division_id = v_division_id;
  update matches set entry_b_id = '00000000-0000-0000-0000-000000000000'
   where entry_b_id = p_entry_a and division_id = v_division_id;
  update matches set entry_a_id = p_entry_a
   where entry_a_id = p_entry_b and division_id = v_division_id;
  update matches set entry_b_id = p_entry_a
   where entry_b_id = p_entry_b and division_id = v_division_id;
  update matches set entry_a_id = p_entry_b
   where entry_a_id = '00000000-0000-0000-0000-000000000000' and division_id = v_division_id;
  update matches set entry_b_id = p_entry_b
   where entry_b_id = '00000000-0000-0000-0000-000000000000' and division_id = v_division_id;

  insert into bracket_audit (division_id, changed_by, change_type, notes, snapshot)
       values (v_division_id, v_uid, 'edited',
               'swapped entries ' || p_entry_a::text || ' and ' || p_entry_b::text,
               jsonb_build_object('a', p_entry_a, 'b', p_entry_b));
end;
$$;

-- Replace the participant linked to a singles entry. Use this for late
-- substitutions on a singles draw.
create or replace function public.td_replace_participant(
  p_entry_id uuid,
  p_new_participant_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_entry record;
  v_div_tournament uuid;
  v_part_tournament uuid;
begin
  select division_id, participant_id, team_id into v_entry from entries where id = p_entry_id;
  if not found then raise exception 'entry not found'; end if;
  if v_entry.participant_id is null then
    raise exception 'this entry is a doubles team; use td_replace_team_partner';
  end if;
  if not public.is_td_of_division(v_uid, v_entry.division_id) then
    raise exception 'not authorized';
  end if;

  select tournament_id into v_div_tournament from divisions where id = v_entry.division_id;
  select tournament_id into v_part_tournament from participants where id = p_new_participant_id;
  if v_part_tournament is null then raise exception 'participant not found'; end if;
  if v_part_tournament <> v_div_tournament then
    raise exception 'participant belongs to a different tournament';
  end if;

  update entries set participant_id = p_new_participant_id where id = p_entry_id;

  insert into bracket_audit (division_id, changed_by, change_type, notes, snapshot)
       values (v_entry.division_id, v_uid, 'edited',
               'replaced participant on entry ' || p_entry_id::text,
               jsonb_build_object('entry_id', p_entry_id,
                                  'previous_participant_id', v_entry.participant_id,
                                  'new_participant_id', p_new_participant_id));
end;
$$;

create or replace function public.td_replace_team_partner(
  p_team_id uuid,
  p_new_partner_participant_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_team record;
  v_div_tournament uuid;
  v_part_tournament uuid;
begin
  select t.id, t.division_id, t.partner_participant_id, t.captain_participant_id
    into v_team from teams t where t.id = p_team_id;
  if not found then raise exception 'team not found'; end if;
  if not public.is_td_of_division(v_uid, v_team.division_id) then
    raise exception 'not authorized';
  end if;
  if p_new_partner_participant_id = v_team.captain_participant_id then
    raise exception 'captain and partner must be different participants';
  end if;

  select tournament_id into v_div_tournament from divisions where id = v_team.division_id;
  select tournament_id into v_part_tournament from participants where id = p_new_partner_participant_id;
  if v_part_tournament is null then raise exception 'participant not found'; end if;
  if v_part_tournament <> v_div_tournament then
    raise exception 'participant belongs to a different tournament';
  end if;

  update teams set partner_participant_id = p_new_partner_participant_id,
                   invite_status = 'accepted'
   where id = p_team_id;

  insert into bracket_audit (division_id, changed_by, change_type, notes, snapshot)
       values (v_team.division_id, v_uid, 'edited',
               'replaced partner on team ' || p_team_id::text,
               jsonb_build_object('team_id', p_team_id,
                                  'previous_partner_id', v_team.partner_participant_id,
                                  'new_partner_id', p_new_partner_participant_id));
end;
$$;

-- ---------- deadlines ----------

create or replace function public.td_set_match_deadline(
  p_match_id uuid,
  p_deadline timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_division_id uuid;
begin
  select division_id into v_division_id from matches where id = p_match_id;
  if not found then raise exception 'match not found'; end if;
  if not public.is_td_of_division(v_uid, v_division_id) then
    raise exception 'not authorized';
  end if;

  update matches set deadline_override = p_deadline where id = p_match_id;
end;
$$;

create or replace function public.td_set_round_deadline(
  p_division_id uuid,
  p_round smallint,
  p_deadline timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_td_of_division(v_uid, p_division_id) then
    raise exception 'not authorized';
  end if;

  if p_deadline is null then
    delete from division_round_deadlines where division_id = p_division_id and round = p_round;
  else
    insert into division_round_deadlines (division_id, round, deadline)
         values (p_division_id, p_round, p_deadline)
    on conflict (division_id, round) do update set deadline = excluded.deadline;
  end if;
end;
$$;

-- ---------- draw generation ----------

-- Build the single-elim main bracket for a division from its confirmed
-- entries. Entries are seeded by their `seed` column (NULLS LAST, then by
-- created_at). Round-1 byes are pre-resolved (status='confirmed', winner set)
-- and propagated into round 2 at insert time. Consolation bracket is not yet
-- implemented; bracket_format='single_elim_consolation' currently generates
-- only the main bracket and the consolation tier is added in v1.
create or replace function public.generate_draw(p_division_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_div record;
  v_n int;
  v_size int;
  v_positions int[];
  v_entry_by_seed uuid[];
  v_seed int;
  v_row int;
  v_round int;
  v_max_round int;
  v_matches_in_round int;
  v_slot int;
  v_row_a int;
  v_row_b int;
  v_entry_a uuid;
  v_entry_b uuid;
  v_status match_status;
  v_winner uuid;
  v_existing_count int;
begin
  if not public.is_td_of_division(v_uid, p_division_id) then
    raise exception 'not authorized';
  end if;

  select id, status into v_div from divisions where id = p_division_id;
  if not found then raise exception 'division not found'; end if;

  select count(*) into v_existing_count from matches where division_id = p_division_id;
  if v_existing_count > 0 then
    raise exception 'this division already has a draw; use td_regenerate_draw to start over';
  end if;

  -- Assign sequential seed numbers 1..N to confirmed entries in
  -- (seed NULLS LAST, created_at) order.
  v_entry_by_seed := array(
    select id from entries
     where division_id = p_division_id and status = 'confirmed'
     order by seed nulls last, created_at
  );
  v_n := array_length(v_entry_by_seed, 1);
  if v_n is null or v_n < 2 then
    raise exception 'need at least 2 confirmed entries to generate a draw';
  end if;

  v_size := public.next_pow2(v_n);
  v_positions := public.seed_positions(v_size);
  v_max_round := (ln(v_size) / ln(2))::int;

  -- Persist the assigned seed numbers on the entries.
  for v_seed in 1 .. v_n loop
    update entries set seed = v_seed where id = v_entry_by_seed[v_seed];
  end loop;

  -- Round 1: one match per pair of rows (rows 1-2, 3-4, ...).
  v_round := 1;
  v_matches_in_round := v_size / 2;
  for v_slot in 0 .. v_matches_in_round - 1 loop
    v_row_a := v_slot * 2 + 1;
    v_row_b := v_slot * 2 + 2;
    v_entry_a := case when v_positions[v_row_a] <= v_n then v_entry_by_seed[v_positions[v_row_a]] else null end;
    v_entry_b := case when v_positions[v_row_b] <= v_n then v_entry_by_seed[v_positions[v_row_b]] else null end;

    v_status := 'pending';
    v_winner := null;
    if v_entry_a is not null and v_entry_b is null then
      v_status := 'confirmed';
      v_winner := v_entry_a;
    elsif v_entry_b is not null and v_entry_a is null then
      v_status := 'confirmed';
      v_winner := v_entry_b;
    end if;

    insert into matches (division_id, bracket, round, slot, entry_a_id, entry_b_id, winner_entry_id, status)
         values (p_division_id, 'main', v_round, v_slot, v_entry_a, v_entry_b, v_winner, v_status);
  end loop;

  -- Rounds 2..max_round: empty slots; advancement fills them.
  for v_round in 2 .. v_max_round loop
    v_matches_in_round := v_size / (2 ^ v_round)::int;
    for v_slot in 0 .. v_matches_in_round - 1 loop
      insert into matches (division_id, bracket, round, slot)
           values (p_division_id, 'main', v_round, v_slot);
    end loop;
  end loop;

  -- Now that round 2+ exists, propagate round-1 byes forward.
  perform public.advance_winner(m.id)
     from matches m
    where m.division_id = p_division_id
      and m.bracket = 'main'
      and m.round = 1
      and m.status = 'confirmed';

  update divisions set status = 'seeded' where id = p_division_id;

  insert into bracket_audit (division_id, changed_by, change_type, notes, snapshot)
       values (p_division_id, v_uid, 'generated',
               'generated draw with ' || v_n || ' entries (bracket size ' || v_size || ')',
               jsonb_build_object('n', v_n, 'size', v_size));
end;
$$;

create or replace function public.publish_draw(p_division_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_td_of_division(v_uid, p_division_id) then
    raise exception 'not authorized';
  end if;

  update divisions set status = 'drawn' where id = p_division_id and status = 'seeded';
  if not found then
    raise exception 'division must be in seeded status to publish';
  end if;

  insert into bracket_audit (division_id, changed_by, change_type, notes)
       values (p_division_id, v_uid, 'published', 'published draw');
end;
$$;

create or replace function public.td_regenerate_draw(p_division_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_td_of_division(v_uid, p_division_id) then
    raise exception 'not authorized';
  end if;

  delete from matches where division_id = p_division_id;
  update entries set seed = null where division_id = p_division_id;
  update divisions set status = 'open' where id = p_division_id;

  insert into bracket_audit (division_id, changed_by, change_type, notes)
       values (p_division_id, v_uid, 'regenerated', 'cleared matches and seeds');

  -- Re-run generation in the same call so the caller ends up with a fresh draw.
  perform public.generate_draw(p_division_id);
end;
$$;

-- ---------- score overrides ----------

create or replace function public.override_match_score(
  p_match_id uuid,
  p_sets jsonb,
  p_winner_entry_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_match record;
  v_existing_sets jsonb;
  v_existing_winner uuid;
  v_inferred_winner uuid;
begin
  select id, division_id, status, entry_a_id, entry_b_id, winner_entry_id
    into v_match
    from matches where id = p_match_id;
  if not found then raise exception 'match not found'; end if;
  if not public.is_td_of_division(v_uid, v_match.division_id) then
    raise exception 'not authorized';
  end if;

  v_inferred_winner := public.validate_sets_payload(p_match_id, p_sets);
  if v_inferred_winner <> p_winner_entry_id then
    raise exception 'declared winner does not match the set scores';
  end if;
  if p_winner_entry_id not in (v_match.entry_a_id, v_match.entry_b_id) then
    raise exception 'winner must be a participant in the match';
  end if;

  v_existing_winner := v_match.winner_entry_id;
  select coalesce(jsonb_agg(jsonb_build_object(
            'set_number', set_number,
            'games_a', games_a,
            'games_b', games_b,
            'tiebreak_a', tiebreak_a,
            'tiebreak_b', tiebreak_b
         ) order by set_number), '[]'::jsonb)
    into v_existing_sets
    from match_sets where match_id = p_match_id;

  perform public.replace_match_sets(p_match_id, p_sets);
  update matches
     set winner_entry_id = p_winner_entry_id,
         status = 'overridden',
         reported_by = v_uid,
         reported_at = now()
   where id = p_match_id;

  insert into score_audit (match_id, changed_by, change_type,
                            previous_winner, new_winner,
                            previous_sets, new_sets)
       values (p_match_id, v_uid, 'overridden',
               v_existing_winner, p_winner_entry_id,
               v_existing_sets, p_sets);

  perform public.advance_winner(p_match_id);

  -- Flag downstream matches as disputed; the TD must explicitly cascade.
  update matches
     set status = 'disputed'
   where division_id = v_match.division_id
     and bracket = v_match.bracket
     and round > v_match.round
     and (entry_a_id = v_existing_winner or entry_b_id = v_existing_winner)
     and status in ('reported', 'confirmed', 'overridden');
end;
$$;

-- ---------- site admin: TD role grant ----------

create or replace function public.admin_set_user_role(
  p_user_id uuid,
  p_role profile_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_site_admin(v_uid) then
    raise exception 'only site admins may change user roles';
  end if;
  update profiles set role = p_role where id = p_user_id;
  if not found then raise exception 'user not found'; end if;
end;
$$;

create or replace function public.admin_grant_tournament_director(
  p_tournament_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not (public.is_site_admin(v_uid) or public.is_td_of_tournament(v_uid, p_tournament_id)) then
    raise exception 'only site admins or existing TDs of this tournament may grant TD status';
  end if;
  insert into tournament_directors (tournament_id, user_id)
       values (p_tournament_id, p_user_id)
  on conflict do nothing;
end;
$$;

create or replace function public.admin_revoke_tournament_director(
  p_tournament_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not (public.is_site_admin(v_uid) or public.is_td_of_tournament(v_uid, p_tournament_id)) then
    raise exception 'only site admins or existing TDs of this tournament may revoke TD status';
  end if;
  delete from tournament_directors where tournament_id = p_tournament_id and user_id = p_user_id;
end;
$$;

-- ---------- grants ----------

grant execute on function public.td_add_guest_participant(uuid, text, text, date)         to authenticated;
grant execute on function public.td_enter_member(uuid, uuid, boolean)                     to authenticated;
grant execute on function public.td_enter_guest(uuid, uuid, boolean)                      to authenticated;
grant execute on function public.td_enter_team(uuid, uuid, uuid, boolean)                 to authenticated;
grant execute on function public.td_withdraw_entry(uuid)                                  to authenticated;
grant execute on function public.td_swap_entries(uuid, uuid)                              to authenticated;
grant execute on function public.td_replace_participant(uuid, uuid)                       to authenticated;
grant execute on function public.td_replace_team_partner(uuid, uuid)                      to authenticated;
grant execute on function public.td_set_match_deadline(uuid, timestamptz)                 to authenticated;
grant execute on function public.td_set_round_deadline(uuid, smallint, timestamptz)       to authenticated;
grant execute on function public.generate_draw(uuid)                                      to authenticated;
grant execute on function public.publish_draw(uuid)                                       to authenticated;
grant execute on function public.td_regenerate_draw(uuid)                                 to authenticated;
grant execute on function public.override_match_score(uuid, jsonb, uuid)                  to authenticated;
grant execute on function public.admin_set_user_role(uuid, profile_role)                  to authenticated;
grant execute on function public.admin_grant_tournament_director(uuid, uuid)              to authenticated;
grant execute on function public.admin_revoke_tournament_director(uuid, uuid)             to authenticated;

revoke execute on function public.seed_positions(int) from public;
revoke execute on function public.next_pow2(int)      from public;
