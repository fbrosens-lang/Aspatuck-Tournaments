-- 0064_drop_td_add_team_to_bye_slot.sql
--
-- Drop the legacy td_add_team_to_bye_slot RPC (0050). It only ever handled
-- the "two fresh club members" case for filling a bye slot, and its sole
-- caller (the fillByeSlotTeam server action) was removed when
-- td_pair_team_into_bye_slot (0063) shipped. The new RPC is a strict
-- superset: passing both p_*_club_member_id args reproduces the old path.

drop function if exists public.td_add_team_to_bye_slot(uuid, uuid, uuid, uuid);
