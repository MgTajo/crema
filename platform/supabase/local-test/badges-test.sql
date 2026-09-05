-- ============================================================
-- badges-test.sql — profiles.badges, and the export that has to carry it.
--
--   ./platform/supabase/local-test/run.sh badges-test.sql
--
-- What this is really guarding, in order of how much it would cost to
-- get wrong:
--
--   T5  the export. export_my_data() names its profile columns, so a
--       new one is absent from every export until somebody adds it.
--       That is an Art. 15 gap and it is silent.
--   T3  the CHECK constraint being a legal CHECK at all. step-1.28.sql
--       shipped a subquery inside one on 2026-08-18; Postgres rejects
--       that with 0A000 and the SQL editor rolls the whole file back.
--   T6  re-runnability. Every migration here is expected to survive a
--       second paste.
--   T7  that RLS still lets you write your own and nobody else's — the
--       one security property this column has.
-- ============================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function ok(cond boolean, label text) returns void
language plpgsql as $$
begin
  if cond then raise notice '  ok   %', label;
  else raise exception 'FAILED: %', label; end if;
end $$;

-- ---------- fixtures ----------
insert into auth.users (id) values
  ('bbbb0001-0000-0000-0000-000000000001'),
  ('bbbb0002-0000-0000-0000-000000000002')
on conflict do nothing;

insert into profiles (id, handle, name) values
  ('bbbb0001-0000-0000-0000-000000000001','badge_one','Badge One'),
  ('bbbb0002-0000-0000-0000-000000000002','badge_two','Badge Two')
on conflict (id) do nothing;

-- ---------- T1: the column exists, and it defaults to empty ----------
select ok(
  (select badges from profiles where handle = 'badge_one') = '{}'::text[],
  'T1  a profile that has never written badges has an empty array, not null');

select ok(
  (select is_nullable from information_schema.columns
    where table_name = 'profiles' and column_name = 'badges') = 'NO',
  'T1b badges is NOT NULL, so no reader has to handle null');

-- ---------- T2: an owner can write their own ----------
update profiles set badges = array['first-pour','week-streak','bean-explorer']
 where handle = 'badge_one';
select ok(
  (select array_length(badges,1) from profiles where handle = 'badge_one') = 3,
  'T2  three badges written and read back');

-- ---------- T3: the CHECK is a legal CHECK, and it bites ----------
-- Legal at all: if this constraint had a subquery in it the ALTER in the
-- migration would already have failed with 0A000 and the run would have
-- stopped before here. Reaching this line is half the assertion.
select ok(
  exists (select 1 from pg_constraint
           where conname = 'profiles_badges_bounded' and contype = 'c'),
  'T3  profiles_badges_bounded exists as a CHECK constraint');

do $$
begin
  begin
    -- 41 ids, one past the cap.
    update profiles
       set badges = (select array_agg('b' || g) from generate_series(1,41) g)
     where handle = 'badge_one';
    raise exception 'FAILED: T3b 41 badges was accepted';
  exception when check_violation then
    raise notice '  ok   T3b 41 badges is refused by the CHECK';
  end;
end $$;

do $$
begin
  begin
    -- Under the count cap, far over the byte cap: the second half of the
    -- constraint, which is the half that actually stops a text dump.
    update profiles set badges = array[repeat('x', 1200)] where handle = 'badge_one';
    raise exception 'FAILED: T3c a 1200-byte badge id was accepted';
  exception when check_violation then
    raise notice '  ok   T3c one oversized id is refused by the CHECK';
  end;
end $$;

-- The cap must not be so tight that the real list cannot be stored.
update profiles
   set badges = array['first-pour','week-streak','rosetta-groove','tulip-time',
                      'swan-whisperer','bean-explorer','world-tour','cold-brew',
                      'challenger','regular-winner','century-club']
 where handle = 'badge_one';
select ok(
  (select array_length(badges,1) from profiles where handle = 'badge_one') = 11,
  'T4  all eleven badges that exist today fit inside the cap');

-- ---------- T5: the export carries them ----------
do $$
declare
  doc jsonb;
begin
  -- The harness's auth.uid() reads `test.uid` (local-test/stub.sql),
  -- which is how every other test here signs in.
  perform set_config('test.uid','bbbb0001-0000-0000-0000-000000000001',true);
  doc := export_my_data();
  perform ok(doc -> 'profile' ? 'badges',
    'T5  export_my_data() includes a badges key');
  perform ok(jsonb_array_length(doc -> 'profile' -> 'badges') = 11,
    'T5b the export carries all eleven, not an empty array');
  -- The splice must not have eaten anything else out of the profile block.
  perform ok(doc -> 'profile' ? 'machine_brand' and doc -> 'profile' ? 'premium'
             and doc -> 'profile' ? 'handle',
    'T5c the rest of the profile block survived the splice');
  perform ok(doc ? 'posts' and doc ? 'comments' and doc ? 'likes',
    'T5d the rest of the export survived the splice');
end $$;

-- ---------- T6: re-running the migration is a no-op ----------
\ir ../migrations/20260905090000_badges_are_public.sql

select ok(
  (select array_length(badges,1) from profiles where handle = 'badge_one') = 11,
  'T6  a second run of the migration keeps the rows it found');

do $$
declare doc jsonb;
begin
  -- The harness's auth.uid() reads `test.uid` (local-test/stub.sql),
  -- which is how every other test here signs in.
  perform set_config('test.uid','bbbb0001-0000-0000-0000-000000000001',true);
  doc := export_my_data();
  perform ok(jsonb_array_length(doc -> 'profile' -> 'badges') = 11,
    'T6b a second run does not splice p.badges in twice or break the export');
end $$;

-- ---------- T7: RLS — your own row and nobody else's ----------
do $$
declare n int;
begin
  perform set_config('test.uid','bbbb0001-0000-0000-0000-000000000001',true);
  set local role authenticated;

  update profiles set badges = array['first-pour'] where handle = 'badge_one';
  get diagnostics n = row_count;
  perform ok(n = 1, 'T7  a signed-in user can write their OWN badges');

  update profiles set badges = array['century-club'] where handle = 'badge_two';
  get diagnostics n = row_count;
  perform ok(n = 0, 'T7b and cannot write anybody else''s');

  perform ok(
    (select count(*) from profiles where handle in ('badge_one','badge_two')) = 2,
    'T7c but can still READ everyone''s — which is the whole point of the change');

  reset role;
end $$;

drop function ok(boolean, text);
