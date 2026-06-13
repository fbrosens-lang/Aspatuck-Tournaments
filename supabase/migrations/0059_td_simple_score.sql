-- Aspatuck Tournaments — TD-only free-text "simple score" path.
--
-- For matches whose result doesn't fit the tennis sets schema (golf
-- handicap match play "4&3", a single-set scratch event, a Calcutta
-- final scored on strokes, etc.) the TD writes the winner and a short
-- score blurb. This RPC skips set validation, clears any prior
-- match_sets rows, and otherwise mirrors override_match_score:
-- writes winner + status='overridden' + audit row + advance_winner +
-- "previous winner already advanced → downstream disputed" sweep.

begin;

alter table public.matches
  add column if not exists score_summary text;

create or replace function public.td_simple_score(
  p_match_id uuid,
  p_winner_entry_id uuid,
  p_summary text
)
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
  v_summary text;
begin
  select id, tournament_id, status, entry_a_id, entry_b_id, winner_entry_id,
         bracket, round
    into v_match
    from matches where id = p_match_id;
  if not found then raise exception 'match not found'; end if;
  if not public.is_td_of_tournament(v_uid, v_match.tournament_id) then
    raise exception 'not authorized';
  end if;
  if p_winner_entry_id is null then
    raise exception 'winner is required';
  end if;
  if p_winner_entry_id not in (v_match.entry_a_id, v_match.entry_b_id) then
    raise exception 'winner must be a participant in the match';
  end if;

  v_summary := nullif(btrim(coalesce(p_summary, '')), '');

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

  delete from match_sets where match_id = p_match_id;

  update matches
     set winner_entry_id = p_winner_entry_id,
         score_summary = v_summary,
         status = 'overridden',
         reported_by = v_uid,
         reported_at = now()
   where id = p_match_id;

  insert into score_audit (match_id, changed_by, change_type,
                           previous_winner, new_winner,
                           previous_sets, new_sets)
       values (p_match_id, v_uid, 'overridden',
               v_existing_winner, p_winner_entry_id,
               v_existing_sets, '[]'::jsonb);

  perform public.advance_winner(p_match_id);

  if v_existing_winner is not null and v_existing_winner <> p_winner_entry_id then
    update matches
       set status = 'disputed'
     where tournament_id = v_match.tournament_id
       and bracket = v_match.bracket
       and round > v_match.round
       and (entry_a_id = v_existing_winner or entry_b_id = v_existing_winner)
       and status in ('reported', 'confirmed', 'overridden');
  end if;
end;
$$;

grant execute on function public.td_simple_score(uuid, uuid, text) to authenticated;

commit;
