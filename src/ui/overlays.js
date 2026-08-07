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
const GUEST_ASK={
  like:     ['Sign in to like this','A heart is the smallest way to say you saw it.'],
  react:    ['Sign in to react','Say which part you loved — the art, the spot, the coffee.'],
  comment:  ['Sign in to join in','Comments are people talking about coffee. Bring yours.'],
  save:     ['Sign in to keep this','Save a pour and its recipe is one tap away tomorrow morning.'],
  follow:   ['Sign in to follow','Follow someone and their mornings show up in your feed.'],
  post:     ['Sign in to log your coffee','A photo, the drink, and you\'re done. Day one of the streak.'],
  following:['Sign in for your own feed','Following is the coffee of the people you picked.'],
  profile:  ['Sign in for your profile','Your pours, your streak, your beans, your level.'],
  people:   ['Sign in to see people','Profiles, followers, and who poured what.'],
  explore:  ['Sign in to explore','Today\'s podium, this week\'s challenges, people to follow.'],
  cafe:     ['Sign in for cafés','Follow the places you drink at and see what gets poured there.'],
  notifs:   ['Sign in for your inbox','Likes, comments and follows land here.'],
  general:  ['Create your Crema account','Free, and about a minute. Then everything here is yours too.']
};
function overlaySignin(why){
  const [h,s]=GUEST_ASK[why]||GUEST_ASK.general;
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="Sign in">
    <div class="ov-body" style="padding:26px 20px 22px;text-align:center">
      ${logoMark(46)}
      <h2 style="font-family:var(--serif);font-weight:400;font-size:25px;letter-spacing:-.02em;margin:12px 0 6px">${esc(h)}</h2>
      <p style="color:var(--ink2);font-size:14px;line-height:1.55;margin:0 auto 20px;max-width:280px">${esc(s)}</p>
      <button class="btn block" data-action="guest-signin" data-m="up">Create your account</button>
      <button class="btn ghost block" style="margin-top:9px" data-action="guest-signin" data-m="in">I already have one</button>
      <div style="margin-top:16px;font-size:13px;color:var(--muted);cursor:pointer" data-action="close-ov">Keep looking around</div>
    </div></div>`;
}

function overlayPost(id){
  const p=findPost(id); if(!p) return '';
  const u=userOf(p.user), r=p.recipe, rows=recipeRows(r);
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="Post">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="Back">${icon('back',20)}</button><b>Post</b>
      <button class="act" data-action="share-post" data-id="${p.id}" aria-label="Share">${icon('send',20)}</button>
      ${likeButton(p)}</div>
    <div class="ov-body">
      <div class="media" data-action="none">${art(imageUrl(p.img,'hero'),p.pattern,p.quality,seedOf(p.id),p.drink)}<div class="heartpop" id="hp-${p.id}">${icon('heartF',90)}</div></div>
      <div class="p-head">
        <div class="idwrap" data-action="open-user" data-id="${p.user}">${avatar(p.user)}
          <div class="who"><b>${esc(u.name)} <span class="lvlchip">Lv${u.level}</span></b><span>${esc(u.handle)}${p.cafe?` · at ${esc(p.cafe)}`:''} · ${p.ago}${editedMark(p)}${privateMark(p)}</span></div></div>
        ${p.user==='me'?'':followMini(p.user)}
        <button class="kebab" data-action="open-menu" data-id="${p.id}" aria-label="More options">⋯</button></div>
      <div class="p-body"><div class="cap"><b>${esc(u.name)}</b> ${mentionify(p.caption)}</div>
        <div class="chips"><span class="chip drinkchip">${esc(p.drink||'Coffee')}</span>${p.art&&p.pattern?`<span class="chip tag" data-action="open-tag" data-id="${p.pattern}">#${p.pattern}</span>`:''}${r&&r.milk?`<span class="chip">🥛 ${esc(r.milk)}</span>`:''}${p.cafe?`<span class="chip">📍 ${esc(p.cafe)}</span>`:''}</div></div>
      ${reactionBar(p)}
      ${rows.length?`<div class="scoreblk" style="padding-top:0"><div class="recipe-panel open" style="margin:0">${recipePanel(r)}
        <div style="padding:9px 12px;background:var(--surface)"><button class="btn ghost sm" data-action="brew" data-id="${p.id}">☕ Brew this recipe</button></div></div></div>`:''}
      <div style="padding:14px 14px 4px;font-weight:700;font-family:var(--serif);font-size:16px">${commentCount(p)} comments</div>
      <div id="cmt-list">${p.comments.length?p.comments.map((c,i)=>commentRow(c,p.id,i)).join(''):
        (commentCount(p)?`<div class="empty" style="padding:24px">Loading comments…</div>`
          :`<div class="empty" style="padding:24px">${session?'Be the first to comment.':'No comments yet.'}</div>`)}</div>
    </div>
    <div class="mentions" id="cmt-mentions" hidden></div>
    ${session
      ? `<div class="composer">${avatar('me')}<input id="cmt-input" placeholder="Add a comment… use @ to name someone" data-enter="add-cmt" data-id="${p.id}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Add a comment"><button class="send" data-action="add-cmt" data-id="${p.id}" aria-label="Send">${icon('sendF',20)}</button></div>`
      /* A guest gets the thread and a bar that says why they can't add to
         it, rather than a text field that takes their sentence and then
         asks who they are. This one goes straight to the gate: it has
         already made the ask the sheet would have made. */
      : `<div class="composer guest" data-action="guest-signin" data-m="up" role="button" tabindex="0">
          <span>Sign in to join the conversation</span><b>Sign in</b></div>`}
  </div>`;
}

function overlayCafe(id){
  const c=CAFES.find(x=>x.id===id); if(!c) return '';
  const followed=state.cafeFollow[id], tagged=allPosts().filter(p=>p.cafe===c.name);
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${c.name}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="Back">${icon('back',20)}</button><b>${c.name}</b></div>
    <div class="ov-body">
      <div style="height:130px;background:linear-gradient(135deg,${c.color},#24170F);position:relative"><div style="position:absolute;left:16px;bottom:-26px">${cafeThumb(c)}</div></div>
      <div style="padding:34px 16px 8px"><b style="font-family:var(--serif);font-size:22px">${c.name}</b>
        <div style="color:var(--muted);font-size:13px;margin:3px 0 10px">${c.spec} · ${c.area}, ${c.city}</div>
        <div class="chips" style="margin:0 0 12px"><span class="chip"><span class="star">★ ${c.rating}</span></span><span class="chip">${fmt(c.followers)} followers</span>${c.hours?`<span class="chip" style="color:${c.hours.startsWith('Open')?'var(--green)':'var(--terra)'}">${esc(c.hours)}</span>`:''}</div>
        <p style="font-size:14px;line-height:1.55;color:var(--ink2);margin:0 0 14px">${c.blurb}</p>
        ${c.promo?`<div style="background:var(--pm1);border:1px solid var(--pm2);border-radius:14px;padding:12px 14px;margin-bottom:14px;display:flex;gap:10px;align-items:center"><span style="font-size:26px">🎟️</span><div><b style="color:var(--green)">10% off any drink</b><div style="font-size:12.5px;color:var(--green)">Show any post tagged here at the counter.</div></div></div>`:''}
        <div style="display:flex;gap:10px"><button class="btn ${followed?'ghost':''} block" data-action="follow-cafe" data-id="${c.id}">${followed?'✓ Following':'Follow café'}</button><button class="btn ghost" data-action="directions" data-id="${c.id}" aria-label="Directions">🧭</button></div></div>
      <div class="section-h" style="margin:14px 16px 10px"><h2>Community pours here</h2></div>
      ${tagged.length?`<div class="grid" style="padding:0 16px 20px">${tagged.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`:`<div class="empty" style="padding:10px 16px 26px">No pours tagged here yet — be the first!</div>`}
    </div></div>`;
}

function overlayBean(name){
  const b=BEANS.find(x=>x.n===name); if(!b) return '';
  const matches=myPosts().filter(p=>{const rb=p.recipe&&p.recipe.bean; return rb&&(rb===b.n||rb.indexOf(b.n)===0||b.n.indexOf(rb)===0);});
  const rows=[['Origin',b.origin],['Roast level',b.roast],['Availability',b.loc==='INT'?'Sold in Germany':'Roasted in Germany']];
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${esc(b.n)}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="Back">${icon('back',20)}</button><b>${b.n}</b></div>
    <div class="ov-body">
      <div class="bean-hero"><img src="${S.beans}" alt=""><div class="bean-hero-t"><span class="fl">${flag[b.c]||'🫘'}</span><div><b>${b.n}</b><span>${esc(b.origin||'')}</span></div></div></div>
      <div style="padding:16px">
        <div class="section-h" style="margin:2px 0 10px"><h2>Tasting notes</h2></div>
        <div class="chips">${b.notes.map(t=>`<span class="chip tag">${t}</span>`).join('')}</div>
        <div class="section-h" style="margin:18px 0 10px"><h2>Details</h2></div>
        <div class="recipe-panel open" style="margin:0"><div class="recipe-grid">${rows.map(r=>`<div><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')}</div></div>
        <div class="section-h" style="margin:18px 0 10px"><h2>Your pours with this bean</h2></div>
        ${matches.length?`<div class="grid">${matches.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`:`<div class="empty" style="padding:22px 0">No pours logged with this bean yet.</div>`}
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
  const first=esc((u.name||'').split(' ')[0]||'They');
  const pending=rel==='pending';
  return `<div class="lockcard">
    <div class="big">${pending?'⏳':'🔒'}</div>
    <b>${pending?`Waiting on ${first}`:`Follow ${first} to see their pours`}</b>
    <span>${pending
      ? 'Your request is in. The moment they accept, their pours and recipes show up here.'
      : 'Their pours, recipes and bio are only for people they\'ve accepted as followers.'}</span>
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
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="Back">${icon('back',20)}</button><b>${u.name}</b></div>
    <div class="ov-body">
      <div style="height:96px;background:linear-gradient(135deg,${u.color},#24170F)"></div>
      <div style="padding:0 16px 20px">
        <div style="display:flex;align-items:flex-end;gap:12px;margin-top:-28px">
          ${avatar(uid,'xl')}
          ${followBtn(uid,'sm','margin-left:auto')}</div>
        <div style="margin-top:10px"><b style="font-family:var(--serif);font-size:22px">${esc(u.name)}</b> <span class="lvlchip">Lv${u.level}</span>
          <div style="color:var(--muted);font-size:13px;margin:2px 0 8px">${esc(u.handle)}${open&&u.city?` · 📍 ${esc(u.city)}`:''}</div>
          ${open&&u.bio?`<p style="font-size:13.5px;color:var(--ink2);line-height:1.5;margin:0 0 12px">${esc(u.bio)}</p>`:''}</div>
        <div class="stats">${open?`<div><b>${fmt(u.pourN)}</b><span>Pours</span></div>`:''}<div><b>${fmt(u.followerN)}</b><span>Followers</span></div><div><b>${u.levelName}</b><span>Level ${u.level}</span></div></div>
        ${open?`<div class="section-h"><h2>Recent pours</h2></div>
        ${theirs.length?`<div class="grid">${theirs.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`:`<div class="empty">No pours yet.</div>`}`
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
      ? `<div class="nact"><button class="btn sm" data-action="accept-follow" data-id="${n.u}">Accept</button>
         <button class="btn ghost sm" data-action="decline-follow" data-id="${n.u}">Decline</button></div>` : '';
    return `<div class="nrow ${n.read?'':'unread'}" ${ask?'':`data-action="notif-go" data-idx="${i}"`}>${av}
      <div class="nb"><div class="nt">${n.u?`<b>${esc(userOf(n.u).name)}</b> `:''}${esc(n.text)}</div><span>${n.time} ago</span>${ask}</div></div>`;}).join('');
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="Notifications">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="Back">${icon('back',20)}</button><b>Notifications</b></div>
    <div class="ov-body">${rows||`<div class="empty"><div class="big">🔔</div>All caught up.</div>`}</div></div>`;
}

function overlayMenu(id){
  const p=findPost(id); if(!p) return '';
  const mine=p.user==='me', who=userOf(p.user);
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="Post options">
    <div class="grab"></div>
    <div class="ov-body" style="padding:4px 18px 18px">
      <div class="mrow" data-action="menu-copy" data-id="${id}"><div class="mi">🔗</div>Copy link</div>
      ${p.recipe?`<div class="mrow" data-action="brew" data-id="${id}"><div class="mi">☕</div>Brew this recipe</div>`:''}
      <div class="mrow" data-action="menu-save" data-id="${id}"><div class="mi">🔖</div>${p.saved?'Remove from saved':'Save to collection'}</div>
      ${mine&&canEdit(p)?`<div class="mrow" data-action="menu-edit" data-id="${id}"><div class="mi">✏️</div>Edit this pour</div>`:''}
      ${mine?`<div class="mrow danger" data-action="menu-delete" data-id="${id}"><div class="mi">🗑️</div>Delete this pour</div>`
            :`<div class="mrow danger" data-action="menu-report" data-id="${id}"><div class="mi">🚩</div>Report</div>
              <div class="mrow danger" data-action="menu-block" data-id="${p.user}"><div class="mi">🚫</div>Block ${esc((who&&who.name||'this person').split(' ')[0])}</div>`}
      <button class="btn ghost block" style="margin-top:14px" data-action="close-ov">Cancel</button>
    </div></div>`;
}

/* Reporting writes a `reports` row now. A moderation route has to exist
   before store review, not after. */
const REPORT_REASONS=[
  ['spam','Spam or misleading'],
  ['harassment','Harassment or hate'],
  ['nudity','Nudity or sexual content'],
  ['violence','Violence or self-harm'],
  ['ip','Not their content'],
  ['other','Something else']
];
function overlayReport(id){
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="Report">
    <div class="grab"></div>
    <div class="ov-bar" style="border:0"><b>Report this pour</b><button class="iconbtn" data-action="close-ov" aria-label="Close">${icon('x',20)}</button></div>
    <div class="ov-body" style="padding:0 18px 18px">
      <p style="font-size:13px;color:var(--ink2);line-height:1.5;margin:0 0 12px">Thanks for helping keep Crema kind. Reports are reviewed by a human — the author isn't told who reported them.</p>
      ${REPORT_REASONS.map(r=>`<div class="mrow" data-action="report-send" data-id="${id}" data-reason="${r[0]}"><div class="mi">🚩</div>${r[1]}</div>`).join('')}
      <button class="btn ghost block" style="margin-top:14px" data-action="close-ov">Cancel</button>
    </div></div>`;
}

function overlayTag(pat){
  const list=allPosts().filter(p=>p.art&&p.pattern===pat);
  const ch=CHALLENGES.find(c=>c.pattern===pat);
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="#${pat}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="Back">${icon('back',20)}</button><b>#${pat}</b></div>
    <div class="ov-body"><div style="padding:14px 16px 20px">
      <div style="font-size:13px;color:var(--muted);font-weight:600;margin-bottom:8px">${list.length} pour${list.length===1?'':'s'}</div>
      ${ch?`<button class="btn sm" style="margin-bottom:12px" data-action="open-challenge" data-id="${ch.id}">🎯 ${ch.title} — this week's challenge</button>`:''}
      ${list.length?`<div class="grid">${list.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`:
        `<div class="empty"><div class="big">🎨</div>No ${pat} pours yet — be the first!<br><br><button class="btn sm" data-action="open-create">Post a pour</button></div>`}
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
  if(!isFinite(ms)||ms<=0) return 'ending';
  const h=Math.floor(ms/36e5);
  if(h<1) return 'under an hour';
  if(h<24) return h+'h';
  const d=Math.round(h/24);
  return d+' day'+(d===1?'':'s');
}

const CAT_LABEL={ habit:'Habit', craft:'Craft', discovery:'Discovery' };

/* The bar plus its numbers. `done` wins over the count: a finished
   challenge says so rather than showing 3/3 and leaving you to work it
   out. */
function progressBar(ch){
  const pct=ch.goal?Math.round(100*ch.progress/ch.goal):0;
  return `<div class="chp">
    <div class="chp-bar"><i style="width:${ch.done?100:pct}%"></i></div>
    <div class="chp-n">${ch.done?`<b class="chp-done">✓ Done · +${ch.points}</b>`
                                :`<b>${ch.progress}</b> / ${ch.goal}`}</div>
  </div>`;
}

/* A card for Explore and the all-challenges sheet. */
export function challengeCard(ch){
  return `<div class="chcard${ch.done?' done':''}" data-action="open-challenge" data-id="${ch.id}">
    <div class="chcard-cup">${cupSVG(ch.pattern,.9,ch.id.length)}</div>
    <div class="chcard-b">
      <div class="chcard-h"><span class="chcat">${CAT_LABEL[ch.cat]||''}</span><span class="chpts">+${ch.points}</span></div>
      <b>${esc(ch.title)}</b>
      <div class="chcard-s">${esc(ch.blurb)}</div>
      ${progressBar(ch)}
      <div class="chcard-f">${ch.done?'Earned this week':`${endsIn(ch)} left`}</div>
    </div></div>`;
}

/* What actually counts toward this rule, in the app's own words. The
   challenge blurb sells it; this explains it, so nobody has to guess
   whether a cortado counts as a different drink. */
const RULE_TEXT={
  days:          g=>`Log a coffee on ${g} different days.`,
  pours:         g=>`Log ${g} coffees in total.`,
  hour_before:  (g,p)=>`Log a coffee before ${p}:00 your time, on ${g} different days. Anything before 4am counts as the night before.`,
  hour_after:   (g,p)=>`Log a coffee after ${p}:00 your time, on ${g} different days.`,
  weekend:       ()=>`Log a coffee on Saturday and again on Sunday.`,
  pattern:      (g,p)=>`Post ${g} latte-art pours with a ${p}.`,
  art:           g=>`Post ${g} pours with latte art, any pattern.`,
  recipe:        g=>`Post ${g} pours with dose, yield and time all filled in.`,
  caption:       g=>`Post ${g} pours with a note of at least 20 characters.`,
  drinks:        g=>`Log ${g} different drinks.`,
  beans:         g=>`Brew ${g} different coffees.`,
  milks:         g=>`Use ${g} different milks.`,
  cafes:         g=>`Log a coffee at ${g} different cafés.`,
  countries:     g=>`Brew beans grown in ${g} different countries. Coffees the catalogue doesn't know the origin of can't count.`,
  roasters:      g=>`Brew coffee from ${g} different roasters.`,
  new_bean:      g=>`Log ${g} coffee you have never logged before.`,
  comments:      g=>`Leave ${g} comments on other people's coffee. Your own don't count.`
};
const ruleText = ch => (RULE_TEXT[ch.kind]||(()=>'Keep pouring.'))(ch.goal, ch.param);

function overlayChallenge(id){
  const ch=CHALLENGES.find(c=>c.id===id); if(!ch) return '';
  const left=ch.goal-ch.progress;
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${esc(ch.title)}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="Back">${icon('back',20)}</button><b>${esc(ch.title)}</b></div>
    <div class="ov-body"><div style="padding:0 16px 20px">
      <div class="ch-top" style="height:150px;border-radius:16px;margin-top:14px">${cupSVG(ch.pattern,.92,ch.id.length)}<span class="ends">${ch.done?'Complete':endsIn(ch)+' left'}</span></div>
      <div style="margin:14px 2px 4px">
        <b style="font-family:var(--serif);font-size:22px">${esc(ch.title)}</b>
        <div class="chips" style="margin:8px 0">
          <span class="chip">${CAT_LABEL[ch.cat]||''}</span>
          <span class="chip tag">${esc(ch.tag)}</span>
          <span class="chip" style="color:var(--st4);border-color:var(--st3);background:var(--st1)">+${ch.points} points</span>
          ${ch.done?'<span class="chip" style="color:var(--green)">✓ Earned</span>':''}</div>
        <p style="font-size:13.5px;color:var(--ink2);line-height:1.5;margin:4px 0 14px">${esc(ch.blurb)}</p>
        ${progressBar(ch)}
        <div class="chrule">
          <div class="rlabel" style="margin:0 0 4px">What counts</div>
          <div>${esc(ruleText(ch))}</div>
        </div>
        ${ch.done
          ? `<div class="chdone">✓ Finished — ${ch.points} points are already on your score.${ch.raw>ch.goal?` You got to ${ch.raw}.`:''}</div>`
          : `<div style="font-size:12.5px;color:var(--muted);margin:10px 2px 12px">${left} to go. Nothing to enter — your pours count on their own.</div>
             <button class="btn block" data-action="open-create">Log a coffee</button>`}
      </div>
    </div></div></div>`;
}

function overlayChallenges(){
  const list=CHALLENGES;
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="Challenges">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="Back">${icon('back',20)}</button><b>This week</b></div>
    <div class="ov-body"><div style="padding:14px 16px 20px">
      ${list.length?list.map(challengeCard).join('')
        :`<div class="empty"><div class="big">🎯</div>${challenges.loaded?'No challenges running right now.<br>Three new ones land every Monday.':'Loading challenges…'}</div>`}
      <div style="font-size:12px;color:var(--muted);text-align:center;margin-top:14px">
        Three challenges a week, one of each kind. They start every Monday and score themselves from the coffee you log.</div>
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
  const title=following?'Following':'Followers';
  const empty=!social.listsLoaded
    ? `<div class="empty">Loading…</div>`
    : `<div class="empty"><div class="big">👥</div>${following
        ?'Not following anyone yet.<br>Find people on Explore.'
        :'No followers yet.<br>Share your pours to get discovered.'}</div>`;
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${title}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="Back">${icon('back',20)}</button><b>${title}</b></div>
    <div class="ov-body"><div style="padding:14px 16px 20px">
      ${list.length?`<div class="rlist">${list.map(u=>`<div class="rlist-row click" data-action="open-user" data-id="${u.id}">${avatar(u.id)}
        <div class="who" style="flex:1"><b>${esc(u.name)}</b><span>${esc(u.handle)}${u.city?' · '+esc(u.city):''}</span></div>
        ${followBtn(u.id)}</div>`).join('')}</div>`
        :empty}
    </div></div></div>`;
}
function overlayScoring(){
  const pts=state.me.points|0, cur=levelOf(pts), next=nextLevel(pts), pct=Math.round(levelProgress(pts)*100);
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="Levels">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="Back">${icon('back',20)}</button><b>Levels & points</b></div>
    <div class="ov-body"><div style="padding:14px 16px 20px">
      <p style="font-size:13.5px;color:var(--ink2);line-height:1.55;margin:0 0 14px">Your level grows as you post and practise — a friendly badge of how far your craft has come, not a grade.</p>
      <div class="lvlbar" style="margin-top:0">
        <div class="top"><b>Level ${cur[0]} · ${cur[1]}</b><span>${fmt(pts)} pts</span></div>
        <div class="track"><i style="width:${pct}%"></i></div>
        <div style="font-size:11.5px;color:var(--muted);font-weight:600;margin-top:6px">${next
          ? `${fmt(next[2]-pts)} points to Level ${next[0]} · ${next[1]}`
          : 'Top of the ladder — nothing left to climb.'}</div>
      </div>
      <div class="rlabel" style="margin-top:18px">How points are earned</div>
      <div class="rlist" style="margin-bottom:4px">${POINT_RULES.map(r=>`<div class="rlist-row">
        <div style="flex:1"><b style="font-size:14px">${r[0]}</b></div><div class="rlist-val">${r[1]}</div></div>`).join('')}</div>
      <div class="rlabel" style="margin-top:18px">The ladder</div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${LEVELS.map(l=>`<div class="lvlrow ${l[0]===cur[0]?'now':''}"><div class="ln">${l[0]}</div><b>${l[1]}</b>
          <span style="margin-left:auto;font-size:11.5px;color:var(--muted);font-weight:700">${l[0]===cur[0]?'you are here':(l[2]?fmt(l[2])+' pts':'start')}</span></div>`).join('')}
      </div>
      <p style="font-size:12px;color:var(--muted);margin-top:14px">Each level costs about half again as much as the one before, and the names follow the classic latte-art progression: hearts → tulips → rosettas → swans.</p>
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
    return `<i class="${days.has(d)?'on':''}${d===0?' today':''}" title="${d===0?'Today':d===1?'Yesterday':d+' days ago'}"></i>`;
  }).join('');

  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="Streak">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="Back">${icon('back',20)}</button><b>Your streak</b></div>
    <div class="ov-body"><div style="padding:14px 16px 20px">

      <div class="stk-hero">
        <div class="stk-hero-n">${icon('bolt',26)} ${s.days}</div>
        <div class="stk-hero-l">${s.days===1?'day':'days'} in a row${s.poured?'':' · nothing logged today yet'}</div>
        <div class="stk-hero-b">Best: ${s.best} ${s.best===1?'day':'days'}</div>
      </div>

      <div class="rlabel" style="margin-top:18px">Last four weeks</div>
      <div class="stk-cal">${dots}</div>

      <div class="rlabel" style="margin-top:18px">Rest days</div>
      <p style="font-size:13px;color:var(--ink2);line-height:1.55;margin:0">
        Once a streak reaches ${REST_AFTER} days, missing a single day won't end it — one rest day
        is forgiven, once. Two days in a row still starts you over.
        ${s.rested?'<br><b>Your rest day is currently in use.</b>'
                  :s.canRest?'<br><b>Your rest day is available.</b>':''}
      </p>

      <div class="rlabel" style="margin-top:18px">Reminders</div>
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
  const note=t=>`<div class="mrow" style="cursor:default"><div class="mi">🔔</div>
    <div style="flex:1;font-size:13px;color:var(--ink2);font-weight:500;line-height:1.5">${t}</div></div>`;

  if(iosNeedsInstall()) return note(
    `Add Crema to your Home Screen to get reminders — tap Share, then <b>Add to Home Screen</b>.
     Safari can't send notifications from a browser tab on iPhone.`);
  if(!pushSupported()) return note(
    `This browser can't send notifications. The streak nudge still appears on Home when you open Crema.`);
  /* Where to go and fix it depends on how Crema is running. Installed
     from Play, the Trusted Web Activity inherits the Android app's
     notification permission, so "your browser settings" is advice that
     leads nowhere — the switch is in Android's own app settings, and on
     Android 13+ it is a permission that can be declined at install or
     revoked later for an app that goes unused. */
  if(pushPermission()==='denied') return note(standalone()
    ? `Notifications are switched off for Crema in your device settings.
       On Android: Settings → Apps → Crema → Notifications. Turn them on there and this comes back.`
    : `Notifications are blocked for Crema in your browser settings. Allow them there and this comes back.`);

  if(!p.enabled) return `
    <p style="font-size:13px;color:var(--ink2);line-height:1.55;margin:0 0 10px">
      One nudge in the evening if your streak is about to lapse — nothing else unless you ask.</p>
    <button class="btn block" data-action="push-on"${p.busy?' disabled':''}>${p.busy?'Just a moment…':'Remind me'}</button>`;

  const sw=(action,on,label,sub)=>`<div class="mrow" data-action="${action}">
    <div class="mi">${on?'🔔':'🔕'}</div>
    <div style="flex:1">${label}<div style="font-size:11.5px;color:var(--muted);font-weight:500">${sub}</div></div>
    <span class="swch${on?' on':''}"></span></div>`;

  return `${sw('toggle-notify-social',state.me.notifySocial,'Likes, comments &amp; follows','When someone reacts to your coffee')}
    ${sw('toggle-notify-streak',state.me.notifyStreak,'Streak reminder','Evenings, only when your streak is at risk')}
    ${sw('toggle-notify-digest',state.me.notifyDigest,'Weekly recap','Monday morning, only if you poured that week')}
    <button class="btn ghost block" style="margin-top:10px" data-action="push-off"${p.busy?' disabled':''}>Turn off on this device</button>`;
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
        <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${sub?esc(sub):'Your own coffee'}</span></div>
      <div class="rlist-val">${b.pours?`${b.pours} <small>pour${b.pours===1?'':'s'}</small>`:'<small>not logged yet</small>'}</div>
    </div>`;
  };
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="Bean passport">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="Back">${icon('back',20)}</button><b>Bean passport</b></div>
    <div class="ov-body">
      <div class="bean-hero"><img src="${S.beans}" alt=""><div class="bean-hero-t">
        <span class="fl">🛂</span><div><b>${beans.length} bean${beans.length===1?'':'s'} tried</b>
        <span>${totalPours} pour${totalPours===1?'':'s'}${origins.length?` · ${origins.length} origin${origins.length===1?'':'s'}`:''}</span></div></div></div>
      <div style="padding:16px">
        ${origins.length?`<div class="chips" style="margin:0 0 14px">${origins.map(c=>`<span class="chip">${flag[c]||'🫘'} ${esc(c)}</span>`).join('')}</div>`:''}
        ${beans.length
          ? `<div class="rlist">${beans.map(row).join('')}</div>
             <div style="font-size:12px;color:var(--muted);text-align:center;margin-top:12px">Every coffee you have logged, most-poured first.</div>`
          : `<div class="empty"><div class="big">🫘</div>No beans yet.<br>Add the coffee you used when you log a pour and it lands here.<br><br>
             <button class="btn sm" data-action="open-create">Log a coffee</button></div>`}
        <div style="height:8px"></div>
      </div></div></div>`;
}

function overlaySettings(){
  const m=state.me, th=state.theme||'auto';
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="Settings">
    <div class="grab"></div>
    <div class="ov-bar" style="border:0"><b>Settings</b><button class="iconbtn" data-action="close-ov" aria-label="Close">${icon('x',20)}</button></div>
    <div class="ov-body" style="padding:0 16px 18px">
      <div class="rlabel">Account</div>${accountBlock()}
      <div class="rlabel" style="margin-top:18px">Profile</div>
      ${avatarField(m)}
      <div class="rowfields">
        <div class="field"><label>Name</label><input id="sp-name" value="${esc(m.name)}" placeholder="Your name"></div>
        <div class="field"><label>Username</label><input id="sp-handle" value="${esc(USERS.me.handle)}"></div></div>
      <div class="field"><label>Bio</label><textarea id="sp-bio" placeholder="Say a little about your coffee…">${esc(m.bio)}</textarea></div>
      <div class="rowfields">
        <div class="field"><label>City</label><input id="sp-city" value="${esc(m.city)}"></div>
        <div class="field sel"><label>Go-to milk</label><select id="sp-milk">${MILK_LIST.map(x=>`<option${x===m.favMilk?' selected':''}>${x}</option>`).join('')}</select></div></div>
      ${machinePicker('sp',m.machineBrand,m.machineModel)}
      <button class="btn block" data-action="save-profile">Save profile</button>
      <div class="rlabel" style="margin-top:18px">Crema Premium</div>
      ${premiumBlock(m)}
      <div class="rlabel" style="margin-top:18px">Appearance</div>
      <div class="seg">${[['auto','Auto'],['light','Light'],['dark','Dark']].map(x=>`<button class="${th===x[0]?'on':''}" data-action="set-theme" data-t="${x[0]}">${x[1]}</button>`).join('')}</div>
      <div class="rlabel" style="margin-top:18px">Reminders</div>
      ${remindersBlock()}
      <div class="rlabel" style="margin-top:18px">About</div>
      <div class="mrow" data-action="open-scoring"><div class="mi">⭐</div>How levels work</div>
      <div class="mrow" data-action="open-streak"><div class="mi">⚡</div>How streaks work</div>
      <div style="font-size:11.5px;color:var(--muted);margin-top:14px;text-align:center">Signed in · your pours live in your account</div>
      <div class="rlabel" style="margin-top:18px">Legal</div>
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
  const perks=[['📌','Pin your gear & coffees','Hold the ones you use at the top of every picker'],
               ['🥤','Name your own drink types','Ristretto, Bombón, whatever you actually order'],
               ['✦','Early access','New features land here first']];
  const list=perks.map(p=>`<div class="pm-perk"><span>${p[0]}</span><div><b>${p[1]}</b><i>${p[2]}</i></div></div>`).join('');
  if(m.premium) return `
    <div class="mrow" style="cursor:default;border-bottom:0"><div class="mi">✦</div>
      <div style="flex:1">Premium active<div style="font-size:11.5px;color:var(--muted);font-weight:500">Free for now — you will be asked before anything costs money</div></div>
      <span class="lvlchip" style="background:var(--gold);color:var(--on-crema);border-color:transparent">ACTIVE</span></div>
    <div class="pm-card" style="margin:4px 0 8px">${list}</div>
    <button class="btn ghost block" data-action="toggle-premium">Turn Premium off</button>`;
  return `<div class="pm-card on">
    <b style="font-family:var(--serif);font-size:16px;color:var(--st4)">✦ Crema Premium</b>
    <div style="font-size:12.5px;color:var(--ink2);margin:4px 0 10px">Free for a limited time while Crema is young — switch it on right here, no card, no trial countdown. Billing comes later, and we will ask first.</div>
    ${list}
    <button class="btn block" style="margin-top:10px" data-action="toggle-premium">Turn Premium on — free</button>
    <div style="font-size:11px;color:var(--muted);text-align:center;margin-top:8px">Logging your coffee — any drink, any machine, any bean — stays free for everyone, always.</div></div>`;
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
      ${initials(USERS.me.name||'You')}${m.avatar?`<img src="${esc(imageUrl(m.avatar,'thumb'))}" alt="" onerror="this.remove()">`:''}
      ${uploading?`<span class="av-busy">…</span>`:''}</div>
    <div class="av-actions">
      <label class="btn ghost sm"><input type="file" id="sp-avatar" accept="image/*" hidden>${icon('cam',15)} ${m.avatar?'Change photo':'Add a photo'}</label>
      ${m.avatar?`<button class="btn ghost sm" data-action="drop-avatar">Remove</button>`:''}
      <div class="av-hint">${uploading?'Uploading…':'Optional — initials work fine.'}</div>
    </div></div>`;
}

/* Account block in Settings. Sign-in itself happens on the gate, before
   the app exists, so all that's left here is who you are and how to
   leave or change your password. */
function accountBlock(){
  const email=(session&&session.user&&session.user.email)||'';
  return `
    <div class="mrow" style="cursor:default"><div class="mi">☕</div>
      <div style="flex:1">Signed in<div style="font-size:11.5px;color:var(--muted);font-weight:500">${esc(email||(session&&session.user&&session.user.id)||'')}</div></div>
      <span class="lvlchip" style="color:var(--green);border-color:var(--pm2);background:var(--pm1)">SYNCED</span></div>
    <div class="mrow" data-action="open-password"><div class="mi">🔑</div>Change password</div>
    <button class="btn ghost block" style="margin-top:10px" data-action="sign-out">Sign out</button>`;
}

/* Set a new password — reached from Settings, and where a
   password-reset link lands the user. */
function overlayPassword(){
  const p=ui.pw||(ui.pw={error:'',busy:false});
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="Change password">
    <div class="grab"></div>
    <div class="ov-bar" style="border:0"><b>Change password</b><button class="iconbtn" data-action="close-ov" aria-label="Close">${icon('x',20)}</button></div>
    <div class="ov-body" style="padding:0 16px 18px">
      ${p.error?`<div style="background:rgba(168,84,74,.10);border:1px solid rgba(168,84,74,.28);color:var(--terra);border-radius:12px;padding:10px 12px;font-size:12.5px;margin-bottom:12px">${esc(p.error)}</div>`:''}
      <div class="field"><label>New password</label><input id="pw-new" type="password" autocomplete="new-password" placeholder="At least 8 characters" data-enter="pw-save"></div>
      <div class="field"><label>Repeat it</label><input id="pw-again" type="password" autocomplete="new-password" placeholder="Once more" data-enter="pw-save"></div>
      <button class="btn block"${p.busy?' disabled':''} data-action="pw-save">${p.busy?'Saving…':'Save password'}</button>
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
    <div class="obhero">${logoMark(56)}<h1>Welcome to Crema</h1><p>Every pour is progress. Log your coffees, grow your craft, and meet people who care about the same 30 seconds of the morning that you do.</p></div>
    ${err?`<div style="background:rgba(168,84,74,.10);border:1px solid rgba(168,84,74,.28);color:var(--terra);border-radius:12px;padding:10px 12px;font-size:12.5px;margin-bottom:12px">${esc(err)}</div>`:''}
    <div class="field"><label>Your name</label><input id="ob-name" value="${esc(state.me.name)}" placeholder="e.g. Alex Rivera" autocomplete="name"></div>
    <div class="rowfields">
      <div class="field"><label>Username</label><input id="ob-handle" value="${esc(state.me.handle||'')}" placeholder="yourname" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
      <div class="field"><label>City</label><input id="ob-city" value="${esc(state.me.city)}" placeholder="Your city"></div></div>
    <button class="btn block" data-action="ob-next">Continue</button>`;
  if(s===2) body=`
    <h2 class="obh2">Your setup</h2><p class="obsub">We'll prefill new posts with this — change it anytime in Settings.</p>
    ${machinePicker('ob',state.me.machineBrand,state.me.machineModel)}
    <div class="rowfields"><div class="field sel"><label>Go-to drink</label><select id="ob-drink">${drinkOptions(state.me.favDrink,{allowAdd:false})}</select></div>
    <div class="field sel"><label>Go-to milk</label><select id="ob-milk">${MILK_LIST.map(x=>`<option${x===state.me.favMilk?' selected':''}>${x}</option>`).join('')}</select></div></div>
    <div style="display:flex;gap:10px;margin-top:6px"><button class="btn ghost" data-action="ob-back">Back</button><button class="btn" style="flex:1" data-action="ob-finish">Start brewing ☕</button></div>`;
  return `<div class="ov-back"></div><div class="sheet" role="dialog" aria-label="Welcome"><div class="ov-body" style="padding:26px 22px">${dots}${body}</div></div>`;
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
       aria-label="${isPinned(kind,value)?'Unpin':'Pin to the top'}">📌</button>`:''}
    ${on?`<span class="pk-on">✓</span>`:''}</div>`;
}
const pkSection=(title,body,note)=>body?`<div class="pk-sec"><div class="pk-h">${title}${note?`<span>${note}</span>`:''}</div>${body}</div>`:'';

export function pickerList(){
  const p=ui.picker; if(!p) return '';
  const isM=p.kind==='machine', q=(p.q||'').trim(), cur=p.current||'';
  const sub=v=>{ if(isM) return ''; const c=beanCatalog(v); return c?c.roaster:'Your own coffee'; };
  let h='';

  if(q){
    const hits=isM?searchMachines(q):searchBeans(q);
    h+=pkSection(`${hits.length} match${hits.length===1?'':'es'}`,
      hits.map(x=>pickerRow(p.kind,isM?x.label:x.name,x.sub,cur,false)).join(''));
    /* Nothing found, or rows that aren't what they meant — either way
       the way out is the same, and it is never a dead end. The line
       under it has to match what is on screen: telling someone their
       coffee is "not in the list" directly below three matching rows
       reads as the search being broken, not as an offer. */
    const exact=isM?machineKnown(q):beanKnown(q);
    if(!exact) h+=`<div class="pk-add" data-action="pick-new" data-kind="${p.kind}">
      <span class="pk-i">＋</span>
      <span class="pk-t"><b>Add “${esc(q)}”</b><span>${hits.length
        ? `Not one of these? Save it as your own ${isM?'machine':'coffee'}`
        : `Not in the list — save it as your own ${isM?'machine':'coffee'}`}</span></span></div>`;
    if(!hits.length) h+=`<div class="pk-empty">Nothing in the catalogue matches that. Yours works just as well — it lands on your ${isM?'gear':'shelf'} and is there next time.</div>`;
    return h;
  }

  const yours=isM?myMachines():myCoffees();
  /* Nothing to pin when there is one of something — the affordance would
     only ever say no. It appears with the second entry, which is also
     the first moment the order of this list matters. */
  const canPin=yours.length>1;
  h+=pkSection('Yours', yours.map(v=>pickerRow(p.kind,v,sub(v),cur,canPin)).join(''),
    canPin?'most recent first':'');
  if(!state.me.premium&&canPin)
    h+=`<div class="pk-note" data-action="open-settings"><span>📌</span>
      <span>Pin the ones you use most to hold them at the top — Premium, <u>free for now, switch it on in Settings</u>.</span></div>`;

  const pop=isM
    ? POPULAR_MACHINES.map(([b,m])=>({v:b+' '+m,s:b}))
    : popularBeans().map(n=>({v:n,s:sub(n)}));
  h+=pkSection(yours.length?'Common ones':'Popular',
    pop.filter(x=>!yours.includes(x.v)).map(x=>pickerRow(p.kind,x.v,x.s,cur,false)).join(''));

  /* Browsing is a search someone hasn't typed yet, so a brand doesn't
     open a sub-list — it fills the box and the results are already
     there, one screen, one mental model.

     Alphabetical, not catalogue order: this is the one list you scan
     rather than search, and scanning forty names for a brand you
     already know only works if you know where to look for it. */
  const brands=(isM?MACHINE_BRANDS.filter(b=>b!=='Other'):beanBrands().map(b=>b.name))
    .slice().sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
  h+=pkSection(isM?'Browse by brand':'Browse by roaster',
    `<div class="pk-brands">${brands.map(b=>`<button class="chip" data-action="pk-brand" data-b="${esc(b)}">${esc(b)}</button>`).join('')}</div>`);

  h+=`<div class="pk-add" data-action="pk-focus"><span class="pk-i">＋</span>
    <span class="pk-t"><b>Not on the list?</b><span>Type it above and add it as your own</span></span></div>`;
  if(cur) h+=`<div class="pk-clear" data-action="pick" data-kind="${p.kind}" data-v="">Clear this field</div>`;
  return h;
}

function overlayPicker(){
  const p=ui.picker||{kind:'machine',q:''}, isM=p.kind==='machine';
  const n=isM?machineIndex().length:BEANS.length;
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="${isM?'Choose a machine':'Choose a coffee'}">
    <div class="grab"></div>
    <div class="ov-bar" style="border:0"><b>${isM?'Machine or brewer':'Coffee'}</b><button class="iconbtn" data-action="close-ov" aria-label="Close">${icon('x',20)}</button></div>
    <div class="pk-search"><span>${icon('search',17)}</span>
      <input id="pk-q" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"
        placeholder="${isM?`Search ${n} machines & brewers`:`Search ${n} coffees`}" value="${esc(p.q||'')}"></div>
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
  return `<div class="rlabel">Who can see this</div>
    <div class="seg" style="margin:-4px 0 4px">
      <button class="${v==='public'?'on':''}" data-action="cvis" data-v="public">🌍 Everyone</button>
      <button class="${v==='followers'?'on':''}" data-action="cvis" data-v="followers">🔒 Followers only</button></div>
    <div style="font-size:11.5px;color:var(--muted);margin:0 2px 12px">${v==='public'
      ? 'Appears in Today, where anyone can find it.'
      : 'Only people you\'ve accepted as followers can see it — it never appears in Today.'}</div>`;
}

/* The same sheet does double duty: with `editId` set it edits that pour
   instead of starting a new one. Everything except the photo is the same
   form, so an edit looks and behaves exactly like the post did — the
   camera row is simply not there, because the photo is not editable. */
function overlayCreate(){
  const c=ui.create||freshCreate(), isArt=!!DRINK_ART[c.drink], editing=!!c.editId;
  const pats=[['heart','Heart'],['rosetta','Rosetta'],['tulip','Tulip'],['swan','Swan'],['abstract','Abstract art']];
  const mkList=(base,cur)=>{const l=base.slice(); if(cur&&!l.includes(cur))l.push(cur); return l;};
  const sel=(list,cur,ph,extra)=>`<option value=""${cur?'':' selected'}>${ph}</option>`+list.map(o=>`<option${o===cur?' selected':''}>${esc(o)}</option>`).join('')+(extra?`<option${cur===extra?' selected':''}>${extra}</option>`:'');
  const chosenCafe=(c.source==='cafe'&&c.cafe)?CAFES.find(x=>x.id===c.cafe):null;
  const milkOpts=chosenCafe?chosenCafe.menu.milks:MILK_LIST;
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="${editing?'Edit coffee':'New coffee'}">
    <div class="grab"></div>
    <div class="ov-bar" style="border:0"><b>${editing?'Edit coffee':'New coffee'}</b><button class="iconbtn" data-action="close-ov" aria-label="Close">${icon('x',20)}</button></div>
    <div class="ov-body" style="padding:0 16px 16px">
      <div class="create-prev">
        ${c.img?`<img class="photo" src="${imageUrl(c.img,'feed')}" alt="your coffee photo">`:cupSVG(isArt&&c.pattern?c.pattern:'none',.85,999)}
        ${c.img?(c.uploading?`<span class="up-hint">Uploading…</span>`:(c.uploadFailed?`<span class="up-hint" style="background:rgba(168,84,74,.9)">Upload failed</span>`:'')):(editing?'':`<span class="up-hint">${icon('cam',15)} Add a photo</span>`)}
      </div>
      ${!editing&&c.uploadFailed?`<div style="background:rgba(168,84,74,.10);border:1px solid rgba(168,84,74,.28);color:var(--terra);border-radius:12px;padding:10px 12px;font-size:12.5px;line-height:1.45;margin:10px 0 2px">
        That photo couldn't reach the server. Tap Post to try again, or drop it and post without a photo.
        <button class="btn ghost sm" style="margin-top:8px" data-action="drop-photo">Post without the photo</button></div>`:''}
      ${editing?`<div style="font-size:11.5px;color:var(--muted);margin:10px 2px 12px">The photo stays as it was poured — everything else is yours to fix.</div>`
      :`<div class="photo-actions">
        <label class="btn ghost sm"><input type="file" id="c-photo-cam" accept="image/*" capture="environment" hidden>${icon('cam',16)} ${c.img?'Retake':'Take photo'}</label>
        <label class="btn ghost sm"><input type="file" id="c-photo-lib" accept="image/*" hidden>🖼️ ${c.img?'Change':'Gallery'}</label>
      </div>`}
      <div class="field sel"><label>Drink</label><select id="c-drink">${drinkOptions(c.drink)}</select></div>
      ${c.drink===ADD_DRINK?`<div class="field"><label>Your drink</label><input id="c-drink-custom" placeholder="e.g. Ristretto" value="${esc(c.drinkCustom)}"></div>`:''}
      ${premiumNote('Naming a drink of your own')}
      ${isArt?`<div class="field"><label>Latte art <span style="text-transform:none;letter-spacing:0;color:var(--muted)">· only if you poured one — tap to toggle</span></label>
        <div class="patpick">${pats.map(p=>`<button class="${c.pattern===p[0]?'on':''}" data-action="cpat" data-p="${p[0]}">${cupSVG(p[0],.9,p[0].charCodeAt(0),{noCup:true})}<span>${p[1]}</span></button>`).join('')}</div>
        ${c.pattern?'':`<div style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">No art? Leave these alone — your ${esc((c.drink||'coffee').toLowerCase())} posts without a pattern.</div>`}</div>`:''}
      ${CAFES.length?`<div class="rlabel">Where did you have it?</div>
      <div class="seg" style="margin:-4px 0 12px">
        <button class="${c.source==='home'?'on':''}" data-action="csource" data-s="home">🏠 I made it</button>
        <button class="${c.source==='cafe'?'on':''}" data-action="csource" data-s="cafe">☕ At a café</button></div>`:''}
      ${c.source==='cafe'?`<div class="field sel"><label>Café</label><select id="c-cafe"><option value=""${c.cafe?'':' selected'}>Choose a café…</option>${CAFES.map(cf=>`<option value="${cf.id}"${cf.id===c.cafe?' selected':''}>${cf.name} · ${cf.area}</option>`).join('')}</select></div>`:''}
      ${HAS_MILK.has(c.drink)?`<div class="field sel"><label>Milk</label><select id="c-milk">${sel(mkList(milkOpts,c.milk),c.milk,'Optional')}</select></div>`:''}
      <div class="field"><label>Caption</label><textarea id="c-caption" placeholder="Say something about this coffee…">${esc(c.caption)}</textarea></div>
      ${visibilityPicker(c)}
      ${c.source==='cafe' ? (chosenCafe?`
      <div class="rlabel">${esc(chosenCafe.name)}'s setup <span>· what they're pouring</span></div>
      <div class="field sel"><label>Bean</label><select id="c-bean">${sel(chosenCafe.menu.beans,c.bean,'Which bean did you have?')}</select></div>
      ${chosenCafe.menu&&chosenCafe.menu.machine?`<div class="recipe-panel open" style="margin:0"><div class="recipe-grid">
        <div class="recipe-mach"><span>Machine</span><b>${esc(chosenCafe.menu.machine)}</b></div></div></div>`:''}
      <div style="font-size:11.5px;color:var(--muted);margin:8px 2px 2px">Your pour will be tagged 📍 ${esc(chosenCafe.name)}</div>`
      : `<div style="font-size:12.5px;color:var(--muted);margin:2px 2px 10px">Pick a café above to load the beans and gear they use.</div>`)
      : `
      <div class="rlabel">Recipe <span>· optional — add only what you know</span></div>
      ${beanPicker('c',c.bean)}
      ${machinePicker('c',c.machineBrand,c.machineModel)}
      <div class="rowfields">
        <div class="field"><label>Dose in</label><input id="c-dose" inputmode="decimal" placeholder="—" value="${esc(withUnit(c.dose,'g'))}"></div>
        <div class="field"><label>Yield out</label><input id="c-yield" inputmode="decimal" placeholder="—" value="${esc(withUnit(c.yield,'g'))}"></div>
        <div class="field"><label>Time</label><input id="c-time" inputmode="decimal" placeholder="—" value="${esc(withUnit(c.time,'s'))}"></div>
        <div class="field"><label>Temp</label><input id="c-temp" inputmode="decimal" placeholder="—" value="${esc(withUnit(c.temp,'°'))}"></div></div>`}
      <button class="btn block" style="margin-top:12px" data-action="submit-post">${editing?'Save changes':`${icon('bolt',18)} Post`}</button>
      ${editing?`<button class="btn ghost block" style="margin-top:8px" data-action="close-ov">Cancel</button>`:''}
      <div style="height:8px"></div>
    </div></div>`;
}
