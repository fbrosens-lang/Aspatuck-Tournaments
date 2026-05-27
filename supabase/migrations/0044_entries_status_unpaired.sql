-- 0044_entries_status_unpaired.sql
--
-- New entry status: 'unpaired'. Used for solo sign-ups in a doubles
-- tournament — the player is on the roster but hasn't been paired with
-- a partner yet, so they can't be drawn into the bracket. The TD pairs
-- them on the Roster page with another solo player to produce a real
-- confirmed team entry.
--
-- Kept in its own migration so the next file (0045) can reference
-- 'unpaired' from a fresh transaction. Postgres 12+ allows ALTER TYPE
-- ADD VALUE inside a transaction, but new values are not usable until
-- the transaction commits — splitting the file removes any ambiguity.

alter type entry_status add value if not exists 'unpaired';
