-- ============================================================
-- Crema — the policies stop asking who you are once per row.
--
-- Step 1b.2 of brain/13-infrastructure-plan.md: query plans and
-- indexes, decided before growth rather than during it.
--
-- WHAT THE PLANS ACTUALLY SHOWED
-- Measured against production on 2026-08-30 with EXPLAIN (ANALYZE,
-- BUFFERS) as `authenticated`, with a real JWT claim set. The feed is
-- already served by posts_public_recent_idx, the inbox by
-- notifications_user_idx, and execution time is a fraction of a
-- millisecond. **Nothing is slow.** At 189 pours nothing could be, and
-- an EXPLAIN at this size mostly measures how well Postgres handles a
-- table that fits in memory.
--
-- What it did show is one thing that is wrong independently of size,
-- and gets linearly worse with it. The feed's Filter came back as:
--
--   Filter: (((hidden_at IS NULL)
--             OR (user_id = (COALESCE(NULLIF(current_setting(
--                  'request.jwt.claim.sub'), ''), ...))::uuid)
--             OR is_admin((COALESCE(NULLIF(current_setting(...
--
-- That COALESCE/NULLIF/current_setting pile is what `auth.uid()`
-- expands to, and it appeared SIX times in one filter — evaluated for
-- every row the scan considers. Postgres will hoist it to an InitPlan
-- and run it once per query, but only if it is written as a scalar
-- subquery. `auth.uid()` is not; `(select auth.uid())` is.
--
-- This is Supabase's own `auth_rls_initplan` lint, and the advisor
-- raised it on **51 policies across 20 tables** — every policy the
-- project has ever written. At 189 posts it costs microseconds. At
-- 100,000 it is 100,000 function calls per query that should have been
-- one, and it is paid by every read of every table.
--
-- Also visible: `Planning Time: 5.9 ms` against `Execution Time:
-- 0.26 ms`. Planning took twenty times longer than running. Simpler
-- policy expressions are cheaper to plan, so this helps there too.
--
-- HOW THIS IS WRITTEN, AND WHY IT IS NOT 51 HAND-TYPED POLICIES
-- The rewrite is generated from `pg_policies` — the database's own
-- account of what its policies are — rather than from 51 statements
-- typed out of the step files. Same principle as the baseline
-- (D-2026-08-29-04) and as gen-push-i18n.mjs: derive from the truth,
-- do not retype it. A hand-typed copy of a security policy that is
-- subtly wrong is the worst artefact this repo could produce, and
-- nothing about reading 51 of them would reliably catch it.
--
-- Each policy is dropped and recreated inside this transaction with
-- its name, command, roles, permissiveness, USING and WITH CHECK
-- preserved exactly, and only the function calls wrapped. If any one
-- of them fails, the whole migration rolls back and every policy is
-- still there — there is no window in which a table is unprotected.
--
-- Re-runnable: the rewrite unwraps before it wraps, so running it twice
-- is the same as running it once.
-- ============================================================

-- The rewrite is a named function rather than an anonymous block for one
-- reason: re-runnability is a claim, and a claim needs a test. A DO
-- block cannot be called twice by a test file; this can, and
-- local-test/rls-initplan-test.sql T7 does exactly that — runs it a
-- second time and asserts that not one character of any policy moved.
create or replace function rls_wrap_auth_calls()
returns int
language plpgsql
security definer
set search_path = public as $fn$
declare
  p            record;
  new_qual     text;
  new_check    text;
  stmt         text;
  role_list    text;
  before_count int;
  after_count  int;
  rewritten    int := 0;
begin
  select count(*) into before_count from pg_policies where schemaname = 'public';

  for p in
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public'
     order by tablename, policyname
  loop
    -- Unwrap first, so this is idempotent: a second run takes the
    -- wrapped form back to bare and then re-wraps it, landing on the
    -- same text rather than on `(select (select auth.uid()))`.
    new_qual := p.qual;
    new_check := p.with_check;

    new_qual := regexp_replace(new_qual,
      '\(\s*SELECT\s+auth\.uid\(\)\s*(AS\s+\w+\s*)?\)', 'auth.uid()', 'g');
    new_qual := regexp_replace(new_qual,
      '\(\s*SELECT\s+is_admin\(\)\s*(AS\s+\w+\s*)?\)', 'is_admin()', 'g');
    new_qual := regexp_replace(new_qual,
      '\(\s*SELECT\s+is_suspended\(\)\s*(AS\s+\w+\s*)?\)', 'is_suspended()', 'g');

    new_check := regexp_replace(new_check,
      '\(\s*SELECT\s+auth\.uid\(\)\s*(AS\s+\w+\s*)?\)', 'auth.uid()', 'g');
    new_check := regexp_replace(new_check,
      '\(\s*SELECT\s+is_admin\(\)\s*(AS\s+\w+\s*)?\)', 'is_admin()', 'g');
    new_check := regexp_replace(new_check,
      '\(\s*SELECT\s+is_suspended\(\)\s*(AS\s+\w+\s*)?\)', 'is_suspended()', 'g');

    -- Now wrap. `is_admin()` with empty parens only — `is_admin(x)`
    -- takes an argument that is itself an auth.uid() being wrapped by
    -- the line above it, and must not be matched here.
    new_qual := replace(new_qual, 'auth.uid()',    '( SELECT auth.uid() )');
    new_qual := replace(new_qual, 'is_admin()',    '( SELECT is_admin() )');
    new_qual := replace(new_qual, 'is_suspended()','( SELECT is_suspended() )');

    new_check := replace(new_check, 'auth.uid()',    '( SELECT auth.uid() )');
    new_check := replace(new_check, 'is_admin()',    '( SELECT is_admin() )');
    new_check := replace(new_check, 'is_suspended()','( SELECT is_suspended() )');

    -- Whether this policy needs touching is decided by asking whether a
    -- BARE call is left after every correctly-wrapped one is stripped
    -- out — not by comparing the rewritten text to the stored text.
    --
    -- Those are not the same question, and the difference is why this
    -- function had a bug that local-test caught: Postgres does not store
    -- the text you hand it, it stores its own printing of the parsed
    -- expression. Hand it `( SELECT auth.uid() )` and it prints back
    -- `( SELECT auth.uid() AS uid)`. A text comparison therefore saw a
    -- difference on every run and rewrote all 54 policies every time —
    -- harmless, idempotent in effect, and a lie in the log.
    if not (
      regexp_replace(coalesce(p.qual,'') || ' ' || coalesce(p.with_check,''),
                     '\(\s*SELECT\s+(auth\.uid|is_admin|is_suspended)\(\)\s*(AS\s+\w+\s*)?\)',
                     '', 'g')
      ~ '(auth\.uid|is_admin|is_suspended)\(\)'
    ) then
      continue;
    end if;

    select string_agg(quote_ident(r), ', ') into role_list
      from unnest(p.roles) as r;

    execute format('drop policy %I on %I.%I',
                   p.policyname, p.schemaname, p.tablename);

    stmt := format('create policy %I on %I.%I as %s for %s to %s',
                   p.policyname, p.schemaname, p.tablename,
                   case when p.permissive = 'PERMISSIVE'
                        then 'PERMISSIVE' else 'RESTRICTIVE' end,
                   p.cmd,
                   coalesce(role_list, 'public'));
    if new_qual is not null then
      stmt := stmt || format(' using (%s)', new_qual);
    end if;
    if new_check is not null then
      stmt := stmt || format(' with check (%s)', new_check);
    end if;
    execute stmt;
    rewritten := rewritten + 1;
  end loop;

  select count(*) into after_count from pg_policies where schemaname = 'public';

  -- Losing a policy silently is the failure mode that matters here: a
  -- dropped SELECT policy denies everybody and looks like a bug, but a
  -- dropped INSERT policy on a table with others is a hole.
  if after_count <> before_count then
    raise exception 'policy count changed: % before, % after — refusing to continue',
      before_count, after_count;
  end if;

  return rewritten;
end $fn$;

-- It rewrites access rules with dynamic DDL. It takes no arguments, so
-- there is nothing to steer it with, and running it twice is a no-op —
-- but it is not a client API and PostgREST must never see it. Same
-- mechanism as mod_record() (migrations/20260829070000).
revoke all on function rls_wrap_auth_calls() from public, anon, authenticated;

do $$
declare n int;
begin
  n := rls_wrap_auth_calls();
  raise notice 'rewrote % policies to use InitPlan-hoistable calls', n;
end $$;

-- The assertion, outside the loop that did the work: nothing anywhere
-- in public still calls one of these per row.
do $$
declare leftovers int;
begin
  select count(*) into leftovers
    from pg_policies
   where schemaname = 'public'
     and (
       regexp_replace(coalesce(qual,'') || ' ' || coalesce(with_check,''),
                      '\(\s*SELECT\s+(auth\.uid|is_admin|is_suspended)\(\)\s*(AS\s+\w+\s*)?\)',
                      '', 'g')
       ~ '(auth\.uid|is_admin|is_suspended)\(\)'
     );
  if leftovers > 0 then
    raise exception '% policies still call auth.uid()/is_admin()/is_suspended() per row', leftovers;
  end if;
end $$;

-- ============================================================
-- Foreign keys without a covering index
-- ============================================================
-- The advisor lists 28. These are the ones that are on a path this
-- application actually walks, and the rule is deliberately narrow:
--
--   * everything that points at `posts`, because deleting a pour is a
--     thing users do today, and every FK without an index turns that
--     one delete into a sequential scan of the referring table;
--   * everything that points at a person, because **Phase 3.3 is about
--     to start deleting accounts** and an account delete cascades into
--     every one of these at once. Doing this after 3.3 ships means
--     discovering it as a timeout in front of somebody exercising a
--     GDPR right;
--   * cafe_follows.cafe_id, which is not a cascade path at all —
--     fetchCafeFollowCounts() reads the whole table and groups by it.
--
-- Deliberately NOT added: challenge_completions.challenge_id,
-- challenge_joins.challenge_id and moderation_actions.report_id.
-- Challenges and reports are never deleted in bulk — a challenge is
-- editorial content and a report is an audit record that outlives what
-- it describes — so these three would be maintained on every insert to
-- serve a delete that does not happen.
--
-- `if not exists` throughout: re-runnable, and harmless against a
-- database where one of them was added by hand.

-- ---------- pointing at posts: deleting a pour ----------
create index if not exists challenge_entries_post_idx on challenge_entries (post_id);
create index if not exists daily_champions_post_idx   on daily_champions (post_id);
create index if not exists daily_firsts_post_idx      on daily_firsts (post_id);
create index if not exists notifications_post_idx     on notifications (post_id);
create index if not exists podium_places_post_idx     on podium_places (post_id);
create index if not exists podium_wins_post_idx       on podium_wins (post_id);
create index if not exists reports_post_idx           on reports (post_id);
create index if not exists saves_post_idx             on saves (post_id);
-- One step further out: posts → comments → comment_likes.
create index if not exists comment_likes_comment_idx  on comment_likes (comment_id);
create index if not exists reports_comment_idx        on reports (comment_id);

-- ---------- pointing at a person: deleting an account ----------
create index if not exists blocks_blocked_idx         on blocks (blocked_id);
create index if not exists challenge_entries_user_idx on challenge_entries (user_id);
create index if not exists comments_user_idx          on comments (user_id);
create index if not exists notifications_actor_idx    on notifications (actor_id);
create index if not exists podium_places_user_idx     on podium_places (user_id);
create index if not exists podium_wins_user_idx       on podium_wins (user_id);
create index if not exists reports_reporter_idx       on reports (reporter_id);
create index if not exists reports_user_idx           on reports (user_id);
create index if not exists moderation_actions_actor_idx on moderation_actions (actor_id);

-- The moderator columns are NULL on all but a handful of rows ever, so
-- these are partial: a full index would be almost entirely empty
-- entries maintained on every write to the two busiest tables.
create index if not exists posts_hidden_by_idx
  on posts (hidden_by) where hidden_by is not null;
create index if not exists comments_hidden_by_idx
  on comments (hidden_by) where hidden_by is not null;
create index if not exists reports_resolved_by_idx
  on reports (resolved_by) where resolved_by is not null;

-- ---------- a read path, not a cascade ----------
create index if not exists cafe_follows_cafe_idx on cafe_follows (cafe_id);

-- ============================================================
-- What is deliberately NOT done here
-- ============================================================
-- The advisor also reports 9 `unused_index` findings. **None of them
-- are dropped**, and the reason is that "unused" is measured from
-- pg_stat_user_indexes since the last statistics reset — on a database
-- this young that means "not used yet", which is a different claim.
-- Three of the nine (client_errors_time, client_errors_user_time,
-- upload_grants_user_time) were created earlier TODAY. Two more
-- (posts_hidden_idx, comments_hidden_idx) exist for moderation, which
-- has never been used in anger — that is a fact about the queue's
-- history, not evidence the indexes are wrong. Re-read this after the
-- statistics have covered a period where the features were used.
--
-- The 6 `multiple_permissive_policies` findings on `reports` are also
-- left alone. Merging "admins read every report" and "users read their
-- own reports" into one policy would save one expression evaluation per
-- row on a table that will never be large, and it would do it by
-- rewriting an access rule that decides who can read moderation
-- reports. That is a bad trade at any table size.

analyze;
