-- Aspatuck Tournaments — standard tournament-bracket seed placement
--
-- The previous seed_positions recursion always put the lower-numbered seed at
-- the top of every paired slot. That keeps seed 1 at row 1 but puts seed 2 in
-- the middle of the bracket (row N/2 + 1) instead of the very bottom.
--
-- Standard tournament practice puts seed 1 at the top and seed 2 at the very
-- bottom of the draw. To get that, we flip the pair every time we expand the
-- slot that already holds seed 2: seed 2 falls to the bottom row each round,
-- and stays there. Every other seed is expanded as before — higher seed on
-- top of its mini-bracket — which yields the canonical placements (e.g. for
-- a draw of 8: 1, 8, 4, 5, 3, 6, 7, 2).

create or replace function public.seed_positions(p_size int)
returns int[]
language plpgsql
immutable
as $$
declare
  v_positions int[];
  v_next int[];
  v_size int;
  v_p int;
begin
  if p_size = 1 then return array[1]; end if;
  if p_size < 2 or (p_size & (p_size - 1)) <> 0 then
    raise exception 'bracket size must be a power of 2 (got %)', p_size;
  end if;

  v_positions := array[1, 2];
  v_size := 2;
  while v_size < p_size loop
    v_size := v_size * 2;
    v_next := '{}'::int[];
    foreach v_p in array v_positions loop
      if v_p = 2 then
        -- Seed 2 always sits at the bottom of its mini-bracket, so it
        -- propagates all the way to the bottom of the final draw.
        v_next := v_next || (v_size + 1 - v_p);
        v_next := v_next || v_p;
      else
        v_next := v_next || v_p;
        v_next := v_next || (v_size + 1 - v_p);
      end if;
    end loop;
    v_positions := v_next;
  end loop;
  return v_positions;
end;
$$;
