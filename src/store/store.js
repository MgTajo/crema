"use strict";
/* ============================================================
   store — the app's single source of truth.

   Owns persistent `state` (the user's world, saved via the
   persistence adapter) and transient `ui` (route, filters, open
   overlays — never persisted). Also exposes the derived selectors
   the views read from. Every read/write of persisted data goes
   through here, so the backend swap is confined to persistence.js.

   `state` and `ui` are exported as live bindings: modules that
   `import { state }` always observe the latest value, including
   after load() reassigns it on reset.
   ============================================================ */
import { agoDays, isToday } from '../core/util.js';
import { FEED_PAGE } from '../config.js';
import { beanCatalog } from '../data/catalog.js';
import { USERS, CAFES, CHALLENGES, TOP_POSTS, handleToUid } from '../data/world.js';
import { fetchFeed, fetchMine, fetchSavedPosts } from '../data/posts.js';
import { fetchMyFollows, fetchMyLikes, fetchMySaves, fetchMyCafeFollows, fetchMyBlocks,
         fetchCafeFollowCounts, fetchFollowRequests } from '../data/social.js';
import { fetchMyJoins, fetchTopPosts, fetchJoinCounts } from '../data/challenges.js';
import { fetchProfileCounts, fetchSuggestedProfiles } from '../data/profiles.js';
import { fetchNotifications } from '../data/notifications.js';
import { makePersistence } from './persistence.js';

export const KEY='crema_v11';
let persistence=makePersistence(null,KEY);

/* The auth session, or null when signed out. Exported as a live binding
   so views can read it without importing the auth client. */
export let session=null;

export let state;
export const ui={route:'home', filter:'today', ovStack:[], profTab:'pours', searchQ:'', obStep:1, cafeF:{open:false,promo:false,top:false}, create:null, avatarBusy:false};

/* A brand-new account: nothing invented, nothing borrowed. Everything
   visible after this comes from the user or from the backend. */
export function freshState(){
  return {
    posts:[], myGallery:[],
    follows:{},
    /* follows you've asked for but that haven't been accepted yet */
    followPending:{},
    /* Public or followers-only, remembered from the last pour you made:
       most people post the same way every day, and asking again every
       time is asking them to re-decide something they already decided. */
    lastVisibility:'public',
    cafeFollow:{},
    challenges:{},
    challengeSubs:{}, customBeans:[], customDrinks:[],
    onboarded:false, theme:'auto',
    me:{name:'',handle:'',city:'',machineBrand:'',machineModel:'',favDrink:'Cappuccino',favMilk:'Whole milk',premium:false,bio:'',avatar:''},
    notifications:[]
  };
}
export async function load(){try{const s=await persistence.read(); state=(s&&s.me)?s:freshState();
  ['posts','customBeans','customDrinks','myGallery','notifications'].forEach(k=>{if(!state[k])state[k]=[];});
  ['follows','cafeFollow','challenges','challengeSubs','followPending'].forEach(k=>{if(!state[k])state[k]={};});
  if(state.lastVisibility!=='followers') state.lastVisibility='public';
  if(!state.me)state.me=freshState().me; if(!state.me.favMilk)state.me.favMilk='Whole milk';
 }catch(e){state=freshState();}}
/* fire-and-forget: the UI has already repainted optimistically, so a failed
   write must never block or throw — it only warns. */
export function save(){ Promise.resolve(persistence.write(state)).catch(err=>console.warn('save failed',err)); }
export async function clearSaved(){ try{ await persistence.clear(); }catch(err){ console.warn('clear failed',err); } }

/* ---------- the remote feed ----------
   The posts table is the feed. There is no local stand-in: an empty feed
   is an empty feed, and the UI says so. */
export const feed={ loading:false, done:false, cursor:null, loaded:false };

/* Who you follow / block, from the server. `state.follows` stays the
   app-wide truth, keyed by auth uuid. */
export const social={ blocks:[], loaded:false, listsLoaded:false, followers:[], following:[],
                      counts:{followers:0,following:0,pours:0},
                      /* people waiting for you to let them in (step-1.15) */
                      requests:[] };

/* People to follow — the newest profiles that aren't you, filled by
   hydrateSocial(). Empty until the backend answers. */
export const discover={ list:[], loaded:false };

/* Your own pours — all of them, not the handful that happen to be on the
   current feed page. Your profile grid, streak, badges, stats and beans
   passport are built from this; before it existed they were built from
   the feed, so they emptied out as your posts aged off page one. */
export const mine={ list:[], loaded:false };

/* Your saved collection, from the `saves` table. Loaded when the Saved
   tab is first opened rather than on boot — nobody pays for it until
   they look. */
export const saved={ list:[], loaded:false, loading:false };
export async function loadSaved(){
  if(!session||saved.loading) return false;
  saved.loading=true;
  try{
    saved.list=await fetchSavedPosts(session.user.id);
    saved.loaded=true; cachePosts(saved.list);
    return true;
  }catch(e){ console.warn('saved posts failed',e); return false; }
  finally{ saved.loading=false; }
}
export const followeeIds = () => Object.keys(state.follows||{}).filter(k=>state.follows[k]);

/* Entries per challenge, loaded on demand when a challenge opens. */
export const entryCache={};

export async function hydrateSocial(){
  if(!session) return;
  const uid=session.user.id;
  try{
    const [follows,cafeFollows,blocks,joins]=await Promise.all([
      fetchMyFollows(uid), fetchMyCafeFollows(uid), fetchMyBlocks(uid), fetchMyJoins(uid)
    ]);
    /* The server is the truth about who you follow — including the ones
       that are still only requests. Rebuild rather than merge, or a
       follow that was declined elsewhere lingers in this browser. */
    state.follows={}; state.followPending={};
    follows.accepted.forEach(id=>{ state.follows[id]=true; });
    follows.pending.forEach(id=>{ state.followPending[id]=true; });
    cafeFollows.forEach(id=>{ state.cafeFollow[id]=true; });
    joins.forEach(id=>{ state.challenges[id]=true; });
    social.blocks=blocks; social.loaded=true;
  }catch(e){ console.warn('social state failed',e); }

  /* Who is waiting on you. Its own try: a follow-request failure must
     not cost you the rest of your world. */
  try{ social.requests=await fetchFollowRequests(uid); }
  catch(e){ console.warn('follow requests failed',e); }

  /* Independent of the above — a failure here must not cost you the feed. */
  try{ state.notifications=await fetchNotifications(uid); }
  catch(e){ console.warn('notifications failed',e); }

  /* Top pours by likes. Empty is a real answer — nobody has been liked
     yet — and the UI says so rather than inventing a board. */
  try{
    const board=await fetchTopPosts(uid,{ blocked:social.blocks });
    TOP_POSTS.length=0; TOP_POSTS.push(...board);
    cachePosts(board);
  }catch(e){ console.warn('top pours failed',e); }

  try{
    mine.list=await fetchMine(uid,{ limit:200, myUid:uid });
    mine.loaded=true; cachePosts(mine.list);
  }catch(e){ console.warn('your pours failed',e); }

  try{ social.counts=await fetchProfileCounts(uid); }
  catch(e){ console.warn('profile counts failed',e); }

  try{ discover.list=await fetchSuggestedProfiles(uid,social.blocks); discover.loaded=true; }
  catch(e){ console.warn('suggestions failed',e); }

  /* Real join / follow counts, so no screen shows a number nobody earned. */
  try{ applyCounts(await fetchJoinCounts(), CHALLENGES, 'participants'); }
  catch(e){ console.warn('challenge counts failed',e); }
  try{ applyCounts(await fetchCafeFollowCounts(), CAFES, 'followers'); }
  catch(e){ console.warn('cafe follow counts failed',e); }
}

function applyCounts(counts,list,field){ list.forEach(x=>{ x[field]=counts[x.id]|0; }); }

/* Which of these posts you liked or saved. Per-viewer, so it can't ride
   along on the cached feed query. */
async function markMine(list){
  if(!session||!list.length) return list;
  try{
    const ids=list.map(p=>p.id);
    const [liked,savedIds]=await Promise.all([ fetchMyLikes(session.user.id,ids), fetchMySaves(ids) ]);
    const L=new Set(liked), S=new Set(savedIds);
    list.forEach(p=>{ p.likedByMe=L.has(p.id); p.saved=S.has(p.id); });
  }catch(e){ console.warn('interaction state failed',e); }
  return list;
}

/* Both tabs filter server-side so pagination stays correct.

   Following — everyone you've been accepted by, plus yourself, in plain
   reverse-chronological order. Their followers-only pours belong here:
   being followed is exactly what earns you those.

   Today — every public pour since your own local midnight, from anyone,
   followed or not. That is the whole point of it: it's where you meet
   people you don't know yet. Followers-only pours never appear, not even
   your own. */
export const startOfToday = () => { const d=new Date(); d.setHours(0,0,0,0); return d.toISOString(); };
function feedArgs(){
  const uid=session.user.id;
  if(ui.filter==='following') return { myUid:uid, authors:[...followeeIds(),uid], blocked:social.blocks };
  return { myUid:uid, authors:null, blocked:social.blocks, since:startOfToday(), publicOnly:true };
}

export async function loadFeed(){
  if(!session) return false;
  feed.loading=true;
  try{
    const list=await fetchFeed(feedArgs());
    state.posts=await markMine(list);
    feed.cursor=list.length?list[list.length-1].createdAt:null;
    feed.done=list.length<FEED_PAGE;
    feed.loaded=true;
    return true;
  }catch(e){ console.warn('feed load failed — keeping what we have',e); return false; }
  finally{ feed.loading=false; }
}

export async function loadMoreFeed(){
  if(!session||feed.loading||feed.done||!feed.cursor) return false;
  feed.loading=true;
  try{
    const list=await fetchFeed({ ...feedArgs(), before:feed.cursor });
    if(list.length){ state.posts.push(...await markMine(list)); feed.cursor=list[list.length-1].createdAt; }
    feed.done=list.length<FEED_PAGE;
    return list.length>0;
  }catch(e){ console.warn('feed page failed',e); return false; }
  finally{ feed.loading=false; }
}

/* Point the store at the signed-in user's own store and load their world.
   Signing out drops back to an empty state behind the sign-in gate.
   Every sign-in and sign-out goes through this one function. */
export async function useSession(next){
  session = next;
  persistence = makePersistence(next, KEY);
  await load();
  feed.done=false; feed.cursor=null; feed.loaded=false;
  social.blocks=[]; social.loaded=false; social.listsLoaded=false; social.followers=[]; social.following=[];
  social.counts={followers:0,following:0,pours:0};
  discover.list=[]; discover.loaded=false;
  mine.list=[]; mine.loaded=false;
  saved.list=[]; saved.loaded=false;
  if(next){ await hydrateSocial(); await loadFeed(); }
}

/* Posts we have fetched but that aren't on the current feed page — the
   board, a challenge entry, someone's profile grid. Without this, tapping
   one of those opened an empty sheet: findPost() only knew about the feed.
   Keyed by id, so re-fetching the same post replaces rather than doubles. */
const postCache=new Map();
export function cachePosts(list){ (list||[]).forEach(p=>{ if(p&&p.id) postCache.set(p.id,p); }); }
export function findPost(id){
  return state.posts.find(p=>p.id===id)
      || (state.myGallery||[]).find(p=>p.id===id)
      || postCache.get(id)
      || null;
}
export function applyMe(){
  state.me.name=(state.me.name||'').trim();
  USERS.me.name=state.me.name||'You';
  USERS.me.city=(state.me.city||'').trim();
  USERS.me.bio=state.me.bio||'';
  USERS.me.avatar=state.me.avatar||'';
  /* level, points and counts all come from the server — nothing here
     is guessed or incremented locally */
  USERS.me.level=state.me.level||1;
  USERS.me.points=state.me.points|0;
  USERS.me.followerN=social.counts.followers|0;
  USERS.me.pourN=Math.max(social.counts.pours|0,myPosts().length);
  let h=(state.me.handle||'').replace(/\s+/g,'').replace(/^@+/,'');
  if(!h) h=USERS.me.name.toLowerCase().replace(/[^a-z0-9._]/g,'')||'you';
  USERS.me.handle='@'+h;
  handleToUid[h]='me';
}
/* pattern starts empty: a cappuccino is a cappuccino whether or not you
   attempted latte art, and defaulting to 'rosetta' tagged every milk
   drink with art the user never claimed. */
/* Editing is for fixing what you meant to say, not for rewriting
   history: your own pour, on the day you poured it, and never the photo.
   The database enforces the same rule — see supabase/step-1.12.sql. */
export const canEdit = p => !!p && p.user==='me' && isToday(p.createdAt);

export function freshCreate(){return{editId:null,visibility:state.lastVisibility||'public',drink:state.me.favDrink||'Cappuccino',drinkCustom:'',pattern:null,caption:'',img:null,source:'home',cafe:'',
  bean:'',beanBrand:'',beanCustom:'',machineBrand:state.me.machineBrand||'',machineModel:state.me.machineModel||'',milk:state.me.favMilk||'',dose:'',yield:'',time:'',temp:''};}

/* ---------- derived selectors (read-only views over state) ----------
   The feed's copy of a post wins over the profile's: it is the one
   carrying likedByMe/saved for this viewer. Everything is deduped by id,
   so a post appearing in both places is still one post. */
function merge(...lists){
  const seen=new Set(), out=[];
  lists.forEach(l=>(l||[]).forEach(p=>{ if(p&&p.id&&!seen.has(p.id)){ seen.add(p.id); out.push(p); } }));
  return out;
}
export const allPosts=()=>merge(state.posts, mine.list, saved.list, state.myGallery);
export function myPosts(){
  return merge(state.posts.filter(p=>p.user==='me'), mine.list, (state.myGallery||[]))
    .sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'') || dayIndex(a)-dayIndex(b));
}
/* the user's own beans passport — grows from the beans they log, not the global catalog */
export function myBeans(){const seen=new Set(),out=[];myPosts().forEach(p=>{const b=p.recipe&&p.recipe.bean;if(b&&!seen.has(b)){seen.add(b);out.push(b);}});state.customBeans.forEach(b=>{if(b&&!seen.has(b)){seen.add(b);out.push(b);}});return out;}
export function myCountries(){return [...new Set(myBeans().map(n=>{const c=beanCatalog(n);return c&&c.c;}).filter(Boolean))];}


/* Every bean you have logged, most-poured first, with what the catalog
   knows about it. Beans you added yourself have no catalog entry and
   say so rather than being dropped. */
export function beanPassport(){
  const map=new Map();
  myPosts().forEach(p=>{
    const n=p.recipe&&p.recipe.bean; if(!n) return;
    const e=map.get(n)||{ name:n, pours:0, last:null };
    e.pours++;
    if(p.createdAt&&(!e.last||p.createdAt>e.last)) e.last=p.createdAt;
    map.set(n,e);
  });
  (state.customBeans||[]).forEach(n=>{ if(n&&!map.has(n)) map.set(n,{ name:n, pours:0, last:null, roaster:'' }); });
  return [...map.values()].map(e=>({ ...e, cat:beanCatalog(e.name) }))
    .sort((a,b)=>b.pours-a.pours || a.name.localeCompare(b.name));
}
/* The server applied the Following filter and the block list, so the
   page it returned *is* the feed. */
export const feedPosts=()=>state.posts;

/* activity bars derive from the user's own pours (last 21 days) — empty until they post */
export function activityBars(){const a=Array(21).fill(0);myPosts().forEach(p=>{const i=20-Math.min(20,dayIndex(p));if(i>=0)a[i]++;});return a;}

/* How many days ago a pour was, from its real timestamp where we have
   one and from the relative label otherwise. */
function dayIndex(p){
  if(p.createdAt){
    const t=Date.parse(p.createdAt);
    if(isFinite(t)) return Math.floor((startOfDay(Date.now())-startOfDay(t))/864e5);
  }
  return agoDays(p.ago);
}
const startOfDay=ms=>{const d=new Date(ms); d.setHours(0,0,0,0); return d.getTime();};

/* The streak is counted, not stored: consecutive days up to today (or
   up to yesterday, so a streak isn't "broken" before you've had your
   morning coffee) on which the user logged at least one pour. */
export function streak(){
  const days=new Set(myPosts().map(dayIndex).filter(d=>d>=0));
  if(!days.size) return 0;
  let start=days.has(0)?0:(days.has(1)?1:-1);
  if(start<0) return 0;
  let n=0; for(let d=start;days.has(d);d++) n++;
  return n;
}
