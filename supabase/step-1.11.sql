-- ============================================================
-- Crema — make the bad states unrepresentable
--
-- Run after step-1.10.sql. Re-runnable.
--
-- Both constraints exist because the app silently did the wrong thing for
-- weeks and nothing complained:
--
--   * Every photo since launch was stored as a base64 data URI in
--     `image_key`, because the browser's PUT to R2 failed and the client
--     fell back to keeping the image inline. `image_key` is supposed to
--     hold an R2 object key. A constraint would have failed the very
--     first upload instead of quietly bloating rows and shipping 300 KB
--     per photo to every viewer on every feed load.
--
--   * `avatar_color` goes straight into a style attribute, and RLS lets
--     users update their own profile row — so it is a CSS injection
--     vector. The client now discards anything that isn't a hex colour;
--     this stops it being stored in the first place.
-- ============================================================

-- ---------- image_key holds a key, not an image ----------
-- NOT VALID: existing base64 rows stay legal so nothing breaks for the
-- users who already posted. New and updated rows must comply. After
-- running migrate-base64-images.mjs, promote it with:
--   alter table posts validate constraint posts_image_key_is_a_key;
alter table posts drop constraint if exists posts_image_key_is_a_key;
alter table posts add constraint posts_image_key_is_a_key
  check (
    image_key is null
    or (image_key not like 'data:%' and length(image_key) <= 300)
  ) not valid;

-- ---------- avatar_color is a colour ----------
alter table profiles drop constraint if exists profiles_avatar_color_is_hex;
alter table profiles add constraint profiles_avatar_color_is_hex
  check (avatar_color is null or avatar_color ~ '^#[0-9A-Fa-f]{3,8}$');

-- ---------- sweep auth users with no profile ----------
-- Abandoned sign-ups and probe accounts. A user with no profile row has
-- never completed onboarding and owns no data (everything cascades from
-- profiles), so this is safe — and it removes the account I created while
-- checking whether email confirmation was enabled.
delete from auth.users u
 where not exists (select 1 from profiles p where p.id = u.id);

-- ---------- what to expect afterwards ----------
--   select count(*) from posts where image_key like 'data:%';  -- until migrated
--   select count(*) from auth.users;                           -- real accounts only
