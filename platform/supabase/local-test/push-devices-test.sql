\set ON_ERROR_STOP on
\pset pager off

-- ============================================================
-- Does a notification reach a PHONE as well as a browser?
--
--   ./local-test/run.sh push-devices-test.sql      (from platform/supabase)
--
-- migrations/20260831140000_push_reaches_the_phone.sql rewrites all four
-- senders. That is the exact shape of D-2026-08-30-02 — step-1.32 rewrote
-- push_on_notification() from an older copy, dropped the notify_friends
-- branch, and nobody noticed for three days — so this file asserts every
-- property the rewrite could have lost, not just the new one.
--
--   T1  the view exists, covers both tables, and is NOT readable by
--       anon/authenticated. A push endpoint is a routing address for a
--       named person's phone.
--   T2  a like reaches a browser AND a phone, in one call, addressed
--       correctly for each.
--   T3  the wording, the deep link and the collapsing tag survived.
--   T4  per-device language survived: the same event, two devices, two
--       languages.
--   T5  the notify_friends branch survived. This is the assertion that
--       would have caught 2026-08-27.
--   T6  notify_social off still means silence.
--   T7  the evening reminder reaches a phone, on the phone's own clock.
--
-- net.http_post is faked by stub.sql and records into net.calls, which is
-- the last thing Postgres does before send-push takes over.
-- ============================================================

-- push_send() refuses when Vault has no endpoint, and says so rather
-- than failing — which would make every assertion below pass vacuously.
select push_set_config('push_endpoint','https://stub.local/functions/v1/send-push');
select push_set_config('push_secret','test-secret');

delete from net.calls;
delete from notifications; delete from likes; delete from posts;
delete from native_push_tokens; delete from push_subscriptions;
delete from follows;
delete from profiles; delete from auth.users;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','ann@e.com'),
  ('22222222-2222-2222-2222-222222222222','bo@e.com');
insert into profiles (id, handle, name, notify_social, notify_friends, notify_streak, tz_offset) values
  ('11111111-1111-1111-1111-111111111111','ann','Ann', true, true, true, 0),
  ('22222222-2222-2222-2222-222222222222','bo', 'Bo',  true, true, true, 0);

-- Ann reads Crema in two places: a browser on the laptop and the app on
-- the phone. That is the whole point of this migration.
insert into push_subscriptions (user_id, endpoint, p256dh, auth, lang) values
  ('11111111-1111-1111-1111-111111111111','https://push.example/ann','p256dh-ann','auth-ann','en');
insert into native_push_tokens (user_id, token, platform, lang) values
  ('11111111-1111-1111-1111-111111111111','fcm-token-ann','android','en');

\echo '--- T1: one list of devices, and nobody else may read it ---'
do $$
begin
  assert (select count(*) = 1 from information_schema.views where table_name='push_devices'),
    'push_devices must exist';
  assert (select count(*) = 2 from push_devices where user_id='11111111-1111-1111-1111-111111111111'),
    'the view must cover both tables';
  assert (select count(*) = 1 from push_devices where kind='native' and token='fcm-token-ann'),
    'a native row must carry its token';
  assert (select count(*) = 1 from push_devices where kind='web' and endpoint='https://push.example/ann'),
    'a web row must carry its endpoint';
  -- The revoke is the only thing between this view and PostgREST.
  assert not has_table_privilege('authenticated','push_devices','select'),
    'authenticated must NOT be able to select push_devices';
  assert not has_table_privilege('anon','push_devices','select'),
    'anon must NOT be able to select push_devices';
end $$;

\echo '--- T2/T3: a like reaches the browser and the phone, in one call ---'
insert into posts (id, user_id, drink, caption)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','Latte','x');
delete from net.calls;
insert into likes (user_id, post_id)
  values ('22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

-- A like lands two notifications at once — the like itself and the
-- podium place it may have just moved — so the call to look at is the one
-- whose tag says `like:`, not "the last one". Asserting on a count here
-- would be asserting on the podium's behaviour by accident.
do $$
declare rows jsonb; web jsonb; nat jsonb;
begin
  select (body->'rows') into rows from net.calls
   where body->'rows'->0->>'tag' like 'like:%' order by id desc limit 1;
  assert rows is not null, 'the like produced no http_post at all';
  assert jsonb_array_length(rows) = 2, 'both of Ann''s devices, in one payload';

  select r into web from jsonb_array_elements(rows) r where r ? 'endpoint';
  select r into nat from jsonb_array_elements(rows) r where r ? 'token';
  assert web is not null, 'the browser must still be addressed';
  assert nat is not null, 'the phone must be addressed too';

  -- Addressed correctly, and NOT addressed the other way: a row carrying
  -- both keys would be delivered twice by send-push.
  assert web->>'endpoint' = 'https://push.example/ann', 'web row keeps its endpoint';
  assert web->>'p256dh' = 'p256dh-ann' and web->>'auth' = 'auth-ann', 'web row keeps its keys';
  assert not (web ? 'token'), 'a web row must not carry a token';
  assert nat->>'token' = 'fcm-token-ann', 'native row carries the FCM token';
  assert nat->>'platform' = 'android', 'native row says which push service';
  assert not (nat ? 'endpoint'), 'a native row must not carry an endpoint';

  -- T3: everything step-1.16 decided about the payload, on both rows.
  assert web->>'title' = 'Crema' and nat->>'title' = 'Crema', 'title';
  assert web->>'body' = 'Bo liked your pour', 'the wording did not move: ' || coalesce(web->>'body','(null)');
  assert nat->>'body' = web->>'body', 'both devices get the same sentence';
  assert web->>'url' = './#p/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'the deep link survived';
  assert nat->>'url' = web->>'url', 'the phone gets the same deep link';
  assert web->>'tag' = 'like:22222222-2222-2222-2222-222222222222', 'the collapsing tag survived';
  assert nat->>'tag' = web->>'tag', 'the phone collapses the same way';
end $$;

\echo '--- T4: the language is the device''s, not the account''s ---'
update native_push_tokens set lang = 'de' where token = 'fcm-token-ann';
delete from net.calls;
delete from likes;
insert into likes (user_id, post_id)
  values ('22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
do $$
declare rows jsonb; web text; nat text;
begin
  select (body->'rows') into rows from net.calls
   where body->'rows'->0->>'tag' like 'like:%' order by id desc limit 1;
  select r->>'body' into web from jsonb_array_elements(rows) r where r ? 'endpoint';
  select r->>'body' into nat from jsonb_array_elements(rows) r where r ? 'token';
  assert web = 'Bo liked your pour', 'the laptop is still English: ' || coalesce(web,'(null)');
  assert nat = 'Bo gefällt dein Kaffee', 'the phone is German: ' || coalesce(nat,'(null)');
end $$;
update native_push_tokens set lang = 'en' where token = 'fcm-token-ann';

\echo '--- T5: the notify_friends branch is still there (D-2026-08-30-02) ---'
insert into follows (follower_id, followee_id, status)
  values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','accepted');
-- Off for friends, on for everything else. If the branch were lost, this
-- would fall through to notify_social and a push would go out.
update profiles set notify_friends = false, notify_social = true
 where id = '11111111-1111-1111-1111-111111111111';
delete from net.calls;
insert into posts (id, user_id, drink, caption)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222','Flat White','y');
do $$
begin
  assert (select count(*) = 1 from notifications
           where user_id='11111111-1111-1111-1111-111111111111' and type='friend_pour'),
    'the inbox row is written whatever the push switch says';
  assert (select count(*) = 0 from net.calls
           where body->'rows'->0->>'tag' like 'friend_pour:%'),
    'notify_friends=false must silence the PUSH, and only the push';
end $$;

update profiles set notify_friends = true where id = '11111111-1111-1111-1111-111111111111';
delete from net.calls;
insert into posts (id, user_id, drink, caption)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-2222-2222-222222222222','Espresso','z');
do $$
declare rows jsonb;
begin
  select (body->'rows') into rows from net.calls
   where body->'rows'->0->>'tag' like 'friend_pour:%' order by id desc limit 1;
  assert rows is not null, 'notify_friends=true must send again';
  assert jsonb_array_length(rows) = 2, 'a friend''s pour reaches the phone as well';
  assert (select count(*) = 1 from jsonb_array_elements(rows) r where r ? 'token'),
    'exactly one native row';
end $$;

\echo '--- T6: notify_social off is still silence ---'
update profiles set notify_social = false where id = '11111111-1111-1111-1111-111111111111';
delete from net.calls; delete from likes;
insert into likes (user_id, post_id)
  values ('22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
do $$
begin
  assert (select count(*) = 0 from net.calls
           where body->'rows'->0->>'tag' like 'like:%'),
    'notify_social=false must send nothing for a like';
end $$;
update profiles set notify_social = true where id = '11111111-1111-1111-1111-111111111111';

\echo '--- T7: the evening reminder reaches the phone, on the phone''s clock ---'
-- Both devices are set to whatever offset makes it 19:00 where they are,
-- so the hour test in the sender fires without anyone waiting for 7pm.
do $$
declare want int;
begin
  -- minutes to add to now() to land on 19:00 local
  want := (19 - extract(hour from now())::int) * 60 - extract(minute from now())::int;
  update push_subscriptions set tz_offset = want;
  update native_push_tokens  set tz_offset = want;
end $$;
-- A streak that is at risk: two days running, ending yesterday, nothing
-- today. TWO, not one — streak_at_risk() returns 0 below a run of 2,
-- because "your 1-day streak ends tonight" is a notification nobody keeps
-- enabled (step-1.16).
delete from posts;
insert into posts (id, user_id, drink, caption, created_at) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-1111-1111-111111111111',
   'Latte','yesterday',          now() - interval '1 day'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-1111-1111-111111111111',
   'Latte','the day before',     now() - interval '2 days');
delete from net.calls;
select push_streak_reminders();
do $$
declare rows jsonb;
begin
  assert (select count(*) = 1 from net.calls
           where body->'rows'->0->>'tag' = 'streak'), 'the reminder went out';
  select (body->'rows') into rows from net.calls
   where body->'rows'->0->>'tag' = 'streak' order by id desc limit 1;
  assert jsonb_array_length(rows) = 2, 'to the laptop and the phone';
  assert (select count(*) = 1 from jsonb_array_elements(rows) r
           where r ? 'token' and r->>'tag' = 'streak'), 'the phone row is a streak reminder';
end $$;

\echo 'push-devices-test: all assertions passed'
