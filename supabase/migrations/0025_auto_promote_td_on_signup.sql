-- Aspatuck Tournaments — auto-promote pre-approved emails to tournament_director
--
-- Rodney Way and Sylvia Kodsi were named TDs before they had accounts. This
-- trigger upgrades the role on profile insert so their TD capability lights
-- up the moment they sign up. The whitelist lives in the function body — add
-- more emails here if the TD list grows.
--
-- A site_admin who somehow ends up on the list is left alone (handle_new_user
-- defaults role to 'player' anyway, so this is belt-and-suspenders).

create or replace function public.auto_promote_pre_approved_tds()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_td_emails text[] := array[
    'rodway71@icloud.com',
    'sylviakodsi@gmail.com'
  ];
begin
  if new.role = 'player' and lower(new.contact_email) = any (
    select lower(unnest(v_td_emails))
  ) then
    new.role := 'tournament_director';
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_auto_promote_td on profiles;
create trigger on_profile_auto_promote_td
  before insert on profiles
  for each row execute function public.auto_promote_pre_approved_tds();

-- Catch the case where one of them already has a profile (none do today, but
-- this keeps the migration correct if it's replayed against a different env).
update profiles
   set role = 'tournament_director'
 where role = 'player'
   and lower(contact_email) in (
     'rodway71@icloud.com',
     'sylviakodsi@gmail.com'
   );
