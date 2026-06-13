-- Aspatuck Tournaments — restrict team handicap writes to Calcutta.
--
-- The handicap column was added for solo_only doubles (Calcutta) but
-- both write RPCs accepted handicap on any doubles tournament. The TD
-- wants handicaps to be a Calcutta-only concept, so both RPCs now
-- reject non-zero/non-null handicaps when the tournament isn't
-- solo_only. The teams.handicap column stays nullable on every team
-- so legacy rows or accidentally-set values don't trigger constraint
-- errors; the UI hides display for non-Calcutta tournaments
-- separately.

begin;

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
  v_hcp smallint;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;

  select id, kind, draw_status, solo_only
    into v_t from tournaments where id = p_tournament_id;
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

  -- Handicaps are a Calcutta-only concept. Drop the value silently on
  -- non-Calcutta pairings so old clients that still send the column
  -- don't fail; deliberate use is gated by the UI.
  v_hcp := case when v_t.solo_only then p_handicap else null end;
  if v_hcp is not null and (v_hcp < -40 or v_hcp > 40) then
    raise exception 'handicap must be between -40 and 40';
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
    'accepted', v_hcp
  ) returning id into v_team_id;

  insert into entries (tournament_id, team_id, status, added_by_td_id)
       values (p_tournament_id, v_team_id, 'confirmed', v_uid)
    returning id into v_entry_id;

  delete from entries where id in (p_entry_a_id, p_entry_b_id);

  return v_entry_id;
end;
$$;

create or replace function public.td_set_team_handicaps(
  p_tournament_id uuid,
  p_handicaps jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t record;
  v_item jsonb;
  v_team_id uuid;
  v_hcp_text text;
  v_hcp int;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;

  select kind, solo_only into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'doubles' or not v_t.solo_only then
    raise exception 'team handicaps are only used in Calcutta-style tournaments';
  end if;

  if p_handicaps is null or jsonb_typeof(p_handicaps) <> 'array' then
    raise exception 'p_handicaps must be a JSON array';
  end if;

  for v_item in select * from jsonb_array_elements(p_handicaps) loop
    v_team_id := nullif(v_item->>'team_id', '')::uuid;
    v_hcp_text := v_item->>'handicap';
    v_hcp := case
               when v_hcp_text is null or v_hcp_text = '' then null
               else v_hcp_text::int
             end;

    if v_team_id is null then
      raise exception 'team_id is required for each item';
    end if;
    if v_hcp is not null and (v_hcp < -40 or v_hcp > 40) then
      raise exception 'handicap must be between -40 and 40';
    end if;

    update teams
       set handicap = v_hcp
     where id = v_team_id
       and tournament_id = p_tournament_id;
    if not found then
      raise exception 'team % not found in this tournament', v_team_id;
    end if;
  end loop;
end;
$$;

commit;
