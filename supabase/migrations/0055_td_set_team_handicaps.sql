-- Aspatuck Tournaments — bulk-set team handicaps.
--
-- Used by the Roster page's "Team handicaps" section so the TD can
-- set or update handicaps on already-paired teams (Calcutta or
-- otherwise) in a single submit. Pairing already has its own handicap
-- input (migration 0054); this RPC covers the after-the-fact case.
-- Modeled on td_set_entry_seeds: jsonb array of items, validate
-- everything before applying, and fail loudly on unknown teams.

begin;

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
  v_item jsonb;
  v_team_id uuid;
  v_hcp_text text;
  v_hcp int;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
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
    if v_hcp is not null and (v_hcp < 0 or v_hcp > 200) then
      raise exception 'handicap must be between 0 and 200';
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

grant execute on function public.td_set_team_handicaps(uuid, jsonb) to authenticated;

commit;
