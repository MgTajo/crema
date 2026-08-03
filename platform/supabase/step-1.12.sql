-- ============================================================
-- Crema — editing your own pour, on the day you poured it
--
-- Run after step-1.11.sql. Re-runnable.
--
-- The rule the UI enforces is "your own post, today, text only". RLS
-- already restricts UPDATE to the author's own rows (schema.sql), but
-- "only today" and "not the photo" are not things a policy can express
-- comfortably — a policy sees the new row, not the diff. So they live in
-- a BEFORE UPDATE trigger, which sees both.
--
-- Why this matters even though the client checks first: `posts` is
-- reachable with the publishable key from any browser console. Every
-- rule the app relies on has to hold in the database too, or it isn't a
-- rule — it's a suggestion.
-- ============================================================

-- ---------- the marker ----------
-- Null means "never edited". The UI only ever renders the fact, not the
-- time, but keeping the timestamp costs nothing and answers "when?".
alter table posts add column if not exists edited_at timestamptz;

-- ---------- what an edit may and may not do ----------
create or replace function posts_guard_edit()
returns trigger
language plpgsql
as $$
begin
  -- Maintenance is not an edit. migrate-base64-images.mjs rewrites
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

drop trigger if exists posts_guard_edit on posts;
create trigger posts_guard_edit
  before update on posts
  for each row execute function posts_guard_edit();

-- ---------- what to expect afterwards ----------
--   select count(*) from posts where edited_at is not null;   -- 0 at first
--   -- and, as any signed-in user, these must all fail:
--   --   update posts set image_key = 'x' where id = <own, today>;
--   --   update posts set caption   = 'x' where id = <own, last week>;
--   --   update posts set caption   = 'x' where id = <someone else's>;   -- 0 rows (RLS)
