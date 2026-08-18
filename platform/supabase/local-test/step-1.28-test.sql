\set ON_ERROR_STOP on
\pset pager off

-- ============================================================
-- step-1.28: more than one photo on a pour
--
--   ./supabase/local-test/run.sh step-1.28-test.sql
--
-- The constraint is the reason this file exists. Its first draft used
-- `not exists (select 1 from unnest(...))`, which Postgres rejects in a
-- CHECK with 0A000 — and in the Supabase SQL editor that rolls the whole
-- migration back. That failure was only visible when the file was run,
-- which for this project means in production. So it is run here first.
-- ============================================================

-- ---------- fixtures ----------
delete from notifications; delete from reactions; delete from likes;
delete from comments; delete from follows; delete from posts;
delete from profiles; delete from auth.users;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','free@e.com'),
  ('22222222-2222-2222-2222-222222222222','prem@e.com');
insert into profiles (id, handle, name) values
  ('11111111-1111-1111-1111-111111111111','free','Free'),
  ('22222222-2222-2222-2222-222222222222','prem','Prem');
-- Premium is granted through the real path. A plain UPDATE does NOT
-- work and must not: premium_guard() (step-1.21) reverts false→true
-- unless `crema.redeem` is set, which only redeem_premium() does. The
-- first draft of this file used a plain UPDATE and T2 caught it — which
-- is the guard working, and worth leaving a note about rather than
-- quietly working around.
begin;
  select set_config('crema.redeem','ok',true);
  update profiles set premium = true, premium_at = now() where handle = 'prem';
commit;
do $$
begin
  assert (select premium from profiles where handle='prem'), 'the fixture failed to grant Premium';
  assert (select not premium from profiles where handle='free'), 'the free account must stay free';
end $$;

\echo '--- T1: the column and the constraint exist ---'
do $$
begin
  assert (select count(*) = 1 from information_schema.columns
           where table_name='posts' and column_name='image_keys'),
    'posts.image_keys should exist';
  assert (select count(*) = 1 from pg_constraint
           where conname = 'posts_image_keys_are_keys'),
    'the check constraint should exist — a subquery inside it would have been rejected';
end $$;
\echo 'T1 PASS'

\echo '--- T2: one, two and three keys are all fine for Premium ---'
insert into posts (id, user_id, drink, image_key, image_keys) values
  ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','Latte',
   'posts/p/1.jpg', array['posts/p/1.jpg']),
  ('aaaaaaaa-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Latte',
   'posts/p/2.jpg', array['posts/p/2.jpg','posts/p/3.jpg']),
  ('aaaaaaaa-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','Latte',
   'posts/p/4.jpg', array['posts/p/4.jpg','posts/p/5.jpg','posts/p/6.jpg']);
do $$
begin
  assert (select cardinality(image_keys) = 3 from posts
           where id='aaaaaaaa-0000-0000-0000-000000000003'),
    'a Premium account should keep all three';
end $$;
\echo 'T2 PASS'

\echo '--- T3: a pour with no photo at all is still legal ---'
insert into posts (id, user_id, drink) values
  ('aaaaaaaa-0000-0000-0000-000000000004','22222222-2222-2222-2222-222222222222','Espresso');
do $$
begin
  assert (select image_keys is null from posts where id='aaaaaaaa-0000-0000-0000-000000000004'),
    'null means "no photo", not "an empty gallery"';
end $$;
\echo 'T3 PASS'

\echo '--- T4: four keys are refused ---'
do $$
begin
  begin
    insert into posts (id, user_id, drink, image_keys) values
      ('aaaaaaaa-0000-0000-0000-000000000005','22222222-2222-2222-2222-222222222222','Latte',
       array['a/1.jpg','a/2.jpg','a/3.jpg','a/4.jpg']);
    assert false, 'four photos should have been refused';
  exception when check_violation then null;
  end;
end $$;
\echo 'T4 PASS'

\echo '--- T5: a data: URI is refused, in every slot ---'
do $$
declare slot int;
begin
  for slot in 1..3 loop
    begin
      insert into posts (id, user_id, drink, image_keys) values
        (('aaaaaaaa-0000-0000-0000-00000000000'||(5+slot))::uuid,
         '22222222-2222-2222-2222-222222222222','Latte',
         case slot
           when 1 then array['data:image/jpeg;base64,AAAA']
           when 2 then array['a/1.jpg','data:image/jpeg;base64,AAAA']
           else        array['a/1.jpg','a/2.jpg','data:image/jpeg;base64,AAAA']
         end);
      assert false, format('a data: URI in slot %s should have been refused', slot);
    exception when check_violation then null;
    end;
  end loop;
end $$;
\echo 'T5 PASS'

\echo '--- T6: an over-long key is refused, in every slot ---'
do $$
declare slot int; long text := repeat('x', 301);
begin
  for slot in 1..3 loop
    begin
      insert into posts (id, user_id, drink, image_keys) values
        (('aaaaaaaa-0000-0000-0000-00000000001'||slot)::uuid,
         '22222222-2222-2222-2222-222222222222','Latte',
         case slot when 1 then array[long]
                   when 2 then array['a/1.jpg',long]
                   else        array['a/1.jpg','a/2.jpg',long] end);
      assert false, format('a 301-character key in slot %s should have been refused', slot);
    exception when check_violation then null;
    end;
  end loop;
end $$;
\echo 'T6 PASS'

\echo '--- T7: an empty array and a null cover are refused ---'
do $$
begin
  begin
    insert into posts (id, user_id, drink, image_keys) values
      ('aaaaaaaa-0000-0000-0000-000000000020','22222222-2222-2222-2222-222222222222','Latte', '{}');
    assert false, 'an empty array should have been refused — null is how "no photo" is said';
  exception when check_violation then null;
  end;
  begin
    insert into posts (id, user_id, drink, image_keys) values
      ('aaaaaaaa-0000-0000-0000-000000000021','22222222-2222-2222-2222-222222222222','Latte',
       array[null,'a/1.jpg']::text[]);
    assert false, 'a null cover should have been refused';
  exception when check_violation then null;
  end;
end $$;
\echo 'T7 PASS'

\echo '--- T8: a free account is trimmed to one, silently ---'
-- The whole point of the trigger: a forged request loses the extras
-- rather than losing the pour it came with.
insert into posts (id, user_id, drink, image_key, image_keys) values
  ('bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Latte',
   'posts/f/1.jpg', array['posts/f/1.jpg','posts/f/2.jpg','posts/f/3.jpg']);
do $$
begin
  assert (select image_keys = array['posts/f/1.jpg'] from posts
           where id='bbbbbbbb-0000-0000-0000-000000000001'),
    'a free account should keep the cover and nothing else';
  assert (select image_key = 'posts/f/1.jpg' from posts
           where id='bbbbbbbb-0000-0000-0000-000000000001'),
    'and image_key must still agree with it';
end $$;
\echo 'T8 PASS'

\echo '--- T9: a free account cannot add photos by UPDATE either ---'
update posts set image_keys = array['posts/f/1.jpg','posts/f/9.jpg']
 where id='bbbbbbbb-0000-0000-0000-000000000001';
do $$
begin
  assert (select cardinality(image_keys) = 1 from posts
           where id='bbbbbbbb-0000-0000-0000-000000000001'),
    'the trigger fires on UPDATE OF image_keys as well as on INSERT';
end $$;
\echo 'T9 PASS'

\echo '--- T10: one photo on a free account is untouched ---'
insert into posts (id, user_id, drink, image_key, image_keys) values
  ('bbbbbbbb-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Flat white',
   'posts/f/7.jpg', array['posts/f/7.jpg']);
do $$
begin
  assert (select image_keys = array['posts/f/7.jpg'] from posts
           where id='bbbbbbbb-0000-0000-0000-000000000002'),
    'the free case must be exactly what it always was';
end $$;
\echo 'T10 PASS'

\echo '--- T11: the backfill fills old pours and skips legacy base64 ---'
-- step-1.11 added posts_image_key_is_a_key as NOT VALID, so a `data:`
-- row from before it may still exist. Reproduce one the only way that
-- is possible — with the constraint suspended, exactly as history did.
alter table posts drop constraint if exists posts_image_key_is_a_key;
insert into posts (id, user_id, drink, image_key) values
  ('cccccccc-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','Latte','posts/old/1.jpg'),
  ('cccccccc-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Latte',
   'data:image/jpeg;base64,'||repeat('A',400));
alter table posts add constraint posts_image_key_is_a_key
  check (image_key is null or (image_key not like 'data:%' and length(image_key) <= 300)) not valid;

-- the backfill, verbatim from step-1.28.sql
update posts
   set image_keys = array[image_key]
 where image_key is not null
   and image_keys is null
   and image_key not like 'data:%'
   and length(image_key) <= 300;

do $$
begin
  assert (select image_keys = array['posts/old/1.jpg'] from posts
           where id='cccccccc-0000-0000-0000-000000000001'),
    'an ordinary old pour should have been backfilled';
  assert (select image_keys is null from posts
           where id='cccccccc-0000-0000-0000-000000000002'),
    'a legacy base64 pour should have been SKIPPED, not copied into a constraint violation';
end $$;
\echo 'T11 PASS'

\echo '--- T12: re-running the WHOLE migration is safe ---'
-- Idempotence is not decoration here: the first attempt at this
-- migration failed in production on the CHECK constraint, so the second
-- attempt runs over whatever the first one left behind — and over rows
-- the fixtures above have since written. `\ir` is relative to this
-- file, so it finds the real migration whatever the working directory.
\ir ../step-1.28.sql
do $$
begin
  assert (select count(*) = 1 from information_schema.columns
           where table_name='posts' and column_name='image_keys'),
    'the column should survive a second run';
  assert (select count(*) = 1 from pg_constraint where conname='posts_image_keys_are_keys'),
    'the constraint should survive being dropped and re-added over live rows';
  assert (select cardinality(image_keys) = 3 from posts
           where id='aaaaaaaa-0000-0000-0000-000000000003'),
    'a three-photo pour should not be disturbed by a re-run';
  assert (select image_keys is null from posts
           where id='cccccccc-0000-0000-0000-000000000002'),
    'and the legacy base64 pour should still be skipped, not violated into';
end $$;
\echo 'T12 PASS'

\echo ''
\echo 'step-1.28: 12 passed'
