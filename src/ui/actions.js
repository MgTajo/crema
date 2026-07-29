"use strict";
/* ============================================================
   ui/actions — all user interaction.
   One delegated click handler dispatches [data-action] intents;
   keydown/input/change/hover handlers cover the rest. The mutation
   helpers (like/save/follow/comment/post…) update the store, persist
   via save(), then patch or repaint the affected UI. Also owns
   theme, toast and the status-bar clock.

   In the target app this layer maps onto screen event handlers /
   view-model methods; the store calls it makes stay the same.
   ============================================================ */
import { $, $$, fmt, withUnit } from '../core/util.js';
import { DRINKS, DRINK_ART, HAS_MILK, ADD_BEAN, ADD_DRINK, BEANS, MY_BEANS, beanCatalog, combineMachine, splitMachine } from '../data/catalog.js';
import { USERS, CAFES, CHALLENGES, userOf } from '../data/world.js';
import { signUp, signInWithPassword, signInWithOAuth, signOut, onAuthChange, currentUser,
         sendPasswordReset, updatePassword } from '../data/supabase.js';
import { ensureProfile, pushProfile, pushAvatar, fetchUserCard, searchProfiles, fetchScore,
         setNotifyPrefs , setTimezone } from '../data/profiles.js';
import { enablePush, disablePush, pushEnabled, syncPush, pushSupported } from '../data/push.js';
import { createPost, updatePost, deletePost, newPostId, fetchMine, fetchPost } from '../data/posts.js';
import { uploadImage, deleteImage } from '../data/media.js';
import * as social from '../data/social.js';
import { markAllRead } from '../data/notifications.js';
import { state, ui, save, applyMe, findPost, freshCreate, useSession, cachePosts, mine,
         saved, loadSaved, loadFeed, loadMoreFeed, social as storeSocial, loadChallenges, canEdit,
         feed } from '../store/store.js';
import { commentRow, postLink, searchHTML } from './components.js';
import { icon } from './icons.js';
import { render, renderView, renderAppbar } from './views.js';
import { pushOv, popOv, renderOverlay } from './overlays.js';

/* ============================================================ ACTIONS */
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-action]'); if(!t) return;
  const a=t.dataset.action, id=t.dataset.id;
  switch(a){
    case 'nav':{ ui.route=t.dataset.r; ui.ovStack=[]; render();
      /* points move when other people like your pours, so re-read them
         when you look at your own profile rather than only after posting */
      if(ui.route==='profile') refreshScore();
      break;}
    case 'filter':{ if(ui.filter===t.dataset.f) break; ui.filter=t.dataset.f; feed.cursor=null; feed.done=false; renderView();
      /* signed in the Following tab is a different server query, not a
         client-side filter over one page */
      if(currentUser()) loadFeed().then(()=>renderView());
      break;}
    case 'open-post': openPost(id); break;
    case 'open-cafe': pushOv({type:'cafe',id}); break;
    case 'open-bean':{ if(BEANS.find(b=>b.n===id)) pushOv({type:'bean',id}); else toast('No details for that bean yet'); break;}
    case 'open-user':{ if(!id)break; if(id==='me'){ui.ovStack=[]; ui.route='profile'; render();} else openUser(id); break;}
    case 'open-notifs':{ const had=state.notifications.some(n=>!n.read); state.notifications.forEach(n=>n.read=true); if(had){save(); renderAppbar();} pushOv({type:'notifs'});
      const u=currentUser(); if(u&&had) markAllRead(u.id).catch(err=>console.warn('mark read failed',err));
      break;}
    case 'notif-go':{ const n=state.notifications[+t.dataset.idx]; if(!n)break;
      if(n.post) openNotifiedPost(n.post);
      else if(n.challenge) pushOv({type:'challenge',id:n.challenge});
      else if(n.cafe) pushOv({type:'cafe',id:n.cafe});
      else if(n.u) pushOv({type:'user',id:n.u}); break;}
    case 'open-menu': pushOv({type:'menu',id}); break;
    case 'open-tag': pushOv({type:'tag',id}); break;
    case 'open-challenge': openChallenge(id); break;
    case 'open-challenges': pushOv({type:'challenges'}); break;
    case 'open-board': pushOv({type:'board'}); break;
    case 'open-flist': openFlist(id); break;
    case 'open-scoring': pushOv({type:'scoring'}); break;
    case 'open-streak': pushOv({type:'streak'}); break;
    case 'push-on': turnPushOn(); break;
    case 'push-off': turnPushOff(); break;
    case 'toggle-notify-social': toggleNotify('notifySocial'); break;
    case 'toggle-notify-streak': toggleNotify('notifyStreak'); break;
    case 'toggle-notify-digest': toggleNotify('notifyDigest'); break;
    case 'open-passport': pushOv({type:'passport'}); break;
    /* the logo is the way back to a clean slate */
    case 'reload': location.reload(); break;
    case 'open-settings': pushOv({type:'settings'}); break;
    case 'open-create': ui.create=freshCreate(); pushOv({type:'create'}); break;
    case 'close-ov': popOv(); break;
    case 'clear-search':{ ui.searchQ=''; renderView(); break;}

    case 'like': toggleLike(id); break;
    case 'save': toggleSave(id); break;
    case 'follow': toggleFollow(id); break;
    case 'accept-follow': acceptFollow(id); break;
    case 'decline-follow': declineFollow(id); break;
    case 'follow-cafe': toggleCafeFollow(id); break;
    case 'recipe':{const el=$('#rp-'+id); if(el){el.classList.toggle('open'); const o=el.classList.contains('open'); t.innerHTML=t.innerHTML.replace(o?'▾':'▴',o?'▴':'▾');} break;}
    case 'ptab':{ ui.profTab=t.dataset.t; renderView();
      /* the saves are rows, not a filter over the feed page */
      if(ui.profTab==='saved'&&!saved.loaded) loadSaved().then(ok=>{ if(ok) renderView(); });
      break;}


    case 'cmt-like':{ const p=findPost(t.dataset.pid); const c=p&&p.comments[+t.dataset.idx]; if(!c)break;
      c.likedByMe=!c.likedByMe; c.likes=(c.likes||0)+(c.likedByMe?1:-1); save();
      t.classList.toggle('on',c.likedByMe); t.innerHTML=icon(c.likedByMe?'heartF':'heart',15)+'<span>'+(c.likes||'')+'</span>';
      const u=currentUser(), cid=t.dataset.cid;
      if(u&&cid){ const want=c.likedByMe;
        (want?social.likeComment(u.id,cid):social.unlikeComment(u.id,cid)).catch(err=>{
          if(err.status===409) return; console.warn('comment like failed',err);
          c.likedByMe=!want; c.likes=(c.likes||0)+(want?-1:1); renderOverlay(); }); }
      break;}
    case 'cmt-reply':{ const inp=$('#cmt-input'); if(inp){inp.value='@'+(t.dataset.handle||'').replace('@','')+' '; inp.focus();} break;}
    case 'add-cmt': addComment(id); break;

    case 'share-post': sharePost(id); break;
    case 'menu-copy': copyText(postLink(id),'Link copied 🔗'); popOv(); break;
    case 'menu-save': toggleSave(id); popOv(); break;
    case 'menu-report': popOv(); pushOv({type:'report',id}); break;
    case 'report-send': sendReport(id,t.dataset.reason); break;
    case 'menu-block': blockUser(id); break;
    case 'menu-delete': deleteMyPost(id); break;
    case 'menu-edit': editMyPost(id); break;
    case 'brew': brewAgain(id); break;
    case 'directions':{ const c=CAFES.find(x=>x.id===id); if(!c)break;
      const url='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(c.name+', '+c.area+', '+c.city);
      let w=null; try{w=window.open(url,'_blank','noopener');}catch(err){}
      if(!w) copyText(url,'Maps link copied 🔗'); break;}

    case 'cafe-filter': ui.cafeF[t.dataset.f]=!ui.cafeF[t.dataset.f]; renderView(); break;
    case 'cpat':{ syncCreate(); ui.create.pattern=(ui.create.pattern===t.dataset.p)?null:t.dataset.p; renderOverlay(); break;}
    case 'csource':{ syncCreate(); ui.create.source=t.dataset.s; if(t.dataset.s==='home')ui.create.cafe=''; renderOverlay(); break;}
    /* Remembered here rather than at submit time, so it sticks even if
       the sheet is abandoned — the choice was still made. */
    case 'cvis':{ syncCreate(); ui.create.visibility=t.dataset.v; state.lastVisibility=t.dataset.v; save(); renderOverlay(); break;}
    case 'submit-post': submitPost(); break;
    case 'drop-photo':{ syncCreate(); ui.create.img=null; ui.create.uploadFailed=false; renderOverlay(); break;}

    case 'set-theme': state.theme=t.dataset.t; save(); applyTheme(); renderOverlay(); break;
    case 'save-profile': saveProfile(); break;
    case 'drop-avatar': dropAvatar(); break;
    case 'toggle-premium':{ state.me.premium=!state.me.premium; save(); renderOverlay();
      toast(state.me.premium?'Premium unlocked ✦':'Premium turned off');
      const u=currentUser(); if(u) pushProfile(u.id,state.me).catch(err=>console.warn('premium sync failed',err));
      break;}

    case 'ob-next':{ syncOb();
      if(!(state.me.name||'').trim()){ ui.obError='Tell us your name first.'; renderOverlay(); break; }
      ui.obError=''; ui.obStep=Math.min(2,(ui.obStep||1)+1); renderOverlay(); break;}
    case 'ob-back': syncOb(); ui.obError=''; ui.obStep=Math.max(1,(ui.obStep||1)-1); renderOverlay(); break;
    case 'ob-finish': finishOnboarding(); break;

    case 'auth-mode':{ syncAuth(); ui.auth.mode=t.dataset.m||'in'; ui.auth.error=''; ui.auth.notice=''; renderView(); break;}
    case 'auth-submit': doAuth(); break;
    case 'auth-oauth': doOAuth(t.dataset.p); break;
    case 'sign-out': doSignOut(); break;
    case 'open-password': ui.pw={error:'',busy:false}; pushOv({type:'password'}); break;
    case 'pw-save': savePassword(); break;
    case 'toast': toast(t.dataset.msg||'Coming soon'); break;
    default: break;
  }
});
document.addEventListener('keydown',e=>{ if(e.key!=='Enter') return;
  const t=e.target.closest('[data-enter]'); if(!t) return; e.preventDefault();
  if(t.dataset.enter==='add-cmt') addComment(t.dataset.id);
  else if(t.dataset.enter==='auth-submit') doAuth();
  else if(t.dataset.enter==='pw-save') savePassword(); });
/* Recipe fields wear their unit as you type — "18" becomes "18g" the
   moment you type it, not just after you've moved on. Reapplied on
   every keystroke, with the caret parked back where you left it (by
   digit count, since the unit itself isn't editable). */
const RECIPE_UNITS={'c-dose':'g','c-yield':'g','c-time':'s','c-temp':'°'};
function maskRecipeInput(el,unit){
  const raw=el.value, caret=el.selectionStart;
  const digitsBefore=raw.slice(0,caret).replace(/[^0-9.,]/g,'').length;
  const next=withUnit(raw,unit);
  el.value=next;
  const numLen=Math.max(0,next.length-unit.length);
  const pos=Math.min(digitsBefore,numLen);
  el.setSelectionRange(pos,pos);
}
document.addEventListener('input',e=>{
  const unit=RECIPE_UNITS[e.target.id];
  if(unit){ maskRecipeInput(e.target,unit); return; }
  if(e.target.id==='search-input'){ ui.searchQ=e.target.value;
    paintSearch();
    /* People live in Postgres, so searching them is a query. Debounced,
       because this fires on every keystroke. */
    clearTimeout(searchT);
    const q=ui.searchQ.trim(); if(q.length<2) return;
    searchT=setTimeout(async()=>{
      const u=currentUser(); if(!u) return;
      try{ await searchProfiles(u.id,q,8,storeSocial.blocks); if(ui.searchQ.trim()===q) paintSearch(); }
      catch(err){ console.warn('people search failed',err); }
    },300);
  }
});
let searchT;
function paintSearch(){
  const res=$('#explore-results'), normal=$('#explore-normal');
  if(res&&normal){ res.innerHTML=ui.searchQ?searchHTML(ui.searchQ):''; normal.style.display=ui.searchQ?'none':''; }
}
document.addEventListener('change',e=>{
  const id=e.target.id;
  if(id==='c-photo-cam'||id==='c-photo-lib'){ if(e.target.files&&e.target.files[0]) handleUpload(e.target.files[0]); return; }
  if(id==='sp-avatar'){ if(e.target.files&&e.target.files[0]) uploadAvatar(e.target.files[0]); return; }
  if(id==='c-mbrand'){ syncCreate(); ui.create.machineModel=''; renderOverlay(); return; }
  if(id==='c-bbrand'){ syncCreate(); ui.create.bean=ui.create.beanBrand===ADD_BEAN?ADD_BEAN:''; renderOverlay(); return; }
  if(id==='c-bean'){ syncCreate(); renderOverlay(); return; }
  if(id==='c-drink'||id==='c-cafe'){ syncCreate(); renderOverlay(); return; }
  if(id==='c-mmodel'||id==='c-mother'||id==='c-milk'){ syncCreate(); return; }
  if(id==='ob-mbrand'){ syncOb(); state.me.machineModel=''; renderOverlay(); return; }
  if(id==='sp-mbrand'){ syncSettings(); state.me.machineModel=''; renderOverlay(); return; }
});
/* infinite scroll — the feed is paginated on created_at (step 1.5).
   #view is a stable element; renderView() only replaces its innerHTML. */
(function attachFeedScroll(){
  const v=$('#view'); if(!v) return;
  v.addEventListener('scroll',()=>{
    if(ui.route!=='home'||ui.ovStack.length) return;
    if(v.scrollTop+v.clientHeight < v.scrollHeight-400) return;
    loadMoreFeed().then(grew=>{ if(grew) renderView(); });
  },{passive:true});
})();

/* activity-bar tooltip */
document.addEventListener('mouseover',e=>{const ab=e.target.closest('.actbars .ab'); if(!ab)return; const tip=ab.parentElement.querySelector('.bartip'); if(!tip)return;
  tip.textContent=`${ab.dataset.d} · ${ab.dataset.c} pour${ab.dataset.c==='1'?'':'s'}`; tip.style.left=(ab.offsetLeft+ab.offsetWidth/2)+'px'; tip.hidden=false;});
document.addEventListener('mouseout',e=>{const ab=e.target.closest('.actbars .ab'); if(!ab)return; const tip=ab.parentElement.querySelector('.bartip'); if(tip)tip.hidden=true;});

/* ============================================================ AUTH */
/* Keep typed values across the re-render that follows every state change. */
function syncAuth(){ if(!ui.auth) ui.auth={mode:'in',error:'',notice:'',busy:false,email:''};
  const el=$('#au-email'); if(el) ui.auth.email=el.value; }

function authError(e){
  const m=(e&&e.message)||'';
  if(/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Couldn\'t reach Crema. Check your connection and try again.';
  if(/Invalid login credentials/i.test(m)) return 'That email and password don\'t match.';
  if(/already registered|already been registered/i.test(m)) return 'That email already has an account — sign in instead.';
  if(/Password should be at least/i.test(m)) return 'Pick a longer password — at least 8 characters.';
  if(/Email not confirmed/i.test(m)) return 'Confirm your email address first — check your inbox.';
  if(/rate limit|too many/i.test(m)) return 'Too many attempts just now. Wait a minute and try again.';
  return m || 'Something went wrong. Try again.';
}

async function doAuth(){
  syncAuth();
  const a=ui.auth, email=(a.email||'').trim(), pw=($('#au-pw')||{}).value||'';
  if(!email){ a.error='Enter your email address.'; renderView(); return; }

  if(a.mode==='forgot'){
    a.busy=true; a.error=''; a.notice=''; renderView();
    try{
      await sendPasswordReset(email);
      a.busy=false; a.mode='in';
      a.notice='Reset link sent. Open it on this device and you can set a new password.';
    }catch(e){ a.busy=false; a.error=authError(e); }
    renderView(); return;
  }

  if(!pw){ a.error='Enter your password.'; renderView(); return; }
  if(a.mode==='up'&&pw.length<8){ a.error='Pick a password of at least 8 characters.'; renderView(); return; }
  a.busy=true; a.error=''; a.notice=''; renderView();
  try{
    if(a.mode==='up'){
      const { confirmationRequired } = await signUp(email,pw);
      if(confirmationRequired){
        a.busy=false; a.mode='in';
        a.notice='Account created. Confirm your email address, then sign in.';
        renderView(); return;
      }
    } else {
      await signInWithPassword(email,pw);
    }
    /* success → onAuthChange below drives the load and repaint */
  }catch(e){ a.busy=false; a.error=authError(e); renderView(); }
}

async function doOAuth(provider){
  syncAuth(); ui.auth.busy=true; ui.auth.error=''; renderView();
  try{ await signInWithOAuth(provider); }        // navigates away on success
  catch(e){ ui.auth.busy=false; ui.auth.error=authError(e); renderView(); }
}

async function doSignOut(){
  if(!confirm('Sign out of Crema on this device?')) return;
  await signOut();
}

async function savePassword(){
  const p=ui.pw||(ui.pw={error:'',busy:false});
  const a=($('#pw-new')||{}).value||'', b=($('#pw-again')||{}).value||'';
  if(a.length<8){ p.error='At least 8 characters, please.'; renderOverlay(); return; }
  if(a!==b){ p.error='Those two don\'t match.'; renderOverlay(); return; }
  p.busy=true; p.error=''; renderOverlay();
  try{ await updatePassword(a); popOv(); toast('Password changed 🔑'); }
  catch(e){ p.busy=false; p.error=authError(e); renderOverlay(); }
}

/* Pull the profile row down (creating it on first sign-in) and merge it
   into state.me. A brand-new row means a brand-new account, which is
   what triggers onboarding. */
async function syncProfile(){
  const u=currentUser(); if(!u) return;
  try{
    const { me, created }=await ensureProfile(u.id,u.email,state.me);
    Object.assign(state.me,me);
    /* An account whose profile has just been created has never been
       through onboarding, whatever this browser happens to remember. */
    if(created) state.onboarded=false;
    else if(state.me.name) state.onboarded=true;
    save(); applyMe();
    /* Which local morning a pour belongs to is decided in Postgres, and
       only this line tells it where the user is. Fire-and-forget: a
       failed timezone write is not worth a toast. */
    setTimezone(u.id).catch(err=>console.warn('timezone sync failed',err));
  }catch(e){ console.warn('profile sync failed',e); toast('Couldn\'t load your profile — retrying next time'); }
}

/* ---------- reminders ----------
   Push permission is asked for exactly once, from a tap on "Remind me",
   never on boot: a prompt with no context is denied, and a denial is
   effectively permanent — the browser will not ask again. */
async function turnPushOn(){
  const u=currentUser(); if(!u) return;
  ui.push=ui.push||{}; ui.push.busy=true; renderOverlay();
  const r=await enablePush(u.id);
  ui.push.busy=false;

  if(r.ok){
    ui.push.enabled=true;
    /* Turning reminders on is the whole reason someone tapped the
       button, so it starts on rather than making them find a second
       switch. The recap stays off — they didn't ask for that one. */
    state.me.notifyStreak=true;
    save();
    try{ await setNotifyPrefs(u.id,state.me); }
    catch(e){ console.warn('notification prefs failed',e); }
    renderOverlay();
    toast('Reminders on ☕');
    return;
  }

  renderOverlay();
  toast(
    r.reason==='denied'      ? 'Notifications are blocked in your browser settings'
  : r.reason==='ios-install' ? 'Add Crema to your Home Screen first'
  : r.reason==='dismissed'   ? 'No reminders — you can turn them on any time'
  : 'Couldn\'t turn on reminders — try again');
}

async function turnPushOff(){
  ui.push=ui.push||{}; ui.push.busy=true; renderOverlay();
  await disablePush();
  ui.push.busy=false; ui.push.enabled=false; renderOverlay();
  toast('Reminders off on this device');
}

/* Optimistic: the switch flips at once and the write follows. A failed
   write is worth saying out loud — a preference that silently didn't
   stick is how people end up getting notifications they turned off. */
async function toggleNotify(key){
  const u=currentUser(); if(!u) return;
  state.me[key]=!state.me[key];
  save(); renderOverlay();
  try{ await setNotifyPrefs(u.id,state.me); }
  catch(e){
    console.warn('notification prefs failed',e);
    state.me[key]=!state.me[key]; save(); renderOverlay();
    toast('Couldn\'t save that — try again');
  }
}

/* On boot: find out whether this device already has a live subscription,
   and re-state it if so (endpoints rotate silently). Never prompts. */
export async function initPush(){
  if(!pushSupported()) return;
  const u=currentUser(); if(!u) return;
  ui.push=ui.push||{};
  ui.push.enabled=await pushEnabled().catch(()=>false);
  if(ui.push.enabled) syncPush(u.id).catch(()=>{});
}

/* Write the onboarding answers to the profile row. This is the first
   thing a new account does, so a failure here has to be visible. */
async function finishOnboarding(){
  syncOb();
  if(!(state.me.name||'').trim()){ ui.obStep=1; ui.obError='Tell us your name first.'; renderOverlay(); return; }
  const u=currentUser();
  if(u){
    try{ await pushProfile(u.id,state.me); }
    catch(e){
      if(e.status===409){ ui.obStep=1; ui.obError='That username is taken — try another.'; renderOverlay(); return; }
      console.warn('profile save failed',e);
      toast('Saved on this device — we\'ll sync your profile shortly');
    }
  }
  state.onboarded=true; ui.obError=''; save(); applyMe();
  ui.ovStack=[]; render(); toast('Welcome to Crema ☕');
}

/* The single place the app reacts to signing in or out. */
onAuthChange(async s=>{
  await useSession(s);
  if(s) await syncProfile();
  applyMe(); applyTheme();
  ui.ovStack=[]; ui.route='home'; ui.auth=null; render();
  if(s){
    if(!state.onboarded){ ui.obStep=1; pushOv({type:'onboard'}); }
    else toast('Signed in ☕');
  }
});

export { syncProfile };

/* Points and level are trigger-maintained, so after a pour lands (or
   goes) we read them back rather than doing the arithmetic twice. */
async function refreshScore(){
  const u=currentUser(); if(!u) return;
  try{
    const { points, level } = await fetchScore(u.id);
    state.me.points=points; state.me.level=level; save(); applyMe();
    if(ui.route==='profile'&&!ui.ovStack.length) renderView();
  }catch(e){ console.warn('score refresh failed',e); }
}

async function saveProfile(){
  syncSettings();
  if(!(state.me.name||'').trim()){ toast('Add your name first'); return; }
  state.me.name=(state.me.name||'').trim(); state.me.city=(state.me.city||'').trim(); state.me.handle=(state.me.handle||'').trim();
  save(); applyMe(); renderView();
  const u=currentUser(); if(!u){ popOv(); toast('Profile updated ✓'); return; }
  try{ await pushProfile(u.id,state.me); popOv(); toast('Profile updated ✓'); }
  catch(e){
    if(e.status===409){ toast('That username is taken — try another'); return; }
    console.warn('profile sync failed',e); popOv(); toast('Saved here — we\'ll sync it shortly');
  }
}

/* ---------- people ---------- */
/* Open someone's sheet, then fill it in with their real profile counts
   and their pours. Nothing is guessed while the request is in flight. */
async function openUser(uid){
  pushOv({type:'user',id:uid});
  if(!currentUser()) return;
  try{
    const me=currentUser();
    await fetchUserCard(uid);
    /* Their pours are only shown to accepted followers, so only fetch
       them for one — asking for a grid the sheet won't draw is a request
       nobody reads. Following them later re-opens this path. */
    if(state.follows[uid]){
      const list=await fetchMine(uid,{limit:60, myUid:me?me.id:null});
      ui.userPosts={ id:uid, list };
      cachePosts(list);   // so tapping one of them opens the post, not a blank sheet
    }
    const top=ui.ovStack[ui.ovStack.length-1];
    if(top&&top.type==='user'&&top.id===uid) renderOverlay();
  }catch(e){ console.warn('profile load failed',e); }
}

/* A like or comment on an older pour points at a post that is not on the
   current feed page. Fetch it rather than doing nothing, which is what the
   inbox used to do. */
async function openNotifiedPost(id){
  if(findPost(id)){ openPost(id); return; }
  const u=currentUser(); if(!u){ toast('Couldn\'t open that pour'); return; }
  try{
    const p=await fetchPost(id,u.id);
    if(!p){ toast('That pour is gone'); return; }
    cachePosts([p]); openPost(id);
  }catch(e){ console.warn('notification post failed',e); toast('Couldn\'t open that pour'); }
}

async function openFlist(kind){
  pushOv({type:'flist',id:kind});
  const u=currentUser(); if(!u) return;
  try{
    const [followers,following]=await Promise.all([ social.fetchFollowers(u.id), social.fetchFollowing(u.id) ]);
    storeSocial.followers=followers; storeSocial.following=following; storeSocial.listsLoaded=true;
    const top=ui.ovStack[ui.ovStack.length-1];
    if(top&&top.type==='flist') renderOverlay();
  }catch(e){ console.warn('follow lists failed',e); }
}

function syncCreate(){ if(!ui.create) ui.create=freshCreate();
  const g=i=>{const el=$('#'+i); return el?el.value:undefined;}, c=ui.create;
  ['caption','drink','drink-custom','cafe','bean','bbrand','bean-custom','milk','dose','yield','time','temp','mbrand'].forEach(f=>{
    const v=g('c-'+f); if(v!==undefined) c[f==='drink-custom'?'drinkCustom':f==='bean-custom'?'beanCustom':f==='bbrand'?'beanBrand':f==='mbrand'?'machineBrand':f]=v;});
  /* "Add your own coffee" leaves the Coffee select with nothing to hold
     the sentinel — it renders empty and disabled — so reading it back
     would erase the very thing that says a custom name is being typed,
     and the bean would vanish on submit. The brand select is the
     authority for that state, exactly as the change handler treats it. */
  if(c.beanBrand===ADD_BEAN) c.bean=ADD_BEAN;
  if(c.machineBrand==='Other'){const mo=g('c-mother'); if(mo!==undefined) c.machineModel=mo;}
  else{const mm=g('c-mmodel'); if(mm!==undefined) c.machineModel=mm;}}
function syncOb(){ const g=i=>{const el=$('#'+i); return el?el.value:undefined;};
  const n=g('ob-name'); if(n!==undefined&&n.trim()) state.me.name=n.trim();
  const h=g('ob-handle'); if(h!==undefined) state.me.handle=h.trim();
  const c=g('ob-city'); if(c!==undefined&&c.trim()) state.me.city=c.trim();
  const mb=g('ob-mbrand'); if(mb!==undefined) state.me.machineBrand=mb;
  if(state.me.machineBrand==='Other'){const mo=g('ob-mother'); if(mo!==undefined) state.me.machineModel=mo;}
  else{const mm=g('ob-mmodel'); if(mm!==undefined) state.me.machineModel=mm;}
  const d=g('ob-drink'); if(d!==undefined) state.me.favDrink=d;
  const mk=g('ob-milk'); if(mk!==undefined) state.me.favMilk=mk; }
function syncSettings(){ const g=i=>{const el=$('#'+i); return el?el.value:undefined;};
  const set=(id,k)=>{const v=g(id); if(v!==undefined) state.me[k]=v;};
  set('sp-name','name'); set('sp-handle','handle'); set('sp-bio','bio'); set('sp-city','city'); set('sp-milk','favMilk');
  const mb=g('sp-mbrand'); if(mb!==undefined) state.me.machineBrand=mb;
  if(state.me.machineBrand==='Other'){const mo=g('sp-mother'); if(mo!==undefined) state.me.machineModel=mo;}
  else{const mm=g('sp-mmodel'); if(mm!==undefined) state.me.machineModel=mm;} }

function handleUpload(file){
  if(!file.type||!file.type.startsWith('image/')){toast('That file isn\'t an image'); return;}
  const reader=new FileReader();
  reader.onload=ev=>{const img=new Image();
    img.onload=()=>{
      const max=1080; let w=img.width,h=img.height; const s=Math.min(1,max/Math.max(w,h)); w=Math.round(w*s); h=Math.round(h*s);
      const cv=document.createElement('canvas'); cv.width=w; cv.height=h; cv.getContext('2d').drawImage(img,0,0,w,h);
      syncCreate();
      /* Show the local render immediately — no wait on a network round
         trip to see your own photo. If the upload fails this stays the
         final value: the post still goes out, with the photo inline. */
      ui.create.img=cv.toDataURL('image/jpeg',0.82); ui.create.uploadFailed=false;
      renderOverlay(); toast('Photo added 📸');
      const u=currentUser(); if(!u) return;
      const target=ui.create;
      ui.create.uploading=true; renderOverlay();
      cv.toBlob(blob=>{
        if(!blob){ if(ui.create===target){ui.create.uploading=false; renderOverlay();} return; }
        uploadImage(blob,'image/jpeg').then(key=>{
          if(ui.create!==target) return;   // sheet was closed/reset meanwhile
          ui.create.img=key; ui.create.uploading=false; ui.create.uploadFailed=false; renderOverlay();
        }).catch(err=>{
          console.warn('upload failed',err);
          if(ui.create===target){ ui.create.uploading=false; ui.create.uploadFailed=true; renderOverlay(); }
          toast('Couldn\'t upload that photo — tap Post to retry');
        });
      },'image/jpeg',0.82);
    };
    img.onerror=()=>toast('Could not read that image'); img.src=ev.target.result;};
  reader.onerror=()=>toast('Could not read that file');
  reader.readAsDataURL(file);
}

/* ---------- profile photo ----------
   Squared and shrunk to 512 before it leaves the device: an avatar is
   never drawn bigger than 84px, and a 12MP portrait would cost the user
   their data plan to upload something nobody will ever see at that size.
   Cropped from the centre, because that is where faces are.

   Unlike a post photo this is NOT optimistic. A post can go out with a
   local data: URI and reconcile later; a profile row can only hold a key,
   so there is nothing to show until R2 has the bytes. The sheet says
   "Uploading…" and the avatar changes when it is real. */
function squareCanvas(img, size=512){
  const side=Math.min(img.width,img.height);
  const sx=(img.width-side)/2, sy=(img.height-side)/2;
  const cv=document.createElement('canvas'); cv.width=cv.height=Math.min(size,side);
  cv.getContext('2d').drawImage(img,sx,sy,side,side,0,0,cv.width,cv.height);
  return cv;
}
function uploadAvatar(file){
  if(!file.type||!file.type.startsWith('image/')){ toast('That file isn\'t an image'); return; }
  if(!currentUser()){ toast('Sign in to add a photo'); return; }
  const reader=new FileReader();
  reader.onload=ev=>{
    const img=new Image();
    img.onload=()=>{
      const cv=squareCanvas(img);
      /* keep whatever they've typed in the other fields across the repaint */
      syncSettings(); ui.avatarBusy=true; renderOverlay();
      cv.toBlob(async blob=>{
        if(!blob){ ui.avatarBusy=false; renderOverlay(); return; }
        const previous=state.me.avatar||'';
        try{
          const key=await uploadImage(blob,'image/jpeg');
          const u=currentUser(); if(!u) throw new Error('Signed out');
          await pushAvatar(u.id,key);
          state.me.avatar=key; save(); applyMe();
          ui.avatarBusy=false; renderOverlay(); renderView();
          toast('Photo updated 📸');
          /* only once the row points at the new one — an orphan in R2 is
             cheap, a profile pointing at a deleted object is not */
          if(previous) deleteImage(previous);
        }catch(err){
          console.warn('avatar upload failed',err);
          ui.avatarBusy=false; renderOverlay();
          toast(err&&/step-1\.13/.test(err.message||'') ? 'Profile photos aren\'t switched on yet' : 'Couldn\'t upload that photo — try again');
        }
      },'image/jpeg',0.85);
    };
    img.onerror=()=>toast('Could not read that image');
    img.src=ev.target.result;
  };
  reader.onerror=()=>toast('Could not read that file');
  reader.readAsDataURL(file);
}
async function dropAvatar(){
  const previous=state.me.avatar||''; if(!previous) return;
  syncSettings();
  const u=currentUser(); if(!u){ toast('Sign in first'); return; }
  ui.avatarBusy=true; renderOverlay();
  try{
    await pushAvatar(u.id,null);
    state.me.avatar=''; save(); applyMe();
    ui.avatarBusy=false; renderOverlay(); renderView();
    toast('Back to your initials');
    deleteImage(previous);
  }catch(err){
    console.warn('avatar removal failed',err);
    ui.avatarBusy=false; renderOverlay();
    toast('Couldn\'t remove that photo — try again');
  }
}

/* Optimistic writes: mutate, repaint, then persist. If the network says
   no, put it back and say so — never leave the UI showing a lie. */
function paintLike(p){
  $$('[data-action="like"][data-id="'+p.id+'"]').forEach(b=>{b.classList.toggle('liked',p.likedByMe); b.innerHTML=icon(p.likedByMe?'heartF':'heart',22)+' <span class="cnt">'+fmt(p.likes)+'</span>';});
}
function toggleLike(id){
  const p=findPost(id); if(!p) return;
  /* Liking your own pour is refused by RLS (step-1.10.sql); the button
     isn't rendered either, so this only guards a stray dispatch. */
  if(p.user==='me'){ toast('You can\'t like your own pour'); return; }
  p.likedByMe=!p.likedByMe; p.likes+=p.likedByMe?1:-1; save();
  paintLike(p);
  if(p.likedByMe){const hp=$('#hp-'+id); if(hp){hp.classList.remove('go'); void hp.offsetWidth; hp.classList.add('go');}}
  const u=currentUser(); if(!u) return;
  const want=p.likedByMe;
  (want?social.like(u.id,id):social.unlike(u.id,id)).catch(err=>{
    if(err.status===409) return;                    // already liked; local state is right
    console.warn('like failed',err);
    p.likedByMe=!want; p.likes+=want?-1:1; save(); paintLike(p);
    toast('Couldn\'t save that like');
  });
}
function paintSave(p){
  $$('[data-action="save"][data-id="'+p.id+'"]').forEach(b=>{b.classList.toggle('saved',p.saved); b.innerHTML=icon(p.saved?'saveF':'save',22);});
}
function toggleSave(id){
  const p=findPost(id); if(!p) return; p.saved=!p.saved; save();
  if(p.saved){ if(!saved.list.some(x=>x.id===p.id)) saved.list.unshift(p); }
  else saved.list=saved.list.filter(x=>x.id!==p.id);
  paintSave(p);
  toast(p.saved?'Saved to your collection 🔖':'Removed from saved');
  const u=currentUser(); if(!u) return;
  const want=p.saved;
  (want?social.savePost(u.id,id):social.unsavePost(u.id,id)).catch(err=>{
    if(err.status===409) return;
    console.warn('save failed',err);
    p.saved=!want;
    if(p.saved){ if(!saved.list.some(x=>x.id===p.id)) saved.list.unshift(p); }
    else saved.list=saved.list.filter(x=>x.id!==p.id);
    save(); paintSave(p); toast('Couldn\'t update your collection');
  });
}
/* Reads the state rather than being told it, because there are three
   states now and every follow button in the DOM has to agree on which
   one it is. */
export function followLabel(id){
  return state.follows[id] ? 'Following' : state.followPending[id] ? 'Requested' : 'Follow';
}
function paintFollow(id){
  const label=followLabel(id), on=label!=='Follow';
  $$('[data-action="follow"][data-id="'+id+'"]').forEach(b=>{
    b.classList.toggle('on',on);
    b.classList.toggle('pending',label==='Requested');
    if(b.classList.contains('btn')) b.classList.toggle('ghost',on);
    b.textContent=label;});
  /* Their profile sheet is gated on this exact relationship, so the
     button is not the only thing that changed — repaint the whole sheet
     and the gate follows along, including when a failed write rolls the
     follow back underneath it. */
  const top=ui.ovStack[ui.ovStack.length-1];
  if(top&&top.type==='user'&&top.id===id) renderOverlay();
}
/* Three states, not two: not following → requested → following. The
   middle one is new (step-1.15) and is why this can't just be a boolean
   any more — tapping the button when you're already waiting withdraws
   the request rather than following harder. */
function toggleFollow(id){
  const wasFollowing=!!state.follows[id], wasPending=!!state.followPending[id];
  const undo=wasFollowing||wasPending;
  const who=(userOf(id).name||'').split(' ')[0]||'them';

  if(undo){
    state.follows[id]=false; state.followPending[id]=false;
    if(wasFollowing){
      storeSocial.counts.following=Math.max(0,(storeSocial.counts.following|0)-1);
      if(storeSocial.listsLoaded) storeSocial.following=storeSocial.following.filter(x=>x.id!==id);
    }
  }else{
    /* Pending, not following: the count only moves when they accept, and
       the accepted list only gains them then too. */
    state.followPending[id]=true;
  }
  save(); paintFollow(id);
  toast(undo ? (wasPending?'Request withdrawn':'Unfollowed') : `Follow request sent to ${who}`);

  const u=currentUser(); if(!u) return;
  (undo?social.unfollow(u.id,id):social.follow(u.id,id)).catch(err=>{
    if(err.status===409) return;
    console.warn('follow failed',err);
    state.follows[id]=wasFollowing; state.followPending[id]=wasPending;
    save(); paintFollow(id); toast('Couldn\'t update that follow');
  });
}

/* Letting someone in. The notification back to them is a trigger's job
   (step-1.15.sql), not this function's — the client saying "they
   accepted you" would be a client that could say it without accepting. */
async function acceptFollow(id){
  const u=currentUser(); if(!u) return;
  const req=storeSocial.requests.find(r=>r.id===id); if(!req) return;
  storeSocial.requests=storeSocial.requests.filter(r=>r.id!==id);
  storeSocial.counts.followers=(storeSocial.counts.followers|0)+1;
  if(storeSocial.listsLoaded && !storeSocial.followers.some(x=>x.id===id)) storeSocial.followers.push(req.user);
  renderView(); renderAppbar();
  toast(`${(req.user.name||'They').split(' ')[0]} can see your pours now`);
  try{
    await social.acceptFollow(u.id,id);
    /* they can see followers-only pours from here on, so the feed they
       are in is not the feed we already have */
    if(await loadFeed()) renderView();
  }catch(err){
    console.warn('accept failed',err);
    storeSocial.requests.unshift(req);
    storeSocial.counts.followers=Math.max(0,(storeSocial.counts.followers|0)-1);
    storeSocial.followers=storeSocial.followers.filter(x=>x.id!==id);
    renderView(); toast('Couldn\'t accept that — try again');
  }
}

async function declineFollow(id){
  const u=currentUser(); if(!u) return;
  const req=storeSocial.requests.find(r=>r.id===id); if(!req) return;
  storeSocial.requests=storeSocial.requests.filter(r=>r.id!==id);
  renderView(); renderAppbar(); toast('Request declined');
  try{ await social.declineFollow(u.id,id); }
  catch(err){
    console.warn('decline failed',err);
    storeSocial.requests.unshift(req); renderView();
    toast('Couldn\'t decline that — try again');
  }
}
/* Opening a post loads its thread. The feed only carries a count, so
   the comment bodies are fetched on demand rather than with every card. */
async function openPost(id){
  pushOv({type:'post',id});
  const u=currentUser(); if(!u) return;
  const p=findPost(id); if(!p||p.comments.length) return;
  try{
    const rows=await social.fetchComments(id);
    p.comments=rows.map(r=>social.commentOf(r,u.id));
    p.commentN=p.comments.length;
    const mine=new Set(await social.fetchMyCommentLikes(rows.map(r=>r.id)));
    p.comments.forEach(c=>{ c.likedByMe=mine.has(c.id); });
    const top=ui.ovStack[ui.ovStack.length-1];
    if(top&&top.type==='post'&&top.id===id) renderOverlay();
  }catch(e){ console.warn('comments failed',e); }
}

function addComment(id){
  const inp=$('#cmt-input'); if(!inp) return; const text=inp.value.trim(); if(!text) return;
  const p=findPost(id); if(!p) return;
  const c={u:'me',t:text,ago:'now',likes:0};
  p.comments.push(c); if(p.commentN!=null) p.commentN++; save();
  const list=$('#cmt-list'); if(list){if(list.querySelector('.empty')) list.innerHTML=''; list.insertAdjacentHTML('beforeend',commentRow(c,p.id,p.comments.length-1));}
  inp.value=''; toast('Comment added 💬');
  const u=currentUser(); if(!u) return;
  social.addComment(u.id,id,text)
    .then(row=>{ if(row) c.id=row.id; refreshChallenges(); })
    .catch(err=>{
      console.warn('comment failed',err);
      const i=p.comments.indexOf(c); if(i>=0) p.comments.splice(i,1);
      if(p.commentN!=null) p.commentN--;
      renderOverlay();
      toast(/too many comments/i.test(err.message)?'Slow down a moment — too many comments at once':'Couldn\'t post that comment');
    });
}

function toggleCafeFollow(id){
  const on=state.cafeFollow[id]=!state.cafeFollow[id]; save(); renderOverlay();
  toast(on?'Following café ☕':'Unfollowed');
  const u=currentUser(); if(!u) return;
  (on?social.followCafe(u.id,id):social.unfollowCafe(u.id,id)).catch(err=>{
    if(err.status===409) return; console.warn('cafe follow failed',err);
    state.cafeFollow[id]=!on; save(); renderOverlay(); toast('Couldn\'t update that follow');
  });
}

/* ---------- challenges (step 1.17) ----------
   Nothing to join, nothing to submit, nothing to vote on — so all that
   is left here is opening one and keeping the number honest.

   Progress is computed in Postgres, so after anything that could move it
   the app refetches rather than adjusting a local count. A single pour
   can advance two of the three challenges at once and may or may not
   cross a goal; reproducing those rules in the client would be a second
   implementation to keep in step with the first. */
function refreshChallengeViews(){
  renderView();
  const top=ui.ovStack[ui.ovStack.length-1];
  if(top&&(top.type==='challenge'||top.type==='challenges')) renderOverlay();
}

function openChallenge(id){
  pushOv({type:'challenge',id});
  /* Re-read on open: the sheet is where someone goes to check, and the
     numbers may have moved on another device since the last load. */
  refreshChallenges();
}

/* Refetch the three, then repaint whatever is showing them. Also picks
   up the points a just-finished challenge awarded, which land on the
   profile row rather than in anything the client computed. */
export async function refreshChallenges(){
  if(!currentUser()) return;
  const before=CHALLENGES.filter(c=>c.done).length;
  if(!await loadChallenges()) return;
  refreshChallengeViews();
  const won=CHALLENGES.filter(c=>c.done).length-before;
  if(won>0){
    /* The database also wrote a notification, so the bell is already
       right; this is the in-the-moment version for someone who is
       looking at the screen when it lands. */
    const c=CHALLENGES.find(x=>x.done);
    toast(won===1&&c?`Challenge complete: ${c.title} · +${c.points} 🎯`:`${won} challenges complete! 🎯`);
    refreshScore();
  }
}

/* ---------- moderation ---------- */
async function sendReport(postId,reason){
  popOv();
  const u=currentUser();
  if(!u){ toast('Sign in to report a pour'); return; }
  try{ await social.report(u.id,{ postId, reason }); toast('Reported — thanks for keeping Crema kind 🙏'); }
  catch(e){ console.warn('report failed',e); toast('Couldn\'t send that report — try again'); }
}

async function blockUser(uid){
  const u=currentUser();
  if(!u){ toast('Sign in to block someone'); return; }
  const who=(userOf(uid).name||'this person').split(' ')[0];
  if(!confirm(`Block ${who}? You won't see their pours, and they won't be told.`)) return;
  popOv();
  try{
    await social.block(u.id,uid);
    storeSocial.blocks.push(uid);
    state.follows[uid]=false; save();
    await loadFeed(); ui.ovStack=[]; render();
    toast(`Blocked ${who}`);
  }catch(e){
    if(e.status===409){ toast(`${who} is already blocked`); return; }
    console.warn('block failed',e); toast('Couldn\'t block — try again');
  }
}

async function deleteMyPost(id){
  if(!confirm('Delete this pour? This cannot be undone.')) return;
  popOv();
  const p=findPost(id); if(!p) return;
  const i=state.posts.indexOf(p); if(i>=0) state.posts.splice(i,1);
  const j=mine.list.indexOf(p); if(j>=0) mine.list.splice(j,1);
  ui.ovStack=[]; save(); render(); toast('Pour deleted');
  const u=currentUser(); if(!u) return;
  deletePost(id).then(()=>{ deleteImage(p.img); refreshScore(); refreshChallenges(); }).catch(err=>{
    console.warn('delete failed',err);
    if(i>=0) state.posts.splice(i,0,p);
    if(j>=0) mine.list.splice(j,0,p);
    save(); render(); toast('Couldn\'t delete that — it\'s still there');
  });
}
/* The same pour can sit in several lists at once (the feed, your profile
   grid, your saves) and they are not always the same object. An edit has
   to land on every copy, or the caption you just fixed comes back on the
   next tab switch. */
function postCopies(id){
  const out=[];
  [state.posts, mine.list, saved.list, state.myGallery, [findPost(id)]]
    .forEach(l=>(l||[]).forEach(p=>{ if(p&&p.id===id&&!out.includes(p)) out.push(p); }));
  return out;
}

/* Reopens the create sheet as an edit of an existing pour. Everything the
   form can express is loaded back into it — including the halves the
   recipe stores combined (machine) or without their brand (bean), the
   same unpacking brewAgain does. */
function editMyPost(id){
  const p=findPost(id); if(!p) return;
  if(!canEdit(p)){ popOv(); toast('Pours can only be edited on the day you posted them'); return; }
  const r=p.recipe||{}, c=freshCreate();
  const cat=r.bean&&beanCatalog(r.bean);
  const cafe=p.cafe?CAFES.find(x=>x.name===p.cafe):null;
  Object.assign(c,{
    editId:p.id, img:p.img,
    /* the pour's own audience, not the remembered default */
    visibility:p.visibility==='followers'?'followers':'public',
    drink:p.drink||c.drink, pattern:p.art?(p.pattern||null):null,
    caption:p.caption||'', source:cafe?'cafe':'home', cafe:cafe?cafe.id:'',
    bean:r.bean||'',
    beanBrand: cat?cat.roaster:(r.bean&&state.customBeans.includes(r.bean))?MY_BEANS:'',
    /* prefill from the post, never from the profile: an edit shows what
       was posted, not what you usually drink */
    milk:r.milk||'', dose:r.dose||'', yield:r.yield||'', time:r.time||'', temp:r.temp||'',
    machineBrand:'', machineModel:''
  });
  if(r.machine&&!cafe){ const m=splitMachine(r.machine); c.machineBrand=m.brand; c.machineModel=m.model; }
  ui.create=c; ui.ovStack=[]; pushOv({type:'create'});
}

/* Optimistic like every other write here: the change is on screen before
   the request goes out, and every copy rolls back together if it fails. */
async function saveEdit(c){
  const p=findPost(c.editId);
  if(!p){ ui.ovStack=[]; render(); toast('That pour is gone'); return; }
  if(!canEdit(p)){ ui.ovStack=[]; render(); toast('Pours can only be edited on the day you posted them'); return; }
  const copies=postCopies(p.id);
  const KEYS=['drink','art','pattern','cafe','caption','recipe','edited','visibility'];
  const before=copies.map(x=>{ const o={}; KEYS.forEach(k=>o[k]=x[k]); return o; });
  const next={ ...composeFromSheet(c), edited:true };
  copies.forEach(x=>Object.assign(x,next));
  ui.create=null; ui.ovStack=[]; save(); render(); toast('Changes saved');

  if(!currentUser()) return;
  /* An edit can move the score now: filling in dose and yield earns the
     exact-recipe points, and naming a coffee you've never logged earns
     the new-bean ones (step-1.14.sql). */
  try{ await updatePost(p.id,p); refreshScore(); }
  catch(err){
    console.warn('edit failed',err);
    copies.forEach((x,i)=>Object.assign(x,before[i]));
    save(); render(); toast('Couldn\'t save that — the pour is unchanged');
  }
}

function brewAgain(id){
  const p=findPost(id); if(!p) return; const r=p.recipe||{};
  ui.create=freshCreate();
  /* The bean field only ever stored the coffee's own name, never its
     roaster — the brand picker needs that back too, or a re-logged
     recipe shows no brand and the bean list stays empty and disabled. */
  const cat=r.bean&&beanCatalog(r.bean);
  const beanBrand=cat?cat.roaster:(r.bean&&state.customBeans.includes(r.bean))?MY_BEANS:'';
  Object.assign(ui.create,{drink:p.drink||ui.create.drink, pattern:p.pattern||ui.create.pattern,
    bean:r.bean||'', beanBrand, milk:r.milk||ui.create.milk,
    dose:r.dose||'', yield:r.yield||'', time:r.time||'', temp:r.temp||''});
  /* The recipe stores one combined "Brand Model" string; the picker needs
     the two halves back or it silently falls back to your own machine. */
  if(r.machine){ const m=splitMachine(r.machine); ui.create.machineBrand=m.brand; ui.create.machineModel=m.model; }
  ui.ovStack=[]; pushOv({type:'create'}); toast('Recipe loaded — brew it again ☕');
}
function sharePost(id){
  const p=findPost(id); if(!p) return; const link=postLink(id);
  if(navigator.share){ navigator.share({title:'Crema',text:(p.caption||'A pour on Crema'),url:link}).catch(()=>{}); }
  else copyText(link,'Link copied 🔗');
}
function copyText(text,msg){
  const done=()=>toast(msg||'Copied ✓');
  if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(done).catch(()=>fallbackCopy(text,done)); }
  else fallbackCopy(text,done);
}
function fallbackCopy(text,done){
  try{const ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done();}
  catch(e){toast('Couldn\'t copy here — long-press the post instead');}
}
/* A photo belongs in R2, never in the row. `image_key` holds an object
   key; a data: URI there is 300 KB shipped to every viewer on every feed
   load, and Postgres now rejects it outright (step-1.11.sql). So if the
   background upload didn't land, retry it here and say so if it fails —
   rather than posting something the database will refuse. */
async function ensureUploaded(c){
  if(!c.img || !/^data:/.test(c.img)) return true;
  if(!currentUser()) return true;
  c.uploading=true; c.uploadFailed=false; renderOverlay();
  try{
    const blob=await (await fetch(c.img)).blob();
    const key=await uploadImage(blob, blob.type||'image/jpeg');
    if(ui.create===c){ c.img=key; c.uploading=false; renderOverlay(); }
    return true;
  }catch(e){
    console.warn('upload retry failed',e);
    if(ui.create===c){ c.uploading=false; c.uploadFailed=true; renderOverlay(); }
    toast('Photo still won\'t upload — remove it to post without one');
    return false;
  }
}

/* What the sheet's fields mean, in one place, because the create and the
   edit path have to agree on it exactly — a rule applied on one path and
   not the other is how an edit silently drops someone's recipe. */
function composeFromSheet(c){
  const T=v=>(v||'').trim();
  let drink=c.drink===ADD_DRINK?(state.me.premium?T(c.drinkCustom):''):T(c.drink);
  if(c.drink===ADD_DRINK && state.me.premium && drink && !DRINKS.includes(drink) && !state.customDrinks.includes(drink)) state.customDrinks.push(drink);
  if(!drink) drink='Cappuccino';
  /* A milk drink can take latte art, but only counts as art if the user
     actually tagged a pattern — otherwise it is just a cappuccino. */
  const hasArt=!!DRINK_ART[drink] && !!c.pattern;
  const caption=T(c.caption)||`${drink} ☕`;
  const cafe=(c.source==='cafe'&&c.cafe)?CAFES.find(x=>x.id===c.cafe):null;
  const recipe={};
  if(cafe){
    // café-sourced: bean from their list, machine from the café
    if(T(c.bean)) recipe.bean=T(c.bean);
    if(cafe.menu&&cafe.menu.machine) recipe.machine=cafe.menu.machine;
    if(HAS_MILK.has(drink)&&c.milk) recipe.milk=c.milk;
  }else{
    let bean=c.bean===ADD_BEAN?(state.me.premium?T(c.beanCustom):''):T(c.bean);
    if(c.bean===ADD_BEAN && state.me.premium && bean && !BEANS.some(b=>b.n===bean) && !state.customBeans.includes(bean)) state.customBeans.push(bean);
    if(bean) recipe.bean=bean;
    /* A bag of coffee outlasts a single pour, so the next create sheet
       opens on this one already chosen (freshCreate). Only pours you
       made yourself count — a café's bean is theirs, not what's on your
       shelf. Posting without a bean leaves the memory alone: the last
       coffee you actually used is still the last one you used. */
    if(bean) state.lastBean=bean;
    const machine=combineMachine(c.machineBrand,c.machineModel);
    if(machine) recipe.machine=machine;
    if(HAS_MILK.has(drink)&&c.milk) recipe.milk=c.milk;
    if(T(c.dose)) recipe.dose=T(c.dose);
    if(T(c.yield)) recipe.yield=T(c.yield);
    if(T(c.time)) recipe.time=T(c.time);
    if(T(c.temp)) recipe.temp=T(c.temp);
  }
  const hasRecipe=Object.keys(recipe).length>0;
  return { drink, art:hasArt, pattern:hasArt?c.pattern:null,
           cafe:cafe?cafe.name:undefined, caption, recipe:hasRecipe?recipe:null,
           visibility: c.visibility==='followers' ? 'followers' : 'public' };
}

async function submitPost(){
  syncCreate(); const c=ui.create;
  if(c.editId){ saveEdit(c); return; }
  if(c.uploading){ toast('Photo is still uploading — one moment'); return; }
  if(!(await ensureUploaded(c))) return;
  /* The id is minted client-side so it never changes under us — the
     generated cup art is seeded from it, and so is the share link. */
  const u=currentUser();
  const np={ id:newPostId(), user:'me', ...composeFromSheet(c),
    /* No art score: nothing here can judge a pour, so nothing claims to.
       quality stays null and the generated cup art uses its own default. */
    quality:null, img:c.img, ago:'now',
    createdAt:new Date().toISOString(),
    likes:0, likedByMe:false, saved:false, comments:[], commentN:0 };
  state.posts.unshift(np); mine.list.unshift(np); save();
  /* Land on the tab that will actually contain what you just posted: a
     followers-only pour never appears in Today. */
  ui.ovStack=[]; ui.route='home'; ui.filter=np.visibility==='followers'?'following':'today'; render();
  setTimeout(()=>toast(c.img?'Posted! Streak kept 🔥':'Posted ☕ (add a photo next time)'),120);

  /* Optimistic: the post is already on screen. Reconcile on failure. */
  if(u) createPost(np,u.id).then(()=>{
    refreshScore();
    /* The pour may have finished a challenge — the trigger has already
       decided, so ask rather than guess. */
    refreshChallenges();
    /* Both tabs are server-filtered now, and we may have just switched
       to the other one — so let the server say what belongs there rather
       than showing whichever list happened to be loaded. */
    return loadFeed().then(ok=>{ if(ok) renderView(); });
  }).catch(err=>{
    console.warn('post failed',err);
    const i=state.posts.indexOf(np); if(i>=0) state.posts.splice(i,1);
    const j=mine.list.indexOf(np); if(j>=0) mine.list.splice(j,1);
    save(); render(); toast('Couldn\'t post that — check your connection and try again');
  });
}

/* ---------- theme ---------- */
const mqDark=matchMedia('(prefers-color-scheme: dark)');
export function applyTheme(){
  const t=state.theme||'auto';
  const dark = t==='dark' || (t==='auto' && mqDark.matches);
  document.documentElement.setAttribute('data-theme',dark?'dark':'light');
}
if(mqDark.addEventListener) mqDark.addEventListener('change',()=>{ if((state.theme||'auto')==='auto') applyTheme(); });

/* ---------- toast & clock ---------- */
let toastT;
export function toast(msg){const el=$('#toast'); el.innerHTML=msg; el.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('show'),1900);}
export function tick(){const d=new Date(); $('#clock').textContent=d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}
