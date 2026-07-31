\set ON_ERROR_STOP on
\pset pager off

-- ============================================================
-- step-1.19: reactions, mutual follows, mentions, reminder defaults
--
--   ./supabase/local-test/run.sh step-1.19-test.sql
-- ============================================================

-- ---------- fixtures ----------
delete from notifications; delete from reactions; delete from likes;
delete from comments; delete from follows; delete from posts;
delete from profiles; delete from auth.users;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','a@e.com'),
  ('22222222-2222-2222-2222-222222222222','b@e.com'),
  ('33333333-3333-3333-3333-333333333333','c@e.com'),
  ('44444444-4444-4444-4444-444444444444','d@e.com');
insert into profiles (id, handle, name) values
  ('11111111-1111-1111-1111-111111111111','ann','Ann'),
  ('22222222-2222-2222-2222-222222222222','bo','Bo'),
  ('33333333-3333-3333-3333-333333333333','cy','Cy'),
  ('44444444-4444-4444-4444-444444444444','di','Di');
insert into posts (id, user_id, drink, caption, visibility, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Latte','Ann pour','public',now());

\echo '--- T1: new profiles get every reminder switched on ---'
do $$
begin
  assert (select notify_social and notify_streak and notify_digest
            from profiles where handle = 'ann'),
    'a fresh profile should have all three reminders on';
end $$;
\echo 'T1 PASS'

\echo '--- T2: accepting a request follows back ---'
-- Bo asks to follow Ann, exactly as the client may: pending, as itself.
-- Every "as a client" block below is wrapped in begin/commit on purpose:
-- SET LOCAL outside a transaction is a warning and a no-op, and a test
-- that quietly runs as superuser proves nothing about RLS.
begin;
  set local role authenticated;
  set local "test.uid" = '22222222-2222-2222-2222-222222222222';
  insert into follows (follower_id, followee_id, status)
  values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','pending');
commit;

\echo '--- T2a: a client may not insert itself as already accepted ---'
do $$
begin
  begin
    set local role authenticated;
    perform set_config('test.uid','33333333-3333-3333-3333-333333333333',true);
    insert into follows (follower_id, followee_id, status)
    values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','accepted');
    reset role;
    assert false, 'RLS should refuse a self-granted accepted follow';
  exception when insufficient_privilege then
    reset role;
  end;
end $$;

do $$
begin
  assert (select status from follows
           where follower_id='22222222-2222-2222-2222-222222222222'
             and followee_id='11111111-1111-1111-1111-111111111111') = 'pending',
    'a follow must start as a request';
  assert exists (select 1 from notifications
                  where type='follow_request'
                    and user_id='11111111-1111-1111-1111-111111111111'),
    'Ann should have been asked';
end $$;

-- Ann accepts.
begin;
  set local role authenticated;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';
  update follows set status='accepted'
   where follower_id='22222222-2222-2222-2222-222222222222'
     and followee_id='11111111-1111-1111-1111-111111111111';
commit;

select follower_id, followee_id, status from follows order by follower_id;

do $$
declare n int;
begin
  assert (select status from follows
           where follower_id='11111111-1111-1111-1111-111111111111'
             and followee_id='22222222-2222-2222-2222-222222222222') = 'accepted',
    'accepting must create the follow back';
  -- Bo hears "accepted your follow request" and nothing else about it.
  select count(*) into n from notifications
   where user_id='22222222-2222-2222-2222-222222222222' and type='follow';
  assert n = 1, 'Bo should get exactly one follow notification, got ' || n;
  -- and Ann is not told that she started following Bo, which she did not do
  select count(*) into n from notifications
   where user_id='11111111-1111-1111-1111-111111111111' and type='follow';
  assert n = 0, 'the follow-back must not notify the person who accepted, got ' || n;
  -- the answered request stops sitting in Ann's inbox
  assert not exists (select 1 from notifications where type='follow_request'),
    'the answered request should be gone';
end $$;
\echo 'T2 PASS'

\echo '--- T3: a request pending the other way is granted, not duplicated ---'
-- Cy asks Di; Di asks Cy; then Di accepts Cy. Both rows must end accepted
-- and the recursion must terminate.
begin;
  set local role authenticated;
  set local "test.uid" = '33333333-3333-3333-3333-333333333333';
  insert into follows (follower_id, followee_id, status)
  values ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444','pending');
commit;
begin;
  set local role authenticated;
  set local "test.uid" = '44444444-4444-4444-4444-444444444444';
  insert into follows (follower_id, followee_id, status)
  values ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','pending');
  -- Di accepts Cy's request
  update follows set status='accepted'
   where follower_id='33333333-3333-3333-3333-333333333333'
     and followee_id='44444444-4444-4444-4444-444444444444';
commit;

do $$
declare n int;
begin
  select count(*) into n from follows
   where status='accepted'
     and follower_id in ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444')
     and followee_id in ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444');
  assert n = 2, 'both directions should be accepted, got ' || n;
  select count(*) into n from follows
   where follower_id='44444444-4444-4444-4444-444444444444'
     and followee_id='33333333-3333-3333-3333-333333333333';
  assert n = 1, 'the pending row should have been promoted, not doubled';
end $$;
\echo 'T3 PASS'

\echo '--- T4: the backfill reciprocates follows that predate this ---'
-- A one-way accepted follow, written the way the old world left them.
delete from notifications;
alter table follows disable trigger user;
insert into follows (follower_id, followee_id, status)
values ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','accepted');
alter table follows enable trigger user;

select follows_backfill_mutual();

do $$
begin
  assert (select status from follows
           where follower_id='33333333-3333-3333-3333-333333333333'
             and followee_id='11111111-1111-1111-1111-111111111111') = 'accepted',
    'the backfill must mirror an existing one-way follow';
  assert not exists (select 1 from notifications),
    'the backfill must not notify anyone about history';
end $$;

-- Running it twice must change nothing.
select follows_backfill_mutual();
do $$
declare n int;
begin
  select count(*) into n from follows;
  assert n = 6, 'the backfill should be idempotent, got ' || n || ' rows';
  assert not exists (
    select 1 from follows a where a.status='accepted' and not exists (
      select 1 from follows b where b.follower_id=a.followee_id
        and b.followee_id=a.follower_id and b.status='accepted')),
    'every accepted follow must have its mirror';
end $$;
\echo 'T4 PASS'

\echo '--- T5: reactions insert, notify, and are worth nothing ---'
delete from notifications;
do $$ begin
  update profiles set points = 0, level = 1;
end $$;

begin;
  set local role authenticated;
  set local "test.uid" = '22222222-2222-2222-2222-222222222222';
  insert into reactions (user_id, post_id, kind) values
    ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001','art'),
    ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001','scene');
commit;

select kind, count(*) from reactions group by kind order by kind;

do $$
declare n int; pts int;
begin
  select count(*) into n from reactions
   where post_id='aaaaaaaa-0000-0000-0000-000000000001';
  assert n = 2, 'one person may hold several kinds on one pour, got ' || n;
  select count(*) into n from notifications where type='reaction';
  assert n = 2, 'each reaction notifies the author, got ' || n;
  -- The whole point: nothing about a reaction touches the score.
  select points into pts from profiles where handle='ann';
  assert pts = 0, 'reactions must not move points, got ' || pts;
end $$;
\echo 'T5 PASS'

\echo '--- T6: you cannot react to your own pour ---'
do $$
begin
  begin
    set local role authenticated;
    perform set_config('test.uid','11111111-1111-1111-1111-111111111111',true);
    insert into reactions (user_id, post_id, kind)
    values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','drink');
    reset role;
    assert false, 'RLS should have refused a self-reaction';
  exception when insufficient_privilege then
    reset role;
  end;
end $$;
\echo 'T6 PASS'

\echo '--- T7: removing a reaction takes the count with it ---'
begin;
  set local role authenticated;
  set local "test.uid" = '22222222-2222-2222-2222-222222222222';
  delete from reactions
   where user_id='22222222-2222-2222-2222-222222222222'
     and post_id='aaaaaaaa-0000-0000-0000-000000000001' and kind='art';
commit;
do $$
declare n int;
begin
  select count(*) into n from reactions where post_id='aaaaaaaa-0000-0000-0000-000000000001';
  assert n = 1, 'the other kind should survive, got ' || n;
end $$;
\echo 'T7 PASS'

\echo '--- T8: an unknown reaction kind is refused ---'
do $$
begin
  begin
    insert into reactions (user_id, post_id, kind)
    values ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001','vibes');
    assert false, 'the check constraint should have refused an unknown kind';
  exception when check_violation then null;
  end;
end $$;
\echo 'T8 PASS'

\echo '--- T9: @mentions notify the people named ---'
delete from notifications;
begin;
  set local role authenticated;
  set local "test.uid" = '22222222-2222-2222-2222-222222222222';
  -- Bo comments on Ann's pour, naming Cy (mixed case), Ann (the author),
  -- himself, and somebody who does not exist.
  insert into comments (post_id, user_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',
          'nice one @Cy — @ann you were right, ask @bo, not @nobody_at_all');
commit;

select type, p.handle as recipient, body from notifications n
  join profiles p on p.id = n.user_id order by type, p.handle;

do $$
declare n int;
begin
  assert exists (select 1 from notifications
                  where type='mention' and user_id='33333333-3333-3333-3333-333333333333'),
    'Cy was named and should have been told — case must not matter';
  select count(*) into n from notifications where type='mention';
  assert n = 1,
    'only Cy: the author already gets the comment notification, the commenter is himself, '
    'and @nobody_at_all is nobody. got ' || n;
  assert exists (select 1 from notifications
                  where type='commented on your pour'
                    and user_id='11111111-1111-1111-1111-111111111111'),
    'Ann should still get the ordinary comment notification';
end $$;
\echo 'T9 PASS'

\echo '--- T10: a comment with no mentions notifies nobody extra ---'
delete from notifications;
insert into comments (post_id, user_id, body)
values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',
        'an email is not a mention: hello@example.com');
do $$
declare n int;
begin
  select count(*) into n from notifications where type='mention';
  assert n = 0, 'an email address must not be read as a mention, got ' || n;
end $$;
\echo 'T10 PASS'

\echo '=== step-1.19: ALL PASS ==='
