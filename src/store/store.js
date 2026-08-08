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
import { daysAgo, isToday } from '../core/util.js';
import { FEED_PAGE } from '../config.js';
import { beanCatalog, combineMachine } from '../data/catalog.js';
import { USERS, CAFES, CHALLENGES, PODIUM, handleToUid } from '../data/world.js';
import { fetchFeed, fetchMine, fetchSavedPosts } from '../data/posts.js';
import { fetchMyFollows, fetchMyLikes, fetchMySaves, fetchMyCafeFollows, fetchMyBlocks,
         fetchCafeFollowCounts, fetchFollowRequests } from '../data/social.js';
import { fetchChallenges, fetchChallengeWins, fetchPodium } from '../data/challenges.js';
import { fetchProfileCounts, fetchSuggestedProfiles } from '../data/profiles.js';
import { fetchNotifications } from '../data/notifications.js';
import { fetchReactions, noReactions } from '../data/reactions.js';
import { streakFrom, bestStreakFrom } from '../domain/streak.js';
import { makePersistence } from './persistence.js';

export const KEY='crema_v11';
let persistence=makePersistence(null,KEY);

/* The auth session, or null when signed out. Exported as a live binding
   so views can read it without importing the auth client.

   Null no longer means "there is no app". A signed-out visitor is a
   *guest*: they read today's public feed and the pours on it, and every
   attempt to act asks them to sign in (ui.gate below, ui/actions.js).
   So `session` answers "who is this", never "is there anything to
   show" — the selectors below work either way. */
export let session=null;

export let state;
/* `navStack` is the tabs you can come back to, oldest first — the other
   half of the back button, alongside `ovStack`. See ui/history.js. */
/* `gate` is the sign-in screen showing *instead of* the guest feed. It
   is only ever true while signed out, and it is a screen rather than a
   sheet for the same reason it always was: sheets can be popped by
   accident, and half-finished sign-ups can't be. */
/* `premium` is the redeem form's own state — the error under the code
   field and whether a check is in flight. Null until a surface that
   holds the field is opened, like `create` and `picker`. */
export const ui={route:'home', filter:'today', gate:false, ovStack:[], navStack:[], profTab:'stats', searchQ:'', obStep:1, cafeF:{open:false,promo:false,top:false}, create:null, avatarBusy:false, premium:null};

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
    /* The coffee you brewed with last, remembered for the same reason:
       a bag lasts weeks, so the next pour is almost always the same
       beans. Only the name is kept — the brand is derived from it, so
       a coffee that later joins the catalogue picks up its roaster. */
    lastBean:'',
    cafeFollow:{},
    customBeans:[], customDrinks:[],
    /* Premium's shelf: gear and coffees held at the top of their picker
       on purpose, rather than drifting down as recents age out. Free
       accounts get the automatic recents and nothing to maintain. */
    pins:{machines:[],beans:[]},
    onboarded:false, theme:'auto',
    /* step-1.21 reset the Premium flag on every existing account. A
       brand-new one has nothing to reset, so it is marked done here
       rather than being walked through a migration for a value it
       already has. */
    premiumReset:true,
    /* notify* mirror the column defaults, now all three on (step-1.19.sql
       flipped the streak nudge and the recap from off); the profile row
       overwrites them on sync. Present here so the reminder switches
       render a real position before the first sync rather than reading
       as "off" and inviting someone to turn on what is already on. */
    me:{name:'',handle:'',city:'',machineBrand:'',machineModel:'',favDrink:'Cappuccino',favMilk:'Whole milk',premium:false,bio:'',avatar:'',
        notifySocial:true,notifyStreak:true,notifyDigest:true,notifyMorning:true},
    notifications:[]
  };
}
export async function load(){try{const s=await persistence.read(); state=(s&&s.me)?s:freshState();
  ['posts','customBeans','customDrinks','myGallery','notifications'].forEach(k=>{if(!state[k])state[k]=[];});
  ['follows','cafeFollow','followPending'].forEach(k=>{if(!state[k])state[k]={};});
  if(!state.pins||!Array.isArray(state.pins.machines)||!Array.isArray(state.pins.beans)) state.pins={machines:[],beans:[]};
  /* Retired in step 1.17: challenges are no longer something you join or
     submit to, so the two maps that tracked that are dropped from any
     state persisted before it. */
  delete state.challenges; delete state.challengeSubs;
  if(state.lastVisibility!=='followers') state.lastVisibility='public';
  if(!state.me)state.me=freshState().me; if(!state.me.favMilk)state.me.favMilk='Whole milk';
  /* step-1.21: Premium stopped being a switch and became a code, and
     every account that had switched it on starts again. Postgres has
     already done this (the migration resets the column) and rowToMe()
     would overwrite the cached value on the next sign-in — but "until
     then" is hours of gold rings and a stats tab that quietly vanish,
     which reads as a bug rather than as a change. Once per browser,
     keyed by a flag rather than by a version, so it cannot fire twice
     and take away a code someone has since redeemed. */
  if(!state.premiumReset){ state.premiumReset=true; state.me.premium=false; save(); }
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

/* The three live challenges with this user's progress already in them.
   Refetched rather than mutated after a pour: progress is decided by
   Postgres (a pour can move two of the three at once, and only the
   database knows whether it crossed a goal), so guessing here would
   just be a second, worse implementation of the same rules. */
export const challenges={ list:[], loaded:false, wins:0 };
export async function loadChallenges(){
  if(!session) return false;
  try{
    challenges.list=await fetchChallenges();
    challenges.loaded=true;
    /* Completion rows outlive the week they were earned in, so the
       badge counts those rather than the live three. Its own try: a
       badge is not worth losing this week's challenges over. */
    try{ challenges.wins=(await fetchChallengeWins(session.user.id)).length; }
    catch(e){ console.warn('challenge wins failed',e); }
    /* CHALLENGES is what ui/ has always imported; refill it in place so
       the array identity every overlay holds stays valid. */
    CHALLENGES.length=0; CHALLENGES.push(...challenges.list);
    return true;
  }catch(e){ console.warn('challenges failed',e); return false; }
}

export async function hydrateSocial(){
  if(!session) return;
  const uid=session.user.id;
  try{
    const [follows,cafeFollows,blocks]=await Promise.all([
      fetchMyFollows(uid), fetchMyCafeFollows(uid), fetchMyBlocks(uid)
    ]);
    /* The server is the truth about who you follow — including the ones
       that are still only requests. Rebuild rather than merge, or a
       follow that was declined elsewhere lingers in this browser. */
    state.follows={}; state.followPending={};
    follows.accepted.forEach(id=>{ state.follows[id]=true; });
    follows.pending.forEach(id=>{ state.followPending[id]=true; });
    cafeFollows.forEach(id=>{ state.cafeFollow[id]=true; });
    social.blocks=blocks; social.loaded=true;
  }catch(e){ console.warn('social state failed',e); }

  /* Who is waiting on you. Its own try: a follow-request failure must
     not cost you the rest of your world. */
  try{ social.requests=await fetchFollowRequests(uid); }
  catch(e){ console.warn('follow requests failed',e); }

  /* Independent of the above — a failure here must not cost you the feed. */
  try{ state.notifications=await fetchNotifications(uid); }
  catch(e){ console.warn('notifications failed',e); }

  /* Today's podium. Empty is a real answer — nothing has been liked yet
     today — and the UI says so rather than inventing a board. */
  try{
    const board=await fetchPodium(uid,{ blocked:social.blocks });
    PODIUM.length=0; PODIUM.push(...board);
    cachePosts(board);
  }catch(e){ console.warn('podium failed',e); }

  try{
    mine.list=await fetchMine(uid,{ limit:200, myUid:uid });
    mine.loaded=true; cachePosts(mine.list);
  }catch(e){ console.warn('your pours failed',e); }

  try{ social.counts=await fetchProfileCounts(uid); }
  catch(e){ console.warn('profile counts failed',e); }

  try{ discover.list=await fetchSuggestedProfiles(uid,social.blocks); discover.loaded=true; }
  catch(e){ console.warn('suggestions failed',e); }

  /* The three live challenges, with progress. Nobody joins them, so
     there is no join count to fetch any more. */
  await loadChallenges();

  /* Real follow counts, so no screen shows a number nobody earned. */
  try{ applyCounts(await fetchCafeFollowCounts(), CAFES, 'followers'); }
  catch(e){ console.warn('cafe follow counts failed',e); }
}

function applyCounts(counts,list,field){ list.forEach(x=>{ x[field]=counts[x.id]|0; }); }

/* Which of these posts you liked, saved or reacted to. Per-viewer, so it
   can't ride along on the cached feed query.

   A guest has none of those, but the reaction *tallies* are public
   counts and still theirs to see — a busy pour showing three empty
   reaction slots would misrepresent it, and the counts are half of what
   makes the feed look alive to someone deciding whether to join. */
async function markMine(list){
  if(!list.length) return list;
  if(!session){
    try{
      const { counts }=await fetchReactions(list.map(p=>p.id), null);
      list.forEach(p=>{ p.reactions=counts[p.id]||noReactions(); });
    }catch(e){ console.warn('reactions failed',e); }
    return list;
  }
  try{
    const ids=list.map(p=>p.id);
    const [liked,savedIds,reactions]=await Promise.all([
      fetchMyLikes(session.user.id,ids), fetchMySaves(ids), fetchReactions(ids,session.user.id) ]);
    const L=new Set(liked), S=new Set(savedIds);
    list.forEach(p=>{ p.likedByMe=L.has(p.id); p.saved=S.has(p.id);
      p.reactions=reactions.counts[p.id]||noReactions();
      p.myReactions=reactions.mine[p.id]||[]; });
  }catch(e){ console.warn('interaction state failed',e); }
  return list;
}

/* The same, for one post that arrived outside a feed page — opened from
   the podium, a notification, or someone's profile grid. */
export async function hydrateReactions(list){
  if(!list||!list.length) return;
  try{
    const { counts, mine }=await fetchReactions(list.map(p=>p.id), session?session.user.id:null);
    list.forEach(p=>{ p.reactions=counts[p.id]||noReactions(); p.myReactions=mine[p.id]||[]; });
  }catch(e){ console.warn('reactions failed',e); }
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
  /* A guest gets Today and only Today: every public pour since their own
     midnight. There is no Following tab to honour, no block list of
     their own to apply, and no uid for anything to be marked as theirs.
     The same request a member's Today tab makes, minus the viewer —
     which is also exactly what RLS will hand the `anon` role, so the
     server agrees with the screen rather than being talked into it. */
  if(!session) return { myUid:null, authors:null, blocked:null, since:startOfToday(), publicOnly:true };
  const uid=session.user.id;
  if(ui.filter==='following') return { myUid:uid, authors:[...followeeIds(),uid], blocked:social.blocks };
  return { myUid:uid, authors:null, blocked:social.blocks, since:startOfToday(), publicOnly:true };
}

export async function loadFeed(){
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
  if(feed.loading||feed.done||!feed.cursor) return false;
  feed.loading=true;
  try{
    const list=await fetchFeed({ ...feedArgs(), before:feed.cursor });
    if(list.length){ state.posts.push(...await markMine(list)); feed.cursor=list[list.length-1].createdAt; }
    feed.done=list.length<FEED_PAGE;
    return list.length>0;
  }catch(e){ console.warn('feed page failed',e); return false; }
  finally{ feed.loading=false; }
}

/* Who you follow has already poured today — the face-pile strip on Home
   (ui/views.js friendsTodayStrip()). Reuses fetchFeed() rather than a new
   endpoint: same authors+since query the Following tab already makes,
   just collapsed to distinct authors instead of rendered as posts. Best
   effort and silent on failure — a strip that occasionally doesn't
   appear is not worth a toast over. */
export const friendsToday={ list:[], loaded:false };
export async function loadFriendsToday(){
  if(!session){ friendsToday.list=[]; friendsToday.loaded=true; return false; }
  const authors=followeeIds();
  if(!authors.length){ friendsToday.list=[]; friendsToday.loaded=true; return true; }
  try{
    const rows=await fetchFeed({ myUid:session.user.id, authors, since:startOfToday(), limit:100 });
    const seen=new Set();
    friendsToday.list=rows.map(p=>p.user).filter(id=>{ if(seen.has(id)) return false; seen.add(id); return true; });
    friendsToday.loaded=true;
    return true;
  }catch(e){ console.warn('friends-today failed',e); return false; }
}

/* Point the store at the signed-in user's own store and load their world.
   Signing out drops back to an empty state and the guest feed — the
   public Today page, which needs no account and so needs none of the
   per-user hydration below. Every sign-in and sign-out goes through this
   one function. */
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
  friendsToday.list=[]; friendsToday.loaded=false;
  /* Following is a signed-in tab, so a sign-out has to leave it — or the
     segment would sit on a tab the guest feed can't be. */
  if(!next) ui.filter='today';
  if(next) await hydrateSocial();
  /* Parallel, not sequential: friendsToday depends on hydrateSocial()
     (followeeIds()) but not on the feed, and store.js has no render() to
     call once a later-arriving answer would need to repaint — so both
     have to be settled before useSession() itself resolves, and callers
     render off what it leaves in the store. */
  await Promise.all([loadFeed(), loadFriendsToday()]);
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
  /* So your own face wears the ring in the feed exactly as everyone
     else's does — USERS.me is the one row that never arrives from
     Postgres, so it has to be mirrored here or you would be the only
     Premium member who couldn't see it. */
  USERS.me.premium=!!state.me.premium;
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
   The database enforces the same rule — see platform/supabase/step-1.12.sql. */
export const canEdit = p => !!p && p.user==='me' && isToday(p.createdAt);

/* The sheet carries the coffee's own name and nothing else — the roaster
   is looked up from it when one is needed. It used to carry a separate
   brand too, because the picker made you choose the brand before the
   coffee; the searchable picker asks for one thing, so one thing is
   stored. */
export function freshCreate(){
  return{editId:null,visibility:state.lastVisibility||'public',drink:state.me.favDrink||'Cappuccino',drinkCustom:'',pattern:null,caption:'',img:null,source:'home',cafe:'',
  bean:state.lastBean||'',machineBrand:state.me.machineBrand||'',machineModel:state.me.machineModel||'',milk:state.me.favMilk||'',dose:'',yield:'',time:'',temp:''};}

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

/* ---------- the "Yours" shelf, top of every picker ----------
   Almost every pour is made on the machine you made yesterday's on, with
   the bag that is still open. That makes memory — not search, and
   certainly not a 200-row dropdown — the fastest way to name either one,
   so both pickers open on this list and most mornings never scroll past
   it.

   Pins first (Premium put them there deliberately), then what you last
   used, then the rest of your own history. Everything here is a plain
   display string, exactly as it is stored on a recipe. */
function shelf(pinned,...rest){
  const seen=new Set(), out=[];
  const push=v=>{ const s=(v||'').trim(); if(s&&!seen.has(s)){ seen.add(s); out.push(s); } };
  (pinned||[]).forEach(push);
  rest.forEach(l=>(l||[]).forEach(push));
  return out;
}
export function myMachines(){
  return shelf((state.pins&&state.pins.machines)||[],
    [combineMachine(state.me.machineBrand,state.me.machineModel)],
    myPosts().map(p=>p.recipe&&p.recipe.machine));
}
export function myCoffees(){
  return shelf((state.pins&&state.pins.beans)||[],
    [state.lastBean], beanPassport().map(b=>b.name));
}
/* Pinning is Premium; the picker shows the lock rather than hiding it,
   because a shelf you can see is the argument for the feature. */
export function isPinned(kind,name){
  const l=(state.pins&&state.pins[kind==='machine'?'machines':'beans'])||[];
  return l.includes(name);
}
export function togglePin(kind,name){
  if(!state.pins) state.pins={machines:[],beans:[]};
  const k=kind==='machine'?'machines':'beans', l=state.pins[k], i=l.indexOf(name);
  if(i>=0) l.splice(i,1); else l.unshift(name);
  save();
  return i<0;
}


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

/* ---------- the numbers behind your coffee ----------
   Everything the Stats tab shows, derived in one pass so the tab is a
   presentation of this and holds no arithmetic of its own.

   Two rules run through all of it. Nothing is invented: a stat with no
   pours behind it comes back null and the tab leaves it out, rather than
   showing a confident 0 for something never recorded. And "favourite"
   means counted, not configured — the old tab read favDrink off the
   profile, which is the drink you once told a form about, not the one
   you keep making. Those two are often not the same drink, and the
   second one is the interesting one. */
const tally=list=>{
  const m=new Map();
  list.forEach(v=>{ const s=(v||'').trim(); if(s) m.set(s,(m.get(s)||0)+1); });
  return [...m.entries()]
    .sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))
    .map(([name,count])=>({name,count}));
};
/* Recipe fields are free text carrying their unit ("18g", "27.5 g"), and
   a German keyboard writes the decimal with a comma. */
const numOf=v=>{
  const f=parseFloat((''+(v==null?'':v)).replace(',','.').replace(/[^0-9.]/g,''));
  return isFinite(f)&&f>0?f:null;
};
const mean=l=>l.length?l.reduce((a,b)=>a+b,0)/l.length:null;

export function coffeeStats(){
  const posts=myPosts(), n=posts.length;
  if(!n) return null;

  const drinks=tally(posts.map(p=>p.drink));
  const beans=tally(posts.map(p=>p.recipe&&p.recipe.bean));
  const machines=tally(posts.map(p=>p.recipe&&p.recipe.machine));
  const milks=tally(posts.map(p=>p.recipe&&p.recipe.milk));
  const roasters=tally(posts.map(p=>{ const b=p.recipe&&p.recipe.bean, c=b&&beanCatalog(b); return c&&c.roaster; }));
  const patterns=tally(posts.filter(p=>p.art&&p.pattern).map(p=>p.pattern));

  /* Per-day is over the whole span since the first pour, including the
     days with none — an average that skipped the empty days would just
     be "how many you log when you log", which is nearly always 1. */
  const idx=posts.map(dayIndex).filter(d=>d>=0&&isFinite(d));
  const span=idx.length?Math.max(...idx)+1:1;
  const byDay=new Map();
  idx.forEach(d=>byDay.set(d,(byDay.get(d)||0)+1));

  /* Hour of day, from real timestamps only. Pours carrying just a
     relative label ("3d") have no clock in them and are left out rather
     than guessed into a bucket — so the histogram counts what it can and
     says how much that was. */
  const hours=Array(24).fill(0); let timed=0;
  /* Day of the week, on the other hand, IS knowable for a pour that only
     carries a relative label — "3d" back from today is a specific
     weekday — so this counts every pour rather than only the timed ones,
     and does it through dayIndex() so the two agree about where a day
     starts. */
  const weekdays=Array(7).fill(0);
  posts.forEach(p=>{ const t=Date.parse(p.createdAt);
    if(isFinite(t)){ hours[new Date(t).getHours()]++; timed++; }
    const d=dayIndex(p);
    if(d>=0&&isFinite(d)) weekdays[new Date(Date.now()-d*864e5).getDay()]++; });
  const peakHour=timed?hours.indexOf(Math.max(...hours)):null;

  /* ----- the long arc -----
     Weekly totals counting back from today, so every bucket is a full
     seven days and the newest one is comparable with the rest. Only
     weeks the history actually covers are built: a first bucket that is
     half outside someone's account would draw a slump they never had.

     Deliberately NOT the same shape as the 21 daily bars on the profile
     above. Those answer "what have I done lately"; this answers "which
     way is it going", which is a different question and the one a habit
     is actually judged by. */
  const inRange=(a,b)=>idx.filter(d=>d>=a&&d<b).length;
  const fullWeeks=Math.min(12,Math.floor(span/7));
  const weeks=[];
  for(let w=fullWeeks-1;w>=0;w--) weeks.push(inRange(w*7,w*7+7));

  /* Month on month, and only once there are two whole months to set
     against each other. A percentage off a fortnight is noise wearing a
     decimal point. */
  const trend = span>=60 ? (()=>{
    const recent=inRange(0,30), prev=inRange(30,60);
    return { recent, prev, pct: prev ? Math.round((recent-prev)/prev*100) : null };
  })() : null;

  /* The espresso numbers, for the people who fill them in. A ratio is
     the mean of each shot's own yield÷dose rather than total÷total: one
     outlier litre of cold brew shouldn't redefine your espresso. */
  const shots=posts.map(p=>{ const r=p.recipe||{};
    return {dose:numOf(r.dose), out:numOf(r.yield), secs:numOf(r.time), temp:numOf(r.temp)}; });
  const pairs=shots.filter(s=>s.dose&&s.out);
  const secs=shots.map(s=>s.secs).filter(Boolean);
  const brew=pairs.length?{
    n:pairs.length,
    dose:mean(pairs.map(s=>s.dose)),
    out:mean(pairs.map(s=>s.out)),
    ratio:mean(pairs.map(s=>s.out/s.dose)),
    secs:secs.length?mean(secs):null, secsN:secs.length
  }:null;

  const st=streakInfo();
  return {
    pours:n, span, daysLogged:byDay.size,
    busiest:byDay.size?Math.max(...byDay.values()):0,
    perDay:n/span, perWeek:(n/span)*7,
    drinks, beans, machines, milks, roasters, patterns,
    artPours:posts.filter(p=>p.art&&p.pattern).length,
    cafePours:posts.filter(p=>p.cafe).length,
    hours, timed, peakHour, weekdays,
    weeks, trend,
    brew, streak:st.days, best:st.best
  };
}

/* ----- the week, as something you can hand to someone -----
   coffeeStats() answers "what am I like"; this answers "what did I do
   this week", which is a different question and the only one worth
   putting on a card. Seven days back including today, so it moves with
   you rather than resetting on Monday — a recap that is empty every
   Monday morning is a recap nobody opens.

   Same two rules as everywhere else: nothing invented, and a week with
   no pours in it returns null so the surface can say so instead of
   drawing a card full of zeroes. */
/* Which week the card is about: the last COMPLETE Monday–Sunday, not
   the rolling seven days behind right now. Two reasons, and the second
   is the product one.

   A calendar week is a thing people can share about. "My week" that
   silently means "since last Tuesday" is a different week for everyone
   who reads it, and two friends comparing cards would be comparing
   different windows.

   And it changes once a week, on Monday. The card is a weekly artifact
   rather than a live dashboard: it lands, it is the same card all week,
   and it says on its face which week it is. A recap that quietly
   reshuffled every morning is a stat page, not something you post.

   Offsets are days-back-from-today, so they line up with dayIndex(),
   which is the one place in the app that decides what day a pour
   happened on. Today Monday → last Sunday was 1 day ago, last Monday 7;
   today Sunday → 7 and 13, because *this* Sunday is not over yet. */
export function lastWeekWindow(now=new Date()){
  const dow=(now.getDay()+6)%7;                 // Mon=0 … Sun=6
  const endOff=dow+1, startOff=dow+7;
  const mid=new Date(now); mid.setHours(0,0,0,0);
  const from=new Date(mid); from.setDate(mid.getDate()-startOff);
  const to=new Date(mid);   to.setDate(mid.getDate()-endOff);
  return { startOff, endOff, from, to };
}

export function weekRecap(){
  const posts=myPosts();
  const w=lastWeekWindow();
  /* Monday is 0. -1 means the pour is outside the week entirely. */
  const dayOf=p=>{ const i=dayIndex(p);
    return (i>=w.endOff && i<=w.startOff) ? w.startOff-i : -1; };
  const week=posts.filter(p=>dayOf(p)>=0);
  if(!week.length) return null;

  /* The distribution across the week, Monday first — the card draws the
     pours themselves stacked into these seven columns, so this is both
     the shape of the week and the index every shot is placed by. */
  const days=Array(7).fill(0);
  week.forEach(p=>{ days[dayOf(p)]++; });

  const drinks=tally(week.map(p=>p.drink));
  const beans=tally(week.map(p=>p.recipe&&p.recipe.bean));
  const patterns=tally(week.filter(p=>p.art&&p.pattern).map(p=>p.pattern));

  /* "New that week" means new to you, and is decided against what you
     logged BEFORE it — strictly older, so the coffee you started
     drinking since does not retroactively age the week's discovery. */
  const earlier=new Set(posts.filter(p=>dayIndex(p)>w.startOff)
    .map(p=>((p.recipe&&p.recipe.bean)||'').trim()).filter(Boolean));
  const newBeans=beans.filter(b=>!earlier.has(b.name));

  /* The pours themselves, Monday first, slimmed to what a picture of
     them needs: the photo where there is one, and the pattern/quality/
     seed to generate a cup where there isn't — exactly what art() in the
     feed decides between, from exactly the same three fields. */
  const shots=week.slice()
    .sort((a,b)=>dayOf(a)-dayOf(b))
    .map(p=>({ id:p.id, day:dayOf(p), img:p.img||null, pattern:p.pattern||null,
               quality:p.quality==null?0.9:p.quality, drink:p.drink||'' }));

  /* The longest run inside the week, not the live streak. A card about
     last week that carries today's number would be two different weeks
     wearing one date. */
  let bestRun=0, run=0;
  days.forEach(c=>{ run=c?run+1:0; if(run>bestRun) bestRun=run; });

  return {
    pours:week.length, shots, days,
    daysWithCoffee:days.filter(Boolean).length,
    busiest:Math.max(...days),
    drinks, beans, patterns, newBeans,
    artPours:week.filter(p=>p.art&&p.pattern).length,
    cafePours:week.filter(p=>p.cafe).length,
    bestRun,
    from:w.from, to:w.to
  };
}

/* activity bars derive from the user's own pours (last 21 days) — empty until they post */
export function activityBars(){const a=Array(21).fill(0);myPosts().forEach(p=>{const i=20-Math.min(20,dayIndex(p));if(i>=0)a[i]++;});return a;}

/* How many days ago a pour was, from its real timestamp where we have
   one and from the relative label otherwise. */
const dayIndex=p=>daysAgo(p.createdAt,p.ago);

/* The days this user poured on, as indices back from today. Everything
   streak-shaped is derived from this one set — see domain/streak.js for
   the rules, which are pure so they can be tested and, eventually,
   shared with the reminder job that has to agree with them. */
const pourDays=()=>new Set(myPosts().map(dayIndex).filter(d=>d>=0));

/* The streak is counted, not stored: consecutive days up to today (or
   up to yesterday, so a streak isn't "broken" before you've had your
   morning coffee) on which the user logged at least one pour.

   streakInfo() is the full picture the reminder UI needs — is it at
   risk, has the rest day been spent, what is the personal best. streak()
   stays a plain number for the callers that only ever wanted one. */
export function streakInfo(){
  const days=pourDays();
  const cur=streakFrom(days);
  /* bestStreakFrom() starts a run at every block head, and the live
     streak's head is one of them, so it already accounts for today. */
  return { ...cur, best:bestStreakFrom(days) };
}
export const streak = () => streakFrom(pourDays()).days;
