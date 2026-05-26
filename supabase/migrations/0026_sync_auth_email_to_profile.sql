-- Aspatuck Tournaments — keep profiles.contact_email in sync with auth.users.email
--
-- Users can change their login email from the profile page via
-- supabase.auth.updateUser({ email }). Supabase only flips auth.users.email
-- *after* the user clicks the confirmation link sent to the new address, so
-- this trigger fires exactly when the change is confirmed-and-applied. We
-- mirror the new value into profiles.contact_email because many parts of the
-- system look up users by contact_email (club_members joins, partner lookups
-- in 0003_rpcs / 0016_eliminate_divisions, TD auto-promotion in 0025).

create or replace function public.sync_auth_email_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
       set contact_email = new.email
     where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_change on auth.users;
create trigger on_auth_user_email_change
  after update of email on auth.users
  for each row execute function public.sync_auth_email_to_profile();
