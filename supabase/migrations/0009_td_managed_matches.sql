-- Surface "matches in tournaments I direct that aren't yet finalized."
-- Returns rows for the calling user across all tournaments they're a TD of
-- (including site admins, who see every tournament).

create or replace function public.td_managed_matches()
returns table (
  match_id          uuid,
  tournament_id     uuid,
  tournament_name   text,
  division_id       uuid,
  division_name     text,
  round             smallint,
  side_a_label      text,
  side_b_label      text,
  match_status      match_status,
  deadline          timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  visible_tournaments as (
    select t.id, t.name, t.start_date
      from tournaments t
     where public.is_td_of_tournament((select uid from me), t.id)
  )
  select m.id            as match_id,
         t.id            as tournament_id,
         t.name          as tournament_name,
         d.id            as division_id,
         d.name          as division_name,
         m.round,
         public.opponent_label(m.entry_a_id) as side_a_label,
         public.opponent_label(m.entry_b_id) as side_b_label,
         m.status        as match_status,
         coalesce(m.deadline_override, rd.deadline) as deadline
    from matches m
    join divisions d  on d.id = m.division_id
    join visible_tournaments t on t.id = d.tournament_id
    left join division_round_deadlines rd
           on rd.division_id = d.id and rd.round = m.round
   where m.status in ('pending', 'reported', 'disputed')
     and m.entry_a_id is not null
     and m.entry_b_id is not null
   order by
     -- Disputed first, then reported (awaiting opponent), then pending.
     case m.status when 'disputed' then 0 when 'reported' then 1 else 2 end,
     t.start_date, d.name, m.round, m.slot;
$$;

grant execute on function public.td_managed_matches() to authenticated;
