-- ============================================================
-- Crema — step 1.23: a report reaches a person
--
-- Run after step-1.22.sql. Re-runnable.
--
-- The report sheet says "a person reads every report". Since step 1.7
-- that has been half true: the row is written, RLS keeps it away from
-- everyone but its author, and then it sits in a table with no reader.
-- Nothing anywhere told a human it existed.
--
-- So every insert into `reports` now sends one email to the address on
-- the website, through the `report-mail` Edge Function. Same shape as
-- push: a trigger builds the payload, pg_net hands it over, and the
-- function does the talking to the outside world. It reuses
-- push_config()/push_set_config() from step-1.16.sql rather than growing
-- a second pair — they are generic Vault accessors that happen to be
-- named for their first caller — and reuses the `push_secret` value as
-- the shared hook secret, because Supabase function secrets are
-- per-project and both callers are the same Postgres.
--
-- ONE setting this file cannot read from the environment. Run it AFTER
-- this file, as the postgres role. Until it is set, every report files
-- exactly as it does today and raises a notice instead of an email:
--
--   select push_set_config('report_endpoint',
--     'https://diabtvahplwoipvrprvb.supabase.co/functions/v1/report-mail');
--
-- Deploy the function BEFORE setting that, or reports fire into a 404 —
-- harmless (the row is still filed), but silent.
-- ============================================================

create extension if not exists pg_net;

-- ---------- the payload, and who it is about ----------
-- SECURITY DEFINER because a report is *about* content the reporter can
-- see but whose author row this trigger has no session for; the whole
-- point is to describe the target well enough to act on without opening
-- the app. Nothing here is reachable from a client (see the revoke at
-- the bottom) and nothing here is returned to one.
--
-- The excerpt is trimmed hard. This email is a triage line in an inbox,
-- not an archive: the row itself is the record, and a full caption in
-- the body only makes the reason harder to see.
create or replace function report_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  url text; secret text;
  target text; target_id uuid;
  author_id uuid; author_handle text; excerpt text; link text;
  reporter_handle text;
begin
  url    := push_config('report_endpoint');
  secret := push_config('push_secret');
  if url is null or url = '' then
    raise notice 'report_endpoint unset — report % filed but not emailed (see supabase/README.md §6)', new.id;
    return new;
  end if;
  if secret is null or secret = '' then
    raise notice 'push_secret unset — report % filed but not emailed (see supabase/README.md §6)', new.id;
    return new;
  end if;

  -- Exactly one of the three is non-null; the table's one_target check
  -- constraint (step-1.7) is what makes this an if/elsif rather than a
  -- set of independent lookups.
  if new.post_id is not null then
    target := 'post'; target_id := new.post_id;
    select p.user_id, left(coalesce(p.caption,''), 180)
      into author_id, excerpt
      from posts p where p.id = new.post_id;
    -- The app understands #p/<id> and opens the pour on it, which is a
    -- faster route to a decision than any admin screen we don't have.
    link := 'https://crema-app.com/#p/' || new.post_id;
  elsif new.comment_id is not null then
    target := 'comment'; target_id := new.comment_id;
    select c.user_id, left(coalesce(c.body,''), 180), 'https://crema-app.com/#p/' || c.post_id
      into author_id, excerpt, link
      from comments c where c.id = new.comment_id;
  else
    target := 'user'; target_id := new.user_id; author_id := new.user_id;
  end if;

  select nullif(handle,'') into author_handle   from profiles where id = author_id;
  select nullif(handle,'') into reporter_handle from profiles where id = new.reporter_id;

  perform net.http_post(
    url     := url,
    headers := jsonb_build_object('Content-Type','application/json','X-Push-Secret',secret),
    body    := jsonb_build_object('report', jsonb_build_object(
      'id',              new.id,
      'reason',          new.reason,
      'note',            new.note,
      'created_at',      coalesce(new.created_at, now()),
      'target',          target,
      'target_id',       target_id,
      'reporter_id',     new.reporter_id,
      'reporter_handle', reporter_handle,
      'author_id',       author_id,
      'author_handle',   author_handle,
      'excerpt',         nullif(excerpt,''),
      'link',            link
    ))
  );
  return new;
exception when others then
  -- Filing must never fail because the mailer did. Someone reporting
  -- abuse gets "Reported. Thanks" either way, and the row — the thing
  -- moderation actually runs on — is already written.
  raise notice 'report_notify failed for %: %', new.id, sqlerrm;
  return new;
end $$;

-- AFTER INSERT: the row exists and is committed-bound before anyone is
-- told about it, so the email can never describe a report that rolled
-- back.
drop trigger if exists reports_notify on reports;
create trigger reports_notify after insert on reports
  for each row execute function report_notify();

-- ---------- not a client API ----------
-- Same reasoning as step-1.16: PostgREST publishes every function in
-- `public` as an RPC endpoint, and this one is SECURITY DEFINER, so
-- without this anyone with the publishable key could call it. The
-- trigger's own privilege was checked when the trigger was created and
-- does not need a grant.
revoke all on function report_notify() from public, anon, authenticated;
