-- ============================================================
-- Crema — step 1.17: challenges that run themselves
--
-- Run after step-1.16.sql. Re-runnable.
--
-- The old model needed a person: someone wrote a challenge, people
-- joined it, submitted a pour, and voted on each other's entries. Three
-- separate asks before anything happened, a ranking that only means
-- something once there is a crowd to do the voting, and a weekly editing
-- job for whoever runs Crema. It shipped behind "Coming soon" and stayed
-- there, which was the honest verdict on it.
--
-- This replaces all of that with one idea: a challenge is a RULE THE
-- DATABASE CAN CHECK, measured against the coffee you were going to log
-- anyway.
--
--   · No joining.      You are in all three the moment they start.
--   · No submitting.   Your ordinary pours count.
--   · No voting.       Whether you did it is a fact, not an opinion.
--
-- So it works for one user or ten thousand, needs nobody to run it, and
-- the only way to win is to make coffee — which is the behaviour the app
-- wants anyway.
--
-- Three at a time, one from each category, rotating every Monday:
--
--   habit      — show up. Five mornings, before eight, both weekend days.
--   craft      — do it well. Rosettas, full recipes, real notes.
--   discovery  — try something new. New beans, new cafés, new countries.
--
-- One from each means the week always has a low-effort win, a skill to
-- practise and a reason to leave the house — rather than three variations
-- on the same ask, which is what random selection gives you often enough
-- to matter.
--
-- WHAT TO RUN AFTERWARDS: nothing, ever. `generate_challenges()` is on
-- pg_cron from here, and this file calls it once so the current week is
-- populated the moment you finish running it.
-- ============================================================

-- ---------- 1. what a challenge is now ----------
-- The editorial columns (title, tag, pattern, blurb) stay: a generated
-- challenge still needs a name and a picture. What is new is the rule.
alter table challenges add column if not exists kind      text;
alter table challenges add column if not exists goal      int  not null default 1;
alter table challenges add column if not exists param     text;
alter table challenges add column if not exists points    int  not null default 50;
alter table challenges add column if not exists cat       text;
alter table challenges add column if not exists starts_at timestamptz;
alter table challenges add column if not exists ends_at   timestamptz;

-- Rows seeded before this migration have no window, so they are never
-- "active" and quietly stop appearing. They are left in place rather than
-- deleted because challenge_entries/challenge_joins still point at them.
create index if not exists challenges_window_idx on challenges (starts_at, ends_at);

-- ---------- 2. the templates the generator draws from ----------
-- A table and not a hardcoded list, so a new challenge idea is one
-- INSERT and never a code deploy. Add one and it enters the rotation on
-- its own the next time its category comes round.
create table if not exists challenge_templates (
  code    text primary key,
  cat     text not null check (cat in ('habit','craft','discovery')),
  kind    text not null,
  goal    int  not null,
  param   text,
  title   text not null,
  blurb   text not null,
  tag     text not null,
  pattern text,                       -- which cup the card draws
  points  int  not null,
  active  bool not null default true
);

alter table challenge_templates enable row level security;
drop policy if exists "templates are public" on challenge_templates;
create policy "templates are public" on challenge_templates for select using (true);

insert into challenge_templates (code,cat,kind,goal,param,title,blurb,tag,pattern,points) values
  -- ----- habit: show up -----
  ('h_daily5','habit','days',5,null,
   'Five Mornings','Log a coffee on five different days this week.','#ritual','heart',50),
  ('h_daily7','habit','days',7,null,
   'Seven for Seven','A coffee every single day this week. No days off.','#ritual','rosetta',85),
  ('h_early','habit','hour_before',3,'8',
   'Before Eight','Three coffees logged before 8am — the quiet ones.','#earlybird','tulip',55),
  ('h_weekend','habit','weekend',2,null,
   'Both Days','Pour on Saturday and again on Sunday.','#weekend','wave',40),
  ('h_late','habit','hour_after',2,'20',
   'Nightcap','Two coffees after 8pm. Decaf counts — nobody is judging.','#latenight','abstract',40),
  ('h_ten','habit','pours',10,null,
   'Ten Cups','Ten coffees logged before the week is out.','#volume','swan',65),

  -- ----- craft: do it well -----
  ('c_rosetta','craft','pattern',3,'rosetta',
   'Rosetta Week','Pour three rosettas. Wobble the jug, drag through.','#rosetta','rosetta',60),
  ('c_heart','craft','pattern',3,'heart',
   'Start with a Heart','Three hearts. The one everything else is built on.','#heart','heart',50),
  ('c_tulip','craft','pattern',3,'tulip',
   'Tulip Season','Three tulips — stack at least two pushes into each.','#tulip','tulip',65),
  ('c_swan','craft','pattern',2,'swan',
   'The Swan','Two swans. Nobody said it would be quick.','#swan','swan',90),
  ('c_recipe','craft','recipe',4,null,
   'Show Your Work','Four pours with dose, yield and time all filled in.','#recipe','abstract',70),
  ('c_art','craft','art',5,null,
   'Free Pour Five','Five latte-art pours, any pattern you like.','#latteart','phoenix',55),
  ('c_caption','craft','caption',4,null,
   'Say Something','Four pours with a real note on how it went.','#notes','wave',45),

  -- ----- discovery: try something new -----
  ('d_beans3','discovery','beans',3,null,
   'Three Bags','Brew three different coffees this week.','#beans','abstract',60),
  ('d_newbean','discovery','new_bean',1,null,
   'New Territory','Log one coffee you have never logged before.','#newbean','tulip',50),
  ('d_drinks','discovery','drinks',4,null,
   'Round the Menu','Four different drinks. Yes, the filter counts.','#menu','wave',55),
  ('d_cafes','discovery','cafes',2,null,
   'Out and Out','Coffee at two different cafés. Leave the house.','#cafes','heart',70),
  ('d_countries','discovery','countries',3,null,
   'Passport','Beans grown in three different countries.','#origin','phoenix',75),
  ('d_roasters','discovery','roasters',3,null,
   'Three Roasters','Coffee from three different roasters.','#roasters','rosetta',65),
  ('d_milks','discovery','milks',3,null,
   'Milk Run','Three different milks. Oat, whole, whatever else.','#milk','swan',45),
  ('d_comments','discovery','comments',5,null,
   'Good Company','Leave five comments on other people''s coffee.','#community','heart',45)
on conflict (code) do update set
  cat=excluded.cat, kind=excluded.kind, goal=excluded.goal, param=excluded.param,
  title=excluded.title, blurb=excluded.blurb, tag=excluded.tag,
  pattern=excluded.pattern, points=excluded.points;

-- ---------- 3. finishing one is an event, not a count ----------
-- Everything else in Crema is counted on read and never stored. This is
-- the exception, and deliberately: a challenge is only winnable inside
-- its window, and posts can be edited or deleted long after it closes.
-- Recomputing "did they finish Rosetta Week" next March would give a
-- different answer than the one the person was told in July. So the
-- moment they cross the line is written down.
--
-- While the challenge is still live it stays honest: delete the pour and
-- the completion goes with it (see challenge_check below). Once the
-- window shuts, what you earned is yours.
create table if not exists challenge_completions (
  user_id      uuid not null references profiles on delete cascade,
  challenge_id text not null references challenges on delete cascade,
  points       int  not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, challenge_id)
);
create index if not exists completions_user_idx on challenge_completions (user_id);

alter table challenge_completions enable row level security;
drop policy if exists "completions are public"  on challenge_completions;
drop policy if exists "completions are earned"  on challenge_completions;
-- Public so a profile can show someone's badges. Nobody can write one:
-- there is no insert or update policy at all, and the only thing that
-- creates a row is challenge_check(), which is SECURITY DEFINER.
create policy "completions are public" on challenge_completions for select using (true);

-- ---------- 4. which local day a pour belongs to ----------
-- "Before 8am" and "five different days" are questions about the user's
-- morning, not about UTC. profiles.tz_offset is minutes east of UTC,
-- kept fresh by the client (src/data/profiles.js).
alter table profiles add column if not exists tz_offset int not null default 0;

create or replace function user_tz(uid uuid) returns int
language sql stable as $$
  select coalesce((select tz_offset from profiles where id = uid), 0);
$$;

-- The wall-clock time a pour happened for the person who made it.
--
-- The `at time zone 'UTC'` is not decoration. Casting a timestamptz to a
-- date, or pulling an hour out of one, resolves it in the SESSION's
-- TimeZone — so `created_at + offset` was really "the server's idea of
-- local, plus the user's offset", i.e. the offset applied twice. On
-- Supabase the server runs UTC and the two agree by luck; on a local
-- Postgres set to Europe/Berlin every date was a day out. Pinning to UTC
-- first makes the answer depend only on the user's own offset, which is
-- the only thing that should decide whose morning a coffee belongs to.
create or replace function local_ts(at timestamptz, tz int) returns timestamp
language sql immutable as $$
  select (at at time zone 'UTC') + make_interval(mins => tz);
$$;

-- ---------- 5. the rule engine ----------
-- One function, one switch, one number: how far is this user through
-- this challenge. Everything the UI shows and every point awarded comes
-- from here, so the progress bar and the reward can never disagree.
create or replace function challenge_progress(uid uuid, cid text)
returns int language plpgsql stable security definer set search_path = public as $$
declare
  c challenges%rowtype;
  tz int;
  n  int := 0;
begin
  select * into c from challenges where id = cid;
  if not found or c.kind is null or c.starts_at is null then return 0; end if;
  tz := user_tz(uid);

  case c.kind

    -- distinct local days with at least one pour
    when 'days' then
      select count(distinct (local_ts(p.created_at, tz))::date) into n
        from posts p where p.user_id = uid
         and p.created_at >= c.starts_at and p.created_at < c.ends_at;

    -- distinct local days with a pour before/after a local hour.
    --
    -- The 4am floor is what makes "Before Eight" mean an early morning
    -- rather than "any time before 8", which a 00:30 coffee also
    -- satisfies. Someone still up at half past midnight is having a
    -- nightcap, not beating the sunrise, and crediting them for it would
    -- make the challenge read as broken to the person who actually got
    -- up early.
    when 'hour_before' then
      select count(distinct (local_ts(p.created_at, tz))::date) into n
        from posts p where p.user_id = uid
         and p.created_at >= c.starts_at and p.created_at < c.ends_at
         and extract(hour from (local_ts(p.created_at, tz))) < c.param::int
         and extract(hour from (local_ts(p.created_at, tz))) >= 4;
    when 'hour_after' then
      select count(distinct (local_ts(p.created_at, tz))::date) into n
        from posts p where p.user_id = uid
         and p.created_at >= c.starts_at and p.created_at < c.ends_at
         and extract(hour from (local_ts(p.created_at, tz))) >= c.param::int;

    -- both weekend days (0 = Sunday, 6 = Saturday)
    when 'weekend' then
      select count(distinct extract(dow from (local_ts(p.created_at, tz)))) into n
        from posts p where p.user_id = uid
         and p.created_at >= c.starts_at and p.created_at < c.ends_at
         and extract(dow from (local_ts(p.created_at, tz))) in (0, 6);

    when 'pours' then
      select count(*) into n from posts p where p.user_id = uid
         and p.created_at >= c.starts_at and p.created_at < c.ends_at;

    when 'pattern' then
      select count(*) into n from posts p where p.user_id = uid
         and p.created_at >= c.starts_at and p.created_at < c.ends_at
         and p.art and lower(p.pattern) = lower(c.param);

    when 'art' then
      select count(*) into n from posts p where p.user_id = uid
         and p.created_at >= c.starts_at and p.created_at < c.ends_at and p.art;

    -- a recipe someone else could actually follow
    when 'recipe' then
      select count(*) into n from posts p where p.user_id = uid
         and p.created_at >= c.starts_at and p.created_at < c.ends_at
         and coalesce(btrim(p.recipe->>'dose'),  '') <> ''
         and coalesce(btrim(p.recipe->>'yield'), '') <> ''
         and coalesce(btrim(p.recipe->>'time'),  '') <> '';

    when 'caption' then
      select count(*) into n from posts p where p.user_id = uid
         and p.created_at >= c.starts_at and p.created_at < c.ends_at
         and length(btrim(coalesce(p.caption, ''))) >= 20;

    when 'drinks' then
      select count(distinct lower(btrim(p.drink))) into n
        from posts p where p.user_id = uid
         and p.created_at >= c.starts_at and p.created_at < c.ends_at
         and coalesce(btrim(p.drink), '') <> '';

    when 'beans' then
      select count(distinct lower(btrim(p.recipe->>'bean'))) into n
        from posts p where p.user_id = uid
         and p.created_at >= c.starts_at and p.created_at < c.ends_at
         and coalesce(btrim(p.recipe->>'bean'), '') <> '';

    when 'milks' then
      select count(distinct lower(btrim(p.recipe->>'milk'))) into n
        from posts p where p.user_id = uid
         and p.created_at >= c.starts_at and p.created_at < c.ends_at
         and coalesce(btrim(p.recipe->>'milk'), '') <> '';

    when 'cafes' then
      select count(distinct p.cafe_id) into n
        from posts p where p.user_id = uid
         and p.created_at >= c.starts_at and p.created_at < c.ends_at
         and p.cafe_id is not null;

    -- beans the catalog knows the origin of; unknown beans simply don't
    -- count rather than counting as a country called null
    when 'countries' then
      select count(distinct b.country) into n
        from posts p join beans b on lower(b.name) = lower(btrim(p.recipe->>'bean'))
       where p.user_id = uid
         and p.created_at >= c.starts_at and p.created_at < c.ends_at
         and b.country is not null;

    when 'roasters' then
      select count(distinct b.roaster) into n
        from posts p join beans b on lower(b.name) = lower(btrim(p.recipe->>'bean'))
       where p.user_id = uid
         and p.created_at >= c.starts_at and p.created_at < c.ends_at
         and coalesce(btrim(b.roaster), '') <> '';

    -- a bean logged this week that they had never logged before it began
    when 'new_bean' then
      select count(distinct lower(btrim(p.recipe->>'bean'))) into n
        from posts p where p.user_id = uid
         and p.created_at >= c.starts_at and p.created_at < c.ends_at
         and coalesce(btrim(p.recipe->>'bean'), '') <> ''
         and not exists (
           select 1 from posts q where q.user_id = uid and q.created_at < c.starts_at
              and lower(btrim(q.recipe->>'bean')) = lower(btrim(p.recipe->>'bean')));

    -- comments left on OTHER people's coffee. Talking to yourself does
    -- not count, and neither do comments you later deleted.
    when 'comments' then
      select count(*) into n
        from comments cm join posts p on p.id = cm.post_id
       where cm.user_id = uid and p.user_id is distinct from uid
         and cm.created_at >= c.starts_at and cm.created_at < c.ends_at;

    else n := 0;
  end case;

  return coalesce(n, 0);
end $$;

-- ---------- 6. crossing the line ----------
-- Called by triggers on the tables a challenge can be moved by. Checks
-- only the challenges that are live right now, so it is three cheap
-- counts and never a scan of history.
create or replace function challenge_check(uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c record; prog int;
begin
  if uid is null then return; end if;
  for c in select * from challenges
            where starts_at <= now() and ends_at > now() and kind is not null
  loop
    prog := challenge_progress(uid, c.id);

    if prog >= c.goal then
      insert into challenge_completions (user_id, challenge_id, points)
      values (uid, c.id, c.points)
      on conflict (user_id, challenge_id) do nothing;

      -- Only announce it if the insert above was the one that landed.
      if found then
        insert into notifications (user_id, actor_id, type, challenge_id, body)
        values (uid, null, 'challenge', c.id,
                'Challenge complete: ' || c.title || ' · +' || c.points || ' points');
      end if;

    else
      -- Still live and no longer qualifying — they deleted or edited the
      -- pour that got them there. Take it back while the week is open.
      delete from challenge_completions
       where user_id = uid and challenge_id = c.id;
    end if;
  end loop;
end $$;

create or replace function trg_challenge_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform challenge_check(coalesce(new.user_id, old.user_id));
  return coalesce(new, old);
end $$;

drop trigger if exists posts_challenge    on posts;
drop trigger if exists comments_challenge on comments;
create trigger posts_challenge after insert or update or delete on posts
  for each row execute function trg_challenge_check();
create trigger comments_challenge after insert or delete on comments
  for each row execute function trg_challenge_check();

-- ---------- 7. challenges pay points ----------
-- Rewritten from step-1.14 with one term added. Everything else is
-- unchanged, so scores do not move for anyone who has not finished a
-- challenge.
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
                 where user_id = uid), 0);
$$;

-- Finishing a challenge has to move the score immediately, not at the
-- next unrelated recalculation.
drop trigger if exists completions_score on challenge_completions;
create trigger completions_score after insert or delete on challenge_completions
  for each row execute function trg_score_owner();

-- ---------- 8. the generator ----------
-- Monday to Monday, one template per category, chosen by counting weeks.
--
-- The pick is deterministic — week number modulo the number of templates
-- in that category — which means it is reproducible, testable, and walks
-- the whole catalogue before it repeats anything. A random pick would
-- serve the same challenge two weeks running often enough to be noticed.
-- The three categories are offset against each other so the *combination*
-- keeps changing even as each list cycles.
create or replace function generate_challenges(at timestamptz default now())
returns int language plpgsql security definer set search_path = public as $$
declare
  wk_start timestamptz := date_trunc('week', at);           -- Postgres weeks start Monday
  wk_end   timestamptz := date_trunc('week', at) + interval '7 days';
  wk_num   int := floor(extract(epoch from date_trunc('week', at)) / 604800)::int;
  cats     text[] := array['habit','craft','discovery'];
  offs     int[]  := array[0, 2, 5];                        -- so the trio varies, not just each list
  made     int := 0;
  i        int;
  t        record;
  cid      text;
begin
  for i in 1 .. array_length(cats, 1) loop
    -- Explicit columns, not `select *`: the ranking subquery carries two
    -- window columns of its own, and a %rowtype target would choke on
    -- the extra attributes.
    select ranked.kind, ranked.goal, ranked.param, ranked.title, ranked.blurb,
           ranked.tag, ranked.pattern, ranked.points
      into t
      from (
      select tt.*, row_number() over (order by tt.code) - 1 as ix,
             count(*) over () as total
        from challenge_templates tt
       where tt.cat = cats[i] and tt.active
    ) ranked
     where ranked.ix = (wk_num + offs[i]) % ranked.total;

    continue when not found;

    cid := 'w' || to_char(wk_start, 'IYYY-IW') || '-' || cats[i];

    insert into challenges (id, title, tag, pattern, blurb, sort,
                            kind, goal, param, points, cat, starts_at, ends_at, ends, participants)
    values (cid, t.title, t.tag, t.pattern, t.blurb, i,
            t.kind, t.goal, t.param, t.points, cats[i], wk_start, wk_end, '7d', 0)
    on conflict (id) do update set
      -- Re-running mid-week must not move the goalposts under someone who
      -- is halfway through, so the rule itself is left alone; only the
      -- copy is refreshed.
      title = excluded.title, blurb = excluded.blurb, tag = excluded.tag,
      pattern = excluded.pattern, sort = excluded.sort;

    made := made + 1;
  end loop;
  return made;
end $$;

-- ---------- 9. what the app asks for ----------
-- One round trip: the three live challenges, this user's progress
-- through each, and whether it is already banked. Uses auth.uid()
-- internally, so it cannot be pointed at anyone else.
create or replace function my_challenges()
returns table (
  id text, cat text, kind text, goal int, param text, title text, blurb text,
  tag text, pattern text, points int, starts_at timestamptz, ends_at timestamptz,
  progress int, done bool
)
language sql stable security definer set search_path = public as $$
  select c.id, c.cat, c.kind, c.goal, c.param, c.title, c.blurb,
         c.tag, c.pattern, c.points, c.starts_at, c.ends_at,
         challenge_progress(auth.uid(), c.id),
         exists (select 1 from challenge_completions cc
                  where cc.user_id = auth.uid() and cc.challenge_id = c.id)
    from challenges c
   where c.starts_at <= now() and c.ends_at > now() and c.kind is not null
   order by c.sort;
$$;

-- What someone has won, for their profile. Public by design — the
-- completions themselves are.
create or replace function challenge_wins(uid uuid)
returns table (id text, title text, tag text, pattern text, points int, completed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.title, c.tag, c.pattern, cc.points, cc.completed_at
    from challenge_completions cc join challenges c on c.id = cc.challenge_id
   where cc.user_id = uid
   order by cc.completed_at desc;
$$;

-- ---------- 10. the RPC surface ----------
-- Same reasoning as step-1.16: PostgREST publishes every function in
-- `public`, and most of these are SECURITY DEFINER. Only the two the app
-- actually calls stay reachable, and both take their identity from
-- auth.uid() or return public data.
revoke all on function challenge_progress(uuid, text)  from public, anon, authenticated;
revoke all on function challenge_check(uuid)           from public, anon, authenticated;
revoke all on function trg_challenge_check()           from public, anon, authenticated;
revoke all on function generate_challenges(timestamptz) from public, anon, authenticated;
revoke all on function user_tz(uuid)                   from public, anon, authenticated;
revoke all on function user_points(uuid)               from public, anon, authenticated;

revoke all on function my_challenges()      from public, anon;
revoke all on function challenge_wins(uuid) from public, anon;
grant execute on function my_challenges()      to authenticated;
grant execute on function challenge_wins(uuid) to authenticated;

-- ---------- 11. it runs itself ----------
-- 00:05 every Monday, five minutes after the week the generator is about
-- to describe has already begun — so `date_trunc('week', now())` is
-- unambiguously the new week and never the old one.
do $$
begin
  perform cron.unschedule('crema-challenges');
exception when others then null;
end $$;

select cron.schedule('crema-challenges', '5 0 * * 1', $$ select generate_challenges(); $$);

-- A safety net, hourly: if the weekly job was missed (database paused,
-- extension disabled, migration run mid-week) the current week still
-- fills in by itself within the hour. Idempotent, so on a normal week
-- this does nothing at all.
--
-- The same pass re-checks anyone who has poured since the week began.
-- Triggers cover the normal case — you post, your progress moves — but
-- not the two edges where nobody posts anything: the moment a challenge
-- is first created (people may already qualify from earlier in the week)
-- and a `days`-style goal that ticks over at local midnight. Without
-- this, "Five Mornings" would only pay out on the next pour after the
-- fifth, which is a day late and reads as broken.
create or replace function challenge_sweep()
returns int language plpgsql security definer set search_path = public as $$
declare uid uuid; n int := 0;
begin
  for uid in
    select distinct p.user_id from posts p
      join challenges c on c.starts_at <= now() and c.ends_at > now() and c.kind is not null
     where p.created_at >= c.starts_at
    union
    select distinct cm.user_id from comments cm
      join challenges c on c.starts_at <= now() and c.ends_at > now() and c.kind is not null
     where cm.created_at >= c.starts_at
  loop
    perform challenge_check(uid);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function challenge_sweep() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('crema-challenges-catchup');
exception when others then null;
end $$;

select cron.schedule('crema-challenges-catchup', '7 * * * *',
  $$ select generate_challenges(); select challenge_sweep(); $$);

-- ---------- 12. the same timezone bug, in step 1.16 ----------
-- streak_at_risk() computes local days the way challenge_progress() used
-- to, so it carries the identical fault: `created_at + offset` cast to a
-- date resolves in the session's TimeZone, not UTC. It is correct on
-- Supabase only because that server runs UTC. Restated here through
-- local_ts() so it is correct because of what it says rather than where
-- it happens to run. Behaviour on the live database does not change.
create or replace function streak_at_risk(uid uuid, tz_min int)
returns int language plpgsql stable set search_path = public as $$
declare
  today date := local_ts(now(), tz_min)::date;
  days  int[];                      -- day indices: 0 = today, 1 = yesterday
  r     record;
  total int;
begin
  select coalesce(array_agg(distinct (today - local_ts(p.created_at, tz_min)::date)), '{}')
    into days
    from posts p
   where p.user_id = uid
     and p.created_at > now() - interval '400 days'
     and local_ts(p.created_at, tz_min)::date <= today;

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

revoke all on function streak_at_risk(uuid, int) from public, anon, authenticated;
revoke all on function local_ts(timestamptz, int) from public, anon, authenticated;

-- ---------- 13. start now, not next Monday ----------
select generate_challenges();
select challenge_sweep();
