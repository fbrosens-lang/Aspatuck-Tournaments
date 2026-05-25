-- The CASE expression that picks 'member' vs 'guest' has text as its inferred
-- result type, and Postgres won't implicitly cast a non-literal text value to
-- the participant_kind enum on insert. Wrap the CASE in an explicit cast.

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
      (case when v_cm.user_id is not null then 'member' else 'guest' end)::participant_kind,
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

create or replace function public.td_substitute_with_club_member(
  p_entry_id uuid,
  p_club_member_id uuid,
  p_bypass_requirements boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_entry record;
  v_division record;
  v_cm record;
  v_participant_id uuid;
begin
  select division_id, participant_id, team_id into v_entry
    from entries where id = p_entry_id;
  if not found then raise exception 'entry not found'; end if;
  if v_entry.participant_id is null then
    raise exception 'this entry is a doubles team; use td_replace_team_partner instead';
  end if;

  select id, tournament_id into v_division
    from divisions where id = v_entry.division_id;
  if not public.is_td_of_division(v_uid, v_division.id) then
    raise exception 'not authorized';
  end if;

  select full_name, email, date_of_birth, user_id
    into v_cm from club_members where id = p_club_member_id;
  if not found then raise exception 'club member not found'; end if;

  select id into v_participant_id from participants
   where tournament_id = v_division.tournament_id and club_member_id = p_club_member_id;
  if v_participant_id is null and v_cm.user_id is not null then
    select id into v_participant_id from participants
     where tournament_id = v_division.tournament_id and user_id = v_cm.user_id;
  end if;
  if v_participant_id is null then
    insert into participants (
      tournament_id, kind, user_id, club_member_id,
      display_name, email, date_of_birth, created_by
    ) values (
      v_division.tournament_id,
      (case when v_cm.user_id is not null then 'member' else 'guest' end)::participant_kind,
      v_cm.user_id,
      p_club_member_id,
      v_cm.full_name,
      v_cm.email,
      v_cm.date_of_birth,
      v_uid
    )
    returning id into v_participant_id;
  end if;

  perform public.assert_division_eligibility(v_entry.division_id, v_participant_id, p_bypass_requirements);

  update entries set participant_id = v_participant_id where id = p_entry_id;

  insert into bracket_audit (division_id, changed_by, change_type, notes, snapshot)
       values (v_entry.division_id, v_uid, 'edited',
               'substituted club member into entry ' || p_entry_id::text,
               jsonb_build_object('entry_id', p_entry_id,
                                  'previous_participant_id', v_entry.participant_id,
                                  'new_participant_id', v_participant_id,
                                  'club_member_id', p_club_member_id));
end;
$$;
