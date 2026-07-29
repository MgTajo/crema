-- ============================================================
-- Crema — step 1.16: reaching people who aren't looking at the app
--
-- Run after step-1.15.sql. Re-runnable.
--
-- Everything Crema knows how to say today, it says on a screen the user
-- is already looking at. That is the wrong way round for a habit
-- product: the moment that decides whether someone keeps a streak is the
-- moment they are NOT in the app. So:
--
--   1. push_subscriptions — one row per device that agreed to be
--      reached, written by the browser, read only by the sender.
--   2. notification prefs on profiles — three switches, not one, and
--      each defaults OFF for people who never answer the prompt.
--   3. a trigger that turns every new `notifications` row into a push,
--      so likes/comments/follows carry over the channel they already
--      generate rows for.
--   4. a nightly job that finds streaks about to lapse and nudges them,
--      in the user's own evening.
--   5. a weekly digest on Monday morning.
--
-- (3)–(5) reach the `send-push` Edge Function through pg_net. Deploy that
-- function and set its secrets BEFORE scheduling the jobs, or they will
-- fire into a 404 — harmless, but nothing gets delivered and nothing
-- says so.
--
-- IMPORTANT — two settings this file cannot read from the environment.
-- Run these AFTER this file (they use a helper it defines), as the
-- postgres role. Until they are set, every job here no-ops with a
-- notice rather than failing:
--
--   select push_set_config('push_endpoint',
--     'https://diabtvahplwoipvrprvb.supabase.co/functions/v1/send-push');
--   select push_set_config('push_secret', '<PUSH_HOOK_SECRET>');
--
-- They go into Supabase Vault, not into `alter database … set`: the
-- hosted `postgres` role is not a superuser and that statement fails
-- with 42501 "permission denied to set parameter".
--
-- push_secret must equal the PUSH_HOOK_SECRET secret set on the Edge
-- Function. It is what stops anyone on the internet POSTing to the
-- function and sending notifications as Crema — the function is
-- deployed with --no-verify-jwt precisely so Postgres can call it, so
-- this shared secret is the only thing guarding it.
-- ============================================================

create extension if not exists pg_net;

-- ---------- 1. devices that agreed to be reached ----------
-- The endpoint is the identity of a subscription, so it is the primary
-- key: a device that re-subscribes with the same endpoint updates its
-- row instead of accumulating duplicates that would each get a copy of
-- every notification.
create table if not exists push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references profiles on delete cascade,
  p256dh     text not null,
  auth       text not null,
  -- Minutes east of UTC, captured by the browser. The streak job reads
  -- it so "this evening" means the user's evening; without it a job at
  -- 18:00 UTC reaches Auckland at 6am, which is not a nudge, it's an
  -- alarm clock.
  tz_offset  int  not null default 0,
  -- Consecutive delivery failures. A push service answers 404/410 for a
  -- subscription that is gone for good; the sender counts those and the
  -- row is dropped rather than retried forever.
  fail_count int  not null default 0,
  last_seen  timestamptz default now(),
  created_at timestamptz default now()
);
create index if not exists push_subs_user_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

-- Owner-only, all four verbs. Nobody may read anyone else's endpoint:
-- an endpoint plus its two keys IS the capability to send that person
-- notifications, so this table is closer to a credential store than to
-- profile data. The sender reaches it with the service role, which
-- bypasses RLS.
drop policy if exists "own push subscriptions"        on push_subscriptions;
drop policy if exists "insert own push subscription"  on push_subscriptions;
drop policy if exists "update own push subscription"  on push_subscriptions;
drop policy if exists "delete own push subscription"  on push_subscriptions;
create policy "own push subscriptions"
  on push_subscriptions for select using (user_id = auth.uid());
create policy "insert own push subscription"
  on push_subscriptions for insert with check (user_id = auth.uid());
create policy "update own push subscription"
  on push_subscriptions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own push subscription"
  on push_subscriptions for delete using (user_id = auth.uid());

-- ---------- 2. what they agreed to be reached ABOUT ----------
-- Three switches rather than one, because these are three different
-- bargains. "Someone liked your pour" is a fact about another person and
-- is expected. "Your streak ends tonight" is Crema nagging on its own
-- initiative and is the one people turn off first — if it were bundled
-- with social notifications, turning it off would cost them the ones
-- they wanted, so they'd turn everything off instead.
--
-- Social defaults ON because it only ever fires in response to something
-- a human did to them. The two Crema-initiated ones default OFF: an
-- unprompted notification nobody asked for is how an app gets muted.
alter table profiles add column if not exists notify_social bool not null default true;
alter table profiles add column if not exists notify_streak bool not null default false;
alter table profiles add column if not exists notify_digest bool not null default false;

-- ---------- where the endpoint and the hook secret live ----------
-- Supabase's hosted `postgres` role is not a superuser, so
-- `alter database postgres set app.push_endpoint = …` is refused with
-- 42501. Secrets for database-side use belong in Supabase Vault, which
-- encrypts them at rest and is readable by the roles that need them.
--
-- current_setting() is still consulted as a fallback so this works
-- unchanged on a self-hosted or local Postgres where the GUCs *can* be
-- set. Vault wins when both are present.
create or replace function push_config(k text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  begin
    select decrypted_secret into v
      from vault.decrypted_secrets where name = k limit 1;
    if v is not null and v <> '' then return v; end if;
  exception when others then
    -- No vault extension, or no permission: fall through to the GUC.
    null;
  end;
  return nullif(current_setting('app.' || k, true), '');
end $$;

-- Store one of them. Re-runnable: the same name is updated rather than
-- rejected as a duplicate.
create or replace function push_set_config(k text, v text)
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  select id into sid from vault.secrets where name = k;
  if sid is null then perform vault.create_secret(v, k, 'Crema push configuration');
  else                perform vault.update_secret(sid, v);
  end if;
end $$;

-- ---------- the sender ----------
-- One place that knows how to hand a job to the Edge Function. Payload
-- shape: { rows: [{ endpoint, p256dh, auth, title, body, url, tag }] }.
create or replace function push_send(payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare url text; secret text;
begin
  url    := push_config('push_endpoint');
  secret := push_config('push_secret');
  if url is null or url = '' then
    raise notice 'push_endpoint unset — skipping push (see supabase/README.md §5)';
    return;
  end if;
  if jsonb_array_length(coalesce(payload->'rows','[]'::jsonb)) = 0 then return; end if;
  perform net.http_post(
    url     := url,
    headers := jsonb_build_object('Content-Type','application/json','X-Push-Secret',coalesce(secret,'')),
    body    := payload
  );
end $$;

-- ---------- 3. the inbox rows people already generate ----------
-- Triggers on likes/comments/follows write `notifications` rows today
-- (step-1.8). Rather than teach each of them about push, one trigger on
-- the notifications table itself carries every one of them over — and
-- anything added later inherits it for free.
create or replace function push_on_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text; rows jsonb;
begin
  -- Respect the switch before doing any work.
  if not exists (select 1 from profiles where id = new.user_id and notify_social) then
    return new;
  end if;

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
           -- the phone is in a pocket is one line, not ten.
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

drop trigger if exists notifications_push on notifications;
create trigger notifications_push after insert on notifications
  for each row execute function push_on_notification();

-- ---------- 4. the streak nudge ----------
-- The rule has to match domain/streak.js exactly or the notification
-- lies. Both say: a streak is consecutive days with at least one pour,
-- counted in the user's own timezone, and a run of 7+ days survives one
-- missed day (once).
--
-- This function answers a narrower question than the client does — "is
-- there a live streak with nothing logged today" — which needs only the
-- last few days, not the whole history.
-- Must match REST_AFTER in src/domain/streak.js.
create or replace function crema_rest_after() returns int
  language sql immutable as $$ select 7 $$;

-- A faithful port of runFrom() in src/domain/streak.js: walk back from
-- `start` over the day-index array, forgiving at most one gap when a
-- week's habit sits on either side of it. Returns the run length and
-- whether the allowance was spent.
--
-- Note the direction: index 0 is today, so d + 1 is OLDER. The week that
-- earns a rest is usually the run on the far side of the gap, not the
-- days walked so far — which is exactly the case the first version of
-- this function got wrong.
create or replace function streak_run(days int[], start int, out n int, out rested bool)
language plpgsql immutable as $$
declare d int; fwd int; ra int := crema_rest_after();
begin
  n := 0; rested := false; d := start;
  loop
    if d = any(days) then
      n := n + 1; d := d + 1;
    elsif not rested and (d + 1) = any(days) then
      -- Plain (non-forgiving) run on the older side, matching the
      -- deliberate use of plainRun() in the JS: a recursive check would
      -- let each forgiven gap earn the next one, and pouring every other
      -- day forever would read as an unbroken streak.
      fwd := 0;
      while (d + 1 + fwd) = any(days) loop fwd := fwd + 1; end loop;
      exit when n < ra and fwd < ra;
      rested := true; n := n + 1; d := d + 1;
    else
      exit;
    end if;
  end loop;
end $$;

create or replace function streak_at_risk(uid uuid, tz_min int)
returns int language plpgsql stable set search_path = public as $$
declare
  today date := (now() + make_interval(mins => tz_min))::date;
  days  int[];                      -- day indices: 0 = today, 1 = yesterday
  r     record;
  total int;
begin
  select coalesce(array_agg(distinct (today - (p.created_at + make_interval(mins => tz_min))::date)), '{}')
    into days
    from posts p
   where p.user_id = uid
     and p.created_at > now() - interval '400 days'
     and (p.created_at + make_interval(mins => tz_min))::date <= today;

  -- Poured today already, or never poured: nothing is at risk.
  if 0 = any(days) or array_length(days, 1) is null then return 0; end if;

  if 1 = any(days) then
    -- The ordinary case: a live run ending yesterday, today still open.
    select * into r from streak_run(days, 1);
    total := r.n;
  else
    -- Nothing yesterday either. The streak survives only if it earned a
    -- rest day and is spending it on yesterday — so the run behind it
    -- must reach the threshold AND must not have needed a rest of its
    -- own, since the allowance is one per streak, not one per gap.
    select * into r from streak_run(days, 2);
    if r.n >= crema_rest_after() and not r.rested then total := r.n; else return 0; end if;
  end if;

  -- Only report a streak worth defending. A single day is not yet a
  -- habit, and "your 1-day streak ends tonight" is a notification nobody
  -- keeps enabled.
  if total < 2 then return 0; end if;
  return total;
end $$;

-- Runs hourly and picks the users for whom it is currently early
-- evening — late enough that "you haven't poured today" is true rather
-- than premature, early enough to still act on it.
create or replace function push_streak_reminders()
returns void language plpgsql security definer set search_path = public as $$
declare rows jsonb; n int;
begin
  select coalesce(jsonb_agg(x), '[]'::jsonb) into rows from (
    select jsonb_build_object(
             'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
             'title', 'Your streak ends tonight',
             'body',  d.n || ' days so far — one pour keeps it going.',
             'url',   './',
             -- One tag for all streak nudges: a second one the same
             -- evening replaces the first rather than stacking.
             'tag',   'streak'
           ) as x
      from push_subscriptions s
      join profiles p on p.id = s.user_id and p.notify_streak
      cross join lateral (select streak_at_risk(s.user_id, s.tz_offset) as n) d
     where d.n > 0
       -- Local hour, from this device's own offset.
       and extract(hour from (now() + make_interval(mins => s.tz_offset))) = 19
  ) q;

  n := jsonb_array_length(rows);
  if n > 0 then perform push_send(jsonb_build_object('rows', rows)); end if;
  raise notice 'streak reminders: % device(s)', n;
end $$;

-- ---------- 5. the weekly digest ----------
-- Monday morning, and only for people who actually did something — a
-- digest reporting zero of everything is a reminder that you stopped
-- using the app, which is not the effect anyone is going for.
create or replace function push_weekly_digest()
returns void language plpgsql security definer set search_path = public as $$
declare rows jsonb; n int;
begin
  select coalesce(jsonb_agg(x), '[]'::jsonb) into rows from (
    select jsonb_build_object(
             'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
             'title', 'Your week in coffee',
             'body',  w.pours || ' pour' || case when w.pours = 1 then '' else 's' end
                      || ', ' || w.likes || ' like' || case when w.likes = 1 then '' else 's' end
                      || case when w.followers > 0
                              then ', ' || w.followers || ' new follower'
                                   || case when w.followers = 1 then '' else 's' end
                              else '' end || '.',
             'url',   './',
             'tag',   'digest'
           ) as x
      from push_subscriptions s
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
       -- Parenthesised deliberately: AND binds tighter than OR, so
       -- without these the hour check would apply to the followers
       -- branch alone and the digest would fire around the clock.
     where (w.pours > 0 or w.likes > 0 or w.followers > 0)
       -- Monday 08:00 in the RECIPIENT's timezone. Both parts have to be
       -- checked here rather than in the cron expression: for a user at
       -- UTC+13, local Monday morning is Sunday evening UTC, so the
       -- schedule below deliberately runs on three UTC days and this is
       -- what narrows each of them to the right people.
       and extract(dow  from (now() + make_interval(mins => s.tz_offset))) = 1
       and extract(hour from (now() + make_interval(mins => s.tz_offset))) = 8
  ) q;

  n := jsonb_array_length(rows);
  if n > 0 then perform push_send(jsonb_build_object('rows', rows)); end if;
  raise notice 'weekly digest: % device(s)', n;
end $$;

-- ---------- nothing here is a client API ----------
-- Postgres grants EXECUTE on a new function to PUBLIC by default, and
-- PostgREST publishes every function in the `public` schema as an RPC
-- endpoint. Without these revokes, `POST /rest/v1/rpc/push_send` would
-- let anyone with the publishable key send arbitrary notifications
-- signed with Crema's VAPID key, and `rpc/push_config` would hand out
-- the hook secret to any signed-in user. Both are SECURITY DEFINER, so
-- RLS would not have saved us.
--
-- Every caller that matters is either a trigger or a cron job, and
-- neither needs a grant: the privilege on a trigger function is checked
-- when the trigger is created, and cron runs as postgres.
revoke all on function push_config(text)            from public, anon, authenticated;
revoke all on function push_set_config(text, text)  from public, anon, authenticated;
revoke all on function push_send(jsonb)             from public, anon, authenticated;
revoke all on function push_on_notification()       from public, anon, authenticated;
revoke all on function push_streak_reminders()      from public, anon, authenticated;
revoke all on function push_weekly_digest()         from public, anon, authenticated;
revoke all on function streak_at_risk(uuid, int)    from public, anon, authenticated;
revoke all on function streak_run(int[], int)       from public, anon, authenticated;
revoke all on function crema_rest_after()           from public, anon, authenticated;

-- ---------- schedules ----------
-- Both run hourly and filter on the recipient's local hour inside the
-- function, which is the only way one job can serve every timezone.
create extension if not exists pg_cron;

select cron.schedule('crema-streak-reminders', '0 * * * *',
                     $$select push_streak_reminders()$$);
-- Sunday through Tuesday in UTC, because timezone offsets span -12..+14
-- and someone's local Monday can land on either neighbouring UTC day.
-- push_weekly_digest() checks the recipient's own weekday and hour, so
-- the extra runs cost one cheap query and send nothing.
select cron.schedule('crema-weekly-digest', '0 * * * 0,1,2',
                     $$select push_weekly_digest()$$);
