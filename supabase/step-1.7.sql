-- ============================================================
-- Crema — step 1.7: moderation + abuse limits
--
-- The social tables themselves (follows, likes, saves, comments,
-- comment_likes, cafe_follows) already exist from schema.sql. This
-- adds the parts the roadmap calls out as launch blockers:
--
--   * reports  — the Report button currently shows a toast and does
--                nothing. Reviewers check this for UGC apps.
--   * blocks   — Apple's guidelines expect blocking in social apps.
--   * a rate limit on comments, the obvious spam surface.
--
-- Run after schema.sql. Idempotent.
-- ============================================================

-- ---------- reports ----------
create table if not exists reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles on delete cascade,
  -- exactly one target
  post_id     uuid references posts    on delete cascade,
  comment_id  uuid references comments on delete cascade,
  user_id     uuid references profiles on delete cascade,
  reason      text not null,
  note        text,
  status      text not null default 'open' check (status in ('open','reviewed','actioned','dismissed')),
  created_at  timestamptz default now(),
  constraint one_target check (num_nonnulls(post_id, comment_id, user_id) = 1)
);
create index if not exists reports_status_idx on reports (status, created_at desc);

-- ---------- blocks ----------
create table if not exists blocks (
  blocker_id uuid references profiles on delete cascade,
  blocked_id uuid references profiles on delete cascade,
  created_at timestamptz default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);

alter table reports enable row level security;
alter table blocks  enable row level security;

-- Reports: you may file one and see your own. You may NOT see anyone
-- else's, and you may not change one after filing — moderation happens
-- with the service role, off the client.
drop policy if exists "users file their own reports" on reports;
drop policy if exists "users read their own reports" on reports;
create policy "users file their own reports"
  on reports for insert with check (auth.uid() = reporter_id);
create policy "users read their own reports"
  on reports for select using (auth.uid() = reporter_id);

-- Blocks are private to the blocker: the blocked user must not be able
-- to discover that they were blocked.
drop policy if exists "blocks are private"        on blocks;
drop policy if exists "users block as themselves" on blocks;
drop policy if exists "users unblock their own"   on blocks;
create policy "blocks are private"
  on blocks for select using (auth.uid() = blocker_id);
create policy "users block as themselves"
  on blocks for insert with check (auth.uid() = blocker_id);
create policy "users unblock their own"
  on blocks for delete using (auth.uid() = blocker_id);

-- ---------- comment rate limit ----------
-- Enforced in the database, because a client-side limit is decoration.
create or replace function check_comment_rate() returns trigger
language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  select count(*) into recent
    from comments
   where user_id = new.user_id
     and created_at > now() - interval '1 minute';
  if recent >= 10 then
    raise exception 'Slow down a moment — too many comments at once.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists comments_rate_limit on comments;
create trigger comments_rate_limit
  before insert on comments
  for each row execute function check_comment_rate();
