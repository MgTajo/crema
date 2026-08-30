-- ============================================================
-- Crema — the two things a person is allowed to do to their own data:
-- take a copy of it, and take it away.
--
-- Step 3.3 of brain/13-infrastructure-plan.md, and the gate in front of
-- Phase 4. App Store Review Guideline 5.1.1(v): an app that lets you
-- make an account must let you delete it from inside the app. GDPR
-- Art. 17 (erasure) and Art. 20 (portability) say the same thing for
-- everyone who never opens the App Store.
--
-- WHAT IS HERE, AND WHAT IS NOT
-- Deletion is NOT a delete function. It is `DELETE FROM auth.users`,
-- run by the delete-account Edge Function with the service-role key,
-- and every row that belongs to the person goes with it through the
-- foreign keys that were already there:
--
--     auth.users → profiles → posts → comments, likes, reactions,
--     saves, follows, user_gear, push_subscriptions, notifications,
--     challenge_*, daily_*, podium_*, recap_exports, reports, blocks,
--     cafe_follows, entry_votes, upload_grants
--
-- That is deliberate. A hand-written list of tables is a list that goes
-- stale the first time somebody adds a table and forgets, and "forgets"
-- here means personal data quietly outliving the person. The cascade
-- cannot forget, and account-deletion-test.sql proves it by asking the
-- catalogue which columns point at a profile rather than by naming them.
--
-- So what this file changes is the two things that made that cascade
-- unsafe to run, plus the export.
--
-- 1. WHY challenge_check() NEEDED A GUARD
--    `trg_challenge_check` fires AFTER DELETE on posts and on comments
--    and calls challenge_check(old.user_id), which can INSERT into
--    challenge_completions and notifications for that user. A cascade
--    deletes the profile row FIRST and its children after, so any such
--    insert references a profile that is already gone: 23503, and the
--    deletion fails outright.
--
--    ⚠️ Whether it is reached rests on something nobody should rest
--    anything on. Every challenge counts posts, so once the posts
--    cascade has run the user no longer qualifies and the function
--    takes its revoke branch instead. Measured here: the posts cascade
--    does run before the comments cascade, so the insert is not
--    reached, and account-deletion-test.sql passes with this guard and
--    without it. But that order is the order Postgres fires the
--    parent's referential-integrity triggers in, which follows the
--    order the constraints were created in — and production's
--    constraints were created by 26 hand-run step files, while this
--    chain's and staging's were created by the baseline dump. There is
--    no promise those agree, and the failure mode if they do not is a
--    person who cannot delete their account and an Edge Function
--    returning 500.
--
--    So the guard is not there because the test goes red without it.
--    It is there because the test CANNOT go red on the machine that
--    matters, and the cost of not depending on that is one index
--    lookup.
--
-- 2. WHY recalc_score() NEEDED THE SAME GUARD (performance, not safety)
--    `trg_score_owner` fires per row. Deleting an account with 200
--    pours ran user_points() 200 times to write to a profile row that
--    no longer exists — 200 aggregates over posts, likes, comments,
--    podium_wins and challenge_completions, every one of them a no-op.
--    Recalculating the score of a profile that does not exist has never
--    had a meaning; now it costs an index lookup instead of a scan.
--
--    ⚠️ Both are `create or replace` on functions that already exist and
--    are reached from several triggers. That is exactly the shape of
--    D-2026-08-30-02, where a rewritten function silently lost a branch
--    and nobody noticed for three days. Both bodies below are the
--    production bodies with a guard added at the top and NOTHING else
--    changed, and account-deletion-test.sql T5/T6 name every remaining
--    branch of both — the award, the notification, the revocation, the
--    points write and the level change — so a future rewrite that drops
--    one goes red.
--
-- 3. export_my_data() — Art. 15 and Art. 20, in one round trip.
--    One SECURITY DEFINER function returning one jsonb document, rather
--    than the twenty-odd PostgREST reads the client would otherwise
--    make. It reads by auth.uid() and takes no argument, so there is no
--    id to tamper with. SECURITY DEFINER because completeness is the
--    point: RLS hides some of a person's own rows from them by design
--    (client_errors is write-only, moderation_actions is admin-only),
--    and "everything we hold about you" cannot be answered by a query
--    that is only allowed to see the readable half.
--
-- WHAT DELETION DOES NOT REACH
--   * R2. The bucket has no foreign keys. The Edge Function empties the
--     `posts/<uid>/` prefix — every photo and avatar the account ever
--     uploaded lives under it — BEFORE it deletes the auth user, so a
--     failure there is a visible, retryable error rather than a silent
--     pile of orphaned photographs.
--   * moderation_actions. actor_id and subject_id are ON DELETE SET
--     NULL, so a decision survives the account it was about, with the
--     name gone. That is the DSA statement-of-reasons record, and it is
--     the one thing here that is meant to outlive the person.
--   * client_errors.user_id is ON DELETE SET NULL for the same reason,
--     decided when that table was written: the error stays, the person
--     does not.
--
-- Re-runnable: `create or replace` throughout, nothing dropped.
-- ============================================================

-- ------------------------------------------------------------
-- 1. recalc_score — unchanged except for the first two lines
-- ------------------------------------------------------------
create or replace function recalc_score(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pts int;
begin
  if uid is null then return; end if;
  -- Nothing to write to. Reached on every row of a cascading account
  -- deletion, where the profile is already gone and the aggregate below
  -- would be computed only to update zero rows.
  if not exists (select 1 from profiles where id = uid) then return; end if;
  pts := user_points(uid);
  update profiles
     set points = pts,
         level  = level_for_points(pts)
   where id = uid
     and (points is distinct from pts or level is distinct from level_for_points(pts));
end $$;

-- ------------------------------------------------------------
-- 2. challenge_check — unchanged except for the first two lines
-- ------------------------------------------------------------
create or replace function challenge_check(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c record; prog int;
begin
  if uid is null then return; end if;
  -- The profile is gone: there is nobody to award a challenge to, and
  -- both writes below would raise 23503 against a cascade that is
  -- halfway through removing this person. See the header.
  if not exists (select 1 from profiles where id = uid) then return; end if;
  for c in select * from challenges
            where starts_at <= now() and ends_at > now() and kind is not null
  loop
    prog := challenge_progress(uid, c.id);

    if prog >= c.goal then
      insert into challenge_completions (user_id, challenge_id, points)
      values (uid, c.id, c.points)
      on conflict (user_id, challenge_id) do nothing;

      -- Only announce it if the insert above was the one that landed.
      if found then
        insert into notifications (user_id, actor_id, type, challenge_id, body)
        values (uid, null, 'challenge', c.id,
                'Challenge complete: ' || c.title || ' · +' || c.points || ' points');
      end if;

    else
      -- Still live and no longer qualifying — they deleted or edited the
      -- pour that got them there. Take it back while the week is open.
      delete from challenge_completions
       where user_id = uid and challenge_id = c.id;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 3. export_my_data — everything we hold about the caller
-- ------------------------------------------------------------
-- Shape: one object, one key per table, arrays ordered oldest first so
-- the file reads as a history rather than as a database dump. Column
-- lists are written out rather than `select *`, so a column added later
-- is a deliberate decision to export it, not an accident — which is the
-- right default in both directions: a new secret is not leaked, and a
-- new personal field is a one-line change here with a test that names it.
--
-- Two deliberate redactions, both about somebody else:
--   * push_subscriptions carries p256dh and auth. Those are the keys a
--     server encrypts to, not facts about the person; exporting them
--     hands a copy of a credential to whatever reads the file.
--   * moderation_actions is included because a decision about you is
--     personal data about you (Art. 15), with actor_id left out because
--     who decided is personal data about the moderator.
create or replace function export_my_data() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); doc jsonb;
begin
  if uid is null then
    raise exception 'Sign in to export your data.' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'format',      'crema-export-1',
    'about',       'Everything Crema holds that is attached to your account. '
                   || 'Photographs are not in this file — the `image_key` and '
                   || '`image_keys` values below are their addresses, and each one '
                   || 'is reachable at https://media.crema-app.com/<key> while the '
                   || 'account exists.',
    'account', (select to_jsonb(x) from (
        select u.id, u.email, u.created_at, u.last_sign_in_at
          from auth.users u where u.id = uid) x),
    'profile', (select to_jsonb(x) from (
        select p.id, p.handle, p.name, p.city, p.bio, p.avatar_color, p.avatar_key,
               p.level, p.points, p.streak, p.premium, p.premium_at,
               p.machine_brand, p.machine_model, p.fav_drink, p.fav_milk,
               p.notify_social, p.notify_streak, p.notify_digest, p.notify_morning,
               p.notify_friends, p.tz_offset, p.suspended_until, p.suspended_reason,
               p.created_at
          from profiles p where p.id = uid) x),
    'posts', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select id, drink, art, pattern, quality, caption, cafe_id, recipe,
               image_key, image_keys, visibility, hidden_at, created_at, edited_at
          from posts where user_id = uid) x),
    'comments', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select id, post_id, body, hidden_at, created_at
          from comments where user_id = uid) x),
    'likes', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select post_id, created_at from likes where user_id = uid) x),
    'comment_likes', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select comment_id, created_at from comment_likes where user_id = uid) x),
    'reactions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select post_id, kind, created_at from reactions where user_id = uid) x),
    'saves', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select post_id, created_at from saves where user_id = uid) x),
    'following', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select followee_id, status, created_at from follows where follower_id = uid) x),
    'followers', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select follower_id, status, created_at from follows where followee_id = uid) x),
    'blocked', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select blocked_id, created_at from blocks where blocker_id = uid) x),
    'cafe_follows', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select cafe_id, created_at from cafe_follows where user_id = uid) x),
    'gear', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select kind, name, own, info, fav_at, created_at, updated_at
          from user_gear where user_id = uid) x),
    'challenge_joins', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select challenge_id, created_at from challenge_joins where user_id = uid) x),
    'challenge_entries', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select id, challenge_id, post_id, created_at
          from challenge_entries where user_id = uid) x),
    'challenge_completions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.completed_at), '[]'::jsonb) from (
        select challenge_id, points, completed_at
          from challenge_completions where user_id = uid) x),
    'entry_votes', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select entry_id, created_at from entry_votes where user_id = uid) x),
    'daily_firsts', (select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb) from (
        select day, post_id, created_at from daily_firsts where user_id = uid) x),
    'daily_champions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb) from (
        select day, post_id, points, created_at from daily_champions where user_id = uid) x),
    'podium_wins', (select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb) from (
        select day, post_id, place, points from podium_wins where user_id = uid) x),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select id, type, body, actor_id, post_id, challenge_id, cafe_id, read, created_at
          from notifications where user_id = uid) x),
    'push_subscriptions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select endpoint, tz_offset, lang, fail_count, last_seen, created_at
          from push_subscriptions where user_id = uid) x),
    'week_card_exports', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select week_start, kind, created_at from recap_exports where user_id = uid) x),
    'reports_you_filed', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select id, post_id, comment_id, user_id as reported_user_id, reason, note,
               status, resolution, created_at, resolved_at
          from reports where reporter_id = uid) x),
    'decisions_about_you', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select action, reason, statement, created_at
          from moderation_actions where subject_id = uid) x),
    'error_reports', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select message, source, app_version, lang, created_at
          from client_errors where user_id = uid) x),
    'photo_upload_grants', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
        select created_at from upload_grants where user_id = uid) x)
  ) into doc;

  return doc;
end $$;

-- Supabase's default privileges hand EXECUTE on every new function in
-- `public` to anon as well as authenticated, and `revoke ... from
-- public` does not take that back — the roles hold their own grant.
-- Same mechanism as claim_upload_slot() and mod_record(). anon has no
-- auth.uid() and would only ever get the exception, but a function that
-- reads auth.users is not one to leave reachable by an unauthenticated
-- key.
revoke all on function export_my_data() from public, anon, authenticated;
grant execute on function export_my_data() to authenticated;
