-- ============================================================
-- push-doctor — why didn't that notification reach the phone?
--
-- Paste the whole file into the Supabase SQL editor and read the
-- verdicts top to bottom. Safe: it only reads, except for the very last
-- section, which is commented out and sends you a test push.
--
-- The chain a "someone liked your pour" banner travels:
--
--   likes row
--     → notify_on_like()          (step-1.8)  writes a notifications row
--     → notifications_push        (step-1.16) trigger on that row
--     → push_on_notification()    collects your subscriptions
--     → push_send()               reads endpoint+secret from Vault
--     → net.http_post()           ASYNC — this is where errors go quiet
--     → send-push Edge Function   VAPID-signs and encrypts
--     → Apple/Google/Mozilla push service
--     → your device
--
-- The in-app inbox is filled by link 1. So an inbox that works and a
-- phone that stays silent means the break is at link 2 or later, and
-- almost always at net.http_post: pg_net fires and forgets, so a 401 or
-- 403 from the Edge Function never reaches the trigger, never rolls
-- anything back, and never appears in any log you would think to check.
-- Section 5 is that log.
-- ============================================================

-- ---------- 1. is there anything to send TO? ----------
-- An endpoint plus its two keys is the capability to reach a device. No
-- row here means the browser never subscribed, or subscribed under a
-- different VAPID key and was dropped.
select '1. subscriptions' as check,
       p.handle,
       count(s.endpoint)                          as subscriptions,
       coalesce(max(s.fail_count), 0)             as worst_fail_count,
       max(s.last_seen)                           as last_seen,
       case when count(s.endpoint) = 0
            then 'NONE — open Settings → Reminders → Remind me on the device itself'
            else 'ok' end                         as verdict
  from profiles p
  left join push_subscriptions s on s.user_id = p.id
 group by p.handle
 order by subscriptions desc, p.handle;

-- ---------- 2. did they agree to be reached about it? ----------
-- notify_social gates likes/comments/follows and defaults true. The
-- other two default false on purpose and are not what a "liked your
-- pour" push depends on.
select '2. switches' as check, handle, notify_social, notify_streak, notify_digest,
       case when notify_social then 'ok'
            else 'OFF — push_on_notification() returns early for this user' end as verdict
  from profiles
 order by handle;

-- ---------- 3. is the trigger actually attached and enabled? ----------
-- tgenabled: O = enabled, D = disabled, R/A = replica-only.
select '3. trigger' as check,
       t.tgname,
       t.tgenabled,
       case when t.tgenabled = 'O' then 'ok'
            when t.tgenabled = 'D' then 'DISABLED'
            else 'replica-only — will not fire on a normal write' end as verdict
  from pg_trigger t
 where t.tgname in ('notifications_push','likes_notify','comments_notify','follows_notify')
 order by t.tgname;

-- ---------- 4. does Postgres know where to send it? ----------
-- Both must be present. push_send() returns quietly with a notice when
-- the endpoint is missing, which is easy to miss in a busy transaction.
-- The fingerprint is what to compare against the function's copy. Never
-- print the secret itself into a shared terminal; the first eight hex
-- characters of its SHA-256 identify it beyond doubt without revealing
-- it, and will differ if so much as a stray newline is riding along.
select '4. config' as check,
       coalesce(left(push_config('push_endpoint'), 60), '(unset)') as endpoint,
       case when push_config('push_endpoint') is null then 'MISSING — see supabase/README.md §5'
            when push_config('push_endpoint') not like '%/functions/v1/send-push' then 'WRONG — should end in /functions/v1/send-push'
            else 'ok' end as endpoint_verdict,
       case when push_config('push_secret') is null then 'MISSING — every push will 403'
            else 'present, ' || length(push_config('push_secret')) || ' chars' end as secret_verdict,
       case when push_config('push_secret') is null then '(none)'
            else left(encode(digest(push_config('push_secret'), 'sha256'), 'hex'), 8)
       end as secret_fingerprint;

-- Compare that fingerprint with the one the Edge Function is using:
--
--     printf %s '<the PUSH_HOOK_SECRET you set>' | shasum -a 256 | cut -c1-8
--
-- printf, not `echo` and not a <<< herestring: both append a newline,
-- which changes the hash and would have you chasing a mismatch that
-- isn't there. That is the same byte this whole section is about.
--
-- Same eight characters → the secret is not the problem, look at
-- sections 1-3. Different → they have drifted; section 6 resets both
-- from one value.

-- ---------- 5. THE ANSWER IS USUALLY HERE ----------
-- Every call pg_net has made, with what came back. pg_net keeps these
-- for about six hours, so like a post and re-run this within that
-- window.
--
--   status 201/200  the Edge Function accepted it. Read `content` — it
--                   reports {sent, gone, failed}. sent:0 with gone:1
--                   means the subscription is dead and was deleted.
--   status 401      JWT verification is ON for the function. pg_net
--                   sends no Authorization header and never will.
--                   Redeploy with --no-verify-jwt (see section 6).
--   status 403      X-Push-Secret did not match PUSH_HOOK_SECRET. The
--                   Vault value and the function secret have drifted.
--   status 404      wrong endpoint URL, or the function is not deployed.
--   status 500      VAPID keys missing or malformed on the function.
--   error_msg set   pg_net could not connect at all.
--   NO ROWS         net.http_post() was never called: the trigger did
--                   not fire, or it bailed at section 1, 2 or 4.
select '5. what the network said' as check,
       r.id, r.status_code, r.error_msg, r.timed_out,
       left(r.content, 200) as response,
       r.created
  from net._http_response r
 order by r.id desc
 limit 20;

-- Anything the trigger swallowed. push_on_notification() catches every
-- exception so a failed push can never roll back the notification row —
-- which is right, but it means errors only ever appear as notices.
-- Postgres does not retain those, so this is a reminder rather than a
-- query: if sections 1-4 are ok and section 5 is empty, run section 7
-- and watch the NOTICE output in the SQL editor's Messages pane.

-- ---------- 6. resetting both sides from one value ----------
-- A 403 means the function ran and rejected the header, so JWT is off
-- and the two copies of the secret have drifted. Rather than hunt for
-- which one is wrong, set both from a single fresh value — one shell
-- variable, used twice, so they cannot disagree:
--
--     S=$(openssl rand -hex 32)
--     supabase secrets set PUSH_HOOK_SECRET="$S"
--     printf %s "$S" | shasum -a 256 | cut -c1-8      # note this
--     echo "select push_set_config('push_secret','$S');"   # paste into SQL editor
--
-- Then re-run section 4 and check the fingerprint matches.
--
-- `supabase secrets set` takes a moment to reach the running function.
-- Confirm end to end from a shell — with the right secret this returns
-- 200 {"sent":0} rather than 403, because rows is empty:
--
--     curl -i -X POST \
--       https://diabtvahplwoipvrprvb.supabase.co/functions/v1/send-push \
--       -H 'Content-Type: application/json' \
--       -H "X-Push-Secret: $S" -d '{"rows":[]}'
--
--   200 {"sent":0}  → the secret matches. Push will work.
--   403            → still drifted, or the function has not picked the
--                    new secret up yet. Wait a few seconds and retry.
--   401            → JWT verification is on. supabase/config.toml pins
--                    it off; redeploy: supabase functions deploy
--                    send-push --no-verify-jwt

-- ---------- 7. send yourself one, synchronously ----------
-- Uncomment, put your handle in, and run. Unlike the trigger path this
-- prints what happened. Check section 5 straight afterwards for the
-- status code.
--
-- do $$
-- declare rows jsonb; n int;
-- begin
--   select coalesce(jsonb_agg(jsonb_build_object(
--            'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
--            'title', 'Crema', 'body', 'Test push from push-doctor',
--            'url', './', 'tag', 'doctor')), '[]'::jsonb)
--     into rows
--     from push_subscriptions s
--     join profiles p on p.id = s.user_id
--    where p.handle = '@YOUR_HANDLE_HERE';
--
--   n := jsonb_array_length(rows);
--   raise notice 'subscriptions found: %', n;
--   if n = 0 then
--     raise notice 'nothing to send to — section 1 explains why';
--     return;
--   end if;
--   raise notice 'endpoint: %', coalesce(push_config('push_endpoint'), '(unset)');
--   perform push_send(jsonb_build_object('rows', rows));
--   raise notice 'handed to pg_net — re-run section 5 in a few seconds';
-- end $$;
