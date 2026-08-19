-- ============================================================
-- Crema — step 1.31: first in Crema, not first for yourself
--
-- Two corrections to step-1.30, and they pull the word "first" apart
-- into the two different things it was doing there.
--
-- 1. THE BONUS IS A RACE, NOT AN ALLOWANCE.
--    step-1.30 paid +20 to every person's own first pour of the day.
--    That is an allowance: everybody collects it, every day, for what
--    they were going to do anyway, and a reward everybody gets is not a
--    reward — it is an across-the-board +20 that inflates every score
--    equally and changes nobody's morning.
--
--    Now exactly ONE pour a day is worth +20: the first one logged in
--    all of Crema. That is a thing you can lose, which is the only
--    reason it is a thing you can win.
--
--    A race needs ONE clock. `crema_day()` below is Europe/Berlin — the
--    same boundary `podium_day()` has used since step-1.18, and for the
--    identical reason stated there: a single global standing has to mean
--    "today" to everybody at once, and the user base is German. Per-user
--    local days stay right for the private things (streaks, challenges,
--    the morning nudge) and are wrong here.
--
-- 2. A FRIEND'S POUR REACHES YOU ONCE A DAY, NOT EVERY TIME.
--    step-1.30 sent an inbox row for every pour by everyone you follow.
--    Its own decision entry named this as the thing that stops being
--    fine as Crema grows; it stopped being fine immediately. Now you
--    hear about a friend's FIRST pour of their day and nothing after it
--    — the news is "Ann is up and has had coffee", which is true once a
--    morning and noise thereafter.
--
--    Note "their day", per-user, not the Berlin one: this is a private
--    question about one person's morning, so it takes the same
--    user_tz() treatment the streak does. The two notions of "first" in
--    this file are deliberately different and both are correct.
--
-- WHAT MOVES WHERE
--    `daily_firsts` keeps its shape and its per-user day, loses its
--    `points`, and stops paying anything. Its only job now is to mark
--    "this pour was that person's first that day" — which is exactly the
--    question the friend notification asks, so the notification is
--    triggered off it rather than off `posts`. That also removes the one
--    thing step-1.30's own comments flagged as fragile: the ordering
--    between the award trigger and the notify trigger was a fact about
--    the alphabet. Now it is causal — no award row, no notification.
--
--    `daily_champions` is new and holds the paid one: one row per day,
--    primary key on `day` alone, which is what makes the race a race.
--
-- WHAT HAPPENS TO POINTS ALREADY PAID
--    Every `daily_firsts` row step-1.30 paid for is re-judged. For each
--    Berlin day that already has awards, the earliest of them becomes
--    that day's champion and keeps its +20; every other +20 handed out
--    under the old rule goes away, and the affected scores are
--    recalculated. Days before step-1.30 ran have no award rows and stay
--    unpaid — this is still not retroactive.
--
-- ⚠️ No backups (Supabase Free), one environment, and it is production.
-- This one is NOT purely additive: it drops a column and takes points
-- back off some accounts. Re-runnable, and verified beforehand against
-- the full local chain:
--   ./platform/supabase/local-test/run.sh step-1.31-test.sql
--
-- ⚠️ ORDER MATTERS MORE THAN USUAL HERE. Dropping `daily_firsts.points`
-- means step-1.30.sql is no longer re-runnable ON ITS OWN: its copy of
-- user_points() still selects that column, so pasting step-1.30 into a
-- database that already has step-1.31 fails at that CREATE FUNCTION. The
-- failure is loud and atomic — a paste runs in one transaction, so
-- nothing is left half-applied — but the rule to remember is: if
-- step-1.30 is ever replayed, replay step-1.31 straight after it, in the
-- same paste. Asserted in local-test/step-1.30-test.sql, T6.
--
-- Run after step-1.30.sql. Idempotent.
-- ============================================================

-- ============================================================
-- 1. CREMA'S OWN DAY
-- ============================================================
-- The same boundary podium_day() has used since step-1.18, given a name
-- and a timestamp argument so the two cannot drift and so a trigger can
-- ask which day a pour belongs to rather than only which day it is now.
-- podium_day() is left exactly as it was: crema_day(now()) equals it by
-- construction, and rewriting a working global standing to prove that is
-- a risk with no return.
--
-- `at time zone 'Europe/Berlin'` and not `::date` on its own: casting a
-- timestamptz to a date resolves it in the SESSION's TimeZone, which is
-- correct on Supabase only because that server happens to run UTC. This
-- is correct because of what it says. (Same fault step-1.17 was written
-- to fix for the per-user side — see local_ts().)
create or replace function crema_day(ts timestamptz) returns date
  language sql immutable as $$ select (ts at time zone 'Europe/Berlin')::date $$;

-- ============================================================
-- 2. THE PAID ONE
-- ============================================================
create table if not exists daily_champions (
  -- PK on `day` alone. This single line is the whole rule: the second
  -- pour of the day conflicts and does nothing, whoever made it.
  day        date primary key,
  user_id    uuid not null references profiles on delete cascade,
  points     int  not null,
  post_id    uuid references posts on delete set null,
  created_at timestamptz default now()
);

create index if not exists daily_champions_user_idx on daily_champions (user_id);

alter table daily_champions enable row level security;

-- Public, like the podium it sits beside: who was first in Crema this
-- morning is a standing, not a secret, and everything in the row is
-- already visible in the fact that they posted. Nobody can write one —
-- no insert, update or delete policy exists, and the only thing that
-- creates a row is the SECURITY DEFINER trigger below.
drop policy if exists "daily champions are public" on daily_champions;
create policy "daily champions are public" on daily_champions for select using (true);

grant select on daily_champions to anon, authenticated;
revoke insert, update, delete on daily_champions from anon, authenticated;

-- ---------- the race ----------
-- Fired straight off `posts` rather than off `daily_firsts`: being first
-- in Crema and being first for yourself are independent questions, and
-- chaining them would make the champion depend on a per-user timezone
-- that has nothing to do with the race.
--
-- `new.created_at` is trusted because the client cannot write it: it is
-- not in baseRow() in src/data/posts.js and not in EDITABLE, so the
-- column takes its `default now()` on every insert Crema makes.
create or replace function award_daily_champion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into daily_champions (day, user_id, points, post_id)
  values (crema_day(new.created_at), new.user_id, crema_first_pour_points(), new.id)
  on conflict (day) do nothing;      -- somebody was already up before you
  return null;
end $$;

drop trigger if exists posts_daily_champion on posts;
create trigger posts_daily_champion after insert on posts
  for each row execute function award_daily_champion();

-- Winning has to move the score in the same transaction, not at the next
-- unrelated recalculation. Same shape and same reasoning as
-- `completions_score` (step-1.17) and `daily_firsts_score` (step-1.30,
-- dropped below): never rely on AFTER triggers on one table firing in a
-- helpful order relative to each other.
drop trigger if exists daily_champions_score on daily_champions;
create trigger daily_champions_score after insert or delete on daily_champions
  for each row execute function trg_score_owner();

-- ---------- telling the winner ----------
-- Nobody else is told. A standing that announced itself to everyone who
-- lost it would be a leaderboard notification, which is a different and
-- much worse feature.
--
-- actor_id stays null: nobody *did* this to them, a standing did, and
-- the inbox draws a symbol rather than a face for those.
create or replace function notify_daily_champion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, actor_id, type, post_id, body)
  values (new.user_id, null, 'daily_champion', new.post_id,
          'First coffee in Crema today · +' || new.points || ' points');
  return null;
exception when others then
  raise notice 'notify_daily_champion failed: %', sqlerrm;
  return null;
end $$;

drop trigger if exists daily_champions_notify on daily_champions;
create trigger daily_champions_notify after insert on daily_champions
  for each row execute function notify_daily_champion();

-- ============================================================
-- 3. daily_firsts STOPS PAYING AND STARTS ANNOUNCING
-- ============================================================
-- Settle the old awards before the column that holds them disappears.
-- For every Berlin day that step-1.30 already paid for, the earliest
-- award of that day becomes the champion; the rest are simply dropped
-- when `points` goes. Ordered by the award row's own created_at, which
-- is insertion order, which is the order the pours arrived in.
--
-- `where not exists` rather than a plain insert so re-running this file
-- never re-decides a day that already has a champion.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name='daily_firsts' and column_name='points') then
    insert into daily_champions (day, user_id, points, post_id, created_at)
    select distinct on (crema_day(f.created_at))
           crema_day(f.created_at), f.user_id, f.points, f.post_id, f.created_at
      from daily_firsts f
     where not exists (select 1 from daily_champions c
                        where c.day = crema_day(f.created_at))
     order by crema_day(f.created_at), f.created_at, f.user_id
    on conflict (day) do nothing;
  end if;
end $$;

alter table daily_firsts drop column if exists points;

-- The writer has to lose the column too, or the next pour inserted fails
-- on a column that is no longer there. Otherwise identical to
-- step-1.30's: the day is still the POSTER's, resolved through
-- local_ts()/user_tz(), because "was this their first this morning" is a
-- private question about one person and the Berlin clock is the wrong
-- answer to it.
create or replace function award_daily_first() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date;
begin
  d := local_ts(new.created_at, user_tz(new.user_id))::date;
  insert into daily_firsts (user_id, day, post_id)
  values (new.user_id, d, new.id)
  on conflict (user_id, day) do nothing;   -- the second cup of their morning
  return null;
end $$;

-- The score trigger goes with the column: a row here is no longer worth
-- anything, so an insert into it must not cost a recalculation.
drop trigger if exists daily_firsts_score on daily_firsts;

-- ---------- the term ----------
-- Rewritten from step-1.30 with `daily_firsts` swapped for
-- `daily_champions`. Everything else is unchanged.
create or replace function user_points(uid uuid)
returns int language sql stable as $$
  select
      -- a coffee logged
      coalesce((select count(*) from posts where user_id = uid), 0) * 10

      -- likes other people put on your pours
    + coalesce((select count(*) from likes l
                  join posts p on p.id = l.post_id
                 where p.user_id = uid), 0) * 2

      -- comments other people left on your pours (never your own)
    + coalesce((select count(*) from comments c
                  join posts p on p.id = c.post_id
                 where p.user_id = uid
                   and c.user_id is distinct from p.user_id), 0) * 3

      -- pours you logged with a repeatable recipe: dose in, yield out
    + coalesce((select count(*) from posts
                 where user_id = uid
                   and coalesce(btrim(recipe->>'dose'),  '') <> ''
                   and coalesce(btrim(recipe->>'yield'), '') <> ''), 0) * 5

      -- distinct beans you have logged, counted once each
    + coalesce((select count(distinct lower(btrim(recipe->>'bean'))) from posts
                 where user_id = uid
                   and coalesce(btrim(recipe->>'bean'), '') <> ''), 0) * 15

      -- challenges finished, each worth what it said it was worth
    + coalesce((select sum(points) from challenge_completions
                 where user_id = uid), 0)

      -- days finished on the podium, each worth what podium_award_day()
      -- gave it (15 / 10 / 5 for 1st / 2nd / 3rd)
    + coalesce((select sum(points) from podium_wins
                 where user_id = uid), 0)

      -- mornings you were first in all of Crema
    + coalesce((select sum(points) from daily_champions
                 where user_id = uid), 0);
$$;

-- ============================================================
-- 4. A FRIEND'S FIRST POUR OF THE DAY
-- ============================================================
-- Moved off `posts` and onto `daily_firsts`. The award row IS the
-- statement "this pour was that person's first today", so triggering
-- here is both the filter and the ordering guarantee: the row cannot
-- exist before the day has been decided, and it cannot exist twice.
--
-- The recipient set, the block handling and the visibility reasoning are
-- carried over from step-1.30's notify_on_post() unchanged — 'public'
-- and 'followers' are both readable by exactly the accepted followers
-- this notifies, which is what makes it safe to send for either.
create or replace function notify_on_daily_first() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.post_id is null then return null; end if;
  insert into notifications (user_id, actor_id, type, post_id, body)
  select f.follower_id, new.user_id, 'friend_pour', new.post_id, 'poured the first coffee of the day'
    from follows f
   where f.followee_id = new.user_id
     and f.status = 'accepted'
     and f.follower_id <> new.user_id            -- a self-follow is not news
     and not exists (select 1 from blocks b
                      where (b.blocker_id = f.follower_id and b.blocked_id = new.user_id)
                         or (b.blocker_id = new.user_id  and b.blocked_id = f.follower_id));
  return null;
exception when others then
  -- An inbox failure must never cost somebody the pour they just made.
  raise notice 'notify_on_daily_first failed: %', sqlerrm;
  return null;
end $$;

drop trigger if exists daily_firsts_notify on daily_firsts;
create trigger daily_firsts_notify after insert on daily_firsts
  for each row execute function notify_on_daily_first();

-- The old one fired on every pour. It is the whole of correction 2.
drop trigger if exists posts_friend_notify on posts;
drop function if exists notify_on_post();

-- ============================================================
-- 5. RE-JUDGE THE SCORES step-1.30 MOVED
-- ============================================================
-- Everybody who was paid under the old rule is recalculated: the day's
-- champion is unchanged, everyone else drops the +20 they were given for
-- turning up. Nobody who never earned one is touched, and recalc_score()
-- writes only when the number actually differs.
do $$
declare u uuid;
begin
  for u in select distinct user_id from daily_firsts
           union
           select distinct user_id from daily_champions
  loop
    perform recalc_score(u);
  end loop;
end $$;

-- ============================================================
-- 6. LOCK THE SURFACE
-- ============================================================
revoke all on function award_daily_champion()  from public, anon, authenticated;
revoke all on function notify_daily_champion() from public, anon, authenticated;
revoke all on function notify_on_daily_first() from public, anon, authenticated;

-- crema_day() keeps its default EXECUTE, like podium_day(): it is a
-- calendar function over a value the caller already has.
