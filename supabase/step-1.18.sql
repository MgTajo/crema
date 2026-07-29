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
--     ever reach. It is now **today's podium** — the three most-liked
--     pours of the current day, and only three. It empties every night,
--     which is the whole point: everybody starts the day level.
--
--   * Nobody was ever told they were on it. Standing on a podium you
--     can't see is not a reward. Every pour that holds a place now gets
--     its author a notification saying which place — and, because
--     step-1.16 put push on the notifications table itself rather than on
--     each trigger, that notification reaches the phone for free.
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
-- row_number(), not rank(): the places must be exactly 1, 2 and 3 with no
-- gaps and no shared steps, because each one is announced as an ordinal.
-- Ties break toward the earlier pour — first to earn the like keeps it.
--
-- `visibility = 'public'` is not redundant with RLS. This is security
-- definer, so RLS does not apply inside it; without the filter a
-- followers-only pour could be pushed onto a board the whole app can see.
create or replace function podium_top(d date default null)
returns table(post_id uuid, user_id uuid, place int, likes bigint)
language sql stable security definer set search_path = public as $$
  with day_posts as (
    select p.id, p.user_id, p.created_at,
           (select count(*) from likes l where l.post_id = p.id) as likes
      from posts p
     where p.visibility = 'public'
       and (p.created_at at time zone 'Europe/Berlin')::date = coalesce(d, podium_day())
  )
  select id, user_id,
         (row_number() over (order by likes desc, created_at asc))::int,
         likes
    from day_posts
   where likes > 0
   order by likes desc, created_at asc
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

-- A safety net, not the mechanism: the triggers above are what keep the
-- podium live. This catches a sweep lost to an error and gives the board
-- a defined state after the Berlin midnight rollover even on a quiet day.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('crema-podium', '4 * * * *', $c$ select podium_check(); $c$);
  else
    raise notice 'pg_cron not installed — enable it and schedule podium_check() hourly';
  end if;
exception when others then
  raise notice 'could not schedule crema-podium: %', sqlerrm;
end $$;

-- ---------- 7. lock the surface ----------
-- podium_check() writes notifications, so nobody may call it but the
-- triggers and the cron job, which run as definer.
revoke all on function podium_check() from public, anon, authenticated;

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

-- ---------- 9. seed today's standing ----------
-- Without this the podium stays blank until the next like lands. Note
-- this announces the current top three to their authors on the first run,
-- which is the intended introduction to the feature.
select podium_check();
