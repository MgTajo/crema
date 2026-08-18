-- Supabase-only pieces, faked well enough to load Crema's migration chain.
create extension if not exists pgcrypto;

do $$ begin
  begin create role anon;          exception when duplicate_object then null; end;
  begin create role authenticated; exception when duplicate_object then null; end;
  begin create role service_role;  exception when duplicate_object then null; end;
end $$;

create schema if not exists auth;
create schema if not exists cron;
create schema if not exists net;
create schema if not exists vault;
create schema if not exists extensions;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}',
  created_at timestamptz default now(),
  last_sign_in_at timestamptz,
  deleted_at timestamptz
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;

-- Supabase grants this and the stub did not, which hid a gap for a long
-- time: an RLS *policy* expression is evaluated with the table owner's
-- rights, so `auth.uid()` inside a policy worked here regardless. A
-- SECURITY INVOKER function that calls it does not — it fails with
-- "permission denied for schema auth". step-1.29 added the first such
-- function and found it. Without this line the harness would have
-- passed a migration that works and failed one that also works, which
-- is the worst thing a test environment can do.
grant usage on schema auth to anon, authenticated, service_role;

-- pg_cron stand-in: record the schedule, run nothing.
create table if not exists cron.job (
  jobid   bigserial primary key,
  jobname text unique,
  schedule text,
  command  text
);
create or replace function cron.schedule(p_jobname text, p_schedule text, p_command text)
returns bigint language plpgsql as $$
declare jid bigint;
begin
  insert into cron.job (jobname, schedule, command) values (p_jobname, p_schedule, p_command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid into jid;
  return jid;
end $$;
create or replace function cron.unschedule(jobname text)
returns bool language plpgsql as $$
begin delete from cron.job where cron.job.jobname = $1; return true; end $$;

-- pg_net stand-in: log the call so a test can assert it happened.
create table if not exists net.calls (
  id bigserial primary key, url text, headers jsonb, body jsonb, at timestamptz default now()
);
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
                                         headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language plpgsql as $$
declare i bigint;
begin
  insert into net.calls (url, headers, body) values (url, headers, body) returning id into i;
  return i;
end $$;

-- Vault stand-in.
create table if not exists vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique, secret text, description text
);
create or replace view vault.decrypted_secrets as
  select id, name, secret as decrypted_secret, description from vault.secrets;
create or replace function vault.create_secret(secret text, name text default null, description text default '')
returns uuid language plpgsql as $$
declare i uuid;
begin insert into vault.secrets (name, secret, description) values (name, secret, description) returning id into i; return i; end $$;
create or replace function vault.update_secret(id uuid, secret text default null, name text default null, description text default null)
returns void language plpgsql as $$
begin update vault.secrets s set secret = coalesce($2, s.secret) where s.id = $1; end $$;
