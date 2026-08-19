-- ============================================================
-- Crema — step 1.30: the first pour of the day pays, and your friends
--                    hear about the one you just made
--
-- Two things, and they are the same thing seen from either end of a
-- morning: a reason to log the cup you are holding, and somebody
-- noticing that you did.
--
-- 1. THE FIRST POUR OF THE DAY IS WORTH MORE.
--    Every point Crema pays is paid per row: ten a pour, fifteen a bean
--    you have never logged, three a comment somebody left you. Nothing
--    has ever paid for *turning up*, and turning up every morning is the
--    entire habit the app is about — the streak counts it and pays
--    nothing for it.
--
--    So: +20 the first time you log a coffee on a given day, in YOUR
--    day, not UTC's. That is deliberately more than the pour itself is
--    worth. A second cup at eleven is worth logging; the first one is
--    worth getting out of bed for.
--
--    Written as a row in `daily_firsts` rather than as a term computed
--    over `posts`, for the reason `podium_wins` and
--    `challenge_completions` are rows: a computed term would be
--    retroactive, and everybody in Crema would find their score and
--    possibly their level moved overnight for something they were never
--    told about. An award is a thing that happened at a moment. The
--    table starts empty and nobody's score changes until they next pour.
--
--    The primary key (user_id, day) is what makes it once-a-day: the
--    trigger fires on every insert and the second one of the morning
--    conflicts and does nothing.
--
-- 2. A FRIEND POURED A COFFEE.
--    Follows have been mutual since step-1.19 — accepting somebody is
--    agreeing to see each other's mornings — and until now the *only*
--    way to find out they had poured was to open the app and scroll.
--    Everything else in the inbox is a reaction to something you did.
--    This is the first row that is somebody else simply having coffee,
--    which is what the app is for.
--
--    It rides the existing push trigger on `notifications` (step-1.16)
--    like every other type, and it is collapsed per (type, actor) there,
--    so three cups from one friend before ten is one line on the phone.
--
--    `notify_friends` is a fifth switch beside the four in step-1.16 and
--    step-1.20 rather than a reuse of `notify_social`, because it is a
--    genuinely different volume of thing: `notify_social` is people
--    responding to you and is bounded by how much you post, this is
--    bounded by how many people you follow. Somebody has to be able to
--    keep one and drop the other. It gates PUSH only — the inbox row is
--    written either way, exactly as `notify_social` has always worked.
--
-- ⚠️ No backups (Supabase Free), one environment, and it is production.
-- This is additive — one new table, one new column, one new trigger on
-- `posts`, and one existing function (`user_points`) gains a term that
-- reads a table which is empty when the migration ends. It is
-- re-runnable. Verified beforehand against the full local chain:
--   ./platform/supabase/local-test/run.sh step-1.30-test.sql
--
-- Run after step-1.29.sql. Idempotent.
-- ============================================================

-- ============================================================
-- 1. WHAT THE FIRST POUR OF THE DAY IS WORTH
-- ============================================================
-- A function rather than a literal for the same reason crema_rest_after()
-- is one: the number appears in the award, in the test, and in
-- POINT_RULES in src/domain/scoring.js, and the app is lying about how it
-- scores people the moment those disagree. Change it here and in
-- src/domain/scoring.js together.
create or replace function crema_first_pour_points() returns int
  language sql immutable as $$ select 20 $$;

create table if not exists daily_firsts (
  user_id    uuid not null references profiles on delete cascade,
  -- The user's own local day, resolved through local_ts()/user_tz()
  -- (step-1.17) — the same pair the streak and the morning nudge use, so
  -- "a day" means one thing across the whole app.
  day        date not null,
  points     int  not null,
  -- Which pour earned it, when it still exists. `on delete set null`
  -- rather than cascade: deleting the pour must not delete the award,
  -- or the score would move under somebody for tidying up their gallery
  -- — and a day whose award had vanished could be earned a second time.
  post_id    uuid references posts on delete set null,
  created_at timestamptz default now(),
  primary key (user_id, day)
);

alter table daily_firsts enable row level security;

-- Public for the same reason challenge_completions is: a profile may one
-- day want to show these, and there is nothing in the row that isn't
-- already visible in the fact that somebody posted that morning. Nobody
-- can write one — there is no insert, update or delete policy at all,
-- and the only thing that creates a row is the SECURITY DEFINER trigger
-- below.
drop policy if exists "daily firsts are public" on daily_firsts;
create policy "daily firsts are public" on daily_firsts for select using (true);

grant select on daily_firsts to anon, authenticated;
revoke insert, update, delete on daily_firsts from anon, authenticated;

-- ---------- the award ----------
create or replace function award_daily_first() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date;
begin
  d := local_ts(new.created_at, user_tz(new.user_id))::date;
  insert into daily_firsts (user_id, day, points, post_id)
  values (new.user_id, d, crema_first_pour_points(), new.id)
  on conflict (user_id, day) do nothing;   -- the second cup of the morning
  return null;
end $$;

drop trigger if exists posts_daily_first on posts;
create trigger posts_daily_first after insert on posts
  for each row execute function award_daily_first();

-- Paying has to move the score immediately, not at the next unrelated
-- recalculation. Note this is NOT left to `posts_score` firing on the
-- same INSERT: AFTER triggers run in name order, and relying on
-- 'posts_daily_first' sorting before 'posts_score' is a fact about the
-- alphabet, not about the schema. Same shape as `completions_score`
-- (step-1.17) and for the same reason.
drop trigger if exists daily_firsts_score on daily_firsts;
create trigger daily_firsts_score after insert or delete on daily_firsts
  for each row execute function trg_score_owner();

-- ---------- the term ----------
-- Rewritten from step-1.18 with one term added. Everything else is
-- unchanged, so scores do not move for anyone until they next pour —
-- `daily_firsts` is empty when this migration finishes.
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

      -- mornings you showed up, each worth what it was worth on the day
    + coalesce((select sum(points) from daily_firsts
                 where user_id = uid), 0);
$$;

-- ============================================================
-- 2. A FRIEND POURED A COFFEE
-- ============================================================
alter table profiles add column if not exists notify_friends bool not null default true;

-- Who hears about a pour: the people whose follow of the author was
-- accepted. `visibility` is deliberately not checked — 'public' and
-- 'followers' are both readable by exactly this set, which is what makes
-- the notification safe to send for either. If a third visibility is
-- ever added, this is one of the places that has to learn about it.
--
-- Blocks are honoured in both directions. Someone I blocked should not
-- reach my inbox, and I should not be pushed into theirs.
create or replace function notify_on_post() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, actor_id, type, post_id, body)
  select f.follower_id, new.user_id, 'friend_pour', new.id, 'poured a coffee'
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
  raise notice 'notify_on_post failed: %', sqlerrm;
  return null;
end $$;

drop trigger if exists posts_friend_notify on posts;
create trigger posts_friend_notify after insert on posts
  for each row execute function notify_on_post();

-- ---------- which switch each type answers to ----------
-- Rewritten from step-1.16 with one branch. Everything else — the
-- payload, the deep link, the per-(type, actor) collapsing, the
-- swallowed exception — is unchanged.
create or replace function push_on_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text; rows jsonb; wanted bool;
begin
  -- Respect the switch before doing any work. A friend's morning is a
  -- different volume of thing from somebody answering you, so it has its
  -- own switch; everything else stays on notify_social as it was.
  select case when new.type = 'friend_pour' then p.notify_friends else p.notify_social end
    into wanted
    from profiles p where p.id = new.user_id;
  if not coalesce(wanted, false) then return new; end if;

  select coalesce(nullif(name,''), '@' || handle) into actor
    from profiles where id = new.actor_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
           'title', 'Crema',
           'body',  coalesce(actor || ' ', '') || coalesce(new.body, new.type),
           -- Deep link straight to the pour; app.js already understands
           -- #p/<id> and opens the post overlay on it.
           'url',   case when new.post_id is not null then './#p/' || new.post_id else './' end,
           -- Collapse per (type, actor): ten likes from one person while
           -- the phone is in a pocket is one line, not ten — and so is a
           -- friend who has three cups before ten.
           'tag',   new.type || ':' || coalesce(new.actor_id::text,'-')
         )), '[]'::jsonb)
    into rows
    from push_subscriptions s
   where s.user_id = new.user_id;

  perform push_send(jsonb_build_object('rows', rows));
  return new;
exception when others then
  -- A push that fails must never roll back the notification row itself.
  raise notice 'push_on_notification failed: %', sqlerrm;
  return new;
end $$;

-- ============================================================
-- 3. LOCK THE SURFACE
-- ============================================================
-- Neither may be called by a browser. Both are SECURITY DEFINER and run
-- as triggers regardless of what the caller's own grants are, so the
-- only thing revoking them removes is the ability to ask for one
-- directly — award_daily_first() is a trigger function and cannot be
-- usefully called anyway, but crema_first_pour_points() being readable
-- and the award not being callable is the line that matters.
revoke all on function award_daily_first() from public, anon, authenticated;
revoke all on function notify_on_post()    from public, anon, authenticated;

-- crema_first_pour_points() keeps its default EXECUTE: it is a constant,
-- the app shows the same number on the levels sheet, and nothing about
-- knowing it lets anyone earn it.
