-- ============================================================
-- Crema — badges become something other people can see.
--
-- WHAT WAS WRONG WITH THEM
--
-- computeBadges() in src/domain/scoring.js has always run entirely in
-- the browser, from myPosts() / myBeans() / myCountries() / streak().
-- That made them a private checklist: they existed only on the device
-- of the person who earned them, they appeared on one tab of your own
-- profile and nowhere else, and opening somebody else's profile could
-- not show them because the data they are computed from is not yours to
-- read. A badge nobody else can see is a row in your own memory.
--
-- This is the storage half of fixing that: one text[] on the profile,
-- which is the row every reader of a profile already has in hand
-- (rowToUser() in src/data/profiles.js, CARD in the same file). No new
-- table, no new query, no new join — a face in the feed already carries
-- its owner's level and Premium ring, and now carries this too.
--
-- WHY THE CLIENT WRITES IT, WHEN POINTS AND STREAKS DO NOT
--
-- This is a deliberate exception to "the server is authoritative", and
-- the line is drawn where the incentive is. Points, levels, streaks,
-- the podium and Premium are computed by triggers because they are
-- CONTESTED: they rank people against each other, and a client that
-- could write them could win. Badges rank nobody. They pay no points,
-- unlock nothing, and appear in no ordering. Forging one is exactly as
-- consequential as writing it in your bio, which the same RLS policy
-- has always allowed.
--
-- Buying the alternative — plpgsql twins of eleven predicates over
-- posts, patterns, bean names, origin countries, streak days and
-- challenge wins, kept in step with scoring.js by hand — would cost far
-- more than it protects, and history says how that ends: step-1.32
-- silently dropped a branch of push_on_notification() by rewriting a
-- function from an older copy, and nobody noticed for three days
-- (D-2026-08-30-01). One list, in one language, is the safer shape here.
--
-- The CHECK below is therefore not an anti-cheat measure. It is a size
-- limit: `badges` must not become an unbounded text column anyone can
-- PATCH a megabyte into.
--
-- ⚠️ NO SUBQUERY IN THE CHECK. Postgres rejects one outright (0A000)
-- and in the Supabase SQL editor that rolls the whole file back —
-- step-1.28.sql shipped exactly that mistake on 2026-08-18. Everything
-- in the constraint below is an immutable function call.
--
-- Account deletion needs nothing: this is a column on `profiles`, which
-- already cascades from auth.users.
--
-- Re-runnable.
-- ============================================================

alter table profiles add column if not exists badges text[] not null default '{}';

comment on column profiles.badges is
  'Badge ids earned, written by the owner''s own client (src/domain/scoring.js). '
  'Cosmetic: pays no points, unlocks nothing, orders nothing. See the header of '
  'migrations/20260905090000_badges_are_public.sql for why this one is not server-computed.';

-- Size only. 40 ids is well past the 11 that exist and past any list
-- worth showing a person; 1000 bytes is generous for ids that are short
-- lowercase slugs. Dropped first so the file can be re-run after the
-- limits are ever changed.
alter table profiles drop constraint if exists profiles_badges_bounded;
alter table profiles add constraint profiles_badges_bounded check (
  coalesce(array_length(badges, 1), 0) <= 40
  and coalesce(octet_length(array_to_string(badges, ',')), 0) <= 1000
);

-- ------------------------------------------------------------
-- The export has to carry it.
--
-- export_my_data() names its profile columns one by one rather than
-- taking to_jsonb(p), so a new column does NOT ride along on its own —
-- it is silently absent from every export until somebody adds it here.
-- Art. 15 is "everything about you", and a badge is about you.
--
-- The rest of the function is reproduced unchanged from
-- 20260830200000_account_deletion_and_export.sql. It is a
-- create-or-replace of one large function; the only difference is
-- `p.badges` in the profile block.
-- ------------------------------------------------------------
do $mig$
declare
  src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'export_my_data'
   limit 1;

  if src is null then
    raise notice 'export_my_data() is not here yet — nothing to patch. '
                 'Run 20260830200000_account_deletion_and_export.sql first.';
    return;
  end if;

  if position('p.badges' in src) > 0 then
    raise notice 'export_my_data() already exports badges.';
    return;
  end if;

  -- A textual splice rather than a retyped copy of a 120-line function.
  -- Retyping is how a rewrite from an older copy drops a branch nobody
  -- notices; this cannot, because it edits the definition that is
  -- actually installed and fails loudly if the anchor has moved.
  if position('p.machine_brand, p.machine_model' in src) = 0 then
    raise exception 'export_my_data() no longer contains the anchor this migration splices at. '
                    'Add p.badges to its profile block by hand and re-check.';
  end if;

  src := replace(src,
    'p.machine_brand, p.machine_model',
    'p.badges, p.machine_brand, p.machine_model');
  execute src;
  raise notice 'export_my_data() now exports badges.';
end $mig$;
