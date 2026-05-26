-- Aspatuck Tournaments — prevent duplicate singles registration
--
-- A player was able to sign up twice for the same singles tournament by
-- double-clicking "Sign me up" (two requests raced past the UI's post-submit
-- re-render). Add a partial unique index so the DB rejects the second insert,
-- and a friendly pre-check inside register_for_tournament so the user sees a
-- clear error instead of a constraint-violation stack trace. Withdrawn
-- entries are excluded so a player who changed their mind can re-register.

-- One-time cleanup: any pre-existing duplicate registrations (the very bug
-- this migration prevents) would block the unique index below. For each
-- (tournament, participant) with multiple active entries, keep the oldest
-- and mark the rest as withdrawn so the audit trail is preserved.
with ranked as (
  select id,
         row_number() over (
           partition by tournament_id, participant_id
           order by created_at, id
         ) as rn
    from entries
   where participant_id is not null
     and status <> 'withdrawn'
)
update entries
   set status = 'withdrawn',
       withdrawn_at = coalesce(withdrawn_at, now())
 where id in (select id from ranked where rn > 1);

create unique index if not exists entries_singles_active_unique_idx
  on entries (tournament_id, participant_id)
  where participant_id is not null and status <> 'withdrawn';

create or replace function public.register_for_tournament(p_tournament_id uuid)
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
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select id, kind, draw_status into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'singles' then
    raise exception 'use register_team_for_tournament for doubles tournaments';
  end if;
  if v_t.draw_status <> 'open' then
    raise exception 'this tournament is no longer accepting registrations';
  end if;

  v_participant_id := public.ensure_member_participant(p_tournament_id, v_uid);
  perform public.assert_tournament_eligibility(p_tournament_id, v_participant_id, false);

  if exists (
    select 1 from entries
     where tournament_id = p_tournament_id
       and participant_id = v_participant_id
       and status <> 'withdrawn'
  ) then
    raise exception 'you are already registered for this tournament';
  end if;

  insert into entries (tournament_id, participant_id, status)
       values (p_tournament_id, v_participant_id, 'confirmed')
    returning id into v_entry_id;

  return v_entry_id;
end;
$$;
