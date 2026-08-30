\set ON_ERROR_STOP on
\pset pager off

-- ============================================================
-- A friend's every pour
--
--   ./platform/supabase/local-test/run.sh friend-pour-test.sql
--
-- migrations/20260830103000_friend_pour_every_pour.sql undoes half of
-- step-1.31: following somebody means hearing about the coffee they
-- make, all of it, not only the first cup of their morning.
--
-- Three things have to be true at once and this file is here because
-- the last two are the ones a rewrite quietly loses:
--
--   1. every pour is news, and it says 'poured a coffee'
--   2. WHO hears it is unchanged — accepted follows only, never
--      yourself, never across a block
--   3. `notify_friends` still means something. It stopped meaning
--      anything on 2026-08-27, when step-1.32 rewrote
--      push_on_notification() from step-1.16's copy and dropped the
--      branch step-1.30 had added to it. Nothing noticed, because
--      nothing asserted it. T5 is that assertion.
--
-- net.http_post is faked by stub.sql, which records every call in
-- net.calls — the last thing Postgres does before the Edge Function
-- takes over, and so the right place to prove a phone would ring.
-- ============================================================

-- ---------- fixtures ----------
delete from net.calls;
delete from daily_champions; delete from daily_firsts;
delete from notifications; delete from reactions; delete from likes;
delete from comments; delete from blocks; delete from follows;
delete from push_subscriptions; delete from posts;
delete from profiles; delete from auth.users;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','ann@e.com'),
  ('22222222-2222-2222-2222-222222222222','bo@e.com'),
  ('33333333-3333-3333-3333-333333333333','cem@e.com');
-- Bo reads German, Ann and Cem do not. tz_offset 0 everywhere: this
-- file is not about the clock — step-1.31-test.sql is.
insert into profiles (id, handle, name, tz_offset, notify_social, notify_friends) values
  ('11111111-1111-1111-1111-111111111111','ann','Ann',0,true,true),
  ('22222222-2222-2222-2222-222222222222','bo', 'Bo', 0,true,true),
  ('33333333-3333-3333-3333-333333333333','cem','Cem',0,true,true);

-- Bo and Cem follow Ann. Bo has a phone; Cem does not.
insert into follows (follower_id, followee_id, status) values
  ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','accepted'),
  ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','accepted');
insert into push_subscriptions (user_id, endpoint, p256dh, auth, lang) values
  ('22222222-2222-2222-2222-222222222222','https://push.example/bo','p256dh-bo','auth-bo','de');

select push_set_config('push_endpoint','https://stub.local/functions/v1/send-push');
select push_set_config('push_secret','test-secret');

delete from notifications;   -- the follow rows themselves

\echo '--- T1: the shape of the change ---'
do $$
begin
  assert (select count(*) = 1 from pg_trigger
           where tgname='posts_friend_notify' and not tgisinternal),
    'the friend notification must fire off posts again';
  assert (select count(*) = 1 from pg_proc where proname='notify_on_post'),
    'and its function must exist';
  assert (select count(*) = 0 from pg_trigger
           where tgname='daily_firsts_notify' and not tgisinternal),
    'and it must no longer ALSO fire off daily_firsts — that would double every first pour';
  assert (select count(*) = 0 from pg_proc where proname='notify_on_daily_first'),
    'the once-a-morning function is gone, not merely unhooked';
  -- What this migration is careful NOT to touch.
  assert (select count(*) = 1 from pg_trigger
           where tgname='posts_daily_first' and not tgisinternal),
    'daily_firsts still records which pour was somebody''s own first of the day';
  assert (select count(*) = 1 from information_schema.tables where table_name='daily_champions'),
    'the global race is none of this migration''s business';
end $$;
\echo 'T1 PASS'

\echo '--- T2: three pours in a morning are three notifications ---'
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Cortado',  '2026-08-22 05:00+00');
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Espresso', '2026-08-22 09:00+00'),
  ('11111111-1111-1111-1111-111111111111','Macchiato','2026-08-22 14:00+00');
do $$
begin
  assert (select count(*) = 3 from notifications
           where type='friend_pour' and user_id='22222222-2222-2222-2222-222222222222'),
    'THREE pours, THREE notifications — this is the whole ask, got '
      || (select count(*) from notifications
           where type='friend_pour' and user_id='22222222-2222-2222-2222-222222222222')::text;
  assert (select count(*) = 3 from notifications
           where type='friend_pour' and user_id='33333333-3333-3333-3333-333333333333'),
    'and every accepted follower hears each of them';
  assert (select count(*) = 3 from notifications
           where type='friend_pour' and body='poured a coffee'
             and user_id='22222222-2222-2222-2222-222222222222'),
    'the wording is no longer about the first cup';
  assert (select count(*) = 0 from notifications
           where body='poured the first coffee of the day'),
    'and nothing writes the old sentence any more';
  assert (select count(*) = 3 from notifications
           where type='friend_pour' and user_id='22222222-2222-2222-2222-222222222222'
             and post_id is not null),
    'each one carries its own pour, or the phone has nowhere to deep-link to';
end $$;
\echo 'T2 PASS'

\echo '--- T3: who hears it is unchanged ---'
delete from notifications;
-- Nobody is told about their own coffee. `no_self_follow` (step-1.8)
-- makes the row unrepresentable in the first place, which is why the
-- guard inside notify_on_post() is belt and braces rather than the
-- thing holding this up — so the assertion is on the outcome.
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Ristretto','2026-08-23 05:00+00');
do $$
begin
  assert (select count(*) = 0 from notifications
           where type='friend_pour' and user_id='11111111-1111-1111-1111-111111111111'),
    'Ann is not notified of her own pour, however often this now fires';
  assert (select count(*) = 2 from notifications where type='friend_pour'),
    'Bo and Cem, and nobody else';
end $$;

update follows set status='pending'
 where follower_id='33333333-3333-3333-3333-333333333333';
delete from notifications;
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Lungo','2026-08-23 09:00+00');
do $$
begin
  assert (select count(*) = 0 from notifications
           where type='friend_pour' and user_id='33333333-3333-3333-3333-333333333333'),
    'a request that has not been accepted is not a follow';
end $$;
update follows set status='accepted'
 where follower_id='33333333-3333-3333-3333-333333333333';

-- A block stops it in both directions.
delete from notifications;
insert into blocks (blocker_id, blocked_id) values
  ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111');
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Filter','2026-08-23 12:00+00');
do $$
begin
  assert (select count(*) = 0 from notifications
           where type='friend_pour' and user_id='22222222-2222-2222-2222-222222222222'),
    'a block stops the news';
  assert (select count(*) = 1 from notifications
           where type='friend_pour' and user_id='33333333-3333-3333-3333-333333333333'),
    'and stops it for the blocker only';
end $$;
delete from blocks;
\echo 'T3 PASS'

\echo '--- T4: it reaches the phone, in the reader''s language, on one tag ---'
delete from notifications; delete from net.calls;
insert into posts (id, user_id, drink, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Latte','2026-08-24 05:00+00');
do $$
declare row jsonb;
begin
  -- One call: Bo has a device, Cem does not, and push_send() returns
  -- early on an empty row set.
  assert (select count(*) = 1 from net.calls),
    'one call, for the one registered device, got '
      || (select count(*) from net.calls)::text;
  select (body->'rows'->0) into row from net.calls order by id desc limit 1;
  assert row->>'endpoint' = 'https://push.example/bo',
    'addressed to Bo''s device';
  assert row->>'body' = 'Ann hat einen Kaffee gemacht',
    format('Bo reads German, so the banner does too, got: %s', row->>'body');
  assert row->>'url' = './#p/aaaaaaaa-0000-0000-0000-000000000001',
    'tapping it opens the pour';
  assert row->>'tag' = 'friend_pour:11111111-1111-1111-1111-111111111111',
    'per (type, actor): a friend with three cups before ten is one banner, not three';
end $$;

-- The second and third cup replace that banner rather than stacking.
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Espresso','2026-08-24 09:00+00');
do $$
begin
  assert (select count(*) = 2 from net.calls),
    'the second pour is its own push';
  assert (select count(distinct body->'rows'->0->>'tag') = 1 from net.calls),
    'but it carries the same tag, so the phone shows one line';
end $$;
\echo 'T4 PASS'

\echo '--- T5: notify_friends is a switch again, and only over the phone ---'
-- The regression step-1.32 introduced: friend_pour push followed
-- notify_social, so turning "When friends pour" off did nothing. Both
-- halves are asserted — the switch that must work, and the switch that
-- must not be the one consulted.
delete from notifications; delete from net.calls;
update profiles set notify_friends = false
 where id='22222222-2222-2222-2222-222222222222';
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Flat white','2026-08-25 05:00+00');
do $$
begin
  assert (select count(*) = 1 from notifications
           where type='friend_pour' and user_id='22222222-2222-2222-2222-222222222222'),
    'the inbox row is written either way — the switch is about the phone';
  assert (select count(*) = 0 from net.calls),
    'but the phone stays quiet. If this fails, the notify_friends branch '
    'has been rewritten away again — see step-1.32 §4';
end $$;

-- ...and notify_social is not the switch this type answers to.
update profiles set notify_friends = true, notify_social = false
 where id='22222222-2222-2222-2222-222222222222';
delete from notifications; delete from net.calls;
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Piccolo','2026-08-25 09:00+00');
do $$
begin
  assert (select count(*) = 1 from net.calls),
    'someone who muted likes and comments has not muted their friends'' coffee';
end $$;
update profiles set notify_social = true
 where id='22222222-2222-2222-2222-222222222222';
\echo 'T5 PASS'

\echo '--- T6: re-running the migration is safe ---'
delete from notifications; delete from net.calls;
\ir ../migrations/20260830103000_friend_pour_every_pour.sql
insert into posts (user_id, drink, created_at) values
  ('11111111-1111-1111-1111-111111111111','Cortado','2026-08-26 05:00+00');
do $$
begin
  assert (select count(*) = 1 from notifications
           where type='friend_pour' and user_id='22222222-2222-2222-2222-222222222222'),
    'running it twice must not double the trigger and so double the news';
  assert (select count(*) = 1 from pg_trigger
           where tgname='posts_friend_notify' and not tgisinternal),
    'one trigger, still';
end $$;
\echo 'T6 PASS'

\echo 'friend-pour: ALL PASS'
