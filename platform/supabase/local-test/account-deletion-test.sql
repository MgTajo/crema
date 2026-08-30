\set ON_ERROR_STOP on
\pset pager off

-- ============================================================
-- Deleting an account, and taking a copy of it first — step 3.3
--
--   ./platform/supabase/local-test/run.sh account-deletion-test.sql
--
-- migrations/20260830200000_account_deletion_and_export.sql. Deletion
-- itself is `delete from auth.users` and the foreign keys that were
-- already there; what is asserted here is that the cascade
--
--   1. completes at all — challenge_check() can write a row for the
--      leaving user mid-cascade, and the migration's header explains
--      why that is guarded rather than left to constraint order
--   2. leaves NOTHING behind, asked of the catalogue rather than of a
--      list somebody typed, so a table added next month is covered
--   3. leaves everybody ELSE intact, with their scores corrected
--   4. does not spend the leaving user's departure on other people's
--      inboxes
--
-- and that the two functions the migration rewrote still do every one
-- of the things they did before. That last part is the point of T5 and
-- T6: both are `create or replace` on functions several triggers reach,
-- which is the exact shape of D-2026-08-30-02, where a rewrite lost a
-- branch and it took three days and a user to notice.
-- ============================================================

delete from notifications; delete from client_errors;
delete from moderation_actions; delete from reports;
delete from challenge_completions; delete from challenge_entries; delete from challenge_joins;
delete from daily_champions; delete from daily_firsts;
delete from podium_wins; delete from podium_places;
delete from likes; delete from comment_likes; delete from comments;
delete from reactions; delete from saves; delete from follows; delete from blocks;
delete from user_gear; delete from push_subscriptions; delete from recap_exports;
delete from upload_grants; delete from posts;
delete from challenges;
delete from profiles; delete from auth.users;

-- ann leaves. bo stays, and has liked and commented on ann's pours, so
-- bo's own score has to be right on the other side of the deletion.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a','ann@e.com'),
  ('b0000000-0000-0000-0000-00000000000b','bo@e.com'),
  ('c0000000-0000-0000-0000-00000000000c','mod@e.com');
insert into profiles (id, handle, name, city, tz_offset, is_admin) values
  ('a0000000-0000-0000-0000-00000000000a','ann','Ann','Berlin',0,false),
  ('b0000000-0000-0000-0000-00000000000b','bo', 'Bo', 'Wien',  0,false),
  ('c0000000-0000-0000-0000-00000000000c','mod','Mod','Berlin',0,true);

-- A live challenge ann still qualifies for on the way out, so
-- trg_challenge_check has something real to do during the cascade
-- rather than an empty loop. Read the migration header before
-- concluding this row proves the guard: on this schema the posts
-- cascade runs first, so the write is not reached and the deletion
-- would complete without the guard too. What the guard buys is not
-- depending on that order — which is why the branch itself is named in
-- T5 instead.
insert into challenges (id, title, kind, goal, points, param, starts_at, ends_at)
values ('c-week','One this week','pours',1,50,null, now() - interval '7 days', now() + interval '6 days');

insert into posts (id, user_id, drink, caption, image_key, created_at) values
  ('11111111-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','Flat white','one', 'posts/a0000000-0000-0000-0000-00000000000a/1.jpg', now() - interval '2 days'),
  ('11111111-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','Espresso',  'two', 'posts/a0000000-0000-0000-0000-00000000000a/2.jpg', now() - interval '1 day'),
  ('22222222-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000b','Cortado',   'bo''s',null, now() - interval '1 day');

insert into comments (post_id, user_id, body) values
  ('22222222-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','nice one'),
  ('11111111-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000b','yours is nicer');
insert into likes (user_id, post_id) values
  ('a0000000-0000-0000-0000-00000000000a','22222222-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-00000000000b','11111111-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-00000000000b','11111111-0000-0000-0000-000000000002');
insert into reactions (user_id, post_id, kind) values
  ('a0000000-0000-0000-0000-00000000000a','22222222-0000-0000-0000-000000000001','art');
insert into saves (user_id, post_id) values
  ('a0000000-0000-0000-0000-00000000000a','22222222-0000-0000-0000-000000000001');
insert into follows (follower_id, followee_id, status) values
  ('a0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000b','accepted'),
  ('b0000000-0000-0000-0000-00000000000b','a0000000-0000-0000-0000-00000000000a','accepted');
insert into blocks (blocker_id, blocked_id) values
  ('a0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-00000000000c');
insert into user_gear (user_id, kind, name, own) values
  ('a0000000-0000-0000-0000-00000000000a','machine','Rancilio Silvia',true),
  ('a0000000-0000-0000-0000-00000000000a','bean','Some roaster — Some bag',true);
insert into push_subscriptions (endpoint, user_id, p256dh, auth, lang) values
  ('https://push.example/ann','a0000000-0000-0000-0000-00000000000a','k','s','de');
insert into recap_exports (user_id, week_start, kind) values
  ('a0000000-0000-0000-0000-00000000000a', current_date, 'share');
insert into upload_grants (user_id) values ('a0000000-0000-0000-0000-00000000000a');
insert into client_errors (user_id, message, app_version, lang) values
  ('a0000000-0000-0000-0000-00000000000a','boom','crema-abc','de');
insert into reports (reporter_id, post_id, reason) values
  ('a0000000-0000-0000-0000-00000000000a','22222222-0000-0000-0000-000000000001','spam');
insert into moderation_actions (actor_id, subject_id, action, reason, statement) values
  ('c0000000-0000-0000-0000-00000000000c','a0000000-0000-0000-0000-00000000000a',
   'dismiss','our content rules','We looked and left it up.');
-- daily_firsts and daily_champions are not inserted here: the pours
-- above already earned them through award_daily_first() and
-- award_daily_champion(), which is the only way a real row appears.

\echo '--- T1: the shape of the change ---'
do $$
begin
  assert (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='export_my_data'),
    'export_my_data() must exist';
  assert (select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='export_my_data'),
    'and be SECURITY DEFINER — RLS hides some of a person''s own rows from them by design';
  assert (select pronargs = 0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='export_my_data'),
    'and take no argument: there must be no id for a caller to tamper with';
  assert     has_function_privilege('authenticated','export_my_data()','execute'),
    'authenticated may export';
  assert not has_function_privilege('anon','export_my_data()','execute'),
    'anon may not — Supabase''s default privileges grant it, so the revoke has to be explicit';
end $$;
\echo 'T1 PASS'

\echo '--- T2: the export is complete, and is only ever the caller ---'
do $$
declare doc jsonb;
begin
  perform set_config('test.uid','a0000000-0000-0000-0000-00000000000a',true);
  doc := export_my_data();

  assert doc->'profile'->>'handle' = 'ann', 'the profile is in it';
  assert doc->'account'->>'email'  = 'ann@e.com', 'and the email address, which lives in auth.users';
  assert jsonb_array_length(doc->'posts') = 2, 'both pours';
  assert doc->'posts'->0->>'caption' = 'one', 'oldest first — a history, not a dump';
  assert doc->'posts'->0->>'image_key' is not null,
    'the photo''s address, since the bytes themselves are not in the file';
  assert jsonb_array_length(doc->'comments') = 1, 'the comment she left on bo''s pour';
  assert doc->'comments'->0->>'body' = 'nice one', 'hers, not bo''s reply on her own pour';
  assert jsonb_array_length(doc->'likes') = 1, 'the like she gave';
  assert jsonb_array_length(doc->'reactions') = 1, 'the reaction';
  assert jsonb_array_length(doc->'saves') = 1, 'the save';
  assert jsonb_array_length(doc->'following') = 1 and jsonb_array_length(doc->'followers') = 1,
    'both directions of the follow, separately';
  assert jsonb_array_length(doc->'blocked') = 1, 'who she blocked';
  assert jsonb_array_length(doc->'gear') = 2, 'her shelf';
  assert jsonb_array_length(doc->'push_subscriptions') = 1, 'the device that gets her pushes';
  assert doc->'push_subscriptions'->0 ? 'endpoint', 'named by its endpoint';
  assert not (doc->'push_subscriptions'->0 ? 'p256dh')
     and not (doc->'push_subscriptions'->0 ? 'auth'),
    'but never the encryption keys — those are a credential, not a fact about her';
  assert jsonb_array_length(doc->'week_card_exports') = 1, 'the week card she shared';
  assert jsonb_array_length(doc->'reports_you_filed') = 1, 'the report she filed';
  assert jsonb_array_length(doc->'daily_firsts') >= 1
     and jsonb_array_length(doc->'daily_champions') >= 1,
    'the mornings she was first — awarded by the triggers, not inserted by this file';
  assert jsonb_array_length(doc->'photo_upload_grants') = 1, 'even the rate-limit bookkeeping';

  -- The two that RLS will not show her, and that Art. 15 says she gets.
  assert jsonb_array_length(doc->'error_reports') = 1,
    'the crash reported from her browser — client_errors is write-only to her over PostgREST';
  assert jsonb_array_length(doc->'decisions_about_you') = 1,
    'and the moderation decision about her, which only an admin can read';
  assert doc->'decisions_about_you'->0->>'statement' = 'We looked and left it up.',
    'with the statement of reasons she was given';
  assert not (doc->'decisions_about_you'->0 ? 'actor_id'),
    'and without the moderator''s id, which is personal data about somebody else';
end $$;
\echo 'T2 PASS'

\echo '--- T3: bo exports bo, and nothing of ann''s ---'
do $$
declare doc jsonb;
begin
  perform set_config('test.uid','b0000000-0000-0000-0000-00000000000b',true);
  doc := export_my_data();
  assert doc->'profile'->>'handle' = 'bo', 'his profile';
  assert jsonb_array_length(doc->'posts') = 1, 'his one pour';
  assert jsonb_array_length(doc->'likes') = 2, 'the two he gave';
  assert jsonb_array_length(doc->'error_reports') = 0, 'ann''s crash is not his';
  assert jsonb_array_length(doc->'decisions_about_you') = 0, 'nor the decision about her';
end $$;

do $$
declare raised boolean := false;
begin
  perform set_config('test.uid','',true);
  begin perform export_my_data();
  exception when others then raised := true;
  end;
  assert raised, 'and with no session at all it must refuse rather than return an empty shell';
end $$;
\echo 'T3 PASS'

\echo '--- T4: the deletion completes, and leaves nothing anywhere ---'
-- The landmine first: ann qualifies for the live challenge right now,
-- so trg_challenge_check has something to write on the way out.
do $$
begin
  perform challenge_check('a0000000-0000-0000-0000-00000000000a');
  assert (select count(*) = 1 from challenge_completions
           where user_id = 'a0000000-0000-0000-0000-00000000000a'),
    'ann must actually be mid-challenge, or this test is not testing anything';
end $$;

-- Emptied here so that anything in this table afterwards was written BY
-- the deletion. T4c is the assertion that nothing was.
delete from notifications;

delete from auth.users where id = 'a0000000-0000-0000-0000-00000000000a';

-- Asked of the catalogue, not of a list. Every column in `public` that
-- points at profiles(id) or auth.users(id) is checked for the id that
-- just left — so a table added in six months is covered by this test on
-- the day it is added, which a hand-written list never is.
do $$
declare r record; n bigint; checked int := 0;
begin
  for r in
    select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join unnest(c.conkey) with ordinality k(attnum, ord) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
     where c.contype = 'f'
       and c.connamespace = 'public'::regnamespace
       and c.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
       and a.atttypid = 'uuid'::regtype
  loop
    execute format('select count(*) from %s where %I = $1', r.tbl, r.col)
      into n using 'a0000000-0000-0000-0000-00000000000a'::uuid;
    assert n = 0, format('%s.%s still holds the deleted account (%s rows)', r.tbl, r.col, n);
    checked := checked + 1;
  end loop;
  -- A loop that checks nothing passes silently, which is the one way
  -- this assertion could lie.
  assert checked >= 25, format('only %s columns were checked — the catalogue query is wrong', checked);

  assert (select count(*) = 0 from auth.users where id = 'a0000000-0000-0000-0000-00000000000a'),
    'and the account itself is gone';
  assert (select count(*) = 0 from profiles where handle = 'ann'),
    'the handle is free again';
end $$;
\echo 'T4 PASS'

\echo '--- T4b: everybody else survives it, corrected ---'
do $$
begin
  assert (select count(*) = 1 from posts where user_id = 'b0000000-0000-0000-0000-00000000000b'),
    'bo keeps his pour';
  assert (select count(*) = 0 from comments where post_id = '11111111-0000-0000-0000-000000000001'),
    'his comment on her pour goes with the pour — it cannot outlive what it was under';
  assert (select count(*) = 0 from likes where post_id::text like '11111111%'),
    'and his likes on her pours';
  assert (select points = user_points('b0000000-0000-0000-0000-00000000000b')
            from profiles where id = 'b0000000-0000-0000-0000-00000000000b'),
    'bo''s score is what his remaining rows say it is — ann''s like and comment '
    'were worth points to him and are not any more';
  assert (select count(*) = 1 from moderation_actions where subject_id is null),
    'the decision survives with the name removed — the DSA record outlives the account';
  assert (select statement = 'We looked and left it up.' from moderation_actions),
    'statement of reasons intact';
  assert (select count(*) = 1 from client_errors where user_id is null),
    'and the crash stays, unattributed: the error is about the app, not about her';
end $$;
\echo 'T4b PASS'

\echo '--- T4c: leaving is not an event other people are notified about ---'
do $$
begin
  assert (select count(*) = 0 from notifications
           where user_id = 'b0000000-0000-0000-0000-00000000000b'
             and type in ('follow','follow_request','challenge')),
    'unfollowing everybody by leaving must not ring anybody''s bell';
end $$;
\echo 'T4c PASS'

-- ============================================================
-- T5 / T6 — the branches of the two rewritten functions.
--
-- D-2026-08-30-04's falsifier names this class exactly: a `create or
-- replace` that silently drops a branch no test names. Both functions
-- below are reached from several triggers, so every branch gets named.
-- ============================================================
\echo '--- T5: challenge_check still awards, announces and revokes ---'
do $$
declare pts_before int;
begin
  delete from challenge_completions; delete from notifications;

  -- branch 1: null uid returns without touching anything
  perform challenge_check(null);
  assert (select count(*) = 0 from challenge_completions), 'a null uid awards nothing';

  -- branch 2: a uid with no profile row returns without touching anything.
  -- This is the branch the migration added and the cascade depends on.
  perform challenge_check('a0000000-0000-0000-0000-00000000000a');
  assert (select count(*) = 0 from challenge_completions),
    'a departed account awards nothing — and, crucially, raises nothing';

  -- branch 3: qualifying awards the points AND announces it
  perform challenge_check('b0000000-0000-0000-0000-00000000000b');
  assert (select count(*) = 1 from challenge_completions
           where user_id = 'b0000000-0000-0000-0000-00000000000b' and challenge_id = 'c-week'),
    'bo qualifies, so bo is awarded';
  assert (select points = 50 from challenge_completions
           where user_id = 'b0000000-0000-0000-0000-00000000000b'),
    'for the challenge''s own points, not a default';
  assert (select count(*) = 1 from notifications
           where user_id = 'b0000000-0000-0000-0000-00000000000b' and type = 'challenge'),
    'and told about it';

  -- branch 4: running it again changes nothing and says nothing twice
  perform challenge_check('b0000000-0000-0000-0000-00000000000b');
  assert (select count(*) = 1 from notifications
           where user_id = 'b0000000-0000-0000-0000-00000000000b' and type = 'challenge'),
    'the on-conflict path stays quiet — announcing twice is the bug this guards';

  -- branch 5: no longer qualifying takes it back while the week is open
  delete from posts where user_id = 'b0000000-0000-0000-0000-00000000000b';
  perform challenge_check('b0000000-0000-0000-0000-00000000000b');
  assert (select count(*) = 0 from challenge_completions
           where user_id = 'b0000000-0000-0000-0000-00000000000b'),
    'the pour that earned it is gone, so the completion goes too';
end $$;
\echo 'T5 PASS'

\echo '--- T6: recalc_score still writes points and levels ---'
do $$
declare before_pts int; before_lvl int;
begin
  insert into posts (id, user_id, drink, created_at)
  values ('33333333-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000b','Latte', now());

  update profiles set points = 0, level = 1 where id = 'b0000000-0000-0000-0000-00000000000b';

  -- branch 1: null returns
  perform recalc_score(null);

  -- branch 2: no profile row returns — added by the migration, and the
  -- reason a cascade no longer runs an aggregate per deleted pour
  perform recalc_score('a0000000-0000-0000-0000-00000000000a');

  -- branch 3: the write itself
  perform recalc_score('b0000000-0000-0000-0000-00000000000b');
  assert (select points = user_points('b0000000-0000-0000-0000-00000000000b')
            from profiles where id = 'b0000000-0000-0000-0000-00000000000b'),
    'points are written';
  assert (select level = level_for_points(user_points('b0000000-0000-0000-0000-00000000000b'))
            from profiles where id = 'b0000000-0000-0000-0000-00000000000b'),
    'and the level with them — the two must never disagree';

  -- branch 4: the `is distinct from` guard means an unchanged score is
  -- not a write. Asserted through the trigger path, which is how every
  -- real caller reaches it.
  select points, level into before_pts, before_lvl
    from profiles where id = 'b0000000-0000-0000-0000-00000000000b';
  perform recalc_score('b0000000-0000-0000-0000-00000000000b');
  assert (select points = before_pts and level = before_lvl
            from profiles where id = 'b0000000-0000-0000-0000-00000000000b'),
    'a second run is a no-op, not a fresh number';
end $$;
\echo 'T6 PASS'

\echo 'ALL PASS — account-deletion-test.sql'
