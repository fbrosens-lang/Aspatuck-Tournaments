-- Aspatuck Tournaments — directory update.
--
-- Two name corrections and two new members. Each club member has exactly one
-- directory row keyed on email; the second-email rows from earlier rosters
-- stay dropped (per 0013).

update club_members
   set full_name = 'Robert Bailin'
 where lower(email) = lower('bbbny@aol.com');

update club_members
   set full_name = 'Todd M. Ross'
 where lower(email) = lower('tmr@onepointib.com');

insert into club_members (full_name, email) values
  ('James Brown',   'jimmydesmondbrown@gmail.com'),
  ('Ethan Frieder', 'emfrieder@gmail.com')
on conflict (lower(email)) do nothing;
