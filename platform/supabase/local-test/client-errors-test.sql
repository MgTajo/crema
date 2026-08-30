\set ON_ERROR_STOP on
\pset pager off

-- ============================================================
-- The error log — step 1b.5
--
--   ./platform/supabase/local-test/run.sh client-errors-test.sql
--
-- migrations/20260830151000_client_errors.sql gives a crash somewhere
-- to go. The table is the easy part; what this file asserts is the
-- three properties that make it safe to expose to a browser:
--
--   1. you can write your own and nobody else's
--   2. you cannot read ANY of them back, including your own — an admin
--      can, and only an admin
--   3. a client stuck in a throw loop cannot fill it, and finding that
--      out must not itself raise
-- ============================================================

delete from client_errors;
delete from notifications; delete from posts;
delete from profiles; delete from auth.users;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','ann@e.com'),
  ('22222222-2222-2222-2222-222222222222','bo@e.com'),
  ('99999999-9999-9999-9999-999999999999','mod@e.com');
insert into profiles (id, handle, name, tz_offset, is_admin) values
  ('11111111-1111-1111-1111-111111111111','ann','Ann',0,false),
  ('22222222-2222-2222-2222-222222222222','bo', 'Bo', 0,false),
  ('99999999-9999-9999-9999-999999999999','mod','Mod',0,true);

\echo '--- T1: the shape of the change ---'
do $$
begin
  assert (select count(*) = 1 from information_schema.tables
           where table_name='client_errors'),
    'the table must exist';
  assert (select relrowsecurity from pg_class where relname='client_errors'),
    'with RLS on — it is written to directly by a browser';
  assert (select count(*) = 1 from pg_policies
           where tablename='client_errors' and cmd='INSERT'),
    'exactly one insert policy';
  assert (select count(*) = 1 from pg_policies
           where tablename='client_errors' and cmd='SELECT'),
    'exactly one select policy';
  assert (select count(*) = 0 from pg_policies
           where tablename='client_errors' and cmd in ('UPDATE','DELETE')),
    'nothing may edit or erase an error after the fact, not even its author';
  assert (select count(*) = 1 from pg_trigger
           where tgname='client_errors_flood' and not tgisinternal),
    'the flood guard must be attached';
  assert (select count(*) = 1 from cron.job where jobname='crema-client-errors-prune'),
    'and the 30-day retention must actually be scheduled, not just intended';
end $$;
\echo 'T1 PASS'

\echo '--- T2: the lengths are enforced by the database ---'
-- The client clips before sending. That is a courtesy, not a control:
-- the insert policy lets a browser write this table directly, so an
-- unbounded column would be free storage for anybody with an account.
do $$
declare fired boolean := false;
begin
  begin
    insert into client_errors (user_id, message)
    values ('11111111-1111-1111-1111-111111111111', repeat('x', 501));
  exception when check_violation then fired := true;
  end;
  assert fired, 'a 501-character message must be refused';

  fired := false;
  begin
    insert into client_errors (user_id, message, stack)
    values ('11111111-1111-1111-1111-111111111111', 'boom', repeat('x', 4001));
  exception when check_violation then fired := true;
  end;
  assert fired, 'and a 4001-character stack';

  fired := false;
  begin
    insert into client_errors (user_id, message, lang)
    values ('11111111-1111-1111-1111-111111111111', 'boom', 'fr');
  exception when check_violation then fired := true;
  end;
  assert fired, 'lang is de or en — the app has two';
end $$;
\echo 'T2 PASS'

\echo '--- T3: write your own, and only your own ---'
-- RLS is enforced for a non-owner role, so these run as `authenticated`
-- rather than as the superuser the rest of this file uses.
do $$
declare denied boolean := false;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111',true);
  insert into client_errors (user_id, message, source, app_version, lang)
  values ('11111111-1111-1111-1111-111111111111','TypeError: x is not a function',
          'src/ui/views.js:120:15','crema-v50','de');

  begin
    insert into client_errors (user_id, message)
    values ('22222222-2222-2222-2222-222222222222','not mine to file');
  exception when insufficient_privilege then denied := true;
  end;
  assert denied, 'nobody files an error in somebody else''s name';
  reset role;
end $$;
\echo 'T3 PASS'

\echo '--- T4: nobody reads it back except an admin ---'
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111',true);
  select count(*) into n from client_errors;
  assert n = 0,
    'not even the author reads their own errors back — a table you can '
    'write and read is storage, got ' || n::text;

  perform set_config('test.uid','22222222-2222-2222-2222-222222222222',true);
  select count(*) into n from client_errors;
  assert n = 0, 'and certainly not somebody else''s';

  perform set_config('test.uid','99999999-9999-9999-9999-999999999999',true);
  select count(*) into n from client_errors;
  assert n = 1, 'an admin reads the log — that is what it is for, got ' || n::text;
  reset role;
end $$;
\echo 'T4 PASS'

\echo '--- T5: a throw loop cannot fill the table, and is not told so ---'
-- Returning NULL from a BEFORE trigger rather than raising is the
-- deliberate part. The caller here is an error handler; a rejected
-- insert inside one is a second error to handle, and that is the loop
-- this whole table exists to make visible.
do $$
declare n int;
begin
  delete from client_errors;
  for i in 1..40 loop
    insert into client_errors (user_id, message)
    values ('11111111-1111-1111-1111-111111111111','Maximum call stack size exceeded');
  end loop;
  select count(*) into n from client_errors
   where user_id='11111111-1111-1111-1111-111111111111';
  assert n = 20,
    'twenty an hour, and the rest dropped in silence, got ' || n::text;

  -- Silently, in particular: forty inserts, no exception, or the block
  -- above would never have reached this line.
  insert into client_errors (user_id, message)
  values ('22222222-2222-2222-2222-222222222222','somebody else''s crash');
  assert (select count(*) = 1 from client_errors
           where user_id='22222222-2222-2222-2222-222222222222'),
    'one person''s bad day does not silence everybody else''s reports';
end $$;
\echo 'T5 PASS'

\echo '--- T6: an account can leave without taking the evidence ---'
-- Phase 3.3 deletes auth users. `on delete set null` rather than
-- cascade: the crash is a fact about the software, the person is not
-- part of it any more.
do $$
begin
  delete from client_errors;
  insert into client_errors (user_id, message)
  values ('22222222-2222-2222-2222-222222222222','ReferenceError: q is not defined');
  delete from auth.users where id='22222222-2222-2222-2222-222222222222';
  assert (select count(*) = 1 from client_errors
           where message='ReferenceError: q is not defined' and user_id is null),
    'the error outlives the account, unattributed';
end $$;
\echo 'T6 PASS'

\echo 'client-errors-test.sql — all assertions passed'
