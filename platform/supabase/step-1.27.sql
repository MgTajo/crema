-- ============================================================
-- Crema — step 1.27: moderation that can actually do something
--
-- Today a report lands in `reports` and an email lands in the founder's
-- inbox (step-1.23), and there it stops: there is no way to hide, remove
-- or suspend anything, no record of what was decided, and nothing is
-- ever said to the person whose pour was reported. The report sheet
-- tells users "a person reads every report", which is true and useless.
--
-- Two reasons this is a floor rather than a nicety:
--
--   1. Crema stores user content and shows it to the public, which makes
--      it an online platform under the EU DSA. Article 19 exempts micro
--      and small enterprises from the Section 3 obligations — it does
--      NOT exempt Article 16 (notice and action) or Article 17
--      (statement of reasons). Acting "without undue delay" needs a
--      mechanism that exists.
--   2. Independently of law: you promised users a person acts. Make it
--      true.
--
-- The shape of it:
--
--   * `profiles.is_admin` — set by hand in the SQL editor, and by
--     nothing else. No client, admin or not, can grant it.
--   * hiding is reversible and is the default action; deleting is
--     available and records what it destroyed.
--   * every decision writes a `moderation_actions` row — who, what,
--     why, and the exact statement of reasons that was sent.
--   * the affected author is told, in their inbox, in words. The
--     reporter is told the report was decided.
--   * a statement of reasons is REQUIRED by the functions themselves.
--     An action with no explanation cannot be taken through this API,
--     which is the discipline written into the schema rather than into
--     a checklist someone has to remember.
--
-- What this deliberately does NOT do:
--
--   * It does not delete photos from R2. Objects in a bucket are not
--     rows and no cascade reaches them — so `mod_delete_post` copies the
--     image key into the audit row and the admin screen shows it. That
--     list is the R2 cleanup queue until account deletion exists.
--   * It does not gate likes, reactions or follows for a suspended
--     account, only posting and commenting. Those are the surfaces that
--     carry text and pictures; a suspended account tapping a heart is
--     not the problem this solves.
--
-- Run after step-1.26.sql. Idempotent.
-- ============================================================

-- ============================================================
-- 1. WHO IS AN ADMIN
-- ============================================================
alter table profiles add column if not exists is_admin bool not null default false;

-- Suspension is a time, not a flag: it expires on its own, so nobody has
-- to remember to lift it, and "suspended until Friday" is a sentence you
-- can put in a statement of reasons.
alter table profiles add column if not exists suspended_until  timestamptz;
alter table profiles add column if not exists suspended_reason text;

-- Both read auth.uid() by default, so a client cannot ask about somebody
-- else by passing an id it made up — and both are cheap enough to sit in
-- an RLS policy. security definer because `profiles` is world-readable
-- today but should not have to stay that way for these to work.
create or replace function is_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from profiles p where p.id = uid), false);
$$;

create or replace function is_suspended(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.suspended_until > now() from profiles p where p.id = uid), false);
$$;

revoke all on function is_admin(uuid)     from public;
revoke all on function is_suspended(uuid) from public;
grant execute on function is_admin(uuid)     to anon, authenticated;
grant execute on function is_suspended(uuid) to anon, authenticated;

-- ---------- the flag cannot be granted from a client ----------
-- Same idiom as posts_guard_edit (step-1.12): PostgREST always connects
-- as `authenticator` and switches role, so anything else — the SQL
-- editor, psql, a service-role call — is the operator and is left alone.
-- That is deliberate: granting the first admin has to be possible, and
-- the SQL editor is where it happens.
--
-- `crema.mod` is set transaction-locally by the mod_* functions below
-- and by nothing else. It is not reachable from PostgREST: set_config
-- lives in pg_catalog, not in the exposed schema.
create or replace function profiles_guard_admin()
returns trigger language plpgsql as $$
begin
  if session_user <> 'authenticator'
     or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role'
     or coalesce(current_setting('crema.mod', true),'') = 'ok' then
    return new;
  end if;
  -- Silently reverted rather than raised: "Save profile" sends the whole
  -- row, and an ordinary save must not fail because it echoed back a
  -- column it never meant to touch. Same reasoning as premium_guard.
  new.is_admin        := old.is_admin;
  new.suspended_until := old.suspended_until;
  new.suspended_reason:= old.suspended_reason;
  return new;
end $$;

drop trigger if exists profiles_guard_admin on profiles;
create trigger profiles_guard_admin
  before update on profiles
  for each row execute function profiles_guard_admin();

-- ============================================================
-- 2. MODERATION STATE ON CONTENT
-- ============================================================
-- Hidden, not deleted: reversible, and the row is still there to be
-- looked at when someone appeals. `hidden_at is null` is the normal
-- state and is what every read filters on.
alter table posts    add column if not exists hidden_at timestamptz;
alter table posts    add column if not exists hidden_by uuid references profiles on delete set null;
alter table comments add column if not exists hidden_at timestamptz;
alter table comments add column if not exists hidden_by uuid references profiles on delete set null;

create index if not exists posts_hidden_idx    on posts (hidden_at)    where hidden_at is not null;
create index if not exists comments_hidden_idx on comments (hidden_at) where hidden_at is not null;

-- ---------- the author cannot un-hide their own pour ----------
-- posts_guard_edit already bounds what an end user's UPDATE may do
-- (step-1.12). It gets two more rules and one more way out: the mod_*
-- functions run through PostgREST too, so without the `crema.mod`
-- escape the 36-hour edit window would stop a moderator hiding anything
-- posted the day before yesterday.
create or replace function posts_guard_edit()
returns trigger
language plpgsql
as $$
begin
  -- Moderation is not an edit.
  if coalesce(current_setting('crema.mod', true),'') = 'ok' then
    return new;
  end if;

  -- Maintenance is not an edit either. migrate-base64-images.mjs rewrites
  -- image_key on purpose, with the service key, and the SQL editor runs
  -- as the owner — this guard exists to bound what end users can do, not
  -- to fence off the operator.
  -- PostgREST always connects as `authenticator` and then switches role;
  -- anything else (SQL editor, psql, a cron job) isn't an API request.
  if session_user <> 'authenticator'
     or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role' then
    return new;
  end if;

  -- Ownership and identity: an update never re-homes a post.
  if new.user_id is distinct from old.user_id then
    raise exception 'a post cannot change author';
  end if;
  if new.id is distinct from old.id then
    raise exception 'a post cannot change id';
  end if;

  -- The photo is the evidence; the text around it is the claim. Swapping
  -- the image after people have liked it would make likes meaningless.
  if new.image_key is distinct from old.image_key then
    raise exception 'a post''s photo cannot be changed';
  end if;

  -- created_at is what the edit window is measured against, so it is the
  -- one field an attacker would want to move first.
  if new.created_at is distinct from old.created_at then
    raise exception 'a post cannot change its timestamp';
  end if;

  -- Moderation state belongs to the moderator. Without this the author
  -- could PATCH hidden_at back to null and put the pour straight back on
  -- the feed — their own update policy would allow it.
  if new.hidden_at is distinct from old.hidden_at
     or new.hidden_by is distinct from old.hidden_by then
    raise exception 'moderation state cannot be changed here';
  end if;

  -- The edit window. The client's rule is the user's local calendar day;
  -- the database can't know that timezone, so it enforces a slightly
  -- wider backstop instead of second-guessing it. Anything the client
  -- legitimately allows falls inside 36 hours; anything a week old does
  -- not. The narrow rule is the UI's, this is the ceiling.
  if old.created_at < now() - interval '36 hours' then
    raise exception 'a post can only be edited on the day it was posted';
  end if;

  -- Stamped here, never by the client: a marker the author can set is a
  -- marker the author can clear.
  new.edited_at := now();
  return new;
end;
$$;

-- Comments had no guard at all, because until now there was nothing on a
-- comment row worth guarding. There is now.
create or replace function comments_guard_edit()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('crema.mod', true),'') = 'ok'
     or session_user <> 'authenticator'
     or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role' then
    return new;
  end if;
  if new.hidden_at is distinct from old.hidden_at
     or new.hidden_by is distinct from old.hidden_by then
    raise exception 'moderation state cannot be changed here';
  end if;
  return new;
end $$;

drop trigger if exists comments_guard_edit on comments;
create trigger comments_guard_edit
  before update on comments
  for each row execute function comments_guard_edit();

-- ============================================================
-- 3. WHO SEES HIDDEN CONTENT
-- ============================================================
-- Cheap-first, exactly like the visibility policy it extends: almost
-- every row is not hidden and stops at the first branch.
--
-- The author still sees their own hidden pour, on purpose. Making it
-- vanish silently is how people conclude the report did nothing and that
-- the app is lying to them; the client marks it instead (postCard()).
drop policy if exists "posts are readable by their audience" on posts;
create policy "posts are readable by their audience"
  on posts for select using (
    (hidden_at is null or user_id = auth.uid() or is_admin())
    and (
      visibility = 'public'
      or user_id = auth.uid()
      or exists (
        select 1 from follows f
         where f.followee_id = posts.user_id
           and f.follower_id = auth.uid()
           and f.status = 'accepted')
    )
  );

drop policy if exists "comments are public" on comments;
create policy "comments are public"
  on comments for select using (
    hidden_at is null or user_id = auth.uid() or is_admin()
  );

-- ---------- a suspended account cannot post or comment ----------
-- The two surfaces that carry words and pictures. Enforced in the
-- database, because a client-side suspension is decoration.
drop policy if exists "users insert their own posts" on posts;
create policy "users insert their own posts"
  on posts for insert with check (auth.uid() = user_id and not is_suspended());

drop policy if exists "users insert their own comments" on comments;
create policy "users insert their own comments"
  on comments for insert with check (auth.uid() = user_id and not is_suspended());

-- ---------- a hidden pour cannot win the day ----------
-- podium_top is security definer, so RLS does not apply inside it. Same
-- reason the `visibility = 'public'` filter is there: without an explicit
-- predicate, a pour that was just hidden for being abusive would be
-- pushed onto the one board everybody sees.
create or replace function podium_top(d date default null)
returns table(post_id uuid, user_id uuid, place int, likes bigint)
language sql stable security definer set search_path = public as $$
  with day_posts as (
    select p.id, p.user_id, p.created_at,
           (select count(*) from likes l where l.post_id = p.id) as likes,
           (select count(*) from comments c
             where c.post_id = p.id and c.user_id is distinct from p.user_id) as comments
      from posts p
     where p.visibility = 'public'
       and p.hidden_at is null
       and (p.created_at at time zone 'Europe/Berlin')::date = coalesce(d, podium_day())
  )
  select id, user_id,
         (row_number() over (order by likes + comments desc, created_at asc))::int,
         likes
    from day_posts
   where likes + comments > 0
   order by likes + comments desc, created_at asc
   limit 3;
$$;

-- ============================================================
-- 4. THE REPORT QUEUE
-- ============================================================
alter table reports add column if not exists resolved_at timestamptz;
alter table reports add column if not exists resolved_by uuid references profiles on delete set null;
alter table reports add column if not exists resolution  text;

-- The reporter's own policy (step-1.7) stays as it is. This adds the one
-- role that has to see all of them.
drop policy if exists "admins read every report" on reports;
create policy "admins read every report"
  on reports for select using (is_admin());

-- ============================================================
-- 5. THE AUDIT ROW
-- ============================================================
-- One row per decision, including the decisions that were "do nothing".
-- A moderation log with only the removals in it cannot answer the
-- question anybody actually asks, which is "did you look at it".
create table if not exists moderation_actions (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references profiles on delete set null,   -- who decided
  report_id  uuid references reports  on delete set null,   -- what prompted it, if anything
  action     text not null check (action in (
               'hide_post','unhide_post','delete_post',
               'hide_comment','unhide_comment','delete_comment',
               'suspend_user','unsuspend_user','dismiss')),
  -- the target, at most one of which is set
  post_id    uuid,      -- NOT a foreign key: a deleted post must stay in the log
  comment_id uuid,
  subject_id uuid references profiles on delete set null,   -- the affected user
  reason     text not null,        -- the category, in the moderator's words
  statement  text,                 -- exactly what the affected user was told
  note       text,                 -- internal, never sent
  -- What was destroyed, for the cases where the row itself is gone:
  -- author, timestamp, text, and the R2 key nothing else will ever
  -- enumerate for you.
  evidence   jsonb,
  created_at timestamptz not null default now()
);
create index if not exists moderation_actions_at_idx      on moderation_actions (created_at desc);
create index if not exists moderation_actions_subject_idx on moderation_actions (subject_id, created_at desc);

alter table moderation_actions enable row level security;

-- Admins read the log. Nobody writes it from a client — the mod_*
-- functions are the only authors, and they are security definer.
drop policy if exists "admins read the moderation log" on moderation_actions;
create policy "admins read the moderation log"
  on moderation_actions for select using (is_admin());

-- ============================================================
-- 6. THE ACTIONS
-- ============================================================
-- All of them share one shape: check the caller is an admin, insist on a
-- statement, do the thing, write the audit row, tell the author, tell the
-- reporter, close the report.
--
-- mod_record() is the second half of that, so no action can do the work
-- and forget the paperwork.
create or replace function mod_record(
  p_action    text,
  p_reason    text,
  p_statement text,
  p_note      text,
  p_report    uuid,
  p_post      uuid,
  p_comment   uuid,
  p_subject   uuid,
  p_evidence  jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare aid uuid; rid uuid;
begin
  insert into moderation_actions
    (actor_id, report_id, action, post_id, comment_id, subject_id, reason, statement, note, evidence)
  values
    (auth.uid(), p_report, p_action, p_post, p_comment, p_subject, p_reason, p_statement, p_note, p_evidence)
  returning id into aid;

  -- The statement of reasons, delivered where the person will see it.
  -- actor_id stays null: nobody *did* this to them, a decision did, and
  -- the inbox draws a symbol rather than a face for those.
  --
  -- post_id is carried only when the pour still exists — the column has a
  -- cascading foreign key and a deleted post would take the notice with
  -- it, which is the one row that must outlive it.
  if p_subject is not null and coalesce(trim(p_statement),'') <> '' then
    insert into notifications (user_id, actor_id, type, body, post_id)
    values (p_subject, null, 'moderation', p_statement,
            case when p_action in ('hide_post','unhide_post') then p_post else null end);
  end if;

  -- Article 16(5): the reporter is told what was decided. They are not
  -- told which action was taken against whom — that is not theirs.
  if p_report is not null then
    update reports
       set status      = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end,
           resolved_at = now(),
           resolved_by = auth.uid(),
           resolution  = p_action
     where id = p_report
     returning reporter_id into rid;

    if rid is not null and rid <> coalesce(p_subject,'00000000-0000-0000-0000-000000000000'::uuid) then
      insert into notifications (user_id, actor_id, type, body)
      values (rid, null, 'report_update',
              case when p_action = 'dismiss'
                   then 'We looked at what you reported and left it up. Thank you for flagging it.'
                   else 'We looked at what you reported and acted on it. Thank you for flagging it.' end);
    end if;
  end if;

  return aid;
end $$;

-- Every public entry point starts here.
create or replace function mod_assert_admin(p_statement text default null)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_statement is not null and coalesce(trim(p_statement),'') = '' then
    raise exception 'a statement of reasons is required' using errcode = '22023';
  end if;
end $$;

-- ---------- posts ----------
create or replace function mod_hide_post(
  p_post uuid, p_reason text, p_statement text,
  p_report uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  perform mod_assert_admin(p_statement);
  select user_id into owner from posts where id = p_post;
  if owner is null then raise exception 'no such pour'; end if;

  perform set_config('crema.mod','ok',true);
  update posts set hidden_at = now(), hidden_by = auth.uid() where id = p_post;
  perform set_config('crema.mod','',true);

  return mod_record('hide_post', p_reason, p_statement, p_note, p_report, p_post, null, owner, null);
end $$;

create or replace function mod_unhide_post(
  p_post uuid, p_reason text default 'restored on review',
  p_statement text default null, p_report uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  perform mod_assert_admin(null);          -- putting something back needs no explanation
  select user_id into owner from posts where id = p_post;
  if owner is null then raise exception 'no such pour'; end if;

  perform set_config('crema.mod','ok',true);
  update posts set hidden_at = null, hidden_by = null where id = p_post;
  perform set_config('crema.mod','',true);

  return mod_record('unhide_post', p_reason, p_statement, p_note, p_report, p_post, null, owner, null);
end $$;

create or replace function mod_delete_post(
  p_post uuid, p_reason text, p_statement text,
  p_report uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r record; ev jsonb;
begin
  perform mod_assert_admin(p_statement);
  select * into r from posts where id = p_post;
  if r.id is null then raise exception 'no such pour'; end if;

  -- Everything that is about to stop existing. `image_key` above all:
  -- nothing else in this database will ever be able to tell you which
  -- object in R2 belonged to this row.
  ev := jsonb_build_object(
    'kind','post', 'post_id', r.id, 'user_id', r.user_id, 'drink', r.drink,
    'caption', r.caption, 'image_key', r.image_key, 'created_at', r.created_at,
    'r2_object_still_present', r.image_key is not null);

  -- Written before the delete, so the record survives the row.
  perform mod_record('delete_post', p_reason, p_statement, p_note, p_report, null, null, r.user_id, ev);

  perform set_config('crema.mod','ok',true);
  delete from posts where id = p_post;
  perform set_config('crema.mod','',true);

  return null;
end $$;

-- ---------- comments ----------
create or replace function mod_hide_comment(
  p_comment uuid, p_reason text, p_statement text,
  p_report uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  perform mod_assert_admin(p_statement);
  select user_id into owner from comments where id = p_comment;
  if owner is null then raise exception 'no such comment'; end if;

  perform set_config('crema.mod','ok',true);
  update comments set hidden_at = now(), hidden_by = auth.uid() where id = p_comment;
  perform set_config('crema.mod','',true);

  return mod_record('hide_comment', p_reason, p_statement, p_note, p_report, null, p_comment, owner, null);
end $$;

create or replace function mod_unhide_comment(
  p_comment uuid, p_reason text default 'restored on review',
  p_statement text default null, p_report uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  perform mod_assert_admin(null);
  select user_id into owner from comments where id = p_comment;
  if owner is null then raise exception 'no such comment'; end if;

  perform set_config('crema.mod','ok',true);
  update comments set hidden_at = null, hidden_by = null where id = p_comment;
  perform set_config('crema.mod','',true);

  return mod_record('unhide_comment', p_reason, p_statement, p_note, p_report, null, p_comment, owner, null);
end $$;

create or replace function mod_delete_comment(
  p_comment uuid, p_reason text, p_statement text,
  p_report uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r record; ev jsonb;
begin
  perform mod_assert_admin(p_statement);
  select * into r from comments where id = p_comment;
  if r.id is null then raise exception 'no such comment'; end if;

  ev := jsonb_build_object('kind','comment', 'comment_id', r.id, 'user_id', r.user_id,
                           'post_id', r.post_id, 'body', r.body, 'created_at', r.created_at);
  perform mod_record('delete_comment', p_reason, p_statement, p_note, p_report, null, null, r.user_id, ev);

  perform set_config('crema.mod','ok',true);
  delete from comments where id = p_comment;
  perform set_config('crema.mod','',true);

  return null;
end $$;

-- ---------- people ----------
-- Days rather than a date: "seven days" is what a moderator decides and
-- what a statement of reasons can say. 0 is not allowed — an
-- indefinite-length suspension nobody set an end for is the thing that
-- turns into a forgotten ban.
create or replace function mod_suspend_user(
  p_user uuid, p_days int, p_reason text, p_statement text,
  p_report uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare until timestamptz;
begin
  perform mod_assert_admin(p_statement);
  if p_days is null or p_days < 1 or p_days > 3650 then
    raise exception 'a suspension lasts between 1 and 3650 days';
  end if;
  if not exists (select 1 from profiles where id = p_user) then
    raise exception 'no such account';
  end if;
  if p_user = auth.uid() then
    raise exception 'you cannot suspend yourself';
  end if;

  until := now() + make_interval(days => p_days);

  perform set_config('crema.mod','ok',true);
  update profiles
     set suspended_until = until, suspended_reason = p_reason
   where id = p_user;
  perform set_config('crema.mod','',true);

  return mod_record('suspend_user', p_reason, p_statement, p_note, p_report, null, null, p_user,
                    jsonb_build_object('days', p_days, 'until', until));
end $$;

create or replace function mod_unsuspend_user(
  p_user uuid, p_reason text default 'lifted', p_statement text default null,
  p_report uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  perform mod_assert_admin(null);
  perform set_config('crema.mod','ok',true);
  update profiles set suspended_until = null, suspended_reason = null where id = p_user;
  perform set_config('crema.mod','',true);

  return mod_record('unsuspend_user', p_reason, p_statement, p_note, p_report, null, null, p_user, null);
end $$;

-- ---------- deciding to do nothing ----------
-- Its own action with its own audit row. "We looked and left it up" is a
-- decision, and a queue where dismissal is untracked is a queue where
-- nobody can tell the difference between reviewed and ignored.
create or replace function mod_dismiss_report(
  p_report uuid, p_reason text default 'no violation found', p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  perform mod_assert_admin(null);
  if not exists (select 1 from reports where id = p_report) then
    raise exception 'no such report';
  end if;
  return mod_record('dismiss', p_reason, null, p_note, p_report, null, null, null, null);
end $$;

-- ============================================================
-- 7. WHAT THE ADMIN SCREEN READS
-- ============================================================
-- One round trip, one jsonb array, because the alternative is five
-- PostgREST queries and a join in JavaScript. security definer so the
-- queue can show content that has already been hidden — otherwise the
-- moderator is the one person who cannot see what they are deciding on.
create or replace function mod_queue(p_status text default 'open', p_limit int default 60)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out_json jsonb;
begin
  perform mod_assert_admin(null);
  select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.created_at desc), '[]'::jsonb)
    into out_json
    from (
      select r.id, r.status, r.reason, r.note, r.created_at, r.resolution, r.resolved_at,
             jsonb_build_object('id', rp.id, 'handle', rp.handle, 'name', rp.name) as reporter,
             case
               when r.post_id is not null then jsonb_build_object(
                 'kind','post', 'id', p.id, 'drink', p.drink, 'caption', p.caption,
                 'image_key', p.image_key, 'created_at', p.created_at,
                 'hidden', p.hidden_at is not null, 'gone', p.id is null,
                 'author', jsonb_build_object('id', pa.id, 'handle', pa.handle, 'name', pa.name,
                                              'suspended_until', pa.suspended_until))
               when r.comment_id is not null then jsonb_build_object(
                 'kind','comment', 'id', c.id, 'body', c.body, 'post_id', c.post_id,
                 'created_at', c.created_at, 'hidden', c.hidden_at is not null, 'gone', c.id is null,
                 'author', jsonb_build_object('id', ca.id, 'handle', ca.handle, 'name', ca.name,
                                              'suspended_until', ca.suspended_until))
               else jsonb_build_object(
                 'kind','user', 'id', u.id,
                 'author', jsonb_build_object('id', u.id, 'handle', u.handle, 'name', u.name,
                                              'suspended_until', u.suspended_until))
             end as target
        from reports r
        left join profiles rp on rp.id = r.reporter_id
        left join posts    p  on p.id  = r.post_id
        left join profiles pa on pa.id = p.user_id
        left join comments c  on c.id  = r.comment_id
        left join profiles ca on ca.id = c.user_id
        left join profiles u  on u.id  = r.user_id
       where p_status = 'all' or r.status = p_status
       order by r.created_at desc
       limit greatest(1, least(p_limit, 200))
    ) q;
  return out_json;
end $$;

-- The decisions, newest first — the other half of "can you show me what
-- you did about it".
create or replace function mod_log(p_limit int default 60)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out_json jsonb;
begin
  perform mod_assert_admin(null);
  select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.created_at desc), '[]'::jsonb)
    into out_json
    from (
      select m.id, m.action, m.reason, m.statement, m.note, m.created_at, m.evidence,
             m.post_id, m.comment_id, m.report_id,
             jsonb_build_object('id', s.id, 'handle', s.handle, 'name', s.name) as subject,
             jsonb_build_object('id', a.id, 'handle', a.handle, 'name', a.name) as actor
        from moderation_actions m
        left join profiles s on s.id = m.subject_id
        left join profiles a on a.id = m.actor_id
       order by m.created_at desc
       limit greatest(1, least(p_limit, 200))
    ) q;
  return out_json;
end $$;

-- ============================================================
-- 8. WHO MAY CALL WHAT
-- ============================================================
-- Every one of these checks is_admin() on its own — the grants are the
-- second lock, not the only one. anon is never given execute: a signed
-- out visitor has no business reaching a moderation endpoint at all.
do $$
declare f text;
begin
  foreach f in array array[
    'mod_record(text,text,text,text,uuid,uuid,uuid,uuid,jsonb)',
    'mod_assert_admin(text)',
    'mod_hide_post(uuid,text,text,uuid,text)',
    'mod_unhide_post(uuid,text,text,uuid,text)',
    'mod_delete_post(uuid,text,text,uuid,text)',
    'mod_hide_comment(uuid,text,text,uuid,text)',
    'mod_unhide_comment(uuid,text,text,uuid,text)',
    'mod_delete_comment(uuid,text,text,uuid,text)',
    'mod_suspend_user(uuid,int,text,text,uuid,text)',
    'mod_unsuspend_user(uuid,text,text,uuid,text)',
    'mod_dismiss_report(uuid,text,text)',
    'mod_queue(text,int)',
    'mod_log(int)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
  end loop;

  -- mod_record and mod_assert_admin are internals: reachable only from
  -- the functions above, never from a client.
  foreach f in array array[
    'mod_hide_post(uuid,text,text,uuid,text)',
    'mod_unhide_post(uuid,text,text,uuid,text)',
    'mod_delete_post(uuid,text,text,uuid,text)',
    'mod_hide_comment(uuid,text,text,uuid,text)',
    'mod_unhide_comment(uuid,text,text,uuid,text)',
    'mod_delete_comment(uuid,text,text,uuid,text)',
    'mod_suspend_user(uuid,int,text,text,uuid,text)',
    'mod_unsuspend_user(uuid,text,text,uuid,text)',
    'mod_dismiss_report(uuid,text,text)',
    'mod_queue(text,int)',
    'mod_log(int)'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ============================================================
-- 9. THE FIRST ADMIN
-- ============================================================
-- Nothing here grants one, on purpose: the flag is the only thing in the
-- schema that no code path can set, so it has to be set by a human with
-- the SQL editor open. Run this once, with your own handle:
--
--   update profiles set is_admin = true where handle = 'your-handle';
--
-- and check it took:
--
--   select handle, is_admin from profiles where is_admin;
