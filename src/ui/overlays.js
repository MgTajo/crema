"use strict";
/* ============================================================
   ui/overlays — every full-screen / bottom sheet, plus the overlay
   stack (pushOv/popOv) and the router that paints the top of it.
   Overlays are data-driven strings just like the screens; opening
   one pushes a descriptor, closing pops it.
   ============================================================ */
import { $, esc, fmt, cap, initials, seedOf, withUnit, daysAgo } from '../core/util.js';
import { S } from '../data/assets.js';
import { imageUrl } from '../data/media.js';
import { LEVELS, MILK_LIST, DRINK_ART, HAS_MILK, ADD_DRINK, BEANS, MACHINE_BRANDS, POPULAR_MACHINES, popularBeans,
         beanBrands, beanCatalog, machineIndex, searchMachines, searchBeans, machineKnown, beanKnown, flag } from '../data/catalog.js';
import { USERS, CAFES, CHALLENGES, userOf } from '../data/world.js';
import { state, ui, session, social, findPost, allPosts, myPosts, freshCreate, challenges,
         beanPassport, canEdit, streakInfo, myMachines, myCoffees, isPinned } from '../store/store.js';
import { REST_AFTER } from '../domain/streak.js';
import { pushSupported, iosNeedsInstall, pushPermission, standalone } from '../data/push.js';
import { art, cupSVG } from '../domain/art.js';
import { levelOf, nextLevel, levelProgress, POINT_RULES } from '../domain/scoring.js';
import { t, tn } from '../i18n.js';
import { avatar, cafeThumb, mentionify, recipeRows, recipePanel, commentRow, machinePicker, beanPicker, drinkOptions, premiumNote, gcell, commentCount, likeButton, reactionBar, editedMark, privateMark, followMini, followBtn, followState } from './components.js';
import { icon, logoMark } from './icons.js';
import { renderView, renderAppbar } from './views.js';
import { arm } from './history.js';

export function pushOv(o){ui.ovStack.push(o); renderOverlay(); arm();}
export function popOv(){ui.ovStack.pop(); renderOverlay(); if(!ui.ovStack.length){renderView(); renderAppbar();} arm();}

/* Which sheet the DOM currently holds, so a repaint of the same one can
   be told from a different one opening, and where each sheet still on
   the stack was scrolled to. */
let painted=null;
const scrolls=new Map();
const ovKey=o=>o.type+':'+(o.id||'');

export function renderOverlay(){
  const ov=$('#overlay'), top=ui.ovStack[ui.ovStack.length-1];
  if(!top){ov.className='overlay'; ov.innerHTML=''; painted=null; scrolls.clear(); return;}
  /* Replacing the sheet's HTML destroys the element that was scrolled,
     and a fresh one always starts at the top — which is why picking a
     machine halfway down the recipe form, or a milk in Settings, threw
     you back to the first field.

     Remembered per sheet, not just for the one on screen: opening the
     machine picker from the bottom of the create form covers it with a
     second sheet, and coming back has to land on the field that was
     tapped rather than at the photo. Positions are keyed by sheet and
     dropped as soon as that sheet leaves the stack, so reopening a sheet
     later still starts at its top. */
  const key=ovKey(top);
  const body=ov.querySelector('.ov-body');
  if(painted&&body) scrolls.set(painted,body.scrollTop);
  const live=new Set(ui.ovStack.map(ovKey));
  [...scrolls.keys()].forEach(k=>{ if(!live.has(k)) scrolls.delete(k); });
  const keep=scrolls.get(key)||0;
  painted=key;
  ov.className='overlay show';
  const T=top.type;
  ov.innerHTML =
    T==='post'?overlayPost(top.id):
    T==='cafe'?overlayCafe(top.id):
    T==='bean'?overlayBean(top.id):
    T==='user'?overlayUser(top.id):
    T==='notifs'?overlayNotifs():
    T==='menu'?overlayMenu(top.id):
    T==='report'?overlayReport(top.id):
    T==='tag'?overlayTag(top.id):
    T==='challenge'?overlayChallenge(top.id):
    T==='challenges'?overlayChallenges():
    T==='flist'?overlayFlist(top.id):
    T==='scoring'?overlayScoring():
    T==='streak'?overlayStreak():
    T==='passport'?overlayPassport():
    T==='settings'?overlaySettings():
    T==='onboard'?overlayOnboard():
    T==='password'?overlayPassword():
    T==='signin'?overlaySignin(top.why):
    T==='picker'?overlayPicker():
    T==='create'?overlayCreate():'';
  if(keep){ const next=ov.querySelector('.ov-body'); if(next) next.scrollTop=keep; }
}

/* ---------- the guest wall ----------
   One sheet, raised by whatever a signed-out visitor just reached for.
   It names *that* thing rather than saying "sign in to continue": the
   ask lands better when it is the answer to something they were already
   trying to do, and they were — that is why the sheet is here.

   `why` comes from ui/actions.js, which maps every gated intent onto one
   of these. An unmapped intent falls through to the general line rather
   than to a blank sheet. */
const guestAsk=()=>({
  like:     [t('Sign in to like this'), t('A heart is the smallest way to say you saw it.')],
  react:    [t('Sign in to react'), t('Say which part you loved: the art, the spot or the coffee.')],
  comment:  [t('Sign in to join in'), t('Comments are people talking about coffee. Bring yours.')],
  save:     [t('Sign in to keep this'), t('Save a pour and its recipe is one tap away tomorrow morning.')],
  follow:   [t('Sign in to follow'), t('Follow someone and their mornings show up in your feed.')],
  post:     [t('Sign in to log your coffee'), t('A photo and the drink is all it takes. That is day one of the streak.')],
  following:[t('Sign in for your own feed'), t('Following is the coffee of the people you picked.')],
  profile:  [t('Sign in for your profile'), t('Your pours, your streak, your beans and your level.')],
  people:   [t('Sign in to see people'), t('Profiles, followers, and who poured what.')],
  explore:  [t('Sign in to explore'), t('Today\'s podium, this week\'s challenges and people to follow.')],
  cafe:     [t('Sign in for cafés'), t('Follow the places you drink at and see what gets poured there.')],
  notifs:   [t('Sign in for your inbox'), t('Likes, comments and follows land here.')],
  general:  [t('Create your Crema account'), t('It is free and takes about a minute. Then everything here is yours too.')]
});
function overlaySignin(why){
  const asks=guestAsk();
  const [h,s]=asks[why]||asks.general;
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="${t('Sign in')}">
    <div class="ov-body" style="padding:26px 20px 22px;text-align:center">
      ${logoMark(46)}
      <h2 style="font-family:var(--serif);font-weight:400;font-size:25px;letter-spacing:-.02em;margin:12px 0 6px">${esc(h)}</h2>
      <p style="color:var(--ink2);font-size:14px;line-height:1.55;margin:0 auto 20px;max-width:280px">${esc(s)}</p>
      <button class="btn block" data-action="guest-signin" data-m="up">${t('Create your account')}</button>
      <button class="btn ghost block" style="margin-top:9px" data-action="guest-signin" data-m="in">${t('I already have one')}</button>
      <div style="margin-top:16px;font-size:13px;color:var(--muted);cursor:pointer" data-action="close-ov">${t('Keep looking around')}</div>
    </div></div>`;
}

function overlayPost(id){
  const p=findPost(id); if(!p) return '';
  const u=userOf(p.user), r=p.recipe, rows=recipeRows(r);
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${t('Post')}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="${t('Back')}">${icon('back',20)}</button><b>${t('Post')}</b>
      <button class="act" data-action="share-post" data-id="${p.id}" aria-label="${t('Share')}">${icon('send',20)}</button>
      ${likeButton(p)}</div>
    <div class="ov-body">
      <div class="media" data-action="none">${art(imageUrl(p.img,'hero'),p.pattern,p.quality,seedOf(p.id),p.drink)}<div class="heartpop" id="hp-${p.id}">${icon('heartF',90)}</div></div>
      <div class="p-head">
        <div class="idwrap" data-action="open-user" data-id="${p.user}">${avatar(p.user)}
          <div class="who"><b>${esc(u.name)} <span class="lvlchip">Lv${u.level}</span></b><span>${esc(u.handle)}${p.cafe?` · ${t('at')} ${esc(p.cafe)}`:''} · ${p.ago}${editedMark(p)}${privateMark(p)}</span></div></div>
        ${p.user==='me'?'':followMini(p.user)}
        <button class="kebab" data-action="open-menu" data-id="${p.id}" aria-label="${t('More options')}">⋯</button></div>
      <div class="p-body"><div class="cap"><b>${esc(u.name)}</b> ${mentionify(p.caption)}</div>
        <div class="chips"><span class="chip drinkchip">${esc(p.drink||t('Coffee'))}</span>${p.art&&p.pattern?`<span class="chip tag" data-action="open-tag" data-id="${p.pattern}">#${p.pattern}</span>`:''}${r&&r.milk?`<span class="chip">🥛 ${esc(r.milk)}</span>`:''}${p.cafe?`<span class="chip">📍 ${esc(p.cafe)}</span>`:''}</div></div>
      ${reactionBar(p)}
      ${rows.length?`<div class="scoreblk" style="padding-top:0"><div class="recipe-panel open" style="margin:0">${recipePanel(r)}
        <div style="padding:9px 12px;background:var(--surface)"><button class="btn ghost sm" data-action="brew" data-id="${p.id}">☕ ${t('Brew this recipe')}</button></div></div></div>`:''}
      <div style="padding:14px 14px 4px;font-weight:700;font-family:var(--serif);font-size:16px">${commentCount(p)} ${t('comments')}</div>
      <div id="cmt-list">${p.comments.length?p.comments.map((c,i)=>commentRow(c,p.id,i)).join(''):
        (commentCount(p)?`<div class="empty" style="padding:24px">${t('Loading comments…')}</div>`
          :`<div class="empty" style="padding:24px">${session?t('Be the first to comment.'):t('No comments yet.')}</div>`)}</div>
    </div>
    <div class="mentions" id="cmt-mentions" hidden></div>
    ${session
      ? `<div class="composer">${avatar('me')}<input id="cmt-input" placeholder="${t('Add a comment… use @ to name someone')}" data-enter="add-cmt" data-id="${p.id}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${t('Add a comment')}"><button class="send" data-action="add-cmt" data-id="${p.id}" aria-label="${t('Send')}">${icon('sendF',20)}</button></div>`
      /* A guest gets the thread and a bar that says why they can't add to
         it, rather than a text field that takes their sentence and then
         asks who they are. This one goes straight to the gate: it has
         already made the ask the sheet would have made. */
      : `<div class="composer guest" data-action="guest-signin" data-m="up" role="button" tabindex="0">
          <span>${t('Sign in to join the conversation')}</span><b>${t('Sign in')}</b></div>`}
  </div>`;
}

function overlayCafe(id){
  const c=CAFES.find(x=>x.id===id); if(!c) return '';
  const followed=state.cafeFollow[id], tagged=allPosts().filter(p=>p.cafe===c.name);
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${c.name}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="${t('Back')}">${icon('back',20)}</button><b>${c.name}</b></div>
    <div class="ov-body">
      <div style="height:130px;background:linear-gradient(135deg,${c.color},#24170F);position:relative"><div style="position:absolute;left:16px;bottom:-26px">${cafeThumb(c)}</div></div>
      <div style="padding:34px 16px 8px"><b style="font-family:var(--serif);font-size:22px">${c.name}</b>
        <div style="color:var(--muted);font-size:13px;margin:3px 0 10px">${c.spec} · ${c.area}, ${c.city}</div>
        <div class="chips" style="margin:0 0 12px"><span class="chip"><span class="star">★ ${c.rating}</span></span><span class="chip">${t('{n} followers',{n:fmt(c.followers)})}</span>${c.hours?`<span class="chip" style="color:${c.hours.startsWith('Open')?'var(--green)':'var(--terra)'}">${esc(c.hours)}</span>`:''}</div>
        <p style="font-size:14px;line-height:1.55;color:var(--ink2);margin:0 0 14px">${c.blurb}</p>
        ${c.promo?`<div style="background:var(--pm1);border:1px solid var(--pm2);border-radius:14px;padding:12px 14px;margin-bottom:14px;display:flex;gap:10px;align-items:center"><span style="font-size:26px">🎟️</span><div><b style="color:var(--green)">${t('10% off any drink')}</b><div style="font-size:12.5px;color:var(--green)">${t('Show any post tagged here at the counter.')}</div></div></div>`:''}
        <div style="display:flex;gap:10px"><button class="btn ${followed?'ghost':''} block" data-action="follow-cafe" data-id="${c.id}">${followed?'✓ '+t('Following'):t('Follow café')}</button><button class="btn ghost" data-action="directions" data-id="${c.id}" aria-label="${t('Directions')}">🧭</button></div></div>
      <div class="section-h" style="margin:14px 16px 10px"><h2>${t('Community pours here')}</h2></div>
      ${tagged.length?`<div class="grid" style="padding:0 16px 20px">${tagged.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`:`<div class="empty" style="padding:10px 16px 26px">${t('No pours tagged here yet. Be the first.')}</div>`}
    </div></div>`;
}

function overlayBean(name){
  const b=BEANS.find(x=>x.n===name); if(!b) return '';
  const matches=myPosts().filter(p=>{const rb=p.recipe&&p.recipe.bean; return rb&&(rb===b.n||rb.indexOf(b.n)===0||b.n.indexOf(rb)===0);});
  const rows=[[t('Origin'),b.origin],[t('Roast level'),b.roast],[t('Availability'),b.loc==='INT'?t('Sold in Germany'):t('Roasted in Germany')]];
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${esc(b.n)}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="${t('Back')}">${icon('back',20)}</button><b>${b.n}</b></div>
    <div class="ov-body">
      <div class="bean-hero"><img src="${S.beans}" alt=""><div class="bean-hero-t"><span class="fl">${flag[b.c]||'🫘'}</span><div><b>${b.n}</b><span>${esc(b.origin||'')}</span></div></div></div>
      <div style="padding:16px">
        <div class="section-h" style="margin:2px 0 10px"><h2>${t('Tasting notes')}</h2></div>
        <div class="chips">${b.notes.map(x=>`<span class="chip tag">${x}</span>`).join('')}</div>
        <div class="section-h" style="margin:18px 0 10px"><h2>${t('Details')}</h2></div>
        <div class="recipe-panel open" style="margin:0"><div class="recipe-grid">${rows.map(r=>`<div><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')}</div></div>
        <div class="section-h" style="margin:18px 0 10px"><h2>${t('Your pours with this bean')}</h2></div>
        ${matches.length?`<div class="grid">${matches.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`:`<div class="empty" style="padding:22px 0">${t('No pours logged with this bean yet.')}</div>`}
        <div style="height:8px"></div>
      </div></div></div>`;
}

/* Their pours, loaded when the sheet opens (ui/actions openUser). Falls
   back to whatever of theirs is already in the feed. */
function theirPosts(uid){
  const loaded=ui.userPosts&&ui.userPosts.id===uid?ui.userPosts.list:null;
  return loaded||state.posts.filter(p=>p.user===uid);
}
/* What someone who doesn't follow them gets instead of the profile.
   A follow here is a request, so there are two ways to be locked out and
   they are waiting on different people — the copy says which. */
function profileGate(u,rel){
  const first=esc((u.name||'').split(' ')[0]||t('They'));
  const pending=rel==='pending';
  return `<div class="lockcard">
    <div class="big">${pending?'⏳':'🔒'}</div>
    <b>${pending?t('Waiting on {name}',{name:first}):t('Follow {name} to see their pours',{name:first})}</b>
    <span>${pending
      ? t('Your request is in. The moment they accept, their pours and recipes show up here.')
      : t('Their pours, recipes and bio stay with the followers they have accepted.')}</span>
  </div>`;
}
/* A profile you don't follow shows who they are — name, level, how many
   people follow them — and nothing they've made. Pours, recipes, bio,
   city and pour count are the profile's content, and content follows the
   same rule the followers-only feed already applies. */
function overlayUser(uid){
  if(!uid||uid==='me') return '';
  const u=userOf(uid);                       // renders while the profile loads
  const rel=followState(uid);
  const open=rel==='following';
  const theirs=open?theirPosts(uid):[];
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${u.name}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="${t('Back')}">${icon('back',20)}</button><b>${u.name}</b></div>
    <div class="ov-body">
      <div style="height:96px;background:linear-gradient(135deg,${u.color},#24170F)"></div>
      <div style="padding:0 16px 20px">
        <div style="display:flex;align-items:flex-end;gap:12px;margin-top:-28px">
          ${avatar(uid,'xl')}
          ${followBtn(uid,'sm','margin-left:auto')}</div>
        <div style="margin-top:10px"><b style="font-family:var(--serif);font-size:22px">${esc(u.name)}</b> <span class="lvlchip">Lv${u.level}</span>
          <div style="color:var(--muted);font-size:13px;margin:2px 0 8px">${esc(u.handle)}${open&&u.city?` · 📍 ${esc(u.city)}`:''}</div>
          ${open&&u.bio?`<p style="font-size:13.5px;color:var(--ink2);line-height:1.5;margin:0 0 12px">${esc(u.bio)}</p>`:''}</div>
        <div class="stats">${open?`<div><b>${fmt(u.pourN)}</b><span>${t('Pours')}</span></div>`:''}<div><b>${fmt(u.followerN)}</b><span>${t('Followers')}</span></div><div><b>${t(u.levelName)}</b><span>${t('Level')} ${u.level}</span></div></div>
        ${open?`<div class="section-h"><h2>${t('Recent pours')}</h2></div>
        ${theirs.length?`<div class="grid">${theirs.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`:`<div class="empty">${t('No pours yet.')}</div>`}`
        :profileGate(u,rel)}
      </div></div></div>`;
}

function overlayNotifs(){
  const rows=state.notifications.map((n,i)=>{
    /* Podium and challenge rows have no actor — nobody *did* this to you,
       the standing did — so they get a symbol where a face would go. */
    const noFace=n.type==='challenge'?'🏆':n.type==='podium'?'🏅':'☕';
    const av=n.u?avatar(n.u):`<div class="avatar" style="background:var(--crema)">${noFace}</div>`;
    /* A request is the one notification that is a question, so it keeps
       its buttons here too — the row above the feed is the prominent
       copy, this is the one you find when you come looking. */
    const ask=n.type==='follow_request'&&n.u&&(social.requests||[]).some(r=>r.id===n.u)
      ? `<div class="nact"><button class="btn sm" data-action="accept-follow" data-id="${n.u}">${t('Accept')}</button>
         <button class="btn ghost sm" data-action="decline-follow" data-id="${n.u}">${t('Decline')}</button></div>` : '';
    return `<div class="nrow ${n.read?'':'unread'}" ${ask?'':`data-action="notif-go" data-idx="${i}"`}>${av}
      <div class="nb"><div class="nt">${n.u?`<b>${esc(userOf(n.u).name)}</b> `:''}${esc(n.text)}</div><span>${t('{time} ago',{time:n.time})}</span>${ask}</div></div>`;}).join('');
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${t('Notifications')}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="${t('Back')}">${icon('back',20)}</button><b>${t('Notifications')}</b></div>
    <div class="ov-body">${rows||`<div class="empty"><div class="big">🔔</div>${t('All caught up.')}</div>`}</div></div>`;
}

function overlayMenu(id){
  const p=findPost(id); if(!p) return '';
  const mine=p.user==='me', who=userOf(p.user);
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="${t('Post options')}">
    <div class="grab"></div>
    <div class="ov-body" style="padding:4px 18px 18px">
      <div class="mrow" data-action="menu-copy" data-id="${id}"><div class="mi">🔗</div>${t('Copy link')}</div>
      ${p.recipe?`<div class="mrow" data-action="brew" data-id="${id}"><div class="mi">☕</div>${t('Brew this recipe')}</div>`:''}
      <div class="mrow" data-action="menu-save" data-id="${id}"><div class="mi">🔖</div>${p.saved?t('Remove from saved'):t('Save to collection')}</div>
      ${mine&&canEdit(p)?`<div class="mrow" data-action="menu-edit" data-id="${id}"><div class="mi">✏️</div>${t('Edit this pour')}</div>`:''}
      ${mine?`<div class="mrow danger" data-action="menu-delete" data-id="${id}"><div class="mi">🗑️</div>${t('Delete this pour')}</div>`
            :`<div class="mrow danger" data-action="menu-report" data-id="${id}"><div class="mi">🚩</div>${t('Report')}</div>
              <div class="mrow danger" data-action="menu-block" data-id="${p.user}"><div class="mi">🚫</div>${t('Block {name}',{name:esc((who&&who.name||t('this person')).split(' ')[0])})}</div>`}
      <button class="btn ghost block" style="margin-top:14px" data-action="close-ov">${t('Cancel')}</button>
    </div></div>`;
}

/* Reporting writes a `reports` row now. A moderation route has to exist
   before store review, not after. */
const reportReasons=()=>[
  ['spam',t('Spam or misleading')],
  ['harassment',t('Harassment or hate')],
  ['nudity',t('Nudity or sexual content')],
  ['violence',t('Violence or self-harm')],
  ['ip',t('Not their content')],
  ['other',t('Something else')]
];
function overlayReport(id){
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="${t('Report')}">
    <div class="grab"></div>
    <div class="ov-bar" style="border:0"><b>${t('Report this pour')}</b><button class="iconbtn" data-action="close-ov" aria-label="${t('Close')}">${icon('x',20)}</button></div>
    <div class="ov-body" style="padding:0 18px 18px">
      <p style="font-size:13px;color:var(--ink2);line-height:1.5;margin:0 0 12px">${t('Thanks for helping keep Crema kind. A person reads every report, and the author never finds out who sent it.')}</p>
      ${reportReasons().map(r=>`<div class="mrow" data-action="report-send" data-id="${id}" data-reason="${r[0]}"><div class="mi">🚩</div>${r[1]}</div>`).join('')}
      <button class="btn ghost block" style="margin-top:14px" data-action="close-ov">${t('Cancel')}</button>
    </div></div>`;
}

function overlayTag(pat){
  const list=allPosts().filter(p=>p.art&&p.pattern===pat);
  const ch=CHALLENGES.find(c=>c.pattern===pat);
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="#${pat}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="${t('Back')}">${icon('back',20)}</button><b>#${pat}</b></div>
    <div class="ov-body"><div style="padding:14px 16px 20px">
      <div style="font-size:13px;color:var(--muted);font-weight:600;margin-bottom:8px">${tn(list.length,'{n} pour','{n} pours')}</div>
      ${ch?`<button class="btn sm" style="margin-bottom:12px" data-action="open-challenge" data-id="${ch.id}">🎯 ${ch.title} · ${t('this week\'s challenge')}</button>`:''}
      ${list.length?`<div class="grid">${list.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`:
        `<div class="empty"><div class="big">🎨</div>${t('No {pattern} pours yet. Be the first.',{pattern:pat})}<br><br><button class="btn sm" data-action="open-create">${t('Post a pour')}</button></div>`}
    </div></div></div>`;
}

/* ---------- challenges ----------
   A challenge is a rule, and the only thing worth showing about a rule
   is how close you are to satisfying it. So both sheets are progress
   bars: no join button, no entry picker, no votes. See
   platform/supabase/step-1.17.sql for where the number comes from — it is
   computed in Postgres from the pours you already logged, which is why
   the client never tries to recompute it.

   Everything reads from CHALLENGES, refilled by loadChallenges(). */

/* How long is left, in the roughest unit that is still true. */
function endsIn(ch){
  const ms=Date.parse(ch.endsAt)-Date.now();
  if(!isFinite(ms)||ms<=0) return t('ending');
  const h=Math.floor(ms/36e5);
  if(h<1) return t('under an hour');
  if(h<24) return h+'h';
  const d=Math.round(h/24);
  return tn(d,'{n} day','{n} days');
}

const catLabel=k=>({ habit:t('Habit'), craft:t('Craft'), discovery:t('Discovery') })[k]||'';

/* The bar plus its numbers. `done` wins over the count: a finished
   challenge says so rather than showing 3/3 and leaving you to work it
   out. */
function progressBar(ch){
  const pct=ch.goal?Math.round(100*ch.progress/ch.goal):0;
  return `<div class="chp">
    <div class="chp-bar"><i style="width:${ch.done?100:pct}%"></i></div>
    <div class="chp-n">${ch.done?`<b class="chp-done">✓ ${t('Done')} · +${ch.points}</b>`
                                :`<b>${ch.progress}</b> / ${ch.goal}`}</div>
  </div>`;
}

/* A card for Explore and the all-challenges sheet. */
export function challengeCard(ch){
  return `<div class="chcard${ch.done?' done':''}" data-action="open-challenge" data-id="${ch.id}">
    <div class="chcard-cup">${cupSVG(ch.pattern,.9,ch.id.length)}</div>
    <div class="chcard-b">
      <div class="chcard-h"><span class="chcat">${catLabel(ch.cat)}</span><span class="chpts">+${ch.points}</span></div>
      <b>${esc(ch.title)}</b>
      <div class="chcard-s">${esc(ch.blurb)}</div>
      ${progressBar(ch)}
      <div class="chcard-f">${ch.done?t('Earned this week'):t('{time} left',{time:endsIn(ch)})}</div>
    </div></div>`;
}

/* What actually counts toward this rule, in the app's own words. The
   challenge blurb sells it; this explains it, so nobody has to guess
   whether a cortado counts as a different drink. */
const RULE_TEXT={
  days:          g=>t('Log a coffee on {n} different days.',{n:g}),
  pours:         g=>t('Log {n} coffees in total.',{n:g}),
  hour_before:  (g,p)=>t('Log a coffee before {h}:00 your time, on {n} different days. Anything before 4am counts as the night before.',{h:p,n:g}),
  hour_after:   (g,p)=>t('Log a coffee after {h}:00 your time, on {n} different days.',{h:p,n:g}),
  weekend:       ()=>t('Log a coffee on Saturday and again on Sunday.'),
  pattern:      (g,p)=>t('Post {n} latte-art pours with a {pattern}.',{n:g,pattern:p}),
  art:           g=>t('Post {n} pours with latte art, any pattern.',{n:g}),
  recipe:        g=>t('Post {n} pours with dose, yield and time all filled in.',{n:g}),
  caption:       g=>t('Post {n} pours with a note of at least 20 characters.',{n:g}),
  drinks:        g=>t('Log {n} different drinks.',{n:g}),
  beans:         g=>t('Brew {n} different coffees.',{n:g}),
  milks:         g=>t('Use {n} different milks.',{n:g}),
  cafes:         g=>t('Log a coffee at {n} different cafés.',{n:g}),
  countries:     g=>t('Brew beans grown in {n} different countries. Coffees whose origin the catalogue does not know cannot count.',{n:g}),
  roasters:      g=>t('Brew coffee from {n} different roasters.',{n:g}),
  new_bean:      g=>t('Log {n} coffee you have never logged before.',{n:g}),
  comments:      g=>t('Leave {n} comments on other people\'s coffee. Your own do not count.',{n:g})
};
const ruleText = ch => (RULE_TEXT[ch.kind]||(()=>t('Keep pouring.')))(ch.goal, ch.param);

function overlayChallenge(id){
  const ch=CHALLENGES.find(c=>c.id===id); if(!ch) return '';
  const left=ch.goal-ch.progress;
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${esc(ch.title)}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="${t('Back')}">${icon('back',20)}</button><b>${esc(ch.title)}</b></div>
    <div class="ov-body"><div style="padding:0 16px 20px">
      <div class="ch-top" style="height:150px;border-radius:16px;margin-top:14px">${cupSVG(ch.pattern,.92,ch.id.length)}<span class="ends">${ch.done?t('Complete'):t('{time} left',{time:endsIn(ch)})}</span></div>
      <div style="margin:14px 2px 4px">
        <b style="font-family:var(--serif);font-size:22px">${esc(ch.title)}</b>
        <div class="chips" style="margin:8px 0">
          <span class="chip">${catLabel(ch.cat)}</span>
          <span class="chip tag">${esc(ch.tag)}</span>
          <span class="chip" style="color:var(--st4);border-color:var(--st3);background:var(--st1)">${t('+{n} points',{n:ch.points})}</span>
          ${ch.done?`<span class="chip" style="color:var(--green)">✓ ${t('Earned')}</span>`:''}</div>
        <p style="font-size:13.5px;color:var(--ink2);line-height:1.5;margin:4px 0 14px">${esc(ch.blurb)}</p>
        ${progressBar(ch)}
        <div class="chrule">
          <div class="rlabel" style="margin:0 0 4px">${t('What counts')}</div>
          <div>${esc(ruleText(ch))}</div>
        </div>
        ${ch.done
          ? `<div class="chdone">✓ ${t('Finished. The {n} points are already on your score.',{n:ch.points})}${ch.raw>ch.goal?` ${t('You got to {n}.',{n:ch.raw})}`:''}</div>`
          : `<div style="font-size:12.5px;color:var(--muted);margin:10px 2px 12px">${t('{n} to go. There is nothing to enter, because your pours count on their own.',{n:left})}</div>
             <button class="btn block" data-action="open-create">${t('Log a coffee')}</button>`}
      </div>
    </div></div></div>`;
}

function overlayChallenges(){
  const list=CHALLENGES;
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${t('Challenges')}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="${t('Back')}">${icon('back',20)}</button><b>${t('This week')}</b></div>
    <div class="ov-body"><div style="padding:14px 16px 20px">
      ${list.length?list.map(challengeCard).join('')
        :`<div class="empty"><div class="big">🎯</div>${challenges.loaded?t('No challenges are running right now.')+'<br>'+t('Three new ones land every Monday.'):t('Loading challenges…')}</div>`}
      <div style="font-size:12px;color:var(--muted);text-align:center;margin-top:14px">
        ${t('Three challenges a week, one of each kind. They start every Monday and score themselves from the coffee you log.')}</div>
    </div></div></div>`;
}
/* The board used to have a sheet of its own, because it was fifty rows
   deep and Explore could only show the first five. Today's podium is
   three rows total, so Explore shows all of it and a sheet behind a "Full
   list" link would open on the very same three pours. Removed rather than
   left as a second way to see one thing. */
/* Real rows from `follows`, loaded when the sheet opens. `social.loaded`
   distinguishes "nobody follows you" from "we haven't asked yet". */
function overlayFlist(kind){
  const following=kind==='following';
  const list=(following?social.following:social.followers).filter(Boolean);
  const title=following?t('Following'):t('Followers');
  const empty=!social.listsLoaded
    ? `<div class="empty">${t('Loading…')}</div>`
    : `<div class="empty"><div class="big">👥</div>${following
        ?t('Not following anyone yet.')+'<br>'+t('Find people on Explore.')
        :t('No followers yet.')+'<br>'+t('Share your pours to get discovered.')}</div>`;
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${title}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="${t('Back')}">${icon('back',20)}</button><b>${title}</b></div>
    <div class="ov-body"><div style="padding:14px 16px 20px">
      ${list.length?`<div class="rlist">${list.map(u=>`<div class="rlist-row click" data-action="open-user" data-id="${u.id}">${avatar(u.id)}
        <div class="who" style="flex:1"><b>${esc(u.name)}</b><span>${esc(u.handle)}${u.city?' · '+esc(u.city):''}</span></div>
        ${followBtn(u.id)}</div>`).join('')}</div>`
        :empty}
    </div></div></div>`;
}
function overlayScoring(){
  const pts=state.me.points|0, cur=levelOf(pts), next=nextLevel(pts), pct=Math.round(levelProgress(pts)*100);
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${t('Levels')}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="${t('Back')}">${icon('back',20)}</button><b>${t('Levels & points')}</b></div>
    <div class="ov-body"><div style="padding:14px 16px 20px">
      <p style="font-size:13.5px;color:var(--ink2);line-height:1.55;margin:0 0 14px">${t('Your level grows as you post and practise. Think of it as a friendly marker of how far your craft has come. Nobody is grading you.')}</p>
      <div class="lvlbar" style="margin-top:0">
        <div class="top"><b>${t('Level')} ${cur[0]} · ${t(cur[1])}</b><span>${t('{n} pts',{n:fmt(pts)})}</span></div>
        <div class="track"><i style="width:${pct}%"></i></div>
        <div style="font-size:11.5px;color:var(--muted);font-weight:600;margin-top:6px">${next
          ? t('{n} points to Level {lvl} · {name}',{n:fmt(next[2]-pts),lvl:next[0],name:t(next[1])})
          : t('Top of the ladder. There is nothing left to climb.')}</div>
      </div>
      <div class="rlabel" style="margin-top:18px">${t('How points are earned')}</div>
      <div class="rlist" style="margin-bottom:4px">${POINT_RULES.map(r=>`<div class="rlist-row">
        <div style="flex:1"><b style="font-size:14px">${t(r[0])}</b></div><div class="rlist-val">${r[1]}</div></div>`).join('')}</div>
      <div class="rlabel" style="margin-top:18px">${t('The ladder')}</div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${LEVELS.map(l=>`<div class="lvlrow ${l[0]===cur[0]?'now':''}"><div class="ln">${l[0]}</div><b>${t(l[1])}</b>
          <span style="margin-left:auto;font-size:11.5px;color:var(--muted);font-weight:700">${l[0]===cur[0]?t('you are here'):(l[2]?t('{n} pts',{n:fmt(l[2])}):t('start'))}</span></div>`).join('')}
      </div>
      <p style="font-size:12px;color:var(--muted);margin-top:14px">${t('Each level costs about half again as much as the one before, and the names follow the classic latte-art progression: hearts, then tulips, then rosettas, then swans.')}</p>
    </div></div></div>`;
}
/* The streak sheet — what the number means, and the one place that asks
   for permission to nudge you about it.

   The ask lives HERE rather than behind a prompt on first launch on
   purpose. A notification permission dialog someone hasn't been given a
   reason for is denied roughly always, and a denial is permanent-ish:
   the browser won't ask twice, and undoing it means digging through site
   settings. So the prompt only ever fires from a tap on "Remind me",
   inside a sheet that has just explained what the reminder is for. */
function overlayStreak(){
  const s=streakInfo();
  /* Last 28 days, oldest first, so the row reads left-to-right like a
     calendar and today sits at the end where the eye lands. */
  const days=new Set(myPosts().map(p=>daysAgo(p.createdAt,p.ago)).filter(d=>d>=0));
  const dots=Array.from({length:28},(_,i)=>{
    const d=27-i;
    return `<i class="${days.has(d)?'on':''}${d===0?' today':''}" title="${d===0?t('Today'):d===1?t('Yesterday'):t('{n} days ago',{n:d})}"></i>`;
  }).join('');

  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${t('Streak')}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="${t('Back')}">${icon('back',20)}</button><b>${t('Your streak')}</b></div>
    <div class="ov-body"><div style="padding:14px 16px 20px">

      <div class="stk-hero">
        <div class="stk-hero-n">${icon('bolt',26)} ${s.days}</div>
        <div class="stk-hero-l">${tn(s.days,'day in a row','days in a row')}${s.poured?'':' · '+t('nothing logged today yet')}</div>
        <div class="stk-hero-b">${t('Best: {n} days.',{n:s.best})}</div>
      </div>

      <div class="rlabel" style="margin-top:18px">${t('Last four weeks')}</div>
      <div class="stk-cal">${dots}</div>

      <div class="rlabel" style="margin-top:18px">${t('Rest days')}</div>
      <p style="font-size:13px;color:var(--ink2);line-height:1.55;margin:0">
        ${t('Once a streak reaches {n} days, missing a single day will not end it. One rest day is forgiven, once. Two days in a row still starts you over.',{n:REST_AFTER})}
        ${s.rested?'<br><b>'+t('Your rest day is currently in use.')+'</b>'
                  :s.canRest?'<br><b>'+t('Your rest day is available.')+'</b>':''}
      </p>

      <div class="rlabel" style="margin-top:18px">${t('Reminders')}</div>
      ${remindersBlock()}

    </div></div></div>`;
}

/* The reminder controls, shared by the streak sheet and Settings.

   Every state this can be in says something specific, because "enable
   notifications" that silently does nothing is worse than no button:

     · no push support at all (old browser, or no VAPID key configured)
       — say so plainly and stop.
     · iOS in a Safari tab — Apple has no Web Push there at all. Ask for
       the Home Screen instead of showing a toggle that cannot work.
     · permission already denied — the browser will not re-prompt, so
       point at site settings rather than a button that no-ops.
     · granted — show the switches for what may be sent. */
function remindersBlock(){
  const p=ui.push||(ui.push={ enabled:false, busy:false });
  const note=x=>`<div class="mrow" style="cursor:default"><div class="mi">🔔</div>
    <div style="flex:1;font-size:13px;color:var(--ink2);font-weight:500;line-height:1.5">${x}</div></div>`;

  if(iosNeedsInstall()) return note(
    t('Add Crema to your Home Screen to get reminders: tap Share, then <b>Add to Home Screen</b>. Safari cannot send notifications from a browser tab on iPhone.'));
  if(!pushSupported()) return note(
    t('This browser cannot send notifications. The streak nudge still appears on Home when you open Crema.'));
  /* A live subscription outranks anything Notification.permission says.
     Under Play's Trusted Web Activity that string is delegated and reads
     'default' on a cold start while pushes keep arriving, so asking it
     first is how a device that is subscribed ends up being offered
     "Remind me" every launch. */
  if(p.enabled) return switches();
  /* Where to go and fix it depends on how Crema is running. Installed
     from Play, the Trusted Web Activity inherits the Android app's
     notification permission, so "your browser settings" is advice that
     leads nowhere — the switch is in Android's own app settings, and on
     Android 13+ it is a permission that can be declined at install or
     revoked later for an app that goes unused. */
  if(pushPermission()==='denied') return note(standalone()
    ? t('Notifications are switched off for Crema in your device settings. On Android: Settings, then Apps, then Crema, then Notifications. Turn them on there and this comes back.')
    : t('Notifications are blocked for Crema in your browser settings. Allow them there and this comes back.'));

  return `
    <p style="font-size:13px;color:var(--ink2);line-height:1.55;margin:0 0 10px">
      ${t('A nudge in the morning to log today\'s coffee, and one in the evening if your streak is about to lapse. Nothing else unless you ask for it.')}</p>
    <button class="btn block" data-action="push-on"${p.busy?' disabled':''}>${p.busy?t('Just a moment…'):t('Remind me')}</button>`;

  function switches(){
    const sw=(action,on,label,sub)=>`<div class="mrow" data-action="${action}">
      <div class="mi">${on?'🔔':'🔕'}</div>
      <div style="flex:1">${label}<div style="font-size:11.5px;color:var(--muted);font-weight:500">${sub}</div></div>
      <span class="swch${on?' on':''}"></span></div>`;

    return `${sw('toggle-notify-morning',state.me.notifyMorning,t('Morning coffee nudge'),t('If you have not logged one yet that day'))}
      ${sw('toggle-notify-social',state.me.notifySocial,t('Likes, comments &amp; follows'),t('When someone reacts to your coffee'))}
      ${sw('toggle-notify-streak',state.me.notifyStreak,t('Streak reminder'),t('Evenings, only when your streak is at risk'))}
      ${sw('toggle-notify-digest',state.me.notifyDigest,t('Weekly recap'),t('Monday morning, only if you poured that week'))}
      <button class="btn ghost block" style="margin-top:10px" data-action="push-off"${p.busy?' disabled':''}>${t('Turn off on this device')}</button>`;
  }
}

/* The bean passport — every coffee you have logged, in one place.
   Built from all of your pours, not the feed page. */
function overlayPassport(){
  const beans=beanPassport();
  const origins=[...new Set(beans.map(b=>b.cat&&b.cat.c).filter(Boolean))];
  const totalPours=beans.reduce((n,b)=>n+b.pours,0);
  const row=b=>{
    const known=!!b.cat;
    const sub=[b.cat&&b.cat.origin, b.cat&&b.cat.roast].filter(Boolean).join(' · ');
    return `<div class="rlist-row ${known?'click':''}"${known?` data-action="open-bean" data-id="${esc(b.name)}"`:''}>
      <div class="bean-fl">${(b.cat&&flag[b.cat.c])||'🫘'}</div>
      <div class="who" style="flex:1;min-width:0"><b>${esc(b.name)}</b>
        <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${sub?esc(sub):t('Your own coffee')}</span></div>
      <div class="rlist-val">${b.pours?`${b.pours} <small>${tn(b.pours,'pour','pours')}</small>`:`<small>${t('not logged yet')}</small>`}</div>
    </div>`;
  };
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${t('Bean passport')}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="${t('Back')}">${icon('back',20)}</button><b>${t('Bean passport')}</b></div>
    <div class="ov-body">
      <div class="bean-hero"><img src="${S.beans}" alt=""><div class="bean-hero-t">
        <span class="fl">🛂</span><div><b>${tn(beans.length,'{n} bean tried','{n} beans tried')}</b>
        <span>${tn(totalPours,'{n} pour','{n} pours')}${origins.length?' · '+tn(origins.length,'{n} origin','{n} origins'):''}</span></div></div></div>
      <div style="padding:16px">
        ${origins.length?`<div class="chips" style="margin:0 0 14px">${origins.map(c=>`<span class="chip">${flag[c]||'🫘'} ${esc(t(c))}</span>`).join('')}</div>`:''}
        ${beans.length
          ? `<div class="rlist">${beans.map(row).join('')}</div>
             <div style="font-size:12px;color:var(--muted);text-align:center;margin-top:12px">${t('Every coffee you have logged, most-poured first.')}</div>`
          : `<div class="empty"><div class="big">🫘</div>${t('No beans yet.')}<br>${t('Add the coffee you used when you log a pour and it lands here.')}<br><br>
             <button class="btn sm" data-action="open-create">${t('Log a coffee')}</button></div>`}
        <div style="height:8px"></div>
      </div></div></div>`;
}

function overlaySettings(){
  const m=state.me, th=state.theme||'auto';
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="${t('Settings')}">
    <div class="grab"></div>
    <div class="ov-bar" style="border:0"><b>${t('Settings')}</b><button class="iconbtn" data-action="close-ov" aria-label="${t('Close')}">${icon('x',20)}</button></div>
    <div class="ov-body" style="padding:0 16px 18px">
      <div class="rlabel">${t('Account')}</div>${accountBlock()}
      <div class="rlabel" style="margin-top:18px">${t('Profile')}</div>
      ${avatarField(m)}
      <div class="rowfields">
        <div class="field"><label>${t('Name')}</label><input id="sp-name" value="${esc(m.name)}" placeholder="${t('Your name')}"></div>
        <div class="field"><label>${t('Username')}</label><input id="sp-handle" value="${esc(USERS.me.handle)}"></div></div>
      <div class="field"><label>${t('Bio')}</label><textarea id="sp-bio" placeholder="${t('Say a little about your coffee…')}">${esc(m.bio)}</textarea></div>
      <div class="rowfields">
        <div class="field"><label>${t('City')}</label><input id="sp-city" value="${esc(m.city)}"></div>
        <div class="field sel"><label>${t('Go-to milk')}</label><select id="sp-milk">${MILK_LIST.map(x=>`<option${x===m.favMilk?' selected':''}>${x}</option>`).join('')}</select></div></div>
      ${machinePicker('sp',m.machineBrand,m.machineModel)}
      <button class="btn block" data-action="save-profile">${t('Save profile')}</button>
      <div class="rlabel" style="margin-top:18px">${t('Crema Premium')}</div>
      ${premiumBlock(m)}
      <div class="rlabel" style="margin-top:18px">${t('Appearance')}</div>
      <div class="seg">${[['auto',t('Auto')],['light',t('Light')],['dark',t('Dark')]].map(x=>`<button class="${th===x[0]?'on':''}" data-action="set-theme" data-t="${x[0]}">${x[1]}</button>`).join('')}</div>
      <div class="rlabel" style="margin-top:18px">${t('Reminders')}</div>
      ${remindersBlock()}
      <div class="rlabel" style="margin-top:18px">${t('About')}</div>
      <div class="mrow" data-action="open-scoring"><div class="mi">⭐</div>${t('How levels work')}</div>
      <div class="mrow" data-action="open-streak"><div class="mi">⚡</div>${t('How streaks work')}</div>
      <div style="font-size:11.5px;color:var(--muted);margin-top:14px;text-align:center">${t('Signed in · your pours live in your account')}</div>
      <div class="rlabel" style="margin-top:18px">${t('Legal')}</div>
      <a class="mrow" href="/impressum/" target="_blank" rel="noopener"><div class="mi">📄</div>Impressum</a>
      <a class="mrow" href="/privacy/" target="_blank" rel="noopener"><div class="mi">🔒</div>Datenschutz / Privacy Policy</a>
    </div></div>`;
}

/* The Premium block in Settings — the switch every 🔒 in the app points
   at, so it has to answer the question those locks raise: what is behind
   this, and what does it cost right now?

   It lists what Premium is rather than naming it, and says the free
   period in full sentences twice. Everything that makes a coffee log
   true — every drink, every machine, every coffee, including the ones
   we've never heard of — is deliberately NOT on this list: it is free,
   permanently, and a paywall in front of an honest record would be a
   worse product before it was ever a better business. */
function premiumBlock(m){
  const perks=[['📌',t('Pin your gear & coffees'),t('Hold the ones you use at the top of every picker')],
               ['🥤',t('Name your own drink types'),t('Ristretto, Bombón, whatever you actually order')],
               ['✦',t('Early access'),t('New features land here first')]];
  const list=perks.map(p=>`<div class="pm-perk"><span>${p[0]}</span><div><b>${p[1]}</b><i>${p[2]}</i></div></div>`).join('');
  if(m.premium) return `
    <div class="mrow" style="cursor:default;border-bottom:0"><div class="mi">✦</div>
      <div style="flex:1">${t('Premium active')}<div style="font-size:11.5px;color:var(--muted);font-weight:500">${t('Free for now. We will ask you before anything costs money.')}</div></div>
      <span class="lvlchip" style="background:var(--gold);color:var(--on-crema);border-color:transparent">ACTIVE</span></div>
    <div class="pm-card" style="margin:4px 0 8px">${list}</div>
    <button class="btn ghost block" data-action="toggle-premium">${t('Turn Premium off')}</button>`;
  return `<div class="pm-card on">
    <b style="font-family:var(--serif);font-size:16px;color:var(--st4)">✦ Crema Premium</b>
    <div style="font-size:12.5px;color:var(--ink2);margin:4px 0 10px">${t('Free for a limited time while Crema is young. Switch it on right here, with no card and no trial countdown. Billing comes later, and we will ask first.')}</div>
    ${list}
    <button class="btn block" style="margin-top:10px" data-action="toggle-premium">${t('Turn Premium on, free')}</button>
    <div style="font-size:11px;color:var(--muted);text-align:center;margin-top:8px">${t('Logging your coffee stays free for everyone, always, whatever the drink, the machine or the bean.')}</div></div>`;
}

/* Profile photo, in Settings next to the name it belongs to. Entirely
   optional — no photo is a first-class state, not an empty slot nagging
   to be filled, so the fallback is the initials avatar the app already
   draws and the only pressure to change it is the word "Add".

   The upload happens on pick, not on Save: it's a network round trip with
   its own failure mode, and burying it inside "Save profile" would make
   one button mean two things. */
function avatarField(m){
  const uploading=ui.avatarBusy;
  return `<div class="av-field">
    <div class="prof-av sm" style="background:${USERS.me.color};color:#fff;font-family:var(--serif);font-weight:600;font-size:22px">
      ${initials(USERS.me.name||t('You'))}${m.avatar?`<img src="${esc(imageUrl(m.avatar,'thumb'))}" alt="" onerror="this.remove()">`:''}
      ${uploading?`<span class="av-busy">…</span>`:''}</div>
    <div class="av-actions">
      <label class="btn ghost sm"><input type="file" id="sp-avatar" accept="image/*" hidden>${icon('cam',15)} ${m.avatar?t('Change photo'):t('Add a photo')}</label>
      ${m.avatar?`<button class="btn ghost sm" data-action="drop-avatar">${t('Remove')}</button>`:''}
      <div class="av-hint">${uploading?t('Uploading…'):t('Optional. Initials work fine.')}</div>
    </div></div>`;
}

/* Account block in Settings. Sign-in itself happens on the gate, before
   the app exists, so all that's left here is who you are and how to
   leave or change your password. */
function accountBlock(){
  const email=(session&&session.user&&session.user.email)||'';
  return `
    <div class="mrow" style="cursor:default"><div class="mi">☕</div>
      <div style="flex:1">${t('Signed in')}<div style="font-size:11.5px;color:var(--muted);font-weight:500">${esc(email||(session&&session.user&&session.user.id)||'')}</div></div>
      <span class="lvlchip" style="color:var(--green);border-color:var(--pm2);background:var(--pm1)">SYNCED</span></div>
    <div class="mrow" data-action="open-password"><div class="mi">🔑</div>${t('Change password')}</div>
    <button class="btn ghost block" style="margin-top:10px" data-action="sign-out">${t('Sign out')}</button>`;
}

/* Set a new password — reached from Settings, and where a
   password-reset link lands the user. */
function overlayPassword(){
  const p=ui.pw||(ui.pw={error:'',busy:false});
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="${t('Change password')}">
    <div class="grab"></div>
    <div class="ov-bar" style="border:0"><b>${t('Change password')}</b><button class="iconbtn" data-action="close-ov" aria-label="${t('Close')}">${icon('x',20)}</button></div>
    <div class="ov-body" style="padding:0 16px 18px">
      ${p.error?`<div style="background:rgba(168,84,74,.10);border:1px solid rgba(168,84,74,.28);color:var(--terra);border-radius:12px;padding:10px 12px;font-size:12.5px;margin-bottom:12px">${esc(p.error)}</div>`:''}
      <div class="field"><label>${t('New password')}</label><input id="pw-new" type="password" autocomplete="new-password" placeholder="${t('At least 8 characters')}" data-enter="pw-save"></div>
      <div class="field"><label>${t('Repeat it')}</label><input id="pw-again" type="password" autocomplete="new-password" placeholder="${t('Once more')}" data-enter="pw-save"></div>
      <button class="btn block"${p.busy?' disabled':''} data-action="pw-save">${p.busy?t('Saving…'):t('Save password')}</button>
      <div style="height:6px"></div>
    </div></div>`;
}
/* Runs once, right after the account is created: it is how the profile
   row gets a real name, username and city. Step 3 used to be "follow
   these five people" — with no invented accounts there is nobody to
   suggest, so the last step is the one that actually needs the user. */
function overlayOnboard(){
  const s=Math.min(2,ui.obStep||1);
  const err=ui.obError;
  const dots=`<div class="obdots">${[1,2].map(i=>`<i class="${i===s?'on':''}"></i>`).join('')}</div>`;
  let body='';
  if(s===1) body=`
    <div class="obhero">${logoMark(56)}<h1>${t('Welcome to Crema')}</h1><p>${t('Log the coffee you make and watch the habit build. The people here care about the same 30 seconds of the morning that you do.')}</p></div>
    ${err?`<div style="background:rgba(168,84,74,.10);border:1px solid rgba(168,84,74,.28);color:var(--terra);border-radius:12px;padding:10px 12px;font-size:12.5px;margin-bottom:12px">${esc(err)}</div>`:''}
    <div class="field"><label>${t('Your name')}</label><input id="ob-name" value="${esc(state.me.name)}" placeholder="${t('e.g. Alex Rivera')}" autocomplete="name"></div>
    <div class="rowfields">
      <div class="field"><label>${t('Username')}</label><input id="ob-handle" value="${esc(state.me.handle||'')}" placeholder="${t('yourname')}" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
      <div class="field"><label>${t('City')}</label><input id="ob-city" value="${esc(state.me.city)}" placeholder="${t('Your city')}"></div></div>
    <button class="btn block" data-action="ob-next">${t('Continue')}</button>`;
  if(s===2) body=`
    <h2 class="obh2">${t('Your setup')}</h2><p class="obsub">${t('New posts start with this filled in. You can change it any time in Settings.')}</p>
    ${machinePicker('ob',state.me.machineBrand,state.me.machineModel)}
    <div class="rowfields"><div class="field sel"><label>${t('Go-to drink')}</label><select id="ob-drink">${drinkOptions(state.me.favDrink,{allowAdd:false})}</select></div>
    <div class="field sel"><label>${t('Go-to milk')}</label><select id="ob-milk">${MILK_LIST.map(x=>`<option${x===state.me.favMilk?' selected':''}>${x}</option>`).join('')}</select></div></div>
    <div style="display:flex;gap:10px;margin-top:6px"><button class="btn ghost" data-action="ob-back">${t('Back')}</button><button class="btn" style="flex:1" data-action="ob-finish">${t('Start brewing')} ☕</button></div>`;
  return `<div class="ov-back"></div><div class="sheet" role="dialog" aria-label="${t('Welcome')}"><div class="ov-body" style="padding:26px 22px">${dots}${body}</div></div>`;
}

/* ============================================================
   The picker sheet — one control for both open-ended catalogues.

   There are more espresso machines than we will ever list and a new
   roastery every week, so the sheet is built around never needing the
   list to be complete:

     Yours      what you already use — most mornings it ends here
     Popular    a shortlist for the first ever pour
     Browse     brands, which just prefill the search
     Search     flat over brand + model, umlaut-folded (see norm())
     ＋ Add      whatever you typed, free, one tap, no second form

   The search box doubles as the add field on purpose: someone who has
   typed their bag's name in full has already done the work, and asking
   them to retype it into a text input below is the moment they give up
   and log the wrong coffee.
   ============================================================ */
function pickerRow(kind,value,sub,cur,pinnable){
  const on=value===cur;
  return `<div class="pk-row${on?' on':''}" data-action="pick" data-kind="${kind}" data-v="${esc(value)}">
    <span class="pk-i">${icon(kind==='machine'?'mach':'bean',17)}</span>
    <span class="pk-t"><b>${esc(value)}</b>${sub?`<span>${esc(sub)}</span>`:''}</span>
    ${pinnable?`<button class="pk-pin${isPinned(kind,value)?' on':''}" data-action="pin" data-kind="${kind}" data-v="${esc(value)}"
       aria-label="${isPinned(kind,value)?t('Unpin'):t('Pin to the top')}">📌</button>`:''}
    ${on?`<span class="pk-on">✓</span>`:''}</div>`;
}
const pkSection=(title,body,note)=>body?`<div class="pk-sec"><div class="pk-h">${title}${note?`<span>${note}</span>`:''}</div>${body}</div>`:'';

export function pickerList(){
  const p=ui.picker; if(!p) return '';
  const isM=p.kind==='machine', q=(p.q||'').trim(), cur=p.current||'';
  const sub=v=>{ if(isM) return ''; const c=beanCatalog(v); return c?c.roaster:t('Your own coffee'); };
  let h='';

  if(q){
    const hits=isM?searchMachines(q):searchBeans(q);
    h+=pkSection(tn(hits.length,'{n} match','{n} matches'),
      hits.map(x=>pickerRow(p.kind,isM?x.label:x.name,x.sub,cur,false)).join(''));
    /* Nothing found, or rows that aren't what they meant — either way
       the way out is the same, and it is never a dead end. The line
       under it has to match what is on screen: telling someone their
       coffee is "not in the list" directly below three matching rows
       reads as the search being broken, not as an offer. */
    const exact=isM?machineKnown(q):beanKnown(q);
    if(!exact) h+=`<div class="pk-add" data-action="pick-new" data-kind="${p.kind}">
      <span class="pk-i">＋</span>
      <span class="pk-t"><b>${t('Add “{q}”',{q:esc(q)})}</b><span>${hits.length
        ? (isM?t('None of these? Save it as your own machine'):t('None of these? Save it as your own coffee'))
        : (isM?t('Not in the list. Save it as your own machine'):t('Not in the list. Save it as your own coffee'))}</span></span></div>`;
    if(!hits.length) h+=`<div class="pk-empty">${isM
      ? t('Nothing in the catalogue matches that. Yours works just as well: it lands on your gear and is there next time.')
      : t('Nothing in the catalogue matches that. Yours works just as well: it lands on your shelf and is there next time.')}</div>`;
    return h;
  }

  const yours=isM?myMachines():myCoffees();
  /* Nothing to pin when there is one of something — the affordance would
     only ever say no. It appears with the second entry, which is also
     the first moment the order of this list matters. */
  const canPin=yours.length>1;
  h+=pkSection(t('Yours'), yours.map(v=>pickerRow(p.kind,v,sub(v),cur,canPin)).join(''),
    canPin?t('most recent first'):'');
  if(!state.me.premium&&canPin)
    h+=`<div class="pk-note" data-action="open-settings"><span>📌</span>
      <span>${t('Pin the ones you use most to hold them at the top. That is Premium, <u>free for now, switch it on in Settings</u>.')}</span></div>`;

  const pop=isM
    ? POPULAR_MACHINES.map(([b,m])=>({v:b+' '+m,s:b}))
    : popularBeans().map(n=>({v:n,s:sub(n)}));
  h+=pkSection(yours.length?t('Common ones'):t('Popular'),
    pop.filter(x=>!yours.includes(x.v)).map(x=>pickerRow(p.kind,x.v,x.s,cur,false)).join(''));

  /* Browsing is a search someone hasn't typed yet, so a brand doesn't
     open a sub-list — it fills the box and the results are already
     there, one screen, one mental model.

     Alphabetical, not catalogue order: this is the one list you scan
     rather than search, and scanning forty names for a brand you
     already know only works if you know where to look for it. */
  const brands=(isM?MACHINE_BRANDS.filter(b=>b!=='Other'):beanBrands().map(b=>b.name))
    .slice().sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
  h+=pkSection(isM?t('Browse by brand'):t('Browse by roaster'),
    `<div class="pk-brands">${brands.map(b=>`<button class="chip" data-action="pk-brand" data-b="${esc(b)}">${esc(b)}</button>`).join('')}</div>`);

  h+=`<div class="pk-add" data-action="pk-focus"><span class="pk-i">＋</span>
    <span class="pk-t"><b>${t('Not on the list?')}</b><span>${t('Type it above and add it as your own')}</span></span></div>`;
  if(cur) h+=`<div class="pk-clear" data-action="pick" data-kind="${p.kind}" data-v="">${t('Clear this field')}</div>`;
  return h;
}

function overlayPicker(){
  const p=ui.picker||{kind:'machine',q:''}, isM=p.kind==='machine';
  const n=isM?machineIndex().length:BEANS.length;
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="${isM?t('Choose a machine'):t('Choose a coffee')}">
    <div class="grab"></div>
    <div class="ov-bar" style="border:0"><b>${isM?t('Machine or brewer'):t('Coffee')}</b><button class="iconbtn" data-action="close-ov" aria-label="${t('Close')}">${icon('x',20)}</button></div>
    <div class="pk-search"><span>${icon('search',17)}</span>
      <input id="pk-q" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"
        placeholder="${isM?t('Search {n} machines & brewers',{n}):t('Search {n} coffees',{n})}" value="${esc(p.q||'')}"></div>
    <div class="ov-body" id="pk-list">${pickerList()}<div style="height:20px"></div></div>
  </div>`;
}

/* Who gets to see this pour. Two plain choices, phrased as who rather
   than as a setting — "Followers only" says what happens; "Private"
   would suggest nobody sees it. Whichever you pick becomes the default
   for next time (state.lastVisibility), because people post the same way
   most days and re-asking is re-litigating a decision already made. */
function visibilityPicker(c){
  const v=c.visibility==='followers'?'followers':'public';
  return `<div class="rlabel">${t('Who can see this')}</div>
    <div class="seg" style="margin:-4px 0 4px">
      <button class="${v==='public'?'on':''}" data-action="cvis" data-v="public">🌍 ${t('Everyone')}</button>
      <button class="${v==='followers'?'on':''}" data-action="cvis" data-v="followers">🔒 ${t('Followers only')}</button></div>
    <div style="font-size:11.5px;color:var(--muted);margin:0 2px 12px">${v==='public'
      ? t('Appears in Today, where anyone can find it.')
      : t('Only the followers you have accepted can see it, and it never appears in Today.')}</div>`;
}

/* The same sheet does double duty: with `editId` set it edits that pour
   instead of starting a new one. Everything except the photo is the same
   form, so an edit looks and behaves exactly like the post did — the
   camera row is simply not there, because the photo is not editable. */
function overlayCreate(){
  const c=ui.create||freshCreate(), isArt=!!DRINK_ART[c.drink], editing=!!c.editId;
  const pats=[['heart',t('Heart')],['rosetta',t('Rosetta')],['tulip',t('Tulip')],['swan',t('Swan')],['abstract',t('Abstract art')]];
  const mkList=(base,cur)=>{const l=base.slice(); if(cur&&!l.includes(cur))l.push(cur); return l;};
  const sel=(list,cur,ph,extra)=>`<option value=""${cur?'':' selected'}>${ph}</option>`+list.map(o=>`<option${o===cur?' selected':''}>${esc(o)}</option>`).join('')+(extra?`<option${cur===extra?' selected':''}>${extra}</option>`:'');
  const chosenCafe=(c.source==='cafe'&&c.cafe)?CAFES.find(x=>x.id===c.cafe):null;
  const milkOpts=chosenCafe?chosenCafe.menu.milks:MILK_LIST;
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="${editing?t('Edit coffee'):t('New coffee')}">
    <div class="grab"></div>
    <div class="ov-bar" style="border:0"><b>${editing?t('Edit coffee'):t('New coffee')}</b><button class="iconbtn" data-action="close-ov" aria-label="${t('Close')}">${icon('x',20)}</button></div>
    <div class="ov-body" style="padding:0 16px 16px">
      <div class="create-prev">
        ${c.img?`<img class="photo" src="${imageUrl(c.img,'feed')}" alt="${t('your coffee photo')}">`:cupSVG(isArt&&c.pattern?c.pattern:'none',.85,999)}
        ${c.img?(c.uploading?`<span class="up-hint">${t('Uploading…')}</span>`:(c.uploadFailed?`<span class="up-hint" style="background:rgba(168,84,74,.9)">${t('Upload failed')}</span>`:'')):(editing?'':`<span class="up-hint">${icon('cam',15)} ${t('Add a photo')}</span>`)}
      </div>
      ${!editing&&c.uploadFailed?`<div style="background:rgba(168,84,74,.10);border:1px solid rgba(168,84,74,.28);color:var(--terra);border-radius:12px;padding:10px 12px;font-size:12.5px;line-height:1.45;margin:10px 0 2px">
        ${t('That photo could not reach the server. Tap Post to try again, or drop it and post without a photo.')}
        <button class="btn ghost sm" style="margin-top:8px" data-action="drop-photo">${t('Post without the photo')}</button></div>`:''}
      ${editing?`<div style="font-size:11.5px;color:var(--muted);margin:10px 2px 12px">${t('The photo stays as it was poured. Everything else is yours to fix.')}</div>`
      :`<div class="photo-actions">
        <label class="btn ghost sm"><input type="file" id="c-photo-cam" accept="image/*" capture="environment" hidden>${icon('cam',16)} ${c.img?t('Retake'):t('Take photo')}</label>
        <label class="btn ghost sm"><input type="file" id="c-photo-lib" accept="image/*" hidden>🖼️ ${c.img?t('Change'):t('Gallery')}</label>
      </div>`}
      <div class="field sel"><label>${t('Drink')}</label><select id="c-drink">${drinkOptions(c.drink)}</select></div>
      ${c.drink===ADD_DRINK?`<div class="field"><label>${t('Your drink')}</label><input id="c-drink-custom" placeholder="${t('e.g. Ristretto')}" value="${esc(c.drinkCustom)}"></div>`:''}
      ${premiumNote(t('Naming a drink of your own'))}
      ${isArt?`<div class="field"><label>${t('Latte art')} <span style="text-transform:none;letter-spacing:0;color:var(--muted)">· ${t('only if you poured one, tap to toggle')}</span></label>
        <div class="patpick">${pats.map(p=>`<button class="${c.pattern===p[0]?'on':''}" data-action="cpat" data-p="${p[0]}">${cupSVG(p[0],.9,p[0].charCodeAt(0),{noCup:true})}<span>${p[1]}</span></button>`).join('')}</div>
        ${c.pattern?'':`<div style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">${t('No art? Leave these alone and your {drink} posts without a pattern.',{drink:esc((c.drink||t('coffee')).toLowerCase())})}</div>`}</div>`:''}
      ${CAFES.length?`<div class="rlabel">${t('Where did you have it?')}</div>
      <div class="seg" style="margin:-4px 0 12px">
        <button class="${c.source==='home'?'on':''}" data-action="csource" data-s="home">🏠 ${t('I made it')}</button>
        <button class="${c.source==='cafe'?'on':''}" data-action="csource" data-s="cafe">☕ ${t('At a café')}</button></div>`:''}
      ${c.source==='cafe'?`<div class="field sel"><label>${t('Café')}</label><select id="c-cafe"><option value=""${c.cafe?'':' selected'}>${t('Choose a café…')}</option>${CAFES.map(cf=>`<option value="${cf.id}"${cf.id===c.cafe?' selected':''}>${cf.name} · ${cf.area}</option>`).join('')}</select></div>`:''}
      ${HAS_MILK.has(c.drink)?`<div class="field sel"><label>${t('Milk')}</label><select id="c-milk">${sel(mkList(milkOpts,c.milk),c.milk,t('Optional'))}</select></div>`:''}
      <div class="field"><label>${t('Caption')}</label><textarea id="c-caption" placeholder="${t('Say something about this coffee…')}">${esc(c.caption)}</textarea></div>
      ${visibilityPicker(c)}
      ${c.source==='cafe' ? (chosenCafe?`
      <div class="rlabel">${t('{cafe}\'s setup',{cafe:esc(chosenCafe.name)})} <span>· ${t('what they are pouring')}</span></div>
      <div class="field sel"><label>${t('Bean')}</label><select id="c-bean">${sel(chosenCafe.menu.beans,c.bean,t('Which bean did you have?'))}</select></div>
      ${chosenCafe.menu&&chosenCafe.menu.machine?`<div class="recipe-panel open" style="margin:0"><div class="recipe-grid">
        <div class="recipe-mach"><span>${t('Machine')}</span><b>${esc(chosenCafe.menu.machine)}</b></div></div></div>`:''}
      <div style="font-size:11.5px;color:var(--muted);margin:8px 2px 2px">${t('Your pour will be tagged 📍 {cafe}',{cafe:esc(chosenCafe.name)})}</div>`
      : `<div style="font-size:12.5px;color:var(--muted);margin:2px 2px 10px">${t('Pick a café above to load the beans and gear they use.')}</div>`)
      : `
      <div class="rlabel">${t('Recipe')} <span>· ${t('optional, add only what you know')}</span></div>
      ${beanPicker('c',c.bean)}
      ${machinePicker('c',c.machineBrand,c.machineModel)}
      <div class="rowfields">
        <div class="field"><label>${t('Dose in')}</label><input id="c-dose" inputmode="decimal" placeholder="—" value="${esc(withUnit(c.dose,'g'))}"></div>
        <div class="field"><label>${t('Yield out')}</label><input id="c-yield" inputmode="decimal" placeholder="—" value="${esc(withUnit(c.yield,'g'))}"></div>
        <div class="field"><label>${t('Time')}</label><input id="c-time" inputmode="decimal" placeholder="—" value="${esc(withUnit(c.time,'s'))}"></div>
        <div class="field"><label>${t('Temp')}</label><input id="c-temp" inputmode="decimal" placeholder="—" value="${esc(withUnit(c.temp,'°'))}"></div></div>`}
      <button class="btn block" style="margin-top:12px" data-action="submit-post">${editing?t('Save changes'):`${icon('bolt',18)} ${t('Post it')}`}</button>
      ${editing?`<button class="btn ghost block" style="margin-top:8px" data-action="close-ov">${t('Cancel')}</button>`:''}
      <div style="height:8px"></div>
    </div></div>`;
}
