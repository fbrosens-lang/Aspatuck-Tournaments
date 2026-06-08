-- Aspatuck Tournaments — let the public signup/forgot-password flows look up
-- where an email stands so they can route the user to the right next step
-- instead of guessing.
--
-- The existing public.signup_allowed_for_email (0039) only answers "is this
-- email on the club roster?" That's not enough: it doesn't distinguish
-- "no auth account yet" from "signed up but never confirmed the email" from
-- "fully set up." Without that, the signup form's "User already registered"
-- error and the forgot-password silent-success flow leave the user with no
-- usable path forward (the actual case that bit Michael Thaler 2026-06-06).
--
-- Returns one of four values:
--   not_on_roster — email isn't in club_members (TD must add them)
--   no_account    — on roster but no auth.users row yet (push to signup)
--   unconfirmed   — auth.users exists but email_confirmed_at is null (resend
--                   the confirmation email instead of the password reset)
--   confirmed     — fully set up (the normal signup/reset flow can proceed)
--
-- Account-enumeration note: roster membership is already discoverable via
-- signup_allowed_for_email (granted to anon since 0039), and this is a
-- closed-club site — exposing the auth-account state of a roster email is
-- not a meaningful additional leak. Granted to anon so the unauth signup
-- and forgot-password forms can call it before hitting GoTrue.

create or replace function public.account_status_for_email(p_email text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_on_roster boolean;
  v_user auth.users%rowtype;
begin
  select exists (
    select 1 from club_members where lower(email) = lower(p_email)
  ) into v_on_roster;
  if not v_on_roster then
    return 'not_on_roster';
  end if;
  select * into v_user from auth.users where lower(email) = lower(p_email) limit 1;
  if not found then
    return 'no_account';
  end if;
  if v_user.email_confirmed_at is null then
    return 'unconfirmed';
  end if;
  return 'confirmed';
end;
$$;

grant execute on function public.account_status_for_email(text) to anon, authenticated;
