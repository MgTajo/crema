-- ============================================================
-- Crema — step 1.26: counting the one thing the loop depends on
--
-- The weekly "week in coffee" card is the growth loop, and until now
-- nothing counted whether anyone ever exports one. That makes the
-- weekly-vs-daily cadence question unfalsifiable: risk 5 in
-- brain/09-red-team.md asks for "fewer than ~15% of active users export
-- a card in a given week" and there is no number on either side of that
-- comparison.
--
-- One table, one row per export, written by the person doing the
-- exporting. Deliberately NOT a general event pipeline:
--
--   * it records an action the user took on purpose (they pressed
--     Share), not passive behaviour — no page views, no sessions, no
--     device fingerprint, no third party, nothing leaving the EU;
--   * it holds a user id, a week and a timestamp, and there is nothing
--     else it could grow into without a schema change and a decision;
--   * the row is the user's own and they can read it back.
--
-- ⚠️ The privacy page says Crema stores no analytics of any kind. After
-- this runs that sentence needs one clause about this table, or the page
-- is wrong. See brain/10-claims.md.
--
-- Run after step-1.25.sql. Idempotent.
-- ============================================================

create table if not exists recap_exports (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles on delete cascade,
  -- The Monday of the week the card is about, in the user's own
  -- timezone — the client already decided which seven days the card
  -- covers, and a server that recomputed it from UTC would sooner or
  -- later count a different week than the one printed on the card.
  week_start date not null,
  -- 'share' when the file went to the OS share sheet, 'download' when
  -- it was saved instead. The split matters: a share is the loop, a
  -- download is someone keeping a picture.
  kind       text not null default 'share' check (kind in ('share','download')),
  created_at timestamptz not null default now()
);

create index if not exists recap_exports_at_idx   on recap_exports (created_at desc);
create index if not exists recap_exports_user_idx on recap_exports (user_id, week_start);

alter table recap_exports enable row level security;

-- You may write your own and read your own. Nobody can read anyone
-- else's, and there is no update or delete policy: a counter that the
-- counted party can rewrite is not a counter. Aggregates are read in the
-- SQL editor (service role, RLS does not apply) — see metrics.sql.
drop policy if exists "users log their own exports" on recap_exports;
drop policy if exists "users read their own exports" on recap_exports;
create policy "users log their own exports"
  on recap_exports for insert with check (auth.uid() = user_id);
create policy "users read their own exports"
  on recap_exports for select using (auth.uid() = user_id);
