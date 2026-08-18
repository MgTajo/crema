-- ============================================================
-- Crema — step 1.29: your shelf follows you to the next device
--
-- The coffees and machines you add yourself, what you wrote about them,
-- which ones are favourites, and the drink names you invented have all
-- lived in `localStorage` since the beginning. That was never a decision
-- so much as a leftover: `state` was designed as one blob behind a
-- persistence seam that would "become a backend later", and then posts,
-- follows, likes and saves each got a real table while this remainder
-- stayed where it was.
--
-- The result is a shelf that does not exist on your laptop. It is worse
-- than it sounds for the Premium half: someone is invited to write down
-- what they paid for a bag and how they dial it in, and that writing is
-- one cleared browser cache from gone. Asking people to put effort into
-- something and then storing it where it cannot survive a new phone is
-- the wrong trade to have shipped.
--
-- ONE ROW PER ITEM, not one blob per user. A blob is a single read and a
-- single write, and also last-write-wins: add a bag on your phone and a
-- different one on your laptop and one of them is gone. Per-item rows
-- merge for free, and deleting is a DELETE rather than a diff.
--
-- The three RPCs below exist because PostgREST's upsert
-- (`Prefer: resolution=merge-duplicates`) writes a WHOLE row — noting a
-- coffee would reset `own` to false and clear `fav_at`. Each function
-- touches exactly one column and leaves the others alone, which is what
-- the three independent things a user does to a shelf entry require.
--
-- ⚠️ No backups (Supabase Free), one environment, and it is production.
-- This is additive — one new table, no existing table touched — and it
-- is re-runnable. Verified beforehand against the full local chain:
--   ./platform/supabase/local-test/run.sh step-1.29-test.sql
--
-- Run after step-1.28.sql. Idempotent.
-- ============================================================

create table if not exists user_gear (
  user_id  uuid not null references profiles on delete cascade,
  -- 'bean' and 'machine' are the two pickers. 'drink' is here too
  -- because a Premium user's own drink names are the same kind of
  -- thing — something they made up, that only they can pick — and
  -- syncing two of the three would be a worse answer than either.
  kind     text not null check (kind in ('bean','machine','drink')),
  -- The display string, exactly as a recipe stores it. That is what
  -- makes this table joinable to reality without an id nobody has:
  -- `posts.recipe->>'bean'` is this string.
  name     text not null check (length(btrim(name)) between 1 and 120),
  -- True when they added the name themselves. False for a catalogue
  -- entry they merely wrote a note on — the client shows a different
  -- sheet for each, and "did I invent this" is not answerable from the
  -- catalogue, which grows.
  own      boolean not null default false,
  -- {roaster,origin,roast,notes,note} for a bean, {kind,note} for a
  -- machine. Capped: this is free-text the owner alone ever reads, so
  -- the only real risk is somebody parking a megabyte in it.
  info     jsonb check (info is null or length(info::text) <= 2000),
  -- Null means "not a favourite". A timestamp rather than a boolean so
  -- the picker can order them newest-first, which is the order the old
  -- local array had by construction (it unshifted).
  fav_at   timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, name)
);

create index if not exists user_gear_user_idx on user_gear (user_id, kind);

-- ---------- updated_at ----------
create or replace function user_gear_touch() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists user_gear_touch on user_gear;
create trigger user_gear_touch before update on user_gear
  for each row execute function user_gear_touch();

-- ---------- RLS: yours, and nobody else's ----------
-- There is no "public" side to this table. A note is private by
-- construction, which is exactly why the app invites people to write
-- freely in it, so `select` is owner-only like the rest.
alter table user_gear enable row level security;

drop policy if exists "own gear readable"   on user_gear;
drop policy if exists "own gear insertable" on user_gear;
drop policy if exists "own gear updatable"  on user_gear;
drop policy if exists "own gear deletable"  on user_gear;

create policy "own gear readable"   on user_gear for select using (auth.uid() = user_id);
create policy "own gear insertable" on user_gear for insert with check (auth.uid() = user_id);
create policy "own gear updatable"  on user_gear for update using (auth.uid() = user_id)
                                                        with check (auth.uid() = user_id);
create policy "own gear deletable"  on user_gear for delete using (auth.uid() = user_id);

-- ---------- the three things you can do to a shelf entry ----------
-- security INVOKER (the default) on purpose: RLS is the check, and
-- writing `auth.uid()` into user_id means the insert policy is the same
-- sentence as the intent. A definer function here would be a lock
-- guarding nothing, with a bypass to get wrong.

-- 1. "this one is mine" — adding a coffee or machine the catalogue lacks.
create or replace function gear_remember(p_kind text, p_name text)
returns void language plpgsql as $$
begin
  if auth.uid() is null or btrim(coalesce(p_name,'')) = '' then return; end if;
  insert into user_gear (user_id, kind, name, own)
  values (auth.uid(), p_kind, btrim(p_name), true)
  on conflict (user_id, kind, name) do update set own = true;
end $$;

-- 2. what you wrote about it. Null clears the note — and if that leaves
--    a row that is not yours and not a favourite, the row was only ever
--    the note, so it goes with it rather than lingering as a fact that
--    claims you wrote something about this.
create or replace function gear_note(p_kind text, p_name text, p_info jsonb)
returns void language plpgsql as $$
begin
  if auth.uid() is null or btrim(coalesce(p_name,'')) = '' then return; end if;
  insert into user_gear (user_id, kind, name, info)
  values (auth.uid(), p_kind, btrim(p_name), p_info)
  on conflict (user_id, kind, name) do update set info = excluded.info;

  delete from user_gear
   where user_id = auth.uid() and kind = p_kind and name = btrim(p_name)
     and info is null and fav_at is null and not own;
end $$;

-- 3. the star.
create or replace function gear_fav(p_kind text, p_name text, p_on boolean)
returns void language plpgsql as $$
begin
  if auth.uid() is null or btrim(coalesce(p_name,'')) = '' then return; end if;
  insert into user_gear (user_id, kind, name, fav_at)
  values (auth.uid(), p_kind, btrim(p_name), case when p_on then now() else null end)
  on conflict (user_id, kind, name)
    do update set fav_at = case when p_on then coalesce(user_gear.fav_at, now()) else null end;

  delete from user_gear
   where user_id = auth.uid() and kind = p_kind and name = btrim(p_name)
     and info is null and fav_at is null and not own;
end $$;

revoke all on function gear_remember(text,text) from public;
revoke all on function gear_note(text,text,jsonb) from public;
revoke all on function gear_fav(text,text,boolean) from public;
grant execute on function gear_remember(text,text)     to authenticated;
grant execute on function gear_note(text,text,jsonb)   to authenticated;
grant execute on function gear_fav(text,text,boolean)  to authenticated;

-- ---------- what is deliberately NOT here ----------
-- No Premium check. Writing a note is Premium in the client, and unlike
-- the photo cap in step-1.28 there is nothing behind that line worth
-- locking: the data is private, it is capped at 2 KB, and it costs
-- nobody anything. A trigger here would be a profiles lookup on every
-- shelf write, buying a rule that only ever affected the person who
-- broke it. If Premium ever gains a perk that costs something, that one
-- gets the trigger.
--
-- No backfill either, and it could not have one: what people already
-- have is in their browsers, not in this database. The client pushes
-- its local shelf up once on the first load after this ships — see
-- hydrateGear() in src/store/store.js — and after that the server is
-- the truth.
