-- ============================================================
-- A notification reaches the phone as well as the browser
--
-- Proved first, and provable again, with:
--   ./platform/supabase/local-test/run.sh push-devices-test.sql
--
-- WHAT THIS IS FOR
--
-- The Play alpha replaced a Trusted Web Activity — which was a Chrome
-- WebView and therefore had Web Push — with a Capacitor shell, which has
-- no service worker and no PushManager. `native_push_tokens`
-- (20260831090000) gave the shell's FCM/APNs token somewhere to live and
-- said, in its own header, that nothing would send to it until step 4.2.
-- This is that half. A tester who updated the app and found their
-- notifications gone is the reason it is not waiting any longer.
--
-- WHAT CHANGES, AND WHY IT IS THIS SHAPE
--
-- Four senders read `push_subscriptions` and hand each row to send-push.
-- Every one of them also computes something per DEVICE — the language to
-- write in, the timezone to decide "evening" in — and duplicating those
-- laterals against a second table would be four more copies of the
-- trickiest queries in the schema. So the table each sender reads becomes
-- a view over both, and the only other thing that changes in each is
-- which three keys name the address:
--
--   web    → endpoint / p256dh / auth   (RFC 8291, encrypted to the browser)
--   native → token                      (FCM v1, addressed to the device)
--
-- send-push routes on exactly that: a row with `token` goes to ./fcm.ts,
-- a row without goes to ./webpush.ts, and a native row with no FCM
-- credential configured is skipped rather than failed. So this migration
-- is INERT until FCM_SERVICE_ACCOUNT is set — it changes what Postgres
-- offers the Edge Function, not what the Edge Function can deliver.
--
-- ⚠️ THE THING THIS MIGRATION IS MOST AT RISK OF BEING
--
-- D-2026-08-30-02: step-1.32 rewrote push_on_notification() from an older
-- copy and silently dropped the notify_friends branch, and nobody noticed
-- for three days. This file rewrites the same four functions. Every body
-- below is the CURRENT definition — push_on_notification() from
-- 20260830103000, the other three from step-1.32 and step-1.20 — with two
-- edits and no others:
--
--   1. `from push_subscriptions s`  becomes  `from push_devices s`
--   2. the three address keys become `push_addr(s)`
--
-- The switch each one checks, the wording, the deep link, the collapsing
-- tag, the hour arithmetic and the swallowed exception are all untouched,
-- and push-devices-test.sql asserts each of those separately so that a
-- future rewrite of this file cannot quietly lose one either.
--
-- Re-runnable.
-- ============================================================

-- ============================================================
-- 1. ONE LIST OF DEVICES
-- ============================================================
-- The two tables stay separate — that argument is made in full in
-- 20260831090000's header and none of it has changed. This is a read
-- over both, for the four callers that want "everywhere this person can
-- be reached", and it is the only thing that knows both shapes.
--
-- The columns a sender actually uses are user_id, tz_offset and lang,
-- and both tables have all three with the same meaning, per device. The
-- address columns are nullable by construction: exactly one side of the
-- union fills each.
create or replace view push_devices as
  select 'web'::text   as kind,
         s.user_id, s.tz_offset, s.lang,
         s.endpoint, s.p256dh, s.auth,
         null::text    as token,
         null::text    as platform
    from push_subscriptions s
  union all
  select 'native'::text as kind,
         k.user_id, k.tz_offset, k.lang,
         null::text     as endpoint, null::text as p256dh, null::text as auth,
         k.token,
         k.platform
    from native_push_tokens k;

-- ⚠️ NOT A CLIENT API, and this revoke is the whole of what stops it
-- being one. PostgREST publishes every relation in `public`, and a view
-- created here runs with its OWNER's rights (security_invoker is off by
-- default), which means RLS on the two tables underneath does NOT apply
-- to a select through it. Without this line any signed-in account could
-- read every push endpoint in Crema — a routing address for a specific
-- person's phone. Same reasoning, same treatment, as push_i18n in
-- step-1.32 §5.
revoke all on push_devices from public, anon, authenticated;

-- The address half of a payload, per device kind. A function rather than
-- a repeated CASE so that the four senders below cannot drift from each
-- other, and so that a third kind of device is one edit here.
create or replace function push_addr(d push_devices)
returns jsonb language sql immutable set search_path = public as $$
  select case when d.kind = 'native'
    then jsonb_build_object('token', d.token, 'platform', d.platform)
    else jsonb_build_object('endpoint', d.endpoint, 'p256dh', d.p256dh, 'auth', d.auth)
  end;
$$;
revoke all on function push_addr(push_devices) from public, anon, authenticated;

-- ============================================================
-- 2. THE FOUR SENDERS
-- ============================================================

-- ---------- likes, comments, follows, reactions, a friend's pour ----------
-- Body identical to migrations/20260830103000_friend_pour_every_pour.sql
-- except for the two edits named in the header. The `wanted` branch is
-- the one D-2026-08-30-02 was about; it is here, and T5 asserts it.
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

  select coalesce(jsonb_agg(push_addr(s) || jsonb_build_object(
           -- The app is called Crema in both languages.
           'title', 'Crema',
           'body',  coalesce(actor || ' ', '')
                    || crema_push_body(coalesce(new.body, new.type), s.lang),
           'url',   case when new.post_id is not null then './#p/' || new.post_id else './' end,
           -- Collapse per (type, actor): a friend who has three cups
           -- before ten is one line on the lock screen, not three.
           'tag',   new.type || ':' || coalesce(new.actor_id::text,'-')
         )), '[]'::jsonb)
    into rows
    from push_devices s
   where s.user_id = new.user_id;

  perform push_send(jsonb_build_object('rows', rows));
  return new;
exception when others then
  raise notice 'push_on_notification failed: %', sqlerrm;
  return new;
end $$;

drop trigger if exists notifications_push on notifications;
create trigger notifications_push after insert on notifications
  for each row execute function push_on_notification();

-- ---------- the evening streak reminder ----------
create or replace function push_streak_reminders()
returns void language plpgsql security definer set search_path = public as $$
declare rows jsonb; n int;
begin
  select coalesce(jsonb_agg(x), '[]'::jsonb) into rows from (
    select push_addr(s) || jsonb_build_object(
             'title', crema_i18n('Your streak ends tonight', s.lang),
             'body',  replace(crema_i18n('{n} days so far — one pour keeps it going.', s.lang),
                              '{n}', d.n::text),
             'url',   './',
             'tag',   'streak'
           ) as x
      from push_devices s
      join profiles p on p.id = s.user_id and p.notify_streak
      cross join lateral (select streak_at_risk(s.user_id, s.tz_offset) as n) d
     where d.n > 0
       and extract(hour from (now() + make_interval(mins => s.tz_offset))) = 19
  ) q;

  n := jsonb_array_length(rows);
  if n > 0 then perform push_send(jsonb_build_object('rows', rows)); end if;
  raise notice 'streak reminders: % device(s)', n;
end $$;

-- ---------- Sunday's week in coffee ----------
create or replace function push_weekly_digest()
returns void language plpgsql security definer set search_path = public as $$
declare rows jsonb; n int;
begin
  select coalesce(jsonb_agg(x), '[]'::jsonb) into rows from (
    select push_addr(s) || jsonb_build_object(
             'title', crema_i18n('Your week in coffee', s.lang),
             'body',  crema_digest_body(w.pours, w.likes, w.followers, s.lang),
             'url',   './',
             'tag',   'digest'
           ) as x
      from push_devices s
      join profiles p on p.id = s.user_id and p.notify_digest
      cross join lateral (
        select
          (select count(*) from posts po
            where po.user_id = s.user_id and po.created_at > now() - interval '7 days') as pours,
          (select count(*) from likes l join posts po on po.id = l.post_id
            where po.user_id = s.user_id and l.created_at > now() - interval '7 days') as likes,
          (select count(*) from follows f
            where f.followee_id = s.user_id and f.status = 'accepted'
              and f.created_at > now() - interval '7 days') as followers
      ) w
     where (w.pours > 0 or w.likes > 0 or w.followers > 0)
       and extract(dow  from (now() + make_interval(mins => s.tz_offset))) = 1
       and extract(hour from (now() + make_interval(mins => s.tz_offset))) = 8
  ) q;

  n := jsonb_array_length(rows);
  if n > 0 then perform push_send(jsonb_build_object('rows', rows)); end if;
  raise notice 'weekly digest: % device(s)', n;
end $$;

-- ---------- the 8am nudge ----------
-- ⚠️ Still English, and deliberately left that way here. step-1.32
-- translated three senders and not this one, so a German phone gets a
-- German like and an English good-morning — on the web too, since
-- 2026-08-27. That is a real bug and it is not this migration's; fixing
-- it means new push_i18n keys, which are GENERATED from src/i18n.de.js
-- (gen-push-i18n.mjs) and would be a second, unrelated change riding
-- along inside a file whose whole argument is that it changes two things
-- per function. Filed rather than smuggled.
create or replace function push_morning_nudge()
returns void language plpgsql security definer set search_path = public as $$
declare rows jsonb; n int;
begin
  select coalesce(jsonb_agg(x), '[]'::jsonb) into rows from (
    select push_addr(s) || jsonb_build_object(
             'title', case when r.n > 0 then 'Keep the streak going' else 'Good morning ☕' end,
             'body',  case when r.n > 0
                           then r.n || ' days so far — log today''s and make it ' || (r.n + 1) || '.'
                           else 'Log today''s coffee before it''s just a memory.' end,
             'url',   './',
             'tag',   'morning'
           ) as x
      from push_devices s
      join profiles p on p.id = s.user_id and p.notify_morning
      -- Whether this device's user has already poured today, in their
      -- own timezone. Computed here rather than reused from
      -- streak_at_risk() because that function answers 0 for two
      -- different reasons — "poured today" and "no streak at all" — and
      -- this nudge has to tell them apart to skip the first and still
      -- reach the second.
      cross join lateral (
        select exists (
                 select 1 from posts po
                  where po.user_id = s.user_id
                    and (po.created_at + make_interval(mins => s.tz_offset))::date
                        = (now() + make_interval(mins => s.tz_offset))::date
               ) as poured_today
      ) t
      cross join lateral (select streak_at_risk(s.user_id, s.tz_offset) as n) r
     where not t.poured_today
       and extract(hour from (now() + make_interval(mins => s.tz_offset))) = 8
  ) q;

  n := jsonb_array_length(rows);
  if n > 0 then perform push_send(jsonb_build_object('rows', rows)); end if;
  raise notice 'morning nudges: % device(s)', n;
end $$;

-- ============================================================
-- 3. LOCK THE SURFACE
-- ============================================================
-- Postgres grants EXECUTE to PUBLIC by default and PostgREST publishes
-- every function in `public` as an RPC. `create or replace` on an
-- existing function keeps its grants, so these are restatements rather
-- than changes — but a re-run against a database where one was somehow
-- dropped and recreated would otherwise open it.
revoke all on function push_on_notification()  from public, anon, authenticated;
revoke all on function push_streak_reminders() from public, anon, authenticated;
revoke all on function push_weekly_digest()    from public, anon, authenticated;
revoke all on function push_morning_nudge()    from public, anon, authenticated;
