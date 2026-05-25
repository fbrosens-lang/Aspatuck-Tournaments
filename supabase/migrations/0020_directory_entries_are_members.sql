-- Aspatuck Tournaments — directory entries always become member participants
--
-- Before: when a TD entered someone from the club directory, the participant
-- kind was 'member' only if the directory row was already linked to an
-- account; otherwise the participant was created as 'guest'. The original
-- CHECK constraint ((kind = 'member') = (user_id is not null)) enforced that
-- a member must have a profile.
--
-- After: being in the Aspatuck directory is itself enough to count as a
-- member. Guests are reserved for people the TD adds via the Participants
-- page (no profile, no directory row). The CHECK constraint is relaxed so a
-- member participant must have either a profile (user_id) or a directory row
-- (club_member_id); a guest must have neither.

-- 1) Drop the old member/user_id check constraint. Its name is auto-generated
--    so we look it up by definition.
do $$
declare
  v_conname text;
begin
  select conname into v_conname
    from pg_constraint
   where conrelid = 'public.participants'::regclass
     and contype  = 'c'
     and pg_get_constraintdef(oid) ilike '%kind%user_id%';
  if v_conname is not null then
    execute format('alter table public.participants drop constraint %I', v_conname);
  end if;
end$$;

-- 2) Backfill before adding the new constraint: existing guest participants
--    that came in from the directory (have a club_member_id) get reclassified
--    as members so they satisfy the new constraint. Idempotent.
update public.participants
   set kind = 'member'::participant_kind
 where kind = 'guest'
   and club_member_id is not null;

-- 3) New constraint: member iff has account or directory row; guest iff neither.
alter table public.participants
  add constraint participants_kind_matches_links
  check (
    (kind = 'member' and (user_id is not null or club_member_id is not null))
    or
    (kind = 'guest'  and user_id is null and club_member_id is null)
  );

-- 4) Update td_enter_club_member: directory entries are always members now.
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
      'member'::participant_kind,
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

-- 5) Same change for the doubles helper.
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
      'member'::participant_kind,
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

