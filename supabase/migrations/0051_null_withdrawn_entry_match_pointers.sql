-- 0051_null_withdrawn_entry_match_pointers.sql
--
-- One-off cleanup: matches should never reference a withdrawn entry in
-- entry_a_id, entry_b_id, or winner_entry_id. Today's withdraw flow
-- leaves the pointer in place and just flips the entry's status, which
-- breaks bye-detection (the bye-fill UI in draw/page.tsx looks for a
-- null on one side, so a slot whose other side points at a withdrawn
-- entry never appears as a fillable bye).
--
-- We hit this on Aspatuck Doubles slot 11 (R1 main): entry_a pointed
-- at a withdrawn Miller/Reiss team, entry_b held Park/Brown, status
-- was already 'confirmed' with winner=Park/Brown from the auto-advance.
-- After this migration the slot is properly recognised as Park/Brown's
-- bye and the new TD bye-fill flow can drop a team in.
--
-- Idempotent: only nulls pointers that currently violate the invariant,
-- so re-running on a clean database is a no-op.

update matches m
   set entry_a_id = null
  from entries e
 where m.entry_a_id = e.id
   and e.status = 'withdrawn';

update matches m
   set entry_b_id = null
  from entries e
 where m.entry_b_id = e.id
   and e.status = 'withdrawn';

update matches m
   set winner_entry_id = null
  from entries e
 where m.winner_entry_id = e.id
   and e.status = 'withdrawn';
