"use strict";
/* ============================================================
   ui/recap — "your week in coffee" as one picture.

   The card is an SVG, and the same SVG string is both what the sheet
   shows and what gets shared. That is the whole design decision here:
   a recap built once in HTML for the screen and again in canvas calls
   for the export is two designs that drift, and the one people
   actually see is the one you didn't check. Here, what you look at is
   the file.

   Which forces two constraints, and they are worth stating because
   they are easy to undo by accident:

     · No photos. An <img> from R2 taints the canvas the moment we
       rasterise, and a tainted canvas cannot be exported at all — so
       the card is typography and a generated cup, which is also the
       better-looking answer and the one that works offline.

     · No web fonts. An SVG rasterised through an <img> is its own
       document and never sees the page's @font-face rules, so
       Newsreader would silently become Times in the exported PNG
       while looking right on screen. The families below are the
       platform stack on purpose — what you see IS what exports.

   1080×1350 is Instagram's portrait post. It fills a feed post
   properly and letterboxes cleanly into a story, which is the pair of
   places this actually gets posted.
   ============================================================ */
import { esc, seedOf, cap } from '../core/util.js';
import { cupSVG } from '../domain/art.js';
import { t, locale } from '../i18n.js';

const W=1080, H=1350, M=84;

/* Fixed, not the app's theme tokens. A shared image has no dark mode —
   it lands in someone else's feed, where the only thing that matters is
   that it looks like Crema. Warm paper, roast type, one gold accent. */
const C={
  paper:'#F7F1E7', paper2:'#EFE4D2', ink:'#24170F', ink2:'#6B5849',
  muted:'#9A8877', line:'#E4D9C8', crema:'#8A5A28', gold:'#C98A4B',
  soft:'#F5EADA', card:'#FFFDF9'
};
/* Deliberately WITHOUT Newsreader / Public Sans / JetBrains Mono, even
   though they are the brand faces and are loaded on the page. Named
   here they would render on screen — the inline card is part of the
   document — and then silently fall back to Georgia in the exported
   PNG, which is its own document and never sees @font-face. Naming
   only what both can reach is what keeps the preview honest.

   Single-quoted family names, not double: these land inside a
   double-quoted XML attribute, and a stray " there is not a rendering
   glitch — it makes the whole document unparseable, so the card fails
   to rasterise rather than looking slightly wrong. */
const SERIF="Georgia, 'Iowan Old Style', Palatino, 'Times New Roman', serif";
const SANS="-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO="ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

const txt=(x,y,s,o={})=>`<text x="${x}" y="${y}" font-family="${o.f||SANS}" font-size="${o.size||28}"`
  +` fill="${o.fill||C.ink}" font-weight="${o.weight||400}"`
  +(o.anchor?` text-anchor="${o.anchor}"`:'')
  +(o.spacing?` letter-spacing="${o.spacing}"`:'')
  +(o.style?` font-style="${o.style}"`:'')
  +`>${esc(s)}</text>`;

/* SVG text does not wrap and has no overflow, so a long coffee name
   would simply run out over the edge of its tile and off the card.
   Shrinking the type covers most of it; this catches the rest. */
const clip=(s,n)=>{ s=''+(s==null?'':s); return s.length>n ? s.slice(0,n-1).trimEnd()+'…' : s; };

/* A stat tile. Two of these per row, and the value is allowed to be a
   word — "Cappuccino" is as much of an answer as "12" is, so the type
   shrinks to fit rather than the string being cut. */
function tile(x,y,w,h,label,value,note){
  const v=clip(value,26);
  const size=v.length>17?30:v.length>13?34:v.length>9?42:52;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="${C.card}" stroke="${C.line}" stroke-width="2"/>`
    +txt(x+28,y+44,label.toUpperCase(),{f:MONO,size:18,fill:C.muted,weight:500,spacing:2.4})
    +txt(x+28,y+44+size*0.94,v,{f:SERIF,size,fill:C.ink})
    +(note?txt(x+28,y+h-26,clip(note,30),{size:21,fill:C.ink2}):'');
}

const dayLetters=()=>{
  /* Weekday initials in the reader's language, taken from a real date
     rather than from a hardcoded 'MTWTFSS' that is wrong in German. */
  const out=[];
  for(let i=6;i>=0;i--){
    const d=new Date(Date.now()-i*864e5);
    out.push(d.toLocaleDateString(locale(),{weekday:'short'}).replace(/\.$/,'').slice(0,2));
  }
  return out;
};

const range=(from,to)=>{
  const f={day:'numeric',month:'short'};
  return `${from.toLocaleDateString(locale(),f)} – ${to.toLocaleDateString(locale(),f)}`.toUpperCase();
};

/* The Crema mark, drawn rather than imported: logoMark() in ui/icons.js
   paints itself from CSS custom properties, and a var(--mark-disc) inside
   an exported SVG resolves to nothing at all. */
const mark=(x,y,s)=>`<g transform="translate(${x} ${y}) scale(${s/40})">`
  +`<circle cx="20" cy="20" r="20" fill="${C.crema}"/>`
  +`<path transform="translate(11.1,11.1) scale(.178)" fill="${C.soft}" d="M50 92C50 92 6 62 6 34.5 6 18.5 17.5 8 30.5 8 39.5 8 46 13.2 50 20.5 54 13.2 60.5 8 69.5 8 82.5 8 94 18.5 94 34.5 94 62 50 92 50 92Z"/></g>`;

/* ---------- the card ---------- */
export function recapSVG(r,me){
  const name=(me&&me.name||'').trim();
  const top=r.drinks[0], bean=r.beans[0], pat=r.patterns[0];
  const max=Math.max(1,r.busiest);
  const letters=dayLetters();

  /* Bars: the week, one column a day, today last and marked. A day with
     no coffee gets a stub rather than nothing — the gap in the row is
     the honest part of the picture and deleting it would flatter.

     barTop leaves room above for the count labels, which sit outside
     the bar: at a full-height bar the label lands at barTop-16, and
     that has to clear the line of copy above it.

     The whole block is bottom-anchored at 796 so the day letters stay
     put whatever the tallest bar is — a row of labels that moves with
     the busiest day of the week would make two people's cards look
     like two different designs. */
  const bw=(W-M*2-6*18)/7, barTop=640, barH=156;
  const bars=r.days.map((c,i)=>{
    const x=M+i*(bw+18), h=c?Math.max(24,Math.round(c/max*barH)):10;
    const y=barTop+barH-h, today=i===6;
    return `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="${Math.min(14,h/2)}"`
      +` fill="${c?(today?C.crema:C.gold):C.line}"/>`
      +(c?txt(x+bw/2,y-16,''+c,{f:MONO,size:22,fill:C.ink2,weight:500,anchor:'middle'}):'')
      +txt(x+bw/2,barTop+barH+42,letters[i],{f:MONO,size:21,fill:today?C.crema:C.muted,weight:500,anchor:'middle',spacing:1.5});
  }).join('');

  /* Four tiles, and every one of them is a real count. What goes in the
     fourth slot depends on what this week actually held — latte art if
     they poured any, a café count if they went out, the personal best
     otherwise — because a tile reading "0 with latte art" is a reproach,
     not a souvenir. */
  const tw=(W-M*2-24)/2, th=176, t1=886, t2=t1+th+22;
  const fourth = r.artPours
      ? [t('latte art'), ''+r.artPours, pat?cap(pat.name):'']
    : r.cafePours
      ? [t('poured out'), ''+r.cafePours, t('at a café')]
      : [t('best ever'), r.best+' 🔥', t('day streak')];

  const cup=cupSVG(pat?pat.name:'heart', 0.95, seedOf(''+r.pours+r.daysWithCoffee+letters[6]),
    { attrs:`x="${W-M-282}" y="266" width="282" height="282"` });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-kerning="normal">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${C.paper}"/><stop offset="100%" stop-color="${C.paper2}"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  ${mark(M,M,60)}
  ${txt(M+78,M+45,'Crema',{f:SERIF,size:48})}
  ${txt(W-M,M+42,range(r.from,r.to),{f:MONO,size:22,fill:C.muted,weight:500,anchor:'end',spacing:2})}

  ${txt(M,296,t('YOUR WEEK IN COFFEE'),{f:MONO,size:23,fill:C.crema,weight:500,spacing:4.5})}

  ${cup}
  ${txt(M,452,''+r.pours,{f:SERIF,size:176,fill:C.ink})}
  ${txt(M,545,r.pours===1?t('coffee, logged'):t('coffees, logged'),{f:SERIF,size:46,fill:C.ink2,style:'italic'})}
  ${txt(M,588,t('on {a} of 7 days',{a:r.daysWithCoffee}),{size:26,fill:C.muted})}

  ${bars}

  ${tile(M,t1,tw,th,t('your coffee'),top?top.name:'—',top?t('{n}×',{n:top.count}):'')}
  ${tile(M+tw+24,t1,tw,th,t('streak'),r.streak+' 🔥',r.streak?t('days running'):t('start one today'))}
  ${tile(M,t2,tw,th,t('the bag'),bean?bean.name:t('unlogged'),
        bean?(r.newBeans.length?t('{n} new this week',{n:r.newBeans.length}):t('{n}×',{n:bean.count})):t('add a coffee to your next pour'))}
  ${tile(M+tw+24,t2,tw,th,fourth[0],fourth[1],fourth[2])}

  ${txt(M,H-40,name?t('{name} on Crema',{name:clip(name,28)}):'crema-app.com',{size:26,fill:C.ink2,weight:500})}
  ${name?txt(W-M,H-40,'crema-app.com',{f:MONO,size:24,fill:C.muted,weight:500,anchor:'end'}):''}
</svg>`;
}

/* ---------- the card, as a file ----------
   SVG → <img> → canvas → PNG. The data: URL rather than a blob: URL is
   deliberate — Safari refuses to draw a blob-backed SVG onto a canvas —
   and encodeURIComponent rather than btoa, because the card carries
   whatever someone named their coffee and btoa dies on the first umlaut.

   2× the design size: 2160×2700 lands as a crisp Instagram post on a
   phone that will downscale it anyway, and costs nothing to make. */
export function recapPNG(svg,scale=2){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{
      try{
        const c=document.createElement('canvas');
        c.width=W*scale; c.height=H*scale;
        const ctx=c.getContext('2d');
        ctx.drawImage(img,0,0,c.width,c.height);
        c.toBlob(b=>b?resolve(b):reject(new Error('toBlob returned nothing')),'image/png');
      }catch(err){ reject(err); }
    };
    img.onerror=()=>reject(new Error('the card could not be drawn'));
    img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  });
}
