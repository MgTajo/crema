-- ============================================================
-- Crema — points, levels, and a leaderboard of pours
--
-- Run after step-1.8.sql. Re-runnable.
--
-- What this replaces:
--
--   * `profiles.level` never moved. Every account was Level 1 forever
--     while the UI put a "Lv1" chip on every card and promised a
--     progression. Now level is a function of points, and points are a
--     function of what you actually did.
--
--   * The weekly board ranked *users* by a score that included
--     `quality * 20` — and the client wrote a hardcoded quality of 0.85
--     on every art pour, so that term was a constant 17 points for
--     everyone. It is gone. Nothing in Crema scores a pour's art until
--     something can actually judge it.
--
--   * leaderboard_weekly ranked people. The board now ranks pours by
--     likes, which is a number real humans produced.
--
-- Counters, not views, for points/level: every post, comment and
-- notification embeds its author, and those embeds have to carry the
-- level with them. Triggers recompute from scratch (never +=), so the
-- numbers cannot drift out of step with the rows they come from.
-- ============================================================

-- ---------- points column ----------
alter table profiles add column if not exists points int not null default 0;

-- ---------- the level curve ----------
-- Each level costs roughly 1.5x the step before it, so Level 2 is ten
-- pours away and Level 10 is a genuine milestone. Mirrored in
-- src/data/catalog.js (LEVELS) for the progress bar — keep them in step.
create or replace function level_for_points(pts int)
returns int language sql immutable as $$
  select case
    when pts >= 9500 then 10
    when pts >= 6000 then 9
    when pts >= 3800 then 8
    when pts >= 2400 then 7
    when pts >= 1500 then 6
    when pts >= 900  then 5
    when pts >= 500  then 4
    when pts >= 250  then 3
    when pts >= 100  then 2
    else 1
  end;
$$;

-- ---------- the score itself ----------
-- Recomputed from the rows, so a deleted post takes its points with it.
create or replace function user_points(uid uuid)
returns int language sql stable as $$
  select coalesce((select count(*) from posts where user_id = uid), 0) * 10
       + coalesce((select count(*) from likes l join posts p on p.id = l.post_id
                    where p.user_id = uid), 0) * 2
       + coalesce((select count(*) from challenge_entries where user_id = uid), 0) * 25
       + coalesce((select count(*) from entry_votes v join challenge_entries e on e.id = v.entry_id
                    where e.user_id = uid), 0);
$$;

create or replace function recalc_score(uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pts int;
begin
  if uid is null then return; end if;
  pts := user_points(uid);
  update profiles
     set points = pts,
         level  = level_for_points(pts)
   where id = uid
     and (points is distinct from pts or level is distinct from level_for_points(pts));
end $$;

-- ---------- triggers ----------
-- One function per "whose score moved" shape. Each resolves the owner of
-- the score, then recomputes it.
--
-- Note the TG_OP branches: in PL/pgSQL, NEW is unassigned on DELETE and
-- OLD is unassigned on INSERT, so `coalesce(new.x, old.x)` is not a
-- shortcut — it raises "record is not assigned yet".

create or replace function trg_score_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'DELETE' then perform recalc_score(old.user_id);
  else                     perform recalc_score(new.user_id);
  end if;
  return null;
end $$;

create or replace function trg_score_post_author()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid; target uuid;
begin
  if TG_OP = 'DELETE' then pid := old.post_id; else pid := new.post_id; end if;
  select p.user_id into target from posts p where p.id = pid;
  perform recalc_score(target);
  return null;
end $$;

create or replace function trg_score_entry_author()
returns trigger language plpgsql security definer set search_path = public as $$
declare eid uuid; target uuid;
begin
  if TG_OP = 'DELETE' then eid := old.entry_id; else eid := new.entry_id; end if;
  select e.user_id into target from challenge_entries e where e.id = eid;
  perform recalc_score(target);
  return null;
end $$;

drop trigger if exists posts_score          on posts;
drop trigger if exists likes_score          on likes;
drop trigger if exists entries_score        on challenge_entries;
drop trigger if exists entry_votes_score    on entry_votes;

create trigger posts_score       after insert or delete on posts
  for each row execute function trg_score_owner();
create trigger likes_score       after insert or delete on likes
  for each row execute function trg_score_post_author();
create trigger entries_score     after insert or delete on challenge_entries
  for each row execute function trg_score_owner();
create trigger entry_votes_score after insert or delete on entry_votes
  for each row execute function trg_score_entry_author();

-- ---------- backfill ----------
update profiles p
   set points = user_points(p.id),
       level  = level_for_points(user_points(p.id));

-- ============================================================
-- THE BOARD — pours ranked by likes
--
-- Flat on purpose: the author's columns are selected inline rather than
-- embedded, so the client needs no PostgREST relationship hint and one
-- round trip renders a row. security_invoker keeps the caller's RLS.
-- ============================================================
create or replace view top_posts
  with (security_invoker = true) as
  select p.id, p.user_id, p.drink, p.art, p.pattern, p.quality, p.image_key,
         p.caption, p.cafe_id, p.recipe, p.created_at,
         pr.handle, pr.name, pr.city, pr.avatar_color, pr.level,
         (select count(*) from likes    l where l.post_id = p.id) as like_count,
         (select count(*) from comments c where c.post_id = p.id) as comment_count
    from posts p
    join profiles pr on pr.id = p.user_id;

-- The old board ranked people on a schedule. Ranking pours by likes is
-- live, so the nightly job, its table and its function all go. Unschedule
-- first, or the job keeps firing at a function that no longer exists.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'crema-leaderboard')
  then perform cron.unschedule('crema-leaderboard');
  end if;
exception when others then
  raise notice 'pg_cron not reachable here — unschedule crema-leaderboard by hand if it exists';
end $$;

drop table if exists leaderboard_weekly;
drop function if exists refresh_leaderboard_weekly(date);
