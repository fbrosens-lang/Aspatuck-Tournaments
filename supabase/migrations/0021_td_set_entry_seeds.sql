-- Aspatuck Tournaments — TD-side seed editing
--
-- The TD picks seed values (1, 2, 3, …) for entries before the draw runs.
-- generate_draw orders entries by `seed nulls last, created_at`, then renumbers
-- 1..N — so any seeds the TD assigns act as ranking hints that survive into
-- the bracket. After a draw is generated the TD can re-seed and regenerate to
-- shuffle the bracket.

create or replace function public.td_set_entry_seeds(
  p_tournament_id uuid,
  p_seeds jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_entry_id uuid;
  v_seed_text text;
  v_seed int;
  v_seen int[] := array[]::int[];
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;
  if p_seeds is null or jsonb_typeof(p_seeds) <> 'array' then
    raise exception 'p_seeds must be a JSON array';
  end if;

  -- Validate every item up front so a bad row aborts the whole batch.
  for v_item in select * from jsonb_array_elements(p_seeds) loop
    v_entry_id := nullif(v_item->>'entry_id', '')::uuid;
    v_seed_text := v_item->>'seed';
    v_seed := case when v_seed_text is null or v_seed_text = '' then null
                   else v_seed_text::int end;

    if v_entry_id is null then
      raise exception 'entry_id is required for each item';
    end if;
    if v_seed is not null and v_seed < 1 then
      raise exception 'seeds must be positive integers';
    end if;
    if v_seed is not null and v_seed = any(v_seen) then
      raise exception 'duplicate seed value: %', v_seed;
    end if;
    if v_seed is not null then
      v_seen := v_seen || v_seed;
    end if;

    if not exists (
      select 1 from entries
       where id = v_entry_id and tournament_id = p_tournament_id
    ) then
      raise exception 'entry % is not in this tournament', v_entry_id;
    end if;
  end loop;

  -- Apply.
  for v_item in select * from jsonb_array_elements(p_seeds) loop
    v_entry_id := (v_item->>'entry_id')::uuid;
    v_seed_text := v_item->>'seed';
    v_seed := case when v_seed_text is null or v_seed_text = '' then null
                   else v_seed_text::int end;
    update entries set seed = v_seed where id = v_entry_id;
  end loop;
end;
$$;

grant execute on function public.td_set_entry_seeds(uuid, jsonb) to authenticated;
