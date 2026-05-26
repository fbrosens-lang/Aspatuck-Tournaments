-- Aspatuck Tournaments — drop tournament min/max age enforcement.
-- TDs verify age eligibility themselves; the site no longer stores or checks it.

begin;

drop function if exists public.td_create_tournament(
  text, date, date, timestamptz,
  division_kind, bracket_format, match_kind, final_set_format,
  smallint, smallint, smallint,
  boolean, smallint, smallint, timestamptz
);

drop function if exists public.td_update_tournament(
  uuid, text, date, date, timestamptz, tournament_status,
  bracket_format, match_kind, final_set_format,
  smallint, smallint, smallint,
  boolean, smallint, smallint, timestamptz, draw_status
);

alter table public.tournaments drop column if exists min_age;
alter table public.tournaments drop column if exists max_age;

create or replace function public.td_create_tournament(
  p_name text,
  p_start_date date,
  p_end_date date,
  p_registration_deadline timestamptz,
  p_kind division_kind,
  p_bracket_format bracket_format,
  p_match_kind match_kind,
  p_final_set_format final_set_format,
  p_sets_to_win smallint,
  p_games_per_set smallint,
  p_tiebreak_at smallint,
  p_requires_dob boolean,
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

  insert into tournaments (
    name, start_date, end_date, registration_deadline, created_by, status,
    kind, bracket_format, match_kind, final_set_format,
    sets_to_win, games_per_set, tiebreak_at,
    requires_dob, registration_deadline_override
  ) values (
    trim(p_name), p_start_date, p_end_date,
    p_registration_deadline, v_uid, 'draft',
    p_kind, p_bracket_format, p_match_kind, p_final_set_format,
    p_sets_to_win, p_games_per_set, p_tiebreak_at,
    p_requires_dob, p_registration_deadline_override
  ) returning id into v_id;

  insert into tournament_directors (tournament_id, user_id)
       values (v_id, v_uid)
  on conflict do nothing;

  return v_id;
end;
$$;

create or replace function public.td_update_tournament(
  p_id uuid,
  p_name text,
  p_start_date date,
  p_end_date date,
  p_registration_deadline timestamptz,
  p_status tournament_status,
  p_bracket_format bracket_format,
  p_match_kind match_kind,
  p_final_set_format final_set_format,
  p_sets_to_win smallint,
  p_games_per_set smallint,
  p_tiebreak_at smallint,
  p_requires_dob boolean,
  p_registration_deadline_override timestamptz,
  p_draw_status draw_status
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
         start_date = p_start_date,
         end_date = p_end_date,
         registration_deadline = p_registration_deadline,
         status = p_status,
         bracket_format = p_bracket_format,
         match_kind = p_match_kind,
         final_set_format = p_final_set_format,
         sets_to_win = p_sets_to_win,
         games_per_set = p_games_per_set,
         tiebreak_at = p_tiebreak_at,
         requires_dob = p_requires_dob,
         registration_deadline_override = p_registration_deadline_override,
         draw_status = p_draw_status
   where id = p_id;
end;
$$;

create or replace function public.assert_tournament_eligibility(
  p_tournament_id uuid,
  p_participant_id uuid,
  p_bypass boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t record;
  v_part record;
  v_deadline timestamptz;
begin
  if p_bypass then return; end if;

  select requires_dob, start_date
    into v_t
    from tournaments
   where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;

  select date_of_birth into v_part
    from participants where id = p_participant_id;
  if not found then raise exception 'participant not found'; end if;

  v_deadline := public.tournament_effective_deadline(p_tournament_id);
  if v_deadline is not null and now() > v_deadline then
    raise exception 'registration deadline has passed';
  end if;

  if v_t.requires_dob and v_part.date_of_birth is null then
    raise exception 'this tournament requires a date of birth on the participant';
  end if;
end;
$$;

grant execute on function public.td_create_tournament(text, date, date, timestamptz, division_kind, bracket_format, match_kind, final_set_format, smallint, smallint, smallint, boolean, timestamptz) to authenticated;
grant execute on function public.td_update_tournament(uuid, text, date, date, timestamptz, tournament_status, bracket_format, match_kind, final_set_format, smallint, smallint, smallint, boolean, timestamptz, draw_status) to authenticated;

commit;
