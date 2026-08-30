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
import { $, $$, esc, fmt, withUnit } from '../core/util.js';
import { DRINKS, DRINK_ART, HAS_MILK, ADD_DRINK, BEANS, beanCatalog, combineMachine, splitMachine,
         machineKnown } from '../data/catalog.js';
import { USERS, CAFES, CHALLENGES, userOf, handleToUid } from '../data/world.js';
import { signUp, signInWithPassword, signInWithOAuth, signOut, onAuthChange, currentUser,
         sendPasswordReset, updatePassword } from '../data/supabase.js';
import { ensureProfile, pushProfile, pushName, pushAvatar, fetchUserCard, searchProfiles, fetchScore,
         setNotifyPrefs , setTimezone, fetchProfilesByHandles, redeemPremium, dropPremium,
         handleTaken } from '../data/profiles.js';
import { codeValid, PREMIUM_MAIL, photoLimit } from '../domain/premium.js';
import { cropSquare, objectPosition, isAdjustable, focusAfterDrag, pickFocus } from '../domain/framing.js';
import { recapSVG, recapPNG, loadShotPhotos, loadStanding, weekStanding } from './recap.js';
import { enablePush, disablePush, pushEnabled, syncPush, pushSupported, pushPermission } from '../data/push.js';
import { createPost, updatePost, deletePost, newPostId, fetchMine, fetchPost } from '../data/posts.js';
import { uploadImage, deleteImage } from '../data/media.js';
import * as social from '../data/social.js';
/* A namespace, not named imports: data/posts.js already exports a
   deletePost() of its own and the two must not be confusable. */
import * as mod from '../data/moderation.js';
import { logRecapExport } from '../data/recap.js';
import { exportMyData, deleteMyAccount } from '../data/account.js';
import { markAllRead, fetchNotifications } from '../data/notifications.js';
import { state, ui, save, applyMe, findPost, freshCreate, useSession, cachePosts, mine,
         saved, loadSaved, loadFeed, loadMoreFeed, loadFriendsToday, social as storeSocial, loadChallenges, canEdit,
         feed, hydrateReactions, myMachines, myCoffees, togglePin, setGearNote, rememberOwn,
         weekRecap, toggleRecapPick,
         applyArrivals, dropArrivals, admin, loadQueue, keepSignupDraft, clearSaved } from '../store/store.js';
import { onLive, whileAnsweringRequest } from '../store/live.js';
import { react, unreact, noReactions } from '../data/reactions.js';
import { commentRow, postLink, searchHTML, reactionBar, avatar } from './components.js';
import { icon } from './icons.js';
import { t, tn, setLang } from '../i18n.js';
import { render, renderView, renderAppbar, CAFE_MAIL } from './views.js';
import { authState, signupStep } from './gate.js';
import { pushOv, popOv, renderOverlay, pickerList } from './overlays.js';
import { initHistory } from './history.js';
import { markSeen, DAILY_CHAMPION } from '../core/announce.js';

/* ============================================================ BACK */
/* Moving to a tab, remembering where you came from. See ui/history.js
   for why the app has a back stack at all. */
function navTo(route){
  if(route!==ui.route){ const i=ui.navStack.indexOf(ui.route); if(i>=0) ui.navStack.splice(i,1); ui.navStack.push(ui.route); }
  ui.route=route; ui.ovStack=[]; render();
}

/* One step back: the top sheet if one is open, otherwise the tab you
   came from. False means there is nothing left, and the Play build
   should close rather than sit there ignoring the gesture. */
function goBack(){
  const top=ui.ovStack[ui.ovStack.length-1];
  /* Onboarding is the one sheet with no way out — the profile row is
     half-written until it finishes, and there is no app behind it worth
     dropping someone into. Back holds still here. */
  if(top&&top.type==='onboard') return true;
  if(ui.ovStack.length){ popOv(); return true; }
  /* Signing up is three steps deep, and back walks them rather than
     throwing the whole thing away. Nothing typed is lost either way —
     the answers live in state.me — but landing on the feed because
     somebody backed out of the machine step reads as a crash. */
  if(!currentUser()&&ui.gate&&ui.auth&&ui.auth.mode==='up'&&signupStep(ui.auth)>1){ signupStepper(-1); return true; }
  /* The sign-in screen is a screen, not a sheet, but a guest stepped
     into it from the feed and back belongs there — not out of the app. */
  if(!currentUser()&&ui.gate){ ui.gate=false; ui.auth=null; render(); return true; }
  /* Posting, blocking and signing out all drop you on Home without
     asking the trail about it, so the tab we came from can be the tab we
     are already on. Skip those rather than spending a back press on a
     move nobody would see. */
  while(ui.navStack.length){
    const to=ui.navStack.pop();
    if(to!==ui.route){ ui.route=to; render(); return true; }
  }
  return false;
}
initHistory({ depth: () => ui.ovStack.length + ui.navStack.length + (ui.gate?1:0), step: goBack });

/* ============================================================ GUEST WALL */
/* Signed out, Crema is readable and nothing else: today's public pours,
   the sheet for any one of them, and the thread under it. Every other
   intent raises the sign-in sheet instead of doing nothing or, worse,
   firing a request that RLS will refuse.

   Gate on *intent*, never on entry — a stranger sees real coffee before
   Crema asks them for anything. That is the whole difference between
   this and the sign-in wall it replaces.

   The readable actions are listed rather than the gated ones, so an
   action added later is closed until someone decides otherwise. */
/* `set-lang` is on this list because asking someone to create an account
   before they may read the app in their own language is the wrong order:
   the switch changes nothing on the server and belongs to the device, not
   to a profile. */
/* The two Premium actions on this list ask for nothing and write
   nothing: one opens a mail client, the other copies an address. Making
   someone create an account before they may find out how to ask about
   Premium is the same wrong order as the language switch. Redeeming a
   code is NOT here — Premium lives on a profile row, so it needs one. */
const GUEST_READS=new Set(['open-post','recipe','share-post','close-ov','reload','toast','none',
                           'guest-signin','guest-back','set-lang','show-arrivals',
                           /* Dismissing a card is closing it. app.js raises the
                              what's-new card only for a signed-in account, so a
                              guest should never meet this — but the failure mode
                              if one ever did is a sign-in sheet in answer to
                              somebody tapping "Got it", which is the opposite of
                              what the button says it does. */
                           'dismiss-whatsnew',
                           'premium-mail','copy-premium-mail',
                           /* A bean or machine page is reference material with
                              nothing of anyone's on it — the same reading a
                              guest already gets of a pour and its recipe. */
                           'open-bean','open-machine','gear-info']);

/* Which line the sheet should lead with, per intent. */
const GUEST_ASK={
  like:'like', react:'react', save:'save', 'menu-save':'save',
  'add-cmt':'comment', 'cmt-like':'comment', 'cmt-reply':'comment', 'mention-pick':'comment',
  follow:'follow', 'accept-follow':'follow', 'decline-follow':'follow', 'open-flist':'follow',
  'open-create':'post', brew:'post',
  'open-user':'people', 'open-tag':'explore', 'open-challenge':'explore', 'open-challenges':'explore',
  'open-cafe':'cafe', 'follow-cafe':'cafe', directions:'cafe',
  'open-notifs':'notifs',
  'open-settings':'profile', 'open-passport':'profile', 'open-gearpass':'profile',
  'gear-edit':'premium', 'gear-save':'premium', 'open-scoring':'profile',
  'open-streak':'profile', ptab:'profile',
  'open-premium':'premium', 'redeem-premium':'premium', 'premium-off':'premium', pin:'premium',
  'open-recap':'premium', 'share-recap':'premium', 'pick-standout':'premium',
  'open-menu':'general', 'menu-report':'general', 'menu-block':'general'
};
const NAV_ASK={ explore:'explore', cafes:'cafe', profile:'profile' };

/* True when the click was swallowed and the sheet raised instead. */
function guestWall(a,el){
  if(currentUser()) return false;
  /* The sign-in screen runs its own actions, and they are the point. */
  if(ui.gate) return false;
  if(GUEST_READS.has(a)) return false;
  if(a==='filter') { if(el.dataset.f==='today') return false; pushOv({type:'signin',why:'following'}); return true; }
  if(a==='nav'){
    if(el.dataset.r==='home') return false;
    pushOv({type:'signin',why:NAV_ASK[el.dataset.r]||'general'}); return true;
  }
  pushOv({type:'signin',why:GUEST_ASK[a]||'general'});
  return true;
}

/* ============================================================ ACTIONS */
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-action]'); if(!el) return;
  const a=el.dataset.action, id=el.dataset.id;
  if(guestWall(a,el)) return;
  switch(a){
    case 'nav':{ navTo(el.dataset.r);
      /* points move when other people like your pours, so re-read them
         when you look at your own profile rather than only after posting */
      if(ui.route==='profile') refreshScore();
      break;}
    case 'filter':{ if(ui.filter===el.dataset.f) break; ui.filter=el.dataset.f; feed.cursor=null; feed.done=false;
      /* Arrivals were fetched against the tab that queued them, so they
         belong to it — three public pours from strangers are not what
         the Following tab is for. The reload below refills them. */
      dropArrivals(); renderView();
      /* signed in the Following tab is a different server query, not a
         client-side filter over one page */
      if(currentUser()) loadFeed().then(()=>renderView());
      break;}
    case 'show-arrivals': showArrivals(); break;
    case 'open-post': openPost(id); break;
    case 'open-cafe': pushOv({type:'cafe',id}); break;
    /* Every coffee and every brewer has a page now, including the ones
       people typed in themselves — that used to be the one row in the
       passport that answered a tap with a toast, and it was the bag
       they know best. An entry with nothing behind it opens on the
       offer to write it down rather than on a dead end. */
    case 'open-bean':{ if(id) pushOv({type:'bean',id}); break;}
    case 'open-machine':{ if(id) pushOv({type:'machine',id}); break;}
    case 'open-gearpass': pushOv({type:'gearpass'}); break;
    /* The ⓘ on a picker row: read about it without choosing it. The row
       around it picks, so this button has to be the inner target — it
       is, because the dispatcher takes the closest [data-action]. */
    case 'gear-info':{ const v=el.dataset.v||''; if(!v) break;
      pushOv({type:el.dataset.kind==='machine'?'machine':'bean',id:v}); break;}
    case 'gear-edit':{ const v=el.dataset.v||''; if(!v) break;
      if(!state.me.premium){ openPremium(t('Your own bean and machine details')); break; }
      pushOv({type:'gearedit',kind:el.dataset.kind,id:v}); break;}
    case 'gear-save': saveGear(el.dataset.kind,el.dataset.v||''); break;
    case 'open-user':{ if(!id)break; if(id==='me') navTo('profile'); else openUser(id); break;}
    case 'open-notifs':{ const had=state.notifications.some(n=>!n.read); state.notifications.forEach(n=>n.read=true); if(had){save(); renderAppbar();} pushOv({type:'notifs'});
      const u=currentUser(); if(u&&had) markAllRead(u.id).catch(err=>console.warn('mark read failed',err));
      break;}
    /* Closing the card IS the acknowledgement — see overlayWhatsNew().
       The flag is written before the sheet is popped so that a crash
       between the two cannot bring it back tomorrow. */
    case 'dismiss-whatsnew': markSeen(DAILY_CHAMPION); popOv(); break;
    case 'notif-go':{ const n=state.notifications[+el.dataset.idx]; if(!n)break;
      if(n.post) openNotifiedPost(n.post);
      else if(n.challenge) pushOv({type:'challenge',id:n.challenge});
      else if(n.cafe) pushOv({type:'cafe',id:n.cafe});
      else if(n.u) pushOv({type:'user',id:n.u}); break;}
    case 'open-menu': pushOv({type:'menu',id}); break;
    case 'open-tag': pushOv({type:'tag',id}); break;
    case 'open-challenge': openChallenge(id); break;
    case 'open-challenges': pushOv({type:'challenges'}); break;
    case 'open-flist': openFlist(id); break;
    case 'open-scoring': pushOv({type:'scoring'}); break;
    case 'open-streak': pushOv({type:'streak'}); break;
    case 'push-on': turnPushOn(); break;
    case 'push-off': turnPushOff(); break;
    case 'toggle-notify-morning': toggleNotify('notifyMorning'); break;
    case 'toggle-notify-social': toggleNotify('notifySocial'); break;
    case 'toggle-notify-friends': toggleNotify('notifyFriends'); break;
    case 'toggle-notify-streak': toggleNotify('notifyStreak'); break;
    case 'toggle-notify-digest': toggleNotify('notifyDigest'); break;
    case 'open-passport': pushOv({type:'passport'}); break;
    /* the logo is the way back to a clean slate */
    case 'reload': location.reload(); break;
    case 'open-settings': pushOv({type:'settings'}); break;
    case 'open-admin': openAdmin(); break;
    case 'mod-tab':{ if(admin.tab===el.dataset.t) break;
      admin.tab=el.dataset.t; admin.loaded=false; admin.err=''; renderOverlay();
      loadQueue().then(()=>renderOverlay()); break;}
    case 'mod-act': modAct(el); break;
    case 'open-create': setCreate(freshCreate()); pushOv({type:'create'}); break;
    case 'close-ov': popOv(); break;
    /* The field is cleared here, not left to the repaint. ui/keepinput.js
       carries typing across a repaint of the same screen, and it cannot
       tell "the boot landed while somebody was typing" from "the person
       asked for this to be emptied" — both are the same route painting
       again with the same rendered value. So an action that deliberately
       overwrites a field says so, in the DOM, the way addComment() has
       always cleared #cmt-input. */
    case 'clear-search':{ ui.searchQ=''; const s=$('#search-input'); if(s) s.value=''; renderView(); break;}

    case 'like': toggleLike(id); break;
    case 'react': toggleReaction(id,el.dataset.k); break;
    case 'save': toggleSave(id); break;
    case 'follow': toggleFollow(id); break;
    case 'accept-follow': acceptFollow(id); break;
    case 'decline-follow': declineFollow(id); break;
    case 'follow-cafe': toggleCafeFollow(id); break;
    case 'recipe':{const el=$('#rp-'+id); if(el){el.classList.toggle('open'); const o=el.classList.contains('open'); t.innerHTML=t.innerHTML.replace(o?'▾':'▴',o?'▴':'▾');} break;}
    case 'ptab':{ ui.profTab=el.dataset.t; renderView();
      /* the saves are rows, not a filter over the feed page */
      if(ui.profTab==='saved'&&!saved.loaded) loadSaved().then(ok=>{ if(ok) renderView(); });
      break;}


    case 'cmt-like':{ const p=findPost(el.dataset.pid); const c=p&&p.comments[+el.dataset.idx]; if(!c)break;
      c.likedByMe=!c.likedByMe; c.likes=(c.likes||0)+(c.likedByMe?1:-1); save();
      el.classList.toggle('on',c.likedByMe); el.innerHTML=icon(c.likedByMe?'heartF':'heart',15)+'<span>'+(c.likes||'')+'</span>';
      const u=currentUser(), cid=el.dataset.cid;
      if(u&&cid){ const want=c.likedByMe;
        (want?social.likeComment(u.id,cid):social.unlikeComment(u.id,cid)).catch(err=>{
          if(err.status===409) return; console.warn('comment like failed',err);
          c.likedByMe=!want; c.likes=(c.likes||0)+(want?-1:1); renderOverlay(); }); }
      break;}
    case 'cmt-reply':{ const inp=$('#cmt-input'); if(inp){inp.value='@'+(el.dataset.handle||'').replace('@','')+' '; inp.focus(); paintMentions(null);} break;}
    case 'mention-pick': pickMention(el.dataset.h); break;
    case 'add-cmt': addComment(id); break;

    case 'share-post': sharePost(id); break;
    case 'menu-copy': copyText(postLink(id),t('Link copied 🔗')); popOv(); break;
    case 'menu-save': toggleSave(id); popOv(); break;
    case 'menu-report': popOv(); pushOv({type:'report',id}); break;
    case 'report-send': sendReport(id,el.dataset.reason); break;
    case 'menu-block': blockUser(id); break;
    case 'menu-delete': deleteMyPost(id); break;
    case 'menu-edit': editMyPost(id); break;
    case 'brew': brewAgain(id); break;
    case 'directions':{ const c=CAFES.find(x=>x.id===id); if(!c)break;
      const url='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(c.name+', '+c.area+', '+c.city);
      let w=null; try{w=window.open(url,'_blank','noopener');}catch(err){}
      if(!w) copyText(url,t('Maps link copied 🔗')); break;}

    case 'cafe-filter': ui.cafeF[el.dataset.f]=!ui.cafeF[el.dataset.f]; renderView(); break;

    /* ---------- the café pilot ask ----------
       The button is a real <a href="mailto:…">, so it works on its own
       and this only acknowledges the tap. A webview with no mail client
       bound swallows the navigation silently, which looks like a dead
       button — so the address is copyable right underneath, and that
       row is the fallback rather than a second-guessing of the first. */
    case 'cafe-lead': toast(t('Opening your mail app ✉️')); break;
    case 'copy-cafe-mail': copyText(CAFE_MAIL,t('{mail} copied ✉️',{mail:CAFE_MAIL})); break;
    case 'share-crema':{
      const link=location.href.split('#')[0];
      if(navigator.share) navigator.share({title:'Crema',text:t('Coffee, brewed social. Log what you pour.'),url:link}).catch(()=>{});
      else copyText(link,t('Link copied 🔗'));
      break;}

    /* ---------- the machine / coffee picker ----------
       The sheet underneath is a form with unsaved text in it, so its
       fields are harvested before a second sheet covers it — same
       sync-then-repaint contract every other action here follows. */
    case 'open-picker': openPicker(el.dataset.kind,el.dataset.pfx); break;
    case 'pk-brand':{ const q=$('#pk-q'); ui.picker.q=el.dataset.b||''; if(q){q.value=ui.picker.q; q.focus();} paintPicker(); break;}
    case 'pk-focus':{ const q=$('#pk-q'); if(q) q.focus(); break;}
    case 'pick': choosePicked(el.dataset.v||''); break;
    /* Adding what they typed is the same act as picking it — the value
       just isn't one of ours. Free on purpose: no catalogue will ever
       hold everyone's bag, and a lock here means logging the wrong
       coffee or not logging at all. */
    case 'pick-new':{ const q=($('#pk-q')?$('#pk-q').value:(ui.picker&&ui.picker.q)||'').trim();
      if(!q) break;
      /* Machines used to be remembered only by posting with one, so
         adding your grandmother's moka pot and then closing the sheet
         lost it. Both shelves keep what you add now — and since
         step-1.29 both keep it on the server, so it is still there on
         the next device. */
      if(ui.picker.kind==='bean'){ if(!BEANS.some(b=>b.n===q)) rememberOwn('bean',q); }
      else { if(!machineKnown(q)) rememberOwn('machine',q); }
      choosePicked(q); break;}
    case 'pin':{
      const kind=el.dataset.kind, v=el.dataset.v||'';
      /* The sheet rather than a toast: a toast cannot hold the code
         field, so the old one could only point at Settings and hope. */
      if(!state.me.premium){ openPremium(t('Favourites')); break; }
      toast(togglePin(kind,v)?t('Added to favourites ★'):t('Removed from favourites'));
      paintPicker(); break;}

    case 'cpat':{ syncCreate(); ui.create.pattern=(ui.create.pattern===el.dataset.p)?null:el.dataset.p; renderOverlay(); break;}
    case 'csource':{ syncCreate(); ui.create.source=el.dataset.s; if(el.dataset.s==='home')ui.create.cafe=''; renderOverlay(); break;}
    case 'open-recipe':{ syncCreate(); ui.create.recipeOpen=true; renderOverlay(); break;}
    /* Collapsing clears the fields too, not just recipeOpen — composeFromSheet
       already ignores them while closed, but leaving old values sitting
       there would make "Remove recipe" look like it didn't do anything if
       the panel is reopened, and re-adding should start from a blank slate
       rather than resurface a recipe someone just chose to drop. */
    case 'close-recipe':{ syncCreate(); const c=ui.create;
      c.recipeOpen=false; c.bean=''; c.machineBrand=''; c.machineModel='';
      c.dose=''; c.yield=''; c.time=''; c.temp=''; renderOverlay(); break;}
    /* Remembered here rather than at submit time, so it sticks even if
       the sheet is abandoned — the choice was still made. */
    case 'cvis':{ syncCreate(); ui.create.visibility=el.dataset.v; state.lastVisibility=el.dataset.v; save(); renderOverlay(); break;}
    case 'submit-post': submitPost(); break;
    /* "Post without the photo" after an upload failed: drop only the
       ones that failed, and keep the ones that made it. */
    case 'drop-photo':{ syncCreate(); const c=ui.create;
      c.photos=shots(c).filter(x=>!x.failed);
      c.photoI=Math.max(0,Math.min(c.photoI,c.photos.length-1)); renderOverlay(); break;}
    case 'photo-remove': removeShot(+el.dataset.i); break;
    case 'photo-pick':{ syncCreate(); ui.create.photoI=+el.dataset.i; renderOverlay(); break;}
    /* The ＋ tile on a free account: the one place the photo limit is
       met, so the offer names it rather than saying "Premium". */
    case 'photo-premium': openPremium(t('Up to three photos on a pour')); break;

    case 'set-theme': state.theme=el.dataset.t; save(); applyTheme(); renderOverlay(); break;
    /* Language is a whole-app repaint, not a patch: every screen, sheet
       and app-bar title is built from t() at render time, so switching it
       means painting the lot again. It is stored outside `state` (see
       src/i18n.js), so it survives a sign-out and a guest can set it. */
    case 'set-lang': if(setLang(el.dataset.l)){
      render();
      /* The device's push row carries the language too (step-1.32), and
         the server has no other way to learn it: push text is composed
         in plpgsql, hours later, with nobody to ask. Re-stating the
         subscription is the same call boot already makes and is a no-op
         when notifications are off. Not awaited — switching language
         must repaint now, not after a round trip. */
      const u=currentUser(); if(u) syncPush(u.id).catch(()=>{});
    } break;
    case 'save-profile': saveProfile(); break;
    case 'drop-avatar': dropAvatar(); break;
    /* ---------- Premium ----------
       Switching it on is a redemption now, not a toggle: there is a code
       to check, a round trip to Postgres, and a wrong answer to say out
       loud. Switching it off stays one tap and no questions — asking
       someone to justify giving something up is a dark pattern. */
    case 'open-premium': openPremium(el.dataset.f||''); break;
    case 'redeem-premium': redeemCode(el.dataset.i||'pm-code'); break;
    case 'premium-off': premiumOff(); break;
    case 'premium-mail': toast(t('Opening your mail app ✉️')); break;
    case 'copy-premium-mail': copyText(PREMIUM_MAIL,t('{mail} copied ✉️',{mail:PREMIUM_MAIL})); break;
    case 'open-recap': openRecap(); break;
    case 'share-recap': shareRecap(); break;
    case 'pick-standout': pickStandout(el.dataset.id); break;

    case 'ob-next':{ syncOb();
      if(!(state.me.name||'').trim()){ ui.obError=t('Tell us your name first.'); renderOverlay(); break; }
      ui.obError=''; ui.obStep=Math.min(2,(ui.obStep||1)+1); renderOverlay(); break;}
    case 'ob-back': syncOb(); ui.obError=''; ui.obStep=Math.max(1,(ui.obStep||1)-1); renderOverlay(); break;
    case 'ob-finish': finishOnboarding(); break;

    /* Into the sign-in screen from the guest feed, and back out of it.
       Both repaint everything: the app bar, the tab bar and the view all
       differ between the two. */
    case 'guest-signin':{ ui.gate=true; ui.ovStack=[];
      ui.auth={ mode:el.dataset.m==='in'?'in':'up', step:1, email:'', error:'', notice:'', busy:false };
      render(); break;}
    case 'guest-back':{ ui.gate=false; ui.auth=null; render(); break;}

    /* Switching sides restarts the sign-up at its first step: coming
       back from "Sign in" onto step 3 would ask for an account before
       anything had been set up, which is the order this flow exists to
       undo. */
    case 'auth-mode':{ syncAuth(); const a=authState();
      a.mode=el.dataset.m||'in'; a.step=1; a.error=''; a.notice=''; renderView(); break;}
    case 'signup-next': signupStepper(1); break;
    case 'signup-back': signupStepper(-1); break;
    case 'toggle-pw': togglePw(el); break;
    case 'auth-submit': doAuth(); break;
    case 'auth-oauth': doOAuth(el.dataset.p); break;
    case 'sign-out': doSignOut(); break;
    case 'open-password': ui.pw={error:'',busy:false}; pushOv({type:'password'}); break;
    case 'pw-save': savePassword(); break;
    case 'export-data': downloadMyData(); break;
    case 'open-delete-account': ui.del={error:'',busy:false}; pushOv({type:'delaccount'}); break;
    case 'delete-account': deleteAccount(); break;
    case 'toast': toast(el.dataset.msg||t('Coming soon')); break;
    default: break;
  }
});
document.addEventListener('keydown',e=>{ if(e.key!=='Enter') return;
  const el=e.target.closest('[data-enter]'); if(!el) return; e.preventDefault();
  if(el.dataset.enter==='add-cmt') addComment(el.dataset.id);
  else if(el.dataset.enter==='auth-submit') doAuth();
  else if(el.dataset.enter==='signup-next') signupStepper(1);
  else if(el.dataset.enter==='pw-save') savePassword();
  else if(el.dataset.enter==='delete-account') deleteAccount();
  else if(el.dataset.enter==='redeem') redeemCode(el.dataset.i||'pm-code'); });
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
  if(e.target.id==='cmt-input'){
    const q=mentionQuery(e.target);
    paintMentions(q);
    /* Most people you'd name are already in USERS — but not everyone is,
       so widen the pool from Postgres too. Debounced; searchProfiles()
       registers what it finds, which is what the repaint then picks up. */
    clearTimeout(mentionT);
    if(q==null||!q.length) return;
    mentionT=setTimeout(async()=>{
      const u=currentUser(); if(!u) return;
      try{ await searchProfiles(u.id,q,6,storeSocial.blocks);
        if(mentionQuery($('#cmt-input'))===q) paintMentions(q); }
      catch(err){ console.warn('mention search failed',err); }
    },250);
    return;
  }
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

/* ---------- @mentions ----------
   Typing an @ in the comment box opens a short list of people to name.
   It is painted straight into its own element rather than through
   renderOverlay(), because repainting the sheet would take the keyboard
   down and the caret with it — and the whole point is to keep typing. */
const MENTION_RE=/@([A-Za-z0-9_.]*)$/;
let mentionT;

/* What is being mentioned at the caret, or null when nothing is. */
function mentionQuery(inp){
  if(!inp) return null;
  const caret=inp.selectionStart==null?inp.value.length:inp.selectionStart;
  const upto=inp.value.slice(0,caret);
  const m=upto.match(MENTION_RE); if(!m) return null;
  /* Only at a word boundary — the @ in an email address is not a
     mention, and offering to tag someone mid-word is noise. */
  const before=upto[upto.length-m[0].length-1];
  if(before!==undefined && !/\s/.test(before)) return null;
  return m[1];
}

function paintMentions(q){
  const box=$('#cmt-mentions'); if(!box) return;
  if(q==null){ box.innerHTML=''; box.hidden=true; return; }
  const ql=q.toLowerCase();
  /* Everyone this session already knows about — authors on the feed,
     your followers, anyone the search below has turned up. Handle first,
     because that is what is being typed. */
  const list=Object.values(USERS)
    .filter(u=>u&&u.id&&u.id!=='me'&&u.handle)
    .filter(u=>!ql||u.handle.slice(1).toLowerCase().indexOf(ql)===0||(u.name||'').toLowerCase().includes(ql))
    .slice(0,6);
  box.hidden=!list.length;
  box.innerHTML=list.map(u=>`<button type="button" data-action="mention-pick" data-h="${esc(u.handle.slice(1))}">
    ${avatar(u.id)}<div class="who"><b>${esc(u.name)}</b><span>${esc(u.handle)}</span></div></button>`).join('');
}

/* Clicking the list must not blur the input first: the caret is what
   tells pickMention() which @ to replace. */
document.addEventListener('mousedown',e=>{ if(e.target.closest('#cmt-mentions')) e.preventDefault(); });

function pickMention(handle){
  const inp=$('#cmt-input'); if(!inp||!handle) return;
  const caret=inp.selectionStart==null?inp.value.length:inp.selectionStart;
  const head=inp.value.slice(0,caret).replace(MENTION_RE,'@'+handle+' ');
  inp.value=head+inp.value.slice(caret);
  inp.focus(); inp.setSelectionRange(head.length,head.length);
  paintMentions(null);
}

/* The @handles in a thread that we cannot turn into a link yet. */
function mentionedHandles(comments){
  const out=[];
  (comments||[]).forEach(c=>{
    (String(c.t||'').match(/@[A-Za-z0-9_.]+/g)||[]).forEach(m=>{
      const h=m.slice(1).toLowerCase();
      if(h && !handleToUid[h] && out.indexOf(h)<0) out.push(h);
    });
  });
  return out;
}
async function resolveHandles(handles){
  if(!handles.length||!currentUser()) return false;
  try{ return (await fetchProfilesByHandles(handles)).length>0; }
  catch(e){ console.warn('mention lookup failed',e); return false; }
}

function paintSearch(){
  const res=$('#explore-results'), normal=$('#explore-normal');
  if(res&&normal){ res.innerHTML=ui.searchQ?searchHTML(ui.searchQ):''; normal.style.display=ui.searchQ?'none':''; }
}
document.addEventListener('change',e=>{
  const id=e.target.id;
  if(id==='c-photo-cam'||id==='c-photo-lib'||id==='c-photo-add'){
    if(e.target.files&&e.target.files[0]) handleUpload(e.target.files[0], id==='c-photo-add'?'add':'replace');
    /* Cleared so choosing the SAME file twice still fires a change —
       otherwise re-picking the photo you just removed does nothing. */
    e.target.value=''; return; }
  if(id==='sp-avatar'){ if(e.target.files&&e.target.files[0]) uploadAvatar(e.target.files[0]); return; }
  if(id==='c-drink'||id==='c-cafe'){ syncCreate(); renderOverlay(); return; }
  if(id==='c-milk'){ syncCreate(); return; }
});
/* The picker's search box. `input` rather than `change`, because results
   that arrive when you stop typing are a list you have to wait for
   instead of one you steer. */
document.addEventListener('input',e=>{
  if(e.target.id!=='pk-q'||!ui.picker) return;
  ui.picker.q=e.target.value;
  paintPicker();
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

/* ---------- staying current while the app is open ----------
   store/live.js says what changed — over a socket when Realtime is up,
   over a 60s poll when it isn't. This decides what that is allowed to
   move on screen, and the rule is the same one refreshOnReturn() below
   follows: never repaint something the reader's thumb is on.

     'feed'    new pours are queued. Splice them in only at the very top
               of the feed with no sheet open; otherwise paint the pill
               and let them tap it.
     'bell'    the appbar, which is one icon and moves nothing.
     'post'    a like or a reaction moved — patched in place by the same
               two painters the optimistic writes use, so the photo does
               not blink and no input is rebuilt.
     'thread'  a comment landed. Only refreshes an open sheet, and only
               the list inside it, because renderOverlay() would take the
               half-typed comment in the composer with it.

   The feed pill goes to the top of the list when tapped, since that is
   where the new pours are and the tap said "show me". */
function showArrivals(){
  if(!applyArrivals()) return;
  renderView();
  const v=$('#view'); if(v) v.scrollTo({top:0,behavior:'smooth'});
}

/* Same test refreshOnReturn() uses, and for the same reason. */
const onFeedScreen = () => currentUser() ? ui.route==='home' : !ui.gate;
const feedIsSteady = () => {
  if(ui.ovStack.length || !onFeedScreen()) return false;
  const v=$('#view');
  return !!v && v.scrollTop<8;
};

async function refreshOpenThread(postId){
  const top=ui.ovStack[ui.ovStack.length-1];
  if(!top || top.type!=='post') return;
  if(postId && top.id!==postId) return;
  const p=findPost(top.id); if(!p) return;
  const u=currentUser();
  try{
    const rows=await social.fetchComments(top.id);
    /* Still the same sheet? fetchComments() is a round trip. */
    const now=ui.ovStack[ui.ovStack.length-1];
    if(!now || now.type!=='post' || now.id!==top.id) return;
    const fresh=rows.map(r=>social.commentOf(r,u?u.id:null));
    if(u){
      const mineLikes=new Set(await social.fetchMyCommentLikes(rows.map(r=>r.id)));
      fresh.forEach(c=>{ c.likedByMe=mineLikes.has(c.id); });
    }
    /* A comment of your own that hasn't come back from the server yet
       has no id. Carrying it across means someone else's comment
       arriving mid-post doesn't make yours flicker out of the thread. */
    const pending=p.comments.filter(c=>!c.id);
    const next=fresh.concat(pending);
    if(next.length===p.comments.length && next.every((c,i)=>c.id===p.comments[i].id)) return;
    p.comments=next; p.commentN=next.length;
    const list=$('#cmt-list');
    if(!list){ renderOverlay(); return; }
    list.innerHTML=next.map((c,i)=>commentRow(c,p.id,i)).join('');
    const head=$('#cmt-head'); if(head) head.textContent=`${next.length} ${t('comments')}`;
    if(await resolveHandles(mentionedHandles(next))) list.innerHTML=next.map((c,i)=>commentRow(c,p.id,i)).join('');
  }catch(e){ console.warn('live thread refresh failed',e); }
}

onLive((what,arg)=>{
  if(what==='bell'){ renderAppbar(); return; }
  /* The follow-request block lives above the feed, so it repaints with
     the feed screen — and only there, since nothing else renders it. */
  if(what==='requests'){ if(onFeedScreen()) renderView(); return; }
  if(what==='thread'){ refreshOpenThread(arg); return; }
  if(what==='post'){ const p=findPost(arg); if(p){ paintLike(p); paintReactions(p); paintCommentCount(p); } return; }
  if(what==='feed'){
    if(feedIsSteady()) applyArrivals();
    /* Repaint either way: with the new cards in, or with the pill that
       says they are waiting. A deleted pour has already left the list. */
    if(onFeedScreen()) renderView();
  }
});

/* ---------- coming back to the app ----------
   The socket above covers the app while it is on screen. This covers
   the gap it cannot: a tab left in the background for an hour comes
   back to a feed whose Today has rolled over, and no number of new
   pours fixes a list that starts yesterday. So returning is still a
   reason to re-ask for the whole thing.

   Only on the way IN. `visibilitychange` fires on hide too, and
   refreshing something nobody is looking at spends a request to move
   pixels on a screen that is off. */
const RETURN_REFRESH_MS = 45000;
/* Seeded at boot, which has just loaded everything — so flicking away
   and straight back doesn't refetch what arrived seconds ago. */
let lastReturnRefresh = Date.now();

async function refreshOnReturn(){
  const u=currentUser(); if(!u) return;
  if(Date.now()-lastReturnRefresh < RETURN_REFRESH_MS) return;
  lastReturnRefresh=Date.now();

  /* The bell first. It is on screen on every tab, costs one request, and
     updating it moves nothing else on the page — so it is the one thing
     worth doing unconditionally. */
  try{
    state.notifications=await fetchNotifications(u.id);
    renderAppbar();
  }catch(e){ console.warn('notification refresh failed',e); }

  /* Repainting a list is only safe at the top of it, with no overlay in
     the way. Replacing innerHTML does keep scrollTop — but loadFeed()
     throws away every page after the first, so someone who had scrolled
     through three pages would land in a list that no longer reaches that
     far; and new pours arrive at the *top*, which shifts everything
     below the same offset onto different content. Deep in the feed,
     stale is the better failure: the fresh page is one tab-switch or
     pull away, and nothing has moved under their thumb. */
  const v=$('#view');
  if(ui.ovStack.length || !v || v.scrollTop>=200) return;

  if(ui.route==='home'){ const [fed]=await Promise.all([loadFeed(), loadFriendsToday()]); if(fed) renderView(); }
  else if(ui.route==='explore'){ if(await loadChallenges()) renderView(); }
}

document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible') refreshOnReturn();
});
/* Coming back onto the network is the same event seen from the other
   side — the app was open the whole time, but its data is just as old. */
window.addEventListener('online',refreshOnReturn);

/* activity-bar tooltip */
document.addEventListener('mouseover',e=>{const ab=e.target.closest('.actbars .ab'); if(!ab)return; const tip=ab.parentElement.querySelector('.bartip'); if(!tip)return;
  tip.textContent=`${ab.dataset.d} · ${ab.dataset.c} pour${ab.dataset.c==='1'?'':'s'}`; tip.style.left=(ab.offsetLeft+ab.offsetWidth/2)+'px'; tip.hidden=false;});
document.addEventListener('mouseout',e=>{const ab=e.target.closest('.actbars .ab'); if(!ab)return; const tip=ab.parentElement.querySelector('.bartip'); if(tip)tip.hidden=true;});

/* ============================================================ AUTH */
/* Keep typed values across the re-render that follows every state change. */
function syncAuth(){ const a=authState();
  const el=$('#au-email'); if(el) a.email=el.value; }

/* Show / hide the password, from the eye inside the field.
   Flipped in the DOM rather than through renderView(), because the gate
   deliberately keeps the password out of state — a repaint would empty
   the field at the exact moment somebody asked to read it. So the
   attribute, the glyph and the label are all changed in place, and
   ui.auth only REMEMBERS the choice so that a repaint for another
   reason paints it back the way it was.

   The caret is saved and put back: changing `type` under an input drops
   the selection in Safari and moves it to the end in Chrome, which is
   maddening in the middle of a typo you opened the eye to find. */
function togglePw(btn){
  const inp=$('#'+(btn.dataset.i||'au-pw')); if(!inp) return;
  const show=inp.type==='password';
  authState().showPw=show;
  const from=inp.selectionStart, to=inp.selectionEnd;
  inp.type=show?'text':'password';
  btn.setAttribute('aria-pressed',show?'true':'false');
  btn.setAttribute('aria-label',show?t('Hide password'):t('Show password'));
  btn.setAttribute('title',show?t('Hide password'):t('Show password'));
  btn.innerHTML=icon(show?'eyeOff':'eye',18);
  /* Focus goes back to the field, not the button that was tapped: the
     eye is something you use in the middle of typing, and on a phone
     leaving focus on the button drops the keyboard. */
  try{ inp.focus(); inp.setSelectionRange(from??inp.value.length, to??inp.value.length); }catch(_){}
}

function authError(e){
  const m=(e&&e.message)||'';
  if(/Failed to fetch|NetworkError|Load failed/i.test(m)) return t('Crema is out of reach. Check your connection and try again.');
  if(/Invalid login credentials/i.test(m)) return t('That email and password do not match.');
  if(/already registered|already been registered/i.test(m)) return t('That email already has an account. Sign in instead.');
  if(/Password should be at least/i.test(m)) return t('Pick a longer password, at least 8 characters.');
  if(/Email not confirmed/i.test(m)) return t('Confirm your email address first. Check your inbox.');
  if(/rate limit|too many/i.test(m)) return t('Too many attempts just now. Wait a minute and try again.');
  return m ? t(m) : t('Something went wrong. Try again.');
}

/* Move between the three sign-up steps. `dir` is +1 or -1.

   Every step syncs its fields into state.me and saves before it moves,
   so nothing typed is lost to the repaint — and so an abandoned sign-up
   still has the answers waiting the next time this browser reaches for
   one. The setup is a guest's own data until the account exists; it
   never leaves the device before then.

   The name is the one required answer: a profile row without one shows
   as "Barista" to everybody else, and the owner is the last to find
   out. The username is checked here rather than after the account is
   created, which is the one thing the old order genuinely did better —
   it could answer "that username is taken" while there was still a form
   to correct. */
async function signupStepper(dir){
  const a=authState();
  syncOb(); save();
  const step=signupStep(a);
  if(dir<0){ a.error=''; a.step=Math.max(1,step-1); renderView(); return; }

  if(step===1){
    if(!(state.me.name||'').trim()){ a.error=t('Tell us your name first.'); renderView(); return; }
    const handle=(state.me.handle||'').trim();
    if(handle){
      a.busy=true; a.error=''; renderView();
      const taken=await handleTaken(handle);
      a.busy=false;
      if(taken){ a.error=t('That username is taken. Try another.'); renderView(); return; }
    }
  }
  a.error=''; a.step=Math.min(3,step+1); renderView();
}

async function doAuth(){
  syncAuth();
  const a=ui.auth, email=(a.email||'').trim(), pw=($('#au-pw')||{}).value||'';
  if(!email){ a.error=t('Enter your email address.'); renderView(); return; }

  if(a.mode==='forgot'){
    a.busy=true; a.error=''; a.notice=''; renderView();
    try{
      await sendPasswordReset(email);
      a.busy=false; a.mode='in';
      a.notice=t('Reset link sent. Open it on this device and you can set a new password.');
    }catch(e){ a.busy=false; a.error=authError(e); }
    renderView(); return;
  }

  if(!pw){ a.error=t('Enter your password.'); renderView(); return; }
  if(a.mode==='up'&&pw.length<8){ a.error=t('Pick a password of at least 8 characters.'); renderView(); return; }
  a.busy=true; a.error=''; a.notice=''; renderView();
  try{
    if(a.mode==='up'){
      /* The last moment the setup is still only in this browser's guest
         store: from here the store is about to be re-keyed to a user id
         that has never seen it (keepSignupDraft, store/store.js). */
      await keepSignupDraft();
      const { confirmationRequired } = await signUp(email,pw);
      if(confirmationRequired){
        a.busy=false; a.mode='in'; a.step=1;
        a.notice=t('Account created. Confirm your email address, then sign in — your setup is waiting.');
        renderView(); return;
      }
    } else {
      await signInWithPassword(email,pw);
    }
    /* success → onAuthChange below drives the load and repaint */
  }catch(e){ a.busy=false; a.error=authError(e); renderView(); }
}

async function doOAuth(provider){
  syncAuth(); const a=authState(); a.busy=true; a.error=''; renderView();
  /* Same reason as doAuth: Google navigates away and comes back as a
     cold boot with a session and an empty store, so the setup has to be
     somewhere that boot can still find it. Kept on the sign-in side too
     — it costs one localStorage write, and a first-ever Google sign-in
     from that side creates the same brand-new profile row. */
  await keepSignupDraft();
  try{ await signInWithOAuth(provider); }        // navigates away on success
  catch(e){ a.busy=false; a.error=authError(e); renderView(); }
}

async function doSignOut(){
  if(!confirm(t('Sign out of Crema on this device?'))) return;
  await signOut();
}

async function savePassword(){
  const p=ui.pw||(ui.pw={error:'',busy:false});
  const a=($('#pw-new')||{}).value||'', b=($('#pw-again')||{}).value||'';
  if(a.length<8){ p.error=t('At least 8 characters, please.'); renderOverlay(); return; }
  if(a!==b){ p.error=t('Those two do not match.'); renderOverlay(); return; }
  p.busy=true; p.error=''; renderOverlay();
  try{ await updatePassword(a); popOv(); toast(t('Password changed 🔑')); }
  catch(e){ p.busy=false; p.error=authError(e); renderOverlay(); }
}

/* ---------- your data, in your hands and out of ours ----------
   Step 3.3 of brain/13-infrastructure-plan.md. */

/* One RPC, one file. The database assembles the whole document because
   it is the only party that can see all of it — RLS hides a person's
   own error reports and the moderation decisions about them from the
   person themselves, by design, and an export that quietly skipped
   those would be the wrong answer to Art. 15.

   Named with the date rather than with a counter: the interesting
   question about an export is always when it was taken. */
async function downloadMyData(){
  if(ui.exporting) return;
  ui.exporting=true; renderOverlay();
  try{
    const doc=await exportMyData();
    const name=`crema-${(USERS.me.handle||'you').replace(/^@/,'')}-${new Date().toISOString().slice(0,10)}.json`;
    const blob=new Blob([JSON.stringify(doc,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
    toast(t('Saved — that is everything we hold 📦'));
  }catch(e){
    console.warn('export failed',e);
    toast(t('That did not download. Try again.'));
  }finally{ ui.exporting=false; renderOverlay(); }
}

/* Irreversible, and the only thing in the app that is. The typed
   username is checked again server-side; what happens here is the part
   afterwards, which matters more than it looks:

   the local state blob is keyed by user id (store/persistence.js), so
   without clearSaved() this browser would keep a cached copy of the
   feed, the shelf and the create-sheet defaults of an account that no
   longer exists — and hand it straight back to the next person who
   signs in on this device if the id were ever reissued. Deleting is
   deleting here too. */
async function deleteAccount(){
  const d=ui.del||(ui.del={error:'',busy:false});
  if(d.busy) return;
  const typed=(($('#del-confirm')||{}).value||'').trim();
  const handle=(USERS.me.handle||'').replace(/^@/,'');
  if(typed.replace(/^@/,'').toLowerCase()!==handle.toLowerCase()){
    d.error=t('Type {handle} exactly, and it is gone.',{handle}); renderOverlay(); return;
  }
  d.busy=true; d.error=''; renderOverlay();
  try{
    await deleteMyAccount(typed);
    await clearSaved();
    popOv();
    await signOut();
    toast(t('Your account is gone. Take care ☕'));
  }catch(e){
    console.warn('account deletion failed',e);
    /* The Edge Function's messages are English sentences, and they are
       keys in i18n.de.js like every other string in the app; t() falls
       back to the sentence itself for anything it does not know. */
    d.busy=false; d.error=t(e.message||'That did not work. Try again.'); renderOverlay();
  }
}

/* Pull the profile row down (creating it on first sign-in) and merge it
   into state.me. A brand-new row means a brand-new account, which is
   what triggers onboarding. */
async function syncProfile(){
  const u=currentUser(); if(!u) return;
  try{
    const { me, created }=await ensureProfile(u.id,u.email,state.me);
    /* The row wins over whatever this browser remembers — that is what
       makes an account portable between devices — with one exception:
       it must not win by being emptier. A profile is created nameless
       at first sign-in (see meToRow), and letting that empty string
       overwrite a real local name destroys the only copy left that
       could put the name back. */
    const localName=(state.me.name||'').trim();
    Object.assign(state.me,me);
    if(!me.name && localName) state.me.name=localName;

    /* An account whose profile has just been created has never been
       through onboarding, whatever this browser happens to remember —
       unless the row arrived already filled in, which since sign-up
       asks for the setup first is the normal case. ensureProfile()
       creates it FROM those answers (adoptSession moved them across),
       so there is nothing left to ask and the onboarding sheet would be
       a form full of what they just typed.

       The sheet is still there for the account that reaches this with
       nothing: a first Google sign-in from the "Sign in" side, a draft
       that never made it, a row created before this order changed. */
    if(created) state.onboarded=!!(me.name||'').trim();
    else if(state.me.name) state.onboarded=true;
    /* True for exactly one repaint: whoever greets this person needs to
       know they have just arrived rather than come back. */
    ui.freshAccount=created;
    save(); applyMe();

    /* A row with no name is a row nobody else can put a name to: every
       other client falls back to "Barista" (rowToUser), while the owner
       keeps seeing their own name out of local state and has no way of
       knowing. It happens when the profile was created at first sign-in
       and the one write that fills it — at the end of onboarding —
       never landed, which the toast there already promises to retry and
       nothing ever did.

       So retry it here, on every sign-in, for as long as it is needed.
       Silent on purpose: this is repairing something the user did not
       do wrong and cannot see.

       If there is no name on either side, the account never finished
       onboarding at all — so ask again rather than leaving them
       permanently nameless behind an `onboarded` flag this browser
       happens to have kept. */
    if(!me.name){
      if(state.me.name) pushName(u.id,state.me.name).catch(err=>console.warn('name repair failed',err));
      else state.onboarded=false;
      save();
    }
    /* Which local morning a pour belongs to is decided in Postgres, and
       only this line tells it where the user is. Fire-and-forget: a
       failed timezone write is not worth a toast. */
    setTimezone(u.id).catch(err=>console.warn('timezone sync failed',err));
  }catch(e){ console.warn('profile sync failed',e); toast(t('Your profile did not load. We will try again next time.')); }
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
       button, so the switches are on rather than making them find a
       second screen. Since step-1.19 they are on by default anyway;
       this covers anyone who had turned one off and changed their mind. */
    state.me.notifySocial=true; state.me.notifyStreak=true; state.me.notifyMorning=true;
    state.me.notifyFriends=true;
    save();
    try{ await setNotifyPrefs(u.id,state.me); }
    catch(e){ console.warn('notification prefs failed',e); }
    renderOverlay();
    toast(t('Reminders on ☕'));
    return;
  }

  renderOverlay();
  toast(
    r.reason==='denied'      ? t('Notifications are blocked in your browser settings')
  : r.reason==='ios-install' ? t('Add Crema to your Home Screen first')
  : r.reason==='dismissed'   ? t('No reminders. You can turn them on any time.')
  : t('Reminders would not turn on. Try again.'));
}

async function turnPushOff(){
  ui.push=ui.push||{}; ui.push.busy=true; renderOverlay();
  await disablePush();
  ui.push.busy=false; ui.push.enabled=false; renderOverlay();
  toast(t('Reminders off on this device'));
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
    toast(t('That did not save. Try again.'));
  }
}

/* On boot: find out whether this device already has a live subscription,
   and re-state it if so (endpoints rotate silently). Never prompts. */
export async function initPush(){
  if(!pushSupported()) return;
  const u=currentUser(); if(!u) return;
  ui.push=ui.push||{};
  ui.push.enabled=await pushEnabled().catch(()=>false);
  /* Re-render: this also runs from onAuthChange and from the worker's
     push-resubscribed message, where a reminders sheet can already be
     open and showing the pre-boot guess. */
  if(ui.push.enabled){ renderOverlay(); syncPush(u.id).catch(()=>{}); return; }
  /* Permission granted but no subscription. That is the normal state in
     the Play build — the Android wrapper asks for notification
     permission itself, so someone can have said yes on install and still
     never receive anything, because nothing here ever subscribed them.
     enablePush() only ever prompts when permission is still 'default',
     so this cannot put a dialog in front of anybody; the one prompt in
     Crema is still the one behind "Remind me". */
  if(pushPermission()!=='granted') return;
  const r=await enablePush(u.id).catch(()=>({ok:false}));
  if(r&&r.ok){ ui.push.enabled=true; renderOverlay(); }
}

/* Write the onboarding answers to the profile row. This is the first
   thing a new account does, so a failure here has to be visible. */
async function finishOnboarding(){
  syncOb();
  if(!(state.me.name||'').trim()){ ui.obStep=1; ui.obError=t('Tell us your name first.'); renderOverlay(); return; }
  const u=currentUser();
  if(u){
    try{ await pushProfile(u.id,state.me); }
    catch(e){
      if(e.status===409){ ui.obStep=1; ui.obError=t('That username is taken. Try another.'); renderOverlay(); return; }
      console.warn('profile save failed',e);
      toast(t('Saved on this device. We will sync your profile shortly.'));
    }
  }
  state.onboarded=true; ui.obError=''; save(); applyMe();
  ui.ovStack=[]; render(); toast(t('Welcome to Crema ☕'));
}

/* The single place the app reacts to signing in or out. Signing out is
   no longer a dead end: useSession(null) has just loaded today's public
   feed, so `gate:false` lands them on it as a guest. */
onAuthChange(async s=>{
  await useSession(s);
  if(s) await syncProfile();
  applyMe(); applyTheme();
  ui.ovStack=[]; ui.navStack.length=0; ui.route='home'; ui.auth=null; ui.gate=false; render();
  if(s){
    /* Same as the boot path in app.js. Without it a sign-in that happens
       inside a running page leaves ui.push.enabled false, and the
       reminders sheet offers "Remind me" to a device that is already
       subscribed — reading as off when it is on. Never prompts. */
    initPush().catch(()=>{});
    if(!state.onboarded){ ui.obStep=1; pushOv({type:'onboard'}); }
    else if(ui.freshAccount){
      /* They set the whole thing up on the way in, so the app opens on
         the feed rather than on a form. The what's-new card is marked
         seen for the same reason onboarding marks it: a first morning
         is not the moment to be told what changed. */
      markSeen(DAILY_CHAMPION);
      toast(t('Welcome to Crema ☕'));
    }
    else toast(t('Signed in ☕'));
    ui.freshAccount=false;
  }
  else toast(t('Signed out. You can still look around.'));
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
  if(!(state.me.name||'').trim()){ toast(t('Add your name first')); return; }
  state.me.name=(state.me.name||'').trim(); state.me.city=(state.me.city||'').trim(); state.me.handle=(state.me.handle||'').trim();
  save(); applyMe(); renderView();
  const u=currentUser(); if(!u){ popOv(); toast(t('Profile updated ✓')); return; }
  try{ await pushProfile(u.id,state.me); popOv(); toast(t('Profile updated ✓')); }
  catch(e){
    if(e.status===409){ toast(t('That username is taken. Try another.')); return; }
    console.warn('profile sync failed',e); popOv(); toast(t('Saved here. We will sync it shortly.'));
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
  const u=currentUser(); if(!u){ toast(t('That pour would not open')); return; }
  try{
    const p=await fetchPost(id,u.id);
    if(!p){ toast(t('That pour is gone')); return; }
    cachePosts([p]); openPost(id);
  }catch(e){ console.warn('notification post failed',e); toast(t('That pour would not open')); }
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

/* The machine and the coffee are no longer read back out of the DOM:
   the picker sheet writes them straight into state when they are chosen,
   because a field that is a button has no value to harvest. Everything
   else still comes off the form. */
function syncCreate(){ if(!ui.create) ui.create=freshCreate();
  const g=i=>{const el=$('#'+i); return el?el.value:undefined;}, c=ui.create;
  ['caption','drink','drink-custom','cafe','milk','dose','yield','time','temp'].forEach(f=>{
    const v=g('c-'+f); if(v!==undefined) c[f==='drink-custom'?'drinkCustom':f]=v;});
  /* At a café the bean comes from their menu, so that one IS a select. */
  if(c.source==='cafe'){ const b=g('c-bean'); if(b!==undefined) c.bean=b; }}
function syncOb(){ const g=i=>{const el=$('#'+i); return el?el.value:undefined;};
  const n=g('ob-name'); if(n!==undefined&&n.trim()) state.me.name=n.trim();
  const h=g('ob-handle'); if(h!==undefined) state.me.handle=h.trim();
  const c=g('ob-city'); if(c!==undefined&&c.trim()) state.me.city=c.trim();
  const d=g('ob-drink'); if(d!==undefined) state.me.favDrink=d;
  const mk=g('ob-milk'); if(mk!==undefined) state.me.favMilk=mk; }
function syncSettings(){ const g=i=>{const el=$('#'+i); return el?el.value:undefined;};
  const set=(id,k)=>{const v=g(id); if(v!==undefined) state.me[k]=v;};
  set('sp-name','name'); set('sp-handle','handle'); set('sp-bio','bio'); set('sp-city','city'); set('sp-milk','favMilk'); }

/* ---------- machine / coffee picker ----------
   `pfx` says which form asked ('c' the create sheet, 'sp' Settings, 'ob'
   onboarding), and is the only thing the sheet needs to know to put the
   answer back where it came from. Its form is synced first: the picker
   opens on top of a half-typed post, and repainting that sheet on the
   way back would otherwise drop the caption. */
function openPicker(kind,pfx){
  if(pfx==='c') syncCreate(); else if(pfx==='sp') syncSettings(); else if(pfx==='ob') syncOb();
  const c=pfx==='c'?(ui.create||freshCreate()):null;
  const current = kind==='machine'
    ? combineMachine(pfx==='c'?c.machineBrand:state.me.machineBrand, pfx==='c'?c.machineModel:state.me.machineModel)
    : (c?c.bean:'');
  ui.picker={kind,pfx,q:'',current:current||''};
  pushOv({type:'picker',id:kind+':'+pfx});
  /* Straight to the keyboard only when there is nothing to tap: with a
     shelf on screen the common case is one tap, and a keyboard covering
     it would hide the very rows that make this fast. */
  const q=$('#pk-q');
  if(q&&!(kind==='machine'?myMachines():myCoffees()).length) q.focus();
}
/* Repaint just the list. The search field is left alone on purpose —
   re-rendering the sheet would replace the input mid-word and take the
   caret and the keyboard with it. */
export function paintPicker(){
  const l=$('#pk-list'); if(l&&ui.picker) l.innerHTML=pickerList()+'<div style="height:20px"></div>';
}
function choosePicked(v){
  const p=ui.picker; if(!p) return;
  const val=(v||'').trim();
  if(p.kind==='machine'){
    /* Stored as brand + model still; an unknown name is 'Other', which
       is exactly how splitMachine reads one back off a saved recipe. */
    const m=val?splitMachine(val):{brand:'',model:''};
    if(p.pfx==='c'){ const c=ui.create||(ui.create=freshCreate()); c.machineBrand=m.brand; c.machineModel=m.model; }
    else { state.me.machineBrand=m.brand; state.me.machineModel=m.model; }
  }else{
    const c=ui.create||(ui.create=freshCreate()); c.bean=val;
  }
  if(p.pfx!=='c') save();
  ui.picker=null;
  popOv();
}

/* ---------- double tap a photo to like it ----------
   The gesture everyone already has in their thumbs, and the one place
   in Crema where a tap has to wait to find out what it meant.

   A single tap on a feed photo opens the pour, so the two gestures
   start identically and only the second tap tells them apart. The open
   is therefore held for one window — long enough for a deliberate
   double tap, short enough that a single tap still feels like it
   answered. Nothing else on the card is delayed: the caption, the
   comment count and the recipe all open the pour instantly, so the
   fast path out of the feed is still there for anyone who wants it.

   Handled in the CAPTURE phase so the event never reaches the delegated
   click dispatcher below — the photo's own data-action is what this
   decides whether to run, and running it twice would be the bug.

   Double tapping a pour you already liked does NOT unlike it. The
   gesture means "yes, this one", never "take it back": a stray second
   tap should not quietly remove a heart, and unliking has a button
   that says what it does. */
const DOUBLE_MS=260;
let lastTap=null;
document.addEventListener('click',e=>{
  const el=e.target.closest('.media[data-media]'); if(!el) return;
  e.stopPropagation();
  const id=el.dataset.media, act=el.dataset.action;
  if(lastTap&&lastTap.id===id){ clearTimeout(lastTap.timer); lastTap=null; doubleTapLike(id,el); return; }
  if(lastTap) clearTimeout(lastTap.timer);
  lastTap={ id, timer:setTimeout(()=>{
    lastTap=null;
    /* Whatever the photo would have done on its own. In the open post
       sheet that is nothing, which is why the sheet's photo can take
       the gesture with no delay to pay for. */
    if(act&&act!=='none'&&!guestWall(act,el)&&act==='open-post') openPost(id);
  }, DOUBLE_MS) };
},true);

function doubleTapLike(id,el){
  if(guestWall('like',el)) return;
  const p=findPost(id); if(!p) return;
  if(p.user==='me'){ toast(t('You cannot like your own pour')); return; }
  /* Already liked: the heart still answers the tap, because a gesture
     that does nothing visible reads as one that didn't register. */
  if(p.likedByMe){ popHeart(id); return; }
  toggleLike(id);
}

/* ---------- what you wrote down about your own gear ----------
   Premium, and private by construction: this never leaves the device,
   which is exactly why someone may write the price they paid or what
   they think of the roaster in it. An emptied form deletes the entry
   rather than storing a row of blanks (setGearNote).

   Only the fields the sheet actually rendered are read. A catalogue
   coffee's sheet has no roaster input — passing undefined for it would
   wipe a value that sheet never offered to change. */
function saveGear(kind,name){
  if(!name) return;
  if(!state.me.premium){ openPremium(t('Your own bean and machine details')); return; }
  const g=i=>{ const el=$('#'+i); return el?el.value.trim():undefined; };
  const patch={};
  ['roaster','origin','roast','notes','note','kind'].forEach(f=>{
    const v=g('ge-'+(f==='kind'?'kind':f)); if(v!==undefined) patch[f]=v;
  });
  setGearNote(kind,name,patch);
  /* popOv() repaints the sheet underneath, which is the bean or machine
     page these details belong on — so the change is on it immediately. */
  popOv();
  toast(t('Saved ✓'));
}

/* ---------- the photos on a new post ----------
   Every surface that shows a coffee is square, so something has to
   decide which square. A photo taken in the app was framed through
   that square; one picked from the gallery was framed for something
   else, and taking its middle is how the cup ends up outside the
   picture. So the picked square is chosen by domain/framing.js and
   then handed over: the preview is the *uncropped* photo under
   object-fit:cover, which is the same crop the canvas bakes, so
   dragging it is a live view of what will be posted.

   A pour can carry up to three of them (step-1.28), which is Premium.
   The rule that keeps it simple: the camera and gallery buttons always
   REPLACE the photo you are looking at, and the ＋ tile is the only
   thing that adds one. So a free account with its single photo behaves
   exactly as it always did — Retake still retakes — and the Premium
   difference is one tile that either adds a second photo or explains
   how to get one.

   The full-size pixels stay out of `ui.create`: they are not form
   state, and `owner` ties them to one sheet — open a different post and
   they are dropped. Keyed by `sid` rather than by index, because the
   index of a photo changes the moment one before it is removed. */
let sources=new Map();   // sid → { owner, canvas }
let sidN=0;

/* All module-private: the create sheet reads `c.photos` directly when it
   paints, and nothing outside this file needs the derivations. */
const shots     = c => (c&&c.photos)||[];
const shotAt    = c => shots(c)[c.photoI]||null;
const shotsBusy = c => shots(c).some(s=>s.uploading);
/* The keys, first one first. This IS the post's photo list — `img` is
   simply the first of them, which is what every older reader expects. */
const shotKeys  = c => shots(c).map(s=>s.img).filter(Boolean);
/* Every place that starts or replaces the create sheet goes through
   here, so the full-res canvases of the draft being dropped go with it
   rather than sitting in memory until the tab is closed. */
function setCreate(c){
  [...sources.entries()].forEach(([sid,v])=>{ if(!c||v.owner!==c) sources.delete(sid); });
  ui.create=c;
  return c;
}

/* A 64px grayscale thumbnail for pickFocus(). Reading pixels is the
   only part of the framing that needs a canvas, which is why it is
   here and the arithmetic is in domain/. */
function lumaOf(src){
  const k=Math.min(1,64/Math.max(src.width,src.height));
  const w=Math.max(2,Math.round(src.width*k)), h=Math.max(2,Math.round(src.height*k));
  const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
  const g=cv.getContext('2d',{willReadFrequently:true}); g.drawImage(src,0,0,w,h);
  const d=g.getImageData(0,0,w,h).data, luma=new Uint8Array(w*h);
  for(let i=0,p=0;i<luma.length;i++,p+=4) luma[i]=(d[p]*77+d[p+1]*150+d[p+2]*29)>>8;
  return {luma,w,h};
}

/* Cut the chosen square out of the source and put it on its way: shown
   locally at once — no wait on a network round trip to see your own
   photo — then uploaded. If the upload fails the data: URL stays the
   value, the post still goes out with the photo inline, and
   ensureUploaded() retries at Post.

   Called again on every reframe, so the previous object is now an
   orphan and is deleted once its replacement has landed. */
function bakeAndUpload(c, sh, announce){
  const p=sources.get(sh.sid); if(!p||p.owner!==c) return;
  const {size,sx,sy}=cropSquare(p.canvas.width,p.canvas.height,sh.focus);
  const cv=document.createElement('canvas'); cv.width=cv.height=size;
  cv.getContext('2d').drawImage(p.canvas,sx,sy,size,size,0,0,size,size);
  /* Only a key is worth deleting; a data: URL was never uploaded. */
  const stale=(sh.img&&!/^data:/.test(sh.img))?sh.img:null;
  sh.img=cv.toDataURL('image/jpeg',0.82); sh.failed=false;
  renderOverlay(); if(announce) toast(t('Photo added 📸'));
  const u=currentUser(); if(!u) return;
  sh.uploading=true; renderOverlay();
  cv.toBlob(blob=>{
    if(!blob){ if(ui.create===c){sh.uploading=false; renderOverlay();} return; }
    uploadImage(blob,'image/jpeg').then(key=>{
      if(ui.create!==c) return;   // sheet was closed/reset meanwhile
      sh.img=key; sh.uploading=false; sh.failed=false; renderOverlay();
      /* Deleted only now, and only on the sheet that owns it: if the
         post went out in the meantime it went out holding `stale`. */
      if(stale) deleteImage(stale);
    }).catch(err=>{
      console.warn('upload failed',err);
      if(ui.create===c){ sh.uploading=false; sh.failed=true; renderOverlay(); }
      /* 429 from upload-url is the rate limit (step 1b.1), not a
         failure to retry — "tap Post to retry" is the one instruction
         that makes a rate limit worse. */
      toast(/too many photos/i.test((err&&err.message)||'')
        ? t('That is a lot of photos at once. Give it a minute.')
        : t('That photo did not upload. Tap Post to retry.'));
    });
  },'image/jpeg',0.82);
}

/* `mode` is 'replace' (the camera and gallery buttons, which act on the
   photo currently shown) or 'add' (the ＋ tile). */
function handleUpload(file, mode){
  if(!file.type||!file.type.startsWith('image/')){toast(t('That file is not an image')); return;}
  syncCreate();
  const c=ui.create;
  if(mode==='add'){
    if(shots(c).length>=photoLimit(state.me.premium)){
      if(!state.me.premium){ openPremium(t('Up to three photos on a pour')); return; }
      toast(t('Three photos is the most a pour can carry')); return;
    }
  }
  const reader=new FileReader();
  reader.onload=ev=>{const img=new Image();
    img.onload=()=>{
      /* Downscale on the SHORT side: what gets uploaded is the square,
         and the square is min(w,h). The cap on the long side is only
         there so a panorama cannot hold 40 MP of canvas in memory on a
         phone to hand back a 1080px crop. */
      let w=img.width,h=img.height;
      const s=Math.min(1, 1080/Math.min(w,h), 3000/Math.max(w,h));
      w=Math.max(1,Math.round(w*s)); h=Math.max(1,Math.round(h*s));
      const src=document.createElement('canvas'); src.width=w; src.height=h;
      src.getContext('2d').drawImage(img,0,0,w,h);
      /* The sheet may have been closed, or reset, between choosing the
         file and the browser handing over its bytes. */
      if(ui.create!==c) return;
      const adjustable=isAdjustable(w,h);
      let focus=0.5;
      if(adjustable){
        try{ const l=lumaOf(src); focus=pickFocus(l.luma,l.w,l.h); }
        catch(err){ console.warn('framing fell back to centre',err); }
      }
      let sh=mode==='replace'?shotAt(c):null;
      if(sh){ sources.delete(sh.sid); }
      else { sh={sid:0,img:null,preview:'',uploading:false,failed:false}; c.photos.push(sh); c.photoI=c.photos.length-1; }
      sh.sid=++sidN; sh.w=w; sh.h=h; sh.focus=focus; sh.adjustable=adjustable;
      /* The preview is the whole photo — the square is CSS, and CSS is
         what makes the drag live. */
      sh.preview=src.toDataURL('image/jpeg',0.82);
      sources.set(sh.sid,{owner:c,canvas:src});
      bakeAndUpload(c,sh,true);
    };
    img.onerror=()=>toast(t('That image could not be read')); img.src=ev.target.result;};
  reader.onerror=()=>toast(t('That file could not be read'));
  reader.readAsDataURL(file);
}

/* Taking one back out. The R2 object is deleted only if it landed —
   an upload still in flight is left alone rather than raced, and the
   orphan it may leave behind is cheaper than deleting a key the
   in-flight PUT is about to write. */
function removeShot(i){
  syncCreate();
  const c=ui.create, sh=shots(c)[i]; if(!sh) return;
  c.photos.splice(i,1);
  if(c.photoI>=c.photos.length) c.photoI=Math.max(0,c.photos.length-1);
  sources.delete(sh.sid);
  if(sh.img&&!/^data:/.test(sh.img)&&!sh.uploading) deleteImage(sh.img);
  renderOverlay();
}

/* ---------- reframing by hand ----------
   The proposal from pickFocus() is a guess about where the coffee is,
   and a guess owes the person an override. Dragging the preview moves
   the crop under the finger; only the <img>'s object-position changes
   during the drag, so this never repaints the sheet (which would
   destroy the element mid-gesture). The bake and the re-upload wait
   for the finger to come off. */
let frameDrag=null;
document.addEventListener('pointerdown',e=>{
  const el=e.target.closest('.create-prev img.frameable'); if(!el) return;
  const c=ui.create, sh=c&&shotAt(c); if(!sh||!sh.adjustable) return;
  const r=el.getBoundingClientRect();
  frameDrag={el,c,sh,x:e.clientX,y:e.clientY,box:Math.min(r.width,r.height),start:sh.focus,moved:false};
  if(el.setPointerCapture) try{ el.setPointerCapture(e.pointerId); }catch(err){}
});
document.addEventListener('pointermove',e=>{
  const d=frameDrag; if(!d) return;
  if(e.cancelable) e.preventDefault();
  d.moved=true;
  d.sh.focus=focusAfterDrag(d.sh.w,d.sh.h,d.start,e.clientX-d.x,e.clientY-d.y,d.box);
  d.el.style.objectPosition=objectPosition(d.sh.w,d.sh.h,d.sh.focus);
});
function endFrameDrag(){
  const d=frameDrag; if(!d) return; frameDrag=null;
  if(!d.moved || Math.abs(d.sh.focus-d.start)<0.005 || ui.create!==d.c) return;
  bakeAndUpload(d.c,d.sh,false);
}
document.addEventListener('pointerup',endFrameDrag);
document.addEventListener('pointercancel',endFrameDrag);

/* ============================================================ PREMIUM */
/* The offer sheet, opened by whatever was just reached for. `feature` is
   the name of that thing and goes at the top of the sheet — an offer
   that answers the tap lands better than one that recites a feature
   list at someone who was trying to do something else.

   The form underneath is harvested first, for the same reason
   openPicker() does it: renderOverlay() paints only the top of the
   stack, so pushing this sheet destroys the DOM of the one below, and
   a half-typed caption or a half-edited profile would go with it.
   Being asked to pay attention to an offer and losing your work to it
   is the worst possible first impression of a paid tier. */
function openPremium(feature){
  if($('#c-caption')) syncCreate();
  else if($('#sp-name')) syncSettings();
  ui.premium={ err:'', busy:false };
  pushOv({ type:'premium', feature:feature||'' });
}

/* Redeeming. The code is checked here first so a typo is answered
   instantly and offline, and then again in Postgres, which is the check
   that actually decides — see redeem_premium() in step-1.21.sql. The
   local pass is a message; the remote one is the lock.

   Signed in by construction — guestWall() raises the sign-in sheet for
   this action, because Premium is a column on a profile row and there
   is no row without an account. The check below is for the case where
   the session expired between opening the sheet and typing. */
async function redeemCode(inputId){
  const el=$('#'+inputId);
  const code=(el?el.value:'').trim();
  if(!ui.premium) ui.premium={err:'',busy:false};
  if(!code){ ui.premium.err=t('Type the code you were sent.'); renderOverlay(); return; }
  if(!codeValid(code)){
    ui.premium.err=t('That code is not right. Check it against the mail, or ask for a new one.');
    renderOverlay(); return;
  }
  const u=currentUser();
  if(!u){ ui.premium.err=t('Sign in first — Premium lives on your account.'); renderOverlay(); return; }
  ui.premium.busy=true; ui.premium.err=''; renderOverlay();
  try{
    const ok=await redeemPremium(code);
    if(!ok){ ui.premium.busy=false; ui.premium.err=t('That code is not right. Check it against the mail, or ask for a new one.'); renderOverlay(); return; }
    state.me.premium=true; save(); applyMe();
    ui.premium={err:'',busy:false};
    /* Straight out of the sheet and back to what raised it, already
       unlocked — a confirmation screen here would be one more tap
       between someone and the thing they asked for. */
    if((ui.ovStack[ui.ovStack.length-1]||{}).type==='premium') popOv();
    else renderOverlay();
    renderView();
    toast(t('Premium unlocked ✦'));
  }catch(err){
    console.warn('redeem failed',err);
    ui.premium.busy=false;
    ui.premium.err=t('That did not go through. Check your connection and try again.');
    renderOverlay();
  }
}

function premiumOff(){
  state.me.premium=false; save(); applyMe(); renderOverlay(); renderView();
  toast(t('Premium turned off'));
  const u=currentUser();
  if(u) dropPremium(u.id).catch(err=>console.warn('premium sync failed',err));
}

/* ---------- the week card ----------
   Premium, and gated here rather than only in the markup: the row on
   the profile is one way in, but a deep link or a stale repaint is
   another, and the check belongs where the door is. */
/* Exported as well as routed: the Sunday notification deep-links to
   `#recap`, and app.js opens the card the same way the profile row
   does — including the Premium sheet for an account that cannot see it
   yet, rather than a silent no-op. */
export function openRecap(){
  if(!state.me.premium){ openPremium(t('Your week in coffee')); return; }
  pushOv({ type:'recap' });
  fillRecap();
}

/* Everything the card wants that isn't already in the browser: the
   standout photos as embeddable bytes, and where the week stands among
   everyone else's. Both repaint the sheet when they land and neither is
   waited on — the card is drawn and shareable before either arrives,
   with a generated cup where a photo will go and a different tile where
   the standing will. See loadShotPhotos() and loadStanding(). */
function repaintRecap(){
  if((ui.ovStack[ui.ovStack.length-1]||{}).type==='recap') renderOverlay();
}
function fillRecap(){
  const r=weekRecap(); if(!r) return;
  loadShotPhotos(r).then(repaintRecap).catch(err=>console.warn('recap photos failed',err));
  loadStanding(r).then(repaintRecap).catch(err=>console.warn('recap standing failed',err));
}

/* Which pours the card holds up. Repaints straight away — the SVG
   redraws with the cup until the new photo is read, which takes a
   moment and must not make the tap feel unanswered. */
function pickStandout(id){
  const r=weekRecap(); if(!r||!id) return;
  toggleRecapPick(r.key,id);
  renderOverlay();
  fillRecap();
}

/* Share the card as a PNG. `navigator.share` with a file is the phone
   path — it hands the image straight to Instagram's composer, which is
   where this is going — and a download is the desktop one. canShare()
   is asked about the actual file rather than assumed: Firefox and most
   desktop browsers have navigator.share but refuse files, and a share
   that silently does nothing is worse than a download that works.

   Nothing is uploaded. The card is drawn, rasterised and shared from
   the device, which is also why it can say so on the sheet. */
async function shareRecap(){
  const r=weekRecap(); if(!r) return;
  const name=`crema-week-${new Date().toISOString().slice(0,10)}.png`;
  try{
    /* Awaited rather than read: the sheet may have been shared before
       the photos finished, and the file people keep should not be the
       one that lost the race. Already-loaded pours resolve instantly. */
    const photos=await loadShotPhotos(r);
    const svg=recapSVG(r,state.me,photos,weekStanding(r));
    const blob=await recapPNG(svg);
    const file=new File([blob],name,{type:'image/png'});
    /* Counted only where the card actually left — after the share
       sheet resolved, and not at all when it was cancelled. An export
       count that includes the ones nobody sent would be a worse number
       than none, since the whole point of it is to say whether the loop
       turns. Fire-and-forget: the card is already gone. */
    const u=currentUser();
    if(navigator.canShare&&navigator.canShare({files:[file]})){
      try{ await navigator.share({files:[file],title:t('Your week in coffee')}); }
      catch(err){ if(err&&err.name==='AbortError') return; throw err; }
      if(u) logRecapExport(u.id, r.key, 'share');
      return;
    }
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
    if(u) logRecapExport(u.id, r.key, 'download');
    toast(t('Saved as a picture 📸'));
  }catch(err){
    console.warn('recap share failed',err);
    toast(t('That card would not save. Try again.'));
  }
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
  if(!file.type||!file.type.startsWith('image/')){ toast(t('That file is not an image')); return; }
  if(!currentUser()){ toast(t('Sign in to add a photo')); return; }
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
          toast(t('Photo updated 📸'));
          /* only once the row points at the new one — an orphan in R2 is
             cheap, a profile pointing at a deleted object is not */
          if(previous) deleteImage(previous);
        }catch(err){
          console.warn('avatar upload failed',err);
          ui.avatarBusy=false; renderOverlay();
          toast(err&&/step-1\.13/.test(err.message||'') ? t('Profile photos are not switched on yet') : t('That photo did not upload. Try again.'));
        }
      },'image/jpeg',0.85);
    };
    img.onerror=()=>toast(t('That image could not be read'));
    img.src=ev.target.result;
  };
  reader.onerror=()=>toast(t('Could not read that file'));
  reader.readAsDataURL(file);
}
async function dropAvatar(){
  const previous=state.me.avatar||''; if(!previous) return;
  syncSettings();
  const u=currentUser(); if(!u){ toast(t('Sign in first')); return; }
  ui.avatarBusy=true; renderOverlay();
  try{
    await pushAvatar(u.id,null);
    state.me.avatar=''; save(); applyMe();
    ui.avatarBusy=false; renderOverlay(); renderView();
    toast(t('Back to your initials'));
    deleteImage(previous);
  }catch(err){
    console.warn('avatar removal failed',err);
    ui.avatarBusy=false; renderOverlay();
    toast(t('That photo did not come off. Try again.'));
  }
}

/* Optimistic writes: mutate, repaint, then persist. If the network says
   no, put it back and say so — never leave the UI showing a lie. */
function paintLike(p){
  $$('[data-action="like"][data-id="'+p.id+'"]').forEach(b=>{b.classList.toggle('liked',p.likedByMe); b.innerHTML=icon(p.likedByMe?'heartF':'heart',22)+' <span class="cnt">'+fmt(p.likes)+'</span>';});
}
/* The heart that blooms over the photo. Every copy on screen gets it:
   the feed card and the open post sheet can both be showing this pour,
   and they used to share one `id`, so the animation was as likely to
   play on the hidden one as on the one being looked at. */
function popHeart(id){
  $$('[data-hp="'+id+'"]').forEach(hp=>{ hp.classList.remove('go'); void hp.offsetWidth; hp.classList.add('go'); });
}
function toggleLike(id){
  const p=findPost(id); if(!p) return;
  /* Liking your own pour is refused by RLS (step-1.10.sql); the button
     isn't rendered either, so this only guards a stray dispatch. */
  if(p.user==='me'){ toast(t('You cannot like your own pour')); return; }
  p.likedByMe=!p.likedByMe; p.likes+=p.likedByMe?1:-1; save();
  paintLike(p);
  if(p.likedByMe) popHeart(id);
  const u=currentUser(); if(!u) return;
  const want=p.likedByMe;
  (want?social.like(u.id,id):social.unlike(u.id,id)).catch(err=>{
    if(err.status===409) return;                    // already liked; local state is right
    console.warn('like failed',err);
    p.likedByMe=!want; p.likes+=want?-1:1; save(); paintLike(p);
    toast(t('That like did not save'));
  });
}
/* Reactions repaint their own row rather than the whole card: the card
   carries a photo, and swapping its HTML to change a chip makes the
   image blink. Every copy of the row in the DOM is patched, because the
   feed and the open post sheet can both be showing this pour. */
function paintReactions(p){
  $$('[data-reacts="'+p.id+'"]').forEach(el=>el.outerHTML=reactionBar(p));
}
/* Same idea for the number beside the speech bubble, which the feed and
   the open sheet can both be showing. The sheet's own heading is patched
   by refreshOpenThread(), because only it knows the thread is loaded. */
function paintCommentCount(p){
  const n=p.commentN!=null?p.commentN:p.comments.length;
  $$('[data-cmtn="'+p.id+'"]').forEach(el=>{ el.textContent=n; });
}
function toggleReaction(id,kind){
  const p=findPost(id); if(!p||!kind) return;
  /* Refused by RLS as well (step-1.19.sql); the buttons aren't rendered
     on your own pour either, so this only guards a stray dispatch. */
  if(p.user==='me'){ toast(t('Reactions are for other people\'s coffee')); return; }
  if(!p.reactions) p.reactions=noReactions();
  if(!p.myReactions) p.myReactions=[];
  const had=p.myReactions.indexOf(kind)>=0;
  if(had) p.myReactions=p.myReactions.filter(k=>k!==kind);
  else p.myReactions=p.myReactions.concat(kind);
  p.reactions[kind]=Math.max(0,(p.reactions[kind]|0)+(had?-1:1));
  save(); paintReactions(p);

  const u=currentUser(); if(!u) return;
  (had?unreact(u.id,id,kind):react(u.id,id,kind)).catch(err=>{
    if(err.status===409) return;                    // already there; local state is right
    console.warn('reaction failed',err);
    if(had) p.myReactions=p.myReactions.concat(kind);
    else p.myReactions=p.myReactions.filter(k=>k!==kind);
    p.reactions[kind]=Math.max(0,(p.reactions[kind]|0)+(had?1:-1));
    save(); paintReactions(p); toast(t('That reaction did not save'));
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
  toast(p.saved?t('Saved to your collection 🔖'):t('Removed from saved'));
  const u=currentUser(); if(!u) return;
  const want=p.saved;
  (want?social.savePost(u.id,id):social.unsavePost(u.id,id)).catch(err=>{
    if(err.status===409) return;
    console.warn('save failed',err);
    p.saved=!want;
    if(p.saved){ if(!saved.list.some(x=>x.id===p.id)) saved.list.unshift(p); }
    else saved.list=saved.list.filter(x=>x.id!==p.id);
    save(); paintSave(p); toast(t('Your collection did not update'));
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
  toast(undo ? (wasPending?t('Request withdrawn'):t('Unfollowed')) : t('Follow request sent to {who}',{who}));

  const u=currentUser(); if(!u) return;
  (undo?social.unfollow(u.id,id):social.follow(u.id,id)).catch(err=>{
    if(err.status===409) return;
    console.warn('follow failed',err);
    state.follows[id]=wasFollowing; state.followPending[id]=wasPending;
    save(); paintFollow(id); toast(t('That follow did not update'));
  });
}

/* Letting someone in. The notification back to them is a trigger's job
   (step-1.15.sql), not this function's — the client saying "they
   accepted you" would be a client that could say it without accepting. */
async function acceptFollow(id){
  const u=currentUser(); if(!u) return;
  const req=storeSocial.requests.find(r=>r.id===id); if(!req) return;
  const first=(req.user.name||'They').split(' ')[0];
  const wasFollowing=!!state.follows[id], wasPending=!!state.followPending[id];

  storeSocial.requests=storeSocial.requests.filter(r=>r.id!==id);
  storeSocial.counts.followers=(storeSocial.counts.followers|0)+1;
  if(storeSocial.listsLoaded && !storeSocial.followers.some(x=>x.id===id)) storeSocial.followers.push(req.user);
  /* Accepting is mutual now (step-1.19.sql): the database writes the
     follow back, so the local world has to agree the moment the tap
     lands, or their profile and the Following tab stay locked until the
     next reload of something that happens to refetch the graph. */
  if(!wasFollowing){
    state.follows[id]=true; state.followPending[id]=false;
    storeSocial.counts.following=(storeSocial.counts.following|0)+1;
    if(storeSocial.listsLoaded && !storeSocial.following.some(x=>x.id===id)) storeSocial.following.push(req.user);
  }
  save(); renderView(); renderAppbar();
  toast(wasFollowing ? t('{name} can see your pours now',{name:first}) : t('You and {name} now follow each other',{name:first}));
  try{
    await whileAnsweringRequest(()=>social.acceptFollow(u.id,id));
    /* they can see followers-only pours from here on, and so do we —
     so the feed they are in is not the feed we already have */
    if(await loadFeed()) renderView();
  }catch(err){
    console.warn('accept failed',err);
    storeSocial.requests.unshift(req);
    storeSocial.counts.followers=Math.max(0,(storeSocial.counts.followers|0)-1);
    storeSocial.followers=storeSocial.followers.filter(x=>x.id!==id);
    if(!wasFollowing){
      state.follows[id]=wasFollowing; state.followPending[id]=wasPending;
      storeSocial.counts.following=Math.max(0,(storeSocial.counts.following|0)-1);
      storeSocial.following=storeSocial.following.filter(x=>x.id!==id);
    }
    save(); renderView(); toast(t('That did not go through. Try again.'));
  }
}

async function declineFollow(id){
  const u=currentUser(); if(!u) return;
  const req=storeSocial.requests.find(r=>r.id===id); if(!req) return;
  storeSocial.requests=storeSocial.requests.filter(r=>r.id!==id);
  renderView(); renderAppbar(); toast(t('Request declined'));
  try{ await whileAnsweringRequest(()=>social.declineFollow(u.id,id)); }
  catch(err){
    console.warn('decline failed',err);
    storeSocial.requests.unshift(req); renderView();
    toast(t('That did not go through. Try again.'));
  }
}
/* Opening a post loads its thread. The feed only carries a count, so
   the comment bodies are fetched on demand rather than with every card. */
/* Exported for app.js: a deep link (#p/<id>, or a tapped notification)
   opens the same sheet the feed does, and has to load the same thread
   with it. Pushing the overlay descriptor alone leaves a post that has
   comments sitting on "Loading comments…" for good — which is the first
   thing a stranger arriving from a shared link would see. */
export async function openPost(id){
  pushOv({type:'post',id});
  /* A guest opens the same sheet with the same thread — comments and
     reactions are public rows, and a pour with its conversation cut off
     is the least persuasive version of itself. `u` being null only
     costs the parts that are per-viewer. */
  const u=currentUser();
  const p=findPost(id); if(!p) return;
  /* Still showing this post? Everything below is a round trip, and the
     sheet can be gone by the time one lands. */
  const showing=()=>{ const top=ui.ovStack[ui.ovStack.length-1]; return top&&top.type==='post'&&top.id===id; };

  /* A pour reached from the podium, a notification or someone's grid
     never went through a feed page, so its reaction tally is still the
     empty one postOf() gave it. */
  await hydrateReactions([p]);
  if(showing()) renderOverlay();

  if(p.comments.length) return;
  try{
    const rows=await social.fetchComments(id);
    p.comments=rows.map(r=>social.commentOf(r,u?u.id:null));
    p.commentN=p.comments.length;
    if(u){
      const mine=new Set(await social.fetchMyCommentLikes(rows.map(r=>r.id)));
      p.comments.forEach(c=>{ c.likedByMe=mine.has(c.id); });
    }
    if(showing()) renderOverlay();
    /* A mention only becomes a link once we know whose handle it is, and
       the thread can name people who are nowhere else on this screen.
       After the paint, because a comment reads the same either way and
       nobody should wait on it. */
    if(await resolveHandles(mentionedHandles(p.comments)) && showing()) renderOverlay();
  }catch(e){ console.warn('comments failed',e); }
}

function addComment(id){
  const inp=$('#cmt-input'); if(!inp) return; const text=inp.value.trim(); if(!text) return;
  const p=findPost(id); if(!p) return;
  const c={u:'me',t:text,ago:'now',likes:0};
  p.comments.push(c); if(p.commentN!=null) p.commentN++; save();
  const list=$('#cmt-list'); if(list){if(list.querySelector('.empty')) list.innerHTML=''; list.insertAdjacentHTML('beforeend',commentRow(c,p.id,p.comments.length-1));}
  inp.value=''; paintMentions(null); toast(t('Comment added 💬'));
  const u=currentUser(); if(!u) return;
  social.addComment(u.id,id,text)
    .then(row=>{ if(row) c.id=row.id; refreshChallenges(); })
    .catch(err=>{
      console.warn('comment failed',err);
      const i=p.comments.indexOf(c); if(i>=0) p.comments.splice(i,1);
      if(p.commentN!=null) p.commentN--;
      renderOverlay();
      toast(/too many comments/i.test(err.message)?t('Slow down a moment. That is too many comments at once.'):t('That comment did not post'));
    });
}

function toggleCafeFollow(id){
  const on=state.cafeFollow[id]=!state.cafeFollow[id]; save(); renderOverlay();
  toast(on?t('Following café ☕'):t('Unfollowed'));
  const u=currentUser(); if(!u) return;
  (on?social.followCafe(u.id,id):social.unfollowCafe(u.id,id)).catch(err=>{
    if(err.status===409) return; console.warn('cafe follow failed',err);
    state.cafeFollow[id]=!on; save(); renderOverlay(); toast(t('That follow did not update'));
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
    toast(won===1&&c?t('Challenge complete: {title} · +{n} 🎯',{title:c.title,n:c.points}):t('{n} challenges complete 🎯',{n:won}));
    refreshScore();
  }
}

/* ---------- moderation ---------- */
async function sendReport(postId,reason){
  popOv();
  const u=currentUser();
  if(!u){ toast(t('Sign in to report a pour')); return; }
  try{ await social.report(u.id,{ postId, reason }); toast(t('Reported. Thanks for keeping Crema kind 🙏')); }
  catch(e){ console.warn('report failed',e); toast(t('That report did not send. Try again.')); }
}

/* ---------- moderation ----------
   Opening the sheet always starts on Open and always refetches. A queue
   is the one screen where a stale list is worse than a spinner: it is
   read to decide what still needs doing. */
function openAdmin(){
  admin.tab='open'; admin.loaded=false; admin.err=''; admin.list=[]; admin.log=[];
  pushOv({type:'admin'});
  loadQueue().then(()=>renderOverlay());
}

/* One handler for every button on a report card.

   The guard worth reading twice is the statement swap. The box is
   prefilled with the sentence for *hiding*, because that is the action
   a moderator reaches for most — so tapping Remove or Pause with the
   box untouched would send somebody a notice saying their pour was
   hidden when in fact it is gone, or their account paused with an
   explanation about a single pour. When that happens the right draft is
   swapped in and nothing is done yet: the moderator reads what they are
   about to send and taps again. Two taps for the irreversible ones is
   the correct number. */
async function modAct(el){
  const d=el.dataset, isComment=d.t==='comment';
  const box=$('#mod-st-'+d.id);
  const statement=((box&&box.value)||'').trim();
  const reason=d.reason||'our content rules';
  const filled=mod.statementFor(isComment?'hide_comment':'hide_post',{ reason });

  if((d.k==='remove'||d.k==='suspend') && box && statement===filled.trim()){
    box.value = d.k==='suspend'
      ? mod.statementFor('suspend_user',{ reason, days:7 })
      : mod.statementFor(isComment?'delete_comment':'delete_post',{ reason });
    box.focus();
    toast('That said “hidden”. Read the new wording, then tap again.');
    return;
  }
  if(d.k!=='dismiss' && d.k!=='unhide' && !statement){
    toast('Say why. That sentence is what they are sent.');
    if(box) box.focus();
    return;
  }
  if(d.k==='remove' && !confirm('Remove this for good? The row goes. The photo stays in R2 — the audit log keeps its key so you can delete the object.')) return;
  if(d.k==='suspend' && !confirm('Pause this account for seven days? They can still read Crema; they cannot post or comment.')) return;

  admin.busy=d.id;
  try{
    if(d.k==='hide')          await (isComment ? mod.hideComment(d.tid,reason,statement,d.id)
                                               : mod.hidePost(d.tid,reason,statement,d.id));
    else if(d.k==='unhide')   await (isComment ? mod.unhideComment(d.tid,'restored on review',null,d.id)
                                               : mod.unhidePost(d.tid,'restored on review',null,d.id));
    else if(d.k==='remove')   await (isComment ? mod.deleteComment(d.tid,reason,statement,d.id)
                                               : mod.deletePost(d.tid,reason,statement,d.id));
    else if(d.k==='suspend')  await mod.suspendUser(d.uid,7,reason,statement,d.id);
    else if(d.k==='dismiss')  await mod.dismissReport(d.id,'no violation found');
    toast(d.k==='dismiss' ? 'Left up, and recorded.' : 'Done, recorded, and they have been told.');

    await loadQueue(); renderOverlay();
    /* The feed on the screen behind still holds the pour that was just
       hidden or removed. Refetched rather than patched: the server
       decides what is visible now, and it is the only thing that knows. */
    if(d.k!=='dismiss') loadFeed().then(()=>renderView()).catch(()=>{});
  }catch(e){
    console.warn('moderation action failed',e);
    toast(e&&e.needsMigration ? 'That needs step-1.27.sql, which has not been run.'
         : e&&e.notAdmin      ? 'This account is not an admin.'
         : 'That did not go through. Nothing was changed.');
  }
  finally{ admin.busy=''; }
}

async function blockUser(uid){
  const u=currentUser();
  if(!u){ toast(t('Sign in to block someone')); return; }
  const who=(userOf(uid).name||'this person').split(' ')[0];
  if(!confirm(t('Block {who}? You will not see their pours, and they are never told.',{who}))) return;
  popOv();
  try{
    await social.block(u.id,uid);
    storeSocial.blocks.push(uid);
    state.follows[uid]=false; save();
    await loadFeed(); ui.ovStack=[]; render();
    toast(t('Blocked {who}',{who}));
  }catch(e){
    if(e.status===409){ toast(t('{who} is already blocked',{who})); return; }
    console.warn('block failed',e); toast(t('That block did not go through. Try again.'));
  }
}

async function deleteMyPost(id){
  if(!confirm(t('Delete this pour? This cannot be undone.'))) return;
  popOv();
  const p=findPost(id); if(!p) return;
  const i=state.posts.indexOf(p); if(i>=0) state.posts.splice(i,1);
  const j=mine.list.indexOf(p); if(j>=0) mine.list.splice(j,1);
  ui.ovStack=[]; save(); render(); toast(t('Pour deleted'));
  const u=currentUser(); if(!u) return;
  deletePost(id).then(()=>{ deleteImage(p.img); refreshScore(); refreshChallenges(); }).catch(err=>{
    console.warn('delete failed',err);
    if(i>=0) state.posts.splice(i,0,p);
    if(j>=0) mine.list.splice(j,0,p);
    save(); render(); toast(t('That did not delete. The pour is still there.'));
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
  if(!canEdit(p)){ popOv(); toast(t('Pours can only be edited on the day you posted them')); return; }
  const r=p.recipe||{}, c=freshCreate();
  const cafe=p.cafe?CAFES.find(x=>x.name===p.cafe):null;
  Object.assign(c,{
    /* The photos ride along read-only: an edit rewrites what the author
       said, never what they shot (see EDITABLE in data/posts.js), so the
       sheet shows them and offers no way to change them. */
    editId:p.id, photos:(p.imgs&&p.imgs.length?p.imgs:(p.img?[p.img]:[]))
      .map(k=>({sid:0,img:k,preview:'',w:0,h:0,focus:.5,adjustable:false,uploading:false,failed:false})),
    photoI:0,
    /* the pour's own audience, not the remembered default */
    visibility:p.visibility==='followers'?'followers':'public',
    drink:p.drink||c.drink, pattern:p.art?(p.pattern||null):null,
    caption:p.caption||'', source:cafe?'cafe':'home', cafe:cafe?cafe.id:'',
    bean:r.bean||'',
    /* prefill from the post, never from the profile: an edit shows what
       was posted, not what you usually drink */
    milk:r.milk||'', dose:r.dose||'', yield:r.yield||'', time:r.time||'', temp:r.temp||'',
    machineBrand:'', machineModel:'',
    /* a pour that already carries a recipe should show it open, not hide
       what the person deliberately filled in the first time */
    recipeOpen:!!(r.bean||r.machine||r.dose||r.yield||r.time||r.temp)
  });
  if(r.machine&&!cafe){ const m=splitMachine(r.machine); c.machineBrand=m.brand; c.machineModel=m.model; }
  setCreate(c); ui.ovStack=[]; pushOv({type:'create'});
}

/* Optimistic like every other write here: the change is on screen before
   the request goes out, and every copy rolls back together if it fails. */
async function saveEdit(c){
  const p=findPost(c.editId);
  if(!p){ ui.ovStack=[]; render(); toast(t('That pour is gone')); return; }
  if(!canEdit(p)){ ui.ovStack=[]; render(); toast(t('Pours can only be edited on the day you posted them')); return; }
  const copies=postCopies(p.id);
  const KEYS=['drink','art','pattern','cafe','caption','recipe','edited','visibility'];
  const before=copies.map(x=>{ const o={}; KEYS.forEach(k=>o[k]=x[k]); return o; });
  const next={ ...composeFromSheet(c), edited:true };
  copies.forEach(x=>Object.assign(x,next));
  setCreate(null); ui.ovStack=[]; save(); render(); toast(t('Changes saved'));

  if(!currentUser()) return;
  /* An edit can move the score now: filling in dose and yield earns the
     exact-recipe points, and naming a coffee you've never logged earns
     the new-bean ones (step-1.14.sql). */
  try{ await updatePost(p.id,p); refreshScore(); }
  catch(err){
    console.warn('edit failed',err);
    copies.forEach((x,i)=>Object.assign(x,before[i]));
    save(); render(); toast(t('That did not save. The pour is unchanged.'));
  }
}

function brewAgain(id){
  const p=findPost(id); if(!p) return; const r=p.recipe||{};
  setCreate(freshCreate());
  Object.assign(ui.create,{drink:p.drink||ui.create.drink, pattern:p.pattern||ui.create.pattern,
    bean:r.bean||'', milk:r.milk||ui.create.milk,
    dose:r.dose||'', yield:r.yield||'', time:r.time||'', temp:r.temp||'',
    recipeOpen:!!(r.bean||r.machine||r.dose||r.yield||r.time||r.temp)});
  /* The recipe stores one combined "Brand Model" string; the picker needs
     the two halves back or it silently falls back to your own machine. */
  if(r.machine){ const m=splitMachine(r.machine); ui.create.machineBrand=m.brand; ui.create.machineModel=m.model; }
  ui.ovStack=[]; pushOv({type:'create'}); toast(t('Recipe loaded. Brew it again ☕'));
}
function sharePost(id){
  const p=findPost(id); if(!p) return; const link=postLink(id);
  if(navigator.share){ navigator.share({title:'Crema',text:(p.caption||t('A pour on Crema')),url:link}).catch(()=>{}); }
  else copyText(link,t('Link copied 🔗'));
}
function copyText(text,msg){
  const done=()=>toast(msg||t('Copied ✓'));
  if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(done).catch(()=>fallbackCopy(text,done)); }
  else fallbackCopy(text,done);
}
function fallbackCopy(text,done){
  try{const ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done();}
  catch(e){toast(t('Copying is not available here. Long-press the post instead.'));}
}
/* A photo belongs in R2, never in the row. `image_key` holds an object
   key; a data: URI there is 300 KB shipped to every viewer on every feed
   load, and Postgres now rejects it outright (step-1.11.sql). So if the
   background upload didn't land, retry it here and say so if it fails —
   rather than posting something the database will refuse. */
async function ensureUploaded(c){
  const pending=shots(c).filter(sh=>sh.img&&/^data:/.test(sh.img));
  if(!pending.length) return true;
  if(!currentUser()) return true;
  pending.forEach(sh=>{ sh.uploading=true; sh.failed=false; }); renderOverlay();
  /* Sequential, not Promise.all: three presigned PUTs at once from a
     phone on a bad morning connection is how all three time out
     together. One failure stops the run — the post is not going out
     either way, and the ones already up are still up. */
  for(const sh of pending){
    try{
      const blob=await (await fetch(sh.img)).blob();
      const key=await uploadImage(blob, blob.type||'image/jpeg');
      sh.img=key; sh.uploading=false;
      if(ui.create===c) renderOverlay();
    }catch(e){
      console.warn('upload retry failed',e);
      pending.forEach(x=>{ if(x.uploading){ x.uploading=false; } });
      sh.failed=true;
      if(ui.create===c) renderOverlay();
      toast(tn(pending.length,'The photo still will not upload. Remove it to post without one.',
                               'A photo still will not upload. Remove it to post without it.'));
      return false;
    }
  }
  return true;
}

/* What the sheet's fields mean, in one place, because the create and the
   edit path have to agree on it exactly — a rule applied on one path and
   not the other is how an edit silently drops someone's recipe. */
function composeFromSheet(c){
  const T=v=>(v||'').trim();
  let drink=c.drink===ADD_DRINK?(state.me.premium?T(c.drinkCustom):''):T(c.drink);
  if(c.drink===ADD_DRINK && state.me.premium && drink && !DRINKS.includes(drink)) rememberOwn('drink',drink);
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
    /* The bean/machine/dose/yield/time/temp block is opt-in (see
       recipeOpen in freshCreate) — someone who never opened it never
       agreed to post that detail, even if their profile has a default
       machine sitting there from a past pour. */
    if(c.recipeOpen){
      /* A coffee the catalogue has never heard of is still the coffee they
         drank — it is kept, and kept on their own list so the picker offers
         it back tomorrow. Free: see the note in data/catalog.js. */
      const bean=T(c.bean);
      if(bean && !BEANS.some(b=>b.n===bean)) rememberOwn('bean',bean);
      if(bean) recipe.bean=bean;
      /* A bag of coffee outlasts a single pour, so the next create sheet
         opens on this one already chosen (freshCreate). Only pours you
         made yourself count — a café's bean is theirs, not what's on your
         shelf. Posting without a bean leaves the memory alone: the last
         coffee you actually used is still the last one you used. */
      if(bean) state.lastBean=bean;
      const machine=combineMachine(c.machineBrand,c.machineModel);
      if(machine) recipe.machine=machine;
      if(T(c.dose)) recipe.dose=T(c.dose);
      if(T(c.yield)) recipe.yield=T(c.yield);
      if(T(c.time)) recipe.time=T(c.time);
      if(T(c.temp)) recipe.temp=T(c.temp);
    }
    if(HAS_MILK.has(drink)&&c.milk) recipe.milk=c.milk;
  }
  const hasRecipe=Object.keys(recipe).length>0;
  return { drink, art:hasArt, pattern:hasArt?c.pattern:null,
           cafe:cafe?cafe.name:undefined, caption, recipe:hasRecipe?recipe:null,
           visibility: c.visibility==='followers' ? 'followers' : 'public' };
}

async function submitPost(){
  syncCreate(); const c=ui.create;
  if(c.editId){ saveEdit(c); return; }
  if(shotsBusy(c)){ toast(t('The photo is still uploading. One moment.')); return; }
  if(!(await ensureUploaded(c))) return;
  /* No optimistic "you won the morning" here, deliberately. Under
     step-1.30 the client could guess — your own first pour of the day is
     a fact about your own posts. Under step-1.31 the +20 goes to the
     first pour in ALL of Crema, and this device cannot know whether
     somebody in another kitchen was up twenty minutes ago. Guessing
     would mean congratulating people who did not win.

     So the race is announced the only way it honestly can be: by the
     server, as a `daily_champion` notification, which arrives over the
     Realtime socket within a second of the insert and reaches the phone
     even if the app is closed. refreshScore() below picks up the points
     either way. */
  /* The id is minted client-side so it never changes under us — the
     generated cup art is seeded from it, and so is the share link. */
  const u=currentUser();
  const keys=shotKeys(c);
  const np={ id:newPostId(), user:'me', ...composeFromSheet(c),
    /* No art score: nothing here can judge a pour, so nothing claims to.
       quality stays null and the generated cup art uses its own default. */
    quality:null, img:keys[0]||null, imgs:keys, ago:'now',
    createdAt:new Date().toISOString(),
    likes:0, likedByMe:false, saved:false, comments:[], commentN:0 };
  state.posts.unshift(np); mine.list.unshift(np); save();
  /* Land on the tab that will actually contain what you just posted: a
     followers-only pour never appears in Today. */
  ui.ovStack=[]; ui.route='home'; ui.filter=np.visibility==='followers'?'following':'today'; render();
  setTimeout(()=>toast(keys.length?t('Posted. Streak kept 🔥'):t('Posted ☕ · add a photo next time')),120);

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
    /* The database can refuse a pour for a reason that is not the
       network: check_post_rate() (step 1b.1) raises P0001 when ten
       land inside ten minutes. Telling somebody to check a connection
       that is working is how a rate limit turns into a bug report. */
    save(); render();
    toast(/too many pours|slow down/i.test((err&&err.message)||'')
      ? t('That was a lot of coffee at once. Give it a minute.')
      : t('That did not post. Check your connection and try again.'));
  });
}

/* ---------- theme ---------- */
const mqDark=matchMedia('(prefers-color-scheme: dark)');
export function applyTheme(){
  const th=state.theme||'auto';
  const dark = th==='dark' || (th==='auto' && mqDark.matches);
  document.documentElement.setAttribute('data-theme',dark?'dark':'light');
}
if(mqDark.addEventListener) mqDark.addEventListener('change',()=>{ if((state.theme||'auto')==='auto') applyTheme(); });

/* ---------- toast & clock ---------- */
let toastT;
export function toast(msg){const el=$('#toast'); el.innerHTML=msg; el.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('show'),1900);}
export function tick(){const d=new Date(); $('#clock').textContent=d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}
