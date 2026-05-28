-- Aspatuck Tournaments — explicit tournament listing order + seed the
-- Aspatuck Century and Aspatuck Calcutta tournaments.
--
-- Until now the home page and TD dashboard sorted by start_date DESC,
-- which left tournaments with the same start_date in a non-deterministic
-- order (e.g. Aspatuck Doubles vs Singles Open both on 2026-06-01).
-- This migration:
--   1. Adds a nullable display_order column so a TD can pin a specific
--      order on the listing pages (sort: display_order NULLS LAST,
--      then start_date DESC).
--   2. Renames "Aspatuck Singles Open" -> "Aspatuck Singles".
--   3. Seeds Aspatuck Century Tournament (doubles, manual combined-age
--      vetting by the TD — no schema rule yet) and Aspatuck Calcutta
--      (doubles + solo_only sign-up so the TD pairs by hat draw).
--      Both clone Aspatuck 50+'s dates, deadline, and TDs.
--   4. Sets the canonical 1..5 ordering Frank asked for.

alter table tournaments
  add column if not exists display_order int;

create index if not exists tournaments_display_order_idx
  on tournaments (display_order);

update tournaments
   set name = 'Aspatuck Singles'
 where name = 'Aspatuck Singles Open';

-- New tournaments. Cloning from Aspatuck 50+ keeps created_by, dates,
-- and registration_deadline consistent with the rest of the slate.
-- not-exists guards make this migration safely re-runnable in dev.
insert into tournaments (
  name, start_date, end_date, registration_deadline,
  created_by, status, kind, bracket_format, draw_status,
  sets_to_win, games_per_set, tiebreak_at,
  final_set_format, match_kind, requires_dob,
  show_seeds_publicly, solo_only
)
select
  'Aspatuck Century Tournament',
  start_date, end_date, registration_deadline,
  created_by, status, 'doubles'::division_kind, bracket_format, draw_status,
  sets_to_win, games_per_set, tiebreak_at,
  final_set_format, match_kind, requires_dob,
  show_seeds_publicly, false
from tournaments
where name = 'Aspatuck 50+'
  and not exists (
    select 1 from tournaments where name = 'Aspatuck Century Tournament'
  );

insert into tournaments (
  name, start_date, end_date, registration_deadline,
  created_by, status, kind, bracket_format, draw_status,
  sets_to_win, games_per_set, tiebreak_at,
  final_set_format, match_kind, requires_dob,
  show_seeds_publicly, solo_only
)
select
  'Aspatuck Calcutta',
  start_date, end_date, registration_deadline,
  created_by, status, 'doubles'::division_kind, bracket_format, draw_status,
  sets_to_win, games_per_set, tiebreak_at,
  final_set_format, match_kind, requires_dob,
  show_seeds_publicly, true
from tournaments
where name = 'Aspatuck 50+'
  and not exists (
    select 1 from tournaments where name = 'Aspatuck Calcutta'
  );

-- Copy Aspatuck 50+'s TD roster onto the two new tournaments so they're
-- manageable by the same people. on conflict do nothing makes this a
-- no-op if the same TDs are already linked (re-runs).
insert into tournament_directors (tournament_id, user_id)
select t.id, td.user_id
from tournaments t
cross join tournament_directors td
where t.name in ('Aspatuck Century Tournament', 'Aspatuck Calcutta')
  and td.tournament_id = (select id from tournaments where name = 'Aspatuck 50+')
on conflict (tournament_id, user_id) do nothing;

update tournaments set display_order = 1 where name = 'Aspatuck Singles';
update tournaments set display_order = 2 where name = 'Aspatuck Doubles';
update tournaments set display_order = 3 where name = 'Aspatuck 50+';
update tournaments set display_order = 4 where name = 'Aspatuck Century Tournament';
update tournaments set display_order = 5 where name = 'Aspatuck Calcutta';
