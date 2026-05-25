-- Surface "matches the calling user needs to report or confirm." Returns
-- non-finalized matches where the user is a singles participant, or the
-- captain/partner of a doubles team, AND both sides of the match are filled
-- (so the player can actually act on it).

-- Helper first: SQL-language functions are statically validated against their
-- dependencies at CREATE time, so opponent_label must exist before
-- my_pending_matches is defined.
create or replace function public.opponent_label(p_entry_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when e.participant_id is not null then p.display_name
    when e.team_id is not null then
      coalesce(pc.display_name, '?') || ' / ' || coalesce(pp.display_name, '(unassigned)')
    else null
  end
  from entries e
  left join participants p  on p.id  = e.participant_id
  left join teams t         on t.id  = e.team_id
  left join participants pc on pc.id = t.captain_participant_id
  left join participants pp on pp.id = t.partner_participant_id
  where e.id = p_entry_id;
$$;

create or replace function public.my_pending_matches()
returns table (
  match_id          uuid,
  tournament_id     uuid,
  tournament_name   text,
  division_id       uuid,
  division_name     text,
  round             smallint,
  opponent_label    text,
  match_status      match_status,
  deadline          timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  my_entries as (
    select e.id as entry_id
      from entries e
      join participants p on p.id = e.participant_id
     where p.user_id = (select uid from me) and e.status <> 'withdrawn'
    union
    select e.id as entry_id
      from entries e
      join teams t on t.id = e.team_id
      left join participants pc on pc.id = t.captain_participant_id
      left join participants pp on pp.id = t.partner_participant_id
     where ((pc.user_id = (select uid from me)) or (pp.user_id = (select uid from me)))
       and e.status <> 'withdrawn'
  ),
  my_matches as (
    select m.*
      from matches m
     where m.status in ('pending', 'reported', 'disputed')
       and m.entry_a_id is not null
       and m.entry_b_id is not null
       and (m.entry_a_id in (select entry_id from my_entries)
            or m.entry_b_id in (select entry_id from my_entries))
  )
  select m.id as match_id,
         t.id as tournament_id,
         t.name as tournament_name,
         d.id as division_id,
         d.name as division_name,
         m.round,
         coalesce(
           case when m.entry_a_id in (select entry_id from my_entries)
                then public.opponent_label(m.entry_b_id)
                else public.opponent_label(m.entry_a_id)
           end,
           'TBD'
         ) as opponent_label,
         m.status as match_status,
         coalesce(m.deadline_override, rd.deadline) as deadline
    from my_matches m
    join divisions d on d.id = m.division_id
    join tournaments t on t.id = d.tournament_id
    left join division_round_deadlines rd
           on rd.division_id = d.id and rd.round = m.round
   order by t.start_date, d.name, m.round, m.slot;
$$;

grant execute on function public.my_pending_matches()  to authenticated;
revoke execute on function public.opponent_label(uuid) from public;
