-- Aspatuck Tournaments — first player to report finalizes the match.
--
-- Previously a report sat at status='reported' until the opponent either
-- confirmed it (→ confirmed, advance_winner) or contested it (→ disputed,
-- TD intervenes). In practice we don't want a second-player confirmation
-- step: the first credible report should advance the winner immediately
-- and let the TD clear/override if it turns out to be wrong.
--
-- This migration:
--   1. Rewrites report_match_score so the first report goes straight to
--      'confirmed' and advance_winner runs.
--   2. Backfills the same on every match currently sitting at 'reported':
--      flips the status to 'confirmed' and advances the winner so the
--      bracket retroactively reflects what was already known.
--
-- Disputed matches are left alone — only the TD can resolve those via
-- override_match_score / td_simple_score / td_clear_match_result.

begin;

create or replace function public.report_match_score(
  p_match_id uuid,
  p_sets jsonb,
  p_winner_entry_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_match record;
  v_inferred_winner uuid;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if not public.is_player_in_match(v_uid, p_match_id) then
    raise exception 'you are not a participant in this match';
  end if;

  select m.id, m.status, m.entry_a_id, m.entry_b_id
    into v_match
    from matches m where m.id = p_match_id;
  if not found then
    raise exception 'match not found';
  end if;
  if v_match.status <> 'pending' then
    raise exception 'this match has already been reported; ask the tournament director for a correction';
  end if;

  v_inferred_winner := public.validate_sets_payload(p_match_id, p_sets);
  if v_inferred_winner <> p_winner_entry_id then
    raise exception 'declared winner does not match the set scores';
  end if;
  if p_winner_entry_id not in (v_match.entry_a_id, v_match.entry_b_id) then
    raise exception 'winner must be a participant in the match';
  end if;

  perform public.replace_match_sets(p_match_id, p_sets);
  update matches
     set winner_entry_id = p_winner_entry_id,
         status = 'confirmed',
         reported_by = v_uid,
         reported_at = now()
   where id = p_match_id;
  insert into score_audit (match_id, changed_by, change_type, new_winner, new_sets)
       values (p_match_id, v_uid, 'confirmed', p_winner_entry_id, p_sets);
  perform public.advance_winner(p_match_id);
  return 'confirmed';
end;
$$;

-- Backfill: every match already at 'reported' has a winner_entry_id and
-- stored sets — just confirm it and advance the winner. Running
-- advance_winner is safe even if the next-round slot is already filled
-- (it would just overwrite with the same entry id, since there is no
-- alternate path that could have populated it).
do $$
declare
  r record;
begin
  for r in
    select id from matches where status = 'reported' and winner_entry_id is not null
  loop
    update matches set status = 'confirmed' where id = r.id;
    perform public.advance_winner(r.id);
  end loop;
end;
$$;

commit;
