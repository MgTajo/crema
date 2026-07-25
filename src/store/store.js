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
import { clone, agoDays } from '../core/util.js';
import { FEED_PAGE } from '../config.js';
import { beanCatalog } from '../data/catalog.js';
import { USERS, SEED_POSTS, LEADERBOARD, handleToUid } from '../data/seed.js';
import { fetchFeed } from '../data/posts.js';
import { fetchMyFollows, fetchMyLikes, fetchMySaves, fetchMyCafeFollows, fetchMyBlocks } from '../data/social.js';
import { fetchMyJoins, fetchLeaderboard } from '../data/challenges.js';
import { fetchNotifications } from '../data/notifications.js';
import { makePersistence } from './persistence.js';

export const KEY='crema_v10';
let persistence=makePersistence(null,KEY);

/* The auth session, or null when signed out. Exported as a live binding
   so views can read it without importing the auth client. */
export let session=null;

export let state;
export const ui={route:'home', filter:'foryou', ovStack:[], profTab:'pours', searchQ:'', obStep:1, cafeF:{open:false,promo:false,top:false}, create:null};

export function freshState(){
  // A demo user starts like a fresh download: no pours, no followers, no streak.
  // Everyone else's world stays alive — the community feed, challenges, cafés & leaderboards are all populated.
  return {
    posts:SEED_POSTS.map(clone), myGallery:[],
    follows:{mara:false,yuki:false,sofia:false,tom:false,dev:false,lena:false,kofi:false,june:false,aria:false},
    cafeFollow:{},
    challenges:{},
    challengeSubs:{}, streak:0, customBeans:[],
    onboarded:false, theme:'auto',
    me:{name:'',handle:'',city:'Tübingen',machineBrand:'Sage',machineModel:'Bambino Plus',favDrink:'Cappuccino',favMilk:'Whole milk',premium:false,bio:''},
    notifications:[]
  };
}
export async function load(){try{const s=await persistence.read(); state=s&&s.posts?s:freshState();
  ['customBeans','myGallery','notifications'].forEach(k=>{if(!state[k])state[k]=[];});
  if(!state.me)state.me=freshState().me; if(!state.me.favMilk)state.me.favMilk='Whole milk'; if(!state.challengeSubs)state.challengeSubs={};
 }catch(e){state=freshState();}}
/* fire-and-forget: the UI has already repainted optimistically, so a failed
   write must never block or throw — it only warns. */
export function save(){ Promise.resolve(persistence.write(state)).catch(err=>console.warn('save failed',err)); }
export async function clearSaved(){ try{ await persistence.clear(); }catch(err){ console.warn('clear failed',err); } }

/* Swap the persistence adapter for the new auth state and reload.
   The whole sign-in/sign-out migration goes through this one function.

   First sign-in on a device is the interesting case: the user has been
   using the demo and has a world already. Rather than dropping them into
   an empty account, we carry that world across to their user-scoped
   store. Signing in should never feel like starting over. */
/* ---------- the remote feed (step 1.5) ----------
   Signed out, none of this runs and the bundled seed feed is the feed. */
export const feed={ loading:false, done:false, cursor:null, seeded:false };

/* Who you follow / block, from the server. `state.follows` stays the
   app-wide truth (seed ids and auth uuids share the map) so no view
   needed changing. */
export const social={ blocks:[], loaded:false };
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
    follows.forEach(id=>{ state.follows[id]=true; });
    cafeFollows.forEach(id=>{ state.cafeFollow[id]=true; });
    joins.forEach(id=>{ state.challenges[id]=true; });
    social.blocks=blocks; social.loaded=true;
  }catch(e){ console.warn('social state failed',e); }

  /* Independent of the above — a failure here must not cost you the feed. */
  try{ state.notifications=await fetchNotifications(uid); }
  catch(e){ console.warn('notifications failed',e); }

  try{
    const board=await fetchLeaderboard();
    /* Empty means the scheduled job hasn't run yet; keep the bundled
       board rather than showing an empty screen. */
    if(board.length){ LEADERBOARD.length=0; LEADERBOARD.push(...board); }
  }catch(e){ console.warn('leaderboard failed',e); }
}

/* Which of these posts you liked or saved. Per-viewer, so it can't ride
   along on the cached feed query. */
async function markMine(list){
  if(!session||!list.length) return list;
  try{
    const ids=list.map(p=>p.id);
    const [liked,saved]=await Promise.all([ fetchMyLikes(session.user.id,ids), fetchMySaves(ids) ]);
    const L=new Set(liked), S=new Set(saved);
    list.forEach(p=>{ p.likedByMe=L.has(p.id); p.saved=S.has(p.id); });
  }catch(e){ console.warn('interaction state failed',e); }
  return list;
}

/* The Following tab filters server-side so pagination stays correct. */
function feedArgs(){
  const uid=session.user.id;
  const authors = ui.filter==='following' ? [...followeeIds(),uid] : null;
  return { myUid:uid, authors, blocked:social.blocks };
}

export async function loadFeed(){
  if(!session) return false;
  feed.loading=true;
  try{
    const list=await fetchFeed(feedArgs());
    /* An empty *For you* table is the expected state right after
       migrating, not a broken feed — keep the seeded world visible so
       the app still has something to show. An empty Following feed is
       just an empty following list, and says so honestly. */
    if(!list.length && ui.filter!=='following'){ feed.seeded=true; feed.done=true; feed.cursor=null; return false; }
    feed.seeded=false;
    state.posts=await markMine(list);
    feed.cursor=list.length?list[list.length-1].createdAt:null;
    feed.done=list.length<FEED_PAGE;
    return true;
  }catch(e){ console.warn('feed load failed — staying on local data',e); return false; }
  finally{ feed.loading=false; }
}

export async function loadMoreFeed(){
  if(!session||feed.loading||feed.done||feed.seeded||!feed.cursor) return false;
  feed.loading=true;
  try{
    const list=await fetchFeed({ ...feedArgs(), before:feed.cursor });
    if(list.length){ state.posts.push(...await markMine(list)); feed.cursor=list[list.length-1].createdAt; }
    feed.done=list.length<FEED_PAGE;
    return list.length>0;
  }catch(e){ console.warn('feed page failed',e); return false; }
  finally{ feed.loading=false; }
}

export async function useSession(next){
  const carried = next && state ? state : null;
  session = next;
  persistence = makePersistence(next, KEY);
  const existing = await persistence.read();
  if(carried && !(existing && existing.posts)) save();
  else await load();
  feed.done=false; feed.cursor=null; feed.seeded=false;
  social.blocks=[]; social.loaded=false;
  if(next){ await hydrateSocial(); await loadFeed(); }
}

export function findPost(id){return state.posts.find(p=>p.id===id)||(state.myGallery||[]).find(p=>p.id===id);}
export function applyMe(){
  state.me.name=(state.me.name||'').trim();
  USERS.me.name=state.me.name||'You';
  USERS.me.city=(state.me.city||'').trim();
  USERS.me.bio=state.me.bio||'';
  let h=(state.me.handle||'').replace(/\s+/g,'').replace(/^@+/,'');
  if(!h) h=USERS.me.name.toLowerCase().replace(/[^a-z0-9._]/g,'')||'you';
  USERS.me.handle='@'+h;
  handleToUid[h]='me';
}
export function freshCreate(){return{drink:state.me.favDrink||'Cappuccino',pattern:'rosetta',caption:'',img:null,source:'home',cafe:'',
  bean:'',beanCustom:'',roaster:'',machineBrand:state.me.machineBrand||'',machineModel:state.me.machineModel||'',milk:state.me.favMilk||'',dose:'',yield:'',time:'',temp:''};}

/* ---------- derived selectors (read-only views over state) ---------- */
export const allPosts=()=>[...state.posts,...(state.myGallery||[])];
export const myPosts=()=>allPosts().filter(p=>p.user==='me');
/* the user's own beans passport — grows from the beans they log, not the global catalog */
export function myBeans(){const seen=new Set(),out=[];myPosts().forEach(p=>{const b=p.recipe&&p.recipe.bean;if(b&&!seen.has(b)){seen.add(b);out.push(b);}});state.customBeans.forEach(b=>{if(b&&!seen.has(b)){seen.add(b);out.push(b);}});return out;}
export function myCountries(){return [...new Set(myBeans().map(n=>{const c=beanCatalog(n);return c&&c.c;}).filter(Boolean))];}
export function myRoasters(){const set=new Set();myBeans().forEach(n=>{const c=beanCatalog(n);if(c)set.add(c.roaster);});return [...set];}
/* Signed in, the server already applied the Following filter and the
   block list, so the page is the feed. Signed out, filter the seeded
   world locally exactly as before. */
export function feedPosts(){
  if(session && !feed.seeded) return state.posts;
  return ui.filter==='following' ? state.posts.filter(p=>p.user==='me'||state.follows[p.user]) : state.posts;
}
/* activity bars derive from the user's own pours (last 21 days) — empty until they post */
export function activityBars(){const a=Array(21).fill(0);myPosts().forEach(p=>{const i=20-Math.min(20,agoDays(p.ago));if(i>=0)a[i]++;});return a;}
