"use strict";
/* ============================================================
   data/remote — reference data (cafés, beans, challenges) from the DB.

   Read-only rows, no writes: cafés, beans and challenges are editorial
   content maintained in the dashboard, not user data. Two rules:

     1. Results are cached in localStorage with a short TTL, so the PWA
        still opens offline and a cold start isn't gated on a fetch.
     2. The exported arrays are refilled IN PLACE. Every module that
        already did `import { CAFES }` keeps working untouched — the
        array identity never changes.

   There is no bundled copy to fall back on any more: what the tables
   say is what the app shows. An empty table means an empty section.
   ============================================================ */
import { BACKEND, REFERENCE_TTL_MS } from '../config.js';
import { rest } from './supabase.js';
import { CAFES, CHALLENGES } from './world.js';
import { BEANS, rebuildRoasterList } from './catalog.js';

const CACHE_KEY = 'crema_reference_v1';

/* ---------- row → app shape ---------- */
const cafeOf = r => ({
  id:r.id, name:r.name, area:r.area, city:r.city, spec:r.spec,
  rating:Number(r.rating), followers:r.followers|0, followed:false, promo:!!r.promo,
  img:r.img, color:r.color, blurb:r.blurb, hours:r.hours,
  lat:r.lat, lng:r.lng, menu:r.menu||{beans:[],milks:[]}
});
const beanOf = r => ({
  n:r.name, roaster:r.roaster, c:r.country, loc:r.loc,
  origin:r.origin, roast:r.roast, notes:r.notes||[]
});
const challengeOf = r => ({
  id:r.id, title:r.title, tag:r.tag, pattern:r.pattern,
  ends:r.ends, participants:r.participants|0, joined:false, blurb:r.blurb
});

/* The café map is decorative until the native map (step 2.3). Rather
   than storing hand-tuned x/y percentages, derive pin positions from
   real coordinates, so a café added in the dashboard shows up in the
   right relative place without anyone editing CSS. */
function projectPins(list){
  const pts=list.filter(c=>c.lat!=null&&c.lng!=null);
  if(pts.length<2){ list.forEach((c,i)=>{ if(!c.x){ c.x=(20+i*15)+'%'; c.y=(30+(i%3)*18)+'%'; } }); return; }
  const lats=pts.map(c=>c.lat), lngs=pts.map(c=>c.lng);
  const minLat=Math.min(...lats), maxLat=Math.max(...lats);
  const minLng=Math.min(...lngs), maxLng=Math.max(...lngs);
  const spanLat=(maxLat-minLat)||1e-4, spanLng=(maxLng-minLng)||1e-4;
  list.forEach(c=>{
    if(c.lat==null||c.lng==null){ c.x=c.x||'50%'; c.y=c.y||'50%'; return; }
    c.x=(12+((c.lng-minLng)/spanLng)*76).toFixed(1)+'%';
    c.y=(12+((maxLat-c.lat)/spanLat)*76).toFixed(1)+'%';   // north at the top
  });
}

/* Refill the exported arrays without replacing them. */
function apply({cafes,beans,challenges}){
  if(cafes){ projectPins(cafes); CAFES.length=0; CAFES.push(...cafes); }
  if(beans&&beans.length){ BEANS.length=0; BEANS.push(...beans); rebuildRoasterList(); }
  if(challenges){ CHALLENGES.length=0; CHALLENGES.push(...challenges); }
}

/* ---------- cache ---------- */
function readCache(){
  try{ const c=JSON.parse(localStorage.getItem(CACHE_KEY)); return c&&c.at?c:null; }catch(e){ return null; }
}
function writeCache(data){
  try{ localStorage.setItem(CACHE_KEY,JSON.stringify({at:Date.now(),...data})); }catch(e){ /* quota */ }
}

/* Fetch reference data, preferring fresh cache, falling back to stale
   cache and finally to the bundled arrays. Never throws.
   Returns the source, which the caller can use to decide whether to
   repaint. */
export async function loadReferenceData(){
  if(!BACKEND) return 'none';

  const cached=readCache();
  if(cached && Date.now()-cached.at < REFERENCE_TTL_MS){ apply(cached); return 'cache'; }

  try{
    const [cafeRows,beanRows,challengeRows]=await Promise.all([
      rest('cafes?select=*&order=sort.asc'),
      rest('beans?select=*&order=name.asc'),
      rest('challenges?select=*&order=sort.asc')
    ]);
    const data={
      cafes:(cafeRows||[]).map(cafeOf),
      beans:(beanRows||[]).map(beanOf),
      challenges:(challengeRows||[]).map(challengeOf)
    };
    apply(data); writeCache(data);
    return 'network';
  }catch(e){
    console.warn('reference data unavailable'+(cached?', using the cached copy':''),e);
    if(cached){ apply(cached); return 'stale-cache'; }
    return 'none';
  }
}
