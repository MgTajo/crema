-- ============================================================
-- Crema — a public today, a private circle, and follows you agree to
--
-- Run after step-1.14.sql. Re-runnable.
--
-- Three things land together because they are one idea: you decide who
-- sees your coffee.
--
--   1. posts.visibility — 'public' (anyone, and it can appear in Today)
--      or 'followers' (only people you have accepted).
--   2. follows.status — a follow is a request until the person accepts.
--   3. The select policy on posts enforces 1 using 2.
--
-- The important part is that (3) is a database rule, not a client one.
-- "Private" that is only a filter in the app is not private at all:
-- `posts` is reachable with the publishable key from any browser
-- console. If the policy is right, a private pour cannot be read by a
-- stranger even with a hand-written query.
-- ============================================================

-- ---------- 1. how visible a pour is ----------
-- Default 'public': every pour that exists today was posted under rules
-- where everything was public, and silently making them private would
-- rewrite what people already shared.
alter table posts add column if not exists visibility text not null default 'public';
alter table posts drop constraint if exists posts_visibility_known;
alter table posts add constraint posts_visibility_known
  check (visibility in ('public','followers'));

-- Today reads "public, newest first, since midnight", so it wants the
-- same shape as the feed index but visibility-first.
create index if not exists posts_public_recent_idx
  on posts (visibility, created_at desc);

-- ---------- 2. a follow is a request first ----------
-- Added with default 'accepted' so every follow that already exists
-- stays exactly as it is — nobody wakes up to a queue of people they
-- thought were already following them. New rows default to 'pending'
-- from here on.
alter table follows add column if not exists status text not null default 'accepted';
alter table follows alter column status set default 'pending';
alter table follows drop constraint if exists follows_status_known;
alter table follows add constraint follows_status_known
  check (status in ('pending','accepted'));

create index if not exists follows_pending_idx
  on follows (followee_id, created_at desc) where status = 'pending';

-- ---------- 3. who may read a pour ----------
-- The order of the branches is the cheap-first order: most posts are
-- public, so most reads never touch `follows` at all.
drop policy if exists "posts are readable by everyone" on posts;
drop policy if exists "posts are readable by their audience" on posts;
create policy "posts are readable by their audience"
  on posts for select using (
    visibility = 'public'
    or user_id = auth.uid()
    or exists (
      select 1 from follows f
       where f.followee_id = posts.user_id
         and f.follower_id = auth.uid()
         and f.status = 'accepted')
  );

-- ---------- follows: request, accept, walk away ----------
-- A pending row is nobody else's business: it says who asked to follow
-- whom and was not (yet) let in. Both parties can see it; everyone else
-- sees only accepted follows, which is what follower lists have always
-- shown.
drop policy if exists "follows are public"                    on follows;
drop policy if exists "follows are visible to their parties"  on follows;
create policy "follows are visible to their parties"
  on follows for select using (
    status = 'accepted' or follower_id = auth.uid() or followee_id = auth.uid()
  );

-- You may ask, and asking is all you may do: `status = 'pending'` in the
-- WITH CHECK is what stops a client inserting itself as an accepted
-- follower and reading everyone's private pours.
drop policy if exists "users follow as themselves" on follows;
create policy "users follow as themselves"
  on follows for insert with check (follower_id = auth.uid() and status = 'pending');

-- Only the person being followed can accept, and accepting is the only
-- update they can make — a row cannot be moved to someone else, and
-- cannot go back to pending to fake a fresh request.
drop policy if exists "followees accept requests" on follows;
create policy "followees accept requests"
  on follows for update
  using (followee_id = auth.uid())
  with check (followee_id = auth.uid() and status = 'accepted');

-- Deleting covers three different human actions with one row operation:
-- unfollowing (follower), declining a request (followee), and removing
-- an existing follower (followee).
drop policy if exists "users unfollow their own" on follows;
drop policy if exists "either side can end a follow" on follows;
create policy "either side can end a follow"
  on follows for delete using (follower_id = auth.uid() or followee_id = auth.uid());

-- ---------- counts follow the same rule ----------
-- A pending request is not a follower. Without this the profile would
-- claim followers the person never agreed to.
create or replace view profile_counts
  with (security_invoker = true) as
  select pr.id as profile_id,
         (select count(*) from follows f
           where f.followee_id = pr.id and f.status = 'accepted') as follower_count,
         (select count(*) from follows f
           where f.follower_id = pr.id and f.status = 'accepted') as following_count,
         (select count(*) from posts p where p.user_id = pr.id)   as pour_count
  from profiles pr;

-- ---------- notifications ----------
-- A request and an acceptance are different events for different people,
-- so they are different rows going in opposite directions.
create or replace function notify_on_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- A row that arrives already accepted is a grandfathered or
  -- self-repairing follow, not a request; announce it the old way.
  if new.status = 'accepted' then
    insert into notifications (user_id, actor_id, type, body)
    values (new.followee_id, new.follower_id, 'follow', 'started following you');
  else
    insert into notifications (user_id, actor_id, type, body)
    values (new.followee_id, new.follower_id, 'follow_request', 'wants to follow you');
  end if;
  return new;
end $$;

-- The acceptance goes back to the person who asked — that is the whole
-- point of the round trip.
create or replace function notify_on_follow_accepted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status is distinct from 'accepted' and new.status = 'accepted' then
    insert into notifications (user_id, actor_id, type, body)
    values (new.follower_id, new.followee_id, 'follow', 'accepted your follow request');
    -- the request itself is answered; it should stop sitting in the
    -- followee's inbox looking like something still to do
    delete from notifications
     where type = 'follow_request'
       and user_id = new.followee_id
       and actor_id = new.follower_id;
  end if;
  return new;
end $$;

drop trigger if exists follows_notify          on follows;
drop trigger if exists follows_accept_notify   on follows;
create trigger follows_notify        after insert on follows
  for each row execute function notify_on_follow();
create trigger follows_accept_notify after update on follows
  for each row execute function notify_on_follow_accepted();

-- A declined request should not leave a notification behind either.
create or replace function notify_on_follow_gone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from notifications
   where type = 'follow_request'
     and user_id = old.followee_id
     and actor_id = old.follower_id;
  return old;
end $$;
drop trigger if exists follows_decline_notify on follows;
create trigger follows_decline_notify after delete on follows
  for each row execute function notify_on_follow_gone();

-- ---------- what to expect afterwards ----------
--   select visibility, count(*) from posts group by visibility;   -- all public
--   select status, count(*) from follows group by status;         -- all accepted
--   -- and, signed in as someone who follows nobody, this must return
--   -- zero rows rather than an error:
--   --   select id from posts where visibility = 'followers' and user_id <> auth.uid();
