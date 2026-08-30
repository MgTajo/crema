-- ============================================================
-- Crema — metrics, read from the database that already has them
--
-- There is no analytics in Crema and this file is not analytics. Every
-- event the app cares about is already a row: a pour is a `posts` row, a
-- return visit that did anything is a like, a comment or a reaction, an
-- account is a `profiles` row. This reads those rows.
--
-- HOW TO RUN IT
--   Supabase SQL editor → paste the whole file → SELECT ONE BLOCK and
--   press Run. The editor runs the selection when there is one, and
--   returns only the last statement otherwise. Block A is the one to
--   run first; it answers most questions on its own.
--
-- NOTHING HERE WRITES. No CREATE, no UPDATE, no DELETE, not even a view
-- — deliberately, because this project has no backups and a metrics file
-- should never be the reason someone runs DDL against production.
--
-- WHAT IT CANNOT SEE, and no query ever will:
--   * opens. Someone who launches Crema, reads the feed and closes it
--     leaves no row. Every "active" below means *did something*, which
--     is a floor under real engagement, never the whole of it.
--   * installs, sessions, screens, funnels, referrers.
--   * anything before the row existed. `recap_exports` starts counting
--     the day step-1.26.sql runs; it cannot answer for last month.
--   All day boundaries are Europe/Berlin, matching the podium. Streaks
--   and challenges use each user's own timezone — do not mix the two.
--
-- Read brain/07-growth.md for what the numbers are *for*, and
-- brain/09-red-team.md for the falsifiers these were built to evaluate.
-- ============================================================


-- ============================================================
-- BLOCK A — the dashboard. One result, every headline number.
-- ============================================================
-- Label / value / what it means, so it reads top to bottom and can be
-- pasted into a note without a legend.
with berlin as (select (now() at time zone 'Europe/Berlin')::date as today),
acts as (
  select user_id, (created_at at time zone 'Europe/Berlin')::date as d from posts
  union all select user_id, (created_at at time zone 'Europe/Berlin')::date from likes
  union all select user_id, (created_at at time zone 'Europe/Berlin')::date from comments
  union all select user_id, (created_at at time zone 'Europe/Berlin')::date from reactions
),
p as (select id, (created_at at time zone 'Europe/Berlin')::date as d0 from profiles)
select * from (
  select 1::numeric as n, 'accounts' as metric,
         (select count(*)::text from profiles) as value,
         'rows in profiles — not people, not installs' as note
  union all select 2, 'accounts that ever poured',
         (select count(distinct user_id)::text from posts),
         'the honest denominator for everything below'
  union all select 3, 'accounts that poured in the last 7 days',
         (select count(distinct user_id)::text from posts
           where created_at >= now() - interval '7 days'),
         'the number the growth plan calls "active"'
  union all select 4, 'accounts that did anything in the last 7 days',
         (select count(distinct user_id)::text from acts
           where d > (select today from berlin) - 7),
         'poured, liked, commented or reacted'
  union all select 5, 'pours, all time',
         (select count(*)::text from posts), ''
  union all select 6, 'pours, last 7 days',
         (select count(*)::text from posts where created_at >= now() - interval '7 days'),
         'the amplification trigger is 30+/day — see brain/07-growth.md'
  union all select 7, 'pours per day, last 7 days',
         (select round(count(*)/7.0, 1)::text from posts where created_at >= now() - interval '7 days'), ''
  union all select 8, 'pours per poster per week, last 4 weeks (median, tenure-corrected)',
         -- ⚠️ Divided by weeks SINCE THAT ACCOUNT SIGNED UP, floored at
         -- one week — not by a fixed 4.0. The fixed divisor was the bug
         -- behind the 2026-08-18 reading of "3.7": it charges somebody
         -- who joined on Friday for the three weeks before they existed,
         -- so it understates every recent signup and the whole median
         -- with them. Both the 2026-08-29 and 2026-08-30 readings were
         -- taken in this corrected form by hand; on 2026-08-30 the file
         -- itself was fixed, so the two now agree. On that day the old
         -- query returned 0.5 and this one returns 1.04, from the same
         -- rows. See brain/14-measurements.md.
         (select coalesce(round(percentile_cont(0.5) within group (order by n)::numeric, 2)::text,'—')
            from (select count(*) / greatest(
                           extract(epoch from (now() - min(pr.created_at))) / 604800.0, 1.0) as n
                    from posts p join profiles pr on pr.id = p.user_id
                   where p.created_at >= now() - interval '28 days'
                   group by p.user_id) x),
         'red-team falsifier A fires below 2'
  union all select 9, 'responses per pour, last 30 days',
         coalesce((
           select round(
             ((select count(*) from likes l    join posts p2 on p2.id = l.post_id
                where p2.created_at >= now() - interval '30 days')
            + (select count(*) from comments c join posts p2 on p2.id = c.post_id
                where p2.created_at >= now() - interval '30 days'))::numeric
             / nullif((select count(*) from posts
                        where created_at >= now() - interval '30 days'), 0)
           , 2)::text), '—'),
         'likes + comments per pour, ALL accounts. Falsifier B fires below 1.0 — but read row 9b'
  -- Row 9 with the admin's OWN likes and comments taken out. One person
  -- answering everything looks identical to a live community from row 9,
  -- and that was the open worry on 2026-08-18. It is the responses BY
  -- the admin that are removed, not pours BY the admin — removing the
  -- latter answers a different question and gives a different number
  -- (3.09 rather than 2.40 on 2026-08-30).
  union all select 9.5, 'responses per pour, last 30 days, excluding responses by the admin',
         coalesce((
           select round(
             ((select count(*) from likes l    join posts p2 on p2.id = l.post_id
                where p2.created_at >= now() - interval '30 days'
                  and l.user_id not in (select id from profiles where is_admin))
            + (select count(*) from comments c join posts p2 on p2.id = c.post_id
                where p2.created_at >= now() - interval '30 days'
                  and c.user_id not in (select id from profiles where is_admin)))::numeric
             / nullif((select count(*) from posts
                        where created_at >= now() - interval '30 days'), 0)
           , 2)::text), '—'),
         'this is the one to quote internally'
  union all select 10, 'pours with at least one response, last 30 days',
         (select coalesce(round(100.0 * count(*) filter (
                    where (select count(*) from likes l where l.post_id = p2.id)
                        + (select count(*) from comments c where c.post_id = p2.id) > 0)
                  / nullif(count(*),0), 0)::text || '%', '—')
            from posts p2 where p2.created_at >= now() - interval '30 days'),
         'the share of people who got any answer at all'
  union all select 11, 'week-card exports, last 7 days',
         (select count(*)::text from recap_exports where created_at >= now() - interval '7 days'),
         'empty until step-1.26.sql has been running a while'
  union all select 12, 'open reports',
         (select count(*)::text from reports where status = 'open'),
         'the moderation queue — see brain/08-legal-and-safety.md'
  union all select 13, 'live suspensions',
         (select count(*)::text from profiles where suspended_until > now()), ''
) rows order by n;


-- ============================================================
-- BLOCK B — signups per week, and how many of them ever poured
-- ============================================================
-- An account that never posts is a signup, not a user. Keeping both
-- columns side by side is what stops the first number being quoted.
select date_trunc('week', created_at at time zone 'Europe/Berlin')::date as week,
       count(*)                                                          as signups,
       count(*) filter (where exists (select 1 from posts p where p.user_id = pr.id)) as ever_poured,
       count(*) filter (where exists (select 1 from posts p
                                       where p.user_id = pr.id
                                         and p.created_at < pr.created_at + interval '24 hours')) as poured_day_one
  from profiles pr
 group by 1 order by 1 desc;


-- ============================================================
-- BLOCK C — pours per day, and how many people made them
-- ============================================================
-- The two columns answer different questions. Twenty pours from three
-- people is not the same morning as twenty pours from twelve.
select (created_at at time zone 'Europe/Berlin')::date as day,
       count(*)                    as pours,
       count(distinct user_id)     as posters,
       round(count(*)::numeric / nullif(count(distinct user_id),0), 1) as pours_per_poster
  from posts
 where created_at >= now() - interval '60 days'
 group by 1 order by 1 desc;


-- ============================================================
-- BLOCK D — retention, by signup cohort
-- ============================================================
-- Two readings of the same rows, because at this size the classic one is
-- almost meaningless on its own:
--
--   d1 / d7 / d30  — active on exactly that day. The industry number,
--                    and at 25 users it will mostly be 0% noise.
--   w1 / w4        — active at any point in days 1–7 and days 8–30.
--                    Sparse-network honest, and the one to watch first.
--
-- "Active" = poured, liked, commented or reacted. Opens are invisible.
-- Cohorts too young to have had the chance are excluded per column
-- rather than dropped, so a young week still reports its w1.
with acts as (
  select user_id, (created_at at time zone 'Europe/Berlin')::date as d from posts
  union all select user_id, (created_at at time zone 'Europe/Berlin')::date from likes
  union all select user_id, (created_at at time zone 'Europe/Berlin')::date from comments
  union all select user_id, (created_at at time zone 'Europe/Berlin')::date from reactions
),
p as (
  select id, (created_at at time zone 'Europe/Berlin')::date as d0,
         date_trunc('week', created_at at time zone 'Europe/Berlin')::date as cohort
    from profiles
),
today as (select (now() at time zone 'Europe/Berlin')::date as t)
select p.cohort,
       count(*) as accounts,
       -- exactly day N
       nullif(round(100.0 * count(*) filter (where exists (
         select 1 from acts a where a.user_id = p.id and a.d = p.d0 + 1))
         / nullif(count(*) filter (where p.d0 + 1  <= (select t from today)),0), 0),0)::text || '%' as d1,
       nullif(round(100.0 * count(*) filter (where exists (
         select 1 from acts a where a.user_id = p.id and a.d = p.d0 + 7))
         / nullif(count(*) filter (where p.d0 + 7  <= (select t from today)),0), 0),0)::text || '%' as d7,
       nullif(round(100.0 * count(*) filter (where exists (
         select 1 from acts a where a.user_id = p.id and a.d = p.d0 + 30))
         / nullif(count(*) filter (where p.d0 + 30 <= (select t from today)),0), 0),0)::text || '%' as d30,
       -- any day in the window
       round(100.0 * count(*) filter (where exists (
         select 1 from acts a where a.user_id = p.id and a.d between p.d0 + 1 and p.d0 + 7))
         / nullif(count(*) filter (where p.d0 + 1 <= (select t from today)),0), 0)::text || '%' as w1_any,
       round(100.0 * count(*) filter (where exists (
         select 1 from acts a where a.user_id = p.id and a.d between p.d0 + 8 and p.d0 + 30))
         / nullif(count(*) filter (where p.d0 + 8 <= (select t from today)),0), 0)::text || '%' as w4_any
  from p
 group by p.cohort
 order by p.cohort desc;


-- ============================================================
-- BLOCK E — the social confirmer
-- ============================================================
-- From brain/09-red-team.md, risk 2:
--
--   "if users who receive a comment on their first pour post again
--    within 48h at a materially higher rate than those who don't, the
--    social thesis is live and the priority is getting more first pours
--    answered."
--
-- This is the single most decision-changing query in the file: it is the
-- difference between "Crema is a log with a feed attached" and "the feed
-- is the product". Read it only once the n column is worth reading.
with firsts as (
  select distinct on (user_id) user_id, id, created_at
    from posts order by user_id, created_at asc
),
answered as (
  select f.user_id, f.created_at,
         exists (select 1 from comments c
                  where c.post_id = f.id and c.user_id <> f.user_id
                    and c.created_at < f.created_at + interval '24 hours') as got_comment,
         exists (select 1 from likes l
                  where l.post_id = f.id and l.user_id <> f.user_id
                    and l.created_at < f.created_at + interval '24 hours') as got_like,
         exists (select 1 from posts p2
                  where p2.user_id = f.user_id and p2.created_at > f.created_at
                    and p2.created_at < f.created_at + interval '48 hours') as came_back
    from firsts f
)
select case when got_comment then 'commented on'
            when got_like    then 'liked only'
            else 'no response' end                                  as first_pour_got,
       count(*)                                                     as accounts,
       count(*) filter (where came_back)                            as poured_again_within_48h,
       round(100.0 * count(*) filter (where came_back) / count(*))::text || '%' as rate
  from answered
 group by 1 order by 1;


-- ============================================================
-- BLOCK F — the week card, and whether the loop turns
-- ============================================================
-- Risk 5's falsifier: "if fewer than ~15% of active users export a card
-- in a given week once there are 100+ users, the weekly cadence is not
-- producing enough loop volume."
--
-- Both halves of that comparison, per week. Empty until step-1.26.sql
-- has been live for a week — an empty result here is "not measured yet",
-- never "nobody shares it".
with weeks as (
  select generate_series(date_trunc('week', now() - interval '8 weeks'),
                         date_trunc('week', now()), interval '1 week')::date as wk
),
active as (
  select date_trunc('week', created_at at time zone 'Europe/Berlin')::date as wk,
         count(distinct user_id) as posters
    from posts group by 1
),
ex as (
  select date_trunc('week', created_at at time zone 'Europe/Berlin')::date as wk,
         count(*)                as exports,
         count(distinct user_id) as exporters,
         count(*) filter (where kind = 'share') as shared
    from recap_exports group by 1
)
select w.wk as week,
       coalesce(a.posters,0)   as people_who_poured,
       coalesce(e.exporters,0) as people_who_exported_a_card,
       coalesce(e.exports,0)   as exports,
       coalesce(e.shared,0)    as of_which_shared,
       case when coalesce(a.posters,0) = 0 then '—'
            else round(100.0 * coalesce(e.exporters,0) / a.posters)::text || '%' end as share_rate
  from weeks w
  left join active a on a.wk = w.wk
  left join ex     e on e.wk = w.wk
 order by w.wk desc;


-- ============================================================
-- BLOCK G — the empty-morning check
-- ============================================================
-- The content floor, measured. Crema tells people to open it in the
-- morning; this says what was actually on the feed at that hour. A row
-- with 0 or 1 pours is a morning where a new visitor saw an empty app.
select h.hour,
       count(distinct d.day)                                   as days_measured,
       round(avg(coalesce(c.pours,0)), 1)                      as avg_pours_by_then,
       count(*) filter (where coalesce(c.pours,0) <= 1)        as mornings_with_1_or_fewer
  from (select generate_series(5,11) as hour) h
 cross join (select distinct (created_at at time zone 'Europe/Berlin')::date as day
               from posts where created_at >= now() - interval '30 days') d
  left join lateral (
       select count(*) as pours from posts p
        where (p.created_at at time zone 'Europe/Berlin')::date = d.day
          and extract(hour from p.created_at at time zone 'Europe/Berlin') < h.hour
          and p.visibility = 'public' and p.hidden_at is null
  ) c on true
 group by h.hour order by h.hour;


-- ============================================================
-- BLOCK H — moderation load and speed
-- ============================================================
-- Checklist §7: "support/moderation load is manageable at current size."
-- Both halves of that: how much arrives, and how long it sits.
select date_trunc('week', created_at)::date as week,
       count(*)                                            as reports,
       count(*) filter (where status = 'open')             as still_open,
       count(*) filter (where status = 'actioned')         as actioned,
       count(*) filter (where status = 'dismissed')        as dismissed,
       round(avg(extract(epoch from resolved_at - created_at)/3600.0)::numeric, 1) as avg_hours_to_decide
  from reports
 group by 1 order by 1 desc;


-- ============================================================
-- BLOCK I — the R2 cleanup queue
-- ============================================================
-- Deleting a post deletes its row and nothing else: an object in a
-- bucket is not a row and no cascade reaches it. mod_delete_post keeps
-- the key so the object can still be found. Every line here is a photo
-- that is still sitting in R2 with nothing pointing at it.
select created_at,
       evidence->>'image_key' as r2_key,
       evidence->>'user_id'   as former_author,
       reason
  from moderation_actions
 where action = 'delete_post'
   and evidence->>'image_key' is not null
 order by created_at desc;


-- ============================================================
-- BLOCK J — the notification switches, and what friend_pour costs
-- ============================================================
-- Added 2026-08-30, the day `friend_pour` went from once a morning to
-- every pour (D-2026-08-30-01). That decision's falsifier is "people
-- turn the switch off", and a falsifier with no BEFORE number is a
-- sentence, not a test. This is the before number, and the query the
-- after number has to be taken with — same file, same words, so two
-- readings a week apart are comparable rather than merely similar.
--
-- `notify_friends` is the row to watch. The other four are here so a
-- rise in it can be read against the general willingness to be
-- notified: everybody turning everything off is churn, not a verdict on
-- one feature.
select 'notify_friends' as switch,
       count(*) filter (where notify_friends)     as on_,
       count(*) filter (where not notify_friends) as off_,
       count(*)                                   as accounts,
       round(100.0*count(*) filter (where not notify_friends)/nullif(count(*),0),1)::text||'%' as off_pct
  from profiles
union all select 'notify_social', count(*) filter (where notify_social), count(*) filter (where not notify_social), count(*),
       round(100.0*count(*) filter (where not notify_social)/nullif(count(*),0),1)::text||'%' from profiles
union all select 'notify_morning', count(*) filter (where notify_morning), count(*) filter (where not notify_morning), count(*),
       round(100.0*count(*) filter (where not notify_morning)/nullif(count(*),0),1)::text||'%' from profiles
union all select 'notify_streak', count(*) filter (where notify_streak), count(*) filter (where not notify_streak), count(*),
       round(100.0*count(*) filter (where not notify_streak)/nullif(count(*),0),1)::text||'%' from profiles
union all select 'notify_digest', count(*) filter (where notify_digest), count(*) filter (where not notify_digest), count(*),
       round(100.0*count(*) filter (where not notify_digest)/nullif(count(*),0),1)::text||'%' from profiles
 order by 1;

-- ---------- the volume, and what it would have been ----------
-- `friend_pour_rows_every_pour_7d` recomputes the fan-out from `posts`,
-- `follows` and `blocks` the way notify_on_post() does — so BEFORE the
-- change it is a forecast, and AFTER it is a check that the trigger is
-- doing what the arithmetic says. The two columns converge on the day
-- the migration lands; if they ever diverge again, the trigger and the
-- follow graph disagree and one of them is wrong.
with recent as (select id, user_id from posts where created_at >= now() - interval '7 days'),
fan as (
  select r.id,
         (select count(*) from follows f
           where f.followee_id = r.user_id and f.status = 'accepted'
             and f.follower_id <> r.user_id
             and not exists (select 1 from blocks b
                              where (b.blocker_id = f.follower_id and b.blocked_id = r.user_id)
                                 or (b.blocker_id = r.user_id and b.blocked_id = f.follower_id))) as n
    from recent r)
select (select count(*) from recent)                                        as pours_7d,
       (select sum(n) from fan)                                             as friend_pour_rows_every_pour_7d,
       (select count(*) from notifications
         where type='friend_pour' and created_at >= now()-interval '7 days') as friend_pour_rows_actual_7d,
       (select round(avg(n),1) from fan)                                    as avg_followers_per_pour,
       (select count(*) from push_subscriptions)                            as devices_registered,
       (select count(*) from push_subscriptions s join profiles p on p.id = s.user_id
         where p.notify_friends)                                            as devices_a_friend_push_reaches;


-- ============================================================
-- BLOCK K — what broke, for whom, in which build
-- ============================================================
-- Added 2026-08-30 with the error log (D-2026-08-30-06). This is the
-- whole of "how do I use it": there is no dashboard and no alert, so
-- reading this block IS the monitoring. Run it after every release and
-- whenever somebody says the app did something strange.
--
-- `client_errors` holds 30 days; the prune job takes the rest. An empty
-- result is the expected result and means one of two things — nothing
-- crashed, or the reporter is not catching what actually breaks. The
-- known blind spot is signed-out visitors, who have no uid to write
-- with, so a sign-up that crashes is invisible here by construction.
--
-- Requires an admin session (the select policy is `is_admin()`), or the
-- SQL editor / service role, which bypasses RLS.

-- K1 — the last 30 days, most common first. The one to read.
select message,
       count(*)                       as hits,
       count(distinct user_id)        as people,
       max(created_at)                as last_seen,
       min(created_at)                as first_seen,
       array_agg(distinct app_version) as builds,
       array_agg(distinct lang)        as langs
  from client_errors
 group by message
 order by hits desc, last_seen desc
 limit 40;

-- K2 — is it getting better or worse. A fix that worked shows as a
-- build that stops appearing, which is why app_version is recorded.
select date_trunc('day', created_at)::date as day,
       app_version,
       count(*)                as errors,
       count(distinct user_id) as people
  from client_errors
 group by 1, 2
 order by 1 desc, errors desc;

-- K3 — one person or everybody. A crash that hits one account and no
-- other is usually their data, not the code, and is a different job.
select count(*)                                             as errors_30d,
       count(distinct user_id)                              as people_affected,
       (select count(*) from profiles)                      as accounts,
       round(100.0 * count(distinct user_id)
             / nullif((select count(*) from profiles), 0), 1) as pct_of_accounts
  from client_errors;

-- K4 — the newest twenty, with the stack. What you actually debug from.
select created_at, message, source, app_version, lang, stack
  from client_errors
 order by created_at desc
 limit 20;
