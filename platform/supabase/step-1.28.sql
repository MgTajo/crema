-- ============================================================
-- Crema — step 1.28: more than one photo on a pour
--
-- A pour has always been one photo, and one photo is the right default:
-- the feed is a column of squares and a carousel in every card would
-- turn scrolling into work. But a morning is sometimes two pictures —
-- the shot and the pour, the bag and the cup — and there was nowhere to
-- put the second one.
--
-- Premium's line here is the same as everywhere else in Crema: never
-- the truth of the log, only the shelf around it. Everyone can post a
-- photo. Up to three is the Premium version of the same act, so a free
-- account still records the same morning just as honestly.
--
-- Deliberately an ARRAY on the existing table rather than a `post_images`
-- table. Three is a hard cap enforced by a check constraint, the order is
-- the author's and has to survive a round trip, and the feed query
-- already selects the row — a second table would mean a join or an embed
-- on the hottest read in the app to fetch at most two extra strings.
--
-- image_key is NOT retired. It stays the first photo, so:
--   * every reader that predates this — the OG card, the week recap,
--     the profile grid, an old cached client — keeps working untouched;
--   * a client running before this migration lands still writes a
--     perfectly good single-photo pour (see optionalColumns() in
--     src/data/supabase.js, which drops image_keys and retries).
-- The client keeps the two in step: image_keys[1] is always image_key.
--
-- ⚠️ No backups. The Supabase project is on the Free plan, so this runs
-- against the only environment there is. It is additive — one nullable
-- column and one constraint — and re-runnable, which is as safe as a
-- migration gets here, but €25/month for point-in-time recovery is still
-- the fix for the underlying problem.
--
-- Run after step-1.27.sql. Idempotent.
-- ============================================================

alter table posts add column if not exists image_keys text[];

-- The same rule image_key has carried since step-1.11: these hold R2
-- object keys, never inline images. A data: URI here would be three
-- times the damage it was there — 300 KB per photo shipped to every
-- viewer on every feed load, per photo.
alter table posts drop constraint if exists posts_image_keys_are_keys;
alter table posts add constraint posts_image_keys_are_keys
  check (
    image_keys is null
    or (
      cardinality(image_keys) between 1 and 3
      and array_position(image_keys, null) is null
      and not exists (
        select 1 from unnest(image_keys) k
        where k like 'data:%' or length(k) > 300
      )
    )
  );

-- ---------- what the server still decides ----------
-- Premium is a column on profiles that only redeem_premium() can set
-- (step-1.21), so the cap has to be checked here too: a client is a
-- message, a trigger is the lock. A free account writing three keys
-- gets the first one and nothing else, silently and correctly, rather
-- than an error that would lose the pour it came with.
create or replace function enforce_photo_cap() returns trigger
language plpgsql security definer set search_path = public as $$
declare is_prem boolean;
begin
  if new.image_keys is null or cardinality(new.image_keys) <= 1 then
    return new;
  end if;
  select coalesce(premium,false) into is_prem from profiles where id = new.user_id;
  if not coalesce(is_prem,false) then
    new.image_keys := new.image_keys[1:1];
  end if;
  return new;
end $$;

drop trigger if exists posts_photo_cap on posts;
create trigger posts_photo_cap
  before insert or update of image_keys on posts
  for each row execute function enforce_photo_cap();

-- ---------- backfill ----------
-- Every pour that already has a photo gets a one-element array, so the
-- column is never "null means one photo, or means none". Cheap: the
-- table is small and this touches each row once.
update posts
   set image_keys = array[image_key]
 where image_key is not null
   and image_keys is null;
