-- Aspatuck Tournaments — reject signups that collide with an existing user's
-- name under a different email.
--
-- Previously, signing up with a never-before-seen email but the same full
-- name as someone already in the directory or in profiles would silently
-- create a second account, surface a duplicate "Gabriel Melamed" on the
-- members page, and log the new user in. That broke the club's mental model
-- (one person = one account) and let an accidental sign-up bypass any
-- intentional account.
--
-- The new RPC returns true when:
--   - the chosen full_name matches any directory entry OR profile, AND
--   - the chosen email is NOT already in the directory.
--
-- The "email already in the directory" escape hatch is what lets a brand-new
-- account hold the same name as someone already in the directory, when the
-- TD has explicitly added that second person with their own email. Without
-- it, two real people who share a name would be permanently stuck.
--
-- Granted to `anon` so the public signup form can call it before auth.signUp.

create or replace function public.signup_name_collides(
  p_full_name text,
  p_email text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      -- Whitelist: the email being signed up with matches a directory entry.
      -- The TD has explicitly added this email, so the signup is intended
      -- even if a same-name person exists elsewhere.
      when exists (
        select 1 from club_members
         where lower(email) = lower(p_email)
      ) then false
      else exists (
        select 1 from club_members
         where lower(full_name) = lower(p_full_name)
           and lower(email) <> lower(p_email)
        union all
        select 1 from profiles
         where lower(full_name) = lower(p_full_name)
           and lower(contact_email) <> lower(p_email)
      )
    end;
$$;

grant execute on function public.signup_name_collides(text, text) to anon, authenticated;
