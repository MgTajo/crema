\set ON_ERROR_STOP on
\pset pager off

-- ============================================================
-- InitPlan benchmark — the evidence behind step 1b.2
--
--   ./platform/supabase/local-test/run.sh zz-bench.sql
--
-- NOT a test. Named zz-bench rather than *-test so CI's
-- `ls *-test.sql` never picks it up: it seeds 50,000 posts and takes
-- the better part of a minute, and it asserts nothing.
--
-- WHY IT EXISTS
-- migrations/20260830170000 claims that wrapping auth.uid() in a scalar
-- subquery is worth doing. At production's 189 pours that claim cannot
-- be measured — everything is sub-millisecond either way — so it would
-- otherwise be an appeal to an advisor's authority rather than a
-- result. This file is how the claim was checked, and how to check it
-- again if somebody doubts it.
--
-- It builds a feed 260x the size of production's, measures both forms
-- by rewriting the policies in place (bench_unwrap() is the inverse of
-- rls_wrap_auth_calls(), and lives here rather than in a migration for
-- exactly that reason), and reports two query shapes.
--
-- WHAT IT FOUND, 2026-08-30, three runs, stable to a few percent:
--
--   shape                        bare        wrapped     change
--   feed, ORDER BY … LIMIT 20    0.017 ms    0.019 ms    ~10% SLOWER
--   count(*) over all posts      5.77 ms     4.30 ms     ~26% faster
--
-- Both numbers matter and the first one is the interesting one. A
-- keyset feed query evaluates the policy for the couple of dozen rows
-- the LIMIT actually reaches, so there is nothing per-row to save, and
-- setting up three InitPlans is a small fixed cost that the query never
-- earns back. A query that scans — profile_counts' pour_count, the
-- feed's likes(count)/comments(count) embeds, any aggregate — evaluates
-- it for every row, and that is where the hoist pays.
--
-- So the honest summary of 1b.2 is: **the feed did not get faster, and
-- the counting did.** Nothing in Crema is slow enough today for either
-- to be visible; what changed is the slope.
-- ============================================================

delete from net.calls;
delete from daily_champions; delete from daily_firsts;
delete from notifications; delete from posts;
delete from follows; delete from profiles; delete from auth.users;

alter table posts disable trigger all;
alter table profiles disable trigger all;

insert into auth.users (id, email)
select gen_random_uuid(), 'u'||g||'@e.com' from generate_series(1,500) g;
insert into profiles (id, handle, name, tz_offset, is_admin)
select id, 'u'||row_number() over (), 'U', 0, false from auth.users;

insert into posts (user_id, drink, visibility, created_at)
select (array(select id from profiles))[1 + (g % 500)],
       'Espresso',
       case when g % 7 = 0 then 'followers' else 'public' end,
       now() - (g || ' minutes')::interval
  from generate_series(1,50000) g;

insert into follows (follower_id, followee_id, status)
select a.id, b.id, 'accepted'
  from (select id from profiles limit 60) a
  cross join lateral (select id from profiles where id <> a.id limit 20) b
on conflict do nothing;

alter table posts enable trigger all;
alter table profiles enable trigger all;
analyze;

-- The inverse of rls_wrap_auth_calls(), for the BEFORE measurement only.
-- Lives here, in a benchmark file, and never in a migration.
create or replace function bench_unwrap() returns int
language plpgsql as $fn$
declare p record; nq text; nc text; stmt text; roles text; n int := 0;
begin
  for p in select * from pg_policies where schemaname='public' order by tablename, policyname loop
    nq := regexp_replace(p.qual, '\(\s*SELECT\s+(auth\.uid|is_admin|is_suspended)\(\)\s*(AS\s+\w+\s*)?\)', '\1()', 'g');
    nc := regexp_replace(p.with_check, '\(\s*SELECT\s+(auth\.uid|is_admin|is_suspended)\(\)\s*(AS\s+\w+\s*)?\)', '\1()', 'g');
    if nq is not distinct from p.qual and nc is not distinct from p.with_check then continue; end if;
    select string_agg(quote_ident(r), ', ') into roles from unnest(p.roles) r;
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    stmt := format('create policy %I on %I.%I as %s for %s to %s',
                   p.policyname, p.schemaname, p.tablename, p.permissive, p.cmd, coalesce(roles,'public'));
    if nq is not null then stmt := stmt || format(' using (%s)', nq); end if;
    if nc is not null then stmt := stmt || format(' with check (%s)', nc); end if;
    execute stmt; n := n + 1;
  end loop;
  return n;
end $fn$;

-- A scan, not a lookup. This is the shape the InitPlan actually helps:
-- profile_counts (pour_count) counts a person's posts, and the feed's
-- likes(count)/comments(count) embeds aggregate per post. Every row the
-- scan touches evaluates the policy.
create or replace function bench_count(n int) returns numeric
language plpgsql as $$
declare t0 timestamptz; i int; d bigint;
begin
  t0 := clock_timestamp();
  for i in 1..n loop
    select count(*) into d from posts;
  end loop;
  return round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
end $$;

create or replace function bench_feed(n int) returns numeric
language plpgsql as $$
declare t0 timestamptz; i int; d int;
begin
  t0 := clock_timestamp();
  for i in 1..n loop
    select count(*) into d from (select p.id from posts p order by p.created_at desc limit 20) s;
  end loop;
  return round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
end $$;

\echo ''
\echo '=========== 50,000 posts / 500 accounts / 1200 follows ==========='

\echo ''
\echo '--- BEFORE: bare auth.uid(), evaluated per row ---'
select bench_unwrap() as policies_unwrapped;
do $$
declare uid uuid; ms numeric;
begin
  select id into uid from profiles limit 1;
  perform set_config('test.uid', uid::text, false);
  set local role authenticated;
  perform bench_feed(20);
  ms := bench_feed(200);
  raise notice 'feed, limit 20   : % ms for 200  (% ms each)', ms, round(ms/200,3);
  perform bench_count(3);
  ms := bench_count(20);
  raise notice 'count(*) over all: % ms for 20   (% ms each)', ms, round(ms/20,2);
  reset role;
end $$;

\echo ''
\echo '--- AFTER: (select auth.uid()), hoisted to an InitPlan ---'
select rls_wrap_auth_calls() as policies_wrapped;
do $$
declare uid uuid; ms numeric;
begin
  select id into uid from profiles limit 1;
  perform set_config('test.uid', uid::text, false);
  set local role authenticated;
  perform bench_feed(20);
  ms := bench_feed(200);
  raise notice 'feed, limit 20   : % ms for 200  (% ms each)', ms, round(ms/200,3);
  perform bench_count(3);
  ms := bench_count(20);
  raise notice 'count(*) over all: % ms for 20   (% ms each)', ms, round(ms/20,2);
  reset role;
end $$;

begin;
set local role authenticated;
explain (analyze, buffers, timing off, summary off) select count(*) from posts;
rollback;
