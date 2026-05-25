-- Aspatuck Tournaments — club-member RPCs

create or replace function public.td_create_club_member(
  p_full_name text,
  p_email text,
  p_date_of_birth date,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_user_id uuid;
begin
  if not public.is_director_role(v_uid) then
    raise exception 'only tournament directors or site admins may edit the club directory';
  end if;
  if coalesce(trim(p_full_name), '') = '' or coalesce(trim(p_email), '') = '' then
    raise exception 'name and email are required';
  end if;

  select id into v_user_id from profiles where lower(contact_email) = lower(trim(p_email));

  insert into club_members (full_name, email, date_of_birth, notes, user_id)
       values (trim(p_full_name), trim(p_email), p_date_of_birth, nullif(trim(p_notes), ''), v_user_id)
    returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.td_update_club_member(
  p_id uuid,
  p_full_name text,
  p_email text,
  p_date_of_birth date,
  p_notes text
)
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
  update club_members
     set full_name = trim(p_full_name),
         email = trim(p_email),
         date_of_birth = p_date_of_birth,
         notes = nullif(trim(p_notes), '')
   where id = p_id;
end;
$$;

create or replace function public.td_delete_club_member(p_id uuid)
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
  delete from club_members where id = p_id;
end;
$$;

-- Enter a club_member into a singles division. If the member has a linked
-- profile (user_id is set), they are added as kind='member'; otherwise as
-- kind='guest'. Either way, participants.club_member_id is set so the
-- provenance is recorded.
create or replace function public.td_enter_club_member(
  p_division_id uuid,
  p_club_member_id uuid,
  p_bypass_requirements boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_div record;
  v_cm record;
  v_participant_id uuid;
  v_entry_id uuid;
begin
  if not public.is_td_of_division(v_uid, p_division_id) then
    raise exception 'not authorized';
  end if;

  select tournament_id, kind, status into v_div from divisions where id = p_division_id;
  if not found then raise exception 'division not found'; end if;
  if v_div.kind <> 'singles' then
    raise exception 'club-member entry helper currently supports singles only';
  end if;

  select full_name, email, date_of_birth, user_id
    into v_cm from club_members where id = p_club_member_id;
  if not found then raise exception 'club member not found'; end if;

  -- Reuse an existing participant for this tournament if there is one.
  select id into v_participant_id from participants
   where tournament_id = v_div.tournament_id and club_member_id = p_club_member_id;
  if v_participant_id is null and v_cm.user_id is not null then
    select id into v_participant_id from participants
     where tournament_id = v_div.tournament_id and user_id = v_cm.user_id;
  end if;
  if v_participant_id is null then
    insert into participants (
      tournament_id, kind, user_id, club_member_id,
      display_name, email, date_of_birth, created_by
    ) values (
      v_div.tournament_id,
      case when v_cm.user_id is not null then 'member' else 'guest' end,
      v_cm.user_id,
      p_club_member_id,
      v_cm.full_name,
      v_cm.email,
      v_cm.date_of_birth,
      v_uid
    )
    returning id into v_participant_id;
  end if;

  perform public.assert_division_eligibility(p_division_id, v_participant_id, p_bypass_requirements);

  insert into entries (division_id, participant_id, status, added_by_td_id)
       values (p_division_id, v_participant_id, 'confirmed', v_uid)
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;

grant execute on function public.td_create_club_member(text, text, date, text)              to authenticated;
grant execute on function public.td_update_club_member(uuid, text, text, date, text)        to authenticated;
grant execute on function public.td_delete_club_member(uuid)                                to authenticated;
grant execute on function public.td_enter_club_member(uuid, uuid, boolean)                  to authenticated;
