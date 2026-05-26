-- Aspatuck Tournaments — allow TDs to change a tournament's kind
--
-- Adds p_kind to td_update_tournament so a misconfigured tournament (e.g.
-- "Aspatuck Doubles" accidentally created as singles) can be fixed without
-- recreating it. The kind field cannot change once entries exist: singles
-- entries reference participants.id, doubles entries reference teams.id, so
-- flipping the kind would orphan all current entries. We require the TD to
-- withdraw all entries first if they really want to change it.

begin;

drop function if exists public.td_update_tournament(
  uuid, text, date, date, timestamptz, tournament_status,
  bracket_format, match_kind, final_set_format,
  smallint, smallint, smallint,
  boolean, timestamptz, draw_status
);

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
  p_draw_status draw_status
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

  -- If the TD is changing kind, make sure there are no live entries to
  -- orphan. Withdrawn entries are fine — they stay in the table for history
  -- but don't reference participants/teams that would conflict with the new
  -- kind's expectations.
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
         draw_status = p_draw_status
   where id = p_id;
end;
$$;

grant execute on function public.td_update_tournament(
  uuid, text, date, date, timestamptz, tournament_status,
  division_kind,
  bracket_format, match_kind, final_set_format,
  smallint, smallint, smallint,
  boolean, timestamptz, draw_status
) to authenticated;

commit;
