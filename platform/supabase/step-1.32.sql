-- ============================================================
-- Crema — step 1.32: a push in the reader's language
--
-- Everything on a SCREEN has been German since the app shipped German,
-- and since 2026-08-27 that reaches the catalogue too. Everything sent
-- to a PHONE has been English the whole time, for one structural
-- reason: push text is composed here, in plpgsql, minutes or hours
-- after anybody was looking at anything, with nobody to ask which
-- language they read. So the server said "Ann liked your pour" to a
-- user whose entire app says "Ann gefällt dein Kaffee".
--
-- Three pieces fix that.
--
-- 1. THE DEVICE SAYS WHICH LANGUAGE IT IS IN.
--    `push_subscriptions.lang`, written by src/data/push.js at subscribe
--    time and re-stated on every boot and every language switch —
--    exactly the treatment `tz_offset` already gets, and for the same
--    reason. Language is per DEVICE, not per account: Crema keeps it in
--    localStorage, the notification appears on this phone, and a tablet
--    still set to English should keep getting English.
--
--    Default 'en', so a row written before the client catches up reads
--    exactly as it does today. Nothing here can make a notification
--    stop arriving; the worst case is the English it already was.
--
-- 2. POSTGRES GETS A COPY OF THE GERMAN.
--    `push_i18n` is key → text, seeded below. It is a SECOND copy of
--    strings src/i18n.de.js already holds, which is a real cost and is
--    the reason the seed is GENERATED rather than typed:
--
--        node platform/supabase/gen-push-i18n.mjs
--        node platform/supabase/gen-push-i18n.mjs --check
--
--    src/i18n.de.js stays the one place German is written. `--check`
--    answers "have they drifted" without anyone reading 49 quoted
--    strings side by side. Adding a challenge template in step-1.17 or a
--    new notification body in a later migration means re-running the
--    generator and pasting its block into the migration that adds it.
--
-- 3. THE THREE SENDERS RENDER PER RECIPIENT.
--    push_on_notification(), push_streak_reminders() and
--    push_weekly_digest() are replaced. All three used to build one
--    string and fan it out; they now build it inside the fan-out, per
--    subscription, from that row's `lang`. A user with a German phone
--    and an English laptop gets each in its own language, from one
--    `notifications` row.
--
-- WHAT IS DELIBERATELY NOT TRANSLATED
--    The moderation notices from step-1.27. Their body is the statement
--    of reasons a human typed, in whatever language they chose to write
--    to that person in (see src/data/moderation.js). Running it through
--    a lookup would find nothing and return it unchanged, which is
--    correct — but it is worth saying out loud that it is correct rather
--    than merely harmless.
--
-- RE-RUNNABLE. Every statement is if-not-exists or create-or-replace,
-- and the seed upserts. It does NOT depend on step-1.31, and step-1.31
-- does not depend on it; run them in either order.
--
-- TESTED: platform/supabase/local-test/run.sh push-i18n-test.sql
-- ============================================================

-- ============================================================
-- 1. WHICH LANGUAGE THIS DEVICE IS IN
-- ============================================================
alter table push_subscriptions
  add column if not exists lang text not null default 'en';

-- Constrained rather than free text: this is a lookup key, and a typo
-- would fail open to English silently on one device forever. Added
-- separately so re-running the file does not trip over its own
-- constraint.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'push_subscriptions_lang_check') then
    alter table push_subscriptions
      add constraint push_subscriptions_lang_check check (lang in ('en','de'));
  end if;
end $$;

-- ============================================================
-- 2. THE WORDS
-- ============================================================
create table if not exists push_i18n (
  key  text not null,
  lang text not null,
  txt  text not null,
  primary key (key, lang)
);

-- Nobody's rows, and nothing a client should be able to read or write:
-- it is a dictionary the send path consults. RLS on with no policy is
-- the shortest way to say "no client, ever" and still let the
-- SECURITY DEFINER functions below read it.
alter table push_i18n enable row level security;

-- ---------- the seed ----------
-- GENERATED — do not edit by hand:
--     node platform/supabase/gen-push-i18n.mjs
-- English is the key and its own fallback, so only German is stored.
insert into push_i18n (key, lang, txt) values
  ('liked your pour', 'de', 'gefällt dein Kaffee'),
  ('commented on your pour', 'de', 'hat deinen Kaffee kommentiert'),
  ('started following you', 'de', 'folgt dir jetzt'),
  ('wants to follow you', 'de', 'möchte dir folgen'),
  ('accepted your follow request', 'de', 'hat deine Anfrage angenommen'),
  ('loved your latte art', 'de', 'mag deine Latte Art'),
  ('loved where you had it', 'de', 'mag den Ort, an dem du ihn hattest'),
  ('loved your choice of coffee', 'de', 'mag deine Kaffeewahl'),
  ('reacted to your pour', 'de', 'hat auf deinen Kaffee reagiert'),
  ('mentioned you in a comment', 'de', 'hat dich in einem Kommentar erwähnt'),
  ('🥇 1st place on today''s podium', 'de', '🥇 1. Platz auf dem Podium des Tages'),
  ('🥈 2nd place on today''s podium', 'de', '🥈 2. Platz auf dem Podium des Tages'),
  ('🥉 3rd place on today''s podium', 'de', '🥉 3. Platz auf dem Podium des Tages'),
  ('Challenge complete: {title} · +{n} points', 'de', 'Challenge geschafft: {title} · +{n} Punkte'),
  ('First coffee in Crema today · +20 points', 'de', 'Erster Kaffee heute in Crema · +20 Punkte'),
  ('poured the first coffee of the day', 'de', 'hat den ersten Kaffee des Tages gemacht'),
  ('poured a coffee', 'de', 'hat einen Kaffee gemacht'),
  ('We looked at what you reported and acted on it. Thank you for flagging it.', 'de', 'Wir haben uns deine Meldung angesehen und gehandelt. Danke, dass du sie geschickt hast.'),
  ('We looked at what you reported and left it up. Thank you for flagging it.', 'de', 'Wir haben uns deine Meldung angesehen und den Beitrag stehen lassen. Danke, dass du sie geschickt hast.'),
  ('Your streak ends tonight', 'de', 'Dein Streak endet heute Abend'),
  ('{n} days so far — one pour keeps it going.', 'de', '{n} Tage bisher — ein Kaffee hält ihn am Leben.'),
  ('Your week in coffee', 'de', 'Deine Kaffeewoche'),
  ('{n} pour', 'de', '{n} Kaffee'),
  ('{n} pours', 'de', '{n} Kaffees'),
  ('{n} like', 'de', '{n} Like'),
  ('{n} likes', 'de', '{n} Likes'),
  ('{n} new follower', 'de', '{n} neuer Follower'),
  ('{n} new followers', 'de', '{n} neue Follower'),
  ('Five Mornings', 'de', 'Fünf Morgen'),
  ('Seven for Seven', 'de', 'Sieben von sieben'),
  ('Before Eight', 'de', 'Vor acht'),
  ('Both Days', 'de', 'Beide Tage'),
  ('Nightcap', 'de', 'Absacker'),
  ('Ten Cups', 'de', 'Zehn Tassen'),
  ('Rosetta Week', 'de', 'Rosetta-Woche'),
  ('Start with a Heart', 'de', 'Fang mit einem Herz an'),
  ('Tulip Season', 'de', 'Tulpenzeit'),
  ('The Swan', 'de', 'Der Schwan'),
  ('Show Your Work', 'de', 'Zeig deine Rechnung'),
  ('Free Pour Five', 'de', 'Fünf frei gegossen'),
  ('Say Something', 'de', 'Sag was dazu'),
  ('Three Bags', 'de', 'Drei Tüten'),
  ('New Territory', 'de', 'Neuland'),
  ('Round the Menu', 'de', 'Einmal quer durch die Karte'),
  ('Out and Out', 'de', 'Raus und weiter'),
  ('Passport', 'de', 'Reisepass'),
  ('Three Roasters', 'de', 'Drei Röstereien'),
  ('Milk Run', 'de', 'Milchrunde'),
  ('Good Company', 'de', 'Gute Gesellschaft')
on conflict (key, lang) do update set txt = excluded.txt;

-- ============================================================
-- 3. SAYING IT
-- ============================================================
-- The English key is its own fallback, all the way down: a string with
-- no German row, a language nobody seeded, a body from a migration
-- newer than this file — every one of them returns what was passed in.
-- There is no path here that produces an empty notification.
create or replace function crema_i18n(k text, l text)
returns text language sql stable set search_path = public as $$
  select coalesce((select txt from push_i18n where key = k and lang = l), k);
$$;

-- One `notifications.body`, said in `l`.
--
-- The mirror image of notifBody() in src/data/notifications.js, and it
-- has to stay one: the same row is read on a screen by that function and
-- on a phone by this one, and the two disagreeing is the bug this whole
-- file exists to prevent. Change one, change the other.
--
-- Everything the triggers write is a whole sentence and matches
-- outright. The single exception is the challenge payout, which
-- step-1.17 composes out of parts before the row is written — so the
-- parts are taken back out and refilled from the German template.
create or replace function crema_push_body(body text, l text)
returns text language plpgsql stable set search_path = public as $$
declare hit text; m text[];
begin
  if body is null or l is null or l = 'en' then return body; end if;

  hit := crema_i18n(body, l);
  if hit is distinct from body then return hit; end if;

  m := regexp_match(body, '^Challenge complete: (.+) · \+([0-9]+) points$');
  if m is not null then
    return replace(
             replace(crema_i18n('Challenge complete: {title} · +{n} points', l),
                     '{title}', crema_i18n(m[1], l)),
             '{n}', m[2]);
  end if;

  -- A moderation statement, or a body this file has never heard of.
  -- Both are right to leave alone; see the header.
  return body;
end $$;

-- "3 Kaffees, 5 Likes, 2 neue Follower."
--
-- Assembled from parts rather than stored as one template because the
-- followers clause is dropped entirely when there are none, and because
-- German pluralises the three nouns differently from each other. The
-- joining — comma, space, full stop — is the same in both languages and
-- is the only thing this hard-codes.
create or replace function crema_digest_body(pours bigint, likes bigint, followers bigint, l text)
returns text language sql stable set search_path = public as $$
  select array_to_string(array_remove(array[
      replace(crema_i18n(case when pours     = 1 then '{n} pour'         else '{n} pours'         end, l), '{n}', pours::text),
      replace(crema_i18n(case when likes     = 1 then '{n} like'         else '{n} likes'         end, l), '{n}', likes::text),
      case when followers > 0
        then replace(crema_i18n(case when followers = 1 then '{n} new follower' else '{n} new followers' end, l), '{n}', followers::text)
        else null end
    ], null), ', ') || '.';
$$;

-- ============================================================
-- 4. THE THREE SENDERS, RENDERING PER DEVICE
-- ============================================================
-- Unchanged from step-1.16 except that the body is built inside the
-- aggregate, from s.lang, instead of once above it. The switch is still
-- checked before any work is done, the deep link and the collapsing tag
-- are byte-for-byte what they were, and a failure still cannot roll back
-- the inbox row it was triggered by.
create or replace function push_on_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text; rows jsonb;
begin
  if not exists (select 1 from profiles where id = new.user_id and notify_social) then
    return new;
  end if;

  select coalesce(nullif(name,''), '@' || handle) into actor
    from profiles where id = new.actor_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
           -- The app is called Crema in both languages.
           'title', 'Crema',
           'body',  coalesce(actor || ' ', '')
                    || crema_push_body(coalesce(new.body, new.type), s.lang),
           'url',   case when new.post_id is not null then './#p/' || new.post_id else './' end,
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

drop trigger if exists notifications_push on notifications;
create trigger notifications_push after insert on notifications
  for each row execute function push_on_notification();

create or replace function push_streak_reminders()
returns void language plpgsql security definer set search_path = public as $$
declare rows jsonb; n int;
begin
  select coalesce(jsonb_agg(x), '[]'::jsonb) into rows from (
    select jsonb_build_object(
             'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
             'title', crema_i18n('Your streak ends tonight', s.lang),
             'body',  replace(crema_i18n('{n} days so far — one pour keeps it going.', s.lang),
                              '{n}', d.n::text),
             'url',   './',
             'tag',   'streak'
           ) as x
      from push_subscriptions s
      join profiles p on p.id = s.user_id and p.notify_streak
      cross join lateral (select streak_at_risk(s.user_id, s.tz_offset) as n) d
     where d.n > 0
       and extract(hour from (now() + make_interval(mins => s.tz_offset))) = 19
  ) q;

  n := jsonb_array_length(rows);
  if n > 0 then perform push_send(jsonb_build_object('rows', rows)); end if;
  raise notice 'streak reminders: % device(s)', n;
end $$;

create or replace function push_weekly_digest()
returns void language plpgsql security definer set search_path = public as $$
declare rows jsonb; n int;
begin
  select coalesce(jsonb_agg(x), '[]'::jsonb) into rows from (
    select jsonb_build_object(
             'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
             'title', crema_i18n('Your week in coffee', s.lang),
             'body',  crema_digest_body(w.pours, w.likes, w.followers, s.lang),
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
     where (w.pours > 0 or w.likes > 0 or w.followers > 0)
       and extract(dow  from (now() + make_interval(mins => s.tz_offset))) = 1
       and extract(hour from (now() + make_interval(mins => s.tz_offset))) = 8
  ) q;

  n := jsonb_array_length(rows);
  if n > 0 then perform push_send(jsonb_build_object('rows', rows)); end if;
  raise notice 'weekly digest: % device(s)', n;
end $$;

-- ============================================================
-- 5. LOCK THE SURFACE
-- ============================================================
-- Same reasoning as step-1.16 §"nothing here is a client API": Postgres
-- grants EXECUTE to PUBLIC by default and PostgREST publishes every
-- function in `public` as an RPC. None of these is a client API. The
-- dictionary itself is already closed by RLS with no policy.
revoke all on function crema_i18n(text, text)                    from public, anon, authenticated;
revoke all on function crema_push_body(text, text)               from public, anon, authenticated;
revoke all on function crema_digest_body(bigint, bigint, bigint, text) from public, anon, authenticated;
revoke all on table push_i18n from anon, authenticated;
