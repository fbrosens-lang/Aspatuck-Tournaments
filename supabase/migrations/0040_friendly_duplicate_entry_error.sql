-- Aspatuck Tournaments — friendly error when the TD tries to enter someone
-- who's already in the roster.
--
-- The td_enter_* RPCs (member, club_member, guest) all `insert into entries`
-- without checking for an existing non-withdrawn row. The partial unique
-- index from migration 0035 (entries_singles_active_unique_idx) blocks the
-- duplicate, but the user sees the raw constraint-violation text — not
-- helpful and easy to mistake for "the previous add didn't work, let me try
-- again." Add the same pre-check pattern used in register_for_tournament
-- (migration 0035) so the message is something the TD can act on.

create or replace function public.td_enter_member(
  p_tournament_id uuid,
  p_user_id uuid,
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
  v_participant_id uuid;
  v_entry_id uuid;
  v_name text;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;

  select kind into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'singles' then
    raise exception 'use td_enter_team for doubles tournaments';
  end if;

  v_participant_id := public.ensure_member_participant(p_tournament_id, p_user_id);
  perform public.assert_tournament_eligibility(p_tournament_id, v_participant_id, p_bypass_requirements);

  if exists (
    select 1 from entries
     where tournament_id = p_tournament_id
       and participant_id = v_participant_id
       and status <> 'withdrawn'
  ) then
    select full_name into v_name from profiles where id = p_user_id;
    raise exception '% is already in the roster', coalesce(v_name, 'this player');
  end if;

  insert into entries (tournament_id, participant_id, status, added_by_td_id)
       values (p_tournament_id, v_participant_id, 'confirmed', v_uid)
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;

create or replace function public.td_enter_guest(
  p_tournament_id uuid,
  p_participant_id uuid,
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
  v_part record;
  v_entry_id uuid;
  v_name text;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;

  select kind into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'singles' then
    raise exception 'use td_enter_team for doubles tournaments';
  end if;

  select tournament_id, display_name into v_part
    from participants where id = p_participant_id;
  if not found then raise exception 'participant not found'; end if;
  if v_part.tournament_id <> p_tournament_id then
    raise exception 'participant belongs to a different tournament';
  end if;

  perform public.assert_tournament_eligibility(p_tournament_id, p_participant_id, p_bypass_requirements);

  if exists (
    select 1 from entries
     where tournament_id = p_tournament_id
       and participant_id = p_participant_id
       and status <> 'withdrawn'
  ) then
    raise exception '% is already in the roster', coalesce(v_part.display_name, 'this guest');
  end if;

  insert into entries (tournament_id, participant_id, status, added_by_td_id)
       values (p_tournament_id, p_participant_id, 'confirmed', v_uid)
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;

create or replace function public.td_enter_club_member(
  p_tournament_id uuid,
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
  v_t record;
  v_participant_id uuid;
  v_entry_id uuid;
  v_name text;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;

  select kind into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'singles' then
    raise exception 'use td_enter_team_from_club_members for doubles tournaments';
  end if;

  v_participant_id := public.td_ensure_participant_from_club_member(
    p_tournament_id, p_club_member_id, v_uid);
  perform public.assert_tournament_eligibility(p_tournament_id, v_participant_id, p_bypass_requirements);

  if exists (
    select 1 from entries
     where tournament_id = p_tournament_id
       and participant_id = v_participant_id
       and status <> 'withdrawn'
  ) then
    select full_name into v_name from club_members where id = p_club_member_id;
    raise exception '% is already in the roster', coalesce(v_name, 'this player');
  end if;

  insert into entries (tournament_id, participant_id, status, added_by_td_id)
       values (p_tournament_id, v_participant_id, 'confirmed', v_uid)
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;
