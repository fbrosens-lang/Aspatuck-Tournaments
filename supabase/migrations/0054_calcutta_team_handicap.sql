-- Aspatuck Tournaments — per-team handicap for Calcutta pairings.
--
-- The TD enters a handicap when pairing two unpaired solos into a
-- confirmed team. Storing the value on `teams` (not `entries`) keeps
-- the handicap tied to the team identity rather than the entry's
-- lifecycle, so withdrawing and re-entering doesn't quietly lose it.
--
-- Only the solo-pair flow populates the column today. Regular doubles
-- entries (register_team_from_directory, td_enter_team_from_club_members,
-- fill-bye-with-team) leave it null. The column is nullable so existing
-- teams don't need a backfill.

begin;

alter table public.teams
  add column if not exists handicap smallint;

alter table public.teams
  drop constraint if exists teams_handicap_range;
alter table public.teams
  add constraint teams_handicap_range
  check (handicap is null or handicap between 0 and 200);

-- Extend td_pair_solo_entries with a nullable p_handicap argument. The
-- previous 3-arg signature from migration 0045 has to be dropped
-- explicitly — adding the defaulted parameter would otherwise leave
-- two overloads and PostgREST can't disambiguate.
drop function if exists public.td_pair_solo_entries(uuid, uuid, uuid);

create or replace function public.td_pair_solo_entries(
  p_tournament_id uuid,
  p_entry_a_id uuid,
  p_entry_b_id uuid,
  p_handicap smallint default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t record;
  v_a record;
  v_b record;
  v_team_id uuid;
  v_entry_id uuid;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;

  select id, kind, draw_status into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'doubles' then
    raise exception 'pairing is only for doubles tournaments';
  end if;
  if v_t.draw_status <> 'open' then
    raise exception 'pairing must happen before the draw is generated';
  end if;

  if p_entry_a_id = p_entry_b_id then
    raise exception 'pick two different players';
  end if;

  if p_handicap is not null and (p_handicap < 0 or p_handicap > 200) then
    raise exception 'handicap must be between 0 and 200';
  end if;

  select id, tournament_id, participant_id, team_id, status
    into v_a
    from entries where id = p_entry_a_id
    for update;
  if not found or v_a.tournament_id <> p_tournament_id then
    raise exception 'first entry not found in this tournament';
  end if;
  if v_a.status <> 'unpaired' or v_a.participant_id is null or v_a.team_id is not null then
    raise exception 'first entry is not an unpaired solo';
  end if;

  select id, tournament_id, participant_id, team_id, status
    into v_b
    from entries where id = p_entry_b_id
    for update;
  if not found or v_b.tournament_id <> p_tournament_id then
    raise exception 'second entry not found in this tournament';
  end if;
  if v_b.status <> 'unpaired' or v_b.participant_id is null or v_b.team_id is not null then
    raise exception 'second entry is not an unpaired solo';
  end if;

  insert into teams (
    tournament_id, captain_participant_id, partner_participant_id,
    invite_status, handicap
  ) values (
    p_tournament_id, v_a.participant_id, v_b.participant_id,
    'accepted', p_handicap
  ) returning id into v_team_id;

  insert into entries (tournament_id, team_id, status, added_by_td_id)
       values (p_tournament_id, v_team_id, 'confirmed', v_uid)
    returning id into v_entry_id;

  delete from entries where id in (p_entry_a_id, p_entry_b_id);

  return v_entry_id;
end;
$$;

grant execute on function public.td_pair_solo_entries(uuid, uuid, uuid, smallint)
  to authenticated;

commit;
