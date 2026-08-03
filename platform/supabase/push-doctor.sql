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
-- A reaction takes the same road and differs only in its first step —
-- notify_on_reaction() (step-1.19) instead of notify_on_like(), writing
-- "loved your latte art" / "loved where you had it" / "loved your choice
-- of coffee". Everything from `notifications` onward is shared, which is
-- why step-1.16 put push on that table rather than on likes: a reaction
-- reaches the phone by the same trigger a like does, and so does
-- anything added later. Same for @mentions (comments_mention_notify).
--
-- Two consequences worth holding on to while reading the verdicts:
--
--   · likes push but reactions don't → the break is the WRITER, not
--     push. reactions_notify is missing (section 3) and step-1.19.sql
--     needs running. Push itself is fine.
--   · nothing pushes, but the in-app inbox fills up → the writers are
--     fine and the break is link 2 or later, almost always at
--     net.http_post: pg_net fires and forgets, so a 401 or 403 from the
--     Edge Function never reaches the trigger, never rolls anything
--     back, and never appears in any log you would think to check.
--     Section 5 is that log.
--
-- One thing that is not a fault, and looks exactly like one: you cannot
-- react to your own pour (RLS, step-1.19) and nobody is notified about
-- their own activity (every notify_* function returns early when actor =
-- owner). Testing a reaction on your own post produces silence by
-- design. Use a second account.
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

-- ---------- 3. are the triggers attached and enabled? ----------
-- Two kinds here, and the difference matters when only one sort of thing
-- fails to arrive:
--
--   · the WRITERS — one per kind of event, each turning a like, comment,
--     follow, reaction or @mention into a `notifications` row;
--   · the CARRIER — `notifications_push`, the single trigger that takes
--     ANY such row to a phone.
--
-- So: nothing arrives at all → the carrier or sections 4-5. One kind
-- arrives and another doesn't → that kind's writer, and the migration
-- that installs it never ran.
--
-- Listed expected-first and joined outward, because a trigger that was
-- never created has no row in pg_trigger at all: querying pg_trigger
-- directly makes the missing one invisible, which is precisely the one
-- being looked for.
--
-- tgenabled: O = enabled, D = disabled, R/A = replica-only.
select '3. triggers' as check,
       e.tgname,
       e.turns                                    as what_it_does,
       coalesce(t.tgenabled, '-')                 as tgenabled,
       case when t.tgname is null then 'MISSING — ' || e.installed_by || ' has not been run'
            when t.tgenabled = 'O' then 'ok'
            when t.tgenabled = 'D' then 'DISABLED'
            else 'replica-only — will not fire on a normal write' end as verdict
  from (values
         ('likes_notify',            'step-1.8.sql',  'a like → an inbox row'),
         ('comments_notify',         'step-1.8.sql',  'a comment → an inbox row'),
         ('follows_notify',          'step-1.8.sql',  'a follow or request → an inbox row'),
         ('follows_accept_notify',   'step-1.15.sql', 'an accepted request → an inbox row'),
         ('follows_decline_notify',  'step-1.15.sql', 'a declined request → an inbox row'),
         ('reactions_notify',        'step-1.19.sql', 'a reaction → an inbox row'),
         ('comments_mention_notify', 'step-1.19.sql', 'an @mention → an inbox row'),
         ('notifications_push',      'step-1.16.sql', 'ANY inbox row → the phone')
       ) as e(tgname, installed_by, turns)
  left join pg_trigger t
         on t.tgname = e.tgname and not t.tgisinternal
 order by (e.tgname = 'notifications_push'), e.tgname;

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
