import { streakFrom, bestStreakFrom, REST_AFTER } from './streak.js';

let pass=0, fail=0;
const S = a => new Set(a);
function eq(label, got, want){
  const g=JSON.stringify(got), w=JSON.stringify(want);
  if(g===w){pass++; console.log('  ok  ',label);}
  else {fail++; console.log('  FAIL',label,'\n        got ',g,'\n        want',w);}
}
const live = d => { const r=streakFrom(S(d)); return [r.days, r.poured, r.atRisk, r.rested, r.canRest]; };

console.log('REST_AFTER =', REST_AFTER);
console.log('\nstreakFrom — basics');
eq('no pours at all',            live([]),            [0,false,false,false,false]);
eq('poured today only',          live([0]),           [1,true,false,false,false]);
eq('yesterday only, today open', live([1]),           [1,false,true,false,false]);
eq('today+yesterday',            live([0,1]),         [2,true,false,false,false]);
eq('gap at 2 stops short run',   live([0,1,3,4]),     [2,true,false,false,false]);
eq('stale: last pour 2d ago, short run', live([2,3]), [0,false,false,false,false]);

console.log('\nstreakFrom — rest day');
const wk=[0,1,2,3,4,5,6];                      // 7 straight days incl. today
eq('7 straight, poured today',   live(wk),            [7,true,false,false,true]);
eq('6 straight is too short to rest', live([0,1,2,3,4,5]), [6,true,false,false,false]);
// 7-day run days 2..8, day 1 missed, poured today -> rest day covers day 1,
// but day 1 itself is not a day poured, so the count is 8 (0, 2..8), not 9
eq('miss yesterday, poured today, long run',
   live([0,2,3,4,5,6,7,8]),                            [8,true,false,true,false]);
// same but too short a run to earn it
eq('miss yesterday, poured today, short run',
   live([0,2,3,4]),                                    [1,true,false,false,false]);
// 7-day run ending 2 days ago, yesterday missed, today still open
eq('resting on yesterday, today open',
   live([2,3,4,5,6,7,8]),                              [7,false,true,true,false]);
eq('two blank days ends it even when long',
   live([3,4,5,6,7,8,9,10]),                           [0,false,false,false,false]);
eq('only one rest per streak',
   live([0,2,3,4,5,6,7,8,10,11,12,13,14,15,16]),       [8,true,false,true,false]);

console.log('\nbestStreakFrom');
eq('empty',                    bestStreakFrom(S([])),               0);
eq('single day',               bestStreakFrom(S([5])),              1);
eq('one block',                bestStreakFrom(S([3,4,5])),          3);
eq('picks the longer block',   bestStreakFrom(S([0,1, 5,6,7,8])),   4);
// old 10-day run (days 20..29) with a forgiven gap at 19 and 3 more days
// 16..18 — 13 days actually poured; the forgiven gap crosses but doesn't count
eq('merges across a forgiven gap',
   bestStreakFrom(S([16,17,18, 20,21,22,23,24,25,26,27,28,29])),    13);
eq('does not merge a short block', bestStreakFrom(S([0, 2,3,4])),   3);
eq('live streak is also the best', bestStreakFrom(S(wk)),           7);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
