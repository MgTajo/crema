-- Every EXECUTE and table privilege anon and authenticated hold in
-- `public`, one line each. Used by baseline-check.sh to compare two
-- databases on the one axis a --no-privileges dump makes invisible.
select format('%s|%s|%s|%s', 'fn', p.oid::regprocedure, g.r,
              has_function_privilege(g.r, p.oid, 'EXECUTE'))
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'),('authenticated')) as g(r)
 where n.nspname = 'public'
union all
select format('%s|%s|%s|%s', 'tbl.' || v.pr, c.oid::regclass, g.r,
              has_table_privilege(g.r, c.oid, v.pr))
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'),('authenticated')) as g(r)
  cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) as v(pr)
 where n.nspname = 'public' and c.relkind in ('r','v','p')
 order by 1;
