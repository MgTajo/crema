-- ============================================================
-- Crema — a rate limit in front of the two things that cost money.
--
-- Step 1b.1 of brain/13-infrastructure-plan.md. Comments have had a
-- limit since step-1.7; these are the two surfaces that never did.
--
-- WHY THESE TWO
--   * `upload-url` mints a presigned R2 PUT. Anybody with a free
--     account can call it in a loop, and every call is a writable URL
--     into the bucket that stays good for 15 minutes. The bytes are
--     billed to Cloudflare and the objects are not attached to a post,
--     so nothing ever cleans them up.
--   * `posts` is the feed. A loop there is not expensive, it is the
--     feed becoming unreadable for everyone else, and it fans out —
--     every pour writes a notification per accepted follower and a push
--     per device (D-2026-08-30-01).
--
-- WHY IN POSTGRES
-- A limit in the Edge Function is a limit on one instance's memory, and
-- instances are recycled and horizontal. A limit in the client is
-- decoration. The database is the only thing all callers share, and it
-- is the same argument step-1.7 made for comments.
--
-- THE NUMBERS, AND WHY THEY ARE THESE
-- The limits are set where a normal user cannot reach them and a script
-- cannot do damage. Measured behaviour: 13.6 pours/day across all of
-- Crema (brain/14-measurements.md, 2026-08-30), so a single account
-- doing ten in ten minutes is already far outside anything observed.
--   * uploads  15 / 5 min   — a Premium pour carries three photos
--                             (step-1.28), so this is five full pours
--                             back to back, retries included
--     uploads  60 / hour    — the sustained ceiling behind the burst
--   * posts    10 / 10 min
-- If one of these ever fires on a real person, the number is wrong and
-- it is the number that should move — not this file's existence.
--
-- Re-runnable: `create table if not exists`, `create or replace`,
-- `drop trigger if exists`. Loading it twice changes nothing.
-- ============================================================

-- ---------- the counter for uploads ----------
-- posts and comments can be counted from their own rows. A presigned
-- URL leaves no row anywhere — the whole point is that the bytes go
-- straight to R2 — so the grant has to be recorded on purpose or there
-- is nothing to count.
create table if not exists upload_grants (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists upload_grants_user_time
  on upload_grants (user_id, created_at desc);

-- RLS on and deliberately no policies: nothing reaches this table over
-- PostgREST, in either direction. Only claim_upload_slot() writes it,
-- and it is SECURITY DEFINER so it does not go through RLS at all.
alter table upload_grants enable row level security;

-- ---------- the upload limit ----------
-- Called by the upload-url Edge Function with the caller's own JWT,
-- BEFORE anything is signed. Raising here means no URL is ever minted,
-- which is the property worth having: a limit that fires after the
-- signature exists has already handed out the thing it was guarding.
create or replace function claim_upload_slot()
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  burst  int;
  hourly int;
begin
  -- No session, no slot. The function is reachable by `authenticated`
  -- only, but a JWT can be valid and carry no subject.
  if uid is null then
    raise exception 'Sign in to add a photo.' using errcode = 'P0001';
  end if;

  select count(*) into burst
    from upload_grants
   where user_id = uid and created_at > now() - interval '5 minutes';
  if burst >= 15 then
    raise exception 'Too many photos at once — wait a minute and try again.'
      using errcode = 'P0001';
  end if;

  select count(*) into hourly
    from upload_grants
   where user_id = uid and created_at > now() - interval '1 hour';
  if hourly >= 60 then
    raise exception 'Too many photos in the last hour — try again later.'
      using errcode = 'P0001';
  end if;

  insert into upload_grants (user_id) values (uid);

  -- Housekeeping, on the caller's own rows only, so it stays an index
  -- lookup. Nothing reads a grant older than an hour; keeping a day of
  -- them means the table can also answer "what happened last night"
  -- without becoming a log nobody prunes.
  delete from upload_grants
   where user_id = uid and created_at < now() - interval '1 day';
end $$;

-- Supabase's default privileges grant EXECUTE on every new function in
-- `public` to anon AND authenticated, and `revoke ... from public` does
-- not take that away — the roles hold their own grant rather than one
-- inherited through PUBLIC. This is the mod_record() mechanism
-- (migrations/20260829070000). anon must not be able to consume slots
-- on behalf of nobody, so it is revoked explicitly and re-granted only
-- to authenticated.
revoke all on function claim_upload_slot() from public, anon, authenticated;
grant execute on function claim_upload_slot() to authenticated;

-- ---------- the post limit ----------
-- Same shape as check_comment_rate() in step-1.7, deliberately: one
-- pattern for the whole codebase beats a cleverer second one.
create or replace function check_post_rate() returns trigger
language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  -- A window over `created_at` is only a limit if the caller cannot
  -- choose `created_at`. Over PostgREST they can: the column is
  -- insertable and the RLS policy checks who you are, not when you say
  -- it happened. Backdating a row to last week makes the count below
  -- zero and the limit decorative.
  --
  -- The real client never sends it — `rowOf()` in src/data/posts.js
  -- builds the insert body and `created_at` is not in it, so the
  -- database default is what every genuine pour has always used. So
  -- stamping it here takes nothing away from the app and takes the
  -- evasion away from everybody else.
  --
  -- Guarded on there being a session, because the one caller that
  -- legitimately picks its own timestamps is the test harness building
  -- fixtures across several mornings — it inserts as the owner with no
  -- `auth.uid()`, and its whole purpose is to place a pour at 05:00 on
  -- a chosen day.
  if auth.uid() is not null then
    new.created_at := now();
  end if;

  select count(*) into recent
    from posts
   where user_id = new.user_id
     and created_at > now() - interval '10 minutes';
  if recent >= 10 then
    raise exception 'Slow down a moment — too many pours at once.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke all on function check_post_rate() from public, anon, authenticated;

-- BEFORE INSERT, and before the triggers that fan out. Postgres fires
-- BEFORE triggers in name order, and `posts_daily_first`,
-- `posts_friend_notify` and the scoring triggers are all AFTER — so an
-- insert this rejects never reaches any of them and never writes a
-- notification.
drop trigger if exists posts_rate_limit on posts;
create trigger posts_rate_limit
  before insert on posts
  for each row execute function check_post_rate();
