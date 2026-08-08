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
import { imageUrl } from '../data/media.js';
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

/* ---------- the contact sheet ----------
   The week's actual coffees, oldest first. This replaced a seven-bar
   day chart, which counted the same week this shows: a grid of the
   pours themselves says how many, on how many days, and what they
   looked like, and only one of those three was in the bars.

   Each tile is a photo where the photo can be embedded and the
   generated cup where it can't — the same choice art() makes in the
   feed, from the same three fields. `photos` is a key→data-URI map
   filled by loadShotPhotos() below; a miss is not an error, it is the
   cup, so a card is never blocked on the network.

   GRID picks columns by count so three pours don't sit in a row built
   for four, and the last row is centred when it is short. */
const SHEET_MAX=8;

/* Which pours to draw when there are more than fit. Evenly spaced
   across the week rather than the first eight, so a Monday-heavy week
   is not represented entirely by Monday. */
export function pickShots(shots,max=SHEET_MAX){
  if(shots.length<=max) return shots.slice();
  const out=[], step=(shots.length-1)/(max-1);
  for(let i=0;i<max;i++) out.push(shots[Math.round(i*step)]);
  return out;
}

/* Columns chosen so the last row is never nearly empty: five pours read
   as 3+2 rather than 4+1, six as 3+3. Whatever it picks the answer is
   at most two rows, which is what keeps the sheet inside its budget —
   see the size cap below. */
const sheetCols=n=>n<=4?n:n<=6?3:4;
const sheetSize=n=>Math.min(216,(W-M*2-(sheetCols(n)-1)*16)/sheetCols(n));
/* How tall the sheet ends up, so the card can put the stat tiles under
   it. Derived from the same two functions the grid itself uses, rather
   than recomputed — the two drifting apart is exactly how a tile ends
   up overlapping a photo. */
const sheetHeight=n=>{
  if(!n) return 0;
  const rows=Math.ceil(n/sheetCols(n));
  return rows*sheetSize(n)+(rows-1)*16;
};

function contactSheet(shots,photos,total){
  const n=shots.length;
  if(!n) return '';
  const cols=sheetCols(n), gap=16, size=sheetSize(n);
  const hidden=total-n;

  let out=`<defs><clipPath id="tile" clipPathUnits="userSpaceOnUse">
    <rect x="0" y="0" width="${size}" height="${size}" rx="26"/></clipPath></defs>`;

  shots.forEach((s,i)=>{
    const col=i%cols, row=Math.floor(i/cols);
    /* Every row is centred on the card. For a full row of four that is
       a no-op — four 216s and three gaps are exactly the 912 between the
       margins — so this only moves the short rows, which is the case it
       exists for: a week of three pours in a grid built for four should
       not sit hard against the left edge. */
    const inRow=Math.min(cols,n-row*cols);
    const rowW=inRow*size+(inRow-1)*gap;
    const x=M+(W-M*2-rowW)/2+col*(size+gap);
    const y=SHEET_Y+row*(size+gap);
    const src=photos&&photos.get(s.id);
    out+=`<g transform="translate(${x.toFixed(1)} ${y})" clip-path="url(#tile)">`
      + (src
          ? `<image x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" href="${esc(src)}"/>`
          : `<rect width="${size}" height="${size}" fill="${C.card}"/>`
            + cupSVG(s.pattern||'none', s.quality, seedOf(s.id),
                { attrs:`x="${size*0.04}" y="${size*0.04}" width="${size*0.92}" height="${size*0.92}"` }))
      + `<rect width="${size}" height="${size}" fill="none" stroke="${C.line}" stroke-width="2" rx="26"/>`;
    /* The last tile carries the count of everything that didn't fit,
       so the sheet never quietly implies the week was eight coffees. */
    if(hidden>0 && i===n-1)
      out+=`<rect width="${size}" height="${size}" fill="${C.ink}" opacity="0.62"/>`
        + txt(size/2,size/2+18,`+${hidden}`,{f:SERIF,size:54,fill:'#FFFDF9',anchor:'middle'});
    out+=`</g>`;
  });
  return out;
}

/* ---------- the card ---------- */
const SHEET_Y=470;

export function recapSVG(r,me,photos){
  const name=(me&&me.name||'').trim();
  const top=r.drinks[0], bean=r.beans[0], pat=r.patterns[0];

  const shots=pickShots(r.shots||[]);
  const sheet=contactSheet(shots,photos,r.pours);
  const sheetBottom=SHEET_Y+sheetHeight(shots.length);

  /* Four tiles, and every one of them is a real count. What goes in the
     fourth slot depends on what this week actually held — latte art if
     they poured any, a café count if they went out, the personal best
     otherwise — because a tile reading "0 with latte art" is a reproach,
     not a souvenir. */
  const tw=(W-M*2-24)/2, th=150;
  const t1=Math.max(sheetBottom+34,900), t2=t1+th+20;
  const fourth = r.artPours
      ? [t('latte art'), ''+r.artPours, pat?cap(pat.name):'']
    : r.cafePours
      ? [t('poured out'), ''+r.cafePours, t('at a café')]
      : [t('best ever'), r.best+' 🔥', t('day streak')];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-kerning="normal">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${C.paper}"/><stop offset="100%" stop-color="${C.paper2}"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  ${mark(M,M,60)}
  ${txt(M+78,M+45,'Crema',{f:SERIF,size:48})}
  ${txt(W-M,M+42,range(r.from,r.to),{f:MONO,size:22,fill:C.muted,weight:500,anchor:'end',spacing:2})}

  ${txt(M,250,t('YOUR WEEK IN COFFEE'),{f:MONO,size:23,fill:C.crema,weight:500,spacing:4.5})}
  ${txt(M,400,''+r.pours,{f:SERIF,size:176,fill:C.ink})}
  ${txt(M+numW(r.pours),352,r.pours===1?t('coffee, logged'):t('coffees, logged'),{f:SERIF,size:44,fill:C.ink2,style:'italic'})}
  ${txt(M+numW(r.pours),398,t('on {a} of 7 days',{a:r.daysWithCoffee}),{size:26,fill:C.muted})}

  ${sheet}

  ${tile(M,t1,tw,th,t('your coffee'),top?top.name:'—',top?t('{n}×',{n:top.count}):'')}
  ${tile(M+tw+24,t1,tw,th,t('streak'),r.streak+' 🔥',r.streak?t('days running'):t('start one today'))}
  ${tile(M,t2,tw,th,t('the bag'),bean?bean.name:t('unlogged'),
        bean?(r.newBeans.length?t('{n} new this week',{n:r.newBeans.length}):t('{n}×',{n:bean.count})):t('add a coffee to your next pour'))}
  ${tile(M+tw+24,t2,tw,th,fourth[0],fourth[1],fourth[2])}

  ${txt(M,H-40,name?t('{name} on Crema',{name:clip(name,28)}):'crema-app.com',{size:26,fill:C.ink2,weight:500})}
  ${name?txt(W-M,H-40,'crema-app.com',{f:MONO,size:24,fill:C.muted,weight:500,anchor:'end'}):''}
</svg>`;
}

/* Roughly how wide the hero number is, so the two lines beside it start
   clear of it. SVG cannot measure text, and Georgia's digits are close
   enough to uniform at this size for a per-digit estimate to hold. */
const numW=n=>(''+n).length*96+34;

/* ---------- photos, or the cup instead ----------
   A card that is going to be rasterised can only carry pixels it owns.
   An SVG loaded through an <img> is its own document and never fetches
   external resources, so a remote <image href> would show in the inline
   preview and be blank in the exported PNG — the exact drift this file
   exists to prevent. So every photo is pulled through a canvas into a
   data: URI at tile resolution first, and the SVG carries the bytes.

   crossOrigin='anonymous' is deliberate, and so is the failure it
   currently causes: media.crema-app.com sends no
   Access-Control-Allow-Origin, so the load fails, that pour falls back
   to its generated cup, and nothing else is affected. Put that header on
   the media CDN and every one of these starts resolving with no code
   change here. Without crossOrigin the image would load and then taint
   the canvas, and a tainted canvas cannot be exported AT ALL — one
   photo would cost the whole card. Failing per-pour is the cheap
   failure; failing per-card is not.

   Legacy pours whose image is already a data: URI never touch the
   network and work today. */
const photoCache=new Map();   // post id -> data URI, or null for "use the cup"
const photoJobs=new Map();    // post id -> in-flight load, so two callers share one

function toTile(src,px){
  return new Promise(res=>{
    const img=new Image();
    if(!/^data:/.test(src)) img.crossOrigin='anonymous';
    img.onload=()=>{
      try{
        const c=document.createElement('canvas'); c.width=c.height=px;
        const ctx=c.getContext('2d');
        /* Centre-cropped to a square, the way the tile shows it. */
        const s=Math.min(img.width,img.height);
        ctx.drawImage(img,(img.width-s)/2,(img.height-s)/2,s,s,0,0,px,px);
        /* Throws if the canvas was tainted after all — which is the
           point of asking here rather than at export time. */
        res(c.toDataURL('image/jpeg',0.82));
      }catch(e){ res(null); }
    };
    img.onerror=()=>res(null);
    img.src=src;
  });
}

/* Fills the cache for the pours the sheet will actually draw. Resolves
   when there is nothing further to wait for, never rejects: every
   failure has already become a cup. */
export async function loadShotPhotos(shots){
  const want=pickShots(shots||[]).filter(s=>s.img);
  await Promise.all(want.map(s=>{
    if(!photoJobs.has(s.id))
      photoJobs.set(s.id, toTile(imageUrl(s.img,'thumb'),432)
        .then(u=>{ photoCache.set(s.id,u); return u; }));
    return photoJobs.get(s.id);
  }));
  return photoCache;
}
export const shotPhotos=()=>photoCache;

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
