/* The plpgsql streak_at_risk() in supabase/step-1.16.sql and the
   streakFrom() in src/domain/streak.js implement the same rule in two
   languages. If they drift, the evening push tells people a number the
   app then contradicts — the worst possible bug for a trust-shaped
   feature.

   This transliterates the plpgsql loop line by line and fuzzes it
   against the real implementation over random pour histories. */
import { streakFrom } from '../../src/domain/streak.js';

const REST_AFTER = 7; // rest_after constant in the plpgsql

/* Line-by-line port of streak_run() (step-1.24.sql: the missed day
   crosses the gap without being counted). */
function sqlStreakRun(days, start) {
  let n = 0, rested = false, d = start, fwd;
  for (;;) {
    if (days.has(d)) { n++; d++; }
    else if (!rested && days.has(d + 1)) {
      fwd = 0;
      while (days.has(d + 1 + fwd)) fwd++;
      if (n < REST_AFTER && fwd < REST_AFTER) break;
      rested = true; d++;
    } else break;
  }
  return { n, rested };
}

/* Line-by-line port of streak_at_risk(). `days` is the day-index array. */
function sqlStreakAtRisk(daysArr) {
  const days = new Set(daysArr);
  let total;

  if (days.has(0) || daysArr.length === 0) return 0;

  if (days.has(1)) {
    total = sqlStreakRun(days, 1).n;
  } else {
    const r = sqlStreakRun(days, 2);
    if (r.n >= REST_AFTER && !r.rested) total = r.n; else return 0;
  }

  if (total < 2) return 0;
  return total;
}

/* What the SQL should report, expressed in terms of the JS rule: the
   live streak, but only when it is at risk and worth defending. */
function expected(daysArr) {
  const s = streakFrom(new Set(daysArr));
  if (s.poured) return 0;
  if (!s.atRisk) return 0;
  return s.days >= 2 ? s.days : 0;
}

let checked = 0, bad = 0;
const show = a => '[' + [...a].sort((x, y) => x - y).join(',') + ']';

/* Exhaustive over every subset of the last 12 days — 4096 histories,
   which covers every shape the rest-day rule can take near the edge. */
for (let mask = 0; mask < (1 << 12); mask++) {
  const arr = [];
  for (let i = 0; i < 12; i++) if (mask & (1 << i)) arr.push(i);
  const got = sqlStreakAtRisk(arr), want = expected(arr);
  checked++;
  if (got !== want && bad < 10) { bad++; console.log(`  FAIL ${show(arr)}  sql=${got} js=${want}`); }
  else if (got !== want) bad++;
}
console.log(`exhaustive over 12-day windows: ${checked} histories, ${bad} mismatches`);

/* Random longer histories, up to 120 days back. */
let checked2 = 0, bad2 = 0;
for (let t = 0; t < 30000; t++) {
  const density = 0.2 + Math.random() * 0.75;
  const arr = [];
  for (let d = 0; d < 120; d++) if (Math.random() < density) arr.push(d);
  const got = sqlStreakAtRisk(arr), want = expected(arr);
  checked2++;
  if (got !== want) {
    bad2++;
    if (bad2 <= 5) console.log(`  FAIL ${show(arr.slice(0, 30))}…  sql=${got} js=${want}`);
  }
}
console.log(`random 120-day histories:      ${checked2} histories, ${bad2} mismatches`);

const total = bad + bad2;
console.log(total ? `\n${total} MISMATCHES` : '\nSQL and JS agree on every case');
process.exit(total ? 1 : 0);
