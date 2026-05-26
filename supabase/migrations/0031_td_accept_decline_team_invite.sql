-- Aspatuck Tournaments — TD can accept or decline a doubles team invite on
-- behalf of the partner.
--
-- The standard flow (accept_partner_invite / decline_partner_invite from
-- 0003_rpcs.sql) requires the caller to BE the invited partner: it checks
-- auth.uid() against participants.user_id. That's fine when the partner
-- logs in and clicks Accept, but for the common "captain told the TD that
-- their partner agreed" case it's a dead end — the partner may not have
-- signed up yet, or simply doesn't want to log in just to click a button.
--
-- These two RPCs mirror the player-facing ones but auth on TD-of-tournament
-- instead. The state transitions are identical.

begin;

create or replace function public.td_accept_team_invite(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_team record;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select id, tournament_id, invite_status
    into v_team
    from teams
   where id = p_team_id;
  if not found then
    raise exception 'team not found';
  end if;
  if not public.is_td_of_tournament(v_uid, v_team.tournament_id) then
    raise exception 'not authorized';
  end if;
  if v_team.invite_status <> 'pending' then
    raise exception 'this invite is no longer pending';
  end if;

  update teams set invite_status = 'accepted' where id = p_team_id;
  update entries set status = 'confirmed'
   where team_id = p_team_id and status = 'pending';
end;
$$;

create or replace function public.td_decline_team_invite(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_team record;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select id, tournament_id, invite_status
    into v_team
    from teams
   where id = p_team_id;
  if not found then
    raise exception 'team not found';
  end if;
  if not public.is_td_of_tournament(v_uid, v_team.tournament_id) then
    raise exception 'not authorized';
  end if;
  if v_team.invite_status <> 'pending' then
    raise exception 'this invite is no longer pending';
  end if;

  update teams set invite_status = 'declined' where id = p_team_id;
  update entries set status = 'withdrawn', withdrawn_at = now()
   where team_id = p_team_id and status = 'pending';
end;
$$;

grant execute on function public.td_accept_team_invite(uuid)  to authenticated;
grant execute on function public.td_decline_team_invite(uuid) to authenticated;

commit;
