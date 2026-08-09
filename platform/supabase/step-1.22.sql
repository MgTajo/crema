-- ============================================================
-- Crema — step 1.22: where your week stands, and when it lands
--
-- Run after step-1.21.sql. Re-runnable.
--
-- Two things, both in service of the week card:
--
--   1. week_standing() — the one number on that card the browser cannot
--      work out for itself: where this week's pours put you among
--      everyone else pouring in the same seven days. That takes a count
--      across every account, which is exactly the thing RLS exists to
--      stop a client from doing itself.
--
--      (The card's other server-shaped number was the week's reactions,
--      but it turned out likes and comments — which is what the card
--      actually wants — don't need a trip here at all: postOf() embeds
--      both straight off the `posts` row for every fetch, including
--      your own, so the browser already has them.)
--
--   2. The weekly digest moves from Monday 08:00 to Sunday 16:00, local
--      time, because that is when the card it announces now exists. A
--      notification saying "your week in coffee" a full day after the
--      week ended, on the morning nobody is thinking about coffee, was
--      arriving for the schedule's convenience rather than anyone's.
--      Same move as recapWindow() in src/store/store.js — the two are
--      one decision written in two places and have to be kept in step.
--
--      It is now the recap's own notification: same hour, same seven
--      days, and for a Premium account the last line says the card is
--      ready, because for them it is. A free account gets the numbers
--      and no promise it cannot open.
-- ============================================================

-- ============================================================
-- 1. WHERE YOUR WEEK STANDS
-- ============================================================
-- The window arrives as two timestamps rather than being worked out
-- here. The browser already decided which week the card is about, in
-- the user's own timezone, and a server recomputing it from UTC would
-- sooner or later count a different seven days than the one printed
-- across the top of the card. Half-open: [from_ts, to_ts).
--
-- security definer, and that needs saying out loud: it reads every
-- account's posts, past RLS, which is the only way to count a crowd.
-- What comes back is three integers — how many people poured, how many
-- times you did, and the share of the others you are ahead of. No row,
-- no id, no handle. Nothing here can be used to learn anything about
-- any individual, which is the line this function has to stay on.
--
-- The percentile is over the OTHER drinkers (denominator drinkers - 1),
-- so a week you shared with one other person is 0% or 100% and not a
-- confusing 50%. Below two people it is null — "ahead of 100% of
-- everyone" when you were the only one pouring is a number that means
-- nothing, and the card leaves the tile out rather than printing it.
-- Ties count as not-ahead: matching someone is not beating them.
--
-- Dropped first rather than just replaced: this step originally shipped
-- a fourth column (a reaction count that turned out to be unnecessary —
-- see above), and Postgres refuses to CREATE OR REPLACE a function into
-- a different return shape. Harmless on a first run, where there is
-- nothing to drop.
drop function if exists week_standing(timestamptz, timestamptz);
create function week_standing(from_ts timestamptz, to_ts timestamptz)
returns table (drinkers int, pours int, ahead_pct int)
language sql stable security definer set search_path = public as $$
  with tallies as (
    select user_id, count(*)::int as n
      from posts
     where created_at >= from_ts and created_at < to_ts
     group by user_id
  ),
  me as (
    select coalesce((select n from tallies where user_id = auth.uid()), 0) as n,
           (select count(*)::int from tallies) as total
  )
  select
    me.total,
    me.n,
    case when me.total > 1 and me.n > 0 and auth.uid() is not null
         then round(100.0 * (select count(*) from tallies where n < me.n)
                          / (me.total - 1))::int
         else null end
  from me;
$$;

revoke all on function week_standing(timestamptz, timestamptz) from public, anon;
grant execute on function week_standing(timestamptz, timestamptz) to authenticated;

-- ============================================================
-- 2. THE DIGEST MOVES TO SUNDAY AFTERNOON
-- ============================================================
-- Same function as step-1.16, with two changes: the hour it fires, and
-- the window it counts. It was a rolling seven days, which was fine for
-- a Monday-morning note and is wrong now — the card it points at covers
-- a calendar week, and a push claiming a different number than the
-- screen it opens is worse than no push.
--
-- date_trunc('week', …) lands on Monday 00:00. It is applied to the
-- recipient's local clock and then shifted back, so the count starts at
-- their Monday rather than at UTC's.
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
                              else '' end || '.'
                      || case when p.premium then ' Your card is ready.' else '' end,
             -- Straight to the card for the people who have one. A free
             -- account lands on the app, not on a paywall it did not
             -- ask to see.
             'url',   case when p.premium then './#recap' else './' end,
             'tag',   'digest'
           ) as x
      from push_subscriptions s
      join profiles p on p.id = s.user_id and p.notify_digest
      cross join lateral (
        select date_trunc('week', now() + make_interval(mins => s.tz_offset))
                 - make_interval(mins => s.tz_offset) as week_start
      ) k
      cross join lateral (
        select
          (select count(*) from posts po
            where po.user_id = s.user_id and po.created_at >= k.week_start) as pours,
          (select count(*) from likes l join posts po on po.id = l.post_id
            where po.user_id = s.user_id and l.created_at >= k.week_start) as likes,
          (select count(*) from follows f
            where f.followee_id = s.user_id and f.status = 'accepted'
              and f.created_at >= k.week_start) as followers
      ) w
       -- Parenthesised deliberately: AND binds tighter than OR, so
       -- without these the hour check would apply to the followers
       -- branch alone and the digest would fire around the clock.
     where (w.pours > 0 or w.likes > 0 or w.followers > 0)
       -- Sunday 16:00 in the RECIPIENT's timezone, the hour the card
       -- turns over. Both parts have to be checked here rather than in
       -- the cron expression: for a user at UTC+13, local Sunday
       -- afternoon is Sunday morning UTC and can spill either side, so
       -- the schedule below runs on three UTC days and this is what
       -- narrows each of them to the right people.
       and extract(dow  from (now() + make_interval(mins => s.tz_offset))) = 0
       and extract(hour from (now() + make_interval(mins => s.tz_offset))) = 16
  ) q;

  n := jsonb_array_length(rows);
  if n > 0 then perform push_send(jsonb_build_object('rows', rows)); end if;
  raise notice 'weekly digest: % device(s)', n;
end $$;

revoke all on function push_weekly_digest() from public, anon, authenticated;

-- Saturday through Monday in UTC: offsets span -12..+14, so someone's
-- local Sunday afternoon can land on either neighbouring UTC day. The
-- function checks the recipient's own weekday and hour, so the extra
-- runs cost one cheap query and send nothing.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'crema-weekly-digest')
      then perform cron.unschedule('crema-weekly-digest');
    end if;
    perform cron.schedule('crema-weekly-digest', '0 * * * 6,0,1',
                          $c$select push_weekly_digest()$c$);
  end if;
exception when others then
  raise notice 'pg_cron not reachable here — reschedule crema-weekly-digest by hand';
end $$;

-- ---------- what to expect afterwards ----------
--   -- your own standing for a week (as an authenticated caller):
--   select * from week_standing(now() - interval '7 days', now());
--
--   -- and the digest now fires on Sunday afternoons:
--   select jobname, schedule from cron.job where jobname = 'crema-weekly-digest';
