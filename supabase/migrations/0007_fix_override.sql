-- Fix override_match_score: select the `bracket` and `round` columns so the
-- downstream cascade doesn't blow up with "record has no field" — and skip
-- the cascade entirely when there was no previous winner (i.e. the TD is
-- recording the first score on a still-pending match).

create or replace function public.override_match_score(
  p_match_id uuid,
  p_sets jsonb,
  p_winner_entry_id uuid
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
  v_inferred_winner uuid;
begin
  select id, division_id, status, entry_a_id, entry_b_id, winner_entry_id,
         bracket, round
    into v_match
    from matches where id = p_match_id;
  if not found then raise exception 'match not found'; end if;
  if not public.is_td_of_division(v_uid, v_match.division_id) then
    raise exception 'not authorized';
  end if;

  v_inferred_winner := public.validate_sets_payload(p_match_id, p_sets);
  if v_inferred_winner <> p_winner_entry_id then
    raise exception 'declared winner does not match the set scores';
  end if;
  if p_winner_entry_id not in (v_match.entry_a_id, v_match.entry_b_id) then
    raise exception 'winner must be a participant in the match';
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

  perform public.replace_match_sets(p_match_id, p_sets);
  update matches
     set winner_entry_id = p_winner_entry_id,
         status = 'overridden',
         reported_by = v_uid,
         reported_at = now()
   where id = p_match_id;

  insert into score_audit (match_id, changed_by, change_type,
                            previous_winner, new_winner,
                            previous_sets, new_sets)
       values (p_match_id, v_uid, 'overridden',
               v_existing_winner, p_winner_entry_id,
               v_existing_sets, p_sets);

  perform public.advance_winner(p_match_id);

  -- Only cascade-dispute when the previous winner had advanced into later
  -- rounds. A first-time score post (no previous winner, or unchanged
  -- winner) doesn't need to disrupt downstream slots.
  if v_existing_winner is not null and v_existing_winner <> p_winner_entry_id then
    update matches
       set status = 'disputed'
     where division_id = v_match.division_id
       and bracket = v_match.bracket
       and round > v_match.round
       and (entry_a_id = v_existing_winner or entry_b_id = v_existing_winner)
       and status in ('reported', 'confirmed', 'overridden');
  end if;
end;
$$;
