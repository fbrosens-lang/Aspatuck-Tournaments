-- Aspatuck Tournaments — TD-side doubles team entry from the directory
--
-- Mirrors td_enter_club_member: pick two club_members, ensure participants
-- exist (member if they have an account, guest otherwise), and create the
-- team + entry as confirmed. Reuses the account-resolution from 0018 so that
-- partners with linked accounts come in as member kind, not guest.

create or replace function public.td_ensure_participant_from_club_member(
  p_tournament_id uuid,
  p_club_member_id uuid,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cm record;
  v_user_id uuid;
  v_participant_id uuid;
begin
  select full_name, email, date_of_birth, user_id
    into v_cm from club_members where id = p_club_member_id;
  if not found then raise exception 'club member not found'; end if;

  v_user_id := v_cm.user_id;
  if v_user_id is null then
    select id into v_user_id
      from profiles where lower(contact_email) = lower(v_cm.email);
    if v_user_id is not null then
      update club_members set user_id = v_user_id where id = p_club_member_id;
    end if;
  end if;

  select id into v_participant_id from participants
   where tournament_id = p_tournament_id and club_member_id = p_club_member_id;
  if v_participant_id is null and v_user_id is not null then
    select id into v_participant_id from participants
     where tournament_id = p_tournament_id and user_id = v_user_id;
  end if;
  if v_participant_id is null then
    insert into participants (
      tournament_id, kind, user_id, club_member_id,
      display_name, email, date_of_birth, created_by
    ) values (
      p_tournament_id,
      (case when v_user_id is not null then 'member' else 'guest' end)::participant_kind,
      v_user_id,
      p_club_member_id,
      v_cm.full_name,
      v_cm.email,
      v_cm.date_of_birth,
      p_created_by
    )
    returning id into v_participant_id;
  end if;

  return v_participant_id;
end;
$$;

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

  select kind into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'doubles' then
    raise exception 'this tournament is not doubles';
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

grant execute on function public.td_ensure_participant_from_club_member(uuid, uuid, uuid) to authenticated;
grant execute on function public.td_enter_team_from_club_members(uuid, uuid, uuid, boolean) to authenticated;
