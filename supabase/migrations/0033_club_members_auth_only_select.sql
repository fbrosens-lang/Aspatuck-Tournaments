-- Aspatuck Tournaments — restrict club directory reads to signed-in users
--
-- Migration 0010 created the directory with a SELECT-open-to-anon policy
-- because the original threat model didn't treat names/emails as private.
-- Member feedback shifted that: a logged-out visitor (including search
-- crawlers using the anon key against the REST endpoint) should not be able
-- to see the roster. Page-level redirects alone aren't enough — Supabase's
-- REST endpoint serves whatever RLS permits.
--
-- Switch the SELECT policy from `using (true)` to require an authenticated
-- role. INSERT/UPDATE were never RLS-open (they go through SECURITY DEFINER
-- RPCs) so this is the only policy to change.

drop policy if exists club_members_select_all on club_members;

create policy club_members_select_authenticated
  on club_members for select
  to authenticated
  using (true);
