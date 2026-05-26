-- Aspatuck Tournaments — allow TDs to delete an orphan auth account.
--
-- When the name-collision check (0037) wasn't in place, an accidental signup
-- with the wrong email could create a second profile that's not linked to
-- any directory entry. This RPC lets a TD clean those up after the fact.
--
-- Safety rules:
--   - Only TDs and site admins can call it.
--   - The TD cannot delete themselves (would orphan the current session and
--     could lock the club out of its own management UI).
--   - A TD cannot delete a site_admin. Only another site_admin can do that,
--     so that role escalation requires intent.
--   - The profile must not be linked to a club_members row. If it is, the TD
--     should unlink first via the existing td_unlink_club_member RPC. This
--     prevents accidentally nuking a real member's account just because they
--     have nothing else attached.
--
-- The delete cascades from auth.users → public.profiles (FK on delete
-- cascade) and from profiles → participants → entries / teams via the
-- existing foreign-key chain, so a deleted user leaves no dangling rows.

create or replace function public.td_delete_orphan_profile(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_target_role text;
  v_linked boolean;
begin
  if v_caller_id is null then
    raise exception 'authentication required';
  end if;
  if v_caller_id = p_user_id then
    raise exception 'you cannot delete your own account here';
  end if;

  select role into v_caller_role from profiles where id = v_caller_id;
  if v_caller_role not in ('tournament_director', 'site_admin') then
    raise exception 'only tournament directors or site admins can delete accounts';
  end if;

  select role into v_target_role from profiles where id = p_user_id;
  if v_target_role is null then
    raise exception 'no profile found for that account';
  end if;
  if v_target_role = 'site_admin' and v_caller_role <> 'site_admin' then
    raise exception 'only a site admin can delete a site admin';
  end if;

  select exists (
    select 1 from club_members where user_id = p_user_id
  ) into v_linked;
  if v_linked then
    raise exception 'this account is linked to a directory entry; unlink it before deleting';
  end if;

  delete from auth.users where id = p_user_id;
end;
$$;

grant execute on function public.td_delete_orphan_profile(uuid) to authenticated;
