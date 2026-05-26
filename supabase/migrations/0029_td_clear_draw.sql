-- Aspatuck Tournaments — TD can undo (clear) a generated draw
--
-- Existing td_regenerate_draw clears the bracket and rebuilds it in one step,
-- which is what you want after editing the roster. But if the TD hits
-- "Generate draw" by mistake, there's no path to "clear it and let players
-- sign up again" — regenerate just makes a new bracket immediately.
--
-- This adds td_clear_draw: same authorization, deletes matches, flips
-- draw_status back to 'open' so sign-ups reopen, and stops there. Entry seeds
-- are preserved (matching td_regenerate_draw's behavior since 0023) so the
-- TD's seed work isn't thrown away if they regenerate later.
--
-- bracket_audit.change_type is the existing enum (no new value needed); we
-- reuse 'regenerated' and put "cleared (undo)" in the notes column so the
-- audit log distinguishes this from a true regenerate.

create or replace function public.td_clear_draw(p_tournament_id uuid)
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

  delete from matches where tournament_id = p_tournament_id;
  update tournaments set draw_status = 'open' where id = p_tournament_id;

  insert into bracket_audit (tournament_id, changed_by, change_type, notes)
       values (p_tournament_id, v_uid, 'regenerated', 'cleared draw (undo); kept TD-set seeds');
end;
$$;

grant execute on function public.td_clear_draw(uuid) to authenticated;
