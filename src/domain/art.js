"use strict";
/* ============================================================
   domain/art — procedural latte-art SVG generator.
   Pure rendering logic (no app state), portable to any platform
   that can draw SVG. Given a pattern, quality and seed it produces
   a deterministic cup; art() picks a photo when one exists.
   ============================================================ */
import { clamp, rng, lerpC, rgb, esc } from '../core/util.js';

let _gid=0;
function heartPath(cx,cy,s){return `<path d="M ${cx} ${cy+0.36*s} C ${cx-0.98*s} ${cy-0.34*s} ${cx-0.52*s} ${cy-0.98*s} ${cx} ${cy-0.34*s} C ${cx+0.52*s} ${cy-0.98*s} ${cx+0.98*s} ${cy-0.34*s} ${cx} ${cy+0.36*s} Z"/>`;}
function artShapes(pattern,q,rnd,foam){
  const jit=m=>(rnd()*2-1)*(1-q)*m; let s='';
  if(pattern==='heart'){
    s+=heartPath(50+jit(3),46+jit(3),21+q*2);
    s+=`<path d="M50 62 L50 74" stroke="${foam}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
  }else if(pattern==='rosetta'){
    const n=7;
    for(let i=0;i<n;i++){const t=i/(n-1), y=32+t*37, spread=Math.sin(Math.PI*(0.12+t*0.82));
      const len=6.5+spread*11.5, thick=2.2+spread*2, off=3+spread*2.2, ang=44-spread*4+jit(5);
      s+=`<ellipse cx="${50-off}" cy="${y}" rx="${len}" ry="${thick}" transform="rotate(${-ang} ${50-off} ${y})"/>`;
      s+=`<ellipse cx="${50+off}" cy="${y}" rx="${len}" ry="${thick}" transform="rotate(${ang} ${50+off} ${y})"/>`;}
    s+=`<path d="M50 28 L50 76" stroke="${foam}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    s+=`<circle cx="50" cy="75" r="${3+q}"/>`;
  }else if(pattern==='tulip'){
    for(let i=0;i<3;i++){const y=62-i*14, sz=15-i*3; s+=heartPath(50+jit(2.5),y,sz);}
    s+=`<path d="M50 66 L50 76" stroke="${foam}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  }else if(pattern==='swan'){
    const n=5;
    for(let i=0;i<n;i++){const t=i/(n-1), spread=Math.sin(Math.PI*t); const y=52+t*20, len=4+spread*9, off=3+spread*2.5;
      s+=`<ellipse cx="${44-off}" cy="${y}" rx="${len}" ry="${2+spread*2.4}" transform="rotate(-40 ${44-off} ${y})"/>`;
      s+=`<ellipse cx="${44+off}" cy="${y}" rx="${len}" ry="${2+spread*2.4}" transform="rotate(20 ${44+off} ${y})"/>`;}
    s+=`<path d="M56 60 C72 54 70 34 58 28" stroke="${foam}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`;
    s+=`<circle cx="${57+jit(1.5)}" cy="26" r="4.4"/><path d="M53 25 l-6 -1 l5 3.5 z"/>`;
  }else if(pattern==='abstract'){
    /* No fixed shape on purpose — a free pour, not a taught one. Same
       rng() every other pattern uses, so a given post still draws the
       same "abstract" every time rather than reshuffling on repaint. */
    const n=6+Math.floor(rnd()*3);
    for(let i=0;i<n;i++){
      const ang=rnd()*Math.PI*2, r=6+rnd()*24;
      const cx=50+Math.cos(ang)*r, cy=50+Math.sin(ang)*r*0.85;
      const rx=3.5+rnd()*8, ry=2.5+rnd()*6;
      s+=`<ellipse cx="${cx+jit(2)}" cy="${cy+jit(2)}" rx="${rx}" ry="${ry}" transform="rotate(${rnd()*360} ${cx} ${cy})"/>`;
    }
    s+=`<path d="M30 48 C40 60 60 60 70 48" stroke="${foam}" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.65"/>`;
  }
  return s;
}
/* `opts.attrs` is extra markup for the <svg> tag itself — x/y/width/height
   for when this cup is nested inside a bigger SVG (the week recap card),
   which is how SVG 1.1 places a sub-drawing without the caller having to
   know that the artwork is 100×100 inside. Empty everywhere else, so the
   cup in the feed is byte-for-byte the cup it always was. */
export function cupSVG(pattern,quality,seed,opts={}){
  const q=clamp(quality,0,1), rnd=rng((seed*131+7)>>>0), gid='g'+(_gid++);
  const foam=rgb(lerpC([0xD8,0xC6,0xAA],[0xF6,0xEE,0xE1],q));
  const dx=(rnd()*2-1)*(1-q)*6, dy=(rnd()*2-1)*(1-q)*6, rot=(rnd()*2-1)*(1-q)*11;
  return `<svg class="cup"${opts.attrs?' '+opts.attrs:''} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs><radialGradient id="${gid}" cx="42%" cy="36%" r="68%"><stop offset="0%" stop-color="#b5814a"/><stop offset="52%" stop-color="#8a5a30"/><stop offset="100%" stop-color="#583722"/></radialGradient></defs>
    ${opts.noCup?'':`<circle cx="50" cy="50" r="48.5" fill="#fdf9f3"/><circle cx="50" cy="50" r="45" fill="#f0e6d6"/>`}
    <circle cx="50" cy="50" r="${opts.noCup?48:42}" fill="url(#${gid})"/>
    <g transform="translate(${dx} ${dy}) rotate(${rot} 50 50)" fill="${foam}" opacity="0.9">${artShapes(pattern,q,rnd,foam)}</g>
    <ellipse cx="42" cy="34" rx="20" ry="12" fill="#ffffff" opacity="0.07"/></svg>`;
}
export function art(img,pattern,q,seed,alt){ return img?`<img class="photo" src="${img}" alt="${esc(alt||'coffee')}" loading="lazy">`:cupSVG(pattern||'none', q==null?0.9:q, seed); }

/* Two or three photos on one pour (step-1.28): a swipeable rail rather
   than a carousel with controls. CSS scroll-snap does the whole job —
   no script, no state, no library — so it costs the feed nothing on the
   nine cards out of ten that still carry a single photo, which take the
   plain <img> above untouched.

   A count in the corner rather than position dots. Dots would have to
   follow the scroll, and an element's `scroll` event reaches neither a
   bubbling nor a capturing listener on `document` — so keeping them
   honest would mean wiring a listener to every rail on every repaint,
   in an app whose views are strings. The count says the one thing the
   reader needs before they touch it (there is more here), and it cannot
   drift out of step with what is on screen because it never moves.

   `srcs` are already URLs; the caller picks the size, because the feed
   and the open sheet want different ones. */
export function artSet(srcs,pattern,q,seed,alt){
  const list=(srcs||[]).filter(Boolean);
  if(list.length<2) return art(list[0],pattern,q,seed,alt);
  return `<div class="shots">${
    list.map((u,i)=>`<img class="photo" src="${u}" alt="${esc(alt||'coffee')} ${i+1}/${list.length}" loading="${i?'lazy':'eager'}">`).join('')
  }</div><div class="shots-n" aria-hidden="true">${list.length}</div>`;
}
