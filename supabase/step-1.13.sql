-- ============================================================
-- Crema — a face on the profile, if you want one
--
-- Run after step-1.12.sql. Re-runnable.
--
-- Avatars have always been initials on a generated colour, which is a
-- fine default and stays the default: `avatar_key` is null for everyone
-- until they pick a photo, and null renders exactly what it renders now.
--
-- The key points at an R2 object, the same as posts.image_key — the
-- image itself never goes in the database. That mistake has been made
-- once already on this project (step-1.11.sql), so the constraint lands
-- with the column this time rather than after the fact.
-- ============================================================

alter table profiles add column if not exists avatar_key text;

-- Same shape as posts_image_key_is_a_key, and VALID from the start:
-- there are no existing rows to grandfather in.
alter table profiles drop constraint if exists profiles_avatar_key_is_a_key;
alter table profiles add constraint profiles_avatar_key_is_a_key
  check (
    avatar_key is null
    or (avatar_key not like 'data:%' and length(avatar_key) <= 300)
  );

-- RLS is unchanged and already correct: "users update their own profile"
-- (schema.sql) covers the new column, and profiles are world-readable, so
-- everyone can see everyone's avatar. Nothing to add.

-- ---------- what to expect afterwards ----------
--   select count(*) from profiles where avatar_key is not null;   -- 0 at first
--   -- and this must fail:
--   --   update profiles set avatar_key = 'data:image/png;base64,AAAA' where id = auth.uid();
