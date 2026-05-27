-- Aspatuck Tournaments — solo-only sign-up mode for Calcutta-style doubles
--
-- A Calcutta is a doubles tournament where the in-app job is just "a sign-up
-- roster": players can only sign up individually, and the TD then forms teams
-- by hat draw and runs the bracket entirely outside the app. We model this as
-- a boolean flag on the tournaments table rather than a new `kind` value to
-- keep the change surgical — the existing solo-doubles sign-up RPC (migration
-- 0045) handles the actual entries, and we just hide the partner/team flows
-- on the UI side and raise from the team-creation RPCs as defense in depth.

begin;

alter table public.tournaments
  add column if not exists solo_only boolean not null default false;

-- Solo-only is only meaningful for doubles tournaments (singles are inherently
-- one-per-entry). Naming the constraint makes it easy to migrate later if we
-- ever generalize.
alter table public.tournaments
  drop constraint if exists tournaments_solo_only_doubles_only;
alter table public.tournaments
  add constraint tournaments_solo_only_doubles_only
  check ((not solo_only) or (kind = 'doubles'));

-- td_create_tournament: add p_solo_only.
drop function if exists public.td_create_tournament(
  text, date, date, timestamptz,
  division_kind, bracket_format, match_kind, final_set_format,
  smallint, smallint, smallint, boolean, timestamptz, boolean
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
  p_show_seeds_publicly boolean,
  p_solo_only boolean default false
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
  if coalesce(p_solo_only, false) and p_kind <> 'doubles' then
    raise exception 'solo-only sign-ups are only supported for doubles tournaments';
  end if;

  insert into tournaments (
    name, start_date, end_date, registration_deadline, created_by, status,
    kind, bracket_format, match_kind, final_set_format,
    sets_to_win, games_per_set, tiebreak_at,
    requires_dob, registration_deadline_override, show_seeds_publicly,
    solo_only
  ) values (
    trim(p_name), p_start_date, p_end_date,
    p_registration_deadline, v_uid, 'draft',
    p_kind, p_bracket_format, p_match_kind, p_final_set_format,
    p_sets_to_win, p_games_per_set, p_tiebreak_at,
    p_requires_dob, p_registration_deadline_override,
    coalesce(p_show_seeds_publicly, true),
    coalesce(p_solo_only, false)
  ) returning id into v_id;

  insert into tournament_directors (tournament_id, user_id)
       values (v_id, v_uid)
  on conflict do nothing;

  return v_id;
end;
$$;

-- td_update_tournament: add p_solo_only.
drop function if exists public.td_update_tournament(
  uuid, text, date, date, timestamptz, tournament_status,
  division_kind,
  bracket_format, match_kind, final_set_format,
  smallint, smallint, smallint,
  boolean, timestamptz, draw_status, boolean
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
  p_draw_status draw_status,
  p_show_seeds_publicly boolean,
  p_solo_only boolean default false
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
  if coalesce(p_solo_only, false) and p_kind <> 'doubles' then
    raise exception 'solo-only sign-ups are only supported for doubles tournaments';
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
         show_seeds_publicly = coalesce(p_show_seeds_publicly, true),
         solo_only = coalesce(p_solo_only, false)
   where id = p_id;
end;
$$;

-- register_team_from_directory: refuse on solo-only tournaments. Signature is
-- unchanged, so a plain create-or-replace is sufficient.
create or replace function public.register_team_from_directory(
  p_tournament_id uuid,
  p_partner_club_member_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t record;
  v_cm_user_id uuid;
  v_cm_email text;
  v_captain_participant_id uuid;
  v_partner_participant_id uuid;
  v_team_id uuid;
  v_entry_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select id, kind, draw_status, solo_only into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'doubles' then
    raise exception 'use register_for_tournament for singles tournaments';
  end if;
  if v_t.solo_only then
    raise exception 'team sign-ups are disabled for this tournament — sign up solo instead';
  end if;
  if v_t.draw_status <> 'open' then
    raise exception 'this tournament is no longer accepting registrations';
  end if;

  select user_id, email into v_cm_user_id, v_cm_email
    from club_members where id = p_partner_club_member_id;
  if not found then
    raise exception 'partner not found in the club directory';
  end if;

  if v_cm_user_id is null then
    select id into v_cm_user_id
      from profiles where lower(contact_email) = lower(v_cm_email);
    if v_cm_user_id is not null then
      update club_members set user_id = v_cm_user_id where id = p_partner_club_member_id;
    end if;
  end if;

  if v_cm_user_id is not null and v_cm_user_id = v_uid then
    raise exception 'you cannot be your own doubles partner';
  end if;

  v_captain_participant_id := public.ensure_member_participant(p_tournament_id, v_uid);

  v_partner_participant_id := public.td_ensure_participant_from_club_member(
    p_tournament_id, p_partner_club_member_id, v_uid
  );

  perform public.assert_tournament_eligibility(p_tournament_id, v_captain_participant_id, false);
  perform public.assert_tournament_eligibility(p_tournament_id, v_partner_participant_id, false);

  insert into teams (tournament_id, captain_participant_id, partner_participant_id, invite_status)
       values (p_tournament_id, v_captain_participant_id, v_partner_participant_id, 'pending')
    returning id into v_team_id;

  insert into entries (tournament_id, team_id, status)
       values (p_tournament_id, v_team_id, 'pending')
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;

-- td_enter_team_from_club_members: refuse on solo-only tournaments. Signature
-- is unchanged.
create or replace function public.td_enter_team_from_club_members(
  p_tournament_id uuid,
  p_captain_club_member_id uuid,
  p_partner_club_member_id uuid,
  p_bypass_requirements boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t record;
  v_captain_pid uuid;
  v_partner_pid uuid;
  v_team_id uuid;
  v_entry_id uuid;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;
  if p_captain_club_member_id = p_partner_club_member_id then
    raise exception 'captain and partner must be different club members';
  end if;

  select kind, solo_only into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'doubles' then
    raise exception 'this tournament is not doubles';
  end if;
  if v_t.solo_only then
    raise exception 'team sign-ups are disabled for this tournament — sign up solo instead';
  end if;

  v_captain_pid := public.td_ensure_participant_from_club_member(
    p_tournament_id, p_captain_club_member_id, v_uid);
  v_partner_pid := public.td_ensure_participant_from_club_member(
    p_tournament_id, p_partner_club_member_id, v_uid);

  perform public.assert_tournament_eligibility(p_tournament_id, v_captain_pid, p_bypass_requirements);
  perform public.assert_tournament_eligibility(p_tournament_id, v_partner_pid, p_bypass_requirements);

  insert into teams (tournament_id, captain_participant_id, partner_participant_id, invite_status)
       values (p_tournament_id, v_captain_pid, v_partner_pid, 'accepted')
    returning id into v_team_id;

  insert into entries (tournament_id, team_id, status, added_by_td_id)
       values (p_tournament_id, v_team_id, 'confirmed', v_uid)
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;

grant execute on function public.td_create_tournament(
  text, date, date, timestamptz,
  division_kind, bracket_format, match_kind, final_set_format,
  smallint, smallint, smallint, boolean, timestamptz, boolean, boolean
) to authenticated;

grant execute on function public.td_update_tournament(
  uuid, text, date, date, timestamptz, tournament_status,
  division_kind,
  bracket_format, match_kind, final_set_format,
  smallint, smallint, smallint,
  boolean, timestamptz, draw_status, boolean, boolean
) to authenticated;

commit;
