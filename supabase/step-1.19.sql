-- ============================================================
-- Crema — step 1.19: reactions, mutual follows, mentions, and
-- reminders that are on to begin with
--
-- Run after step-1.18.sql. Re-runnable.
--
-- Four things, and only the first is a new table:
--
--   1. `reactions` — three named ways to say what you liked about a
--      pour, next to but entirely separate from the heart. They are
--      deliberately worth NOTHING: no points, no podium, no leaderboard,
--      no level. Nothing in step-1.9, 1.14, 1.17 or 1.18 reads this
--      table, and nothing here writes to `profiles.points`. That is the
--      whole design — a like is the currency, a reaction is a comment
--      you don't have to write.
--
--   2. Follows become mutual. Accepting someone's request now makes you
--      follow them back, and every follow that already exists is
--      reciprocated by the backfill at the bottom.
--
--   3. @mentions in comments notify the person named.
--
--   4. The reminder switches default to on, for new rows and existing
--      ones. This does NOT send anything to anyone who has not granted
--      notification permission in their browser or on their phone — it
--      only decides what happens once they have.
-- ============================================================

-- ============================================================
-- 1. REACTIONS
-- ============================================================
-- One row per (person, pour, kind), so the same person can say both
-- "lovely art" and "great spot" about one photo — that is the point of
-- having three of them rather than one with three values.
--
--   art   — the pour itself: the rosetta, the tulip, the swan
--   scene — where it was taken: the table, the light, the flowers
--   drink — the coffee: something you don't see every day
create table if not exists reactions (
  user_id    uuid references profiles on delete cascade,
  post_id    uuid references posts    on delete cascade,
  kind       text not null,
  created_at timestamptz default now(),
  primary key (user_id, post_id, kind)
);
alter table reactions drop constraint if exists reactions_kind_known;
alter table reactions add constraint reactions_kind_known
  check (kind in ('art','scene','drink'));

-- The feed asks "every reaction on these twelve posts"; the index makes
-- that a lookup rather than a scan.
create index if not exists reactions_post_idx on reactions (post_id);

alter table reactions enable row level security;

-- Same shape as `likes`: the counts are visible to everyone, and you may
-- only add or remove your own.
drop policy if exists "reactions are public"           on reactions;
drop policy if exists "users react as themselves"      on reactions;
drop policy if exists "users remove their reactions"   on reactions;
create policy "reactions are public"
  on reactions for select using (true);
-- No reacting to your own pour, for the same reason step-1.10 stopped
-- self-likes: the client hides the buttons, but the client was never the
-- protection. This one is not about points — there are none — it is
-- about a count that means "other people said so".
create policy "users react as themselves"
  on reactions for insert with check (
    auth.uid() = user_id
    and not exists (
      select 1 from posts p
       where p.id = reactions.post_id
         and p.user_id = auth.uid()
    )
  );
create policy "users remove their reactions"
  on reactions for delete using (auth.uid() = user_id);

grant select on reactions to anon, authenticated;
grant insert, delete on reactions to authenticated;

-- Reactions reach the inbox the same way likes do. They ride the push
-- trigger on `notifications` (step-1.16) for free, and they are collapsed
-- per (type, actor) there, so three reactions from one person on one
-- morning are one line on the phone.
create or replace function notify_on_reaction() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid; phrase text;
begin
  select user_id into owner from posts where id = new.post_id;
  if owner is null or owner = new.user_id then return new; end if;   -- no self-notify
  phrase := case new.kind
    when 'art'   then 'loved your latte art'
    when 'scene' then 'loved where you had it'
    when 'drink' then 'loved your choice of coffee'
    else 'reacted to your pour' end;
  insert into notifications (user_id, actor_id, type, post_id, body)
  values (owner, new.user_id, 'reaction', new.post_id, phrase);
  return new;
end $$;

drop trigger if exists reactions_notify on reactions;
create trigger reactions_notify after insert on reactions
  for each row execute function notify_on_reaction();

-- ============================================================
-- 2. A FOLLOW GOES BOTH WAYS
-- ============================================================
-- Accepting someone is now agreeing to a mutual relationship rather than
-- granting a one-way audience: they see your pours and you see theirs.
--
-- The reciprocal row is written here rather than in the client for the
-- ordinary reason — a client that could insert an `accepted` follow could
-- insert one for anybody, and step-1.15's insert policy exists precisely
-- to stop that. So the policy stays as strict as it was, and the only
-- thing allowed to create an accepted follow is this trigger.
create or replace function follows_reciprocate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status is distinct from 'accepted' and new.status = 'accepted' then
    -- Tell notify_on_follow() to stay quiet: the person who asked has
    -- just been told "accepted your follow request", and "started
    -- following you" about the very same handshake is the same news
    -- twice. Transaction-local, and cleared as soon as the insert's
    -- AFTER triggers have run.
    perform set_config('crema.reciprocal','on',true);

    insert into follows (follower_id, followee_id, status)
    values (new.followee_id, new.follower_id, 'accepted')
    on conflict (follower_id, followee_id) do update
      set status = 'accepted'
      -- The WHERE is what ends the recursion: this UPDATE fires this
      -- same trigger again, and on the second pass the other side is
      -- already accepted, so no row changes and no trigger fires.
      where follows.status is distinct from 'accepted';

    perform set_config('crema.reciprocal','',true);
  end if;
  return new;
end $$;

drop trigger if exists follows_reciprocate on follows;
create trigger follows_reciprocate after update on follows
  for each row execute function follows_reciprocate();

-- Unchanged except for the guard above.
create or replace function notify_on_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('crema.reciprocal', true), '') = 'on' then
    return new;                       -- the follow-back; already announced
  end if;
  if new.status = 'accepted' then
    insert into notifications (user_id, actor_id, type, body)
    values (new.followee_id, new.follower_id, 'follow', 'started following you');
  else
    insert into notifications (user_id, actor_id, type, body)
    values (new.followee_id, new.follower_id, 'follow_request', 'wants to follow you');
  end if;
  return new;
end $$;

-- ---------- the accounts that already exist ----------
-- Every accepted follow gets its mirror, and any request that was
-- pending in the other direction is granted, because the person it was
-- waiting on has already accepted the same relationship from their side.
--
-- A function rather than two loose statements so it can be run again
-- later, and so local-test/step-1.19-test.sql can call the same code the
-- migration calls rather than a copy of it that might drift.
--
-- Triggers off for the duration: these rows describe follows that are
-- months old in app-time, and announcing them would fill every inbox in
-- Crema with news of things everyone already knows.
create or replace function follows_backfill_mutual() returns void
language plpgsql security definer set search_path = public as $$
begin
  alter table follows disable trigger user;

  insert into follows (follower_id, followee_id, status, created_at)
  select f.followee_id, f.follower_id, 'accepted', now()
    from follows f
   where f.status = 'accepted'
     and f.follower_id <> f.followee_id
  on conflict (follower_id, followee_id) do nothing;

  update follows g
     set status = 'accepted'
   where g.status is distinct from 'accepted'
     and exists (
       select 1 from follows f
        where f.follower_id = g.followee_id
          and f.followee_id = g.follower_id
          and f.status = 'accepted');

  alter table follows enable trigger user;
exception when others then
  -- Never leave the table with its triggers off.
  alter table follows enable trigger user;
  raise;
end $$;

-- Nobody but the migration and the tests: re-running this is harmless,
-- but it is not something a browser should be able to ask for.
revoke all on function follows_backfill_mutual() from public, anon, authenticated;

select follows_backfill_mutual();

-- ============================================================
-- 3. @MENTIONS
-- ============================================================
-- The comment body is the only place a mention can come from, and it is
-- parsed here rather than trusted from the client: a client that names
-- who to notify is a client that can notify anybody.
--
-- Capped at ten distinct handles per comment. A comment that names more
-- people than that is not a conversation.
create or replace function notify_on_mention() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select user_id into owner from posts where id = new.post_id;
  insert into notifications (user_id, actor_id, type, post_id, body)
  select p.id, new.user_id, 'mention', new.post_id, 'mentioned you in a comment'
    from (select distinct lower(m[1]) as h
            from regexp_matches(coalesce(new.body,''), '@([A-Za-z0-9_.]+)', 'g') m
           limit 10) t
    join profiles p on lower(p.handle) = t.h
   where p.id <> new.user_id                 -- naming yourself is not news
     and p.id is distinct from owner;        -- they already got "commented on your pour"
  return new;
end $$;

drop trigger if exists comments_mention_notify on comments;
create trigger comments_mention_notify after insert on comments
  for each row execute function notify_on_mention();

-- Mentions are looked up by handle, case-insensitively, on every comment.
create index if not exists profiles_handle_lower_idx on profiles (lower(handle));

-- ============================================================
-- 4. REMINDERS ARE ON TO BEGIN WITH
-- ============================================================
-- step-1.16 defaulted the streak nudge and the weekly recap to off, on
-- the reasoning that nobody should be signed up for something they
-- didn't ask for. In practice the switches sit behind two taps in
-- Settings, nobody finds them, and the reminder that makes a streak worth
-- keeping never fires for anyone.
--
-- Worth being exact about what this does and does not do: it does not
-- send anything. Web Push needs the browser's permission, which is still
-- only ever asked for from a tap on "Remind me" (see the comment in
-- src/ui/overlays.js). This decides what is sent once someone has said
-- yes — and "yes" should mean yes to the reminders, not to a second
-- settings hunt.
alter table profiles alter column notify_social set default true;
alter table profiles alter column notify_streak set default true;
alter table profiles alter column notify_digest set default true;

-- Existing rows too. Everyone currently holding `false` holds a default
-- nobody chose — the switches predate anyone finding them.
update profiles set notify_social = true where notify_social is not true;
update profiles set notify_streak = true where notify_streak is not true;
update profiles set notify_digest = true where notify_digest is not true;

-- ---------- what to expect afterwards ----------
--   -- every follow is mutual, so these two counts match:
--   select count(*) from follows where status='accepted';
--   select count(*) from follows a
--     where a.status='accepted' and exists (
--       select 1 from follows b where b.follower_id=a.followee_id
--         and b.followee_id=a.follower_id and b.status='accepted');
--
--   -- nobody is left opted out:
--   select count(*) from profiles
--    where not (notify_social and notify_streak and notify_digest);   -- 0
--
--   -- and reactions are reachable but pay nothing:
--   select kind, count(*) from reactions group by kind;
