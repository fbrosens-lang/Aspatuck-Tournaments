-- Aspatuck Tournaments — TD manual link/unlink between directory and accounts.
--
-- The auto-link trigger from 0010 only fires when a new profile's email
-- exactly matches a club_members row. That doesn't help when a member signs
-- up with a different email than the one the TD recorded — they stay as two
-- separate identities until someone manually fixes it.
--
-- These two RPCs give the TD that fix. Linking also runs the same
-- guest→member participant upgrade as migration 0018, so existing entries
-- from the directory pre-signup get reclassified as 'member' once linked.
-- Unlinking only clears the directory's user_id; participant rows are left
-- alone (they keep their user_id and kind from whenever they were created).

begin;

create or replace function public.td_link_club_member_to_profile(
  p_club_member_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing_link_cm_id uuid;
begin
  if not public.is_director_role(v_uid) then
    raise exception 'only tournament directors or site admins may edit the club directory';
  end if;

  if not exists (select 1 from club_members where id = p_club_member_id) then
    raise exception 'club member not found';
  end if;
  if not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'profile not found';
  end if;

  -- One account can only be linked to one directory row at a time. If the
  -- account is already linked elsewhere, the TD needs to unlink that first.
  select id into v_existing_link_cm_id
    from club_members
   where user_id = p_user_id and id <> p_club_member_id;
  if v_existing_link_cm_id is not null then
    raise exception
      'this account is already linked to another directory entry; unlink it first';
  end if;

  update club_members set user_id = p_user_id where id = p_club_member_id;

  -- Reclassify any guest participants for this person (entered as a club
  -- member back when no account existed) to 'member', wiring up their
  -- user_id. Skip rows where the tournament already has a member participant
  -- for that user_id to avoid violating uniqueness constraints.
  with candidates as (
    select pt.id as participant_id, pt.tournament_id
      from participants pt
     where pt.club_member_id = p_club_member_id
       and pt.kind = 'guest'
       and pt.user_id is null
  )
  update participants pt
     set kind = 'member'::participant_kind,
         user_id = p_user_id
    from candidates c
   where pt.id = c.participant_id
     and not exists (
       select 1 from participants other
        where other.tournament_id = c.tournament_id
          and other.user_id = p_user_id
     );
end;
$$;

create or replace function public.td_unlink_club_member(p_club_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_director_role(v_uid) then
    raise exception 'only tournament directors or site admins may edit the club directory';
  end if;
  if not exists (select 1 from club_members where id = p_club_member_id) then
    raise exception 'club member not found';
  end if;

  update club_members set user_id = null where id = p_club_member_id;
end;
$$;

grant execute on function public.td_link_club_member_to_profile(uuid, uuid) to authenticated;
grant execute on function public.td_unlink_club_member(uuid)                to authenticated;

commit;
