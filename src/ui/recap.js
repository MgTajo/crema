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

     · Photos only as bytes we own. An <img> drawn into a canvas taints
       it unless the source allows CORS, and a tainted canvas cannot be
       exported at all — so every photo is read through a canvas into a
       data: URI first and the SVG carries it inline. A remote href
       would not survive the rasteriser anyway: an SVG loaded through an
       <img> never fetches external resources. See loadShotPhotos().

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
import { imageSource } from '../data/media.js';
import { t, tn, locale } from '../i18n.js';

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
    +txt(x+28,y+40,label.toUpperCase(),{f:MONO,size:18,fill:C.muted,weight:500,spacing:2.4})
    +txt(x+28,y+40+size*0.92,v,{f:SERIF,size,fill:C.ink})
    /* Anchored to the bottom of the tile, and the tile is tall enough
       that it clears the value's descenders — an emoji in the value
       reaches lower than any letter does. */
    +(note?txt(x+28,y+h-24,clip(note,30),{size:21,fill:C.ink2}):'');
}

/* Which week this is, spelled out on the card. The recap is a fixed
   artifact for a week that has finished, so the dates are not
   decoration — they are the thing that makes it true a week later, and
   the thing two people need to be looking at the same window. The year
   only appears when the week is not in the current one. */
const range=(from,to)=>{
  const f={day:'numeric',month:'short'};
  const y=from.getFullYear()!==new Date().getFullYear()?` ${from.getFullYear()}`:'';
  return `${from.toLocaleDateString(locale(),f)} – ${to.toLocaleDateString(locale(),f)}${y}`.toUpperCase();
};

/* The Crema mark, drawn rather than imported: logoMark() in ui/icons.js
   paints itself from CSS custom properties, and a var(--mark-disc) inside
   an exported SVG resolves to nothing at all. */
const mark=(x,y,s)=>`<g transform="translate(${x} ${y}) scale(${s/40})">`
  +`<circle cx="20" cy="20" r="20" fill="${C.crema}"/>`
  +`<path transform="translate(11.1,11.1) scale(.178)" fill="${C.soft}" d="M50 92C50 92 6 62 6 34.5 6 18.5 17.5 8 30.5 8 39.5 8 46 13.2 50 20.5 54 13.2 60.5 8 69.5 8 82.5 8 94 18.5 94 34.5 94 62 50 92 50 92Z"/></g>`;

/* ---------- the week, as a mosaic ----------
   Seven columns, one per day, Monday first, with that day's coffees
   stacked up from a shared baseline. It is a bar chart whose bars are
   made of the coffee: the height of a column IS the count, so the
   distribution across the week and the pictures of it are one drawing
   rather than two blocks competing for the same 400px.

   Each tile is a photo where the photo can be read and the generated
   cup where it can't — the same choice art() makes in the feed, from
   the same three fields. `photos` is an id→data-URI map filled by
   loadShotPhotos(); a miss is not an error, it is the cup, so the card
   is never blocked on the network.

   A day with nothing gets a flat stub rather than an empty column: the
   gap in the week is the honest part of the picture, and a column that
   simply wasn't drawn reads as a rendering bug. */
const COLS=7, CGAP=12, VGAP=10;
const TILE=(W-M*2-(COLS-1)*CGAP)/COLS;      // 120
/* Three deep is the cap. Four would be 520px of column and would push
   the stat tiles off the bottom on the one week somebody had a very
   good Saturday; the overflow is counted on the top tile instead. */
const STACK_MAX=3;
const BASE=860;                              // the baseline every column sits on

/* The week bucketed into its seven days, and then capped — the same
   list the mosaic draws and the loader fetches, so the card never waits
   on a photo it had no room for. */
export function mosaicColumns(r){
  const perDay=[[],[],[],[],[],[],[]];
  (r&&r.shots||[]).forEach(s=>{ if(s.day>=0&&s.day<7) perDay[s.day].push(s); });
  return perDay;
}
export const drawnShots=r=>mosaicColumns(r).flatMap(c=>c.slice(0,STACK_MAX));

const dayLabels=from=>{
  const out=[];
  for(let i=0;i<7;i++){
    const d=new Date(from); d.setDate(from.getDate()+i);
    out.push(d.toLocaleDateString(locale(),{weekday:'short'}).replace(/\.$/,'').slice(0,2));
  }
  return out;
};

function mosaic(r,photos){
  const cols=mosaicColumns(r), labels=dayLabels(r.from);
  let out=`<defs><clipPath id="tile" clipPathUnits="userSpaceOnUse">
    <rect x="0" y="0" width="${TILE}" height="${TILE}" rx="20"/></clipPath></defs>`;

  cols.forEach((day,i)=>{
    const x=M+i*(TILE+CGAP);
    const shown=day.slice(0,STACK_MAX), hidden=day.length-shown.length;

    if(!day.length){
      out+=`<rect x="${x}" y="${BASE-10}" width="${TILE}" height="10" rx="5" fill="${C.line}"/>`;
    }else shown.forEach((s,k)=>{
      /* Stacked upward from the baseline, so the newest of a day sits
         on top and every column grows the same way. */
      const y=BASE-(k+1)*TILE-k*VGAP;
      const src=photos&&photos.get(s.id);
      out+=`<g transform="translate(${x} ${y})" clip-path="url(#tile)">`
        + (src
            ? `<image x="0" y="0" width="${TILE}" height="${TILE}" preserveAspectRatio="xMidYMid slice" href="${esc(src)}"/>`
            : `<rect width="${TILE}" height="${TILE}" fill="${C.card}"/>`
              + cupSVG(s.pattern||'none', s.quality, seedOf(s.id),
                  { attrs:`x="${TILE*0.05}" y="${TILE*0.05}" width="${TILE*0.9}" height="${TILE*0.9}"` }))
        + `<rect width="${TILE}" height="${TILE}" fill="none" stroke="${C.line}" stroke-width="2" rx="20"/>`
        + (hidden>0 && k===shown.length-1
            ? `<rect width="${TILE}" height="${TILE}" fill="${C.ink}" opacity="0.62"/>`
              + txt(TILE/2,TILE/2+13,`+${hidden}`,{f:SERIF,size:38,fill:'#FFFDF9',anchor:'middle'})
            : '')
        + `</g>`;
    });

    const on=day.length>0;
    out+=txt(x+TILE/2,BASE+40,labels[i],
      {f:MONO,size:21,fill:on?C.crema:C.muted,weight:500,anchor:'middle',spacing:1.5});
    if(day.length>1)
      out+=txt(x+TILE/2,BASE+68,`${day.length}`,{f:MONO,size:18,fill:C.muted,weight:500,anchor:'middle'});
  });
  return out;
}

/* ---------- the card ---------- */
export function recapSVG(r,me,photos){
  const name=(me&&me.name||'').trim();
  const top=r.drinks[0], bean=r.beans[0], pat=r.patterns[0];

  /* Four tiles, and every one of them is a real count. What goes in the
     fourth slot depends on what that week actually held — latte art if
     they poured any, a cafe count if they went out, the best run
     otherwise — because a tile reading "0 with latte art" is a reproach,
     not a souvenir. */
  const tw=(W-M*2-24)/2, th=152, t1=958, t2=t1+th+16;
  const fourth = r.artPours
      ? [t('latte art'), ''+r.artPours, pat?cap(pat.name):'']
    : r.cafePours
      ? [t('poured out'), ''+r.cafePours, t('at a café')]
      : [t('busiest day'), ''+r.busiest, t('in one day')];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-kerning="normal">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${C.paper}"/><stop offset="100%" stop-color="${C.paper2}"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  ${mark(M,M,60)}
  ${txt(M+78,M+45,'Crema',{f:SERIF,size:48})}

  ${txt(M,250,t('YOUR WEEK IN COFFEE'),{f:MONO,size:23,fill:C.crema,weight:500,spacing:4.5})}
  ${txt(M,296,range(r.from,r.to),{f:MONO,size:25,fill:C.ink2,weight:500,spacing:1.5})}

  ${txt(M,428,''+r.pours,{f:SERIF,size:150,fill:C.ink})}
  ${txt(M+numW(r.pours),388,r.pours===1?t('coffee, logged'):t('coffees, logged'),{f:SERIF,size:42,fill:C.ink2,style:'italic'})}
  ${txt(M+numW(r.pours),428,t('on {a} of 7 days',{a:r.daysWithCoffee}),{size:25,fill:C.muted})}

  ${mosaic(r,photos)}

  ${tile(M,t1,tw,th,t('your coffee'),top?top.name:'\u2014',top?t('{n}×',{n:top.count}):'')}
  ${tile(M+tw+24,t1,tw,th,t('best run'),r.bestRun+' \ud83d\udd25',
        r.bestRun?tn(r.bestRun,'day in a row','days in a row'):t('no run that week'))}
  ${tile(M,t2,tw,th,t('the bag'),bean?bean.name:t('unlogged'),
        bean?(r.newBeans.length?t('{n} new that week',{n:r.newBeans.length}):t('{n}×',{n:bean.count})):t('add a coffee to your next pour'))}
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

   The source is imageSource(), NOT imageUrl(): the resized
   `/cdn-cgi/image/…` variant is answered by Cloudflare's edge, which
   does not carry the bucket's CORS headers, so it can be shown but
   never read into a canvas. The object's own URL can — the `coffee`
   bucket already allows GET from the app's origins. It costs the full
   upload instead of a 240px thumb, which is the price of pixels you
   are allowed to touch, and it is downscaled here anyway.

   crossOrigin='anonymous' is required rather than optional: without it
   the image still loads and then silently taints the canvas, and a
   tainted canvas cannot be exported AT ALL — one photo would cost the
   whole card. With it, a photo that cannot be read fails on its own and
   becomes that pour's cup.

   Legacy pours whose image is already a data: URI never touch the
   network. */
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
export async function loadShotPhotos(r){
  const want=drawnShots(r).filter(s=>s.img);
  await Promise.all(want.map(s=>{
    if(!photoJobs.has(s.id))
      photoJobs.set(s.id, toTile(imageSource(s.img),432)
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
