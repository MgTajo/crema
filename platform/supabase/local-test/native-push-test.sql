\set ON_ERROR_STOP on
\pset pager off

-- ============================================================
-- Native push tokens — step 4.1
--
--   ./platform/supabase/local-test/run.sh native-push-test.sql
--
-- migrations/20260831090000_native_push_tokens.sql gives the Capacitor
-- shell's APNs/FCM tokens somewhere to live. The table is trivial; the
-- assertions that matter are the ones about what it must NOT do:
--
--   T1  the shape, and RLS actually on
--   T2  a token is yours — you cannot read or write anyone else's.
--       This is the whole security surface: a push token is a routing
--       address for a specific phone, and a leaked one is a stranger
--       able to be told where you had coffee.
--   T3  a device that re-registers UPDATES rather than duplicates
--   T4  deleting the account takes the tokens with it — Phase 3.3
--   T5  Web Push is untouched. push_subscriptions and its senders are
--       on the hot path in production today, and the entire argument
--       for a separate table (see the migration's header) is that this
--       change cannot reach them. T5 is that argument, asserted.
-- ============================================================

delete from native_push_tokens;
delete from push_subscriptions;
delete from profiles; delete from auth.users;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','ann@e.com'),
  ('22222222-2222-2222-2222-222222222222','bo@e.com');
insert into profiles (id, handle, name, tz_offset) values
  ('11111111-1111-1111-1111-111111111111','ann','Ann',0),
  ('22222222-2222-2222-2222-222222222222','bo', 'Bo', 0);

\echo '--- T1: the shape of the change ---'
do $$
begin
  assert (select count(*) = 1 from information_schema.tables
           where table_name='native_push_tokens'),
    'the table must exist';
  assert (select relrowsecurity from pg_class where relname='native_push_tokens'),
    'with RLS on — the browser writes to it directly';
  assert (select count(*) = 1 from pg_indexes
           where tablename='native_push_tokens' and indexname='native_push_tokens_user_idx'),
    'the user_id index must exist: a foreign key does not create one (1b.2)';
  -- Every policy an InitPlan, not a per-row call. The whole of
  -- migration 20260830170000 was fixing 51 policies that were not.
  assert (select count(*) = 0 from pg_policies
           where tablename='native_push_tokens'
             and (qual like '%auth.uid()%' and qual not like '%( SELECT auth.uid()%')),
    'policies must use (select auth.uid()) so they hoist';
end $$;

\echo '--- T2: a token is yours, and only yours ---'
do $$
declare n int;
begin
  set local role authenticated;

  perform set_config('test.uid','11111111-1111-1111-1111-111111111111',true);
  insert into native_push_tokens (token, user_id, platform, lang)
    values ('apns-ann-1','11111111-1111-1111-1111-111111111111','ios','de');

  -- Writing a row that names somebody else must be refused outright.
  begin
    insert into native_push_tokens (token, user_id, platform)
      values ('apns-forged','22222222-2222-2222-2222-222222222222','ios');
    assert false, 'inserting a token for another account must be refused';
  exception when insufficient_privilege then null;
  end;

  -- And Bo cannot see Ann's, which is the leak that would matter.
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222',true);
  select count(*) into n from native_push_tokens;
  assert n = 0, format('Bo can see %s of Ann''s tokens; must be 0', n);

  -- Nor delete it out from under her.
  delete from native_push_tokens where token='apns-ann-1';
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111',true);
  select count(*) into n from native_push_tokens where token='apns-ann-1';
  assert n = 1, 'Bo deleted Ann''s token';

  reset role;
end $$;

\echo '--- T3: re-registering the same device updates, never duplicates ---'
do $$
declare n int; l text;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111',true);

  -- This is the upsert data/push.js performs on every boot. The phone
  -- switching to English must move the row, not add one.
  insert into native_push_tokens (token, user_id, platform, lang)
    values ('apns-ann-1','11111111-1111-1111-1111-111111111111','ios','en')
    on conflict (token) do update
      set lang = excluded.lang, last_seen = now();

  select count(*), max(lang) into n, l from native_push_tokens;
  assert n = 1, format('one device must be one row; found %s', n);
  assert l = 'en', format('the language must follow the device; found %s', l);

  reset role;
end $$;

\echo '--- T4: deleting the account takes the tokens ---'
do $$
declare n int;
begin
  delete from auth.users where id='11111111-1111-1111-1111-111111111111';
  select count(*) into n from native_push_tokens
    where user_id='11111111-1111-1111-1111-111111111111';
  assert n = 0, format('%s token(s) survived the account; must cascade', n);
end $$;

\echo '--- T5: Web Push is untouched ---'
do $$
begin
  -- The reason this table exists rather than two columns on the other
  -- one. If this ever fails, the separation has been undone and every
  -- notification in production is in the blast radius.
  assert (select count(*) = 1 from information_schema.tables
           where table_name='push_subscriptions'),
    'push_subscriptions must still exist';
  assert (select count(*) = 0 from information_schema.columns
           where table_name='push_subscriptions' and column_name='platform'),
    'push_subscriptions must NOT have grown a platform column';
  assert (select count(*) = 0 from information_schema.columns
           where table_name='native_push_tokens'
             and column_name in ('p256dh','auth','endpoint')),
    'a native token is not a Web Push subscription and must not pretend to be';
  -- The senders still read the web table and nothing else.
  assert (select pg_get_functiondef(oid) not like '%native_push_tokens%'
           from pg_proc where proname='push_on_notification' limit 1),
    'push_on_notification() must not have learned about native tokens yet — '
    'that is 4.2, and it needs credentials that do not exist';
end $$;

\echo 'native-push-test: all assertions passed'
