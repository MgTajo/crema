\set ON_ERROR_STOP on
\pset pager off

-- ============================================================
-- Rate limits on uploads and pours — step 1b.1
--
--   ./platform/supabase/local-test/run.sh rate-limit-test.sql
--
-- migrations/20260830150000_rate_limits.sql puts a limit in front of
-- the two surfaces that never had one. A rate limit has exactly two
-- ways to be wrong and this file asserts both directions:
--
--   1. it does not fire  — a script can hammer either surface freely
--   2. it fires too soon — a real person is told to slow down while
--      doing something ordinary, which is the worse of the two,
--      because they have no idea what they did and no way to appeal
--
-- T4 is the one worth keeping: a limit measured over a column the
-- caller supplies is not a limit, and `posts.created_at` is insertable
-- over PostgREST.
-- ============================================================

-- ---------- fixtures ----------
delete from net.calls;
delete from daily_champions; delete from daily_firsts;
delete from notifications; delete from reactions; delete from likes;
delete from comments; delete from blocks; delete from follows;
delete from push_subscriptions; delete from posts;
delete from upload_grants;
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
  assert (select count(*) = 1 from pg_trigger
           where tgname='posts_rate_limit' and not tgisinternal),
    'the pour limit must be a trigger on posts';
  assert (select count(*) = 1 from pg_proc where proname='check_post_rate'),
    'and its function must exist';
  assert (select count(*) = 1 from pg_proc where proname='claim_upload_slot'),
    'the upload limit is an RPC the Edge Function calls';
  assert (select relrowsecurity from pg_class where relname='upload_grants'),
    'upload_grants must have RLS on — nothing reads it over PostgREST';
  assert (select count(*) = 0 from pg_policies where tablename='upload_grants'),
    'and deliberately no policies: RLS on with no policy denies everybody';

  -- The mod_record() lesson, asserted rather than remembered. Supabase
  -- grants EXECUTE on new public functions to anon AND authenticated,
  -- so the absence of a revoke is a hole that nothing else would show.
  assert has_function_privilege('authenticated','claim_upload_slot()','execute'),
    'a signed-in person must be able to claim a slot, or no photo uploads';
  assert not has_function_privilege('anon','claim_upload_slot()','execute'),
    'a signed-out caller must NOT be able to burn slots — this is the mod_record() mechanism';
  assert not has_function_privilege('anon','check_post_rate()','execute'),
    'a trigger function is not a client API';
  assert not has_function_privilege('authenticated','check_post_rate()','execute'),
    'and calling it directly must not be a way to do anything at all';
end $$;
\echo 'T1 PASS'

\echo '--- T2: an ordinary morning is never blocked ---'
-- The failure mode that matters most. Three pours and nine photos is a
-- Premium user having a generous morning; none of it may be refused.
do $$
declare ok boolean := true;
begin
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111',true);
  for i in 1..3 loop
    insert into posts (user_id, drink) values
      ('11111111-1111-1111-1111-111111111111','Cortado');
  end loop;
  for i in 1..9 loop
    perform claim_upload_slot();
  end loop;
  assert (select count(*) = 3 from posts
           where user_id='11111111-1111-1111-1111-111111111111'),
    'three ordinary pours must all land';
  assert (select count(*) = 9 from upload_grants
           where user_id='11111111-1111-1111-1111-111111111111'),
    'and nine photos across them must all be granted';
end $$;
\echo 'T2 PASS'

\echo '--- T3: the pour limit fires at ten in ten minutes ---'
do $$
declare fired boolean := false;
begin
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222',true);
  -- Ten land. The eleventh is the one that must not.
  for i in 1..10 loop
    insert into posts (user_id, drink) values
      ('22222222-2222-2222-2222-222222222222','Espresso');
  end loop;
  assert (select count(*) = 10 from posts
           where user_id='22222222-2222-2222-2222-222222222222'),
    'the tenth pour is still inside the limit, got '
      || (select count(*) from posts
           where user_id='22222222-2222-2222-2222-222222222222')::text;
  begin
    insert into posts (user_id, drink) values
      ('22222222-2222-2222-2222-222222222222','Espresso');
  exception when sqlstate 'P0001' then fired := true;
  end;
  assert fired, 'the eleventh pour in ten minutes must be refused';
  assert (select count(*) = 10 from posts
           where user_id='22222222-2222-2222-2222-222222222222'),
    'and refusing it must leave no row behind';

  -- One person hitting the limit must not touch anybody else.
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111',true);
  insert into posts (user_id, drink) values
    ('11111111-1111-1111-1111-111111111111','Flat White');
  assert (select count(*) = 4 from posts
           where user_id='11111111-1111-1111-1111-111111111111'),
    'the limit is per person, not global';
end $$;
\echo 'T3 PASS'

\echo '--- T4: a backdated pour does not buy a fresh window ---'
-- The evasion the limit would otherwise have. `created_at` is an
-- insertable column over PostgREST, so a caller can claim their flood
-- happened last week and reset the count. check_post_rate() stamps it
-- for any caller that has a session, which the real client never
-- notices because rowOf() has never sent the column.
do $$
declare fired boolean := false;
begin
  delete from posts where user_id='22222222-2222-2222-2222-222222222222';
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222',true);
  for i in 1..10 loop
    insert into posts (user_id, drink, created_at) values
      ('22222222-2222-2222-2222-222222222222','Espresso','2020-01-01 00:00+00');
  end loop;
  assert (select count(*) = 0 from posts
           where user_id='22222222-2222-2222-2222-222222222222'
             and created_at < '2021-01-01'),
    'a session may not choose when its pour happened';
  begin
    insert into posts (user_id, drink, created_at) values
      ('22222222-2222-2222-2222-222222222222','Espresso','2020-01-01 00:00+00');
  exception when sqlstate 'P0001' then fired := true;
  end;
  assert fired, 'backdating must not reset the window — this is the whole point of T4';
end $$;
\echo 'T4 PASS'

\echo '--- T5: the harness keeps its own clock ---'
-- The other side of T4, and the reason the stamp is guarded rather than
-- unconditional: with no session, a chosen timestamp is honoured. Every
-- other test file in this directory depends on that — friend-pour-test
-- places pours at 05:00 on named mornings.
do $$
begin
  perform set_config('test.uid','',true);
  delete from posts where user_id='11111111-1111-1111-1111-111111111111';
  insert into posts (user_id, drink, created_at) values
    ('11111111-1111-1111-1111-111111111111','Ristretto','2026-08-22 05:00+00');
  assert (select count(*) = 1 from posts
           where user_id='11111111-1111-1111-1111-111111111111'
             and created_at = '2026-08-22 05:00+00'),
    'a fixture with no session must keep the morning it was given';
end $$;
\echo 'T5 PASS'

\echo '--- T6: the upload limit, both ceilings ---'
do $$
declare fired boolean := false;
begin
  delete from upload_grants;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111',true);
  for i in 1..15 loop
    perform claim_upload_slot();
  end loop;
  assert (select count(*) = 15 from upload_grants
           where user_id='11111111-1111-1111-1111-111111111111'),
    'fifteen photos in five minutes is inside the burst ceiling';
  begin
    perform claim_upload_slot();
  exception when sqlstate 'P0001' then fired := true;
  end;
  assert fired, 'the sixteenth must be refused';
  assert (select count(*) = 15 from upload_grants
           where user_id='11111111-1111-1111-1111-111111111111'),
    'and a refused claim must not record a grant';

  -- The hourly ceiling, reached without the burst one: sixty grants
  -- placed across the last hour, none of them inside the last five
  -- minutes. Written directly because the point is the window, not the
  -- function's own bookkeeping.
  delete from upload_grants;
  insert into upload_grants (user_id, created_at)
  select '11111111-1111-1111-1111-111111111111', now() - interval '30 minutes'
  from generate_series(1,60);
  fired := false;
  begin
    perform claim_upload_slot();
  exception when sqlstate 'P0001' then fired := true;
  end;
  assert fired, 'sixty in an hour must close the door even with an empty burst window';
end $$;
\echo 'T6 PASS'

\echo '--- T7: no session, no slot ---'
do $$
declare fired boolean := false;
begin
  perform set_config('test.uid','',true);
  begin
    perform claim_upload_slot();
  exception when sqlstate 'P0001' then fired := true;
  end;
  assert fired, 'a JWT with no subject must not mint an upload URL';
end $$;
\echo 'T7 PASS'

\echo '--- T8: old grants are pruned, and only the caller''s own ---'
do $$
begin
  delete from upload_grants;
  insert into upload_grants (user_id, created_at) values
    ('11111111-1111-1111-1111-111111111111', now() - interval '2 days'),
    ('22222222-2222-2222-2222-222222222222', now() - interval '2 days');
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111',true);
  perform claim_upload_slot();
  assert (select count(*) = 0 from upload_grants
           where user_id='11111111-1111-1111-1111-111111111111'
             and created_at < now() - interval '1 day'),
    'the caller''s stale grants are swept';
  assert (select count(*) = 1 from upload_grants
           where user_id='22222222-2222-2222-2222-222222222222'),
    'somebody else''s are not — a claim is not a vacuum over the whole table';
end $$;
\echo 'T8 PASS'

\echo 'rate-limit-test.sql — all assertions passed'
