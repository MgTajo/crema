\set ON_ERROR_STOP on
\pset pager off

-- ============================================================
-- step-1.29: your shelf follows you to the next device
--
--   ./supabase/local-test/run.sh step-1.29-test.sql
--
-- The point of the table is that it is private and that the three RPCs
-- do not tread on each other. Both are tested as a client — `set local
-- role authenticated` inside a transaction — because a test that runs
-- as superuser proves nothing about RLS.
-- ============================================================

-- ---------- fixtures ----------
delete from user_gear;
delete from notifications; delete from reactions; delete from likes;
delete from comments; delete from follows; delete from posts;
delete from profiles; delete from auth.users;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','ann@e.com'),
  ('22222222-2222-2222-2222-222222222222','bo@e.com');
insert into profiles (id, handle, name) values
  ('11111111-1111-1111-1111-111111111111','ann','Ann'),
  ('22222222-2222-2222-2222-222222222222','bo','Bo');

\echo '--- T1: the table, the index and the four policies exist ---'
do $$
begin
  assert (select count(*) = 1 from information_schema.tables where table_name='user_gear'),
    'user_gear should exist';
  assert (select relrowsecurity from pg_class where relname='user_gear'),
    'RLS must be enabled — this table is private by construction';
  assert (select count(*) = 4 from pg_policies where tablename='user_gear'),
    'select/insert/update/delete policies should all be present';
end $$;
\echo 'T1 PASS'

\echo '--- T2: remembering your own coffee, as a client ---'
begin;
  set local role authenticated;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';
  select gear_remember('bean','Nachbars Bohne');
  select gear_remember('machine','Omas Herdkanne');
  select gear_remember('drink','Ristretto Bianco');
commit;
do $$
begin
  assert (select count(*) = 3 from user_gear
           where user_id='11111111-1111-1111-1111-111111111111' and own),
    'three own entries should have been written';
  assert (select name = 'Nachbars Bohne' from user_gear
           where user_id='11111111-1111-1111-1111-111111111111' and kind='bean'),
    'the bean should be stored under the display string a recipe uses';
end $$;
\echo 'T2 PASS'

\echo '--- T3: a note, and the three columns not treading on each other ---'
-- This is the reason gear_note/gear_fav/gear_remember are separate
-- functions rather than one PostgREST upsert: an upsert writes a whole
-- row, so noting a coffee would have cleared `own` and `fav_at`.
begin;
  set local role authenticated;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';
  select gear_fav('bean','Nachbars Bohne', true);
  select gear_note('bean','Nachbars Bohne', '{"roaster":"Elbgold","note":"12 EUR bei Rewe"}'::jsonb);
commit;
do $$
declare r record;
begin
  select * into r from user_gear
   where user_id='11111111-1111-1111-1111-111111111111' and kind='bean' and name='Nachbars Bohne';
  assert r.own,                              'a note must not clear own';
  assert r.fav_at is not null,               'a note must not clear the favourite';
  assert r.info->>'roaster' = 'Elbgold',     'the note should be there';
end $$;
\echo 'T3 PASS'

\echo '--- T4: and in the other order too ---'
begin;
  set local role authenticated;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';
  select gear_note('machine','Omas Herdkanne', '{"kind":"moka","note":"Nur kleine Flamme"}'::jsonb);
  select gear_fav('machine','Omas Herdkanne', true);
commit;
do $$
declare r record;
begin
  select * into r from user_gear
   where user_id='11111111-1111-1111-1111-111111111111' and kind='machine';
  assert r.own,                          'starring must not clear own';
  assert r.info->>'kind' = 'moka',       'starring must not clear the note';
  assert r.fav_at is not null,           'and the star should be on';
end $$;
\echo 'T4 PASS'

\echo '--- T5: a note on a CATALOGUE entry, then cleared, leaves nothing behind ---'
begin;
  set local role authenticated;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';
  select gear_note('bean','Jacobs Krönung', '{"note":"Papas Kaffee"}'::jsonb);
commit;
do $$
begin
  assert (select not own from user_gear
           where user_id='11111111-1111-1111-1111-111111111111' and name='Jacobs Krönung'),
    'a note on a catalogue coffee does not make it yours';
end $$;
begin;
  set local role authenticated;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';
  select gear_note('bean','Jacobs Krönung', null);
commit;
do $$
begin
  assert (select count(*) = 0 from user_gear
           where user_id='11111111-1111-1111-1111-111111111111' and name='Jacobs Krönung'),
    'the row was only ever the note, so clearing it should remove the row';
end $$;
\echo 'T5 PASS'

\echo '--- T6: clearing a note on YOUR OWN entry keeps the entry ---'
begin;
  set local role authenticated;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';
  select gear_note('bean','Nachbars Bohne', null);
commit;
do $$
begin
  assert (select count(*) = 1 from user_gear
           where user_id='11111111-1111-1111-1111-111111111111' and name='Nachbars Bohne'),
    'the coffee is still on their shelf — only the writing about it is gone';
  assert (select info is null and own and fav_at is not null from user_gear
           where user_id='11111111-1111-1111-1111-111111111111' and name='Nachbars Bohne'),
    'and the star survives too';
end $$;
\echo 'T6 PASS'

\echo '--- T7: unstarring a plain catalogue favourite removes the row ---'
begin;
  set local role authenticated;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';
  select gear_fav('bean','Lavazza Qualità Rossa', true);
commit;
do $$
begin
  assert (select count(*)=1 from user_gear where name='Lavazza Qualità Rossa'), 'starred';
end $$;
begin;
  set local role authenticated;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';
  select gear_fav('bean','Lavazza Qualità Rossa', false);
commit;
do $$
begin
  assert (select count(*)=0 from user_gear where name='Lavazza Qualità Rossa'),
    'nothing left to remember about it, so nothing is remembered';
end $$;
\echo 'T7 PASS'

\echo '--- T8: re-starring does not reshuffle the order ---'
-- fav_at is the picker''s sort key. Starring something already starred
-- must keep its original timestamp, or a stray double tap would jump it
-- to the top of a list the user arranged.
begin;
  set local role authenticated;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';
  select gear_fav('bean','Nachbars Bohne', true);
commit;
do $$
declare a timestamptz; b timestamptz;
begin
  select fav_at into a from user_gear where name='Nachbars Bohne';
  perform pg_sleep(0.05);
  begin
    set local role authenticated;
    perform set_config('test.uid','11111111-1111-1111-1111-111111111111',true);
    perform gear_fav('bean','Nachbars Bohne', true);
    reset role;
  end;
  select fav_at into b from user_gear where name='Nachbars Bohne';
  assert a = b, 'starring an already-starred entry must not move it';
end $$;
\echo 'T8 PASS'

\echo '--- T9: Bo cannot read, write or delete Ann''s shelf ---'
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222',true);
  select count(*) into n from user_gear;
  reset role;
  assert n = 0, format('Bo should see none of Ann''s %s rows, saw %s',
    (select count(*) from user_gear), n);
end $$;

-- Bo writing under Ann's id: the RPC uses auth.uid(), so it simply
-- writes Bo's own row. The one that must fail is a direct insert.
do $$
begin
  begin
    set local role authenticated;
    perform set_config('test.uid','22222222-2222-2222-2222-222222222222',true);
    insert into user_gear (user_id, kind, name, own)
    values ('11111111-1111-1111-1111-111111111111','bean','Smuggled',true);
    reset role;
    assert false, 'RLS should refuse a row written into someone else''s shelf';
  exception when insufficient_privilege then reset role;
  end;
end $$;

do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222',true);
  delete from user_gear;                      -- RLS narrows this to Bo's rows
  get diagnostics n = row_count;
  reset role;
  assert n = 0, 'a delete-everything from Bo must not touch Ann';
  assert (select count(*) > 0 from user_gear
           where user_id='11111111-1111-1111-1111-111111111111'),
    'Ann''s shelf should still be there';
end $$;
\echo 'T9 PASS'

\echo '--- T10: the guards — blank names, oversized notes, bad kinds ---'
do $$
declare before int;
begin
  select count(*) into before from user_gear;
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111',true);
  perform gear_remember('bean','   ');        -- blank: ignored, not an error
  perform gear_remember('bean','');
  reset role;
  assert (select count(*) from user_gear) = before, 'a blank name should write nothing';
end $$;

do $$
begin
  begin
    insert into user_gear (user_id, kind, name)
    values ('11111111-1111-1111-1111-111111111111','sandwich','Toast');
    assert false, 'an unknown kind should be refused';
  exception when check_violation then null;
  end;
  begin
    insert into user_gear (user_id, kind, name, info)
    values ('11111111-1111-1111-1111-111111111111','bean','Huge',
            jsonb_build_object('note', repeat('x', 2100)));
    assert false, 'a note over 2 KB should be refused';
  exception when check_violation then null;
  end;
  begin
    insert into user_gear (user_id, kind, name)
    values ('11111111-1111-1111-1111-111111111111','bean', repeat('n', 121));
    assert false, 'a 121-character name should be refused';
  exception when check_violation then null;
  end;
end $$;
\echo 'T10 PASS'

\echo '--- T11: a signed-out caller writes nothing ---'
do $$
declare before int;
begin
  select count(*) into before from user_gear;
  set local role authenticated;
  perform set_config('test.uid','',true);     -- auth.uid() is null
  perform gear_remember('bean','Ghost');
  perform gear_note('bean','Ghost','{"note":"x"}'::jsonb);
  perform gear_fav('bean','Ghost',true);
  reset role;
  assert (select count(*) from user_gear) = before, 'no session, no rows';
end $$;
\echo 'T11 PASS'

\echo '--- T12: deleting the account takes the shelf with it ---'
delete from auth.users where id='11111111-1111-1111-1111-111111111111';
do $$
begin
  assert (select count(*) = 0 from user_gear
           where user_id='11111111-1111-1111-1111-111111111111'),
    'on delete cascade should have cleared it — this is the Art. 17 path';
end $$;
\echo 'T12 PASS'

\echo '--- T13: re-running the whole migration is safe ---'
\ir ../step-1.29.sql
do $$
begin
  assert (select count(*) = 4 from pg_policies where tablename='user_gear'),
    'the policies should survive being dropped and re-created';
  assert (select count(*) = 1 from information_schema.tables where table_name='user_gear'),
    'and the table should still be there, with its rows';
end $$;
\echo 'T13 PASS'

\echo ''
\echo 'step-1.29: 13 passed'
