-- Aspatuck Tournaments — club member directory
--
-- The club has a known roster of members that exists independently of who
-- has signed up for an account. TDs pick from this directory when entering
-- players. When a club member later signs up (via the regular auth flow),
-- the row is auto-linked to the matching profile by email.
--
-- A member is allowed to have multiple email contexts (work + personal).
-- Each email contact becomes its own row.

create table club_members (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  email           text not null,
  date_of_birth   date,
  user_id         uuid references profiles(id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now()
);

create unique index club_members_email_lower_idx
  on club_members (lower(email));

create index club_members_user_idx     on club_members (user_id);
create index club_members_name_idx     on club_members (lower(full_name));

alter table participants
  add column club_member_id uuid references club_members(id) on delete set null;

create index participants_club_member_idx on participants (club_member_id);
alter table participants
  add constraint participants_unique_club_member_per_tournament
  unique (tournament_id, club_member_id);

-- RLS: directory is public-readable; writes go through RPCs.
alter table club_members enable row level security;

create policy club_members_select_all
  on club_members for select using (true);

-- When a new profile is created (i.e. someone signs up), link any matching
-- club_members rows to the new user.
create or replace function public.link_club_members_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update club_members
     set user_id = new.id
   where user_id is null
     and lower(email) = lower(new.contact_email);
  return new;
end;
$$;

drop trigger if exists on_profile_link_club_members on profiles;
create trigger on_profile_link_club_members
  after insert on profiles
  for each row execute function public.link_club_members_to_profile();

-- Backfill: any club_members rows matching existing profiles get linked.
update club_members cm
   set user_id = p.id
  from profiles p
 where cm.user_id is null and lower(p.contact_email) = lower(cm.email);
