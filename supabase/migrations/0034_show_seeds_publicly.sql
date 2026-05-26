-- Aspatuck Tournaments — let the TD choose whether seed numbers are visible
-- to players (or only to the TD).
--
-- The TD sometimes seeds strategically — e.g., placing two strong teams on
-- opposite sides of the draw — and doesn't want players to see "you're #7"
-- and take it personally. This flag controls whether the entries list and
-- bracket on the public tournament page show seed numbers; the Roster and
-- Draw pages are TD-only and always show seeds regardless. The default is
-- true so existing tournaments keep showing seeds, matching today's behavior.

begin;

alter table public.tournaments
  add column if not exists show_seeds_publicly boolean not null default true;

drop function if exists public.td_create_tournament(
  text, date, date, timestamptz,
  division_kind, bracket_format, match_kind, final_set_format,
  smallint, smallint, smallint, boolean, timestamptz
);

drop function if exists public.td_update_tournament(
  uuid, text, date, date, timestamptz, tournament_status,
  division_kind,
  bracket_format, match_kind, final_set_format,
  smallint, smallint, smallint,
  boolean, timestamptz, draw_status
);

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
  p_registration_deadline_override timestamptz,
  p_show_seeds_publicly boolean
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
    requires_dob, registration_deadline_override, show_seeds_publicly
  ) values (
    trim(p_name), p_start_date, p_end_date,
    p_registration_deadline, v_uid, 'draft',
    p_kind, p_bracket_format, p_match_kind, p_final_set_format,
    p_sets_to_win, p_games_per_set, p_tiebreak_at,
    p_requires_dob, p_registration_deadline_override,
    coalesce(p_show_seeds_publicly, true)
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
  p_kind division_kind,
  p_bracket_format bracket_format,
  p_match_kind match_kind,
  p_final_set_format final_set_format,
  p_sets_to_win smallint,
  p_games_per_set smallint,
  p_tiebreak_at smallint,
  p_requires_dob boolean,
  p_registration_deadline_override timestamptz,
  p_draw_status draw_status,
  p_show_seeds_publicly boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_current_kind division_kind;
  v_entry_count int;
begin
  if not public.is_td_of_tournament(v_uid, p_id) then
    raise exception 'not authorized';
  end if;
  if p_end_date < p_start_date then
    raise exception 'end date cannot be before start date';
  end if;

  select kind into v_current_kind from tournaments where id = p_id;
  if not found then
    raise exception 'tournament not found';
  end if;

  if v_current_kind is distinct from p_kind then
    select count(*) into v_entry_count
      from entries
     where tournament_id = p_id and status <> 'withdrawn';
    if v_entry_count > 0 then
      raise exception
        'cannot change tournament kind while % active entries exist; withdraw them first',
        v_entry_count;
    end if;
  end if;

  update tournaments
     set name = trim(p_name),
         start_date = p_start_date,
         end_date = p_end_date,
         registration_deadline = p_registration_deadline,
         status = p_status,
         kind = p_kind,
         bracket_format = p_bracket_format,
         match_kind = p_match_kind,
         final_set_format = p_final_set_format,
         sets_to_win = p_sets_to_win,
         games_per_set = p_games_per_set,
         tiebreak_at = p_tiebreak_at,
         requires_dob = p_requires_dob,
         registration_deadline_override = p_registration_deadline_override,
         draw_status = p_draw_status,
         show_seeds_publicly = coalesce(p_show_seeds_publicly, true)
   where id = p_id;
end;
$$;

grant execute on function public.td_create_tournament(
  text, date, date, timestamptz,
  division_kind, bracket_format, match_kind, final_set_format,
  smallint, smallint, smallint, boolean, timestamptz, boolean
) to authenticated;

grant execute on function public.td_update_tournament(
  uuid, text, date, date, timestamptz, tournament_status,
  division_kind,
  bracket_format, match_kind, final_set_format,
  smallint, smallint, smallint,
  boolean, timestamptz, draw_status, boolean
) to authenticated;

commit;
