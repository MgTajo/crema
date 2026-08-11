-- ============================================================
-- Crema — step 1.24: the rest day is forgiven, not free
--
-- Run after step-1.23.sql. Re-runnable.
--
-- streak_run(), unchanged since step 1.16, counted the forgiven day
-- itself as a day poured: crossing a gap added one to `n` for the gap
-- AND then kept counting the real days on the far side, so a streak with
-- one missed morning in it read one day longer than the number of
-- mornings anyone actually poured. The rule was always meant to be "a
-- miss does not END the run", never "a miss COUNTS toward it" — see the
-- updated comment on runFrom() in src/domain/streak.js, which this is a
-- faithful port of, same as step-1.16.sql originally was.
--
-- Only streak_run() changes. streak_at_risk() (redefined once already,
-- in step-1.17.sql, for an unrelated timezone fix) just reads r.n back
-- out and is correct unchanged — a 9-day streak with a forgiven gap now
-- correctly reports 8, same as the app.
-- ============================================================

create or replace function streak_run(days int[], start int, out n int, out rested bool)
language plpgsql immutable as $$
declare d int; fwd int; ra int := crema_rest_after();
begin
  n := 0; rested := false; d := start;
  loop
    if d = any(days) then
      n := n + 1; d := d + 1;
    elsif not rested and (d + 1) = any(days) then
      -- Plain (non-forgiving) run on the older side, matching the
      -- deliberate use of plainRun() in the JS: a recursive check would
      -- let each forgiven gap earn the next one, and pouring every other
      -- day forever would read as an unbroken streak.
      fwd := 0;
      while (d + 1 + fwd) = any(days) loop fwd := fwd + 1; end loop;
      exit when n < ra and fwd < ra;
      rested := true; d := d + 1;   -- crosses the gap; the missed day itself isn't counted
    else
      exit;
    end if;
  end loop;
end $$;

revoke all on function streak_run(int[], int) from public, anon, authenticated;
