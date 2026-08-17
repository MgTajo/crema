\set ON_ERROR_STOP on
\pset pager off

-- ============================================================
-- step-1.27: moderation — the assertions that matter
--
--   ./supabase/local-test/run.sh moderation-test.sql
--
-- Every "as a client" block is wrapped in begin/commit on purpose: SET
-- LOCAL outside a transaction is a warning and a no-op, and a test that
-- quietly runs as superuser proves nothing about RLS.
-- ============================================================

-- ---------- fixtures ----------
-- Supabase's connection role, which stub.sql has no reason to create:
-- PostgREST connects as `authenticator` and switches into anon /
-- authenticated per request. Two of the guards below tell an API request
-- from the operator by exactly that, so the tests for those have to
-- arrive through it. Everything else runs as postgres, as before.
do $$ begin
  begin create role authenticator noinherit; exception when duplicate_object then null; end;
end $$;
grant anon, authenticated, service_role to authenticator;
grant usage on schema public to authenticator;

delete from moderation_actions; delete from reports; delete from notifications;
delete from reactions; delete from likes; delete from comments; delete from follows;
delete from posts; delete from profiles; delete from auth.users;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','admin@e.com'),
  ('22222222-2222-2222-2222-222222222222','author@e.com'),
  ('33333333-3333-3333-3333-333333333333','reporter@e.com');
insert into profiles (id, handle, name, is_admin) values
  ('11111111-1111-1111-1111-111111111111','mod','Mod',true),
  ('22222222-2222-2222-2222-222222222222','ann','Ann',false),
  ('33333333-3333-3333-3333-333333333333','cy','Cy',false);

-- One from today (inside the edit window) and one from last week (well
-- outside it) — moderation has to reach both.
insert into posts (id, user_id, drink, caption, visibility, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','Latte','fresh','public',now()),
  ('aaaaaaaa-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Flat white','old','public',now()-interval '7 days');
insert into comments (id, post_id, user_id, body) values
  ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','a comment');
insert into reports (id, reporter_id, post_id, reason) values
  ('11111111-aaaa-0000-0000-000000000001','33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000002','abuse');

\echo '--- T1: a non-admin cannot moderate anything ---'
do $$
begin
  begin
    set local role authenticated;
    perform set_config('test.uid','22222222-2222-2222-2222-222222222222',true);
    perform mod_hide_post('aaaaaaaa-0000-0000-0000-000000000001','abuse','because');
    reset role;
    assert false, 'a plain user must not be able to hide a pour';
  exception when insufficient_privilege then
    reset role;   -- 42501, raised by mod_assert_admin
  end;
end $$;
\echo 'T1 PASS'

\echo '--- T2: an action with no statement of reasons is refused ---'
do $$
begin
  begin
    set local role authenticated;
    perform set_config('test.uid','11111111-1111-1111-1111-111111111111',true);
    perform mod_hide_post('aaaaaaaa-0000-0000-0000-000000000001','abuse','   ');
    reset role;
    assert false, 'a blank statement of reasons must be refused';
  exception when invalid_parameter_value then
    reset role;
  end;
end $$;
\echo 'T2 PASS'

\echo '--- T3: hiding a week-old pour works despite the 36-hour edit guard ---'
begin;
  set local role authenticated;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';
  select mod_hide_post('aaaaaaaa-0000-0000-0000-000000000002','abuse',
                       'Your pour was hidden because it broke the rule on abuse.',
                       '11111111-aaaa-0000-0000-000000000001') \gset hid_
commit;
do $$
begin
  assert (select hidden_at is not null from posts where id='aaaaaaaa-0000-0000-0000-000000000002'),
    'the pour should be hidden';
  assert (select hidden_by = '11111111-1111-1111-1111-111111111111'
            from posts where id='aaaaaaaa-0000-0000-0000-000000000002'),
    'the moderator should be recorded';
end $$;
\echo 'T3 PASS'

\echo '--- T4: the decision is on the record ---'
do $$
begin
  assert (select count(*) from moderation_actions
           where action='hide_post' and subject_id='22222222-2222-2222-2222-222222222222') = 1,
    'one audit row per decision';
  assert (select statement is not null and actor_id='11111111-1111-1111-1111-111111111111'
            from moderation_actions where action='hide_post'),
    'the audit row keeps the statement and the actor';
end $$;
\echo 'T4 PASS'

\echo '--- T5: the author is told, in words, and the reporter is told it was decided ---'
do $$
begin
  assert (select count(*) from notifications
           where user_id='22222222-2222-2222-2222-222222222222' and type='moderation') = 1,
    'the author gets a statement of reasons in their inbox';
  assert (select body like '%broke the rule%' from notifications
           where user_id='22222222-2222-2222-2222-222222222222' and type='moderation'),
    'the statement is the text the moderator wrote, not a code';
  assert (select count(*) from notifications
           where user_id='33333333-3333-3333-3333-333333333333' and type='report_update') = 1,
    'the reporter is told the report was decided';
end $$;
\echo 'T5 PASS'

\echo '--- T6: the report is closed, with who and when ---'
do $$
begin
  assert (select status='actioned' and resolved_at is not null
            and resolved_by='11111111-1111-1111-1111-111111111111'
            from reports where id='11111111-aaaa-0000-0000-000000000001'),
    'the report should be resolved by the moderator who acted';
end $$;
\echo 'T6 PASS'

\echo '--- T7: a hidden pour is invisible to everyone but its author and an admin ---'
do $$
declare seen int;
begin
  -- a stranger
  begin
    set local role authenticated;
    perform set_config('test.uid','33333333-3333-3333-3333-333333333333',true);
    select count(*) into seen from posts where id='aaaaaaaa-0000-0000-0000-000000000002';
    reset role;
  end;
  assert seen = 0, 'a stranger must not see a hidden pour';

  -- a signed-out visitor
  begin
    set local role anon;
    perform set_config('test.uid','',true);
    select count(*) into seen from posts where id='aaaaaaaa-0000-0000-0000-000000000002';
    reset role;
  end;
  assert seen = 0, 'a guest must not see a hidden pour';

  -- its author, who should
  begin
    set local role authenticated;
    perform set_config('test.uid','22222222-2222-2222-2222-222222222222',true);
    select count(*) into seen from posts where id='aaaaaaaa-0000-0000-0000-000000000002';
    reset role;
  end;
  assert seen = 1, 'the author still sees their own hidden pour';

  -- the moderator, who has to
  begin
    set local role authenticated;
    perform set_config('test.uid','11111111-1111-1111-1111-111111111111',true);
    select count(*) into seen from posts where id='aaaaaaaa-0000-0000-0000-000000000002';
    reset role;
  end;
  assert seen = 1, 'an admin sees hidden content';
end $$;
\echo 'T7 PASS'

\echo '--- T8: the author cannot un-hide their own pour ---'
-- The guards deliberately let the operator through: they bound what an
-- end user can do, not what the SQL editor can. `session_user` is how
-- they tell the two apart, and every other test here runs as postgres —
-- which the guard reads as the operator, so it would wave the update
-- past and the test would prove nothing.
--
-- SET SESSION AUTHORIZATION is what makes this session look like a
-- PostgREST request: `authenticator` connects, then switches role. It
-- cannot be run inside a function, so it sits out here and the DO block
-- below inherits it.
begin;
  set local session authorization authenticator;
  set local role authenticated;
  set local "test.uid" = '22222222-2222-2222-2222-222222222222';
  do $$
  begin
    begin
      update posts set hidden_at = null where id='aaaaaaaa-0000-0000-0000-000000000002';
      assert false, 'the author must not be able to clear moderation state';
    exception when raise_exception then null;   -- 'moderation state cannot be changed here'
    end;
  end $$;
commit;
do $$
begin
  assert (select hidden_at is not null from posts where id='aaaaaaaa-0000-0000-0000-000000000002'),
    'the pour should still be hidden';
end $$;
\echo 'T8 PASS'

\echo '--- T9: a hidden pour cannot take the podium ---'
-- Give the hidden pour the engagement that would otherwise win the day.
insert into likes (user_id, post_id) values
  ('33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000002');
do $$
begin
  assert (select count(*) from podium_top(
            (select (created_at at time zone 'Europe/Berlin')::date
               from posts where id='aaaaaaaa-0000-0000-0000-000000000002'))) = 0,
    'a hidden pour must not appear on the podium';
end $$;
\echo 'T9 PASS'

\echo '--- T10: suspension stops posting and commenting, and nothing else ---'
begin;
  set local role authenticated;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';
  select mod_suspend_user('22222222-2222-2222-2222-222222222222', 7, 'repeat abuse',
                          'Your account is paused for seven days.') as a \gset s_
commit;
do $$
declare ok bool;
begin
  assert (select suspended_until > now() from profiles where handle='ann'), 'the suspension should be live';

  begin
    set local role authenticated;
    perform set_config('test.uid','22222222-2222-2222-2222-222222222222',true);
    insert into posts (user_id, drink, visibility)
    values ('22222222-2222-2222-2222-222222222222','Latte','public');
    reset role;
    assert false, 'a suspended account must not be able to post';
  exception when insufficient_privilege then
    reset role;
  end;

  begin
    set local role authenticated;
    perform set_config('test.uid','22222222-2222-2222-2222-222222222222',true);
    insert into comments (post_id, user_id, body)
    values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','hello');
    reset role;
    assert false, 'a suspended account must not be able to comment';
  exception when insufficient_privilege then
    reset role;
  end;

  -- and an unsuspended account is unaffected by any of this
  begin
    set local role authenticated;
    perform set_config('test.uid','33333333-3333-3333-3333-333333333333',true);
    insert into comments (post_id, user_id, body)
    values ('aaaaaaaa-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333','still fine');
    reset role;
  end;
end $$;
\echo 'T10 PASS'

\echo '--- T11: nobody can promote themselves to admin from a client ---'
-- Same reason as T8: this has to arrive the way a PATCH from the app
-- arrives, or the guard reads it as the operator and lets it through.
begin;
  set local session authorization authenticator;
  set local role authenticated;
  set local "test.uid" = '33333333-3333-3333-3333-333333333333';
  update profiles set is_admin = true where id='33333333-3333-3333-3333-333333333333';
commit;
begin;
  set local session authorization authenticator;
  set local role authenticated;
  set local "test.uid" = '22222222-2222-2222-2222-222222222222';
  update profiles set suspended_until = null where id='22222222-2222-2222-2222-222222222222';
commit;
do $$
begin
  assert not (select is_admin from profiles where handle='cy'),
    'a client PATCH raising is_admin must be silently reverted';
  assert (select suspended_until is not null from profiles where handle='ann'),
    'a suspended user must not be able to lift their own suspension';
end $$;
\echo 'T11 PASS'

\echo '--- T12: the moderation log survives what it destroys ---'
begin;
  set local role authenticated;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';
  select mod_delete_post('aaaaaaaa-0000-0000-0000-000000000001','abuse',
                         'Your pour was removed because it broke the rule on abuse.') as a \gset d_
commit;
do $$
begin
  assert (select count(*) from posts where id='aaaaaaaa-0000-0000-0000-000000000001') = 0,
    'the pour should be gone';
  assert (select count(*) from moderation_actions where action='delete_post') = 1,
    'the decision should still be on the record';
  assert (select evidence->>'caption' = 'fresh' from moderation_actions where action='delete_post'),
    'the record keeps what it destroyed, including the R2 key';
end $$;
\echo 'T12 PASS'

\echo '--- T13: unhiding puts it back, and says so ---'
begin;
  set local role authenticated;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';
  select mod_unhide_post('aaaaaaaa-0000-0000-0000-000000000002','restored on review',
                         'We looked again and put your pour back.') as a \gset u_
commit;
do $$
declare seen int;
begin
  assert (select hidden_at is null from posts where id='aaaaaaaa-0000-0000-0000-000000000002'),
    'the pour should be visible again';
  begin
    set local role anon;
    perform set_config('test.uid','',true);
    select count(*) into seen from posts where id='aaaaaaaa-0000-0000-0000-000000000002';
    reset role;
  end;
  assert seen = 1, 'a guest sees a restored pour again';
  assert (select count(*) from moderation_actions where action='unhide_post') = 1,
    'putting something back is a decision too';
end $$;
\echo 'T13 PASS'

\echo '--- T14: the queue and the log are admin-only ---'
do $$
begin
  begin
    set local role authenticated;
    perform set_config('test.uid','33333333-3333-3333-3333-333333333333',true);
    perform mod_queue('all');
    reset role;
    assert false, 'a non-admin must not read the report queue';
  exception when insufficient_privilege then
    reset role;
  end;
end $$;
begin;
  set local role authenticated;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';
  select jsonb_array_length(mod_queue('all')) as n \gset q_
  select jsonb_array_length(mod_log(100))   as n \gset l_
commit;
\echo 'T14 PASS'

\echo '--- T15: a dismissal is recorded as a decision, not as silence ---'
insert into reports (id, reporter_id, post_id, reason) values
  ('11111111-aaaa-0000-0000-000000000002','33333333-3333-3333-3333-333333333333',
   'aaaaaaaa-0000-0000-0000-000000000002','spam');
begin;
  set local role authenticated;
  set local "test.uid" = '11111111-1111-1111-1111-111111111111';
  select mod_dismiss_report('11111111-aaaa-0000-0000-000000000002','no violation found') as a \gset x_
commit;
do $$
begin
  assert (select status = 'dismissed' from reports where id='11111111-aaaa-0000-0000-000000000002'),
    'the report should be dismissed';
  assert (select count(*) from moderation_actions where action='dismiss') = 1,
    'a dismissal writes an audit row';
  assert (select count(*) from notifications
           where user_id='33333333-3333-3333-3333-333333333333' and type='report_update') = 2,
    'the reporter is told about a dismissal too';
end $$;
\echo 'T15 PASS'

\echo '--- T16: the export counter is the user own row, and only theirs ---'
begin;
  set local role authenticated;
  set local "test.uid" = '33333333-3333-3333-3333-333333333333';
  insert into recap_exports (user_id, week_start, kind)
  values ('33333333-3333-3333-3333-333333333333', current_date, 'share');
commit;
do $$
declare seen int;
begin
  begin
    set local role authenticated;
    perform set_config('test.uid','22222222-2222-2222-2222-222222222222',true);
    select count(*) into seen from recap_exports;
    reset role;
  end;
  assert seen = 0, 'one user must not be able to read another user exports';

  begin
    set local role authenticated;
    perform set_config('test.uid','22222222-2222-2222-2222-222222222222',true);
    begin
      insert into recap_exports (user_id, week_start)
      values ('33333333-3333-3333-3333-333333333333', current_date);
      reset role;
      raise exception 'a user must not be able to log an export as somebody else';
    exception when insufficient_privilege then
      reset role;
    end;
  end;
end $$;
\echo 'T16 PASS'

\echo '=== moderation: all assertions passed ==='
