-- ============================================================
-- Crema — schema + row level security (Roadmap step 1.2)
--
-- Run this once in the Supabase SQL editor, then run seed.sql.
-- Safe to re-run: every statement is idempotent.
--
-- Two rules hold throughout:
--   1. RLS is enabled on EVERY table. A table with RLS on and no
--      policy denies everything — failing closed is the point.
--   2. Reference tables (cafes/beans/challenges) are readable by
--      anyone and writable by nobody. Edit them in the dashboard,
--      which uses the service role and bypasses RLS.
-- ============================================================

-- ============================================================
-- REFERENCE DATA  (read-only to clients — seeded by seed.sql)
-- ============================================================

create table if not exists cafes (
  id        text primary key,
  name      text not null,
  area      text,
  city      text,
  spec      text,
  rating    numeric(2,1),
  followers int  default 0,
  promo     bool default false,
  img       text,                       -- bundled asset path today, R2 key from step 1.6
  color     text,
  blurb     text,
  hours     text,
  lat       double precision,           -- real coordinates: step 2.3 needs these for the native map
  lng       double precision,
  menu      jsonb,                      -- {beans:[], roaster, machine, milks:[]}
  sort      int  default 0
);

create table if not exists beans (
  name    text primary key,             -- the app keys beans by name (recipe.bean)
  roaster text not null,
  country text,                         -- roaster's country, drives the flag
  loc     text check (loc in ('DE','INT')),
  origin  text,
  roast   text,
  notes   text[] default '{}'
);

create table if not exists challenges (
  id           text primary key,
  title        text not null,
  tag          text,
  pattern      text,
  ends         text,
  participants int default 0,
  blurb        text,
  sort         int default 0
);

-- ============================================================
-- PEOPLE
-- ============================================================

create table if not exists profiles (
  id            uuid primary key references auth.users on delete cascade,
  handle        text unique not null,
  name          text not null,
  city          text,
  bio           text,
  avatar_color  text default '#8a5a30',
  level         int  default 1,
  machine_brand text,
  machine_model text,
  fav_drink     text,
  fav_milk      text,
  premium       bool default false,
  streak        int  default 0,
  created_at    timestamptz default now()
);

-- handles are case-insensitive in the UI (@YukiLatte === @yukilatte)
create unique index if not exists profiles_handle_lower_idx on profiles (lower(handle));

-- ============================================================
-- POSTS
-- ============================================================

create table if not exists posts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles on delete cascade,
  drink      text not null,
  art        bool default false,
  pattern    text,
  quality    numeric,
  image_key  text,                      -- R2 object key; null = generated SVG cup
  caption    text,
  cafe_id    text references cafes on delete set null,
  recipe     jsonb,                     -- sparse by design; see recipeRows() in ui/components.js
  created_at timestamptz default now()
);

-- the feed is "newest first, paginated on created_at"
create index if not exists posts_created_at_idx on posts (created_at desc);
create index if not exists posts_user_id_idx    on posts (user_id, created_at desc);
create index if not exists posts_cafe_id_idx    on posts (cafe_id);

-- ============================================================
-- SOCIAL GRAPH  (tables land here; wired up in step 1.7)
-- ============================================================

create table if not exists follows (
  follower_id uuid references profiles on delete cascade,
  followee_id uuid references profiles on delete cascade,
  created_at  timestamptz default now(),
  primary key (follower_id, followee_id),
  constraint no_self_follow check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on follows (followee_id);

create table if not exists likes (
  user_id    uuid references profiles on delete cascade,
  post_id    uuid references posts    on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, post_id)
);
create index if not exists likes_post_idx on likes (post_id);

-- saves are private: your collection is nobody else's business
create table if not exists saves (
  user_id    uuid references profiles on delete cascade,
  post_id    uuid references posts    on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, post_id)
);

create table if not exists cafe_follows (
  user_id    uuid references profiles on delete cascade,
  cafe_id    text references cafes    on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, cafe_id)
);

create table if not exists comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references posts    on delete cascade,
  user_id    uuid not null references profiles on delete cascade,
  body       text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz default now()
);
create index if not exists comments_post_idx on comments (post_id, created_at);

create table if not exists comment_likes (
  user_id    uuid references profiles on delete cascade,
  comment_id uuid references comments on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, comment_id)
);

-- ============================================================
-- NOTIFICATIONS  (rows generated by triggers in step 1.8)
-- ============================================================

create table if not exists notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles on delete cascade,  -- the recipient
  actor_id     uuid references profiles on delete cascade,           -- who caused it
  type         text not null,
  body         text,
  post_id      uuid references posts on delete cascade,
  cafe_id      text references cafes on delete cascade,
  challenge_id text references challenges on delete cascade,
  read         bool default false,
  created_at   timestamptz default now()
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table cafes         enable row level security;
alter table beans         enable row level security;
alter table challenges    enable row level security;
alter table profiles      enable row level security;
alter table posts         enable row level security;
alter table follows       enable row level security;
alter table likes         enable row level security;
alter table saves         enable row level security;
alter table cafe_follows  enable row level security;
alter table comments      enable row level security;
alter table comment_likes enable row level security;
alter table notifications enable row level security;

-- ---------- reference data: world-readable, client-unwritable ----------
drop policy if exists "cafes are public"      on cafes;
drop policy if exists "beans are public"      on beans;
drop policy if exists "challenges are public" on challenges;
create policy "cafes are public"      on cafes      for select using (true);
create policy "beans are public"      on beans      for select using (true);
create policy "challenges are public" on challenges for select using (true);
-- deliberately no insert/update/delete policies: writes are dashboard-only

-- ---------- profiles ----------
drop policy if exists "profiles are public"          on profiles;
drop policy if exists "users insert their own profile" on profiles;
drop policy if exists "users update their own profile" on profiles;
drop policy if exists "users delete their own profile" on profiles;
create policy "profiles are public"
  on profiles for select using (true);
create policy "users insert their own profile"
  on profiles for insert with check (auth.uid() = id);
create policy "users update their own profile"
  on profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "users delete their own profile"
  on profiles for delete using (auth.uid() = id);

-- ---------- posts ----------
drop policy if exists "posts are readable by everyone" on posts;
drop policy if exists "users insert their own posts"   on posts;
drop policy if exists "users update their own posts"   on posts;
drop policy if exists "users delete their own posts"   on posts;
create policy "posts are readable by everyone"
  on posts for select using (true);
create policy "users insert their own posts"
  on posts for insert with check (auth.uid() = user_id);
create policy "users update their own posts"
  on posts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users delete their own posts"
  on posts for delete using (auth.uid() = user_id);

-- ---------- follows ----------
drop policy if exists "follows are public"         on follows;
drop policy if exists "users follow as themselves" on follows;
drop policy if exists "users unfollow their own"   on follows;
create policy "follows are public"
  on follows for select using (true);
create policy "users follow as themselves"
  on follows for insert with check (auth.uid() = follower_id);
create policy "users unfollow their own"
  on follows for delete using (auth.uid() = follower_id);

-- ---------- likes (public: they are a visible count) ----------
drop policy if exists "likes are public"          on likes;
drop policy if exists "users like as themselves"  on likes;
drop policy if exists "users remove their likes"  on likes;
create policy "likes are public"
  on likes for select using (true);
create policy "users like as themselves"
  on likes for insert with check (auth.uid() = user_id);
create policy "users remove their likes"
  on likes for delete using (auth.uid() = user_id);

-- ---------- saves (PRIVATE: owner-only, like notifications) ----------
drop policy if exists "saves are private"          on saves;
drop policy if exists "users save as themselves"   on saves;
drop policy if exists "users remove their saves"   on saves;
create policy "saves are private"
  on saves for select using (auth.uid() = user_id);
create policy "users save as themselves"
  on saves for insert with check (auth.uid() = user_id);
create policy "users remove their saves"
  on saves for delete using (auth.uid() = user_id);

-- ---------- cafe follows ----------
drop policy if exists "cafe follows are public"        on cafe_follows;
drop policy if exists "users follow cafes as themselves" on cafe_follows;
drop policy if exists "users unfollow their own cafes"   on cafe_follows;
create policy "cafe follows are public"
  on cafe_follows for select using (true);
create policy "users follow cafes as themselves"
  on cafe_follows for insert with check (auth.uid() = user_id);
create policy "users unfollow their own cafes"
  on cafe_follows for delete using (auth.uid() = user_id);

-- ---------- comments ----------
drop policy if exists "comments are public"           on comments;
drop policy if exists "users insert their own comments" on comments;
drop policy if exists "users update their own comments" on comments;
drop policy if exists "users delete their own comments" on comments;
create policy "comments are public"
  on comments for select using (true);
create policy "users insert their own comments"
  on comments for insert with check (auth.uid() = user_id);
create policy "users update their own comments"
  on comments for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users delete their own comments"
  on comments for delete using (auth.uid() = user_id);

-- ---------- comment likes ----------
drop policy if exists "comment likes are public"         on comment_likes;
drop policy if exists "users like comments as themselves" on comment_likes;
drop policy if exists "users remove their comment likes"  on comment_likes;
create policy "comment likes are public"
  on comment_likes for select using (true);
create policy "users like comments as themselves"
  on comment_likes for insert with check (auth.uid() = user_id);
create policy "users remove their comment likes"
  on comment_likes for delete using (auth.uid() = user_id);

-- ---------- notifications: the one people get wrong ----------
drop policy if exists "notifications are private"        on notifications;
drop policy if exists "users update their notifications" on notifications;
drop policy if exists "users delete their notifications" on notifications;
create policy "notifications are private"
  on notifications for select using (auth.uid() = user_id);
create policy "users update their notifications"        -- marking as read
  on notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users delete their notifications"
  on notifications for delete using (auth.uid() = user_id);
-- no insert policy: only triggers (security definer, step 1.8) create these

-- ============================================================
-- COUNTS AS VIEWS
--
-- Views, not counter columns. Denormalize later, with triggers, if
-- this measurably hurts — premature counters cause drift bugs.
-- security_invoker = true makes the caller's RLS apply, so a view
-- can never be used to read around a policy.
-- ============================================================

create or replace view post_counts
  with (security_invoker = true) as
  select p.id as post_id,
         (select count(*) from likes    l where l.post_id = p.id) as like_count,
         (select count(*) from comments c where c.post_id = p.id) as comment_count
  from posts p;

create or replace view profile_counts
  with (security_invoker = true) as
  select pr.id as profile_id,
         (select count(*) from follows f where f.followee_id = pr.id) as follower_count,
         (select count(*) from follows f where f.follower_id = pr.id) as following_count,
         (select count(*) from posts   p where p.user_id     = pr.id) as pour_count
  from profiles pr;
