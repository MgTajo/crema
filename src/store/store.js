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
import { beanCatalog, combineMachine, machineInfo } from '../data/catalog.js';
import { USERS, CAFES, CHALLENGES, PODIUM, handleToUid } from '../data/world.js';
import { fetchFeed, fetchMine, fetchSavedPosts } from '../data/posts.js';
import { fetchMyFollows, fetchMyLikes, fetchMySaves, fetchMyCafeFollows, fetchMyBlocks,
         fetchCafeFollowCounts, fetchFollowRequests } from '../data/social.js';
import { fetchChallenges, fetchChallengeWins, fetchPodium } from '../data/challenges.js';
import { fetchProfileCounts, fetchSuggestedProfiles } from '../data/profiles.js';
import { fetchNotifications } from '../data/notifications.js';
import { fetchReactions, noReactions } from '../data/reactions.js';
import { fetchQueue, fetchLog as fetchModLog } from '../data/moderation.js';
import { fetchGear, rememberGear, noteGear, favGear } from '../data/gear.js';
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
    /* Coffees and brewers the catalogue has never heard of, kept so the
       picker offers them back tomorrow. Machines used to have no list
       of their own: one you typed in survived only if you posted with
       it, so adding your grandmother's moka pot and then changing your
       mind lost it. */
    customBeans:[], customMachines:[], customDrinks:[],
    /* Premium's shelf: gear and coffees held at the top of their picker
       on purpose, rather than drifting down as recents age out. Free
       accounts get the automatic recents and nothing to maintain.
       Called `pins` here and *favourites* on screen — the state key is
       older than the word and renaming it would drop everyone's. */
    pins:{machines:[],beans:[]},
    /* What you wrote down about a coffee or a brewer, keyed by the name
       exactly as a recipe stores it. Premium, private, and yours alone:
       nothing here is ever sent anywhere, which is precisely why you
       may write whatever you like in it. Catalogue entries take a note;
       a coffee you added yourself takes the whole card, because there
       is no roaster row behind it to fill one in.
         beans:    name → {roaster,origin,roast,notes,note}
         machines: name → {kind,note}                                */
    gear:{beans:{},machines:{}},
    /* Whether this browser's shelf has ever met the server (step-1.29).
       False on a browser whose shelf predates the table, and the one
       thing that lets hydrateGear() tell "you have nothing" apart from
       "you have nothing HERE yet". */
    gearSynced:false,
    /* The pours held up as this week's standouts on the recap card,
       keyed by the week's Monday — see toggleRecapPick(). */
    recapPicks:{},
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
  ['posts','customBeans','customMachines','customDrinks','myGallery','notifications'].forEach(k=>{if(!state[k])state[k]=[];});
  ['follows','cafeFollow','followPending','recapPicks'].forEach(k=>{if(!state[k])state[k]={};});
  if(!state.pins||!Array.isArray(state.pins.machines)||!Array.isArray(state.pins.beans)) state.pins={machines:[],beans:[]};
  if(!state.gear||typeof state.gear!=='object') state.gear={beans:{},machines:{}};
  ['beans','machines'].forEach(k=>{ if(!state.gear[k]||typeof state.gear[k]!=='object') state.gear[k]={}; });
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

/* ---------- the moderation queue ----------
   Loaded only when the admin sheet is open, and never cached to
   localStorage: it holds other people's reports and the content they
   reported, which has no business surviving in a browser after the
   sheet is closed. `err` is kept because the two ways this fails —
   step-1.27.sql not run, or this account not being an admin — need
   different sentences on screen.

   Everything here is a convenience. The database checks is_admin() on
   every one of these calls itself; hiding the sheet is not what makes
   moderation safe. */
export const admin={ tab:'open', list:[], log:[], loading:false, loaded:false, err:'', busy:'' };
export async function loadQueue(){
  if(!session||admin.loading) return false;
  admin.loading=true; admin.err='';
  try{
    if(admin.tab==='log') admin.log=await fetchModLog(80);
    else admin.list=await fetchQueue(admin.tab==='all'?'all':admin.tab, 80);
    admin.loaded=true;
    return true;
  }catch(e){
    console.warn('moderation queue failed',e);
    admin.err = e && e.needsMigration
      ? 'Moderation needs platform/supabase/step-1.27.sql — it has not been run yet.'
      : e && e.notAdmin
        ? 'This account is not an admin.'
        : 'The queue would not load. Try again.';
    return false;
  }
  finally{ admin.loading=false; }
}

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

  try{ await hydrateGear(uid); }
  catch(e){ console.warn('gear failed',e); }

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
    /* A full reload supersedes anything queued: these rows ARE the
       arrivals now. Left alone, the pill would survive its own contents
       and put a second copy of each pour on the feed when tapped. */
    arrivals.list=[];
    feed.cursor=list.length?list[list.length-1].createdAt:null;
    feed.done=list.length<FEED_PAGE;
    feed.loaded=true;
    return true;
  }catch(e){ console.warn('feed load failed — keeping what we have',e); return false; }
  finally{ feed.loading=false; }
}

/* ---------- pours that landed while you were looking ----------
   A post that arrives from store/live.js does NOT go straight into
   `state.posts`. New pours arrive at the *top*, so splicing one in
   shifts every card below it onto different content — under the thumb
   of someone mid-scroll, which is the same failure refreshOnReturn()
   in ui/actions.js already refuses to cause. They queue here instead,
   the feed shows a count, and ui/ applies them when it is safe to: at
   the top of the list, or on a tap.

   Deliberately re-asking through fetchFeed() rather than trusting the
   row Realtime handed us: feedArgs() is where "Today vs Following",
   the block list and public-only live, and having two implementations
   of that is how the two get to disagree. It also means the polling
   fallback and the socket produce identical results. */
export const arrivals={ list:[] };
export const dropArrivals = () => { arrivals.list=[]; };

/* Everything newer than the newest pour we already hold. Returns how
   many things changed, so a caller knows whether to repaint at all. */
export async function fetchArrivals(){
  if(!feed.loaded || feed.loading) return 0;
  /* An empty feed has no "newest", and nothing below it to shift — so
     it is not an arrival, it is just the feed loading for the first
     time with something in it. */
  if(!state.posts.length && !arrivals.list.length) return (await loadFeed()) ? 1 : 0;

  const held=[...arrivals.list, ...state.posts];
  const known=new Set(held.map(p=>p.id));
  const newest=held.reduce((a,p)=>(!a||p.createdAt>a)?p.createdAt:a, null);
  try{
    /* `since` is gte, so the newest post comes back with them; `known`
       is what drops it again. Cheaper than an exclusive cursor, and
       correct when two pours share a timestamp.

       The honest limit: more than FEED_PAGE pours between two checks and
       this only sees the newest page, so applying them would leave a gap
       in the middle of the feed until the next full load. That needs
       twelve pours inside sixty seconds — a scale this app does not have
       and would notice arriving. */
    const list=await fetchFeed({ ...feedArgs(), since:newest, limit:FEED_PAGE });
    const fresh=list.filter(p=>!known.has(p.id));
    if(!fresh.length) return 0;
    await markMine(fresh);
    cachePosts(fresh);
    arrivals.list=[...fresh, ...arrivals.list]
      .sort((a,b)=>a.createdAt<b.createdAt?1:a.createdAt>b.createdAt?-1:0);
    return fresh.length;
  }catch(e){ console.warn('arrivals failed',e); return 0; }
}

export function applyArrivals(){
  if(!arrivals.list.length) return 0;
  /* Belt and braces against a reload landing between the fetch and the
     tap: a pour that is already on the feed must not arrive on it twice. */
  const here=new Set(state.posts.map(p=>p.id));
  const add=arrivals.list.filter(p=>!here.has(p.id));
  arrivals.list=[];
  if(!add.length) return 0;
  state.posts=[...add, ...state.posts];
  return add.length;
}

/* A pour that was deleted anywhere it might be showing. The postCache
   is private to this module, which is why this lives here rather than
   in the caller. */
export function forgetPost(id){
  let gone=false;
  const drop=list=>{ const i=(list||[]).findIndex(p=>p.id===id); if(i>=0){ list.splice(i,1); gone=true; } };
  drop(state.posts); drop(arrivals.list); drop(mine.list); drop(saved.list);
  drop(state.myGallery); drop(PODIUM);
  if(postCache.delete(id)) gone=true;
  return gone;
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
  arrivals.list=[];
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
  return{editId:null,visibility:state.lastVisibility||'public',drink:state.me.favDrink||'Cappuccino',drinkCustom:'',pattern:null,caption:'',source:'home',cafe:'',
  /* The photos, before they are squares. One entry per picture:
       { sid, img, preview, w, h, focus, adjustable, uploading, failed }
     `preview` is the whole picture as picked, `focus` where the 1:1 crop
     sits along it (domain/framing.js), `adjustable` whether there is any
     choice to make. Only `img` becomes a post; the rest is sheet-local.

     An array rather than one field because Premium may attach up to
     three (step-1.28). It is still one photo for almost everybody, and
     the first one is still the pour: it is what the feed card, the
     profile grid, the week card and the link preview all show. */
  photos:[],photoI:0,
  /* Closed by default — most people posting a coffee are not tracking
     dose/yield/time/temp, and a form full of espresso-nerd fields reads
     as "this app is not for me". The bean/machine are still prefilled
     from what you last used, ready the moment someone opens the panel,
     but composeFromSheet only reads them once recipeOpen is true. */
  recipeOpen:false,
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
    machinePassport().map(m=>m.name));
}
export function myCoffees(){
  return shelf((state.pins&&state.pins.beans)||[],
    [state.lastBean], beanPassport().map(b=>b.name));
}
/* Favourites are Premium; the picker shows the lock rather than hiding
   it, because a shelf you can see is the argument for the feature.
   `pins` is the state key — see freshState() for why it kept the name. */
export function isPinned(kind,name){
  const l=(state.pins&&state.pins[kind==='machine'?'machines':'beans'])||[];
  return l.includes(name);
}
export function togglePin(kind,name){
  if(!state.pins) state.pins={machines:[],beans:[]};
  const k=kind==='machine'?'machines':'beans', l=state.pins[k], i=l.indexOf(name);
  const on=i<0;
  if(i>=0) l.splice(i,1); else l.unshift(name);
  save();
  push(favGear(kind,name,on));
  return on;
}

/* ---------- the shelf, on the server ----------
   `state` is still the shape every view reads, and it is still written
   to localStorage — that is what makes the app paint instantly and work
   offline. What changed in step-1.29 is that localStorage is now the
   *cache* and `user_gear` is the truth, the same relationship
   state.follows has had with the follows table all along.

   Writes are fire-and-forget: the store has already changed and the UI
   has already repainted, so a failed sync warns rather than blocking
   somebody from naming their coffee. It costs the entry on this device
   until the next successful write of the same thing, which is the same
   bargain every optimistic write in this app makes. */
const push = p => Promise.resolve(p).catch(err=>console.warn('shelf sync failed',err));

/* Something they added that the catalogue does not have. Called from
   both places a name can be invented — the picker's "Add", and posting
   with a coffee nobody has heard of. */
export function rememberOwn(kind,name){
  const n=(name||'').trim(); if(!n) return;
  const list = kind==='machine' ? (state.customMachines||(state.customMachines=[]))
             : kind==='drink'   ? (state.customDrinks||(state.customDrinks=[]))
             :                    (state.customBeans||(state.customBeans=[]));
  if(!list.includes(n)){ list.push(n); save(); }
  push(rememberGear(kind,n));
}

/* Rebuild `state` from the rows, rather than merging into it: a
   favourite removed on your phone has to disappear here, and a merge
   would keep resurrecting it. Same rule, and the same reason, as
   hydrateSocial() rebuilding state.follows.

   The one exception is the first load after step-1.29 shipped, when the
   server has nothing and this browser has a shelf somebody spent months
   building. That gets pushed up instead of thrown away — once, guarded
   by a flag, so a genuine "I deleted all of it" is not undone by an old
   device syncing later. */
export async function hydrateGear(uid){
  if(!uid) return;
  /* First contact for THIS browser, and it has a shelf: push it up
     before reading anything back. Deliberately regardless of what the
     server already holds, so the two are unioned rather than one
     replacing the other — otherwise a phone that synced first would
     silently delete the coffees somebody added on their laptop while
     it was still local-only. Both shelves are real; neither is a stale
     copy of the other, because until now they were never copies.

     Guarded by a one-way flag, so this happens once per browser and
     the server is the truth from then on. The cost is one narrow case
     in the future: once deleting a custom coffee exists, an old
     never-synced device could resurrect one it still remembers. There
     is no delete today, and when there is, the fix is a tombstone
     rather than dropping this union. */
  if(!state.gearSynced && localShelfSize()){
    await seedShelf();
    state.gearSynced=true; save();
  }
  applyGearRows(await fetchGear(uid));
}

/* The rebuild, kept separate from the fetch so it can be exercised
   without a network. One row becomes up to three different things —
   an entry on your shelf, a favourite, and a note — and a catalogue
   coffee you merely starred must NOT come back as one of your own. */
export function applyGearRows(rows){
  const beans=[], machines=[], drinks=[], favB=[], favM=[];
  const gear={beans:{},machines:{}};
  (rows||[]).forEach(r=>{
    if(!r||!r.name) return;
    if(r.kind==='drink'){ if(r.own) drinks.push(r.name); return; }
    const isM=r.kind==='machine';
    if(r.own) (isM?machines:beans).push(r.name);
    if(r.fav) (isM?favM:favB).push(r.name);          // already newest-first
    if(r.info) gear[isM?'machines':'beans'][r.name]=r.info;
  });
  state.customBeans=beans; state.customMachines=machines; state.customDrinks=drinks;
  state.pins={machines:favM,beans:favB};
  state.gear=gear;
  state.gearSynced=true;
  save();
}

const localShelfSize = () =>
  (state.customBeans||[]).length + (state.customMachines||[]).length + (state.customDrinks||[]).length
  + ((state.pins&&state.pins.beans)||[]).length + ((state.pins&&state.pins.machines)||[]).length
  + Object.keys((state.gear&&state.gear.beans)||{}).length
  + Object.keys((state.gear&&state.gear.machines)||{}).length;

/* The one-time lift of a shelf that predates the table. Sequential and
   awaited: it happens once per account, it is small, and a half-pushed
   shelf that then reports itself synced would lose the rest. */
async function seedShelf(){
  const jobs=[];
  (state.customBeans||[]).forEach(n=>jobs.push(()=>rememberGear('bean',n)));
  (state.customMachines||[]).forEach(n=>jobs.push(()=>rememberGear('machine',n)));
  (state.customDrinks||[]).forEach(n=>jobs.push(()=>rememberGear('drink',n)));
  /* Oldest first, so fav_at ends up in the order the local array had —
     it was unshifted, so its head is the newest. */
  (((state.pins||{}).beans)||[]).slice().reverse().forEach(n=>jobs.push(()=>favGear('bean',n,true)));
  (((state.pins||{}).machines)||[]).slice().reverse().forEach(n=>jobs.push(()=>favGear('machine',n,true)));
  Object.entries((state.gear&&state.gear.beans)||{}).forEach(([n,i])=>jobs.push(()=>noteGear('bean',n,i)));
  Object.entries((state.gear&&state.gear.machines)||{}).forEach(([n,i])=>jobs.push(()=>noteGear('machine',n,i)));
  for(const job of jobs){
    try{ await job(); }catch(e){ console.warn('shelf seed failed',e); }
  }
}

/* ---------- what you wrote down yourself ----------
   Read everywhere, written only by Premium (ui/actions.js gearSave).
   Reading is deliberately not gated: someone whose code lapses should
   still see what they wrote, not lose it behind a lock. */
export function gearNote(kind,name){
  const g=state.gear&&state.gear[kind==='machine'?'machines':'beans'];
  return (g&&g[(name||'').trim()])||null;
}
export function setGearNote(kind,name,patch){
  const n=(name||'').trim(); if(!n) return null;
  if(!state.gear) state.gear={beans:{},machines:{}};
  const k=kind==='machine'?'machines':'beans';
  if(!state.gear[k]) state.gear[k]={};
  const next={ ...(state.gear[k][n]||{}), ...patch };
  /* An emptied form is a deletion, not a row of blanks: leaving one
     behind would keep claiming "you wrote something about this". */
  const empty=Object.keys(next).every(x=>!(''+(next[x]||'')).trim());
  if(empty) delete state.gear[k][n]; else state.gear[k][n]=next;
  save();
  push(noteGear(kind,n,empty?null:next));
  return empty?null:next;
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

/* The same thing for gear. A machine passport is a stranger idea than a
   bean one — most people own one brewer and it never changes — which is
   exactly why it earns its place: the interesting number is not how many
   you own but how the pours split across them, and whether the AeroPress
   that came out for a weekend ever went back in the cupboard.

   Built the same way, from the pours themselves, so it cannot disagree
   with what you actually logged. Your profile machine and anything you
   typed into the picker join it at zero, because gear you have named is
   gear you have — it just hasn't been poured on yet. */
export function machinePassport(){
  const map=new Map();
  const add=(n,p)=>{
    const name=(n||'').trim(); if(!name) return;
    const e=map.get(name)||{ name, pours:0, last:null };
    if(p){ e.pours++; if(p.createdAt&&(!e.last||p.createdAt>e.last)) e.last=p.createdAt; }
    map.set(name,e);
  };
  myPosts().forEach(p=>add(p.recipe&&p.recipe.machine,p));
  add(combineMachine(state.me.machineBrand,state.me.machineModel),null);
  (state.customMachines||[]).forEach(n=>add(n,null));
  return [...map.values()].map(e=>({ ...e, info:machineInfo(e.name) }))
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

/* The time you usually pour at — not the average of a set of timestamps
   and not their median either, because both answer "where is the
   middle" rather than "when do you actually do this". A history of 8am
   cappuccinos plus one 2am pour after a party has a median that still
   lands near 8, which happens to be right, but a set split between 8am
   and 8pm pours has a median sitting at 2pm — a time nobody ever poured
   a coffee at. "Usual" means the time with company: the pour with the
   most others within half an hour of it, around the clock so 23:45 and
   00:15 count as fifteen apart rather than a day.

   Ties go to whichever cluster is tighter, then to the earlier one —
   both arbitrary, but a fixed rule beats a number that answers
   differently on a reload. Returns minutes since midnight, or null when
   nobody shares a half-hour window with anyone else (including a list of
   one). Shared by coffeeStats() below and weekRecap() further down — the
   Stats tab and the week card disagreeing about "when you pour" would be
   worse than either being simple. */
export function usualMinute(mins){
  const n=mins.length; if(!n) return null;
  if(n===1) return mins[0];
  const WINDOW=30;                          // half an hour, either side
  const circDist=(a,b)=>{ const d=Math.abs(a-b); return Math.min(d,1440-d); };
  let best=null;
  mins.forEach(center=>{
    const members=mins.filter(m=>circDist(m,center)<=WINDOW);
    /* Unwrapped relative to this center, so a spread that straddles
       midnight measures correctly instead of coming out near 1440. */
    const rel=members.map(m=>{ let d=m-center; if(d>720)d-=1440; if(d<-720)d+=1440; return d; });
    const spread=Math.max(...rel)-Math.min(...rel);
    if(!best || members.length>best.n || (members.length===best.n && spread<best.spread))
      best={ n:members.length, spread, center, rel };
  });
  if(best.n<2) return null;                 // every pour stood alone
  const mid=best.rel.slice().sort((a,b)=>a-b);
  const m=mid.length%2 ? mid[mid.length>>1] : (mid[mid.length/2-1]+mid[mid.length/2])/2;
  return Math.round(((best.center+m)%1440+1440)%1440);
}

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
  const mins=[];
  posts.forEach(p=>{ const t=Date.parse(p.createdAt);
    if(isFinite(t)){ const dt=new Date(t); hours[dt.getHours()]++; timed++; mins.push(dt.getHours()*60+dt.getMinutes()); }
    const d=dayIndex(p);
    if(d>=0&&isFinite(d)) weekdays[new Date(Date.now()-d*864e5).getDay()]++; });
  /* The tallest hour bucket used to be "peak" on its own, which is the
     same "where is the middle" mistake usualMinute() exists to avoid —
     a lifetime of history spreads pours across more hours than one week
     does, so the naive mode was picking whichever hour edged out the
     rest by one pour rather than the hour with real company around it.
     peakHour still drives which bar lights up (the histogram is hourly),
     but the headline time is peakMin, to the minute. */
  const peakMin=usualMinute(mins);
  const peakHour=peakMin!=null?Math.floor(peakMin/60):null;

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
    hours, timed, peakHour, peakMin, weekdays,
    weeks, trend,
    brew, streak:st.days, best:st.best
  };
}

/* ----- the week, as something you can hand to someone -----
   coffeeStats() answers "what am I like"; this answers "what did I do
   this week", which is a different question and the only one worth
   putting on a card. The window is a calendar week that turns over on
   Sunday afternoon — see recapWindow() for why that hour and not
   Monday's.

   Same two rules as everywhere else: nothing invented, and a week with
   no pours in it returns null so the surface can say so instead of
   drawing a card full of zeroes. */
/* Which week the card is about: a Monday–Sunday calendar week, and
   which one depends on the clock.

   A calendar week is a thing people can share about. "My week" that
   silently means "since last Tuesday" is a different week for everyone
   who reads it, and two friends comparing cards would be comparing
   different windows.

   It turns over once a week, on Sunday at 16:00 local. Waiting for
   Monday would be correct and dead: the week's card lands on the
   morning nobody is looking at their coffee, a day after the week it is
   about stopped being the thing on anybody's mind. Sunday afternoon is
   when the week is over in every way that matters to the person who
   lived it, and it is when a card like this gets posted.

   Which does mean the card is briefly about a week still running: from
   16:00 to midnight on Sunday, a pour can still join it. That is the
   trade, and it is the right way round — a card that keeps counting for
   a few hours is a smaller lie than one that arrives a day late. From
   Monday morning the week is closed and the card is fixed, which is the
   state it spends six of its seven days in.

   Offsets are days-back-from-today, so they line up with dayIndex(),
   which is the one place in the app that decides what day a pour
   happened on. Sunday 16:00 → 0 and 6, this week. Any other time →
   yesterday-or-earlier's completed week. */
const RECAP_HOUR=16;

export function recapWindow(now=new Date()){
  const dow=(now.getDay()+6)%7;                 // Mon=0 … Sun=6
  const live=dow===6 && now.getHours()>=RECAP_HOUR;
  const endOff=live?0:dow+1, startOff=endOff+6;
  const mid=new Date(now); mid.setHours(0,0,0,0);
  const from=new Date(mid); from.setDate(mid.getDate()-startOff);
  const to=new Date(mid);   to.setDate(mid.getDate()-endOff);
  return { startOff, endOff, from, to, live };
}

/* The week's own name, used to key the standouts someone picked for it.
   Local date parts rather than toISOString(), which would shift the key
   across the date line for anyone west of UTC and quietly hand them
   last week's picks. */
const dayKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

/* ----- the standouts -----
   Up to three pours the card shows as pictures. Chosen by the person
   whose week it is — which is the whole point, a favourite is not
   something a query can work out — and keyed by week, so picking three
   for this week does not overwrite the three that went on last week's
   card.

   The default is the week's most-reacted pours, so the card is worth
   posting before anyone has touched the picker. Only pours with a photo
   are ever offered: a generated cup is a fine tile in a grid of seven
   and a poor centrepiece at three times the size. */
export const RECAP_PICKS=3;

export function recapPicks(key){
  const m=state.recapPicks||{};
  return Array.isArray(m[key])?m[key].slice():[];
}
/* Oldest out when a fourth is picked, rather than refusing the tap. The
   strip numbers each pick, so the swap is visible where it happens. */
export function toggleRecapPick(key,id){
  if(!state.recapPicks) state.recapPicks={};
  const l=recapPicks(key), i=l.indexOf(id);
  if(i>=0) l.splice(i,1);
  else { l.push(id); if(l.length>RECAP_PICKS) l.shift(); }
  state.recapPicks[key]=l;
  /* Only the current week's picks are worth keeping — the card for a
     week nobody can reach any more is not coming back. */
  Object.keys(state.recapPicks).forEach(k=>{ if(k!==key) delete state.recapPicks[k]; });
  save();
  return l;
}

export function weekRecap(){
  const posts=myPosts();
  const w=recapWindow();
  /* Monday is 0. -1 means the pour is outside the week entirely. */
  const dayOf=p=>{ const i=dayIndex(p);
    return (i>=w.endOff && i<=w.startOff) ? w.startOff-i : -1; };
  const week=posts.filter(p=>dayOf(p)>=0);
  if(!week.length) return null;

  /* The distribution across the week, Monday first — the card draws one
     bar per day from these, so this is both the shape of the week and
     the index every shot is placed by. */
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
     feed decides between, from exactly the same three fields.

     `pop` is how much the pour was answered — likes and comments,
     which every pour carries whether or not it ever rode through a
     feed page (see `responses` below) — and it exists only to order
     the picker and to seed the three standouts before anyone has
     chosen any. */
  const popOf=p=>(p.likes|0)+(p.commentN|0);
  const shots=week.slice()
    .sort((a,b)=>dayOf(a)-dayOf(b))
    .map(p=>({ id:p.id, day:dayOf(p), img:p.img||null, pattern:p.pattern||null,
               quality:p.quality==null?0.9:p.quality, drink:p.drink||'',
               cafe:p.cafe||'', pop:popOf(p) }));

  /* The longest run inside the week, not the live streak. A card about
     last week that carries today's number would be two different weeks
     wearing one date. */
  let bestRun=0, run=0;
  days.forEach(c=>{ run=c?run+1:0; if(run>bestRun) bestRun=run; });

  /* The hour you usually pour at — usualMinute() above, the same
     clustering coffeeStats() uses for the Stats tab's "When you pour",
     so the two never disagree about what "usual" means. A week where
     nobody shares a half-hour window with anyone else has no usual time
     to report, and says so rather than pointing at whichever pour
     happened to load first.

     Only pours carrying a real timestamp are in it — a "3d" label knows
     its day but has no clock in it. */
  const mins=week.map(p=>Date.parse(p.createdAt)).filter(isFinite)
    .map(ms=>{ const d=new Date(ms); return d.getHours()*60+d.getMinutes(); });
  const avgMin=usualMinute(mins);

  /* How the week was answered — likes and comments, the two counts
     every pour carries regardless of where it came from (postOf() embeds
     both straight off the row). The named reactions (art/scene/drink)
     are deliberately left out: they are their own smaller feature
     (data/reactions.js) and folding them in here would double-count
     against likes for pours that collected both. */
  const responses=week.reduce((n,p)=>n+(p.likes|0)+(p.commentN|0),0);

  /* Three pictures, theirs to choose. A pick that has since been deleted
     is dropped rather than drawn as a gap, and the remainder is topped
     up from the week's most-answered photos so the card is never blank
     where the pictures go. */
  const key=dayKey(w.from);
  const withPhoto=shots.filter(s=>s.img);
  const picked=recapPicks(key)
    .map(id=>withPhoto.find(s=>s.id===id)).filter(Boolean);
  /* A week with no photographs in it at all falls back to the generated
     cups, which is what the feed shows those pours as anyway. Only when
     there are none: one real photo beside two drawn cups is a card that
     looks like it failed to load something. */
  const pool=withPhoto.length?withPhoto:shots;
  const auto=pool.slice().sort((a,b)=>b.pop-a.pop)
    .filter(s=>!picked.some(p=>p.id===s.id))
    .slice(0,RECAP_PICKS-picked.length);
  const standouts=[...picked,...auto].sort((a,b)=>a.day-b.day);

  return {
    pours:week.length, shots, days, key, live:w.live,
    daysWithCoffee:days.filter(Boolean).length,
    busiest:Math.max(...days),
    drinks, beans, patterns, newBeans,
    artPours:week.filter(p=>p.art&&p.pattern).length,
    cafePours:week.filter(p=>p.cafe).length,
    bestRun, avgMin, timed:mins.length, responses,
    candidates:withPhoto, standouts, chosen:picked.length>0,
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
