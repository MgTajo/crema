\set ON_ERROR_STOP on
\pset pager off

-- ============================================================
-- step-1.30: daily_firsts — one row per person per their own day
--
--   ./platform/supabase/local-test/run.sh step-1.30-test.sql
--
-- ⚠️ This file was rewritten when step-1.31 landed. As shipped,
-- step-1.30 also PAID +20 for a personal first pour and notified
-- followers of EVERY pour; step-1.31 replaced the first with a single
-- daily race (`daily_champions`) and narrowed the second to one
-- notification a morning. Both of those are step-1.31's to assert, and
-- they are asserted in step-1.31-test.sql.
--
-- What is left here is the half of step-1.30 that survived intact and is
-- still load-bearing: `daily_firsts` marks the first pour a person makes
-- on a given day, in THAT PERSON'S timezone. It is what gates the friend
-- notification, so if this drifts, friends hear about the wrong pour or
-- about three of them.
--
-- The cluster runs Europe/Berlin on purpose (run.sh), which is what
-- makes T3 worth anything: a per-user day must not resolve in the
-- session's zone.
-- ============================================================

-- ---------- fixtures ----------
delete from daily_champions; delete from daily_firsts;
delete from notifications; delete from reactions; delete from likes;
delete from comments; delete from blocks; delete from follows; delete from posts;
delete from profiles; delete from auth.users;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','ann@e.com'),
  ('22222222-2222-2222-2222-222222222222','bo@e.com');
insert into profiles (id, handle, name, tz_offset) values
  ('11111111-1111-1111-1111-111111111111','ann','Ann',0),
  ('22222222-2222-2222-2222-222222222222','bo','Bo',0);

\echo '--- T1: the table, its policy, and the switch step-1.30 added ---'
do $$
begin
  assert (select count(*) = 1 from information_schema.tables where table_name='daily_firsts'),
    'daily_firsts should exist';
  assert (select relrowsecurity from pg_class where relname='daily_firsts'),
    'RLS must be enabled';
  assert (select count(*) = 0 from pg_policies
           where tablename='daily_firsts' and cmd <> 'SELECT'),
    'there must be no policy that lets anybody write one';
  assert (select count(*) = 1 from information_schema.columns
           where table_name='profiles' and column_name='notify_friends'),
    'the fifth notification switch should exist';
  assert (select column_default = 'true' from information_schema.columns
           where table_name='profiles' and column_name='notify_friends'),
    'and default to on, like the other four';
end $$;
\echo 'T1 PASS'

\echo '--- T2: one row per person per day, however many cups they have ---'
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Flat white','2026-08-19 07:10+00');
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Espresso',  '2026-08-19 11:00+00'),
  ('11111111-1111-1111-1111-111111111111','Cortado',   '2026-08-19 16:00+00');
do $$
begin
  assert (select count(*) = 1 from daily_firsts
           where user_id='11111111-1111-1111-1111-111111111111'),
    'three cups, one row — the eleven o''clock cup is not a first pour';
  assert (select post_id is not null from daily_firsts
           where user_id='11111111-1111-1111-1111-111111111111'),
    'and it must remember WHICH pour, or the notification has nothing to link to';
end $$;

insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Filter','2026-08-20 07:30+00');
do $$
begin
  assert (select count(*) = 2 from daily_firsts
           where user_id='11111111-1111-1111-1111-111111111111'),
    'the next morning is a new day';
end $$;
\echo 'T2 PASS'

\echo '--- T3: the day is the POSTER''s day, not the server''s and not UTC ---'
-- Bo is in Auckland (+13h in August): 23:30 UTC on the 19th is already
-- 12:30 on the 20th where he is, so these are the same New Zealand day.
-- Under UTC they would be two, and under Europe/Berlin — the session's
-- zone, which is what a naive cast resolves in — also two.
update profiles set tz_offset = 780 where id='22222222-2222-2222-2222-222222222222';
insert into posts (user_id, drink, created_at) values
  ('22222222-2222-2222-2222-222222222222','Long black','2026-08-19 20:00+00'),   -- 20 Aug, 09:00 NZ
  ('22222222-2222-2222-2222-222222222222','Long black','2026-08-19 23:30+00');   -- 20 Aug, 12:30 NZ
do $$
begin
  assert (select count(*) = 1 from daily_firsts
           where user_id='22222222-2222-2222-2222-222222222222'),
    'both cups are the same New Zealand day — one row';
  assert (select day = date '2026-08-20' from daily_firsts
           where user_id='22222222-2222-2222-2222-222222222222'),
    'the day recorded must be his, not UTC''s and not the session zone''s';
end $$;

insert into posts (user_id, drink, created_at) values
  ('22222222-2222-2222-2222-222222222222','Piccolo','2026-08-20 20:30+00');      -- 21 Aug, 09:30 NZ
do $$
begin
  assert (select count(*) = 2 from daily_firsts
           where user_id='22222222-2222-2222-2222-222222222222'),
    'the next New Zealand morning is a new day';
end $$;
\echo 'T3 PASS'

\echo '--- T4: deleting the pour does not re-open the day ---'
do $$
declare pid uuid;
begin
  select post_id into pid from daily_firsts
    where user_id='11111111-1111-1111-1111-111111111111' and day = date '2026-08-20';
  delete from posts where id = pid;

  assert (select count(*) = 2 from daily_firsts
           where user_id='11111111-1111-1111-1111-111111111111'),
    'the row outlives the pour that created it';
  assert (select post_id is null from daily_firsts
           where user_id='11111111-1111-1111-1111-111111111111' and day = date '2026-08-20'),
    'on delete set null, not cascade';
end $$;

-- Posting again that same day must not create a second row — which is
-- what would let somebody re-trigger the friend notification at will.
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Filter','2026-08-20 08:00+00');
do $$
begin
  assert (select count(*) = 2 from daily_firsts
           where user_id='11111111-1111-1111-1111-111111111111'),
    'delete-and-repost must not re-open the morning';
end $$;
\echo 'T4 PASS'

\echo '--- T5: the surface is locked ---'
do $$
begin
  assert not has_function_privilege('authenticated','award_daily_first()','execute'),
    'a browser must not be able to declare its own morning';
end $$;

begin;
  set local role authenticated;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';
  do $$
  begin
    begin
      insert into daily_firsts (user_id, day)
      values ('11111111-1111-1111-1111-111111111111', date '2030-01-01');
      raise exception 'a client wrote a daily_firsts row — the surface is open';
    exception
      when insufficient_privilege then null;
      when others then
        if sqlerrm like '%row-level security%' then null; else raise; end if;
    end;
  end $$;
rollback;
\echo 'T5 PASS'

\echo '--- T6: what the chain looks like once step-1.31 is on top ---'
-- ⚠️ step-1.30.sql is NOT independently re-runnable any more, and this
-- block exists to say so where somebody will see it. step-1.31 drops
-- `daily_firsts.points`, and step-1.30's own user_points() still selects
-- it — so pasting step-1.30 on its own into a database that already has
-- step-1.31 fails at that CREATE FUNCTION.
--
-- That failure is loud and atomic (the SQL editor runs a paste in one
-- transaction, so nothing is left half-applied), which is the acceptable
-- kind. It is still a departure from "every step is idempotent", so the
-- rule it leaves behind is the one the runbook already states: run the
-- chain IN ORDER. If step-1.30 has to be replayed, step-1.31 must be
-- replayed straight after it, in the same paste.
--
-- What is asserted here is the end state that matters: after the chain,
-- the shape is step-1.31's.
do $$
begin
  assert (select count(*) = 0 from information_schema.columns
           where table_name='daily_firsts' and column_name='points'),
    'the chain must end on step-1.31''s shape, not step-1.30''s';
  assert (select count(*) = 1 from pg_trigger
           where tgname='daily_firsts_notify' and not tgisinternal),
    'the friend notification must hang off daily_firsts, not posts';
  assert (select count(*) = 0 from pg_trigger
           where tgname='daily_firsts_score' and not tgisinternal),
    'and a daily_firsts row must no longer move anybody''s score';
end $$;
\echo 'T6 PASS'

\echo 'step-1.30: ALL PASS'
