-- 0043_td_add_player_to_bye_slot.sql
--
-- Lets a TD insert a new player into an existing first-round bye slot
-- without regenerating the draw. The original bye winner — who would
-- have advanced for free — now has to play this new first-round match.
--
-- Bye representation recap (see 0001_init.sql + generate_draw):
--   • A bye is a first-round match row with one of entry_a_id /
--     entry_b_id set and the other NULL.
--   • generate_draw sets status='confirmed' and winner_entry_id to the
--     populated side, then calls advance_winner which writes the bye
--     winner into the next-round match's entry_a or entry_b slot
--     (slot k feeds R2 slot k/2 on side 'a' for even k, 'b' for odd k).
--
-- To "fill" a bye we reverse the auto-advance on R2 and turn the R1
-- match into a real pending match between the original bye winner and
-- the newly added player. If the R2 match has already been played
-- (status != 'pending'), we refuse — the TD can withdraw + regenerate
-- in that case, which is the destructive escape hatch they already had.

create or replace function public.td_add_player_to_bye_slot(
  p_tournament_id uuid,
  p_club_member_id uuid,
  p_match_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t record;
  v_match record;
  v_participant_id uuid;
  v_entry_id uuid;
  v_bye_winner_id uuid;
  v_next_round smallint;
  v_next_slot smallint;
  v_next_side text;
  v_next_match record;
  v_name text;
begin
  if not public.is_td_of_tournament(v_uid, p_tournament_id) then
    raise exception 'not authorized';
  end if;

  select kind into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament not found'; end if;
  if v_t.kind <> 'singles' then
    -- Doubles byes would need a team-aware variant; keep this RPC
    -- focused on the singles case for now.
    raise exception 'filling a bye is only supported for singles tournaments';
  end if;

  -- Lock the bye match row for the rest of this transaction so a
  -- concurrent fill / regenerate can't race us into a half-baked state.
  select id, tournament_id, bracket, round, slot,
         entry_a_id, entry_b_id, winner_entry_id, status
    into v_match
    from matches
   where id = p_match_id
   for update;
  if not found then
    raise exception 'match not found';
  end if;
  if v_match.tournament_id <> p_tournament_id then
    raise exception 'match does not belong to this tournament';
  end if;
  if v_match.round <> 1 then
    raise exception 'can only fill byes in the first round';
  end if;
  if (v_match.entry_a_id is not null and v_match.entry_b_id is not null)
     or (v_match.entry_a_id is null and v_match.entry_b_id is null) then
    raise exception 'this match is not a bye';
  end if;

  v_bye_winner_id := coalesce(v_match.entry_a_id, v_match.entry_b_id);

  -- Locate the R2 match the bye winner was auto-advanced into. The
  -- slot math here mirrors advance_winner exactly so we walk the same
  -- edge in reverse.
  v_next_round := v_match.round + 1;
  v_next_slot  := v_match.slot / 2;
  v_next_side  := case when v_match.slot % 2 = 0 then 'a' else 'b' end;

  -- A bracket with only one round (e.g. 2-player draw) won't have a
  -- next-round row at all — perfectly fine, just skip the unwind.
  select id, status, entry_a_id, entry_b_id
    into v_next_match
    from matches
   where tournament_id = p_tournament_id
     and bracket = v_match.bracket
     and round  = v_next_round
     and slot   = v_next_slot
   for update;

  if found and v_next_match.status <> 'pending' then
    raise exception
      'the bye winner has already played in a later round — '
      'withdraw the player and regenerate the draw instead';
  end if;

  -- All the destructive checks have passed. Create the participant +
  -- entry the same way td_enter_club_member does so duplicates and
  -- eligibility rules behave identically.
  v_participant_id := public.td_ensure_participant_from_club_member(
    p_tournament_id, p_club_member_id, v_uid);
  perform public.assert_tournament_eligibility(p_tournament_id, v_participant_id, true);

  if exists (
    select 1 from entries
     where tournament_id = p_tournament_id
       and participant_id = v_participant_id
       and status <> 'withdrawn'
  ) then
    select full_name into v_name from club_members where id = p_club_member_id;
    raise exception '% is already in the roster', coalesce(v_name, 'this player');
  end if;

  insert into entries (tournament_id, participant_id, status, added_by_td_id)
       values (p_tournament_id, v_participant_id, 'confirmed', v_uid)
    returning id into v_entry_id;

  -- Slot the new player into whichever side of the bye match is empty,
  -- then turn it back into a real pending match.
  if v_match.entry_a_id is null then
    update matches
       set entry_a_id     = v_entry_id,
           winner_entry_id = null,
           status         = 'pending'
     where id = v_match.id;
  else
    update matches
       set entry_b_id     = v_entry_id,
           winner_entry_id = null,
           status         = 'pending'
     where id = v_match.id;
  end if;

  -- Pull the bye winner back out of R2. They re-enter the bracket only
  -- if they actually beat the new player.
  if found then
    if v_next_side = 'a' then
      update matches set entry_a_id = null where id = v_next_match.id;
    else
      update matches set entry_b_id = null where id = v_next_match.id;
    end if;
  end if;

  return v_entry_id;
end;
$$;

grant execute on function public.td_add_player_to_bye_slot(uuid, uuid, uuid) to authenticated;
