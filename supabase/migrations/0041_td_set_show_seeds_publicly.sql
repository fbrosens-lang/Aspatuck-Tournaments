-- Aspatuck Tournaments — focused RPC to toggle public seed visibility.
--
-- The general td_update_tournament RPC requires the TD to repost every field
-- on the tournament. For a one-off "show/hide seeds to players" toggle on
-- the Roster page, we want a single-purpose action that only touches the
-- one field. The DB column is the source of truth, so the toggle on /entries
-- and the checkbox on /manage stay in sync naturally.

create or replace function public.td_set_show_seeds_publicly(
  p_tournament_id uuid,
  p_show boolean
)
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
  update tournaments
     set show_seeds_publicly = p_show
   where id = p_tournament_id;
end;
$$;

grant execute on function public.td_set_show_seeds_publicly(uuid, boolean) to authenticated;
