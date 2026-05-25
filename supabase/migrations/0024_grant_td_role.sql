-- Aspatuck Tournaments — promote Rodney Way, Sylvia Kodsi, and Frank Brosens
-- to the tournament_director profile role.
--
-- Looks up each profile by case-insensitive contact_email. If a profile exists
-- and is currently 'player', it's upgraded to 'tournament_director'. Existing
-- site_admins are left alone (that role already covers TD authority via
-- is_td_of_tournament). Emails without a matching profile emit a NOTICE — the
-- person hasn't signed up yet, and the promotion has to happen after they do.

do $$
declare
  v_email text;
  v_emails text[] := array[
    'rodway71@icloud.com',
    'sylviakodsi@gmail.com',
    'FBrosens@taconiccap.com'
  ];
  v_pid uuid;
  v_role profile_role;
begin
  foreach v_email in array v_emails loop
    select id, role into v_pid, v_role
      from profiles
     where lower(contact_email) = lower(v_email)
     limit 1;

    if v_pid is null then
      raise notice 'no profile yet for %', v_email;
    elsif v_role = 'site_admin' then
      raise notice 'leaving % as site_admin', v_email;
    elsif v_role = 'tournament_director' then
      raise notice '% already tournament_director', v_email;
    else
      update profiles set role = 'tournament_director' where id = v_pid;
      raise notice 'promoted % to tournament_director', v_email;
    end if;
  end loop;
end$$;
