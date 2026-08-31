-- ============================================================
-- Crema — somewhere for a phone's push token to live.
--
-- Step 4.1 of brain/13-infrastructure-plan.md: "native push (APNs/FCM,
-- replacing Web Push on native only — Web Push stays for the web app)".
-- This is the storage half of that sentence. The SENDING half is 4.2
-- and cannot be built yet: it needs an APNs key from an Apple Developer
-- account and an FCM service account from a Firebase project, neither
-- of which exists (see 13-infrastructure-plan.md §8, "what an agent
-- cannot do"). So this table will sit empty until those exist, and it
-- is deliberately written so that being empty costs nothing.
--
-- WHY A NEW TABLE RATHER THAN COLUMNS ON push_subscriptions
--
-- That was the first design and it was wrong, for one specific reason
-- worth writing down: `push_subscriptions` is on the hot path of every
-- notification in production RIGHT NOW. push_on_notification() and the
-- two other senders from step-1.16/step-1.32 read it and hand each row
-- to send-push, which does RFC 8291 encryption against a Web Push
-- endpoint URL. A native token is not a URL and has no p256dh/auth. Put
-- one in that table and every existing sender would either have to grow
-- a `where platform = 'web'` — a rewrite of three live plpgsql
-- functions, which is exactly how step-1.32 silently dropped the
-- notify_friends branch on 2026-08-27 and nobody noticed for three days
-- (D-2026-08-30-01) — or start failing on rows it cannot understand.
--
-- A separate table touches none of that. Web Push keeps working exactly
-- as it does today, this migration cannot break it, and the native
-- sender arrives later as an addition rather than as an edit. The cost
-- is one join that nothing needs yet.
--
-- ACCOUNT DELETION: `on delete cascade` to auth.users, so Phase 3.3's
-- deletion path covers this table the day it exists without anyone
-- adding it to a list. account-deletion-test.sql T4 asks pg_constraint
-- which columns point at a profile rather than checking a list, which
-- is the property that makes that true (D-2026-08-30-13).
--
-- Re-runnable.
-- ============================================================

create table if not exists native_push_tokens (
  -- The token itself is the identity: one device, one row, and a device
  -- that re-registers updates rather than duplicates — the same reason
  -- push_subscriptions keys on `endpoint`. APNs and FCM both rotate
  -- these without telling anyone, so a stale row is normal and is
  -- cleaned up by fail_count below rather than by anyone's diligence.
  token       text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,

  -- 'ios' | 'android'. Not a boolean, because the two need different
  -- senders (APNs HTTP/2 with a p8 key; FCM HTTP v1 with a service
  -- account) and a third platform is not impossible.
  platform    text not null check (platform in ('ios','android')),

  -- Per DEVICE, exactly as push_subscriptions.tz_offset and .lang are,
  -- and for the same reasons: the notification appears on THIS phone, in
  -- the evening where this phone is, in the language this phone reads.
  -- step-1.32 established that shape; there is no argument for a
  -- different one here.
  tz_offset   integer not null default 0,
  lang        text    not null default 'en',

  -- APNs and FCM both answer "this token is dead" (410 / UNREGISTERED).
  -- Same counter, same meaning, same eventual prune as the web table.
  fail_count  integer not null default 0,
  last_seen   timestamptz default now(),
  created_at  timestamptz default now()
);

-- Every send starts "which devices does this person have", so this is
-- the index that matters. It is created explicitly rather than left to
-- the foreign key, which does not make one — the finding from 1b.2 that
-- 23 foreign keys in this schema had no index behind them
-- (20260830170000).
create index if not exists native_push_tokens_user_idx
  on native_push_tokens (user_id);

alter table native_push_tokens enable row level security;

-- ------------------------------------------------------------
-- RLS. A push token is a routing address for one person's phone: it is
-- theirs, and nobody else has any business reading or writing it.
--
-- `(select auth.uid())` and not a bare `auth.uid()`: the subselect is
-- what makes the policy an InitPlan, evaluated once per statement
-- instead of once per row. That is the whole of migration
-- 20260830170000, applied to a table written after it, so this one is
-- not the fifty-second exception.
-- ------------------------------------------------------------
drop policy if exists "own tokens are readable" on native_push_tokens;
create policy "own tokens are readable" on native_push_tokens
  for select using (user_id = (select auth.uid()));

drop policy if exists "own tokens are writable" on native_push_tokens;
create policy "own tokens are writable" on native_push_tokens
  for insert with check (user_id = (select auth.uid()));

drop policy if exists "own tokens are updatable" on native_push_tokens;
create policy "own tokens are updatable" on native_push_tokens
  for update using (user_id = (select auth.uid()))
           with check (user_id = (select auth.uid()));

-- Turning notifications off on a device deletes its row, the same way
-- disablePush() deletes the web subscription. Off has to mean off.
drop policy if exists "own tokens are deletable" on native_push_tokens;
create policy "own tokens are deletable" on native_push_tokens
  for delete using (user_id = (select auth.uid()));

comment on table native_push_tokens is
  'APNs/FCM device tokens for the Capacitor shell (step 4.1). Web Push '
  'lives in push_subscriptions and is untouched by this table. Empty '
  'until 4.2 provides the credentials to send with.';
