-- Aspatuck Tournaments — fix club-member entry classifying linked accounts as guests
--
-- Before: td_enter_club_member chose participant kind ('member' vs 'guest')
-- solely from club_members.user_id. That column is populated by a trigger on
-- profile insert, so a directory row added AFTER signup (e.g. seed/bulk
-- migrations 0011 and 0017) could leave user_id null even when a matching
-- profile exists. Entering that person produced a guest participant.
--
-- After: the RPC re-resolves the profile by email if club_members.user_id is
-- null, opportunistically backfills the directory row, and creates the
-- participant as 'member' whenever an account exists. A defensive backfill at
-- the bottom links any still-unlinked rows.

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
  v_cm record;
  v_user_id uuid;
  v_participant_id uuid;
  v_entry_id uuid;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;

  select kind into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'singles' then
    raise exception 'club-member entry helper currently supports singles only';
  end if;

  select full_name, email, date_of_birth, user_id
    into v_cm from club_members where id = p_club_member_id;
  if not found then raise exception 'club member not found'; end if;

  v_user_id := v_cm.user_id;
  if v_user_id is null then
    select id into v_user_id
      from profiles
     where lower(contact_email) = lower(v_cm.email);
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
      v_uid
    )
    returning id into v_participant_id;
  end if;

  perform public.assert_tournament_eligibility(p_tournament_id, v_participant_id, p_bypass_requirements);

  insert into entries (tournament_id, participant_id, status, added_by_td_id)
       values (p_tournament_id, v_participant_id, 'confirmed', v_uid)
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;

-- Defensive backfill: link any unlinked club_members rows whose email already
-- matches an existing profile. Idempotent.
update club_members cm
   set user_id = p.id
  from profiles p
 where cm.user_id is null
   and lower(p.contact_email) = lower(cm.email);

-- One-time upgrade: existing guest participants that actually have a matching
-- profile (linked either through club_members.user_id we just backfilled, or
-- directly by email) get reclassified as members. Skip rows where the
-- tournament already has a member participant for that user_id to avoid
-- violating the (tournament_id, user_id) uniqueness constraint.
with candidates as (
  select pt.id as participant_id,
         coalesce(cm.user_id, prof.id) as resolved_user_id,
         pt.tournament_id
    from participants pt
    left join club_members cm on cm.id = pt.club_member_id
    left join profiles prof on lower(prof.contact_email) = lower(pt.email)
   where pt.kind = 'guest'
     and pt.user_id is null
     and (cm.user_id is not null or prof.id is not null)
)
update participants pt
   set kind = 'member'::participant_kind,
       user_id = c.resolved_user_id
  from candidates c
 where pt.id = c.participant_id
   and not exists (
     select 1 from participants other
      where other.tournament_id = c.tournament_id
        and other.user_id = c.resolved_user_id
   );
