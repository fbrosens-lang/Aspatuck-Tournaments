-- Aspatuck Tournaments — stop the website inventing seed numbers
--
-- Today's generate_draw orders confirmed entries by (seed nulls last,
-- created_at), uses the resulting indices to place entries into bracket rows,
-- AND then writes sequential 1..N seed numbers back to every entry. That
-- second step means an entry the TD left unseeded ends up labeled with a seed
-- the website chose, based on signup order. The TD wants the opposite: only
-- entries the TD explicitly seeded should carry a seed number; the rest stay
-- blank.
--
-- This rewrite of generate_draw:
--   * places TD-seeded entries first, in seed order;
--   * places unseeded entries randomly into the remaining bracket slots
--     (the Roster page already advertises this — now it's actually true);
--   * does NOT overwrite entries.seed, so blanks remain blank.
--
-- It also adds td_clear_entry_seeds so the TD can wipe all seed numbers in
-- one click after withdrawals (or any other reason) without touching the
-- bracket. Audit row matches the existing pattern from td_clear_draw.

begin;

create or replace function public.generate_draw(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n int;
  v_size int;
  v_positions int[];
  v_entry_by_seed uuid[];
  v_round int;
  v_max_round int;
  v_matches_in_round int;
  v_slot int;
  v_row_a int;
  v_row_b int;
  v_entry_a uuid;
  v_entry_b uuid;
  v_status match_status;
  v_winner uuid;
  v_existing_count int;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from tournaments where id = p_tournament_id) then
    raise exception 'tournament not found';
  end if;

  select count(*) into v_existing_count from matches where tournament_id = p_tournament_id;
  if v_existing_count > 0 then
    raise exception 'this tournament already has a draw; use td_regenerate_draw to start over';
  end if;

  -- Seeded entries first (in seed order), then unseeded entries shuffled.
  -- The array index drives bracket position via seed_positions(); we no
  -- longer write the index back to entries.seed.
  v_entry_by_seed := array(
    (
      select id from entries
       where tournament_id = p_tournament_id
         and status = 'confirmed'
         and seed is not null
       order by seed
    )
    union all
    (
      select id from entries
       where tournament_id = p_tournament_id
         and status = 'confirmed'
         and seed is null
       order by random()
    )
  );
  v_n := array_length(v_entry_by_seed, 1);
  if v_n is null or v_n < 2 then
    raise exception 'need at least 2 confirmed entries to generate a draw';
  end if;

  v_size := public.next_pow2(v_n);
  v_positions := public.seed_positions(v_size);
  v_max_round := (ln(v_size) / ln(2))::int;

  v_round := 1;
  v_matches_in_round := v_size / 2;
  for v_slot in 0 .. v_matches_in_round - 1 loop
    v_row_a := v_slot * 2 + 1;
    v_row_b := v_slot * 2 + 2;
    v_entry_a := case when v_positions[v_row_a] <= v_n then v_entry_by_seed[v_positions[v_row_a]] else null end;
    v_entry_b := case when v_positions[v_row_b] <= v_n then v_entry_by_seed[v_positions[v_row_b]] else null end;

    v_status := 'pending';
    v_winner := null;
    if v_entry_a is not null and v_entry_b is null then
      v_status := 'confirmed';
      v_winner := v_entry_a;
    elsif v_entry_b is not null and v_entry_a is null then
      v_status := 'confirmed';
      v_winner := v_entry_b;
    end if;

    insert into matches (tournament_id, bracket, round, slot, entry_a_id, entry_b_id, winner_entry_id, status)
         values (p_tournament_id, 'main', v_round, v_slot, v_entry_a, v_entry_b, v_winner, v_status);
  end loop;

  for v_round in 2 .. v_max_round loop
    v_matches_in_round := v_size / (2 ^ v_round)::int;
    for v_slot in 0 .. v_matches_in_round - 1 loop
      insert into matches (tournament_id, bracket, round, slot)
           values (p_tournament_id, 'main', v_round, v_slot);
    end loop;
  end loop;

  perform public.advance_winner(m.id)
     from matches m
    where m.tournament_id = p_tournament_id
      and m.bracket = 'main'
      and m.round = 1
      and m.status = 'confirmed';

  update tournaments set draw_status = 'seeded' where id = p_tournament_id;

  insert into bracket_audit (tournament_id, changed_by, change_type, notes, snapshot)
       values (p_tournament_id, v_uid, 'generated',
               'generated draw with ' || v_n || ' entries (bracket size ' || v_size || ')',
               jsonb_build_object('n', v_n, 'size', v_size));
end;
$$;

create or replace function public.td_clear_entry_seeds(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from tournaments where id = p_tournament_id) then
    raise exception 'tournament not found';
  end if;

  update entries
     set seed = null
   where tournament_id = p_tournament_id
     and seed is not null;

  insert into bracket_audit (tournament_id, changed_by, change_type, notes)
       values (p_tournament_id, v_uid, 'regenerated', 'cleared all entry seeds');
end;
$$;

grant execute on function public.td_clear_entry_seeds(uuid) to authenticated;

commit;
