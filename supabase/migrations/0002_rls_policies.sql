-- Aspatuck Tournaments — RLS + authorization helpers
-- Posture: SELECT is open to anon for public-read tables (tournaments are
-- public). INSERT/UPDATE/DELETE have no policies, so they are denied for
-- regular roles. All writes go through SECURITY DEFINER RPCs that run as the
-- function owner and so bypass RLS.

-- ---------- authorization helpers ----------

create or replace function public.is_site_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = uid and role = 'site_admin'
  );
$$;

create or replace function public.is_td_of_tournament(uid uuid, p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_site_admin(uid)
      or exists (
        select 1 from tournament_directors
        where tournament_id = p_tournament_id and user_id = uid
      );
$$;

create or replace function public.is_td_of_division(uid uuid, p_division_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_site_admin(uid)
      or exists (
        select 1 from tournament_directors td
        join divisions d on d.tournament_id = td.tournament_id
        where d.id = p_division_id and td.user_id = uid
      );
$$;

create or replace function public.is_player_in_match(uid uuid, p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with sides as (
    select m.entry_a_id as entry_id from matches m where m.id = p_match_id
    union all
    select m.entry_b_id as entry_id from matches m where m.id = p_match_id
  )
  select exists (
    select 1
    from sides s
    join entries e             on e.id = s.entry_id
    left join participants ps  on ps.id = e.participant_id
    left join teams t          on t.id = e.team_id
    left join participants pc  on pc.id = t.captain_participant_id
    left join participants pp  on pp.id = t.partner_participant_id
    where ps.user_id = uid or pc.user_id = uid or pp.user_id = uid
  );
$$;

-- ---------- enable RLS ----------

alter table profiles                  enable row level security;
alter table tournaments               enable row level security;
alter table tournament_directors      enable row level security;
alter table divisions                 enable row level security;
alter table participants              enable row level security;
alter table teams                     enable row level security;
alter table entries                   enable row level security;
alter table matches                   enable row level security;
alter table division_round_deadlines  enable row level security;
alter table match_sets                enable row level security;
alter table bracket_audit             enable row level security;
alter table score_audit               enable row level security;

-- ---------- public-read SELECT policies ----------

create policy profiles_select_all
  on profiles for select using (true);

create policy tournaments_select_all
  on tournaments for select using (true);

create policy tournament_directors_select_all
  on tournament_directors for select using (true);

create policy divisions_select_all
  on divisions for select using (true);

create policy participants_select_all
  on participants for select using (true);

create policy teams_select_all
  on teams for select using (true);

create policy entries_select_all
  on entries for select using (true);

create policy matches_select_all
  on matches for select using (true);

create policy division_round_deadlines_select_all
  on division_round_deadlines for select using (true);

create policy match_sets_select_all
  on match_sets for select using (true);

-- ---------- audit log policies (TD/admin only) ----------

create policy bracket_audit_select_td
  on bracket_audit for select using (
    public.is_td_of_division(auth.uid(), division_id)
  );

create policy score_audit_select_td
  on score_audit for select using (
    exists (
      select 1 from matches m
      where m.id = score_audit.match_id
        and public.is_td_of_division(auth.uid(), m.division_id)
    )
  );

-- ---------- intentionally absent ----------

-- No INSERT/UPDATE/DELETE policies are defined for any table. Regular roles
-- (anon, authenticated) cannot mutate these tables directly. All writes flow
-- through SECURITY DEFINER RPCs declared in 0003_rpcs.sql and 0004_td_rpcs.sql.
