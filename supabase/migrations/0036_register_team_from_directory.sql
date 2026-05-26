-- Aspatuck Tournaments — self-service doubles signup from the club directory
--
-- The original register_team_for_tournament required the partner's email to
-- already exist in profiles, i.e. the partner had to have created an account.
-- This blocked a real use case: signing up with a club member who is on the
-- roster (in club_members) but hasn't signed up yet. This migration adds a
-- companion RPC that takes a club_members.id instead of an email and mirrors
-- the participant-resolution logic the TDs already use (member if linked,
-- guest otherwise).
--
-- It also extends the link_club_members_to_profile trigger so that when a
-- club_member is auto-linked to a freshly-signed-up profile, any guest
-- participants tied to that directory entry are promoted to member kind and
-- gain a user_id. That's what lets the new user see pending doubles invites
-- on their home page after signup.

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

  select id, kind, draw_status into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'doubles' then
    raise exception 'use register_for_tournament for singles tournaments';
  end if;
  if v_t.draw_status <> 'open' then
    raise exception 'this tournament is no longer accepting registrations';
  end if;

  select user_id, email into v_cm_user_id, v_cm_email
    from club_members where id = p_partner_club_member_id;
  if not found then
    raise exception 'partner not found in the club directory';
  end if;

  -- Lazy-link: if the directory row isn't linked yet but a matching profile
  -- exists, link it now (same logic 0018/0019 use for the TD-side flow).
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

  -- Reuses the TD-side helper: creates the partner participant as 'member'
  -- if the directory entry is linked to an account, or 'guest' if not.
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

grant execute on function public.register_team_from_directory(uuid, uuid) to authenticated;

-- Promote guest participants when their directory row gets linked to a new
-- account. This ensures the freshly-signed-up user immediately sees any
-- pending doubles invites that were created against them as a directory-only
-- entry (the home page query keys off participants.user_id).
create or replace function public.link_club_members_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update club_members
     set user_id = new.id
   where user_id is null
     and lower(email) = lower(new.contact_email);

  update participants p
     set user_id = new.id,
         kind = 'member'
    from club_members cm
   where p.club_member_id = cm.id
     and cm.user_id = new.id
     and p.user_id is null;

  return new;
end;
$$;
