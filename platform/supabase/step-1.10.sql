-- ============================================================
-- Crema — no self-likes, no seeded cafés, no test accounts
--
-- Run after step-1.9.sql. Re-runnable.
-- ============================================================

-- ---------- 1. you cannot like your own pour ----------
-- Enforced here, not in the UI. The client hides the button, but the
-- button was never the protection: anyone can POST to /likes with a
-- token. Points come from likes received (step-1.9), so a self-like was
-- a way to award yourself 2 points per tap.
drop policy if exists "users like as themselves" on likes;
create policy "users like as themselves" on likes
  for insert with check (
    auth.uid() = user_id
    and not exists (
      select 1 from posts p
       where p.id = likes.post_id
         and p.user_id = auth.uid()
    )
  );

-- Any self-likes created before the policy existed stop counting.
delete from likes l
 using posts p
 where p.id = l.post_id
   and p.user_id = l.user_id;

-- ---------- 2. remove the seeded cafés ----------
-- The five Tübingen cafés were editorial placeholder content: real
-- names, but hours, ratings and menus that nobody verified. Posts keep
-- their cafe_id column; it just points at nothing now, and the app reads
-- an unresolved id as "no café".
delete from cafe_follows;
delete from cafes;

-- ---------- 3. remove the throwaway test accounts ----------
-- Created while verifying the auth and passport work. Their profile rows
-- are already gone; this removes the auth users, which needs a role the
-- browser never has. Cascades through profiles → posts → likes etc.
delete from auth.users
 where email in ('crema.qa.43284@example.com', 'crema.qa.beans@example.com');

-- ---------- what to expect afterwards ----------
--   select count(*) from cafes;      -- 0
--   select count(*) from auth.users; -- your own accounts only
