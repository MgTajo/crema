\set ON_ERROR_STOP on
\pset pager off

-- ============================================================
-- step-1.30: the first pour of the day pays, and friends hear about it
--
--   ./platform/supabase/local-test/run.sh step-1.30-test.sql
--
-- The cluster runs Europe/Berlin on purpose (run.sh), which is what
-- makes T3 worth anything: a pour at 23:30 UTC is already tomorrow in
-- Berlin, and "which day was that" has to answer with the poster's own
-- day rather than the server's.
-- ============================================================

-- ---------- fixtures ----------
delete from daily_firsts;
delete from notifications; delete from reactions; delete from likes;
delete from comments; delete from blocks; delete from follows; delete from posts;
delete from profiles; delete from auth.users;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','ann@e.com'),
  ('22222222-2222-2222-2222-222222222222','bo@e.com'),
  ('33333333-3333-3333-3333-333333333333','cem@e.com'),
  ('44444444-4444-4444-4444-444444444444','dee@e.com');
insert into profiles (id, handle, name, tz_offset) values
  ('11111111-1111-1111-1111-111111111111','ann','Ann',0),
  ('22222222-2222-2222-2222-222222222222','bo','Bo',0),
  ('33333333-3333-3333-3333-333333333333','cem','Cem',0),
  ('44444444-4444-4444-4444-444444444444','dee','Dee',0);

\echo '--- T1: the table, its policy and the constant ---'
do $$
begin
  assert (select count(*) = 1 from information_schema.tables where table_name='daily_firsts'),
    'daily_firsts should exist';
  assert (select relrowsecurity from pg_class where relname='daily_firsts'),
    'RLS must be enabled';
  assert (select count(*) = 1 from pg_policies where tablename='daily_firsts'),
    'exactly one policy: readable, and written by nothing but the trigger';
  assert crema_first_pour_points() = 20,
    'the award must match POINT_RULES in src/domain/scoring.js';
  assert (select count(*) = 0 from daily_firsts),
    'the table must be EMPTY after the migration — nobody''s score moves retroactively';
end $$;
\echo 'T1 PASS'

\echo '--- T2: first pour pays, second pour of the same day does not ---'
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Flat white','2026-08-19 07:10+00');
do $$
begin
  assert (select count(*) = 1 from daily_firsts
           where user_id='11111111-1111-1111-1111-111111111111'),
    'the first pour of the day should have been awarded';
  assert (select points = 20 from daily_firsts
           where user_id='11111111-1111-1111-1111-111111111111'),
    'it should be worth crema_first_pour_points()';
  -- 10 for the pour + 20 for the morning, and nothing else.
  assert (select points = 30 from profiles
           where id='11111111-1111-1111-1111-111111111111'),
    'the award must move the score in the same transaction, not at some later recalculation';
end $$;

insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Espresso','2026-08-19 11:00+00');
do $$
begin
  assert (select count(*) = 1 from daily_firsts
           where user_id='11111111-1111-1111-1111-111111111111'),
    'the eleven o''clock cup is not a first pour';
  assert (select points = 40 from profiles
           where id='11111111-1111-1111-1111-111111111111'),
    'the second pour pays 10 and nothing more';
end $$;

insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Filter','2026-08-20 07:30+00');
do $$
begin
  assert (select count(*) = 2 from daily_firsts
           where user_id='11111111-1111-1111-1111-111111111111'),
    'the next morning is a new day and pays again';
  assert (select points = 70 from profiles
           where id='11111111-1111-1111-1111-111111111111'),
    '3 pours (30) + 2 mornings (40)';
end $$;
\echo 'T2 PASS'

\echo '--- T3: the day is the POSTER''s day, not the server''s and not UTC ---'
-- Bo is in Auckland (+13h in August): 23:30 UTC on the 19th is already
-- 12:30 on the 20th where he is, so these are two different mornings.
-- Under UTC they would be one, and under Europe/Berlin (the session's
-- zone, which is what a naive cast resolves in) they would also be one.
update profiles set tz_offset = 780 where id='22222222-2222-2222-2222-222222222222';
insert into posts (user_id, drink, created_at) values
  ('22222222-2222-2222-2222-222222222222','Long black','2026-08-19 20:00+00'),   -- 20 Aug, 09:00 NZ
  ('22222222-2222-2222-2222-222222222222','Long black','2026-08-19 23:30+00');   -- 20 Aug, 12:30 NZ
do $$
begin
  assert (select count(*) = 1 from daily_firsts
           where user_id='22222222-2222-2222-2222-222222222222'),
    'both cups are the same New Zealand day — one award';
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
    'the next New Zealand morning pays again';
end $$;
\echo 'T3 PASS'

\echo '--- T4: deleting the pour keeps the award and does not re-open the day ---'
do $$
declare pid uuid; before int;
begin
  select points into before from profiles where id='11111111-1111-1111-1111-111111111111';
  select id into pid from posts
    where user_id='11111111-1111-1111-1111-111111111111'
      and created_at = '2026-08-20 07:30+00';
  delete from posts where id = pid;

  assert (select count(*) = 2 from daily_firsts
           where user_id='11111111-1111-1111-1111-111111111111'),
    'the award outlives the pour that earned it';
  assert (select post_id is null from daily_firsts
           where user_id='11111111-1111-1111-1111-111111111111' and day = date '2026-08-20'),
    'on delete set null, not cascade — cascade would delete the award';
  assert (select points = before - 10 from profiles
           where id='11111111-1111-1111-1111-111111111111'),
    'only the pour''s own 10 goes away; the morning stays paid';
end $$;

-- And posting again that same day must not pay a second time.
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Filter','2026-08-20 08:00+00');
do $$
begin
  assert (select count(*) = 2 from daily_firsts
           where user_id='11111111-1111-1111-1111-111111111111'),
    'delete-and-repost must not farm the bonus';
end $$;
\echo 'T4 PASS'

\echo '--- T5: a friend hears about a pour; a stranger does not ---'
delete from notifications;
-- Cem follows Ann, accepted. Dee follows nobody.
insert into follows (follower_id, followee_id, status) values
  ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','accepted');
delete from notifications;   -- drop the follow/reciprocate rows themselves

insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Cortado','2026-08-21 07:00+00');
do $$
begin
  assert (select count(*) = 1 from notifications
           where type='friend_pour' and user_id='33333333-3333-3333-3333-333333333333'),
    'Cem follows Ann and should hear about her pour';
  assert (select count(*) = 0 from notifications
           where type='friend_pour' and user_id='44444444-4444-4444-4444-444444444444'),
    'Dee follows nobody and should hear nothing';
  assert (select count(*) = 0 from notifications
           where type='friend_pour' and user_id='11111111-1111-1111-1111-111111111111'),
    'nobody is told about their own coffee';
  assert (select post_id is not null and body = 'poured a coffee' from notifications
           where type='friend_pour' and user_id='33333333-3333-3333-3333-333333333333'),
    'the row must deep-link to the pour';
end $$;
\echo 'T5 PASS'

\echo '--- T6: a pending request is not a friend, and a block is honoured ---'
delete from notifications;
insert into follows (follower_id, followee_id, status) values
  ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','pending');
delete from notifications;

insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Macchiato','2026-08-21 11:00+00');
do $$
begin
  assert (select count(*) = 0 from notifications
           where type='friend_pour' and user_id='44444444-4444-4444-4444-444444444444'),
    'a request that has not been accepted is not a follow';
end $$;

-- Cem blocks Ann. The accepted follow is still there; the news stops.
delete from notifications;
insert into blocks (blocker_id, blocked_id) values
  ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111');
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Ristretto','2026-08-21 15:00+00');
do $$
begin
  assert (select count(*) = 0 from notifications where type='friend_pour'),
    'a block stops the news in both directions';
end $$;
delete from blocks;
\echo 'T6 PASS'

\echo '--- T7: notify_friends gates PUSH only, never the inbox row ---'
delete from notifications;
update profiles set notify_friends = false where id='33333333-3333-3333-3333-333333333333';
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Lungo','2026-08-22 07:00+00');
do $$
begin
  assert (select count(*) = 1 from notifications
           where type='friend_pour' and user_id='33333333-3333-3333-3333-333333333333'),
    'the inbox row is written either way — the switch is about the phone';
  assert (select notify_social from profiles where id='33333333-3333-3333-3333-333333333333'),
    'and turning friends off must not have touched the social switch';
end $$;
update profiles set notify_friends = true where id='33333333-3333-3333-3333-333333333333';
\echo 'T7 PASS'

\echo '--- T8: the trigger cannot be called, and the table cannot be written ---'
do $$
begin
  assert not has_function_privilege('authenticated','award_daily_first()','execute'),
    'a browser must not be able to award itself points';
  assert not has_function_privilege('authenticated','notify_on_post()','execute'),
    'a browser must not be able to fan out notifications';
  -- Deliberately NOT has_table_privilege() here. The migration revokes
  -- insert/update/delete, but run.sh re-applies Supabase's blanket
  -- `grant all on all tables` afterwards, exactly as the platform's
  -- default privileges do — so the grant is not what is load-bearing.
  -- RLS is, and that is what the block below actually exercises.
  assert (select count(*) = 0 from pg_policies
           where tablename='daily_firsts' and cmd <> 'SELECT'),
    'there must be no policy that lets anybody write an award';
end $$;

-- RLS is the lock that matters: even with the grant, there is no insert
-- policy, so there is nothing for a client's insert to satisfy.
begin;
  set local role authenticated;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';
  do $$
  begin
    begin
      insert into daily_firsts (user_id, day, points)
      values ('11111111-1111-1111-1111-111111111111', date '2030-01-01', 9999);
      raise exception 'a client wrote an award — the surface is open';
    exception
      when insufficient_privilege then null;   -- what we want
      when others then
        if sqlerrm like '%row-level security%' then null; else raise; end if;
    end;
  end $$;
rollback;
\echo 'T8 PASS'

\echo '--- T9: the migration is re-runnable ---'
create temp table awards_before as select * from daily_firsts;
\ir ../step-1.30.sql
do $$
begin
  assert (select count(*) = 0 from (
            (table awards_before except table daily_firsts)
            union all
            (table daily_firsts except table awards_before)) d),
    'running it twice must not duplicate, drop or alter a single award';
  assert (select count(*) = 1 from pg_trigger
           where tgname='posts_daily_first' and not tgisinternal),
    'exactly one award trigger on posts';
  assert (select count(*) = 1 from pg_trigger
           where tgname='posts_friend_notify' and not tgisinternal),
    'exactly one friend-pour trigger on posts';
end $$;
\echo 'T9 PASS'

\echo 'step-1.30: ALL PASS'
