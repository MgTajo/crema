\set ON_ERROR_STOP on
\pset pager off

-- ============================================================
-- Does a German phone get a German notification?
--
--   ./local-test/run.sh push-i18n-test.sql      (from platform/supabase)
--
-- step-1.32 claims three things, and each is a way it could be wrong:
--
--   * the body is rendered PER DEVICE, so one notifications row can
--     leave as two different sentences. Rendering it once above the
--     fan-out — which is what step-1.16 did — would pass every
--     single-device test and fail every real user with two phones.
--   * a string with no German, a language nobody seeded, and a
--     moderation statement someone typed by hand all fall back to what
--     was passed in. A lookup that returns NULL instead would send an
--     empty notification, which is the one outcome worse than English.
--   * English is untouched. Everything below is asserted against an
--     English device as well, because "we translated it" must not mean
--     "we changed it".
--
-- net.http_post is faked by stub.sql and records every call in
-- net.calls, so the payload can be read back exactly as the Edge
-- Function would receive it. Same seam reaction-push-test.sql uses.
-- ============================================================

-- ---------- fixtures ----------
delete from net.calls;
delete from notifications; delete from reactions; delete from likes;
delete from push_subscriptions; delete from posts;
delete from profiles; delete from auth.users;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','ann@e.com'),
  ('22222222-2222-2222-2222-222222222222','bo@e.com');
insert into profiles (id, handle, name, notify_social, notify_streak, notify_digest) values
  ('11111111-1111-1111-1111-111111111111','ann','Ann', true, true, true),
  ('22222222-2222-2222-2222-222222222222','bo','Bo',  true, true, true);

-- Ann carries two devices: a phone she switched to German and a laptop
-- she left in English. Everything below is one notifications row
-- becoming two different sentences.
insert into push_subscriptions (user_id, endpoint, p256dh, auth, lang) values
  ('11111111-1111-1111-1111-111111111111','https://push.example/ann-de','p1','a1','de'),
  ('11111111-1111-1111-1111-111111111111','https://push.example/ann-en','p2','a2','en');

insert into posts (id, user_id, drink, caption, visibility, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Latte','Ann pour','public',now());

select push_set_config('push_endpoint','https://stub.local/functions/v1/send-push');
select push_set_config('push_secret','test-secret');

-- Read the body that went to one endpoint out of the last call.
create or replace function tbody(ep text) returns text language sql as $$
  select r->>'body' from net.calls c
    cross join lateral jsonb_array_elements(c.body->'rows') r
   where r->>'endpoint' = ep
   order by c.id desc limit 1;
$$;
create or replace function ttitle(ep text) returns text language sql as $$
  select r->>'title' from net.calls c
    cross join lateral jsonb_array_elements(c.body->'rows') r
   where r->>'endpoint' = ep
   order by c.id desc limit 1;
$$;

\echo '--- T1: one like, two devices, two languages ---'
delete from net.calls;
insert into notifications (user_id, actor_id, type, post_id, body)
values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
        'like','aaaaaaaa-0000-0000-0000-000000000001','liked your pour');
do $$
begin
  assert tbody('https://push.example/ann-de') = 'Bo gefällt dein Kaffee',
    'German device got: ' || coalesce(tbody('https://push.example/ann-de'),'<null>');
  assert tbody('https://push.example/ann-en') = 'Bo liked your pour',
    'English device got: ' || coalesce(tbody('https://push.example/ann-en'),'<null>');
end $$;
\echo '    ok'

\echo '--- T2: the podium body keeps its medal ---'
delete from net.calls;
insert into notifications (user_id, actor_id, type, post_id, body)
values ('11111111-1111-1111-1111-111111111111', null,
        'podium','aaaaaaaa-0000-0000-0000-000000000001','🥇 1st place on today''s podium');
do $$
begin
  assert tbody('https://push.example/ann-de') = '🥇 1. Platz auf dem Podium des Tages',
    'German podium: ' || coalesce(tbody('https://push.example/ann-de'),'<null>');
  assert tbody('https://push.example/ann-en') = '🥇 1st place on today''s podium',
    'English podium: ' || coalesce(tbody('https://push.example/ann-en'),'<null>');
end $$;
\echo '    ok'

\echo '--- T3: the challenge payout is taken apart and put back together ---'
delete from net.calls;
insert into notifications (user_id, actor_id, type, body)
values ('11111111-1111-1111-1111-111111111111', null,
        'challenge','Challenge complete: Milk Run · +45 points');
do $$
begin
  assert tbody('https://push.example/ann-de') = 'Challenge geschafft: Milchrunde · +45 Punkte',
    'German challenge: ' || coalesce(tbody('https://push.example/ann-de'),'<null>');
  assert tbody('https://push.example/ann-en') = 'Challenge complete: Milk Run · +45 points',
    'English challenge: ' || coalesce(tbody('https://push.example/ann-en'),'<null>');
end $$;
\echo '    ok'

\echo '--- T4: a challenge whose title has no German keeps the German frame ---'
delete from net.calls;
insert into notifications (user_id, actor_id, type, body)
values ('11111111-1111-1111-1111-111111111111', null,
        'challenge','Challenge complete: Some Later Challenge · +5 points');
do $$
begin
  assert tbody('https://push.example/ann-de') = 'Challenge geschafft: Some Later Challenge · +5 Punkte',
    'partial challenge: ' || coalesce(tbody('https://push.example/ann-de'),'<null>');
end $$;
\echo '    ok'

\echo '--- T5: a hand-typed moderation statement is passed through untouched ---'
delete from net.calls;
insert into notifications (user_id, actor_id, type, body)
values ('11111111-1111-1111-1111-111111111111', null, 'moderation',
        'Dein Beitrag wurde ausgeblendet, weil er gegen unsere Regeln verstößt.');
do $$
begin
  assert tbody('https://push.example/ann-de')
       = 'Dein Beitrag wurde ausgeblendet, weil er gegen unsere Regeln verstößt.',
    'statement was altered: ' || coalesce(tbody('https://push.example/ann-de'),'<null>');
  assert tbody('https://push.example/ann-en')
       = 'Dein Beitrag wurde ausgeblendet, weil er gegen unsere Regeln verstößt.',
    'statement was altered on en: ' || coalesce(tbody('https://push.example/ann-en'),'<null>');
end $$;
\echo '    ok'

\echo '--- T6: an unknown body, and an unknown language, both fall back rather than blank ---'
do $$
begin
  assert crema_push_body('something no migration has written yet','de')
       = 'something no migration has written yet', 'unknown body was lost';
  assert crema_push_body('liked your pour','fr') = 'liked your pour', 'unknown language was lost';
  assert crema_push_body('liked your pour', null) = 'liked your pour', 'null language was lost';
  assert crema_push_body(null,'de') is null, 'null body should stay null';
  assert crema_i18n('liked your pour','de') = 'gefällt dein Kaffee', 'lookup is wrong';
end $$;
\echo '    ok'

\echo '--- T7: a row from before this migration defaults to English, not to nothing ---'
delete from net.calls;
insert into push_subscriptions (user_id, endpoint, p256dh, auth) values
  ('22222222-2222-2222-2222-222222222222','https://push.example/bo','p3','a3');
do $$
declare l text;
begin
  select lang into l from push_subscriptions where endpoint = 'https://push.example/bo';
  assert l = 'en', 'default lang is ' || coalesce(l,'<null>');
end $$;
insert into notifications (user_id, actor_id, type, body)
values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',
        'follow','started following you');
do $$
begin
  assert tbody('https://push.example/bo') = 'Ann started following you',
    'defaulted device got: ' || coalesce(tbody('https://push.example/bo'),'<null>');
end $$;
\echo '    ok'

\echo '--- T8: the streak nudge, in both languages, title and body ---'
do $$
begin
  assert crema_i18n('Your streak ends tonight','de') = 'Dein Streak endet heute Abend', 'streak title';
  assert replace(crema_i18n('{n} days so far — one pour keeps it going.','de'),'{n}','5')
       = '5 Tage bisher — ein Kaffee hält ihn am Leben.', 'streak body';
  assert replace(crema_i18n('{n} days so far — one pour keeps it going.','en'),'{n}','5')
       = '5 days so far — one pour keeps it going.', 'streak body en';
end $$;
\echo '    ok'

\echo '--- T9: the digest, its plurals, and the clause that disappears ---'
do $$
begin
  assert crema_digest_body(3,5,2,'de') = '3 Kaffees, 5 Likes, 2 neue Follower.',
    'de plural: ' || crema_digest_body(3,5,2,'de');
  assert crema_digest_body(1,1,1,'de') = '1 Kaffee, 1 Like, 1 neuer Follower.',
    'de singular: ' || crema_digest_body(1,1,1,'de');
  assert crema_digest_body(4,2,0,'de') = '4 Kaffees, 2 Likes.',
    'de no followers: ' || crema_digest_body(4,2,0,'de');
  -- English has to come out exactly as step-1.16 built it by hand.
  assert crema_digest_body(3,5,2,'en') = '3 pours, 5 likes, 2 new followers.',
    'en plural: ' || crema_digest_body(3,5,2,'en');
  assert crema_digest_body(1,1,1,'en') = '1 pour, 1 like, 1 new follower.',
    'en singular: ' || crema_digest_body(1,1,1,'en');
  assert crema_digest_body(4,2,0,'en') = '4 pours, 2 likes.',
    'en no followers: ' || crema_digest_body(4,2,0,'en');
end $$;
\echo '    ok'

\echo '--- T10: the dictionary is not a client API ---'
-- Two locks, and the order matters. The grant is the one this harness
-- can only approximate — it re-applies Supabase's blanket
-- `grant all on all tables` AFTER every migration, where the real thing
-- applies it per table at CREATE time and the migration's own revoke
-- then wins. So the grant is asserted, but RLS-with-no-policy is what
-- makes the answer "no rows" even if a future migration hands the grant
-- back by accident. SECURITY DEFINER functions run as the owner and are
-- not subject to it, which is why the send path still reads.
do $$
declare ok bool; n int;
begin
  select relrowsecurity into ok from pg_class where relname = 'push_i18n';
  assert ok, 'push_i18n does not have RLS on';
  select count(*) into n from pg_policies where tablename = 'push_i18n';
  assert n = 0, 'push_i18n has a policy, so something can read it';

  select has_table_privilege('authenticated','push_i18n','select') into ok;
  assert not ok, 'authenticated can read push_i18n';
  select has_function_privilege('authenticated','crema_i18n(text,text)','execute') into ok;
  assert not ok, 'authenticated can call crema_i18n';
  select has_function_privilege('anon','crema_push_body(text,text)','execute') into ok;
  assert not ok, 'anon can call crema_push_body';
end $$;
\echo '    ok'

\echo '--- T11: the language switch is a check constraint, not a hope ---'
do $$
begin
  begin
    insert into push_subscriptions (user_id, endpoint, p256dh, auth, lang)
    values ('11111111-1111-1111-1111-111111111111','https://push.example/x','p','a','klingon');
    assert false, 'an unknown language was accepted';
  exception when check_violation then null;
  end;
end $$;
\echo '    ok'

drop function tbody(text);
drop function ttitle(text);
\echo '=== push-i18n: all assertions passed ==='
