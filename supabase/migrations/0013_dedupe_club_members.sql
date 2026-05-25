-- Fix the missing TLD on Mike Kosinski's email and drop the second-email rows
-- for the six members who were listed twice in the directory. The first email
-- listed in the source roster is the one we keep.

update club_members
   set email = 'Mkosinski123@gmail.com'
 where lower(email) = lower('Mkosinski123@gmail');

delete from club_members
 where lower(email) in (
   lower('SArango@kingstreet.com'),
   lower('Jbrosens@stolarcap.com'),
   lower('Mdubb@Beechwoodhomes.com'),
   lower('David.Kline@Charter.com'),
   lower('Maria@yapp.us'),
   lower('mspiegel@evcmllc.com')
 );
