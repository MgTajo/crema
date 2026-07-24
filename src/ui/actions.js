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
import { DRINK_ART, HAS_MILK, ADD_BEAN, BEANS, combineMachine, beanCatalog } from '../data/catalog.js';
import { USERS, CAFES, post } from '../data/seed.js';
import { state, ui, save, load, applyMe, findPost, freshCreate, clearSaved } from '../store/store.js';
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
    case 'filter': ui.filter=t.dataset.f; renderView(); break;
    case 'open-post': pushOv({type:'post',id}); break;
    case 'open-cafe': pushOv({type:'cafe',id}); break;
    case 'open-bean':{ if(BEANS.find(b=>b.n===id)) pushOv({type:'bean',id}); else toast('No details for that bean yet'); break;}
    case 'open-user':{ if(!id)break; if(id==='me'){ui.ovStack=[]; ui.route='profile'; render();} else pushOv({type:'user',id}); break;}
    case 'open-notifs':{ const had=state.notifications.some(n=>!n.read); state.notifications.forEach(n=>n.read=true); if(had){save(); renderAppbar();} pushOv({type:'notifs'}); break;}
    case 'notif-go':{ const n=state.notifications[+t.dataset.idx]; if(!n)break;
      if(n.post&&findPost(n.post)) pushOv({type:'post',id:n.post});
      else if(n.challenge) pushOv({type:'challenge',id:n.challenge});
      else if(n.cafe) pushOv({type:'cafe',id:n.cafe});
      else if(n.u) pushOv({type:'user',id:n.u}); break;}
    case 'open-menu': pushOv({type:'menu',id}); break;
    case 'open-tag': pushOv({type:'tag',id}); break;
    case 'open-challenge': pushOv({type:'challenge',id}); break;
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
    case 'follow-cafe': state.cafeFollow[id]=!state.cafeFollow[id]; save(); renderOverlay(); toast(state.cafeFollow[id]?'Following café ☕':'Unfollowed'); break;
    case 'recipe':{const el=$('#rp-'+id); if(el){el.classList.toggle('open'); const o=el.classList.contains('open'); t.innerHTML=t.innerHTML.replace(o?'▾':'▴',o?'▴':'▾');} break;}
    case 'join':{ state.challenges[id]=!state.challenges[id]; save(); renderView();
      const top=ui.ovStack[ui.ovStack.length-1]; if(top&&(top.type==='challenge'||top.type==='challenges')) renderOverlay();
      toast(state.challenges[id]?'Joined challenge! 🎯':'Left challenge'); break;}
    case 'ptab': ui.profTab=t.dataset.t; renderView(); break;

    case 'submit-entry': pushOv({type:'picker',id}); break;
    case 'pick-entry':{ const ch=t.dataset.ch; state.challengeSubs[ch]=id; if(!state.challenges[ch])state.challenges[ch]=true; save();
      ui.ovStack.pop(); renderOverlay(); toast('Entry submitted! 🎯'); break;}

    case 'cmt-like':{ const p=findPost(t.dataset.pid); const c=p&&p.comments[+t.dataset.idx]; if(!c)break;
      c.likedByMe=!c.likedByMe; c.likes=(c.likes||0)+(c.likedByMe?1:-1); save();
      t.classList.toggle('on',c.likedByMe); t.innerHTML=icon(c.likedByMe?'heartF':'heart',15)+'<span>'+(c.likes||'')+'</span>'; break;}
    case 'cmt-reply':{ const inp=$('#cmt-input'); if(inp){inp.value='@'+(t.dataset.handle||'').replace('@','')+' '; inp.focus();} break;}
    case 'add-cmt': addComment(id); break;

    case 'share-post': sharePost(id); break;
    case 'menu-copy': copyText(postLink(id),'Link copied 🔗'); popOv(); break;
    case 'menu-save': toggleSave(id); popOv(); break;
    case 'menu-report': popOv(); toast('Reported — thanks for keeping Crema kind 🙏'); break;
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
      save(); applyMe(); popOv(); toast('Profile updated ✓'); break;}
    case 'toggle-premium': state.me.premium=!state.me.premium; save(); renderOverlay(); toast(state.me.premium?'Premium unlocked ✦':'Premium turned off'); break;

    case 'ob-next': syncOb(); ui.obStep=Math.min(3,(ui.obStep||1)+1); renderOverlay(); break;
    case 'ob-back': syncOb(); ui.obStep=Math.max(1,(ui.obStep||1)-1); renderOverlay(); break;
    case 'ob-follow': state.follows[id]=!state.follows[id]; save(); renderOverlay(); break;
    case 'ob-skip': case 'ob-finish': syncOb(); state.onboarded=true; save(); applyMe(); ui.ovStack=[]; render();
      toast(a==='ob-finish'?'Welcome to Crema ☕':'You can finish setup in Settings'); break;

    case 'reset': if(confirm('Reset the demo to its starting state?')){clearSaved(); load(); applyMe(); applyTheme();
      ui.ovStack=[]; ui.profTab='pours'; ui.filter='foryou'; ui.searchQ=''; ui.route='home'; render();
      ui.obStep=1; pushOv({type:'onboard'}); toast('Demo reset ☕');} break;
    case 'toast': toast(t.dataset.msg||'Coming soon'); break;
    default: break;
  }
});
document.addEventListener('keydown',e=>{ if(e.key==='Enter'){const t=e.target.closest('[data-enter]'); if(t){e.preventDefault(); if(t.dataset.enter==='add-cmt') addComment(t.dataset.id);}} });
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
/* activity-bar tooltip */
document.addEventListener('mouseover',e=>{const ab=e.target.closest('.actbars .ab'); if(!ab)return; const tip=ab.parentElement.querySelector('.bartip'); if(!tip)return;
  tip.textContent=`${ab.dataset.d} · ${ab.dataset.c} pour${ab.dataset.c==='1'?'':'s'}`; tip.style.left=(ab.offsetLeft+ab.offsetWidth/2)+'px'; tip.hidden=false;});
document.addEventListener('mouseout',e=>{const ab=e.target.closest('.actbars .ab'); if(!ab)return; const tip=ab.parentElement.querySelector('.bartip'); if(tip)tip.hidden=true;});

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
    img.onload=()=>{const max=1080; let w=img.width,h=img.height; const s=Math.min(1,max/Math.max(w,h)); w=Math.round(w*s); h=Math.round(h*s);
      const cv=document.createElement('canvas'); cv.width=w; cv.height=h; cv.getContext('2d').drawImage(img,0,0,w,h);
      syncCreate(); ui.create.img=cv.toDataURL('image/jpeg',0.82); renderOverlay(); toast('Photo added 📸');};
    img.onerror=()=>toast('Could not read that image'); img.src=ev.target.result;};
  reader.onerror=()=>toast('Could not read that file');
  reader.readAsDataURL(file);
}

function toggleLike(id){
  const p=findPost(id); if(!p) return;
  p.likedByMe=!p.likedByMe; p.likes+=p.likedByMe?1:-1; save();
  $$('[data-action="like"][data-id="'+id+'"]').forEach(b=>{b.classList.toggle('liked',p.likedByMe); b.innerHTML=icon(p.likedByMe?'heartF':'heart',22)+' <span class="cnt">'+fmt(p.likes)+'</span>';});
  if(p.likedByMe){const hp=$('#hp-'+id); if(hp){hp.classList.remove('go'); void hp.offsetWidth; hp.classList.add('go');}}
}
function toggleSave(id){
  const p=findPost(id); if(!p) return; p.saved=!p.saved; save();
  $$('[data-action="save"][data-id="'+id+'"]').forEach(b=>{b.classList.toggle('saved',p.saved); b.innerHTML=icon(p.saved?'saveF':'save',22);});
  toast(p.saved?'Saved to your collection 🔖':'Removed from saved');
}
function toggleFollow(id){
  const on=state.follows[id]=!state.follows[id]; save();
  $$('[data-action="follow"][data-id="'+id+'"]').forEach(b=>{
    b.classList.toggle('on',on);
    if(b.classList.contains('btn')) b.classList.toggle('ghost',on);
    b.textContent=on?'Following':'Follow';});
  toast(on?('Following '+USERS[id].name.split(' ')[0]+' ☕'):'Unfollowed');
}
function addComment(id){
  const inp=$('#cmt-input'); if(!inp) return; const text=inp.value.trim(); if(!text) return;
  const p=findPost(id); if(!p) return; p.comments.push({u:'me',t:text,ago:'now',likes:0}); save();
  const list=$('#cmt-list'); if(list){if(list.querySelector('.empty')) list.innerHTML=''; list.insertAdjacentHTML('beforeend',commentRow({u:'me',t:text,ago:'now',likes:0},p.id,p.comments.length-1));}
  inp.value=''; toast('Comment added 💬');
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
  state.posts.unshift(np); if(state.streak<8) state.streak++; save();
  ui.ovStack=[]; ui.route='home'; ui.filter='foryou'; render();
  setTimeout(()=>toast(c.img?'Posted! Streak kept 🔥':'Posted ☕ (add a photo next time)'),120);
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
