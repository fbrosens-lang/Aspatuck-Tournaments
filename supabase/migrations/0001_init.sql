-- Aspatuck Tournaments — initial schema
-- See plan: /Users/frankbrosens/.claude/plans/i-want-to-make-floating-gadget.md

create extension if not exists pgcrypto;

-- ---------- enums ----------

create type profile_role          as enum ('player', 'tournament_director', 'site_admin');
create type tournament_status     as enum ('draft', 'open', 'closed', 'complete');
create type division_kind         as enum ('singles', 'doubles');
create type bracket_format        as enum ('single_elim', 'single_elim_consolation');
create type division_status       as enum ('open', 'seeded', 'drawn', 'in_progress', 'complete');
create type final_set_format      as enum ('standard', 'super_tb_10', 'super_tb_7', 'no_ad');
create type match_kind            as enum ('best_of_3', 'pro_set_8', 'pro_set_10');
create type participant_kind      as enum ('member', 'guest');
create type invite_status         as enum ('pending', 'accepted', 'declined');
create type entry_status          as enum ('pending', 'confirmed', 'waitlisted', 'withdrawn');
create type match_bracket         as enum ('main', 'consolation');
create type match_status          as enum ('pending', 'reported', 'confirmed', 'disputed', 'overridden');
create type bracket_audit_type    as enum ('generated', 'published', 'edited', 'regenerated');
create type score_audit_type      as enum ('reported', 'overridden', 'confirmed');

-- ---------- tables ----------

create table profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text not null,
  contact_email   text not null,
  date_of_birth   date,
  role            profile_role not null default 'player',
  created_at      timestamptz not null default now()
);

create index profiles_contact_email_lower_idx on profiles (lower(contact_email));

create table tournaments (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  location                 text,
  start_date               date not null,
  end_date                 date not null,
  registration_deadline    timestamptz,
  created_by               uuid not null references profiles(id),
  status                   tournament_status not null default 'draft',
  created_at               timestamptz not null default now(),
  check (end_date >= start_date)
);

create table tournament_directors (
  tournament_id   uuid not null references tournaments(id) on delete cascade,
  user_id         uuid not null references profiles(id)    on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (tournament_id, user_id)
);

create index tournament_directors_user_idx on tournament_directors (user_id);

create table divisions (
  id                                uuid primary key default gen_random_uuid(),
  tournament_id                     uuid not null references tournaments(id) on delete cascade,
  name                              text not null,
  kind                              division_kind not null,
  bracket_format                    bracket_format not null default 'single_elim',
  status                            division_status not null default 'open',
  sets_to_win                       smallint not null default 2,
  games_per_set                     smallint not null default 6,
  tiebreak_at                       smallint not null default 6,
  final_set_format                  final_set_format not null default 'super_tb_10',
  match_kind                        match_kind not null default 'best_of_3',
  requires_dob                      boolean not null default false,
  min_age                           smallint,
  max_age                           smallint,
  registration_deadline_override    timestamptz,
  created_at                        timestamptz not null default now(),
  check (sets_to_win in (1, 2, 3)),
  check (games_per_set in (4, 6, 8, 10)),
  check (tiebreak_at >= 0 and tiebreak_at <= games_per_set + 2),
  check (min_age is null or min_age >= 0),
  check (max_age is null or max_age >= 0),
  check (min_age is null or max_age is null or min_age <= max_age)
);

create index divisions_tournament_idx on divisions (tournament_id);

-- Participants unify "member" (linked to a profile/auth user) and "guest"
-- (TD-added, no account). Tournament-scoped so the same guest can appear in
-- multiple divisions of the same tournament without re-entry.
create table participants (
  id              uuid primary key default gen_random_uuid(),
  tournament_id   uuid not null references tournaments(id) on delete cascade,
  kind            participant_kind not null,
  user_id         uuid references profiles(id) on delete restrict,
  display_name    text not null,
  email           text,
  date_of_birth   date,
  created_by      uuid not null references profiles(id),
  created_at      timestamptz not null default now(),
  -- A member participant must reference a profile; a guest must not.
  check ((kind = 'member') = (user_id is not null)),
  -- Each member appears at most once per tournament.
  unique (tournament_id, user_id)
);

create index participants_tournament_idx on participants (tournament_id);
create index participants_email_lower_idx on participants (lower(email));

create table teams (
  id                       uuid primary key default gen_random_uuid(),
  division_id              uuid not null references divisions(id) on delete cascade,
  captain_participant_id   uuid not null references participants(id) on delete restrict,
  partner_participant_id   uuid references participants(id) on delete restrict,
  invite_status            invite_status not null default 'pending',
  created_at               timestamptz not null default now(),
  check (
    partner_participant_id is null
    or captain_participant_id <> partner_participant_id
  )
);

create index teams_division_idx on teams (division_id);

create table entries (
  id                uuid primary key default gen_random_uuid(),
  division_id       uuid not null references divisions(id) on delete cascade,
  participant_id    uuid references participants(id) on delete restrict,
  team_id           uuid references teams(id) on delete restrict,
  status            entry_status not null default 'confirmed',
  seed              smallint,
  withdrawn_at      timestamptz,
  added_by_td_id    uuid references profiles(id),
  created_at        timestamptz not null default now(),
  -- Polymorphic: exactly one of participant_id or team_id is set.
  check ((team_id is null) <> (participant_id is null))
);

create index entries_division_status_idx on entries (division_id, status);
create index entries_participant_idx     on entries (participant_id);
create index entries_team_idx            on entries (team_id);

create table matches (
  id                  uuid primary key default gen_random_uuid(),
  division_id         uuid not null references divisions(id) on delete cascade,
  bracket             match_bracket not null default 'main',
  round               smallint not null,
  slot                smallint not null,
  entry_a_id          uuid references entries(id) on delete set null,
  entry_b_id          uuid references entries(id) on delete set null,
  winner_entry_id     uuid references entries(id) on delete set null,
  status              match_status not null default 'pending',
  reported_by         uuid references profiles(id),
  reported_at         timestamptz,
  deadline_override   timestamptz,
  created_at          timestamptz not null default now(),
  unique (division_id, bracket, round, slot),
  check (round >= 1),
  check (slot >= 0)
);

create index matches_division_status_idx on matches (division_id, status);
create index matches_entry_a_idx         on matches (entry_a_id);
create index matches_entry_b_idx         on matches (entry_b_id);

create table division_round_deadlines (
  division_id   uuid not null references divisions(id) on delete cascade,
  round         smallint not null,
  deadline      timestamptz not null,
  created_at    timestamptz not null default now(),
  primary key (division_id, round),
  check (round >= 1)
);

create table match_sets (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references matches(id) on delete cascade,
  set_number    smallint not null,
  games_a       smallint not null,
  games_b       smallint not null,
  tiebreak_a    smallint,
  tiebreak_b    smallint,
  created_at    timestamptz not null default now(),
  unique (match_id, set_number),
  check (set_number >= 1),
  check (games_a >= 0 and games_b >= 0)
);

create table bracket_audit (
  id            uuid primary key default gen_random_uuid(),
  division_id   uuid not null references divisions(id) on delete cascade,
  changed_by    uuid not null references profiles(id),
  change_type   bracket_audit_type not null,
  notes         text,
  snapshot      jsonb,
  created_at    timestamptz not null default now()
);

create index bracket_audit_division_idx on bracket_audit (division_id, created_at desc);

create table score_audit (
  id                uuid primary key default gen_random_uuid(),
  match_id          uuid not null references matches(id) on delete cascade,
  changed_by        uuid not null references profiles(id),
  change_type       score_audit_type not null,
  previous_winner   uuid references entries(id),
  new_winner        uuid references entries(id),
  previous_sets     jsonb,
  new_sets          jsonb,
  created_at        timestamptz not null default now()
);

create index score_audit_match_idx on score_audit (match_id, created_at desc);

-- ---------- new-user trigger ----------

-- Auto-create a profile row when an auth.users row is inserted.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, contact_email)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      split_part(new.email, '@', 1)
    ),
    new.email
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
