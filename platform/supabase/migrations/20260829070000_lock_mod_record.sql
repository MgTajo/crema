-- ============================================================
-- Crema — mod_record() is not a client API.
--
-- The first migration after the baseline, and the reason the baseline
-- work was worth doing: comparing production's privileges against what
-- the step files intend turned this up.
--
-- WHAT WAS WRONG
-- mod_record() is the shared audit writer behind mod_hide_post(),
-- mod_suspend_user() and the rest. Those all call mod_assert_admin()
-- first. mod_record() itself checks nothing — it was never meant to be
-- reached directly, so it was never given a guard.
--
-- Supabase's default privileges grant EXECUTE on every new function in
-- `public` to anon and authenticated. `revoke ... from public` does not
-- take that away, because the grant those roles hold is their own rather
-- than one inherited through PUBLIC — the same mechanism already
-- documented against the gear_* RPCs. So mod_record() was callable over
-- PostgREST by anybody with an account, and it is SECURITY DEFINER, so
-- RLS was not standing behind it either.
--
-- What that bought an attacker with a free account:
--   * a `moderation` notification, with any text they like, delivered to
--     any user id — an official statement of reasons, from Crema, drawn
--     in the inbox with a symbol rather than a face, and pushed to the
--     phone by push_on_notification()
--   * any open report resolved: status, resolved_at, resolved_by and
--     resolution set, and the reporter told it had been dealt with
--   * arbitrary rows in moderation_actions, the audit log itself
--
-- Reproduced against a local copy of the production schema on
-- 2026-08-29 by a profile with is_admin = false.
--
-- THE FIX
-- One revoke. The guarded entry points are SECURITY DEFINER and run as
-- their owner, so they keep calling mod_record() exactly as before —
-- the caller's own privileges are not what they use.
--
-- recalc_score() gets the same treatment: same mechanism, same lack of a
-- guard, no client that calls it. Its effect is idempotent, so this is
-- surface rather than a hole.
--
-- Re-runnable. Nothing is created, nothing is dropped, no row moves.
-- ============================================================

revoke all on function mod_record(text, text, text, text, uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;

revoke all on function recalc_score(uuid)
  from public, anon, authenticated;
