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
import { $, $$, fmt } from '../core/util.js';
import { BACKEND } from '../config.js';
import { DRINK_ART, HAS_MILK, ADD_BEAN, BEANS, combineMachine, beanCatalog } from '../data/catalog.js';
import { USERS, CAFES, post } from '../data/seed.js';
import { signUp, signInWithPassword, signInWithOAuth, signOut, onAuthChange, currentUser } from '../data/supabase.js';
import { ensureProfile, pushProfile } from '../data/profiles.js';
import { createPost, deletePost, newPostId } from '../data/posts.js';
import { uploadImage, deleteImage } from '../data/media.js';
import * as social from '../data/social.js';
import * as chal from '../data/challenges.js';
import { markAllRead } from '../data/notifications.js';
import { state, ui, save, load, applyMe, findPost, freshCreate, clearSaved, useSession,
         loadFeed, loadMoreFeed, social as storeSocial, entryCache } from '../store/store.js';
import { commentRow, postLink, searchHTML } from './components.js';
import { icon } from './icons.js';
import { render, renderView, renderAppbar } from './views.js';
import { pushOv, popOv, renderOverlay } from './overlays.js';

/* ============================================================ ACTIONS */
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-action]'); if(!t) return;
  const a=t.dataset.action, id=t.dataset.id;
  switch(a){
    case 'nav': ui.route=t.dataset.r; ui.ovStack=[]; render(); break;
    case 'filter':{ if(ui.filter===t.dataset.f) break; ui.filter=t.dataset.f; renderView();
      /* signed in the Following tab is a different server query, not a
         client-side filter over one page */
      if(currentUser()) loadFeed().then(()=>renderView());
      break;}
    case 'open-post': openPost(id); break;
    case 'open-cafe': pushOv({type:'cafe',id}); break;
    case 'open-bean':{ if(BEANS.find(b=>b.n===id)) pushOv({type:'bean',id}); else toast('No details for that bean yet'); break;}
    case 'open-user':{ if(!id)break; if(id==='me'){ui.ovStack=[]; ui.route='profile'; render();} else pushOv({type:'user',id}); break;}
    case 'open-notifs':{ const had=state.notifications.some(n=>!n.read); state.notifications.forEach(n=>n.read=true); if(had){save(); renderAppbar();} pushOv({type:'notifs'});
      const u=currentUser(); if(u&&had) markAllRead(u.id).catch(err=>console.warn('mark read failed',err));
      break;}
    case 'notif-go':{ const n=state.notifications[+t.dataset.idx]; if(!n)break;
      if(n.post&&findPost(n.post)) pushOv({type:'post',id:n.post});
      else if(n.challenge) pushOv({type:'challenge',id:n.challenge});
      else if(n.cafe) pushOv({type:'cafe',id:n.cafe});
      else if(n.u) pushOv({type:'user',id:n.u}); break;}
    case 'open-menu': pushOv({type:'menu',id}); break;
    case 'open-tag': pushOv({type:'tag',id}); break;
    case 'open-challenge': openChallenge(id); break;
    case 'vote-entry': toggleVote(t.dataset.ch,id); break;
    case 'open-challenges': pushOv({type:'challenges'}); break;
    case 'open-board': pushOv({type:'board'}); break;
    case 'open-flist': pushOv({type:'flist',id}); break;
    case 'open-scoring': pushOv({type:'scoring'}); break;
    case 'open-settings': pushOv({type:'settings'}); break;
    case 'open-create': ui.create=freshCreate(); pushOv({type:'create'}); break;
    case 'close-ov': popOv(); break;
    case 'clear-search':{ ui.searchQ=''; renderView(); break;}

    case 'like': toggleLike(id); break;
    case 'save': toggleSave(id); break;
    case 'follow': toggleFollow(id); break;
    case 'follow-cafe': toggleCafeFollow(id); break;
    case 'recipe':{const el=$('#rp-'+id); if(el){el.classList.toggle('open'); const o=el.classList.contains('open'); t.innerHTML=t.innerHTML.replace(o?'▾':'▴',o?'▴':'▾');} break;}
    case 'join': toggleJoin(id); break;
    case 'ptab': ui.profTab=t.dataset.t; renderView(); break;

    case 'submit-entry': pushOv({type:'picker',id}); break;
    case 'pick-entry': pickEntry(t.dataset.ch,id); break;

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
    case 'brew': brewAgain(id); break;
    case 'directions':{ const c=CAFES.find(x=>x.id===id); if(!c)break;
      const url='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(c.name+', '+c.area+', '+c.city);
      let w=null; try{w=window.open(url,'_blank','noopener');}catch(err){}
      if(!w) copyText(url,'Maps link copied 🔗'); break;}

    case 'cafe-filter': ui.cafeF[t.dataset.f]=!ui.cafeF[t.dataset.f]; renderView(); break;
    case 'cpat':{ syncCreate(); ui.create.pattern=(ui.create.pattern===t.dataset.p)?null:t.dataset.p; renderOverlay(); break;}
    case 'csource':{ syncCreate(); ui.create.source=t.dataset.s; if(t.dataset.s==='home')ui.create.cafe=''; renderOverlay(); break;}
    case 'submit-post': submitPost(); break;

    case 'set-theme': state.theme=t.dataset.t; save(); applyTheme(); renderOverlay(); break;
    case 'save-profile':{ syncSettings();
      state.me.name=(state.me.name||'').trim(); state.me.city=(state.me.city||'').trim(); state.me.handle=(state.me.handle||'').trim();
      save(); applyMe(); popOv(); toast('Profile updated ✓');
      const u=currentUser(); if(u) pushProfile(u.id,state.me).catch(err=>console.warn('profile sync failed',err));
      break;}
    case 'toggle-premium': state.me.premium=!state.me.premium; save(); renderOverlay(); toast(state.me.premium?'Premium unlocked ✦':'Premium turned off'); break;

    case 'ob-next': syncOb(); ui.obStep=Math.min(3,(ui.obStep||1)+1); renderOverlay(); break;
    case 'ob-back': syncOb(); ui.obStep=Math.max(1,(ui.obStep||1)-1); renderOverlay(); break;
    case 'ob-follow': state.follows[id]=!state.follows[id]; save(); renderOverlay(); break;
    case 'ob-skip': case 'ob-finish': syncOb(); state.onboarded=true; save(); applyMe(); ui.ovStack=[]; render();
      toast(a==='ob-finish'?'Welcome to Crema ☕':'You can finish setup in Settings'); break;

    case 'open-auth': ui.auth={mode:'in',error:'',notice:'',busy:false,email:''}; pushOv({type:'auth'}); break;
    case 'auth-mode': syncAuth(); ui.auth.mode=ui.auth.mode==='up'?'in':'up'; ui.auth.error=''; ui.auth.notice=''; renderOverlay(); break;
    case 'auth-submit': doAuth(); break;
    case 'auth-oauth': doOAuth(t.dataset.p); break;
    case 'sign-out': doSignOut(); break;

    case 'reset': if(confirm('Reset the demo to its starting state?')) resetDemo(); break;
    case 'toast': toast(t.dataset.msg||'Coming soon'); break;
    default: break;
  }
});
document.addEventListener('keydown',e=>{ if(e.key!=='Enter') return;
  const t=e.target.closest('[data-enter]'); if(!t) return; e.preventDefault();
  if(t.dataset.enter==='add-cmt') addComment(t.dataset.id);
  else if(t.dataset.enter==='auth-submit') doAuth(); });
document.addEventListener('input',e=>{
  if(e.target.id==='search-input'){ ui.searchQ=e.target.value;
    const res=$('#explore-results'), normal=$('#explore-normal');
    if(res&&normal){ res.innerHTML=ui.searchQ?searchHTML(ui.searchQ):''; normal.style.display=ui.searchQ?'none':''; } }
});
document.addEventListener('change',e=>{
  const id=e.target.id;
  if(id==='c-photo-cam'||id==='c-photo-lib'){ if(e.target.files&&e.target.files[0]) handleUpload(e.target.files[0]); return; }
  if(id==='c-mbrand'){ syncCreate(); ui.create.machineModel=''; renderOverlay(); return; }
  if(id==='c-bean'){ syncCreate(); const cat=beanCatalog(ui.create.bean); if(cat) ui.create.roaster=cat.roaster; renderOverlay(); return; }
  if(id==='c-drink'||id==='c-cafe'){ syncCreate(); renderOverlay(); return; }
  if(id==='c-roaster'||id==='c-mmodel'||id==='c-mother'||id==='c-milk'){ syncCreate(); return; }
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
  if(/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Couldn\'t reach the server. You can keep using Crema without an account.';
  if(/Invalid login credentials/i.test(m)) return 'That email and password don\'t match.';
  if(/already registered/i.test(m)) return 'That email already has an account — sign in instead.';
  return m || 'Something went wrong. Try again.';
}

async function doAuth(){
  syncAuth();
  const a=ui.auth, email=(a.email||'').trim(), pw=($('#au-pw')||{}).value||'';
  if(!email||!pw){ a.error='Enter your email and a password.'; renderOverlay(); return; }
  a.busy=true; a.error=''; a.notice=''; renderOverlay();
  try{
    if(a.mode==='up'){
      const { confirmationRequired } = await signUp(email,pw);
      if(confirmationRequired){
        a.busy=false; a.mode='in';
        a.notice='Account created. Check your inbox to confirm the address, then sign in.';
        renderOverlay(); return;
      }
    } else {
      await signInWithPassword(email,pw);
    }
    /* success → onAuthChange below drives the reload and repaint */
  }catch(e){ a.busy=false; a.error=authError(e); renderOverlay(); }
}

async function doOAuth(provider){
  syncAuth(); ui.auth.busy=true; ui.auth.error=''; renderOverlay();
  try{ await signInWithOAuth(provider); }        // navigates away on success
  catch(e){ ui.auth.busy=false; ui.auth.error=authError(e); renderOverlay(); }
}

async function doSignOut(){
  await signOut();
  toast('Signed out — demo mode ☕');
}

/* Pull the profile row down (creating it from local state on first
   sign-in) and merge it into state.me. Failure is non-fatal: the user
   stays signed in and keeps working locally. */
async function syncProfile(){
  const u=currentUser(); if(!u) return;
  try{
    const me=await ensureProfile(u.id,u.email,state.me);
    Object.assign(state.me,me); save(); applyMe();
  }catch(e){ console.warn('profile sync failed',e); toast('Signed in — profile sync will retry'); }
}

/* The single place the app reacts to signing in or out. */
onAuthChange(async s=>{
  await useSession(s);
  if(s) await syncProfile();
  applyMe(); applyTheme();
  ui.ovStack=[]; ui.route=ui.route||'home'; render();
  if(s) toast('Signed in ☕');
});

export { syncProfile };

async function resetDemo(){
  await clearSaved(); await load(); applyMe(); applyTheme();
  ui.ovStack=[]; ui.profTab='pours'; ui.filter='foryou'; ui.searchQ=''; ui.route='home'; render();
  ui.obStep=1; pushOv({type:'onboard'}); toast('Demo reset ☕');
}

function syncCreate(){ if(!ui.create) ui.create=freshCreate();
  const g=i=>{const el=$('#'+i); return el?el.value:undefined;}, c=ui.create;
  ['caption','drink','cafe','bean','bean-custom','roaster','milk','dose','yield','time','temp','mbrand'].forEach(f=>{
    const v=g('c-'+f); if(v!==undefined) c[f==='bean-custom'?'beanCustom':f==='mbrand'?'machineBrand':f]=v;});
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
         trip to see your own photo. Signed out (or if the upload
         fails), this stays the final value: base64 in the demo blob,
         exactly as before step 1.6. */
      ui.create.img=cv.toDataURL('image/jpeg',0.82); renderOverlay(); toast('Photo added 📸');
      const u=currentUser(); if(!u) return;
      const target=ui.create;
      ui.create.uploading=true; renderOverlay();
      cv.toBlob(blob=>{
        if(!blob){ if(ui.create===target){ui.create.uploading=false; renderOverlay();} return; }
        uploadImage(blob,'image/jpeg').then(key=>{
          if(ui.create!==target) return;   // sheet was closed/reset meanwhile
          ui.create.img=key; ui.create.uploading=false; renderOverlay();
        }).catch(err=>{
          console.warn('upload failed',err);
          if(ui.create===target){ ui.create.uploading=false; renderOverlay(); }
          toast('Upload failed — photo will stay local for now');
        });
      },'image/jpeg',0.82);
    };
    img.onerror=()=>toast('Could not read that image'); img.src=ev.target.result;};
  reader.onerror=()=>toast('Could not read that file');
  reader.readAsDataURL(file);
}

/* Optimistic writes: mutate, repaint, then persist. If the network says
   no, put it back and say so — never leave the UI showing a lie. */
function paintLike(p){
  $$('[data-action="like"][data-id="'+p.id+'"]').forEach(b=>{b.classList.toggle('liked',p.likedByMe); b.innerHTML=icon(p.likedByMe?'heartF':'heart',22)+' <span class="cnt">'+fmt(p.likes)+'</span>';});
}
function toggleLike(id){
  const p=findPost(id); if(!p) return;
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
  paintSave(p);
  toast(p.saved?'Saved to your collection 🔖':'Removed from saved');
  const u=currentUser(); if(!u) return;
  const want=p.saved;
  (want?social.savePost(u.id,id):social.unsavePost(u.id,id)).catch(err=>{
    if(err.status===409) return;
    console.warn('save failed',err);
    p.saved=!want; save(); paintSave(p); toast('Couldn\'t update your collection');
  });
}
function paintFollow(id,on){
  $$('[data-action="follow"][data-id="'+id+'"]').forEach(b=>{
    b.classList.toggle('on',on);
    if(b.classList.contains('btn')) b.classList.toggle('ghost',on);
    b.textContent=on?'Following':'Follow';});
}
function toggleFollow(id){
  const on=state.follows[id]=!state.follows[id]; save();
  paintFollow(id,on);
  const who=(USERS[id]&&USERS[id].name||'').split(' ')[0];
  toast(on?('Following '+(who||'them')+' ☕'):'Unfollowed');
  const u=currentUser(); if(!u) return;
  (on?social.follow(u.id,id):social.unfollow(u.id,id)).catch(err=>{
    if(err.status===409) return;
    console.warn('follow failed',err);
    state.follows[id]=!on; save(); paintFollow(id,!on); toast('Couldn\'t update that follow');
  });
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
    .then(row=>{ if(row) c.id=row.id; })
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

/* ---------- challenges (step 1.8) ---------- */
function refreshChallengeViews(){
  renderView();
  const top=ui.ovStack[ui.ovStack.length-1];
  if(top&&(top.type==='challenge'||top.type==='challenges')) renderOverlay();
}

function toggleJoin(id){
  const on=state.challenges[id]=!state.challenges[id]; save();
  refreshChallengeViews();
  toast(on?'Joined challenge! 🎯':'Left challenge');
  const u=currentUser(); if(!u) return;
  (on?chal.joinChallenge(u.id,id):chal.leaveChallenge(u.id,id)).catch(err=>{
    if(err.status===409) return; console.warn('join failed',err);
    state.challenges[id]=!on; save(); refreshChallengeViews(); toast('Couldn\'t update that challenge');
  });
}

async function openChallenge(id){
  pushOv({type:'challenge',id});
  const u=currentUser(); if(!u) return;
  try{
    const entries=await chal.fetchEntries(id,u.id);
    const voted=new Set(await chal.fetchMyVotes(entries.map(e=>e.id)));
    entries.forEach(e=>{ e.votedByMe=voted.has(e.id); });
    entryCache[id]=entries;
    const mine=entries.find(e=>e.mine);
    if(mine) state.challengeSubs[id]=mine.p.id;
    const top=ui.ovStack[ui.ovStack.length-1];
    if(top&&top.type==='challenge'&&top.id===id) renderOverlay();
  }catch(e){ console.warn('entries failed',e); }
}

async function pickEntry(challengeId,postId){
  state.challengeSubs[challengeId]=postId;
  if(!state.challenges[challengeId]) state.challenges[challengeId]=true;
  save(); ui.ovStack.pop(); renderOverlay(); toast('Entry submitted! 🎯');
  const u=currentUser(); if(!u) return;
  try{
    await chal.submitEntry(u.id,challengeId,postId);
    delete entryCache[challengeId];
    await openChallengeRefresh(challengeId);
  }catch(err){
    if(err.status===409){ toast('You already have an entry in this one'); return; }
    console.warn('entry failed',err);
    delete state.challengeSubs[challengeId]; save(); renderOverlay();
    toast('Couldn\'t submit that entry');
  }
}

async function openChallengeRefresh(id){
  const u=currentUser(); if(!u) return;
  try{
    const entries=await chal.fetchEntries(id,u.id);
    const voted=new Set(await chal.fetchMyVotes(entries.map(e=>e.id)));
    entries.forEach(e=>{ e.votedByMe=voted.has(e.id); });
    entryCache[id]=entries;
    const top=ui.ovStack[ui.ovStack.length-1];
    if(top&&top.type==='challenge'&&top.id===id) renderOverlay();
  }catch(e){ console.warn('entry refresh failed',e); }
}

function toggleVote(challengeId,entryId){
  const u=currentUser();
  if(!u){ toast('Sign in to vote on entries'); return; }
  const list=entryCache[challengeId]; if(!list) return;
  const e=list.find(x=>x.id===entryId); if(!e) return;
  const want=!e.votedByMe;
  e.votedByMe=want; e.votes+=want?1:-1;
  list.sort((a,b)=>b.votes-a.votes);
  renderOverlay();
  (want?chal.voteEntry(u.id,entryId):chal.unvoteEntry(u.id,entryId)).catch(err=>{
    if(err.status===409) return; console.warn('vote failed',err);
    e.votedByMe=!want; e.votes+=want?-1:1; list.sort((a,b)=>b.votes-a.votes);
    renderOverlay(); toast('Couldn\'t register that vote');
  });
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
  const who=(USERS[uid]&&USERS[uid].name||'this person').split(' ')[0];
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
  ui.ovStack=[]; save(); render(); toast('Pour deleted');
  const u=currentUser(); if(!u) return;
  deletePost(id).then(()=>{ deleteImage(p.img); }).catch(err=>{
    console.warn('delete failed',err);
    if(i>=0) state.posts.splice(i,0,p);
    save(); render(); toast('Couldn\'t delete that — it\'s still there');
  });
}
function brewAgain(id){
  const p=findPost(id); if(!p) return; const r=p.recipe||{};
  ui.create=freshCreate();
  Object.assign(ui.create,{drink:p.drink||ui.create.drink, pattern:p.pattern||ui.create.pattern,
    bean:r.bean||'', roaster:r.roaster||'', machine:r.machine||ui.create.machine, milk:r.milk||ui.create.milk,
    dose:r.dose||'', yield:r.yield||'', time:r.time||'', temp:r.temp||''});
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
function submitPost(){
  syncCreate(); const c=ui.create; const T=v=>(v||'').trim();
  const drink=c.drink||'Cappuccino', isArt=!!DRINK_ART[drink];
  const caption=T(c.caption)||`${drink} ☕`;
  const cafe=(c.source==='cafe'&&c.cafe)?CAFES.find(x=>x.id===c.cafe):null;
  const recipe={};
  if(cafe){
    // café-sourced: bean from their list, roaster & machine from the café
    if(T(c.bean)) recipe.bean=T(c.bean);
    recipe.roaster=cafe.menu.roaster;
    recipe.machine=cafe.menu.machine;
    if(HAS_MILK.has(drink)&&c.milk) recipe.milk=c.milk;
  }else{
    let bean=c.bean===ADD_BEAN?(state.me.premium?T(c.beanCustom):''):T(c.bean);
    if(c.bean===ADD_BEAN && state.me.premium && bean && !BEANS.some(b=>b.n===bean) && !state.customBeans.includes(bean)) state.customBeans.push(bean);
    if(bean) recipe.bean=bean;
    if(c.roaster) recipe.roaster=(c.roaster==='Other / home roast'?'home roast':c.roaster);
    const machine=combineMachine(c.machineBrand,c.machineModel);
    if(machine) recipe.machine=machine;
    if(HAS_MILK.has(drink)&&c.milk) recipe.milk=c.milk;
    if(T(c.dose)) recipe.dose=T(c.dose);
    if(T(c.yield)) recipe.yield=T(c.yield);
    if(T(c.time)) recipe.time=T(c.time);
    if(T(c.temp)) recipe.temp=T(c.temp);
  }
  const hasRecipe=Object.keys(recipe).length>0;
  const np=post({user:'me',drink,art:isArt,pattern:isArt?(c.pattern||null):null,quality:isArt?.85:null,
    cafe:cafe?cafe.name:undefined,img:c.img,ago:'now',caption,recipe:hasRecipe?recipe:null,likes:0,comments:[]});
  /* Signed in: mint the id client-side so it never changes under us —
     the generated cup art is seeded from it, and so is the share link. */
  const u=currentUser();
  if(u){ np.id=newPostId(); np.createdAt=new Date().toISOString(); }
  state.posts.unshift(np); if(state.streak<8) state.streak++; save();
  ui.ovStack=[]; ui.route='home'; ui.filter='foryou'; render();
  setTimeout(()=>toast(c.img?'Posted! Streak kept 🔥':'Posted ☕ (add a photo next time)'),120);

  /* Optimistic: the post is already on screen. Reconcile on failure. */
  if(u) createPost(np,u.id).catch(err=>{
    console.warn('post failed',err);
    const i=state.posts.indexOf(np); if(i>=0) state.posts.splice(i,1);
    if(state.streak>0) state.streak--;
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
