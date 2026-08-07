-- ============================================================
-- Crema — step 1.20: the morning nudge
--
-- Run after step-1.19.sql. Re-runnable.
--
-- The evening streak reminder (step-1.16) only ever reaches someone who
-- already has a streak worth defending: streak_at_risk() is zero for a
-- brand-new account and for anyone who has already lost their streak, so
-- both hear nothing from Crema, ever, at the one moment a habit product
-- actually wants their attention — the 30 seconds after the coffee is
-- made, not the last chance at 7pm to remember it happened.
--
-- This adds a second, earlier nudge with a different rule: anyone who
-- hasn't poured yet today, streak or no streak. Same delivery mechanism
-- as step-1.16 (push_subscriptions, push_send), same discipline (a fixed
-- local hour computed from each device's own tz_offset, one collapsing
-- tag so a retried cron tick replaces rather than stacks).
--
-- notify_morning defaults to true, same reasoning step-1.19 gave for
-- flipping the other two switches: this sits behind a tap in Settings
-- nobody goes looking for, and defaulting it off means the feature ships
-- disabled for everyone. That default is provably safe — nothing sends
-- until a device has completed the SAME "Remind me" permission flow
-- gating the other two, and it costs one line to turn back off from the
-- reminders sheet where the other switches live.
-- ============================================================

alter table profiles add column if not exists notify_morning bool not null default true;
update profiles set notify_morning = true where notify_morning is not true;

-- Fixed local hour rather than "whenever you usually pour" — Crema does
-- not know that per person, and a nudge that lands at a different time
-- every day is harder to build a habit around than one that doesn't.
-- 8am mirrors push_weekly_digest()'s own choice of "start of the day".
create or replace function push_morning_nudge()
returns void language plpgsql security definer set search_path = public as $$
declare rows jsonb; n int;
begin
  select coalesce(jsonb_agg(x), '[]'::jsonb) into rows from (
    select jsonb_build_object(
             'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
             'title', case when r.n > 0 then 'Keep the streak going' else 'Good morning ☕' end,
             'body',  case when r.n > 0
                           then r.n || ' days so far — log today''s and make it ' || (r.n + 1) || '.'
                           else 'Log today''s coffee before it''s just a memory.' end,
             'url',   './',
             'tag',   'morning'
           ) as x
      from push_subscriptions s
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

revoke all on function push_morning_nudge() from public, anon, authenticated;

select cron.schedule('crema-morning-nudge', '0 * * * *',
                     $$select push_morning_nudge()$$);

-- ---------- what to expect afterwards ----------
--   -- nobody is left opted out of a switch they never touched:
--   select count(*) from profiles where not notify_morning;   -- 0
--
--   -- the job is scheduled alongside the other two:
--   select jobname, schedule from cron.job where jobname like 'crema-%';
