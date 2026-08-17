-- ============================================================
-- Crema — step 1.25: the app finds out while you are still looking
--
-- Run after step-1.24.sql. Re-runnable.
--
-- Until now nothing pushed. The feed, the bell and an open thread were
-- fetched when something asked for them and were otherwise as old as the
-- last fetch, and the only thing that caused another one was leaving the
-- app and coming back (refreshOnReturn() in src/ui/actions.js). Someone
-- poured at the next table and you found out tomorrow.
--
-- This adds the five tables the client subscribes to (src/data/
-- realtime.js) to the `supabase_realtime` publication, which is what
-- Realtime replicates from. Nothing else changes: no new table, no new
-- column, no policy touched, no data written or moved.
--
-- ⚠️  There are still no backups on this project (Supabase Free). This
--     migration is additive and reversible — the `drop` statements at
--     the bottom of this file undo it exactly — but that is a property
--     of THIS file, not of the setup. The €25/month Pro plan is what
--     buys daily backups and point-in-time recovery.
--
-- SECURITY: adding a table to the publication does NOT widen who can
-- read it. Realtime evaluates each subscriber's RLS against every change
-- before sending it, using the access token the client joins with — so a
-- followers-only pour (step-1.15) reaches exactly the people a SELECT
-- would have handed it to, and `notifications` is additionally filtered
-- to the subscriber's own user_id in the client's join. The one thing to
-- know is that DELETE payloads carry the replica identity, i.e. the
-- primary key, and RLS on DELETE events is evaluated against that alone.
-- Every primary key here is an id or an (actor, target) pair — nothing
-- private travels in one.
--
-- The app does not depend on this having been run. src/store/live.js
-- polls every 60 seconds while the tab is on screen when the socket does
-- not come up, and the join failure is logged with this file's name.
-- Running it turns a one-minute delay into a sub-second one.
-- ============================================================

-- The publication exists on every Supabase project, but on a project
-- that has never used Realtime it can be missing entirely.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- `alter publication … add table` errors if the table is already a
-- member, which would make this file run-once. Guarded, so it isn't.
do $$
declare
  t text;
  wanted text[] := array['posts','comments','likes','reactions','notifications'];
begin
  foreach t in array wanted loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'realtime: public.% added', t;
    else
      raise notice 'realtime: public.% already published', t;
    end if;
  end loop;
end $$;

-- Replica identity is deliberately left at the default (the primary
-- key). The client only needs a DELETE to name what it referred to, and
-- every primary key here already does:
--
--   posts, comments        (id)
--   likes, saves           (user_id, post_id)
--   reactions              (user_id, post_id, kind)
--   notifications          (id)
--
-- `replica identity full` would put the whole deleted row on the wire
-- for every subscriber instead, which is both more WAL and more than
-- anyone needs to know about a comment that was taken down.

-- ---------- what this looks like when it worked ----------
-- select schemaname, tablename from pg_publication_tables
--  where pubname = 'supabase_realtime' order by tablename;
--
-- ---------- undo ----------
-- alter publication supabase_realtime drop table public.posts;
-- alter publication supabase_realtime drop table public.comments;
-- alter publication supabase_realtime drop table public.likes;
-- alter publication supabase_realtime drop table public.reactions;
-- alter publication supabase_realtime drop table public.notifications;
