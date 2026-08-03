\set ON_ERROR_STOP on
\pset pager off

-- ============================================================
-- Does a reaction reach a phone?
--
--   ./local-test/run.sh reaction-push-test.sql        (from platform/supabase)
--
-- A reaction has to travel the same road a like does, and the road has
-- two halves owned by two different migrations:
--
--   reactions row → notify_on_reaction()  (step-1.19) → notifications row
--   notifications row → push_on_notification() (step-1.16) → net.http_post
--
-- Nothing asserted this end to end before. step-1.19-test.sql proves the
-- inbox row is written; it stops there, so the half that decides whether
-- anything actually arrives on a phone — the payload, its wording, its
-- deep link, the collapsing tag, and the switch that suppresses it — was
-- covered by no test at all.
--
-- net.http_post is faked by stub.sql, which records every call in
-- net.calls. That is the last thing Postgres does before the Edge
-- Function takes over, so it is exactly the right place to assert: it
-- proves the trigger fired and built the right payload, without pretending
-- to have tested Apple's push service.
-- ============================================================

-- ---------- fixtures ----------
delete from net.calls;
delete from notifications; delete from reactions; delete from likes;
delete from push_subscriptions; delete from posts;
delete from profiles; delete from auth.users;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','ann@e.com'),
  ('22222222-2222-2222-2222-222222222222','bo@e.com');
insert into profiles (id, handle, name, notify_social) values
  ('11111111-1111-1111-1111-111111111111','ann','Ann', true),
  ('22222222-2222-2222-2222-222222222222','bo','Bo',  true);

-- Ann has a phone registered; Bo does not, which is what makes the
-- "no subscription" case below a real one rather than a hypothetical.
insert into push_subscriptions (user_id, endpoint, p256dh, auth) values
  ('11111111-1111-1111-1111-111111111111','https://push.example/ann','p256dh-ann','auth-ann');

insert into posts (id, user_id, drink, caption, visibility, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Latte','Ann pour','public',now());

-- Postgres has to know where to send it, or push_send() returns quietly
-- and the assertions below would fail for a reason that has nothing to
-- do with reactions. Section 4 of push-doctor.sql is this, in production.
select push_set_config('push_endpoint','https://stub.local/functions/v1/send-push');
select push_set_config('push_secret','test-secret');

\echo '--- T1: a reaction from someone else reaches the inbox, worded per kind ---'
begin;
  set local role authenticated;
  set local "test.uid" = '22222222-2222-2222-2222-222222222222';
  insert into reactions (user_id, post_id, kind)
  values ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001','art');
commit;

do $$
begin
  assert (select count(*) from notifications
           where user_id = '11111111-1111-1111-1111-111111111111'
             and type = 'reaction') = 1,
    'a reaction on Ann''s pour should write exactly one notification for Ann';
  assert (select body from notifications
           where user_id = '11111111-1111-1111-1111-111111111111'
             and type = 'reaction') = 'loved your latte art',
    'the art reaction should be worded "loved your latte art"';
  assert (select post_id from notifications
           where type = 'reaction') = 'aaaaaaaa-0000-0000-0000-000000000001',
    'the notification must carry the pour, or the phone has nowhere to deep-link to';
end $$;
\echo 'T1 PASS'

\echo '--- T2: ...and is handed to the push path, addressed and worded ---'
do $$
declare row jsonb;
begin
  assert (select count(*) from net.calls) = 1,
    'the notifications row should have triggered exactly one push call';
  select (body->'rows'->0) into row from net.calls order by id desc limit 1;
  assert row is not null, 'the push payload should carry one subscription row';
  assert row->>'endpoint' = 'https://push.example/ann',
    'the push must be addressed to Ann''s device';
  assert row->>'body' = 'Bo loved your latte art',
    format('the banner should name the actor and what they did, got: %s', row->>'body');
  assert row->>'url' = './#p/aaaaaaaa-0000-0000-0000-000000000001',
    'tapping the banner must deep-link to the pour (app.js understands #p/<id>)';
  assert row->>'tag' like 'reaction:%',
    'reactions collapse per (type, actor), so the tag must carry both';
end $$;
\echo 'T2 PASS'

\echo '--- T3: three kinds from one person collapse to one banner, not three ---'
-- Same actor, same morning, different kinds: three inbox rows, but one
-- tag, so the phone replaces the banner rather than stacking three.
begin;
  set local role authenticated;
  set local "test.uid" = '22222222-2222-2222-2222-222222222222';
  insert into reactions (user_id, post_id, kind) values
    ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001','scene'),
    ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001','drink');
commit;

do $$
begin
  assert (select count(*) from notifications where type = 'reaction') = 3,
    'each kind is its own inbox row';
  assert (select count(distinct body) from notifications where type = 'reaction') = 3,
    'and each says which part they loved';
  assert (select count(distinct body->'rows'->0->>'tag') from net.calls) = 1,
    'but all three carry one collapsing tag, so the phone shows one banner';
end $$;
\echo 'T3 PASS'

\echo '--- T4: reacting to your own pour notifies nobody (and RLS refuses it) ---'
-- The single most likely reason someone reports "reactions do not
-- notify": they tested on their own post. Both layers say no.
do $$
declare before_n int; before_calls int;
begin
  select count(*) into before_n from notifications;
  select count(*) into before_calls from net.calls;
  begin
    set local role authenticated;
    perform set_config('test.uid','11111111-1111-1111-1111-111111111111',true);
    insert into reactions (user_id, post_id, kind)
    values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','art');
    reset role;
    assert false, 'RLS should refuse a reaction on your own pour';
  exception when insufficient_privilege then
    reset role;
  end;
  assert (select count(*) from notifications) = before_n,
    'a refused self-reaction must not notify';
  assert (select count(*) from net.calls) = before_calls,
    'and must not push';
end $$;
\echo 'T4 PASS'

\echo '--- T5: the reminder switch suppresses the phone, not the inbox ---'
-- notify_social off means push_on_notification() returns early. The
-- inbox row is still written: turning off notifications is not the same
-- as turning off the thing that happened.
update profiles set notify_social = false where handle = 'ann';
delete from net.calls;
delete from reactions where user_id = '22222222-2222-2222-2222-222222222222';
delete from notifications;

begin;
  set local role authenticated;
  set local "test.uid" = '22222222-2222-2222-2222-222222222222';
  insert into reactions (user_id, post_id, kind)
  values ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001','art');
commit;

do $$
begin
  assert (select count(*) from notifications where type = 'reaction') = 1,
    'the inbox row is written regardless of the push switch';
  assert (select count(*) from net.calls) = 0,
    'notify_social off must stop the push';
end $$;
\echo 'T5 PASS'

\echo '--- T6: a like and a reaction take the same road ---'
-- The point of putting push on `notifications` rather than on `likes`:
-- whatever writes an inbox row inherits the phone. If this passes and
-- T2 fails, the break is notify_on_reaction(); if both fail, it is the
-- push half and likes are broken too.
update profiles set notify_social = true where handle = 'ann';
delete from net.calls;

begin;
  set local role authenticated;
  set local "test.uid" = '22222222-2222-2222-2222-222222222222';
  insert into likes (user_id, post_id)
  values ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001');
commit;

-- Counting calls would be wrong here: a like can also put the pour on
-- today's podium (step-1.18), and that writes its own notification and
-- its own push. So this asks whether a `like:` banner went out, not how
-- many banners did.
do $$
begin
  assert exists (select 1 from net.calls where body->'rows'->0->>'tag' like 'like:%'),
    'a like should push the same way a reaction does';
  assert not exists (select 1 from net.calls where body->'rows'->0->>'tag' like 'reaction:%'),
    'a like must collapse under its own tag, or it would replace a reaction banner';
end $$;
\echo 'T6 PASS'

\echo 'reaction push: ALL PASS'
