-- Aspatuck Tournaments — regenerate keeps TD-set seeds
--
-- The TD now sets seed numbers explicitly via td_set_entry_seeds. The previous
-- td_regenerate_draw cleared every entry's seed before calling generate_draw,
-- which discarded that input every time the TD regenerated. Drop the
-- seed-clearing line so generate_draw orders entries by the TD's seeds.

create or replace function public.td_regenerate_draw(p_tournament_id uuid)
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

  delete from matches where tournament_id = p_tournament_id;
  update tournaments set draw_status = 'open' where id = p_tournament_id;

  insert into bracket_audit (tournament_id, changed_by, change_type, notes)
       values (p_tournament_id, v_uid, 'regenerated', 'cleared matches; kept TD-set seeds');

  perform public.generate_draw(p_tournament_id);
end;
$$;
