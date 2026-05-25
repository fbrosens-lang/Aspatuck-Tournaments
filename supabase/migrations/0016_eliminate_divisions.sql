-- Aspatuck Tournaments — eliminate the division layer.
--
-- Before: tournaments owned 1+ divisions, and divisions owned entries, teams,
-- matches, round deadlines, and the bracket audit log. Each division carried
-- its own match-format, eligibility, and lifecycle config.
--
-- After: one tournament == one main draw (with optional consolation, encoded
-- in the existing matches.bracket enum). All match-format / eligibility /
-- lifecycle fields move up to `tournaments`. The divisions table is dropped.

begin;

-- ---------- drop RLS policies that depend on division helpers ----------
-- Drop these first; the helper functions they reference (is_td_of_division)
-- are dropped further down.

drop policy if exists bracket_audit_select_td on bracket_audit;
drop policy if exists score_audit_select_td   on score_audit;
drop policy if exists divisions_select_all    on divisions;
drop policy if exists division_round_deadlines_select_all on division_round_deadlines;

-- ---------- drop RPCs that reference divisions ----------
-- Drop so we can freely rewrite the schema underneath them.

drop function if exists public.my_pending_matches();
drop function if exists public.td_managed_matches();
drop function if exists public.register_for_division(uuid);
drop function if exists public.register_team_for_division(uuid, text);
drop function if exists public.td_create_division(uuid, text, division_kind, bracket_format, match_kind, final_set_format, smallint, smallint, smallint, boolean, smallint, smallint, timestamptz);
drop function if exists public.td_update_division(uuid, text, bracket_format, match_kind, final_set_format, smallint, smallint, smallint, boolean, smallint, smallint, timestamptz, division_status);
drop function if exists public.td_enter_member(uuid, uuid, boolean);
drop function if exists public.td_enter_guest(uuid, uuid, boolean);
drop function if exists public.td_enter_team(uuid, uuid, uuid, boolean);
drop function if exists public.td_enter_club_member(uuid, uuid, boolean);
drop function if exists public.td_substitute_with_club_member(uuid, uuid, boolean);
drop function if exists public.td_withdraw_entry(uuid);
drop function if exists public.td_swap_entries(uuid, uuid);
drop function if exists public.td_replace_participant(uuid, uuid);
drop function if exists public.td_replace_team_partner(uuid, uuid);
drop function if exists public.td_set_match_deadline(uuid, timestamptz);
drop function if exists public.td_set_round_deadline(uuid, smallint, timestamptz);
drop function if exists public.generate_draw(uuid);
drop function if exists public.publish_draw(uuid);
drop function if exists public.td_regenerate_draw(uuid);
drop function if exists public.override_match_score(uuid, jsonb, uuid);
drop function if exists public.advance_winner(uuid);
drop function if exists public.assert_division_eligibility(uuid, uuid, boolean);
drop function if exists public.division_effective_deadline(uuid);
drop function if exists public.is_td_of_division(uuid, uuid);

-- TD-update / create signatures grow to carry the rule fields. Drop the old
-- signatures so we can replace them below.
drop function if exists public.td_create_tournament(text, text, date, date, timestamptz);
drop function if exists public.td_update_tournament(uuid, text, text, date, date, timestamptz, tournament_status);

-- ---------- enum rename ----------

alter type division_status rename to draw_status;

-- ---------- new columns on tournaments ----------

alter table tournaments
  add column kind                            division_kind,
  add column bracket_format                  bracket_format not null default 'single_elim',
  add column draw_status                     draw_status    not null default 'open',
  add column sets_to_win                     smallint       not null default 2,
  add column games_per_set                   smallint       not null default 6,
  add column tiebreak_at                     smallint       not null default 6,
  add column final_set_format                final_set_format not null default 'super_tb_10',
  add column match_kind                      match_kind     not null default 'best_of_3',
  add column requires_dob                    boolean        not null default false,
  add column min_age                         smallint,
  add column max_age                         smallint,
  add column registration_deadline_override  timestamptz;

-- Backfill from the tournament's first division (by created_at). Pre-production
-- there is at most one division per tournament; multi-division tournaments
-- would lose the other divisions' rule sets but their entries are dropped with
-- the divisions table anyway.
update tournaments t
   set kind                           = d.kind,
       bracket_format                 = d.bracket_format,
       draw_status                    = d.status,
       sets_to_win                    = d.sets_to_win,
       games_per_set                  = d.games_per_set,
       tiebreak_at                    = d.tiebreak_at,
       final_set_format               = d.final_set_format,
       match_kind                     = d.match_kind,
       requires_dob                   = d.requires_dob,
       min_age                        = d.min_age,
       max_age                        = d.max_age,
       registration_deadline_override = d.registration_deadline_override
  from (
    select distinct on (tournament_id)
      tournament_id, kind, bracket_format, status, sets_to_win, games_per_set,
      tiebreak_at, final_set_format, match_kind, requires_dob,
      min_age, max_age, registration_deadline_override
      from divisions
     order by tournament_id, created_at
  ) d
 where t.id = d.tournament_id;

-- Tournaments with no division row default to singles.
update tournaments set kind = 'singles' where kind is null;

alter table tournaments
  alter column kind set not null,
  add check (sets_to_win in (1, 2, 3)),
  add check (games_per_set in (4, 6, 8, 10)),
  add check (tiebreak_at >= 0 and tiebreak_at <= games_per_set + 2),
  add check (min_age is null or min_age >= 0),
  add check (max_age is null or max_age >= 0),
  add check (min_age is null or max_age is null or min_age <= max_age);

-- ---------- pivot child tables to tournament_id ----------

-- teams
alter table teams add column tournament_id uuid references tournaments(id) on delete cascade;
update teams x
   set tournament_id = d.tournament_id
  from divisions d where d.id = x.division_id;
alter table teams alter column tournament_id set not null;
drop index if exists teams_division_idx;
alter table teams drop column division_id;
create index teams_tournament_idx on teams (tournament_id);

-- entries
alter table entries add column tournament_id uuid references tournaments(id) on delete cascade;
update entries e
   set tournament_id = d.tournament_id
  from divisions d where d.id = e.division_id;
alter table entries alter column tournament_id set not null;
drop index if exists entries_division_status_idx;
alter table entries drop column division_id;
create index entries_tournament_status_idx on entries (tournament_id, status);

-- matches
alter table matches add column tournament_id uuid references tournaments(id) on delete cascade;
update matches m
   set tournament_id = d.tournament_id
  from divisions d where d.id = m.division_id;
alter table matches alter column tournament_id set not null;
alter table matches drop constraint matches_division_id_bracket_round_slot_key;
drop index if exists matches_division_status_idx;
alter table matches drop column division_id;
alter table matches add constraint matches_tournament_bracket_round_slot_key
  unique (tournament_id, bracket, round, slot);
create index matches_tournament_status_idx on matches (tournament_id, status);

-- bracket_audit
alter table bracket_audit add column tournament_id uuid references tournaments(id) on delete cascade;
update bracket_audit a
   set tournament_id = d.tournament_id
  from divisions d where d.id = a.division_id;
alter table bracket_audit alter column tournament_id set not null;
drop index if exists bracket_audit_division_idx;
alter table bracket_audit drop column division_id;
create index bracket_audit_tournament_idx on bracket_audit (tournament_id, created_at desc);

-- round deadlines: rename table + column
alter table division_round_deadlines rename to tournament_round_deadlines;
alter table tournament_round_deadlines rename column division_id to tournament_id;
-- The PK on (division_id, round) becomes (tournament_id, round) automatically;
-- the FK target switches because the divisions table is about to be dropped.
alter table tournament_round_deadlines
  drop constraint if exists division_round_deadlines_division_id_fkey;
alter table tournament_round_deadlines
  add constraint tournament_round_deadlines_tournament_id_fkey
    foreign key (tournament_id) references tournaments(id) on delete cascade;

-- ---------- drop the divisions table ----------

drop table divisions;

-- ---------- replacement RPCs ----------

-- Helper: effective deadline for a tournament (override falls back to base).
create or replace function public.tournament_effective_deadline(p_tournament_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(registration_deadline_override, registration_deadline)
    from tournaments
   where id = p_tournament_id;
$$;

create or replace function public.assert_tournament_eligibility(
  p_tournament_id uuid,
  p_participant_id uuid,
  p_bypass boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t record;
  v_part record;
  v_deadline timestamptz;
  v_age smallint;
begin
  if p_bypass then return; end if;

  select requires_dob, min_age, max_age, start_date
    into v_t
    from tournaments
   where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;

  select date_of_birth into v_part
    from participants where id = p_participant_id;
  if not found then raise exception 'participant not found'; end if;

  v_deadline := public.tournament_effective_deadline(p_tournament_id);
  if v_deadline is not null and now() > v_deadline then
    raise exception 'registration deadline has passed';
  end if;

  if v_t.requires_dob and v_part.date_of_birth is null then
    raise exception 'this tournament requires a date of birth on the participant';
  end if;

  v_age := public.age_at(v_part.date_of_birth, v_t.start_date);
  if v_t.min_age is not null and (v_age is null or v_age < v_t.min_age) then
    raise exception 'participant does not meet minimum age (%) for this tournament', v_t.min_age;
  end if;
  if v_t.max_age is not null and v_age is not null and v_age > v_t.max_age then
    raise exception 'participant exceeds maximum age (%) for this tournament', v_t.max_age;
  end if;
end;
$$;

-- ----- player-callable -----

create or replace function public.register_for_tournament(p_tournament_id uuid)
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
  if v_t.kind <> 'singles' then
    raise exception 'use register_team_for_tournament for doubles tournaments';
  end if;
  if v_t.draw_status <> 'open' then
    raise exception 'this tournament is no longer accepting registrations';
  end if;

  v_participant_id := public.ensure_member_participant(p_tournament_id, v_uid);
  perform public.assert_tournament_eligibility(p_tournament_id, v_participant_id, false);

  insert into entries (tournament_id, participant_id, status)
       values (p_tournament_id, v_participant_id, 'confirmed')
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;

create or replace function public.register_team_for_tournament(
  p_tournament_id uuid,
  p_partner_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t record;
  v_partner_user_id uuid;
  v_captain_participant_id uuid;
  v_partner_participant_id uuid;
  v_team_id uuid;
  v_entry_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select id, kind, draw_status into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'doubles' then
    raise exception 'use register_for_tournament for singles tournaments';
  end if;
  if v_t.draw_status <> 'open' then
    raise exception 'this tournament is no longer accepting registrations';
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

  v_captain_participant_id := public.ensure_member_participant(p_tournament_id, v_uid);
  v_partner_participant_id := public.ensure_member_participant(p_tournament_id, v_partner_user_id);

  perform public.assert_tournament_eligibility(p_tournament_id, v_captain_participant_id, false);
  perform public.assert_tournament_eligibility(p_tournament_id, v_partner_participant_id, false);

  insert into teams (tournament_id, captain_participant_id, partner_participant_id, invite_status)
       values (p_tournament_id, v_captain_participant_id, v_partner_participant_id, 'pending')
    returning id into v_team_id;

  insert into entries (tournament_id, team_id, status)
       values (p_tournament_id, v_team_id, 'pending')
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;

-- advance_winner now keys off matches.tournament_id rather than division_id.
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
  select tournament_id, bracket, round, slot, winner_entry_id
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
     where tournament_id = v_match.tournament_id
       and bracket = v_match.bracket
       and round = v_next_round
       and slot = v_next_slot;
  else
    update matches
       set entry_b_id = v_match.winner_entry_id
     where tournament_id = v_match.tournament_id
       and bracket = v_match.bracket
       and round = v_next_round
       and slot = v_next_slot;
  end if;
end;
$$;

-- ----- TD CRUD: tournaments now carry the rule fields -----

create or replace function public.td_create_tournament(
  p_name text,
  p_location text,
  p_start_date date,
  p_end_date date,
  p_registration_deadline timestamptz,
  p_kind division_kind,
  p_bracket_format bracket_format,
  p_match_kind match_kind,
  p_final_set_format final_set_format,
  p_sets_to_win smallint,
  p_games_per_set smallint,
  p_tiebreak_at smallint,
  p_requires_dob boolean,
  p_min_age smallint,
  p_max_age smallint,
  p_registration_deadline_override timestamptz
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
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if not public.is_director_role(v_uid) then
    raise exception 'only tournament directors or site admins may create tournaments';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'tournament name is required';
  end if;
  if p_end_date < p_start_date then
    raise exception 'end date cannot be before start date';
  end if;

  insert into tournaments (
    name, location, start_date, end_date, registration_deadline, created_by, status,
    kind, bracket_format, match_kind, final_set_format,
    sets_to_win, games_per_set, tiebreak_at,
    requires_dob, min_age, max_age, registration_deadline_override
  ) values (
    trim(p_name), nullif(trim(p_location), ''), p_start_date, p_end_date,
    p_registration_deadline, v_uid, 'draft',
    p_kind, p_bracket_format, p_match_kind, p_final_set_format,
    p_sets_to_win, p_games_per_set, p_tiebreak_at,
    p_requires_dob, p_min_age, p_max_age, p_registration_deadline_override
  ) returning id into v_id;

  insert into tournament_directors (tournament_id, user_id)
       values (v_id, v_uid)
  on conflict do nothing;

  return v_id;
end;
$$;

create or replace function public.td_update_tournament(
  p_id uuid,
  p_name text,
  p_location text,
  p_start_date date,
  p_end_date date,
  p_registration_deadline timestamptz,
  p_status tournament_status,
  p_bracket_format bracket_format,
  p_match_kind match_kind,
  p_final_set_format final_set_format,
  p_sets_to_win smallint,
  p_games_per_set smallint,
  p_tiebreak_at smallint,
  p_requires_dob boolean,
  p_min_age smallint,
  p_max_age smallint,
  p_registration_deadline_override timestamptz,
  p_draw_status draw_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_td_of_tournament(v_uid, p_id) then
    raise exception 'not authorized';
  end if;
  if p_end_date < p_start_date then
    raise exception 'end date cannot be before start date';
  end if;

  update tournaments
     set name = trim(p_name),
         location = nullif(trim(p_location), ''),
         start_date = p_start_date,
         end_date = p_end_date,
         registration_deadline = p_registration_deadline,
         status = p_status,
         bracket_format = p_bracket_format,
         match_kind = p_match_kind,
         final_set_format = p_final_set_format,
         sets_to_win = p_sets_to_win,
         games_per_set = p_games_per_set,
         tiebreak_at = p_tiebreak_at,
         requires_dob = p_requires_dob,
         min_age = p_min_age,
         max_age = p_max_age,
         registration_deadline_override = p_registration_deadline_override,
         draw_status = p_draw_status
   where id = p_id;
end;
$$;

-- ----- TD entry management -----

create or replace function public.td_enter_member(
  p_tournament_id uuid,
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
  v_t record;
  v_participant_id uuid;
  v_entry_id uuid;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;

  select kind into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'singles' then
    raise exception 'use td_enter_team for doubles tournaments';
  end if;

  v_participant_id := public.ensure_member_participant(p_tournament_id, p_user_id);
  perform public.assert_tournament_eligibility(p_tournament_id, v_participant_id, p_bypass_requirements);

  insert into entries (tournament_id, participant_id, status, added_by_td_id)
       values (p_tournament_id, v_participant_id, 'confirmed', v_uid)
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;

create or replace function public.td_enter_guest(
  p_tournament_id uuid,
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
  v_t record;
  v_part record;
  v_entry_id uuid;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;

  select kind into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'singles' then
    raise exception 'use td_enter_team for doubles tournaments';
  end if;

  select tournament_id into v_part from participants where id = p_participant_id;
  if not found then raise exception 'participant not found'; end if;
  if v_part.tournament_id <> p_tournament_id then
    raise exception 'participant belongs to a different tournament';
  end if;

  perform public.assert_tournament_eligibility(p_tournament_id, p_participant_id, p_bypass_requirements);

  insert into entries (tournament_id, participant_id, status, added_by_td_id)
       values (p_tournament_id, p_participant_id, 'confirmed', v_uid)
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;

create or replace function public.td_enter_team(
  p_tournament_id uuid,
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
  v_t record;
  v_team_id uuid;
  v_entry_id uuid;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;

  select kind into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'doubles' then
    raise exception 'this tournament is not doubles';
  end if;

  if (select count(*) from participants
       where id in (p_captain_participant_id, p_partner_participant_id)
         and tournament_id = p_tournament_id) <> 2 then
    raise exception 'both participants must belong to this tournament';
  end if;
  if p_captain_participant_id = p_partner_participant_id then
    raise exception 'captain and partner must be different participants';
  end if;

  perform public.assert_tournament_eligibility(p_tournament_id, p_captain_participant_id, p_bypass_requirements);
  perform public.assert_tournament_eligibility(p_tournament_id, p_partner_participant_id, p_bypass_requirements);

  insert into teams (tournament_id, captain_participant_id, partner_participant_id, invite_status)
       values (p_tournament_id, p_captain_participant_id, p_partner_participant_id, 'accepted')
    returning id into v_team_id;

  insert into entries (tournament_id, team_id, status, added_by_td_id)
       values (p_tournament_id, v_team_id, 'confirmed', v_uid)
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;

create or replace function public.td_enter_club_member(
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
  v_cm record;
  v_participant_id uuid;
  v_entry_id uuid;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;

  select kind into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'singles' then
    raise exception 'club-member entry helper currently supports singles only';
  end if;

  select full_name, email, date_of_birth, user_id
    into v_cm from club_members where id = p_club_member_id;
  if not found then raise exception 'club member not found'; end if;

  select id into v_participant_id from participants
   where tournament_id = p_tournament_id and club_member_id = p_club_member_id;
  if v_participant_id is null and v_cm.user_id is not null then
    select id into v_participant_id from participants
     where tournament_id = p_tournament_id and user_id = v_cm.user_id;
  end if;
  if v_participant_id is null then
    insert into participants (
      tournament_id, kind, user_id, club_member_id,
      display_name, email, date_of_birth, created_by
    ) values (
      p_tournament_id,
      (case when v_cm.user_id is not null then 'member' else 'guest' end)::participant_kind,
      v_cm.user_id,
      p_club_member_id,
      v_cm.full_name,
      v_cm.email,
      v_cm.date_of_birth,
      v_uid
    )
    returning id into v_participant_id;
  end if;

  perform public.assert_tournament_eligibility(p_tournament_id, v_participant_id, p_bypass_requirements);

  insert into entries (tournament_id, participant_id, status, added_by_td_id)
       values (p_tournament_id, v_participant_id, 'confirmed', v_uid)
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;

create or replace function public.td_substitute_with_club_member(
  p_entry_id uuid,
  p_club_member_id uuid,
  p_bypass_requirements boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_entry record;
  v_cm record;
  v_participant_id uuid;
begin
  select tournament_id, participant_id, team_id into v_entry
    from entries where id = p_entry_id;
  if not found then raise exception 'entry not found'; end if;
  if v_entry.participant_id is null then
    raise exception 'this entry is a doubles team; use td_replace_team_partner instead';
  end if;
  if not public.is_td_of_tournament(v_uid, v_entry.tournament_id) then
    raise exception 'not authorized';
  end if;

  select full_name, email, date_of_birth, user_id
    into v_cm from club_members where id = p_club_member_id;
  if not found then raise exception 'club member not found'; end if;

  select id into v_participant_id from participants
   where tournament_id = v_entry.tournament_id and club_member_id = p_club_member_id;
  if v_participant_id is null and v_cm.user_id is not null then
    select id into v_participant_id from participants
     where tournament_id = v_entry.tournament_id and user_id = v_cm.user_id;
  end if;
  if v_participant_id is null then
    insert into participants (
      tournament_id, kind, user_id, club_member_id,
      display_name, email, date_of_birth, created_by
    ) values (
      v_entry.tournament_id,
      (case when v_cm.user_id is not null then 'member' else 'guest' end)::participant_kind,
      v_cm.user_id,
      p_club_member_id,
      v_cm.full_name,
      v_cm.email,
      v_cm.date_of_birth,
      v_uid
    )
    returning id into v_participant_id;
  end if;

  perform public.assert_tournament_eligibility(v_entry.tournament_id, v_participant_id, p_bypass_requirements);

  update entries set participant_id = v_participant_id where id = p_entry_id;

  insert into bracket_audit (tournament_id, changed_by, change_type, notes, snapshot)
       values (v_entry.tournament_id, v_uid, 'edited',
               'substituted club member into entry ' || p_entry_id::text,
               jsonb_build_object('entry_id', p_entry_id,
                                  'previous_participant_id', v_entry.participant_id,
                                  'new_participant_id', v_participant_id,
                                  'club_member_id', p_club_member_id));
end;
$$;

create or replace function public.td_withdraw_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tournament_id uuid;
begin
  select tournament_id into v_tournament_id from entries where id = p_entry_id;
  if not found then raise exception 'entry not found'; end if;
  if not public.is_td_of_tournament(v_uid, v_tournament_id) then
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

  insert into bracket_audit (tournament_id, changed_by, change_type, notes, snapshot)
       values (v_tournament_id, v_uid, 'edited',
               'withdrew entry ' || p_entry_id::text,
               jsonb_build_object('entry_id', p_entry_id));
end;
$$;

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
  v_tournament_id uuid;
  v_other uuid;
begin
  if p_entry_a = p_entry_b then
    raise exception 'cannot swap an entry with itself';
  end if;

  select tournament_id into v_tournament_id from entries where id = p_entry_a;
  if not found then raise exception 'entry % not found', p_entry_a; end if;
  select tournament_id into v_other from entries where id = p_entry_b;
  if not found then raise exception 'entry % not found', p_entry_b; end if;
  if v_tournament_id <> v_other then
    raise exception 'entries belong to different tournaments';
  end if;
  if not public.is_td_of_tournament(v_uid, v_tournament_id) then
    raise exception 'not authorized';
  end if;

  update matches
     set entry_a_id = case
           when entry_a_id = p_entry_a then p_entry_b
           when entry_a_id = p_entry_b then p_entry_a
           else entry_a_id
         end,
         entry_b_id = case
           when entry_b_id = p_entry_a then p_entry_b
           when entry_b_id = p_entry_b then p_entry_a
           else entry_b_id
         end,
         winner_entry_id = case
           when winner_entry_id = p_entry_a then p_entry_b
           when winner_entry_id = p_entry_b then p_entry_a
           else winner_entry_id
         end
   where tournament_id = v_tournament_id
     and (entry_a_id in (p_entry_a, p_entry_b)
       or entry_b_id in (p_entry_a, p_entry_b)
       or winner_entry_id in (p_entry_a, p_entry_b));

  insert into bracket_audit (tournament_id, changed_by, change_type, notes, snapshot)
       values (v_tournament_id, v_uid, 'edited',
               'swapped entries ' || p_entry_a::text || ' and ' || p_entry_b::text,
               jsonb_build_object('a', p_entry_a, 'b', p_entry_b));
end;
$$;

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
  v_part_tournament uuid;
begin
  select tournament_id, participant_id, team_id into v_entry from entries where id = p_entry_id;
  if not found then raise exception 'entry not found'; end if;
  if v_entry.participant_id is null then
    raise exception 'this entry is a doubles team; use td_replace_team_partner';
  end if;
  if not public.is_td_of_tournament(v_uid, v_entry.tournament_id) then
    raise exception 'not authorized';
  end if;

  select tournament_id into v_part_tournament from participants where id = p_new_participant_id;
  if v_part_tournament is null then raise exception 'participant not found'; end if;
  if v_part_tournament <> v_entry.tournament_id then
    raise exception 'participant belongs to a different tournament';
  end if;

  update entries set participant_id = p_new_participant_id where id = p_entry_id;

  insert into bracket_audit (tournament_id, changed_by, change_type, notes, snapshot)
       values (v_entry.tournament_id, v_uid, 'edited',
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
  v_part_tournament uuid;
begin
  select id, tournament_id, partner_participant_id, captain_participant_id
    into v_team from teams where id = p_team_id;
  if not found then raise exception 'team not found'; end if;
  if not public.is_td_of_tournament(v_uid, v_team.tournament_id) then
    raise exception 'not authorized';
  end if;
  if p_new_partner_participant_id = v_team.captain_participant_id then
    raise exception 'captain and partner must be different participants';
  end if;

  select tournament_id into v_part_tournament from participants where id = p_new_partner_participant_id;
  if v_part_tournament is null then raise exception 'participant not found'; end if;
  if v_part_tournament <> v_team.tournament_id then
    raise exception 'participant belongs to a different tournament';
  end if;

  update teams set partner_participant_id = p_new_partner_participant_id,
                   invite_status = 'accepted'
   where id = p_team_id;

  insert into bracket_audit (tournament_id, changed_by, change_type, notes, snapshot)
       values (v_team.tournament_id, v_uid, 'edited',
               'replaced partner on team ' || p_team_id::text,
               jsonb_build_object('team_id', p_team_id,
                                  'previous_partner_id', v_team.partner_participant_id,
                                  'new_partner_id', p_new_partner_participant_id));
end;
$$;

-- ----- deadlines -----

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
  v_tournament_id uuid;
begin
  select tournament_id into v_tournament_id from matches where id = p_match_id;
  if not found then raise exception 'match not found'; end if;
  if not public.is_td_of_tournament(v_uid, v_tournament_id) then
    raise exception 'not authorized';
  end if;

  update matches set deadline_override = p_deadline where id = p_match_id;
end;
$$;

create or replace function public.td_set_round_deadline(
  p_tournament_id uuid,
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
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;

  if p_deadline is null then
    delete from tournament_round_deadlines where tournament_id = p_tournament_id and round = p_round;
  else
    insert into tournament_round_deadlines (tournament_id, round, deadline)
         values (p_tournament_id, p_round, p_deadline)
    on conflict (tournament_id, round) do update set deadline = excluded.deadline;
  end if;
end;
$$;

-- ----- draw generation -----

create or replace function public.generate_draw(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n int;
  v_size int;
  v_positions int[];
  v_entry_by_seed uuid[];
  v_seed int;
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
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from tournaments where id = p_tournament_id) then
    raise exception 'tournament not found';
  end if;

  select count(*) into v_existing_count from matches where tournament_id = p_tournament_id;
  if v_existing_count > 0 then
    raise exception 'this tournament already has a draw; use td_regenerate_draw to start over';
  end if;

  v_entry_by_seed := array(
    select id from entries
     where tournament_id = p_tournament_id and status = 'confirmed'
     order by seed nulls last, created_at
  );
  v_n := array_length(v_entry_by_seed, 1);
  if v_n is null or v_n < 2 then
    raise exception 'need at least 2 confirmed entries to generate a draw';
  end if;

  v_size := public.next_pow2(v_n);
  v_positions := public.seed_positions(v_size);
  v_max_round := (ln(v_size) / ln(2))::int;

  for v_seed in 1 .. v_n loop
    update entries set seed = v_seed where id = v_entry_by_seed[v_seed];
  end loop;

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

    insert into matches (tournament_id, bracket, round, slot, entry_a_id, entry_b_id, winner_entry_id, status)
         values (p_tournament_id, 'main', v_round, v_slot, v_entry_a, v_entry_b, v_winner, v_status);
  end loop;

  for v_round in 2 .. v_max_round loop
    v_matches_in_round := v_size / (2 ^ v_round)::int;
    for v_slot in 0 .. v_matches_in_round - 1 loop
      insert into matches (tournament_id, bracket, round, slot)
           values (p_tournament_id, 'main', v_round, v_slot);
    end loop;
  end loop;

  perform public.advance_winner(m.id)
     from matches m
    where m.tournament_id = p_tournament_id
      and m.bracket = 'main'
      and m.round = 1
      and m.status = 'confirmed';

  update tournaments set draw_status = 'seeded' where id = p_tournament_id;

  insert into bracket_audit (tournament_id, changed_by, change_type, notes, snapshot)
       values (p_tournament_id, v_uid, 'generated',
               'generated draw with ' || v_n || ' entries (bracket size ' || v_size || ')',
               jsonb_build_object('n', v_n, 'size', v_size));
end;
$$;

create or replace function public.publish_draw(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;

  update tournaments set draw_status = 'drawn'
   where id = p_tournament_id and draw_status = 'seeded';
  if not found then
    raise exception 'tournament draw must be in seeded status to publish';
  end if;

  insert into bracket_audit (tournament_id, changed_by, change_type, notes)
       values (p_tournament_id, v_uid, 'published', 'published draw');
end;
$$;

create or replace function public.td_regenerate_draw(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;

  delete from matches where tournament_id = p_tournament_id;
  update entries set seed = null where tournament_id = p_tournament_id;
  update tournaments set draw_status = 'open' where id = p_tournament_id;

  insert into bracket_audit (tournament_id, changed_by, change_type, notes)
       values (p_tournament_id, v_uid, 'regenerated', 'cleared matches and seeds');

  perform public.generate_draw(p_tournament_id);
end;
$$;

-- ----- score override -----

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
  select id, tournament_id, status, entry_a_id, entry_b_id, winner_entry_id,
         bracket, round
    into v_match
    from matches where id = p_match_id;
  if not found then raise exception 'match not found'; end if;
  if not public.is_td_of_tournament(v_uid, v_match.tournament_id) then
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

  if v_existing_winner is not null and v_existing_winner <> p_winner_entry_id then
    update matches
       set status = 'disputed'
     where tournament_id = v_match.tournament_id
       and bracket = v_match.bracket
       and round > v_match.round
       and (entry_a_id = v_existing_winner or entry_b_id = v_existing_winner)
       and status in ('reported', 'confirmed', 'overridden');
  end if;
end;
$$;

-- ----- views: my_pending_matches / td_managed_matches (now tournament-shaped) -----

create or replace function public.my_pending_matches()
returns table (
  match_id          uuid,
  tournament_id     uuid,
  tournament_name   text,
  round             smallint,
  opponent_label    text,
  match_status      match_status,
  deadline          timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  my_entries as (
    select e.id as entry_id
      from entries e
      join participants p on p.id = e.participant_id
     where p.user_id = (select uid from me) and e.status <> 'withdrawn'
    union
    select e.id as entry_id
      from entries e
      join teams t on t.id = e.team_id
      left join participants pc on pc.id = t.captain_participant_id
      left join participants pp on pp.id = t.partner_participant_id
     where ((pc.user_id = (select uid from me)) or (pp.user_id = (select uid from me)))
       and e.status <> 'withdrawn'
  ),
  my_matches as (
    select m.*
      from matches m
     where m.status in ('pending', 'reported', 'disputed')
       and m.entry_a_id is not null
       and m.entry_b_id is not null
       and (m.entry_a_id in (select entry_id from my_entries)
            or m.entry_b_id in (select entry_id from my_entries))
  )
  select m.id as match_id,
         t.id as tournament_id,
         t.name as tournament_name,
         m.round,
         coalesce(
           case when m.entry_a_id in (select entry_id from my_entries)
                then public.opponent_label(m.entry_b_id)
                else public.opponent_label(m.entry_a_id)
           end,
           'TBD'
         ) as opponent_label,
         m.status as match_status,
         coalesce(m.deadline_override, rd.deadline) as deadline
    from my_matches m
    join tournaments t on t.id = m.tournament_id
    left join tournament_round_deadlines rd
           on rd.tournament_id = t.id and rd.round = m.round
   order by t.start_date, t.name, m.round, m.slot;
$$;

create or replace function public.td_managed_matches()
returns table (
  match_id          uuid,
  tournament_id     uuid,
  tournament_name   text,
  round             smallint,
  side_a_label      text,
  side_b_label      text,
  match_status      match_status,
  deadline          timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  visible_tournaments as (
    select t.id, t.name, t.start_date
      from tournaments t
     where public.is_td_of_tournament((select uid from me), t.id)
  )
  select m.id            as match_id,
         t.id            as tournament_id,
         t.name          as tournament_name,
         m.round,
         public.opponent_label(m.entry_a_id) as side_a_label,
         public.opponent_label(m.entry_b_id) as side_b_label,
         m.status        as match_status,
         coalesce(m.deadline_override, rd.deadline) as deadline
    from matches m
    join visible_tournaments t on t.id = m.tournament_id
    left join tournament_round_deadlines rd
           on rd.tournament_id = t.id and rd.round = m.round
   where m.status in ('pending', 'reported', 'disputed')
     and m.entry_a_id is not null
     and m.entry_b_id is not null
   order by
     case m.status when 'disputed' then 0 when 'reported' then 1 else 2 end,
     t.start_date, t.name, m.round, m.slot;
$$;

-- ---------- RLS: enable on the renamed table; rewrite audit policies ----------

alter table tournament_round_deadlines enable row level security;

create policy tournament_round_deadlines_select_all
  on tournament_round_deadlines for select using (true);

create policy bracket_audit_select_td
  on bracket_audit for select using (
    public.is_td_of_tournament(auth.uid(), tournament_id)
  );

create policy score_audit_select_td
  on score_audit for select using (
    exists (
      select 1 from matches m
      where m.id = score_audit.match_id
        and public.is_td_of_tournament(auth.uid(), m.tournament_id)
    )
  );

-- ---------- grants ----------

grant execute on function public.register_for_tournament(uuid)                                                                             to authenticated;
grant execute on function public.register_team_for_tournament(uuid, text)                                                                  to authenticated;
grant execute on function public.td_enter_member(uuid, uuid, boolean)                                                                      to authenticated;
grant execute on function public.td_enter_guest(uuid, uuid, boolean)                                                                       to authenticated;
grant execute on function public.td_enter_team(uuid, uuid, uuid, boolean)                                                                  to authenticated;
grant execute on function public.td_enter_club_member(uuid, uuid, boolean)                                                                 to authenticated;
grant execute on function public.td_substitute_with_club_member(uuid, uuid, boolean)                                                       to authenticated;
grant execute on function public.td_withdraw_entry(uuid)                                                                                   to authenticated;
grant execute on function public.td_swap_entries(uuid, uuid)                                                                               to authenticated;
grant execute on function public.td_replace_participant(uuid, uuid)                                                                        to authenticated;
grant execute on function public.td_replace_team_partner(uuid, uuid)                                                                       to authenticated;
grant execute on function public.td_set_match_deadline(uuid, timestamptz)                                                                  to authenticated;
grant execute on function public.td_set_round_deadline(uuid, smallint, timestamptz)                                                        to authenticated;
grant execute on function public.generate_draw(uuid)                                                                                       to authenticated;
grant execute on function public.publish_draw(uuid)                                                                                        to authenticated;
grant execute on function public.td_regenerate_draw(uuid)                                                                                  to authenticated;
grant execute on function public.override_match_score(uuid, jsonb, uuid)                                                                   to authenticated;
grant execute on function public.my_pending_matches()                                                                                      to authenticated;
grant execute on function public.td_managed_matches()                                                                                      to authenticated;
grant execute on function public.td_create_tournament(text, text, date, date, timestamptz, division_kind, bracket_format, match_kind, final_set_format, smallint, smallint, smallint, boolean, smallint, smallint, timestamptz) to authenticated;
grant execute on function public.td_update_tournament(uuid, text, text, date, date, timestamptz, tournament_status, bracket_format, match_kind, final_set_format, smallint, smallint, smallint, boolean, smallint, smallint, timestamptz, draw_status) to authenticated;

revoke execute on function public.tournament_effective_deadline(uuid)                                                                      from public;
revoke execute on function public.assert_tournament_eligibility(uuid, uuid, boolean)                                                       from public;
revoke execute on function public.advance_winner(uuid)                                                                                     from public;

commit;
