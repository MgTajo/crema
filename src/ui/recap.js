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
import { fetchWeekStanding } from '../data/recap.js';
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

/* Which week this is, spelled out on the card. The recap is an artifact
   for one named week, so the dates are not decoration — they are the
   thing that makes it true a week later, and the thing two people need
   to be looking at the same window. The year only appears when the week
   is not in the current one. */
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

/* ---------- the standouts ----------
   Up to three photos from the week, chosen by the person whose week it
   was. They used to be every pour of the week, stacked into seven
   columns — which was a lovely idea and made the card an inventory: a
   fortnight of thumbnails at 120px, none of them worth looking at, and
   the good one buried among them. A week has two or three pictures in
   it that are actually worth showing. This shows those, big enough to
   see, and counts the rest as bars underneath.

   Sized to whatever was picked rather than padded out to three: two
   photos across the full width read as a deliberate pair, while two
   photos and an empty slot read as a bug.

   `photos` is an id→data-URI map filled by loadShotPhotos(). A miss is
   not an error — it falls back to the generated cup, the same way art()
   does in the feed — so the card is never blocked on the network. */
const SY=472, SH=214, SGAP=24;

function standouts(r,photos,u){
  const list=(r.standouts||[]).slice(0,3);
  if(!list.length) return '';
  const w=(W-M*2-SGAP*(list.length-1))/list.length;
  let out=`<defs>`
    +list.map((s,i)=>`<clipPath id="so${u}-${i}" clipPathUnits="userSpaceOnUse">`
      +`<rect x="0" y="0" width="${w}" height="${SH}" rx="22"/></clipPath>`).join('')
    /* The name sits on the photo, so it needs its own darkness under
       it — a caption band below would cost 40px of a card that is
       already spending 214 on the pictures. */
    +`<linearGradient id="scrim${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.62"/></linearGradient></defs>`;

  list.forEach((s,i)=>{
    const x=M+i*(w+SGAP), src=photos&&photos.get(s.id);
    /* Where it was beats what it was: "Sey Coffee" says more about a
       morning than "Cappuccino" does. The drink is the fallback. */
    const label=clip(s.cafe||cap(s.drink||''), list.length>2?18:30);
    out+=`<g transform="translate(${x} ${SY})" clip-path="url(#so${u}-${i})">`
      + (src
          ? `<image x="0" y="0" width="${w}" height="${SH}" preserveAspectRatio="xMidYMid slice" href="${esc(src)}"/>`
          : `<rect width="${w}" height="${SH}" fill="${C.card}"/>`
            + cupSVG(s.pattern||'none', s.quality, seedOf(s.id),
                { attrs:`x="${(w-SH*0.9)/2}" y="${SH*0.05}" width="${SH*0.9}" height="${SH*0.9}"` }))
      + (label&&src
          ? `<rect x="0" y="${SH-84}" width="${w}" height="84" fill="url(#scrim${u})"/>`
            +txt(20,SH-24,label,{size:23,fill:'#FFFDF9',weight:500})
          : '')
      + `<rect width="${w}" height="${SH}" fill="none" stroke="${C.line}" stroke-width="2" rx="22"/>`
      + `</g>`;
  });
  return out;
}

/* ---------- the week, as seven bars ----------
   One bar per day, Monday first, and the height is the count. This is
   the part of the card that is a chart rather than a picture: it
   answers "what did the week look like" in a glance, which seven photo
   columns of differing heights never quite did — a tall column read as
   a good photo day rather than as a busy one.

   A day with nothing gets a flat stub on the baseline rather than
   nothing at all. The gap is the honest part of the shape, and a
   missing bar reads as a rendering fault.

   The busiest day is drawn in the darker roast so the peak is where the
   eye lands; every other bar is the gold. */
const CGAP=20;
const BW=(W-M*2-CGAP*6)/7;                   // ~113
const BASE=900;                              // the baseline every bar sits on
const BAR_MIN=30;                            // one pour is still a block

/* Rounded at the top only — a bar with a rounded foot floats off its
   own baseline. */
const bar=(x,y,w,h,fill)=>{
  const r=Math.min(14,w/2,h/2);
  return `<path d="M${x} ${y+h} V${y+r} a${r} ${r} 0 0 1 ${r} -${r} h${w-2*r} a${r} ${r} 0 0 1 ${r} ${r} V${y+h} Z" fill="${fill}"/>`;
};

const dayLabels=from=>{
  const out=[];
  for(let i=0;i<7;i++){
    const d=new Date(from); d.setDate(from.getDate()+i);
    out.push(d.toLocaleDateString(locale(),{weekday:'short'}).replace(/\.$/,'').slice(0,2));
  }
  return out;
};

function bars(r){
  const days=r.days||[], labels=dayLabels(r.from);
  const peak=Math.max(0,...days);
  /* Scaled against three even when the best day was one, so a quiet
     week looks like a quiet week. Scaling to the peak alone would draw
     seven single coffees as seven full-height bars — the same picture a
     seven-a-day week gets, which is the one thing a chart of counts
     must never do. */
  const scale=Math.max(peak,3);
  /* Highlighted only when one day actually won it. A week where every
     day tied has no busiest day, and colouring all seven says the
     opposite of what the colour means everywhere else on the card. */
  const solo=days.filter(n=>n===peak).length===1;
  /* The chart takes whatever the standouts left. With no photos above
     it, it grows into the space rather than leaving a hole. The 46 is
     the count that rides above the tallest bar — it has to clear the
     photo edge, not tuck under it. */
  const top=(r.standouts&&r.standouts.length)?SY+SH+46:600;
  const maxH=BASE-top;
  let out=`<rect x="${M}" y="${BASE}" width="${W-M*2}" height="2" fill="${C.line}"/>`;

  days.forEach((n,i)=>{
    const x=M+i*(BW+CGAP), best=solo&&n===peak&&n>0;
    if(!n){
      out+=`<rect x="${x}" y="${BASE-8}" width="${BW}" height="8" rx="4" fill="${C.line}"/>`;
    }else{
      const h=Math.max(BAR_MIN, Math.round(n/scale*maxH));
      out+=bar(x,BASE-h,BW,h,best?C.crema:C.gold)
        +txt(x+BW/2,BASE-h-18,''+n,{f:MONO,size:24,fill:best?C.crema:C.ink2,weight:500,anchor:'middle'});
    }
    out+=txt(x+BW/2,BASE+40,labels[i],
      {f:MONO,size:21,fill:n?C.crema:C.muted,weight:500,anchor:'middle',spacing:1.5});
  });
  return out;
}

/* ---------- the four numbers ----------
   What you poured most, the hour you poured at, where that put you
   among everyone else pouring the same week, and what the week was
   answered with. Four questions somebody actually asks about their own
   week — and, unlike a ratio or a bean count, four that mean something
   to the person reading the card over their shoulder.

   Every tile is still a real count. Two of the four can legitimately
   have no answer — a week of pours carrying no clock has no average
   hour, and a standing needs both a crowd and a network — so the list
   is built longer than it needs to be and cut to four. The entries
   below the line are the old tiles, in the order they are worth
   showing: four slots must always be filled, and a tile reading "0" is
   a reproach rather than a souvenir. */
const hhmm=m=>{
  const d=new Date(2000,0,2); d.setMinutes(m);
  return d.toLocaleTimeString(locale(),{hour:'2-digit',minute:'2-digit'});
};

export function statTiles(r,standing){
  const top=r.drinks[0], bean=r.beans[0], pat=r.patterns[0];
  const react=standing?standing.reactions:r.reactions;
  const out=[];

  if(top) out.push([t('your usual'), cap(top.name),
    t('{n} of your {total} pours',{n:top.count,total:r.pours})]);
  if(r.avgMin!=null) out.push([t('coffee o’clock'), hhmm(r.avgMin),
    t('when you poured, on average')]);
  if(standing&&standing.aheadPct!=null) out.push([t('ahead of'), standing.aheadPct+'%',
    t('of everyone pouring this week')]);
  if(react>0) out.push([t('applause'), ''+react,
    tn(react,'reaction on your pours','reactions on your pours')]);

  /* ----- and, when any of those four had nothing to say ----- */
  if(r.artPours) out.push([t('latte art'), ''+r.artPours, pat?cap(pat.name):'']);
  if(bean) out.push([t('the bag'), bean.name,
    r.newBeans.length?t('{n} new that week',{n:r.newBeans.length}):t('{n}×',{n:bean.count})]);
  if(r.cafePours) out.push([t('poured out'), ''+r.cafePours, t('at a café')]);
  if(r.bestRun>1) out.push([t('best run'), r.bestRun+' 🔥',
    tn(r.bestRun,'day in a row','days in a row')]);
  out.push([t('busiest day'), ''+r.busiest, t('in one day')]);

  return out.slice(0,4);
}

/* ---------- the card ----------
   Every id inside is suffixed with a per-render number. SVG ids are
   document-global once the card is inlined into the page, so two cards
   in one document would both point at the first one's clip paths — the
   full-width standout would silently be drawn clipped to a third of the
   card. One card at a time is only true until it isn't. */
let uid=0;

export function recapSVG(r,me,photos,standing){
  const name=(me&&me.name||'').trim();
  const st=standing===undefined?weekStanding(r):standing;
  const u=++uid;
  const tw=(W-M*2-24)/2, th=150, t1=974, t2=t1+th+16;
  const four=statTiles(r,st);
  const at=i=>[M+(i%2)*(tw+24), i<2?t1:t2];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-kerning="normal">
  <defs><linearGradient id="bg${u}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${C.paper}"/><stop offset="100%" stop-color="${C.paper2}"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#bg${u})"/>

  ${mark(M,M,60)}
  ${txt(M+78,M+45,'Crema',{f:SERIF,size:48})}

  ${txt(M,250,t('YOUR WEEK IN COFFEE'),{f:MONO,size:23,fill:C.crema,weight:500,spacing:4.5})}
  ${txt(M,296,range(r.from,r.to),{f:MONO,size:25,fill:C.ink2,weight:500,spacing:1.5})}

  ${txt(M,428,''+r.pours,{f:SERIF,size:150,fill:C.ink})}
  ${txt(M+numW(r.pours),388,r.pours===1?t('coffee, logged'):t('coffees, logged'),{f:SERIF,size:42,fill:C.ink2,style:'italic'})}
  ${txt(M+numW(r.pours),428,t('on {a} of 7 days',{a:r.daysWithCoffee}),{size:25,fill:C.muted})}

  ${standouts(r,photos,u)}
  ${bars(r)}

  ${four.map((s,i)=>tile(at(i)[0],at(i)[1],tw,th,s[0],s[1],s[2])).join('\n  ')}

  ${txt(M,H-32,name?t('{name} on Crema',{name:clip(name,28)}):'crema-app.com',{size:26,fill:C.ink2,weight:500})}
  ${name?txt(W-M,H-32,'crema-app.com',{f:MONO,size:24,fill:C.muted,weight:500,anchor:'end'}):''}
</svg>`;
}

/* Roughly how wide the hero number is, so the two lines beside it start
   clear of it. SVG cannot measure text, and Georgia's digits are close
   enough to uniform at this size for a per-digit estimate to hold. */
const numW=n=>(''+n).length*96+34;

/* ---------- where the week stands ----------
   Two of the four tiles are not about this device: the percentile is a
   count across every account, and the reaction total is one the client
   only ever sees for posts that came through a feed page — which your
   own never do. Both arrive from one RPC (data/recap.js).

   Cached per week and per session. The card repaints when it lands; a
   card drawn before it does is complete without it, and simply shows
   one of the fallback tiles instead. Never rejects: an absent standing
   is a shape the card already handles, not a failure to report. */
const standingCache=new Map();   // week key -> standing, or null for "asked, nothing"
const standingJobs=new Map();

export async function loadStanding(r){
  if(!r) return null;
  if(standingCache.has(r.key)) return standingCache.get(r.key);
  if(!standingJobs.has(r.key))
    standingJobs.set(r.key, fetchWeekStanding(r.from,r.to)
      .then(s=>{ standingCache.set(r.key,s); standingJobs.delete(r.key); return s; }));
  return standingJobs.get(r.key);
}
export const weekStanding=r=>(r&&standingCache.get(r.key))||null;

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

/* Fills the cache for the standouts the card will actually draw — three
   photos rather than the twenty-odd the mosaic used to ask for, which
   is most of why the sheet now opens with its pictures already in it.

   The resolution follows the slot: one standout spans the full 912 and
   is exported at twice that, three share it. Resolves when there is
   nothing further to wait for, never rejects: every failure has already
   become a cup. */
export async function loadShotPhotos(r){
  const want=(r&&r.standouts||[]).filter(s=>s.img);
  const px=want.length<2?1080:want.length<3?800:640;
  await Promise.all(want.map(s=>{
    /* Keyed by size as well as by pour: the same photo can be wanted
       small in a three-up and large on its own, and the cached small
       one would be drawn soft across the full width. */
    const key=`${s.id}@${px}`;
    if(!photoJobs.has(key))
      photoJobs.set(key, toTile(imageSource(s.img),px)
        .then(u=>{ photoCache.set(s.id,u); return u; }));
    return photoJobs.get(key);
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
