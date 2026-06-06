-- 0052_withdraw_cleans_match_pointers_and_advances.sql
--
-- Both withdraw RPCs (withdraw_self in 0003, td_withdraw_entry in 0016)
-- have two long-standing gaps:
--
--   1. They flip the entry's status to 'withdrawn' but leave matches
--      referencing it: entry_a_id, entry_b_id, and winner_entry_id keep
--      pointing at the withdrawn entry id. The R1 bye-fill UI looks for
--      "exactly one side null" to surface a match as a bye, so a slot
--      whose other side is a stale withdrawn pointer is invisible to
--      the TD. We hit this on Aspatuck Doubles slot 11 (cleaned up in
--      0051) and the workaround was a one-off SQL update.
--   2. When a pending match walks over (other side wins because this
--      entry pulled out), the winner is recorded but never advanced
--      into R+1. The next-round slot stays empty and the bracket has a
--      gap until a TD regenerates.
--
-- This migration factors the post-withdraw match cleanup into a single
-- helper (_unwind_entry_from_matches) and updates both RPCs to call it.
-- The helper:
--   * Walks over any still-pending fully-populated match — same logic
--     as before — and remembers which matches walked over.
--   * Nulls every entry_a_id / entry_b_id / winner_entry_id that points
--     at the withdrawn entry, except: winner_entry_id is preserved for
--     confirmed matches that still have a real opponent on the other
--     side. That keeps historical "X beat Y" results intact (the audit
--     log is the source of truth anyway) while clearing pointers that
--     would otherwise mislead the bye-fill UI.
--   * Calls advance_winner on each walked-over match, so the walkover
--     winner shows up in their R+1 slot the same way generate_draw's
--     bye-advance does.

create or replace function public._unwind_entry_from_matches(
  p_tournament_id uuid,
  p_entry_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_walkover_ids uuid[];
  v_match_id uuid;
begin
  -- Walkover: any pending match where this entry was a side and the
  -- other side is also populated. Record the ids so we can advance the
  -- new winners to R+1 below.
  with walkovers as (
    update matches m
       set winner_entry_id = case
             when m.entry_a_id = p_entry_id then m.entry_b_id
             else m.entry_a_id
           end,
           status = 'confirmed'
     where m.tournament_id = p_tournament_id
       and (m.entry_a_id = p_entry_id or m.entry_b_id = p_entry_id)
       and m.status = 'pending'
       and m.entry_a_id is not null
       and m.entry_b_id is not null
    returning id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_walkover_ids from walkovers;

  -- Clear stale slot pointers everywhere this entry appears.
  update matches set entry_a_id = null
   where tournament_id = p_tournament_id and entry_a_id = p_entry_id;
  update matches set entry_b_id = null
   where tournament_id = p_tournament_id and entry_b_id = p_entry_id;

  -- Clear winner pointer only when the match no longer has any real
  -- contestants — typical case is the withdrawn entry was a bye-only
  -- winner in this slot. Played matches keep their historical winner
  -- pointer; the displayed bracket will surface it as a withdrawn
  -- entry, but tournament history isn't rewritten.
  update matches set winner_entry_id = null
   where tournament_id = p_tournament_id
     and winner_entry_id = p_entry_id
     and entry_a_id is null
     and entry_b_id is null;

  -- Propagate every walkover winner into its R+1 slot. advance_winner
  -- is a no-op when winner_entry_id is null, so it's safe to call on
  -- any match id we collected.
  foreach v_match_id in array v_walkover_ids loop
    perform public.advance_winner(v_match_id);
  end loop;
end;
$$;

grant execute on function public._unwind_entry_from_matches(uuid, uuid) to authenticated;

-- Self-withdraw: a player or team partner pulls themselves out.
create or replace function public.withdraw_self(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_entry record;
  v_allowed boolean;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select e.id, e.tournament_id, e.participant_id, e.team_id, e.status
    into v_entry
    from entries e where e.id = p_entry_id;
  if not found then
    raise exception 'entry not found';
  end if;
  if v_entry.status = 'withdrawn' then
    return;
  end if;

  if v_entry.participant_id is not null then
    select (p.user_id = v_uid) into v_allowed
      from participants p where p.id = v_entry.participant_id;
  else
    select (pc.user_id = v_uid or pp.user_id = v_uid) into v_allowed
      from teams t
      left join participants pc on pc.id = t.captain_participant_id
      left join participants pp on pp.id = t.partner_participant_id
     where t.id = v_entry.team_id;
  end if;

  if not coalesce(v_allowed, false) then
    raise exception 'you do not have permission to withdraw this entry';
  end if;

  update entries set status = 'withdrawn', withdrawn_at = now() where id = p_entry_id;

  perform public._unwind_entry_from_matches(v_entry.tournament_id, p_entry_id);
end;
$$;

-- TD-initiated withdraw: the tournament director pulls an entry out.
create or replace function public.td_withdraw_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tournament_id uuid;
begin
  select tournament_id into v_tournament_id from entries where id = p_entry_id;
  if not found then raise exception 'entry not found'; end if;
  if not public.is_td_of_tournament(v_uid, v_tournament_id) then
    raise exception 'not authorized';
  end if;

  update entries set status = 'withdrawn', withdrawn_at = now() where id = p_entry_id;

  perform public._unwind_entry_from_matches(v_tournament_id, p_entry_id);

  insert into bracket_audit (tournament_id, changed_by, change_type, notes, snapshot)
       values (v_tournament_id, v_uid, 'edited',
               'withdrew entry ' || p_entry_id::text,
               jsonb_build_object('entry_id', p_entry_id));
end;
$$;
