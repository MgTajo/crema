\set ON_ERROR_STOP on
\pset pager off

-- ---------- fixtures ----------
-- Five people, each with one pour created today (Berlin), plus edge cases.
delete from notifications; delete from likes; delete from posts; delete from podium_places;
delete from profiles; delete from auth.users;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','a@e.com'),
  ('22222222-2222-2222-2222-222222222222','b@e.com'),
  ('33333333-3333-3333-3333-333333333333','c@e.com'),
  ('44444444-4444-4444-4444-444444444444','d@e.com'),
  ('55555555-5555-5555-5555-555555555555','e@e.com'),
  ('66666666-6666-6666-6666-666666666666','f@e.com');

insert into profiles (id, handle, name) values
  ('11111111-1111-1111-1111-111111111111','ann','Ann'),
  ('22222222-2222-2222-2222-222222222222','bo','Bo'),
  ('33333333-3333-3333-3333-333333333333','cy','Cy'),
  ('44444444-4444-4444-4444-444444444444','di','Di'),
  ('55555555-5555-5555-5555-555555555555','ed','Ed'),
  ('66666666-6666-6666-6666-666666666666','fi','Fi');

-- "Now" in Berlin terms, so the fixtures land in today's podium day
-- regardless of when the test runs.
insert into posts (id, user_id, drink, caption, visibility, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Latte','Ann today',   'public',    now()),
  ('bbbbbbbb-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Latte','Bo today',    'public',    now()),
  ('cccccccc-0000-0000-0000-000000000003','33333333-3333-3333-3333-333333333333','Latte','Cy today',    'public',    now()),
  ('dddddddd-0000-0000-0000-000000000004','44444444-4444-4444-4444-444444444444','Latte','Di today',    'public',    now()),
  -- followers-only: must never reach a public board
  ('eeeeeeee-0000-0000-0000-000000000005','55555555-5555-5555-5555-555555555555','Latte','Ed private',  'followers', now()),
  -- yesterday, heavily liked: must not crowd out today
  ('ffffffff-0000-0000-0000-000000000006','66666666-6666-6666-6666-666666666666','Latte','Fi yesterday','public',    now() - interval '1 day');

\echo '--- T1: places are 1,2,3 by likes ---'
-- Ann 5, Bo 3, Cy 2, Di 1, Ed(private) 9, Fi(yesterday) 99
insert into likes (post_id, user_id)
select 'aaaaaaaa-0000-0000-0000-000000000001', id from profiles limit 5;
insert into likes (post_id, user_id)
select 'bbbbbbbb-0000-0000-0000-000000000002', id from profiles limit 3;
insert into likes (post_id, user_id)
select 'cccccccc-0000-0000-0000-000000000003', id from profiles limit 2;
insert into likes (post_id, user_id)
select 'dddddddd-0000-0000-0000-000000000004', id from profiles limit 1;
insert into likes (post_id, user_id)
select 'eeeeeeee-0000-0000-0000-000000000005', id from profiles limit 6;
insert into likes (post_id, user_id)
select 'ffffffff-0000-0000-0000-000000000006', id from profiles limit 6;

select place, name, like_count, caption from podium_today order by place;

do $$
declare n int;
begin
  select count(*) into n from podium_today;
  assert n = 3, 'podium must hold exactly 3, got ' || n;
  assert (select caption from podium_today where place = 1) = 'Ann today', '1st wrong';
  assert (select caption from podium_today where place = 2) = 'Bo today',  '2nd wrong';
  assert (select caption from podium_today where place = 3) = 'Cy today',  '3rd wrong';
  assert not exists (select 1 from podium_today where caption = 'Ed private'),   'private pour leaked onto podium';
  assert not exists (select 1 from podium_today where caption = 'Fi yesterday'), 'yesterday leaked onto podium';
end $$;
\echo 'T1 PASS'

\echo '--- T2: each podium author was notified of their place ---'
select p.name, n.body from notifications n join profiles p on p.id = n.user_id
 where n.type = 'podium' order by p.name;

do $$
begin
  assert (select count(*) from notifications where type = 'podium') = 3,
         'expected 3 podium notifications, got ' || (select count(*) from notifications where type='podium');
  assert (select body from notifications where type='podium' and user_id='11111111-1111-1111-1111-111111111111')
         like '%1st place%', 'Ann not told 1st';
  assert (select body from notifications where type='podium' and user_id='22222222-2222-2222-2222-222222222222')
         like '%2nd place%', 'Bo not told 2nd';
  assert (select body from notifications where type='podium' and user_id='33333333-3333-3333-3333-333333333333')
         like '%3rd place%', 'Cy not told 3rd';
  -- deep link must be present so the push opens the pour
  assert not exists (select 1 from notifications where type='podium' and post_id is null),
         'podium notification without post_id';
end $$;
\echo 'T2 PASS'

\echo '--- T3: re-running the sweep announces nothing new (idempotent) ---'
select podium_check(); select podium_check();
do $$
begin
  assert (select count(*) from notifications where type='podium') = 3,
         'sweep re-announced: ' || (select count(*) from notifications where type='podium');
end $$;
\echo 'T3 PASS'

\echo '--- T4: overtaking re-announces both movers ---'
-- Di (was off the board with 1) jumps to 9 likes -> 1st. Everyone shifts.
insert into likes (post_id, user_id)
select 'dddddddd-0000-0000-0000-000000000004', id from profiles
 where id not in (select user_id from likes where post_id='dddddddd-0000-0000-0000-000000000004');

select place, name, like_count from podium_today order by place;
select p.name, n.body, n.created_at from notifications n join profiles p on p.id=n.user_id
 where n.type='podium' order by n.created_at;

do $$
begin
  assert (select caption from podium_today where place=1) = 'Di today', 'Di did not take 1st';
  assert (select caption from podium_today where place=2) = 'Ann today', 'Ann did not fall to 2nd';
  assert (select caption from podium_today where place=3) = 'Bo today',  'Bo did not fall to 3rd';
  -- Cy was pushed off entirely and must NOT have been re-notified
  assert (select count(*) from notifications
           where type='podium' and user_id='33333333-3333-3333-3333-333333333333') = 1,
         'Cy notified again after falling off';
  -- Di is new on the board, Ann and Bo changed place: 3 new rows
  assert (select count(*) from notifications where type='podium') = 6,
         'expected 6 podium notifications total, got ' || (select count(*) from notifications where type='podium');
end $$;
\echo 'T4 PASS'

\echo '--- T5: falling off then climbing back announces again ---'
delete from likes where post_id = 'dddddddd-0000-0000-0000-000000000004';
do $$
begin
  assert (select caption from podium_today where place=1) = 'Ann today', 'Ann did not retake 1st';
  assert (select count(*) from notifications
           where type='podium' and user_id='33333333-3333-3333-3333-333333333333') = 2,
         'Cy was not re-announced on returning to the podium';
  assert not exists (select 1 from podium_places pp
                      where pp.post_id='dddddddd-0000-0000-0000-000000000004'
                        and pp.day = podium_day()),
         'Di kept a bookmark after leaving the podium';
end $$;
\echo 'T5 PASS'

\echo '--- T6: deleting the leading pour reshuffles the board ---'
delete from posts where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select place, caption from podium_today order by place;
do $$
begin
  assert (select caption from podium_today where place=1) = 'Bo today', 'board did not reshuffle after delete';
  assert not exists (select 1 from podium_places where post_id='aaaaaaaa-0000-0000-0000-000000000001'),
         'bookmark survived its post';
end $$;
\echo 'T6 PASS'

\echo '--- T7: a pour going followers-only leaves the board ---'
update posts set visibility='followers' where id='bbbbbbbb-0000-0000-0000-000000000002';
do $$
begin
  assert not exists (select 1 from podium_today where caption='Bo today'),
         'a pour made private stayed on the public podium';
end $$;
\echo 'T7 PASS'

\echo '--- T8: zero likes means an empty podium, not a board of zeroes ---'
delete from likes;
do $$
begin
  assert (select count(*) from podium_today) = 0, 'unliked pours appeared on the podium';
end $$;
\echo 'T8 PASS'

\echo '--- T9: the cron safety net registers where pg_cron exists ---'
-- The local stub has no pg_extension row for pg_cron, so step-1.18's guard
-- correctly takes the "not installed" branch here. What this checks is the
-- part that could actually be wrong on Supabase: that the nested
-- dollar-quoted command parses and registers.
select cron.schedule('crema-podium', '4 * * * *', $c$ select podium_check(); $c$);
select jobname, schedule, command from cron.job where jobname = 'crema-podium';
do $$
begin
  assert exists (select 1 from cron.job where jobname='crema-podium' and command like '%podium_check%'),
         'podium sweep not scheduled';
end $$;
\echo 'T9 PASS'

\echo '--- T10: podium_places is not client-readable ---'
do $$
begin
  assert (select relrowsecurity from pg_class where relname='podium_places'), 'RLS not enabled';
  assert not exists (select 1 from pg_policies where tablename='podium_places'),
         'podium_places has a policy — it should be deny-all';
end $$;
\echo 'T10 PASS'

\echo '--- T11: comments count toward the podium, worth 1 point same as a like ---'
delete from daily_champions; delete from daily_firsts; delete from notifications; delete from likes; delete from comments; delete from posts; delete from podium_places; delete from podium_wins;
insert into posts (id, user_id, drink, caption, visibility, created_at) values
  ('11110000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Latte','Few likes, lots of talk','public', now()),
  ('22220000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Latte','Many likes, no comments','public', now()),
  ('33330000-0000-0000-0000-000000000003','33333333-3333-3333-3333-333333333333','Latte','Nothing at all',        'public', now());

-- Ann: 2 likes + 4 comments from others = 6
insert into likes (post_id, user_id) values
  ('11110000-0000-0000-0000-000000000001','55555555-5555-5555-5555-555555555555'),
  ('11110000-0000-0000-0000-000000000001','66666666-6666-6666-6666-666666666666');
insert into comments (post_id, user_id, body) values
  ('11110000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','nice'),
  ('11110000-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333','wow'),
  ('11110000-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444444','love it'),
  ('11110000-0000-0000-0000-000000000001','55555555-5555-5555-5555-555555555555','same');
-- Bo: 5 likes, no comments = 5
insert into likes (post_id, user_id)
select '22220000-0000-0000-0000-000000000002', id from profiles
 where id in ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333',
              '44444444-4444-4444-4444-444444444444','55555555-5555-5555-5555-555555555555',
              '66666666-6666-6666-6666-666666666666');

select place, caption, like_count, comment_count from podium_today order by place;

do $$
begin
  -- 6 > 5: Ann's comment-heavy pour outranks Bo's, despite fewer likes (2 vs 5),
  -- because a comment is worth exactly as much as a like now (1 each), not
  -- the 3-vs-2 weighting user_points() uses for the ordinary profile score.
  assert (select caption from podium_today where place=1) = 'Few likes, lots of talk',
         'comments did not count toward the podium at the documented 1-point weight';
  assert (select caption from podium_today where place=2) = 'Many likes, no comments',
         'like-only pour did not take 2nd';
  assert (select comment_count from podium_today where place=1) = 4,
         'comment_count on the podium row must be the true total, not the self-excluded scoring count';
  assert not exists (select 1 from podium_today where caption='Nothing at all'),
         'a pour with zero engagement reached the podium';
end $$;
\echo 'T11 PASS'

\echo '--- T12: a pour can reach the podium on comments alone, zero likes ---'
delete from daily_champions; delete from daily_firsts; delete from notifications; delete from likes; delete from comments; delete from posts; delete from podium_places;
insert into posts (id, user_id, drink, caption, visibility, created_at) values
  ('55550000-0000-0000-0000-000000000005','55555555-5555-5555-5555-555555555555','Filter','Zero likes, one comment','public', now());
insert into comments (post_id, user_id, body) values
  ('55550000-0000-0000-0000-000000000005','66666666-6666-6666-6666-666666666666','first!');

select place, caption, like_count, comment_count from podium_today order by place;
do $$
begin
  assert (select count(*) from podium_today) = 1, 'a comment-only pour did not reach the podium';
  assert (select like_count from podium_today limit 1) = 0, 'fixture drifted: expected zero likes';
end $$;
\echo 'T12 PASS'

\echo '--- T13: commenting on your own pour does not buy a place ---'
delete from daily_champions; delete from daily_firsts; delete from notifications; delete from likes; delete from comments; delete from posts; delete from podium_places;
insert into posts (id, user_id, drink, caption, visibility, created_at) values
  ('66660000-0000-0000-0000-000000000006','66666666-6666-6666-6666-666666666666','Filter','Self-talk','public', now());
insert into comments (post_id, user_id, body) values
  ('66660000-0000-0000-0000-000000000006','66666666-6666-6666-6666-666666666666','talking to myself'),
  ('66660000-0000-0000-0000-000000000006','66666666-6666-6666-6666-666666666666','still here');
do $$
begin
  assert (select count(*) from podium_today) = 0,
         'a pour reached the podium on the author''s own comments — self-comments must not score';
end $$;
\echo 'T13 PASS'

\echo '--- T14: podium_award_day() refuses to settle today ---'
delete from daily_champions; delete from daily_firsts; delete from notifications; delete from likes; delete from comments; delete from posts; delete from podium_places; delete from podium_wins;
insert into posts (id, user_id, drink, caption, visibility, created_at) values
  ('77770000-0000-0000-0000-000000000007','11111111-1111-1111-1111-111111111111','Latte','Still today','public', now());
insert into likes (post_id, user_id) values ('77770000-0000-0000-0000-000000000007','22222222-2222-2222-2222-222222222222');
select podium_award_day(podium_day());
do $$
begin
  assert (select count(*) from podium_wins) = 0, 'a day that is still today got paid out';
end $$;
\echo 'T14 PASS'

\echo '--- T15: a settled day pays 15/10/5 and moves profiles.points ---'
delete from daily_champions; delete from daily_firsts; delete from notifications; delete from likes; delete from comments; delete from posts; delete from podium_places; delete from podium_wins;
insert into posts (id, user_id, drink, caption, visibility, created_at) values
  ('88880000-0000-0000-0000-000000000008','11111111-1111-1111-1111-111111111111','Latte','Yesterday gold',  'public', now() - interval '1 day'),
  ('99990000-0000-0000-0000-000000000009','22222222-2222-2222-2222-222222222222','Latte','Yesterday silver','public', now() - interval '1 day'),
  ('aaaa0000-0000-0000-0000-00000000000a','33333333-3333-3333-3333-333333333333','Latte','Yesterday bronze','public', now() - interval '1 day');
insert into likes (post_id, user_id)
select '88880000-0000-0000-0000-000000000008', id from profiles
 where id in ('44444444-4444-4444-4444-444444444444','55555555-5555-5555-5555-555555555555','66666666-6666-6666-6666-666666666666');
insert into likes (post_id, user_id) values
  ('99990000-0000-0000-0000-000000000009','44444444-4444-4444-4444-444444444444'),
  ('99990000-0000-0000-0000-000000000009','55555555-5555-5555-5555-555555555555');
insert into likes (post_id, user_id) values ('aaaa0000-0000-0000-0000-00000000000a','44444444-4444-4444-4444-444444444444');

select points, level from profiles where id in
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333')
 order by id;

select podium_award_day(podium_day() - 1);

select day, place, points from podium_wins order by place;
select p.name, p.points from profiles p where p.name in ('Ann','Bo','Cy') order by p.name;

do $$
begin
  assert (select points from podium_wins where user_id='11111111-1111-1111-1111-111111111111') = 15, '1st did not pay 15';
  assert (select points from podium_wins where user_id='22222222-2222-2222-2222-222222222222') = 10, '2nd did not pay 10';
  assert (select points from podium_wins where user_id='33333333-3333-3333-3333-333333333333') = 5,  '3rd did not pay 5';
  -- user_points() counts everything, not just the podium bonus: the pour
  -- itself (+10) plus 2 points per like it received (the ordinary profile
  -- score, unrelated to the podium's own 1-point-per-like ranking weight)
  -- plus the podium bonus, plus — since step-1.31 — 20 for being the
  -- first pour in ALL of Crema that day, which only ONE of these three
  -- can be: Ann's is inserted first, so Ann has it and the other two do
  -- not. (A championship outlives the pour that won it on purpose, so
  -- every fixture reset in this file clears daily_champions too;
  -- without that yesterday's race would already be decided here.)
  -- Ann's post got 3 likes, Bo's 2, Cy's 1 (the fixture above), so:
  --   10 + 3*2 + 15 + 20 = 51, 10 + 2*2 + 10 = 24, 10 + 1*2 + 5 = 17.
  assert (select points from profiles where id='11111111-1111-1111-1111-111111111111') = 51,
         'podium win did not reach profiles.points via recalc_score() for 1st';
  assert (select points from profiles where id='22222222-2222-2222-2222-222222222222') = 24,
         'podium win did not reach profiles.points via recalc_score() for 2nd';
  assert (select points from profiles where id='33333333-3333-3333-3333-333333333333') = 17,
         'podium win did not reach profiles.points via recalc_score() for 3rd';
end $$;
\echo 'T15 PASS'

\echo '--- T16: settling twice does not pay twice ---'
select podium_award_day(podium_day() - 1);
select podium_award_recent();
do $$
begin
  assert (select count(*) from podium_wins) = 3, 're-running the award sweep changed the winner count';
  assert (select points from profiles where id='11111111-1111-1111-1111-111111111111') = 51,
         're-settling an already-paid day changed the score';
end $$;
\echo 'T16 PASS'

\echo '--- T17: a late like on an old, previously-unplaced pour must not add a 4th winner ---'
insert into posts (id, user_id, drink, caption, visibility, created_at) values
  ('bbbb0000-0000-0000-0000-00000000000b','44444444-4444-4444-4444-444444444444','Latte','Yesterday, unnoticed','public', now() - interval '1 day');
-- Give it more likes than yesterday's bronze medalist would have needed —
-- if the day were re-evaluated from scratch this pour would outrank Cy.
insert into likes (post_id, user_id)
select 'bbbb0000-0000-0000-0000-00000000000b', id from profiles
 where id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
              '33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555');
select podium_award_day(podium_day() - 1);
select podium_award_recent();
do $$
begin
  assert (select count(*) from podium_wins where day = podium_day() - 1) = 3,
         'a late like on an old pour bought it a 4th podium win on an already-settled day';
  assert not exists (select 1 from podium_wins where post_id='bbbb0000-0000-0000-0000-00000000000b'),
         'the late-liked pour was paid even though the day it belongs to is already settled';
end $$;
\echo 'T17 PASS'

\echo '--- T18: podium_award_day() and podium_award_recent() are not client-callable ---'
begin;
  set local role authenticated;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';
  do $$
  begin
    begin
      perform podium_award_day(podium_day() - 1);
      raise exception 'podium_award_day was callable by an authenticated client';
    exception when insufficient_privilege then null;
    end;
    begin
      perform podium_award_recent();
      raise exception 'podium_award_recent was callable by an authenticated client';
    exception when insufficient_privilege then null;
    end;
  end $$;
rollback;
\echo 'T18 PASS'

\echo 'ALL PODIUM TESTS PASSED'
