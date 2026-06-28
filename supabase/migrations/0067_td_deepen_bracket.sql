-- 0067_td_deepen_bracket.sql
--
-- Adds td_deepen_bracket, a TD-only RPC that adds a new R1 of byes to
-- a fully populated bracket so the TD can drop a late team into one
-- of the new bye slots via the existing td_pair_team_into_bye_slot
-- flow. Solves the "last-minute team arrives, no byes available, no
-- non-destructive option" gap.
--
-- Mechanics:
--   * Every existing match shifts up one round (round := round + 1).
--     The slot math is preserved, so advance_winner edges (slot k
--     feeds R+1 slot k/2 side a/b) stay consistent.
--   * For each old R1 match (now at round=2), insert two new R1 bye
--     matches: slot 2k feeds R2 slot k entry_a, slot 2k+1 feeds entry_b.
--     Each bye carries the old entry as winner with status='confirmed'
--     so the existing entry is its own bye-winner — the bracket looks
--     identical until the TD fills one of the new byes.
--
-- Preconditions are deliberately strict:
--   * Draw exists (matches present).
--   * No match_sets rows anywhere — once a single set has been
--     reported, shifting rounds gets confusing fast.
--   * No withdrawn entries — withdraw_self / td_withdraw_entry can
--     leave walkover-confirmed matches where one side has a stale
--     winner pointer; shifting those produces inconsistent state in
--     the new R2. If withdrawals have happened, byes already exist
--     from the freed slots, so the TD should use bye-fill instead.
--   * No R1 byes currently available — if there's a bye to fill, no
--     reason to deepen.
--   * Only the main bracket is touched. No tournament uses the
--     consolation bracket today; refuse if consolation matches
--     somehow exist so the corruption isn't silent.

create or replace function public.td_deepen_bracket(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old record;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;

  if not exists (select 1 from tournaments where id = p_tournament_id) then
    raise exception 'tournament not found';
  end if;

  if not exists (
    select 1 from matches where tournament_id = p_tournament_id
  ) then
    raise exception 'no draw exists for this tournament — generate the draw first';
  end if;

  if exists (
    select 1
      from match_sets ms
      join matches m on m.id = ms.match_id
     where m.tournament_id = p_tournament_id
  ) then
    raise exception
      'cannot deepen the bracket after a match has been played — '
      'regenerate the draw to fit the new team instead';
  end if;

  if exists (
    select 1 from entries
     where tournament_id = p_tournament_id and status = 'withdrawn'
  ) then
    raise exception
      'cannot deepen the bracket after a withdrawal — fill the freed '
      'bye slots from the Draw page instead';
  end if;

  if exists (
    select 1 from matches
     where tournament_id = p_tournament_id
       and bracket = 'main'
       and round = 1
       and (entry_a_id is null or entry_b_id is null)
  ) then
    raise exception
      'bracket already has open bye slots — fill them on the Draw '
      'page instead of deepening';
  end if;

  if exists (
    select 1 from matches
     where tournament_id = p_tournament_id
       and bracket = 'consolation'
  ) then
    raise exception
      'this tournament has a consolation bracket — deepen is not '
      'supported for consolation brackets yet';
  end if;

  -- Lock the whole match set so a concurrent score report can't slip
  -- in between our checks and the shift.
  perform 1 from matches where tournament_id = p_tournament_id for update;

  -- Shift every match up by one round. Slot math is identical at every
  -- round, so existing advance_winner edges still walk to the right
  -- next-round slot.
  update matches set round = round + 1 where tournament_id = p_tournament_id;

  -- Insert the new R1 bye matches feeding what used to be R1.
  for v_old in
    select id, slot, entry_a_id, entry_b_id
      from matches
     where tournament_id = p_tournament_id
       and bracket = 'main'
       and round = 2
     order by slot
  loop
    -- slot 2k feeds new R2 (= old R1) slot k entry_a side.
    insert into matches (
      tournament_id, bracket, round, slot,
      entry_a_id, winner_entry_id, status
    ) values (
      p_tournament_id, 'main', 1, v_old.slot * 2,
      v_old.entry_a_id, v_old.entry_a_id,
      'confirmed'
    );

    -- slot 2k+1 feeds new R2 slot k entry_b side.
    insert into matches (
      tournament_id, bracket, round, slot,
      entry_a_id, winner_entry_id, status
    ) values (
      p_tournament_id, 'main', 1, v_old.slot * 2 + 1,
      v_old.entry_b_id, v_old.entry_b_id,
      'confirmed'
    );
  end loop;

  insert into bracket_audit (
    tournament_id, changed_by, change_type, notes, snapshot
  ) values (
    p_tournament_id, v_uid, 'edited',
    'deepened bracket: added play-in round',
    jsonb_build_object('action', 'deepen_bracket')
  );
end;
$$;

grant execute on function public.td_deepen_bracket(uuid) to authenticated;
