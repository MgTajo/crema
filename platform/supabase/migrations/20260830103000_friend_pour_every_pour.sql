-- ============================================================
-- A friend's EVERY pour, not just their first of the day
--
-- The first migration applied by the CLI rather than by hand
-- (platform/supabase/MIGRATIONS.md). Proved first with:
--   ./platform/supabase/local-test/run.sh friend-pour-test.sql
--
-- What changes, and what does not.
--
--   step-1.30 notified a follower on EVERY pour. step-1.31 called that
--   correction 2 and moved it onto `daily_firsts`, so it fired once a
--   morning. This puts it back on `posts`: the ask is that following
--   somebody means hearing about the coffee they make, all of it, and
--   the volume that follows is what the switch beside it is for.
--
--   `daily_firsts` keeps its row and its trigger. It is still the
--   record of which pour was somebody's first on their own clock, and
--   step-1.31's whole point — that this is a DIFFERENT question from
--   who was first in all of Crema — is untouched. It just stops being
--   the thing that decides who hears about a coffee.
--
--   `daily_champions`, crema_day(), the +20 and user_points() are not
--   touched at all. The race is not what this is about.
--
-- The body is 'poured a coffee', which is not a new string: it is the
-- one step-1.30 wrote, it is still in src/i18n.de.js, and step-1.32
-- already seeded its German into push_i18n. Nothing to generate, and
-- `gen-push-i18n.mjs --check` keeps passing as it stands.
--
-- Re-runnable.
-- ============================================================

-- ============================================================
-- 1. THE INBOX ROW, BACK ON EVERY POUR
-- ============================================================
-- Restored verbatim from step-1.30, including the reasoning:
--
-- Who hears about a pour: the people whose follow of the author was
-- accepted. `visibility` is deliberately not checked — 'public' and
-- 'followers' are both readable by exactly this set, which is what
-- makes the notification safe to send for either. If a third
-- visibility is ever added, this is one of the places that has to
-- learn about it.
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

-- ---------- and off daily_firsts ----------
-- Both go: leaving the trigger would send two rows for the pour that is
-- both a pour and a first, and leaving the function behind the dropped
-- trigger would leave a second, silent definition of who hears what.
drop trigger if exists daily_firsts_notify on daily_firsts;
drop function if exists notify_on_daily_first();

-- ============================================================
-- 2. THE SWITCH THAT WENT MISSING
-- ============================================================
-- step-1.30 taught push_on_notification() one branch: a friend's
-- morning answers to `notify_friends`, everything else to
-- `notify_social`. step-1.32 then rewrote the same function from
-- step-1.16's copy to render per device — and step-1.16 predates the
-- branch, so the rewrite dropped it. Confirmed against the production
-- dump (migrations/20260829065141_baseline.sql): live, `friend_pour`
-- push has been gated by notify_social since 2026-08-27, and turning
-- "When friends pour" off has done nothing to the phone.
--
-- That was a quiet bug when this fired once a morning. At every pour it
-- is the difference between a switch and a decoration, so it is fixed
-- here rather than filed. Everything else — the payload, the per-device
-- language, the deep link, the collapsing tag, the swallowed exception
-- — is step-1.32's, unchanged.
create or replace function push_on_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text; rows jsonb; wanted bool;
begin
  -- Respect the switch before doing any work.
  select case when new.type = 'friend_pour' then p.notify_friends else p.notify_social end
    into wanted
    from profiles p where p.id = new.user_id;
  if not coalesce(wanted, false) then return new; end if;

  select coalesce(nullif(name,''), '@' || handle) into actor
    from profiles where id = new.actor_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
           -- The app is called Crema in both languages.
           'title', 'Crema',
           'body',  coalesce(actor || ' ', '')
                    || crema_push_body(coalesce(new.body, new.type), s.lang),
           'url',   case when new.post_id is not null then './#p/' || new.post_id else './' end,
           -- Collapse per (type, actor): a friend who has three cups
           -- before ten is one line on the lock screen, not three. This
           -- line is doing considerably more work than it used to.
           'tag',   new.type || ':' || coalesce(new.actor_id::text,'-')
         )), '[]'::jsonb)
    into rows
    from push_subscriptions s
   where s.user_id = new.user_id;

  perform push_send(jsonb_build_object('rows', rows));
  return new;
exception when others then
  raise notice 'push_on_notification failed: %', sqlerrm;
  return new;
end $$;

-- ============================================================
-- 3. LOCK THE SURFACE
-- ============================================================
-- A client must not be able to fan out notifications by calling the
-- function directly. Same revoke step-1.30 gave it.
revoke all on function notify_on_post() from public, anon, authenticated;
