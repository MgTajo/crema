-- ============================================================
-- Crema — errors get somewhere to go.
--
-- Step 1b.5 of brain/13-infrastructure-plan.md, taking the first-party
-- half of the choice that was tabled on 2026-08-17 and again on
-- 2026-08-28. No Sentry, no third-party processor, no DPA, no new
-- entry in privacy §5, and nothing spent from the privacy positioning
-- that brain/09-red-team.md calls one of Crema's strong points.
--
-- WHAT THIS IS AND IS NOT
-- It is a table a browser can insert one row into when it throws, so
-- that "it crashed for somebody, somewhere, at some point" becomes a
-- row with a date on it. It is NOT breadcrumbs, session replay, release
-- health or a stack trace mapped back through a bundler — Crema has no
-- bundler, so the stack is already the real file and line, which is
-- most of what mapping would have bought.
--
-- WHY IT HAS TO EXIST BEFORE PHASE 4
-- A crash in the web app is a `git push` away from fixed and somebody
-- usually tells you. A crash inside a store binary is a review cycle
-- away, and the person who hit it leaves a one-star review instead of
-- an email.
--
-- WHAT IS DELIBERATELY NOT COLLECTED
-- No IP address, no user agent string, no route, no free-text
-- breadcrumb trail. `user_id` is recorded because a bug that hits one
-- account and no other is a different bug from one that hits everybody,
-- and because it is what makes the per-person rate limit possible. It
-- is nulled rather than cascaded on account deletion (Phase 3.3): the
-- error stays, the person does not.
--
-- Re-runnable.
-- ============================================================

create table if not exists client_errors (
  id          bigserial primary key,
  user_id     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  -- The exception's own message. Truncated by the client, and again
  -- here, because an unbounded text column reachable by an insert
  -- policy is a storage bill with extra steps.
  message     text not null,
  -- file:line:col of the throw, and the stack if the browser gave one.
  source      text,
  stack       text,
  -- Which build was running. `sw.js`'s cache name, e.g. 'crema-v43' —
  -- the one string that says whether a fix has actually reached them.
  app_version text,
  -- 'de' or 'en'. A bug that only happens in German is a real category
  -- here (selectOptions(), notifBody(), push_i18n).
  lang        text,
  constraint client_errors_message_len check (length(message) <= 500),
  constraint client_errors_source_len  check (source is null or length(source) <= 300),
  constraint client_errors_stack_len   check (stack  is null or length(stack)  <= 4000),
  constraint client_errors_version_len check (app_version is null or length(app_version) <= 60),
  constraint client_errors_lang_known  check (lang is null or lang in ('de','en'))
);

create index if not exists client_errors_time on client_errors (created_at desc);
create index if not exists client_errors_user_time on client_errors (user_id, created_at desc);

alter table client_errors enable row level security;

-- Write-only for the person it happened to, readable only by an admin.
-- Nobody can read their own errors back: there is nothing in it for
-- them, and a table you can both write and read is a table somebody
-- will eventually use as storage.
drop policy if exists "people report their own errors" on client_errors;
create policy "people report their own errors"
  on client_errors for insert
  with check (auth.uid() = user_id);

drop policy if exists "admins read the error log" on client_errors;
create policy "admins read the error log"
  on client_errors for select using (is_admin());

-- ---------- the rate limit ----------
-- An error handler is the one piece of client code most likely to run
-- in a loop: a throw inside a render can re-throw on the next frame,
-- and then the reporter is the outage. The client throttles itself
-- (src/core/report.js), but a client-side limit is decoration — this is
-- the one that counts.
--
-- 20 in an hour per account. Past that the row is dropped silently
-- rather than raised: the caller is an error handler, and a rejected
-- insert inside an error handler is a second error to handle.
create or replace function drop_client_error_flood() returns trigger
language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  select count(*) into recent
    from client_errors
   where user_id = new.user_id
     and created_at > now() - interval '1 hour';
  if recent >= 20 then
    return null;   -- BEFORE INSERT returning null: the row is skipped
  end if;
  return new;
end $$;

revoke all on function drop_client_error_flood() from public, anon, authenticated;

drop trigger if exists client_errors_flood on client_errors;
create trigger client_errors_flood
  before insert on client_errors
  for each row execute function drop_client_error_flood();

-- ---------- retention ----------
-- 30 days. Long enough to see whether a fix worked, short enough that
-- this never becomes a pile of personal data nobody remembers holding.
-- Phase 3.3 has to write a retention policy; this is that policy for
-- this table, in the only place that enforces it.
select cron.schedule(
  'crema-client-errors-prune',
  '17 4 * * *',
  $cron$delete from client_errors where created_at < now() - interval '30 days'$cron$
);
