\set ON_ERROR_STOP on
\pset pager off

-- ============================================================
-- The InitPlan rewrite — step 1b.2
--
--   ./platform/supabase/local-test/run.sh rls-initplan-test.sql
--
-- migrations/20260830170000 rewrites every policy in `public` so that
-- auth.uid(), is_admin() and is_suspended() are scalar subqueries and
-- get hoisted to an InitPlan instead of being called per row.
--
-- The rewrite is generated from pg_policies rather than typed out, so
-- the thing that has to be proved is not "did somebody copy 51 policies
-- correctly" — it is "does the database still enforce the same rules".
-- This file asserts the mechanical property, and then the BEHAVIOUR,
-- because a rewrite of every access rule in the project is exactly the
-- change where a green shape check would be worth nothing.
--
-- The whole rest of this directory is also the test for this migration:
-- moderation-test.sql and step-1.29-test.sql already exercise RLS as
-- `authenticated` from both sides.
-- ============================================================

delete from client_errors; delete from upload_grants;
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
insert into profiles (id, handle, name, tz_offset, is_admin) values
  ('11111111-1111-1111-1111-111111111111','ann','Ann',0,false),
  ('22222222-2222-2222-2222-222222222222','bo', 'Bo', 0,false),
  ('33333333-3333-3333-3333-333333333333','mod','Mod',0,true);

\echo '--- T1: no policy calls auth.uid() per row any more ---'
do $$
declare leftovers int; total int;
begin
  select count(*) into total from pg_policies where schemaname='public';
  assert total > 40, 'sanity: the rewrite must not have eaten the policies, got ' || total::text;

  -- Strip every correctly-wrapped call, then look for what is left.
  select count(*) into leftovers
    from pg_policies
   where schemaname='public'
     and regexp_replace(coalesce(qual,'') || ' ' || coalesce(with_check,''),
                        '\(\s*SELECT\s+(auth\.uid|is_admin|is_suspended)\(\)\s*(AS\s+\w+\s*)?\)',
                        '', 'g')
         ~ '(auth\.uid|is_admin|is_suspended)\(\)';
  assert leftovers = 0,
    leftovers::text || ' policies still call auth.uid()/is_admin()/is_suspended() bare';

  -- And the wrapping actually happened, rather than every policy having
  -- quietly lost its condition.
  assert (select count(*) from pg_policies
           where schemaname='public'
             and coalesce(qual,'')||coalesce(with_check,'') ~ 'SELECT\s+auth\.uid\(\)') > 30,
    'most policies should now contain a wrapped auth.uid()';
end $$;
\echo 'T1 PASS'

\echo '--- T2: a pour is still private to its audience ---'
-- The policy this migration rewrote that has the most moving parts:
-- hidden_at, visibility, ownership, admin, and an EXISTS over follows.
insert into posts (user_id, drink, visibility) values
  ('11111111-1111-1111-1111-111111111111','Cortado','public'),
  ('11111111-1111-1111-1111-111111111111','Secret Espresso','followers');
do $$
declare n int;
begin
  set local role authenticated;

  perform set_config('test.uid','22222222-2222-2222-2222-222222222222',true);
  select count(*) into n from posts;
  assert n = 1, 'a stranger sees the public pour and not the followers-only one, got ' || n::text;

  perform set_config('test.uid','11111111-1111-1111-1111-111111111111',true);
  select count(*) into n from posts;
  assert n = 2, 'the author sees both of their own, got ' || n::text;
  reset role;
end $$;
\echo 'T2 PASS'

\echo '--- T3: a follower sees it, and the EXISTS still runs ---'
insert into follows (follower_id, followee_id, status) values
  ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','accepted'),
  ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','pending');
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222',true);
  select count(*) into n from posts;
  assert n = 2, 'an accepted follower sees the followers-only pour, got ' || n::text;

  -- A pending request is not a follow. If the rewrite had dropped the
  -- status term this would pass at 2 and nobody would notice until
  -- somebody read a stranger's private pour.
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333',true);
  select count(*) into n from posts where visibility='followers';
  assert n = 0, 'a PENDING follower sees nothing, got ' || n::text;
  reset role;
end $$;
\echo 'T3 PASS'

\echo '--- T4: you still write only as yourself ---'
do $$
declare denied boolean := false;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222',true);
  begin
    insert into posts (user_id, drink) values
      ('11111111-1111-1111-1111-111111111111','Forged');
  exception when insufficient_privilege then denied := true;
  end;
  assert denied, 'the WITH CHECK half of the rewrite still holds';

  denied := false;
  begin
    delete from posts where user_id='11111111-1111-1111-1111-111111111111';
  exception when insufficient_privilege then denied := true;
  end;
  -- RLS filters rather than raises on DELETE: the rows are invisible to
  -- the delete, so the assertion is that they survive.
  assert (select count(*) = 2 from posts
           where user_id='11111111-1111-1111-1111-111111111111'),
    'somebody else''s pours are not deletable';
  reset role;
end $$;
\echo 'T4 PASS'

\echo '--- T5: an admin is still an admin, and only through is_admin() ---'
do $$
declare n int;
begin
  update posts set hidden_at = now()
   where drink = 'Cortado';

  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222',true);
  select count(*) into n from posts where drink='Cortado';
  assert n = 0, 'a hidden pour is hidden from an ordinary reader, got ' || n::text;

  perform set_config('test.uid','33333333-3333-3333-3333-333333333333',true);
  select count(*) into n from posts where drink='Cortado';
  assert n = 1, 'and visible to an admin — the wrapped is_admin() still resolves, got ' || n::text;
  reset role;
end $$;
\echo 'T5 PASS'

\echo '--- T6: the foreign-key indexes exist ---'
do $$
declare missing text;
begin
  select string_agg(want, ', ') into missing
    from unnest(array[
      'challenge_entries_post_idx','daily_champions_post_idx','daily_firsts_post_idx',
      'notifications_post_idx','podium_places_post_idx','podium_wins_post_idx',
      'reports_post_idx','saves_post_idx','comment_likes_comment_idx','reports_comment_idx',
      'blocks_blocked_idx','challenge_entries_user_idx','comments_user_idx',
      'notifications_actor_idx','podium_places_user_idx','podium_wins_user_idx',
      'reports_reporter_idx','reports_user_idx','moderation_actions_actor_idx',
      'posts_hidden_by_idx','comments_hidden_by_idx','reports_resolved_by_idx',
      'cafe_follows_cafe_idx'
    ]) as want
   where not exists (select 1 from pg_indexes
                      where schemaname='public' and indexname = want);
  assert missing is null, 'missing indexes: ' || coalesce(missing,'');
end $$;
\echo 'T6 PASS'

\echo '--- T7: running it a second time changes nothing ---'
-- The real idempotency test, not a proxy for one: the migration's own
-- rewrite function, called again over the already-rewritten policies.
-- Without the unwrap step this would produce
-- (select (select auth.uid())) — valid SQL, still correct, and one
-- layer deeper on every deploy until somebody reads a policy and cannot
-- work out what it says.
do $$
declare before_txt text; after_txt text; n int;
begin
  select string_agg(tablename || '.' || policyname || '|' || cmd || '|' ||
                    coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n'
                    order by tablename, policyname)
    into before_txt from pg_policies where schemaname='public';

  n := rls_wrap_auth_calls();
  assert n = 0, 'a second run must rewrite nothing at all, it rewrote ' || n::text;

  select string_agg(tablename || '.' || policyname || '|' || cmd || '|' ||
                    coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n'
                    order by tablename, policyname)
    into after_txt from pg_policies where schemaname='public';
  assert before_txt = after_txt, 'not one character of any policy may have moved';

  assert (select count(*) from pg_policies
           where schemaname='public'
             and (coalesce(qual,'')||coalesce(with_check,'')) ~ 'SELECT\s+\(\s*SELECT') = 0,
    'nothing may be double-wrapped';
end $$;
\echo 'T7 PASS'

\echo '--- T8: the rewrite function is not a client API ---'
do $$
begin
  assert not has_function_privilege('anon','rls_wrap_auth_calls()','execute'),
    'anon must not be able to rewrite the access rules';
  assert not has_function_privilege('authenticated','rls_wrap_auth_calls()','execute'),
    'and neither may a signed-in account — mod_record() is why this is asserted';
end $$;
\echo 'T8 PASS'

\echo 'rls-initplan-test.sql — all assertions passed'
