-- Aspatuck Tournaments — restrict the signup form to people on the club roster.
--
-- The previous check (signup_name_collides, migration 0037) rejected sign-ups
-- only when the chosen name matched an existing user under a different
-- email. That still let strangers create accounts, and it had a real-world
-- false negative: "Johnny Brosens" doesn't case-insensitive-equal "John
-- Brosens" by string comparison, so a near-miss name went through. The
-- club's policy is "only directory members can sign up; the TD adds the
-- directory entry first" — encoding that policy is simpler and tighter than
-- trying to catch name variations.
--
-- The new gate is purely on email: a signup is allowed only when the email
-- matches a club_members row (case-insensitive). The TD adds the member to
-- the directory; the member signs up with that exact email; the existing
-- link_club_members_to_profile trigger auto-links the new account to the
-- directory row.
--
-- Granted to `anon` so the public signup form can call it before
-- supabase.auth.signUp.

drop function if exists public.signup_name_collides(text, text);

create or replace function public.signup_allowed_for_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from club_members where lower(email) = lower(p_email)
  );
$$;

grant execute on function public.signup_allowed_for_email(text) to anon, authenticated;
