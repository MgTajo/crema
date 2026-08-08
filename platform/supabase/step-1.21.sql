-- ============================================================
-- Crema — step 1.21: Premium is a code, not a switch
--
-- Run after step-1.20.sql. Re-runnable.
--
-- Until now Premium was a boolean anyone could set: the settings
-- sheet flipped `profiles.premium` and PATCHed the row, and the RLS
-- policy — quite correctly, for every other column — let them, because
-- it is their row. That was fine while Premium meant "pin a coffee",
-- and it stops being fine the moment Premium means something worth
-- having. Anyone reading the network tab had it for free.
--
-- So the column stops being writable by its owner in one direction.
-- Turning Premium OFF stays theirs — nobody should need permission to
-- give something up, and a downgrade that needs a support mail is a
-- dark pattern. Turning it ON goes through redeem_premium(), which is
-- the only thing that can raise the flag, and which wants the code.
--
-- The guard reverts rather than raises. A PATCH from the settings form
-- carries every profile column including `premium`, so an exception
-- would fail the save of a name change for a field the user never
-- touched. Silently keeping the old value is the honest behaviour:
-- the write succeeds, the flag doesn't move, and the only way it moves
-- is the function below.
--
-- Everyone who switched Premium on under the old rules is reset here.
-- That is deliberate and it is the point of the step: the free period
-- is now something asked for, and the app says so.
-- ============================================================

-- When the code was redeemed, so the free cohort is identifiable when
-- billing arrives — you cannot fairly grandfather people you can't
-- name. Nullable and never read by the client.
alter table profiles add column if not exists premium_at timestamptz;

-- ============================================================
-- 1. THE GUARD
-- ============================================================
-- current_setting(..., true) is the missing_ok form: outside a redeem
-- the setting does not exist at all, which reads as '' and blocks.
create or replace function premium_guard()
returns trigger language plpgsql as $$
begin
  if new.premium and not coalesce(old.premium, false)
     and coalesce(current_setting('crema.redeem', true), '') <> 'ok' then
    new.premium := old.premium;
  end if;
  return new;
end $$;

drop trigger if exists profiles_premium_guard on profiles;
create trigger profiles_premium_guard
  before update on profiles
  for each row execute function premium_guard();

-- ============================================================
-- 2. THE CODE
-- ============================================================
-- security definer so it can write past the guard and past RLS; the
-- set_config is transaction-local (the third argument), so the
-- permission it grants dies with the statement rather than lingering
-- on a pooled connection.
--
-- Normalised the same way src/domain/premium.js normalises it — case
-- and punctuation stripped — so "first pour" typed on a phone
-- keyboard is the same code as the one in the mail. Keep the two in
-- step: this string and PREMIUM_CODE are the same fact written twice.
create or replace function redeem_premium(code text)
returns boolean language plpgsql security definer set search_path = public as $$
declare want constant text := 'FIRSTPOUR';
begin
  if auth.uid() is null then return false; end if;
  if upper(regexp_replace(coalesce(code, ''), '[^a-zA-Z0-9]', '', 'g')) <> want then
    return false;
  end if;

  perform set_config('crema.redeem', 'ok', true);
  update profiles
     set premium    = true,
         premium_at = coalesce(premium_at, now())
   where id = auth.uid();
  perform set_config('crema.redeem', '', true);

  return true;
end $$;

revoke all on function redeem_premium(text) from public;
grant execute on function redeem_premium(text) to authenticated;

-- ============================================================
-- 3. EVERYONE STARTS AGAIN
-- ============================================================
-- Runs last, so it cannot be undone by a write that slips in between
-- the reset and the guard being armed.
update profiles set premium = false, premium_at = null where premium;
