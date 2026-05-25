-- Fix td_swap_entries: the previous implementation used a sentinel UUID as a
-- temporary intermediate value while swapping, which violates the
-- entry_a_id/entry_b_id foreign keys when those FKs are checked immediately
-- (the default in Postgres for NOT DEFERRABLE constraints). Replace with a
-- single UPDATE that uses CASE expressions to swap atomically.

create or replace function public.td_swap_entries(
  p_entry_a uuid,
  p_entry_b uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_division_id uuid;
  v_other uuid;
begin
  if p_entry_a = p_entry_b then
    raise exception 'cannot swap an entry with itself';
  end if;

  select division_id into v_division_id from entries where id = p_entry_a;
  if not found then raise exception 'entry % not found', p_entry_a; end if;
  select division_id into v_other from entries where id = p_entry_b;
  if not found then raise exception 'entry % not found', p_entry_b; end if;
  if v_division_id <> v_other then
    raise exception 'entries belong to different divisions';
  end if;
  if not public.is_td_of_division(v_uid, v_division_id) then
    raise exception 'not authorized';
  end if;

  update matches
     set entry_a_id = case
           when entry_a_id = p_entry_a then p_entry_b
           when entry_a_id = p_entry_b then p_entry_a
           else entry_a_id
         end,
         entry_b_id = case
           when entry_b_id = p_entry_a then p_entry_b
           when entry_b_id = p_entry_b then p_entry_a
           else entry_b_id
         end,
         winner_entry_id = case
           when winner_entry_id = p_entry_a then p_entry_b
           when winner_entry_id = p_entry_b then p_entry_a
           else winner_entry_id
         end
   where division_id = v_division_id
     and (entry_a_id in (p_entry_a, p_entry_b)
       or entry_b_id in (p_entry_a, p_entry_b)
       or winner_entry_id in (p_entry_a, p_entry_b));

  insert into bracket_audit (division_id, changed_by, change_type, notes, snapshot)
       values (v_division_id, v_uid, 'edited',
               'swapped entries ' || p_entry_a::text || ' and ' || p_entry_b::text,
               jsonb_build_object('a', p_entry_a, 'b', p_entry_b));
end;
$$;
