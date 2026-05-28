-- Aspatuck Tournaments — rename "Aspatuck Century Tournament" to
-- "Aspatuck Century Doubles" to match how Frank labels it elsewhere.

update tournaments
   set name = 'Aspatuck Century Doubles'
 where name = 'Aspatuck Century Tournament';
