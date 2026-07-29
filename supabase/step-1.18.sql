-- ============================================================
-- Crema — step 1.18: the Podium
--
-- Run after step-1.17.sql. Re-runnable.
--
-- What this replaces:
--
--   * The board was every pour ever posted, ranked by likes, fifty deep.
--     That is a hall of fame, and a hall of fame is decided once: the
--     same pours sat on top of it for as long as the app existed, so
--     there was nothing to come back for and nothing a new account could
--     ever reach. It is now **today's podium** — the three most-engaged
--     pours of the current day, likes and comments worth one point each,
--     and only three. It empties every night, which is the whole point:
--     everybody starts the day level.
--
--   * Nobody was ever told they were on it. Standing on a podium you
--     can't see is not a reward. Every pour that holds a place now gets
--     its author a notification saying which place — and, because
--     step-1.16 put push on the notifications table itself rather than on
--     each trigger, that notification reaches the phone for free.
--
--   * And it used to be worth nothing once the notification faded. A day
--     finished on the podium now pays real points toward the Levels
--     screen (15 / 10 / 5 for 1st / 2nd / 3rd) the same way a finished
--     challenge does — settled once, the day it ends, never re-scored
--     after.
--
-- The day boundary is **Europe/Berlin**, not UTC and not per-user. The
-- podium is one global board showing the same three pours to everybody,
-- so "today" has to mean one thing for everybody; the user base is
-- German. (Per-user local days are still right for streaks and
-- challenges, which are private to one person — see user_tz() in
-- step-1.17.)
-- ============================================================

-- ---------- 1. which day the podium is for ----------
create or replace function podium_day() returns date
language sql stable as $$
  select (now() at time zone 'Europe/Berlin')::date;
$$;

-- ---------- 2. the three ----------
-- Ranked by engagement, not raw likes: a pour with fewer likes but a real
-- conversation under it can outrank one that only got tapped. A like and
-- a comment are worth exactly one point each here — a deliberate choice,
-- and deliberately its own number rather than a reuse of POINT_RULES'
-- 2-and-3 weighting for the ordinary profile score. The podium is a
-- separate ranking with its own rule: showing up on it counts, and simple
-- beats clever for a number people are going to eyeball every day.
--
-- Comments exclude the author's own, same as user_points() — otherwise
-- commenting on your own pour a few times is a free way onto the board.
-- Likes do not exclude self-likes, also matching user_points(): there is
-- no constraint stopping a self-like today, so being stricter here than
-- the score itself would be a rule that only exists on the podium.
--
-- row_number(), not rank(): the places must be exactly 1, 2 and 3 with no
-- gaps and no shared steps, because each one is announced as an ordinal.
-- Ties break toward the earlier pour — first to earn the engagement keeps
-- it.
--
-- `visibility = 'public'` is not redundant with RLS. This is security
-- definer, so RLS does not apply inside it; without the filter a
-- followers-only pour could be pushed onto a board the whole app can see.
create or replace function podium_top(d date default null)
returns table(post_id uuid, user_id uuid, place int, likes bigint)
language sql stable security definer set search_path = public as $$
  with day_posts as (
    select p.id, p.user_id, p.created_at,
           (select count(*) from likes l where l.post_id = p.id) as likes,
           (select count(*) from comments c
             where c.post_id = p.id and c.user_id is distinct from p.user_id) as comments
      from posts p
     where p.visibility = 'public'
       and (p.created_at at time zone 'Europe/Berlin')::date = coalesce(d, podium_day())
  )
  select id, user_id,
         (row_number() over (order by likes + comments desc, created_at asc))::int,
         likes
    from day_posts
   where likes + comments > 0
   order by likes + comments desc, created_at asc
   limit 3;
$$;

-- ---------- 3. what the client reads ----------
-- Flat and self-contained, the same shape as the old top_posts view, so
-- one round trip renders the section. security_invoker keeps the caller's
-- RLS over posts/profiles; podium_top() has already restricted the set to
-- public pours, so the two agree.
create or replace view podium_today
  with (security_invoker = true) as
  select p.id, p.user_id, p.drink, p.art, p.pattern, p.quality, p.image_key,
         p.caption, p.cafe_id, p.recipe, p.created_at,
         pr.handle, pr.name, pr.city, pr.avatar_color, pr.level,
         t.likes as like_count, t.place,
         (select count(*) from comments c where c.post_id = p.id) as comment_count
    from podium_top() t
    join posts p    on p.id = t.post_id
    join profiles pr on pr.id = p.user_id;

-- ---------- 4. who has already been told what ----------
-- Without this the sweep below would re-announce the same standing every
-- time anyone anywhere pressed like. Keyed by (day, post) so a pour that
-- falls off and climbs back gets a fresh announcement, which is correct —
-- losing and retaking second place is news.
create table if not exists podium_places (
  day        date not null,
  post_id    uuid not null references posts    on delete cascade,
  user_id    uuid not null references profiles on delete cascade,
  place      int  not null,
  updated_at timestamptz not null default now(),
  primary key (day, post_id)
);

-- No client ever reads or writes this; it is bookkeeping for the sweep.
-- RLS on with no policy at all denies everyone, which is the intent.
alter table podium_places enable row level security;

-- ---------- 5. the sweep ----------
create or replace function podium_check()
returns void language plpgsql security definer set search_path = public as $$
declare
  d date := podium_day();
  r record;
  medal text; ord text;
begin
  -- Anyone knocked off loses their bookmark, so climbing back announces
  -- itself again.
  delete from podium_places pp
   where pp.day = d
     and not exists (select 1 from podium_top(d) t where t.post_id = pp.post_id);

  -- Yesterday's podium is settled and nothing will re-announce it. Keep a
  -- week for debugging, then let it go.
  delete from podium_places where day < d - 7;

  for r in select * from podium_top(d) loop
    -- The WHERE on the conflict path is what makes this idempotent: an
    -- unchanged place updates nothing, leaves FOUND false, and stays
    -- quiet.
    insert into podium_places (day, post_id, user_id, place)
    values (d, r.post_id, r.user_id, r.place)
    on conflict (day, post_id) do update
       set place = excluded.place, updated_at = now()
     where podium_places.place is distinct from excluded.place;

    if found then
      medal := case r.place when 1 then '🥇' when 2 then '🥈' else '🥉' end;
      ord   := case r.place when 1 then '1st' when 2 then '2nd' else '3rd' end;
      insert into notifications (user_id, actor_id, type, post_id, body)
      values (r.user_id, null, 'podium', r.post_id,
              medal || ' ' || ord || ' place on today''s podium');
    end if;
  end loop;
end $$;

-- ---------- 5b. what a finished day paid ----------
-- Permanent, unlike podium_places: that table is same-day bookkeeping and
-- gets pruned after a week, but a paid-out podium finish must never be
-- taken back once user_points() has counted it. The primary key stops a
-- literal duplicate row; podium_award_day() below is what actually stops
-- a day from being paid out twice.
create table if not exists podium_wins (
  day        date not null,
  post_id    uuid not null references posts    on delete cascade,
  user_id    uuid not null references profiles on delete cascade,
  place      int  not null,
  points     int  not null,
  created_at timestamptz not null default now(),
  primary key (day, post_id)
);
alter table podium_wins enable row level security;
drop policy if exists "podium wins are public" on podium_wins;
create policy "podium wins are public" on podium_wins for select using (true);
-- No client insert policy: only podium_award_day() (security definer)
-- writes here, same rule as challenge_completions.

-- Settles one day's podium for good. Only ever called for a day that is
-- no longer today — "today" is still moving, and paying out a place that
-- could still change is the wrong moment to make it permanent.
--
-- Locked at the DAY, not the post: the moment this day has any row in
-- podium_wins at all, it returns without looking at podium_top(d) again.
-- The first cut of an (id, post_id) primary key looked like it would do
-- this, and does not — someone can like an old pour after midnight, and
-- if that promotes a fourth pour into the top three on a later sweep, a
-- per-post conflict target happily inserts it as an extra winner instead
-- of refusing it, handing out a day's worth of points to four people
-- instead of three. Checking "does this day already have any winners"
-- before computing anything is what actually makes the day permanent —
-- a day with zero winners so far stays open, since there is nothing yet
-- to protect from a later rewrite.
create or replace function podium_award_day(d date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if d >= podium_day() then return; end if;
  if exists (select 1 from podium_wins where day = d) then return; end if;

  insert into podium_wins (day, post_id, user_id, place, points)
  select d, t.post_id, t.user_id, t.place,
         case t.place when 1 then 15 when 2 then 10 else 5 end
    from podium_top(d) t;

  perform recalc_score(user_id) from podium_wins where day = d;
end $$;

-- The catch-up sweep: checks the last week of days, same retention window
-- podium_places already uses, so a cron outage of up to a week still
-- settles everything once it's back. Cheap even so — podium_award_day()
-- is a no-op the instant a day already has its rows, and there are at
-- most three per day.
create or replace function podium_award_recent()
returns void language plpgsql security definer set search_path = public as $$
declare d date;
begin
  for d in select generate_series(podium_day() - 7, podium_day() - 1, interval '1 day')::date
  loop
    perform podium_award_day(d);
  end loop;
end $$;

-- ---------- 6. when to sweep ----------
-- Statement-level, not row-level: the podium is a property of the whole
-- likes table, so recomputing it once per statement is both cheaper and
-- exactly as correct. Deleting a pour reshuffles the places behind it, so
-- posts needs the same treatment.
create or replace function trg_podium() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform podium_check();
  return null;
end $$;

drop trigger if exists likes_podium on likes;
drop trigger if exists posts_podium on posts;
create trigger likes_podium after insert or delete on likes
  for each statement execute function trg_podium();
create trigger posts_podium after delete or update of visibility on posts
  for each statement execute function trg_podium();

-- A safety net for podium_check(), not the mechanism: the triggers above
-- are what keep today's board live. This catches a sweep lost to an error
-- and gives the board a defined state after the Berlin midnight rollover
-- even on a quiet day.
--
-- podium_award_recent() rides the same hourly job rather than the
-- per-statement triggers on purpose: settling a day is a batch job, not a
-- reaction to a single like, and running it on every like/comment would
-- mean seven days of podium_top() lookups on every single one of them.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('crema-podium', '4 * * * *',
      $c$ select podium_check(); select podium_award_recent(); $c$);
  else
    raise notice 'pg_cron not installed — enable it and schedule podium_check() + podium_award_recent() hourly';
  end if;
exception when others then
  raise notice 'could not schedule crema-podium: %', sqlerrm;
end $$;

-- ---------- 7. lock the surface ----------
-- podium_check() writes notifications, and podium_award_day()/
-- podium_award_recent() write permanent points — none of the three may be
-- called by anything but the triggers and the cron job, which run as
-- definer regardless of what the caller's own grants are.
revoke all on function podium_check()         from public, anon, authenticated;
revoke all on function podium_award_day(date) from public, anon, authenticated;
revoke all on function podium_award_recent()  from public, anon, authenticated;

-- podium_top() deliberately keeps its default EXECUTE. Revoking it looks
-- tidier and breaks the feature outright: podium_today is
-- security_invoker, so the *caller's* rights are what get checked when
-- the view calls the function, and a signed-in client reading the board
-- got `permission denied for function podium_top`. Nothing leaks by
-- leaving it — it returns ids and like counts for public pours, which is
-- strictly less than the view built on top of it already shows.
grant execute on function podium_top(date) to anon, authenticated;

-- ---------- 8. the old board ----------
-- top_posts ranked every pour ever posted. Nothing reads it now that the
-- client asks for podium_today, and leaving a second, differently-scoped
-- board in the schema is how the two drift apart.
drop view if exists top_posts;

-- ---------- 9. podium finishes pay points ----------
-- Rewritten from step-1.17 with one term added: everyone's score gets a
-- one-time nudge the first time a podium finish of theirs is awarded, and
-- nobody's changes before that, because podium_wins starts empty and the
-- new term is additive.
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
                 where user_id = uid), 0);
$$;

-- ---------- 10. seed today's standing ----------
-- Without this the podium stays blank until the next like lands. Note
-- this announces the current top three to their authors on the first run,
-- which is the intended introduction to the feature.
select podium_check();

-- Settle whatever the last week already decided, so a podium finish from
-- before this migration ran still pays out rather than waiting for the
-- first hourly tick.
select podium_award_recent();
