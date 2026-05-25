-- Aspatuck Tournaments — tournament & division CRUD RPCs

create or replace function public.is_director_role(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
     where id = uid and role in ('tournament_director', 'site_admin')
  );
$$;

create or replace function public.td_create_tournament(
  p_name text,
  p_location text,
  p_start_date date,
  p_end_date date,
  p_registration_deadline timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if not public.is_director_role(v_uid) then
    raise exception 'only tournament directors or site admins may create tournaments';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'tournament name is required';
  end if;
  if p_end_date < p_start_date then
    raise exception 'end date cannot be before start date';
  end if;

  insert into tournaments (name, location, start_date, end_date, registration_deadline, created_by, status)
       values (trim(p_name), nullif(trim(p_location), ''), p_start_date, p_end_date, p_registration_deadline, v_uid, 'draft')
    returning id into v_id;

  insert into tournament_directors (tournament_id, user_id)
       values (v_id, v_uid)
  on conflict do nothing;

  return v_id;
end;
$$;

create or replace function public.td_update_tournament(
  p_id uuid,
  p_name text,
  p_location text,
  p_start_date date,
  p_end_date date,
  p_registration_deadline timestamptz,
  p_status tournament_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_td_of_tournament(v_uid, p_id) then
    raise exception 'not authorized';
  end if;
  if p_end_date < p_start_date then
    raise exception 'end date cannot be before start date';
  end if;

  update tournaments
     set name = trim(p_name),
         location = nullif(trim(p_location), ''),
         start_date = p_start_date,
         end_date = p_end_date,
         registration_deadline = p_registration_deadline,
         status = p_status
   where id = p_id;
end;
$$;

create or replace function public.td_create_division(
  p_tournament_id uuid,
  p_name text,
  p_kind division_kind,
  p_bracket_format bracket_format,
  p_match_kind match_kind,
  p_final_set_format final_set_format,
  p_sets_to_win smallint,
  p_games_per_set smallint,
  p_tiebreak_at smallint,
  p_requires_dob boolean,
  p_min_age smallint,
  p_max_age smallint,
  p_registration_deadline_override timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'division name is required';
  end if;

  insert into divisions (
    tournament_id, name, kind, bracket_format,
    match_kind, final_set_format, sets_to_win, games_per_set, tiebreak_at,
    requires_dob, min_age, max_age, registration_deadline_override
  ) values (
    p_tournament_id, trim(p_name), p_kind, p_bracket_format,
    p_match_kind, p_final_set_format, p_sets_to_win, p_games_per_set, p_tiebreak_at,
    p_requires_dob, p_min_age, p_max_age, p_registration_deadline_override
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.td_update_division(
  p_id uuid,
  p_name text,
  p_bracket_format bracket_format,
  p_match_kind match_kind,
  p_final_set_format final_set_format,
  p_sets_to_win smallint,
  p_games_per_set smallint,
  p_tiebreak_at smallint,
  p_requires_dob boolean,
  p_min_age smallint,
  p_max_age smallint,
  p_registration_deadline_override timestamptz,
  p_status division_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_td_of_division(v_uid, p_id) then
    raise exception 'not authorized';
  end if;

  update divisions
     set name = trim(p_name),
         bracket_format = p_bracket_format,
         match_kind = p_match_kind,
         final_set_format = p_final_set_format,
         sets_to_win = p_sets_to_win,
         games_per_set = p_games_per_set,
         tiebreak_at = p_tiebreak_at,
         requires_dob = p_requires_dob,
         min_age = p_min_age,
         max_age = p_max_age,
         registration_deadline_override = p_registration_deadline_override,
         status = p_status
   where id = p_id;
end;
$$;

create or replace function public.td_update_self_profile(
  p_full_name text,
  p_contact_email text,
  p_date_of_birth date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'full name is required';
  end if;
  if coalesce(trim(p_contact_email), '') = '' then
    raise exception 'contact email is required';
  end if;

  update profiles
     set full_name = trim(p_full_name),
         contact_email = trim(p_contact_email),
         date_of_birth = p_date_of_birth
   where id = v_uid;
end;
$$;

grant execute on function public.td_create_tournament(text, text, date, date, timestamptz)                                                                                              to authenticated;
grant execute on function public.td_update_tournament(uuid, text, text, date, date, timestamptz, tournament_status)                                                                     to authenticated;
grant execute on function public.td_create_division(uuid, text, division_kind, bracket_format, match_kind, final_set_format, smallint, smallint, smallint, boolean, smallint, smallint, timestamptz) to authenticated;
grant execute on function public.td_update_division(uuid, text, bracket_format, match_kind, final_set_format, smallint, smallint, smallint, boolean, smallint, smallint, timestamptz, division_status)                to authenticated;
grant execute on function public.td_update_self_profile(text, text, date)                                                                                                               to authenticated;

revoke execute on function public.is_director_role(uuid) from public;
