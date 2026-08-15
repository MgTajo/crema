import { cropSquare, objectPosition, isAdjustable, focusAfterDrag, pickFocus } from './framing.js';

let pass=0, fail=0;
function eq(label, got, want){
  const g=JSON.stringify(got), w=JSON.stringify(want);
  if(g===w){pass++; console.log('  ok  ',label);}
  else {fail++; console.log('  FAIL',label,'\n        got ',g,'\n        want',w);}
}
function ok(label, cond, detail){
  if(cond){pass++; console.log('  ok  ',label);}
  else {fail++; console.log('  FAIL',label, detail===undefined?'':'\n        '+detail);}
}

console.log('cropSquare');
eq('square photo is untouched',      cropSquare(1000,1000,.5), {size:1000,sx:0,sy:0});
eq('landscape, centred',             cropSquare(1600,900,.5),  {size:900,sx:350,sy:0});
eq('landscape, flush left',          cropSquare(1600,900,0),   {size:900,sx:0,sy:0});
eq('landscape, flush right',         cropSquare(1600,900,1),   {size:900,sx:700,sy:0});
eq('portrait slides on y',           cropSquare(900,1600,0),   {size:900,sx:0,sy:0});
eq('portrait, flush bottom',         cropSquare(900,1600,1),   {size:900,sx:0,sy:700});
eq('focus below 0 is clamped',       cropSquare(1600,900,-3),  {size:900,sx:0,sy:0});
eq('focus above 1 is clamped',       cropSquare(1600,900,9),   {size:900,sx:700,sy:0});
eq('missing focus is centred',       cropSquare(1600,900),     {size:900,sx:350,sy:0});

console.log('\nobjectPosition — must agree with cropSquare');
eq('landscape moves on x',  objectPosition(1600,900,.25), '25.00% 50%');
eq('portrait moves on y',   objectPosition(900,1600,.25), '50% 25.00%');
eq('square is centred',     objectPosition(800,800,.9),   '50% 50%');
// the agreement that matters: object-position % is the same fraction of
// the same overflow the canvas crop uses
const f=.3, r=cropSquare(1600,900,f);
ok('sx is the object-position fraction of the overflow',
   Math.abs(r.sx-(f*(1600-900)))<1, `sx=${r.sx}`);

console.log('\nisAdjustable');
eq('a square offers no choice',   isAdjustable(1000,1000), false);
eq('1% off is still square',      isAdjustable(1000,1005), false);
eq('4:3 is adjustable',           isAdjustable(1600,1200), true);
eq('tall is adjustable',          isAdjustable(1200,1600), true);
eq('no dimensions, no choice',    isAdjustable(0,0),       false);

console.log('\nfocusAfterDrag');
// 1600x900 in a 300px box: cover scales by 300/900, so the picture is
// 533px wide and overflows by 233px.
ok('dragging right reveals the left edge',
   focusAfterDrag(1600,900,.5,120,0,300) < .5);
ok('dragging left reveals the right edge',
   focusAfterDrag(1600,900,.5,-120,0,300) > .5);
eq('a full overflow drag hits the edge and stops',
   focusAfterDrag(1600,900,.5,-9999,0,300), 1);
eq('vertical drag does nothing to a landscape photo',
   focusAfterDrag(1600,900,.4,0,150,300), .4);
eq('horizontal drag does nothing to a portrait photo',
   focusAfterDrag(900,1600,.4,150,0,300), .4);
eq('a square photo cannot be dragged',
   focusAfterDrag(900,900,.5,150,150,300), .5);

console.log('\npickFocus');
// a wide strip, flat everywhere except a checkerboard patch — the cup
const W=64, H=32;
function strip(patchStart, patchW){
  const a=new Uint8Array(W*H).fill(120);
  for(let y=8;y<24;y++) for(let x=patchStart;x<patchStart+patchW;x++) a[y*W+x]=(x+y)%2?20:230;
  return a;
}
ok('finds detail on the left',  pickFocus(strip(2,14),W,H) < .25, pickFocus(strip(2,14),W,H));
ok('finds detail on the right', pickFocus(strip(48,14),W,H) > .75, pickFocus(strip(48,14),W,H));
ok('centred detail stays centred',
   Math.abs(pickFocus(strip(24,16),W,H)-.5) < .12, pickFocus(strip(24,16),W,H));
eq('a flat photo falls back to the centre crop',
   pickFocus(new Uint8Array(W*H).fill(90),W,H), .5);
eq('a square photo has nothing to pick',
   pickFocus(new Uint8Array(32*32).fill(90),32,32), .5);
eq('no pixels, no opinion', pickFocus(null,64,32), .5);
// the guard-rail: a busy edge must not drag the crop off a subject that
// is merely well framed. Detail at both ends, slightly more at the edge.
const both=new Uint8Array(W*H).fill(120);
for(let y=0;y<H;y++) for(let x=0;x<10;x++) both[y*W+x]=(x+y)%2?20:230;      // edge
for(let y=6;y<26;y++) for(let x=26;x<42;x++) both[y*W+x]=(x+y)%2?20:230;   // subject
ok('centre bias keeps a framed subject', pickFocus(both,W,H) > .2 && pickFocus(both,W,H) < .8,
   pickFocus(both,W,H));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
