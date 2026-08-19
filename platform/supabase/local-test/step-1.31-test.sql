\set ON_ERROR_STOP on
\pset pager off

-- ============================================================
-- step-1.31: first in Crema, not first for yourself
--
--   ./platform/supabase/local-test/run.sh step-1.31-test.sql
--
-- The point of the file is that "first" now means two different things
-- and both are right: ONE global race a day on the Berlin clock, and a
-- per-person marker on each person's own clock that gates the friend
-- notification. The cluster runs Europe/Berlin (run.sh) — T4 uses a
-- New Zealand user specifically so the two cannot be confused.
-- ============================================================

-- ---------- fixtures ----------
delete from daily_champions; delete from daily_firsts;
delete from notifications; delete from reactions; delete from likes;
delete from comments; delete from blocks; delete from follows; delete from posts;
delete from podium_wins; delete from podium_places;
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

\echo '--- T1: the shape of the correction ---'
do $$
begin
  assert (select count(*) = 1 from information_schema.tables where table_name='daily_champions'),
    'daily_champions should exist';
  assert (select relrowsecurity from pg_class where relname='daily_champions'),
    'RLS must be enabled';
  assert (select count(*) = 0 from pg_policies
           where tablename='daily_champions' and cmd <> 'SELECT'),
    'there must be no policy that lets anybody write a championship';
  -- The primary key on `day` alone IS the rule. If this ever becomes a
  -- composite key the race silently turns back into an allowance.
  assert (select array_length(conkey,1) = 1 from pg_constraint
           where conrelid='daily_champions'::regclass and contype='p'),
    'the primary key must be day ALONE — that is what makes it one a day';
  assert (select count(*) = 0 from information_schema.columns
           where table_name='daily_firsts' and column_name='points'),
    'daily_firsts must no longer carry points';
  assert (select count(*) = 0 from pg_trigger
           where tgname='posts_friend_notify' and not tgisinternal),
    'the every-pour friend notification must be gone';
  assert (select count(*) = 0 from pg_proc where proname='notify_on_post'),
    'and so must its function';
  assert crema_day('2026-08-19 21:30+00') = date '2026-08-19',
    '23:30 Berlin is still the 19th';
  assert crema_day('2026-08-19 22:30+00') = date '2026-08-20',
    '00:30 Berlin is the 20th — the boundary is Berlin, not UTC';
  assert crema_day(now()) = podium_day(),
    'crema_day() and podium_day() must agree, or the race and the podium run on different days';
end $$;
\echo 'T1 PASS'

\echo '--- T2: exactly one champion a day, and it is whoever was up first ---'
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Flat white','2026-08-19 05:10+00');   -- 07:10 Berlin
insert into posts (user_id, drink, created_at) values
  ('22222222-2222-2222-2222-222222222222','Espresso',  '2026-08-19 05:40+00');   -- 07:40 Berlin
insert into posts (user_id, drink, created_at) values
  ('33333333-3333-3333-3333-333333333333','Filter',    '2026-08-19 06:00+00');   -- 08:00 Berlin
do $$
begin
  assert (select count(*) = 1 from daily_champions where day = date '2026-08-19'),
    'one champion a day, not one per person';
  assert (select user_id = '11111111-1111-1111-1111-111111111111'
            from daily_champions where day = date '2026-08-19'),
    'Ann was up first and should have it';
  assert (select points = 20 from daily_champions where day = date '2026-08-19'),
    'worth crema_first_pour_points()';
  -- Ann: 10 for the pour + 20 for winning. Bo and Cem: 10, and nothing else.
  assert (select points = 30 from profiles where id='11111111-1111-1111-1111-111111111111'),
    'the win must move the score in the same transaction';
  assert (select points = 10 from profiles where id='22222222-2222-2222-2222-222222222222'),
    'second up that day gets the ordinary 10 and no bonus';
  assert (select points = 10 from profiles where id='33333333-3333-3333-3333-333333333333'),
    'and so does third';
end $$;

-- Ann pouring again the same day must not win twice.
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Cortado','2026-08-19 09:00+00');
do $$
begin
  assert (select count(*) = 1 from daily_champions where day = date '2026-08-19'),
    'the day is already decided';
  assert (select points = 40 from profiles where id='11111111-1111-1111-1111-111111111111'),
    'the second cup pays 10 and nothing more';
end $$;

-- A new day is a new race, and Bo gets up first this time.
insert into posts (user_id, drink, created_at) values
  ('22222222-2222-2222-2222-222222222222','Piccolo','2026-08-20 04:30+00');
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Latte',  '2026-08-20 05:30+00');
do $$
begin
  assert (select count(*) = 2 from daily_champions),
    'a new day is a new race';
  assert (select user_id = '22222222-2222-2222-2222-222222222222'
            from daily_champions where day = date '2026-08-20'),
    'Bo was first on the 20th';
  -- Bo now has two pours (10 each) and one win (20).
  assert (select points = 40 from profiles where id='22222222-2222-2222-2222-222222222222'),
    'Bo: 2 pours (20) + one win (20) = 40, got '
      || (select points from profiles where id='22222222-2222-2222-2222-222222222222')::text;
end $$;
\echo 'T2 PASS'

\echo '--- T3: the champion is told, and nobody else is ---'
do $$
begin
  assert (select count(*) = 1 from notifications
           where type='daily_champion' and user_id='22222222-2222-2222-2222-222222222222'),
    'Bo should have been told he was first';
  assert (select actor_id is null and post_id is not null from notifications
           where type='daily_champion' and user_id='22222222-2222-2222-2222-222222222222'),
    'no actor — a standing did this, not a person — but it links to the pour';
  assert (select count(*) = 0 from notifications
           where type='daily_champion' and user_id='33333333-3333-3333-3333-333333333333'),
    'losing a race you did not know you were in is not a notification';
  assert (select count(*) = 2 from notifications where type='daily_champion'),
    'one notification per championship, no more';
end $$;
\echo 'T3 PASS'

\echo '--- T4: the two notions of "first" are different, and both are right ---'
-- Bo moves to Auckland (+13h). A pour at 21:00 UTC on the 20th is 10:00
-- on the 21st for him — his own new morning — but still the 20th in
-- Berlin, where the 20th's race was decided hours ago. He should get a
-- daily_firsts row (his morning) and NO championship (Berlin's day is
-- taken).
update profiles set tz_offset = 780 where id='22222222-2222-2222-2222-222222222222';
insert into posts (user_id, drink, created_at) values
  ('22222222-2222-2222-2222-222222222222','Long black','2026-08-20 21:00+00');
do $$
begin
  assert (select count(*) = 1 from daily_firsts
           where user_id='22222222-2222-2222-2222-222222222222' and day = date '2026-08-21'),
    'it is the 21st where Bo is, so it is his first pour of that day';
  assert (select user_id = '22222222-2222-2222-2222-222222222222'
            from daily_champions where day = date '2026-08-20'),
    'but Berlin''s 20th was already won, by Bo himself, earlier';
  assert (select count(*) = 0 from daily_champions where day = date '2026-08-21'),
    'and Berlin has not reached the 21st yet — no championship exists for it';
end $$;
\echo 'T4 PASS'

\echo '--- T5: a friend hears about the FIRST pour of the day and nothing after ---'
delete from notifications;
insert into follows (follower_id, followee_id, status) values
  ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','accepted');
delete from notifications;   -- drop the follow rows themselves

-- Ann's first of the 22nd, then two more the same day.
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Cortado',  '2026-08-22 05:00+00');
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Espresso', '2026-08-22 09:00+00'),
  ('11111111-1111-1111-1111-111111111111','Macchiato','2026-08-22 14:00+00');
do $$
begin
  assert (select count(*) = 1 from notifications
           where type='friend_pour' and user_id='33333333-3333-3333-3333-333333333333'),
    'THREE pours, ONE notification — this is the whole of correction 2, got '
      || (select count(*) from notifications where type='friend_pour')::text;
  assert (select body = 'poured the first coffee of the day' from notifications
           where type='friend_pour' and user_id='33333333-3333-3333-3333-333333333333'),
    'and it should say which pour it is about';
end $$;

-- The next day is news again.
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Filter','2026-08-23 05:00+00');
do $$
begin
  assert (select count(*) = 2 from notifications
           where type='friend_pour' and user_id='33333333-3333-3333-3333-333333333333'),
    'a new morning is news again';
end $$;
\echo 'T5 PASS'

\echo '--- T6: the friend rules step-1.30 established still hold ---'
delete from notifications;
-- A pending request is not a friend.
insert into follows (follower_id, followee_id, status) values
  ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','pending');
delete from notifications;
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Ristretto','2026-08-24 05:00+00');
do $$
begin
  assert (select count(*) = 0 from notifications
           where type='friend_pour' and user_id='44444444-4444-4444-4444-444444444444'),
    'a request that has not been accepted is not a follow';
  assert (select count(*) = 1 from notifications
           where type='friend_pour' and user_id='33333333-3333-3333-3333-333333333333'),
    'and Cem still hears about it';
  assert (select count(*) = 0 from notifications
           where type='friend_pour' and user_id='11111111-1111-1111-1111-111111111111'),
    'nobody is told about their own coffee';
end $$;

-- A block stops it in both directions.
delete from notifications;
insert into blocks (blocker_id, blocked_id) values
  ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111');
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Lungo','2026-08-25 05:00+00');
do $$
begin
  assert (select count(*) = 0 from notifications where type='friend_pour'),
    'a block stops the news in both directions';
end $$;
delete from blocks;

-- And notify_friends still gates PUSH only, never the inbox row.
delete from notifications;
update profiles set notify_friends = false where id='33333333-3333-3333-3333-333333333333';
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Flat white','2026-08-26 05:00+00');
do $$
begin
  assert (select count(*) = 1 from notifications
           where type='friend_pour' and user_id='33333333-3333-3333-3333-333333333333'),
    'the inbox row is written either way — the switch is about the phone';
end $$;
update profiles set notify_friends = true where id='33333333-3333-3333-3333-333333333333';
\echo 'T6 PASS'

\echo '--- T7: deleting the winning pour keeps the championship ---'
do $$
declare pid uuid; before int;
begin
  select points into before from profiles where id='11111111-1111-1111-1111-111111111111';
  select post_id into pid from daily_champions where day = date '2026-08-19';
  delete from posts where id = pid;

  assert (select count(*) = 1 from daily_champions where day = date '2026-08-19'),
    'the championship outlives the pour that won it';
  assert (select post_id is null from daily_champions where day = date '2026-08-19'),
    'on delete set null, not cascade';
  assert (select points = before - 10 from profiles where id='11111111-1111-1111-1111-111111111111'),
    'only the pour''s own 10 goes away; the win stays paid';
end $$;

-- And re-posting that day must not re-open the race.
insert into posts (user_id, drink, created_at) values
  ('22222222-2222-2222-2222-222222222222','Latte','2026-08-19 05:10+00');
do $$
begin
  assert (select count(*) = 1 from daily_champions where day = date '2026-08-19'),
    'delete-and-repost must not hand the day to somebody else';
  assert (select user_id = '11111111-1111-1111-1111-111111111111'
            from daily_champions where day = date '2026-08-19'),
    'Ann still won the 19th';
end $$;
\echo 'T7 PASS'

\echo '--- T8: the surface is locked ---'
do $$
begin
  assert not has_function_privilege('authenticated','award_daily_champion()','execute'),
    'a browser must not be able to award itself a championship';
  assert not has_function_privilege('authenticated','notify_daily_champion()','execute'),
    'nor announce one';
  assert not has_function_privilege('authenticated','notify_on_daily_first()','execute'),
    'nor fan out notifications';
end $$;

begin;
  set local role authenticated;
  set local "test.uid" = '44444444-4444-4444-4444-444444444444';
  do $$
  begin
    begin
      insert into daily_champions (day, user_id, points)
      values (date '2030-01-01', '44444444-4444-4444-4444-444444444444', 9999);
      raise exception 'a client wrote a championship — the surface is open';
    exception
      when insufficient_privilege then null;
      when others then
        if sqlerrm like '%row-level security%' then null; else raise; end if;
    end;
  end $$;
rollback;
\echo 'T8 PASS'

\echo '--- T9: re-running the whole migration is safe ---'
create temp table champs_before as select * from daily_champions;
create temp table scores_before as select id, points from profiles;
\ir ../step-1.31.sql
do $$
begin
  assert (select count(*) = 0 from (
            (table champs_before except table daily_champions)
            union all
            (table daily_champions except table champs_before)) d),
    'running it twice must not re-decide, duplicate or drop a championship';
  assert (select count(*) = 0 from (
            (table scores_before except select id, points from profiles)
            union all
            (select id, points from profiles except table scores_before)) d),
    'and it must not move a single score the second time';
end $$;
\echo 'T9 PASS'

\echo 'step-1.31: ALL PASS'
