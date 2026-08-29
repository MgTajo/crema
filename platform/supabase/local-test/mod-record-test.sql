\set ON_ERROR_STOP on
\pset pager off

-- ============================================================
-- mod_record() is not reachable from a client.
--
--   ./local-test/run.sh mod-record-test.sql      (from platform/supabase)
--
-- The audit writer behind every moderation decision checks nothing
-- itself — the guarded entry points check for it. That is fine as long
-- as nobody can call it directly, and until 2026-08-29 anybody with an
-- account could: Supabase's default privileges hand EXECUTE on every new
-- function in `public` to anon and authenticated, and a `revoke ... from
-- public` does not take back a grant a role holds in its own right.
--
-- These assertions fail against the schema as it stood before
-- migrations/20260829070000_lock_mod_record.sql. That is the point of
-- them: the harness could not have caught this until stub.sql started
-- reproducing Supabase's default privileges, so this test and that
-- change belong to each other.
-- ============================================================

delete from notifications; delete from moderation_actions; delete from reports;
delete from posts; delete from profiles; delete from auth.users;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','att@e.com'),
  ('22222222-2222-2222-2222-222222222222','vic@e.com'),
  ('33333333-3333-3333-3333-333333333333','mod@e.com');
insert into profiles (id, handle, name, is_admin) values
  ('11111111-1111-1111-1111-111111111111','att','Attacker', false),
  ('22222222-2222-2222-2222-222222222222','vic','Victim',   false),
  ('33333333-3333-3333-3333-333333333333','mod','Mod',      true);

insert into posts (id, user_id, drink, caption) values
  ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','Latte','a pour');

\echo '--- T1: a signed-in non-admin cannot call mod_record at all ---'
do $$
declare denied boolean := false;
begin
  begin
    set local role authenticated;
    perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
    perform mod_record('hide_post','spam','You have been restricted.',
                       null, null, null, null,
                       '22222222-2222-2222-2222-222222222222', null);
  exception
    when insufficient_privilege then denied := true;
  end;
  reset role;
  assert denied, 'mod_record must refuse a client call — it is SECURITY DEFINER '
                 'and writes an official moderation notice to any user id';
end $$;
\echo 'T1 PASS'

\echo '--- T2: ...so no forged statement of reasons reached anybody ---'
do $$ begin
  assert (select count(*) from notifications where type = 'moderation') = 0,
    'a non-admin managed to deliver a moderation notice';
  assert (select count(*) from moderation_actions) = 0,
    'a non-admin managed to write to the audit log';
end $$;
\echo 'T2 PASS'

\echo '--- T3: an admin going through the front door still works ---'
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  perform mod_hide_post('aaaaaaaa-0000-0000-0000-000000000001', 'spam',
                        'This pour was hidden because it broke the guidelines.',
                        null, null);
  reset role;
  select count(*) into n from moderation_actions;
  assert n = 1, format('the admin path must still write its audit row, got %s', n);
  assert (select count(*) from notifications
           where type = 'moderation'
             and user_id = '22222222-2222-2222-2222-222222222222') = 1,
    'the statement of reasons must still reach the affected person';
  assert (select hidden_at is not null from posts
           where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    'the pour must actually be hidden';
end $$;
\echo 'T3 PASS'

\echo '--- T4: a non-admin at the front door is still turned away ---'
do $$
declare denied boolean := false;
begin
  begin
    set local role authenticated;
    perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
    perform mod_hide_post('aaaaaaaa-0000-0000-0000-000000000001','spam','x', null, null);
  exception when others then denied := true;
  end;
  reset role;
  assert denied, 'mod_hide_post must refuse a non-admin';
end $$;
\echo 'T4 PASS'

\echo '--- T5: recalc_score is not a client API either ---'
do $$
declare denied boolean := false;
begin
  begin
    set local role authenticated;
    perform recalc_score('22222222-2222-2222-2222-222222222222');
  exception when insufficient_privilege then denied := true;
  end;
  reset role;
  assert denied, 'recalc_score must not be callable from a client';
end $$;
\echo 'T5 PASS'

\echo '=== mod-record: ALL PASS ==='
