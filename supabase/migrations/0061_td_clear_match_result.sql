-- Aspatuck Tournaments — TD-only "clear match result" path.
--
-- Lets a TD undo a match result entirely, returning the match to
-- pending. Used when a result was entered on the wrong match and the
-- TD needs to re-do it without regenerating the entire draw.
--
-- Refuses if the downstream match has already been played; the TD has
-- to clear that one first. This avoids cascading deletes and keeps the
-- unwind predictable.

begin;
alter type score_audit_type add value if not exists 'reset';
commit;

begin;

create or replace function public.td_clear_match_result(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_match record;
  v_existing_sets jsonb;
  v_existing_winner uuid;
  v_next_match record;
begin
  select id, tournament_id, status, entry_a_id, entry_b_id, winner_entry_id,
         bracket, round, slot
    into v_match
    from matches where id = p_match_id;
  if not found then raise exception 'match not found'; end if;
  if not public.is_td_of_tournament(v_uid, v_match.tournament_id) then
    raise exception 'not authorized';
  end if;

  select id, winner_entry_id
    into v_next_match
    from matches
   where tournament_id = v_match.tournament_id
     and bracket = v_match.bracket
     and round = v_match.round + 1
     and slot = v_match.slot / 2;
  if found and v_next_match.winner_entry_id is not null then
    raise exception 'downstream match has been played - clear it first';
  end if;

  v_existing_winner := v_match.winner_entry_id;
  select coalesce(jsonb_agg(jsonb_build_object(
            'set_number', set_number,
            'games_a', games_a,
            'games_b', games_b,
            'tiebreak_a', tiebreak_a,
            'tiebreak_b', tiebreak_b
         ) order by set_number), '[]'::jsonb)
    into v_existing_sets
    from match_sets where match_id = p_match_id;

  if v_next_match.id is not null then
    if v_match.slot % 2 = 0 then
      update matches set entry_a_id = null where id = v_next_match.id;
    else
      update matches set entry_b_id = null where id = v_next_match.id;
    end if;
  end if;

  delete from match_sets where match_id = p_match_id;

  update matches
     set winner_entry_id = null,
         status = 'pending',
         reported_by = null,
         reported_at = null,
         score_summary = null
   where id = p_match_id;

  insert into score_audit (match_id, changed_by, change_type,
                           previous_winner, new_winner,
                           previous_sets, new_sets)
       values (p_match_id, v_uid, 'reset',
               v_existing_winner, null,
               v_existing_sets, '[]'::jsonb);
end;
$$;

grant execute on function public.td_clear_match_result(uuid) to authenticated;

commit;
