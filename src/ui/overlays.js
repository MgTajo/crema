"use strict";
/* ============================================================
   ui/overlays — every full-screen / bottom sheet, plus the overlay
   stack (pushOv/popOv) and the router that paints the top of it.
   Overlays are data-driven strings just like the screens; opening
   one pushes a descriptor, closing pops it.
   ============================================================ */
import { $, esc, fmt, cap, initials, seedOf } from '../core/util.js';
import { S } from '../data/assets.js';
import { imageUrl } from '../data/media.js';
import { LEVELS, MILK_LIST, DRINKS, DRINK_ART, HAS_MILK, ADD_BEAN, ROASTER_LIST, BEANS, flag } from '../data/catalog.js';
import { USERS, CAFES, CHALLENGES, LEADERBOARD, userOf } from '../data/world.js';
import { state, ui, session, social, findPost, allPosts, myPosts, freshCreate, entryCache } from '../store/store.js';
import { art, cupSVG } from '../domain/art.js';
import { scoreFromQ } from '../domain/scoring.js';
import { avatar, cafeThumb, mentionify, recipeRows, recipePanel, commentRow, machinePicker, beanSelectHTML, lbRow, gcell, commentCount, joinedLabel } from './components.js';
import { icon, logoMark } from './icons.js';
import { renderView, renderAppbar } from './views.js';

export function pushOv(o){ui.ovStack.push(o); renderOverlay();}
export function popOv(){ui.ovStack.pop(); renderOverlay(); if(!ui.ovStack.length){renderView(); renderAppbar();}}

export function renderOverlay(){
  const ov=$('#overlay'), top=ui.ovStack[ui.ovStack.length-1];
  if(!top){ov.className='overlay'; ov.innerHTML=''; return;}
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
    T==='board'?overlayBoard():
    T==='flist'?overlayFlist(top.id):
    T==='scoring'?overlayScoring():
    T==='settings'?overlaySettings():
    T==='picker'?overlayPicker(top.id):
    T==='onboard'?overlayOnboard():
    T==='password'?overlayPassword():
    T==='create'?overlayCreate():'';
}

function overlayPost(id){
  const p=findPost(id); if(!p) return '';
  const u=userOf(p.user), r=p.recipe, sc=p.art?scoreFromQ(p.quality):null, rows=recipeRows(r);
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="Post">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="Back">${icon('back',20)}</button><b>Post</b>
      <button class="act" data-action="share-post" data-id="${p.id}" aria-label="Share">${icon('send',20)}</button>
      <button class="act like ${p.likedByMe?'liked':''}" data-action="like" data-id="${p.id}">${icon(p.likedByMe?'heartF':'heart',22)} <span class="cnt">${fmt(p.likes)}</span></button></div>
    <div class="ov-body">
      <div class="media" data-action="none">${art(imageUrl(p.img,'hero'),p.pattern,p.quality,seedOf(p.id),p.drink)}<div class="heartpop" id="hp-${p.id}">${icon('heartF',90)}</div></div>
      <div class="p-head">
        <div class="idwrap" data-action="open-user" data-id="${p.user}">${avatar(p.user)}
          <div class="who"><b>${esc(u.name)} <span class="lvlchip">Lv${u.level}</span></b><span>${esc(u.handle)}${p.cafe?` · at ${esc(p.cafe)}`:''} · ${p.ago}</span></div></div>
        ${p.user==='me'?'':`<button class="followmini ${state.follows[p.user]?'on':''}" data-action="follow" data-id="${p.user}">${state.follows[p.user]?'Following':'Follow'}</button>`}
        <button class="kebab" data-action="open-menu" data-id="${p.id}" aria-label="More options">⋯</button></div>
      <div class="p-body"><div class="cap"><b>${esc(u.name)}</b> ${mentionify(p.caption)}</div>
        <div class="chips"><span class="chip drinkchip">${esc(p.drink||'Coffee')}</span>${p.art?`<span class="chip tag" data-action="open-tag" data-id="${p.pattern}">#${p.pattern}</span>`:''}${r&&r.milk?`<span class="chip">🥛 ${esc(r.milk)}</span>`:''}${p.cafe?`<span class="chip">📍 ${esc(p.cafe)}</span>`:''}</div></div>
      ${rows.length?`<div class="scoreblk" style="padding-top:0"><div class="recipe-panel open" style="margin:0">${recipePanel(r)}
        <div style="padding:9px 12px;background:var(--surface)"><button class="btn ghost sm" data-action="brew" data-id="${p.id}">☕ Brew this recipe</button></div></div></div>`:''}
      <div style="padding:14px 14px 4px;font-weight:700;font-family:var(--serif);font-size:16px">${commentCount(p)} comments</div>
      <div id="cmt-list">${p.comments.length?p.comments.map((c,i)=>commentRow(c,p.id,i)).join(''):
        (commentCount(p)?`<div class="empty" style="padding:24px">Loading comments…</div>`:`<div class="empty" style="padding:24px">Be the first to comment.</div>`)}</div>
    </div>
    <div class="composer">${avatar('me')}<input id="cmt-input" placeholder="Add a comment…" data-enter="add-cmt" data-id="${p.id}" aria-label="Add a comment"><button class="send" data-action="add-cmt" data-id="${p.id}" aria-label="Send">${icon('sendF',20)}</button></div>
  </div>`;
}

function overlayCafe(id){
  const c=CAFES.find(x=>x.id===id); if(!c) return '';
  const followed=state.cafeFollow[id], tagged=allPosts().filter(p=>p.cafe===c.name);
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${c.name}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="Back">${icon('back',20)}</button><b>${c.name}</b></div>
    <div class="ov-body">
      <div style="height:130px;background:linear-gradient(135deg,${c.color},#3a271a);position:relative"><div style="position:absolute;left:16px;bottom:-26px">${cafeThumb(c)}</div></div>
      <div style="padding:34px 16px 8px"><b style="font-family:var(--serif);font-size:22px">${c.name}</b>
        <div style="color:var(--muted);font-size:13px;margin:3px 0 10px">${c.spec} · ${c.area}, ${c.city}</div>
        <div class="chips" style="margin:0 0 12px"><span class="chip"><span class="star">★ ${c.rating}</span></span><span class="chip">${fmt(c.followers)} followers</span><span class="chip" style="color:${c.hours.startsWith('Open')?'var(--green)':'var(--terra)'}">${c.hours}</span></div>
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
  const rows=[['Roaster',b.roaster],['Origin',b.origin],['Roast level',b.roast],['Availability',b.loc==='INT'?'Sold in Germany':'Roasted in Germany']];
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${esc(b.n)}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="Back">${icon('back',20)}</button><b>${b.n}</b></div>
    <div class="ov-body">
      <div class="bean-hero"><img src="${S.beans}" alt=""><div class="bean-hero-t"><span class="fl">${flag[b.c]||'🫘'}</span><div><b>${b.n}</b><span>Roasted by ${b.roaster}</span></div></div></div>
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
function overlayUser(uid){
  if(!uid||uid==='me') return '';
  const u=userOf(uid);                       // renders while the profile loads
  const theirs=theirPosts(uid);
  const f=state.follows[uid];
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${u.name}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="Back">${icon('back',20)}</button><b>${u.name}</b></div>
    <div class="ov-body">
      <div style="height:96px;background:linear-gradient(135deg,${u.color},#3a271a)"></div>
      <div style="padding:0 16px 20px">
        <div style="display:flex;align-items:flex-end;gap:12px;margin-top:-28px">
          <div class="avatar" style="width:74px;height:74px;font-size:26px;background:${u.color};border:3px solid var(--cream)">${initials(u.name)}</div>
          <button class="btn ${f?'ghost':''} sm" style="margin-left:auto" data-action="follow" data-id="${uid}">${f?'Following':'Follow'}</button></div>
        <div style="margin-top:10px"><b style="font-family:var(--serif);font-size:22px">${esc(u.name)}</b> <span class="lvlchip">Lv${u.level}</span>
          <div style="color:var(--muted);font-size:13px;margin:2px 0 8px">${esc(u.handle)}${u.city?` · 📍 ${esc(u.city)}`:''}</div>
          ${u.bio?`<p style="font-size:13.5px;color:var(--ink2);line-height:1.5;margin:0 0 12px">${esc(u.bio)}</p>`:''}</div>
        <div class="stats"><div><b>${fmt(u.pourN)}</b><span>Pours</span></div><div><b>${fmt(u.followerN)}</b><span>Followers</span></div><div><b>${u.levelName}</b><span>Level ${u.level}</span></div></div>
        <div class="section-h"><h2>Recent pours</h2></div>
        ${theirs.length?`<div class="grid">${theirs.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`:`<div class="empty">No pours yet.</div>`}
      </div></div></div>`;
}

function overlayNotifs(){
  const rows=state.notifications.map((n,i)=>{
    const av=n.u?avatar(n.u):`<div class="avatar" style="background:var(--crema)">${n.type==='challenge'?'🏆':'☕'}</div>`;
    return `<div class="nrow ${n.read?'':'unread'}" data-action="notif-go" data-idx="${i}">${av}
      <div class="nb"><div class="nt">${n.u?`<b>${esc(userOf(n.u).name)}</b> `:''}${esc(n.text)}</div><span>${n.time} ago</span></div></div>`;}).join('');
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
      ${ch?`<button class="btn sm" style="margin-bottom:12px" data-action="open-challenge" data-id="${ch.id}">🎯 ${ch.title} — join the challenge</button>`:''}
      ${list.length?`<div class="grid">${list.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`:
        `<div class="empty"><div class="big">🎨</div>No ${pat} pours yet — be the first!<br><br><button class="btn sm" data-action="open-create">Post a pour</button></div>`}
    </div></div></div>`;
}

/* Entries are rows from challenge_entries with real vote counts, loaded
   when the challenge opens. Nothing stands in for them: until the load
   returns, `entryCache` has no key and the screen says it's loading. */
const challengeEntries = ch => entryCache[ch.id] || null;
function overlayChallenge(id){
  const ch=CHALLENGES.find(c=>c.id===id); if(!ch) return '';
  const joined=state.challenges[id], sub=state.challengeSubs[id];
  const entries=challengeEntries(ch);
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${ch.title}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="Back">${icon('back',20)}</button><b>${ch.title}</b></div>
    <div class="ov-body"><div style="padding:0 16px 20px">
      <div class="ch-top" style="height:150px;border-radius:16px;margin-top:14px">${cupSVG(ch.pattern,.92,ch.id.charCodeAt(0))}<span class="ends">Ends in ${ch.ends}</span></div>
      <div style="margin:14px 2px 4px"><b style="font-family:var(--serif);font-size:22px">${ch.title}</b>
        <div class="chips" style="margin:8px 0"><span class="chip tag" data-action="open-tag" data-id="${ch.pattern}">${ch.tag}</span><span class="chip">${joinedLabel(ch)}</span>${joined?'<span class="chip" style="color:var(--green)">✓ You\'re in</span>':''}</div>
        <p style="font-size:13.5px;color:var(--ink2);line-height:1.5;margin:4px 0 14px">${ch.blurb}</p>
        <div style="display:flex;gap:10px;margin-bottom:6px">
          <button class="btn ${joined?'ghost':''} block" data-action="join" data-id="${ch.id}">${joined?'Leave challenge':'Join challenge'}</button>
          ${joined&&!sub?`<button class="btn block" data-action="submit-entry" data-id="${ch.id}">Submit a pour</button>`:''}</div>
        ${sub?`<div style="font-size:12.5px;font-weight:700;color:var(--green);margin:6px 2px">✓ Your entry is in — good luck!</div>`:''}</div>
      <div class="section-h"><h2>Top entries</h2></div>
      ${!entries?`<div class="empty" style="padding:22px">Loading entries…</div>`:
        entries.length?`<div class="lb" style="margin-bottom:14px">${entries.slice(0,3).map((e,i)=>`<div class="lb-row click" data-action="open-post" data-id="${e.p.id}">
          <div class="lb-rank top">${i===0?'🥇':i===1?'🥈':'🥉'}</div>${avatar(e.p.user)}
          <div class="who" style="flex:1"><b>${esc(userOf(e.p.user).name)}${e.mine?' (you)':''}</b><span>${cap(ch.pattern)}</span></div>
          <div class="lb-pts">▲ ${e.votes}</div></div>`).join('')}</div>
        <div class="section-h" style="margin-top:4px"><h2>All entries</h2></div>
        <div class="grid">${entries.map(e=>`<div class="entrywrap">${e.mine?'<span class="entrytag">YOURS</span>':''}${gcell(e.p.pattern,e.p.quality,e.p.id,e.p.img)}
          ${e.id?`<div class="ev${e.votedByMe?' on':''}" data-action="vote-entry" data-id="${e.id}" data-ch="${ch.id}" role="button" title="${e.votedByMe?'Remove your vote':'Vote for this pour'}" style="cursor:pointer">▲ ${e.votes}</div>`
                :`<div class="ev">▲ ${e.votes}</div>`}</div>`).join('')}</div>`:
        `<div class="empty"><div class="big">🦢</div>No entries yet — be the first!</div>`}
    </div></div></div>`;
}
function overlayPicker(chId){
  const ch=CHALLENGES.find(c=>c.id===chId);
  const candidates=myPosts().filter(p=>p.art&&(p.pattern===ch.pattern||true));
  const matching=candidates.filter(p=>p.pattern===ch.pattern), rest=candidates.filter(p=>p.pattern!==ch.pattern);
  const cell=p=>`<div class="gcell" data-action="pick-entry" data-ch="${chId}" data-id="${p.id}">${art(p.img,p.pattern,p.quality,seedOf(p.id),p.drink)}</div>`;
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="Pick your entry">
    <div class="grab"></div>
    <div class="ov-bar" style="border:0"><b>Pick your entry</b><button class="iconbtn" data-action="close-ov" aria-label="Close">${icon('x',20)}</button></div>
    <div class="ov-body" style="padding:0 16px 18px">
      ${matching.length?`<div class="rlabel">Your ${ch.pattern}s</div><div class="grid" style="margin-bottom:12px">${matching.map(cell).join('')}</div>`:''}
      ${rest.length?`<div class="rlabel">Other pours</div><div class="grid">${rest.map(cell).join('')}</div>`:''}
      ${!candidates.length?`<div class="empty">Post a latte-art pour first, then enter it here.</div>`:''}
    </div></div>`;
}
function overlayChallenges(){
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="All challenges">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="Back">${icon('back',20)}</button><b>Challenges</b></div>
    <div class="ov-body"><div style="padding:14px 16px 20px">
      ${CHALLENGES.map(c=>{const j=state.challenges[c.id];return `<div class="card" style="display:flex;align-items:center;gap:12px;padding:12px">
        <div class="aod" style="width:64px;height:64px;border-radius:14px;overflow:hidden;flex:none;display:grid;place-items:center;background:radial-gradient(120% 120% at 30% 20%,var(--mb1),var(--mb2));cursor:pointer" data-action="open-challenge" data-id="${c.id}">${cupSVG(c.pattern,.9,c.id.charCodeAt(0))}</div>
        <div style="flex:1;min-width:0;cursor:pointer" data-action="open-challenge" data-id="${c.id}"><b style="font-family:var(--serif);font-size:16px">${c.title}</b>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">${fmt(c.participants)} joined · ends in ${c.ends} · ${c.tag}</div></div>
        <button class="btn ${j?'ghost':''} sm" data-action="join" data-id="${c.id}">${j?'✓':'Join'}</button></div>`;}).join('')}
    </div></div></div>`;
}
function overlayBoard(){
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="Leaderboard">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="Back">${icon('back',20)}</button><b>Weekly leaderboard</b></div>
    <div class="ov-body"><div style="padding:14px 16px 20px">
      ${LEADERBOARD.length?`<div class="lb">${LEADERBOARD.map((r,i)=>lbRow(r,i)).join('')}</div>`
        :`<div class="empty"><div class="big">🏆</div>Nobody has scored this week yet.</div>`}
      <div style="font-size:12px;color:var(--muted);text-align:center;margin-top:12px">Points come from pours, art scores and challenge results.</div></div></div></div>`;
}
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
      ${list.length?`<div class="lb">${list.map(u=>`<div class="lb-row click" data-action="open-user" data-id="${u.id}">${avatar(u.id)}
        <div class="who" style="flex:1"><b>${esc(u.name)}</b><span>${esc(u.handle)}${u.city?' · '+esc(u.city):''}</span></div>
        <button class="btn ${state.follows[u.id]?'ghost':''} sm" data-action="follow" data-id="${u.id}">${state.follows[u.id]?'Following':'Follow'}</button></div>`).join('')}</div>`
        :empty}
    </div></div></div>`;
}
function overlayScoring(){
  const me=USERS.me;
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="Levels">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="Back">${icon('back',20)}</button><b>Levels</b></div>
    <div class="ov-body"><div style="padding:14px 16px 20px">
      <p style="font-size:13.5px;color:var(--ink2);line-height:1.55;margin:0 0 14px">Your level grows as you post and practise — a friendly badge of how far your craft has come, not a grade.</p>
      <div class="rlabel">Levels</div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${LEVELS.map(l=>`<div class="lvlrow ${l[0]===me.level?'now':''}"><div class="ln">${l[0]}</div><b>${l[1]}</b>${l[0]===me.level?'<span>you are here</span>':''}</div>`).join('')}
      </div>
      <p style="font-size:12px;color:var(--muted);margin-top:14px">Levels follow the classic latte-art progression: hearts → tulips → rosettas → swans.</p>
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
      ${m.premium
        ? `<div class="mrow" style="cursor:default;border-bottom:0"><div class="mi">✦</div><div style="flex:1">Premium active<div style="font-size:11.5px;color:var(--muted);font-weight:500">Add your own coffees · early features</div></div><span class="lvlchip" style="background:linear-gradient(135deg,#f5d78a,#e0b25a);color:#5a3d17;border-color:#e6c98a">ACTIVE</span></div>
           <button class="btn ghost block" data-action="toggle-premium">Turn Premium off</button>`
        : `<div style="background:linear-gradient(135deg,var(--st1),var(--st2));border:1px solid var(--st3);border-radius:var(--r-sm);padding:14px;margin-bottom:2px">
             <b style="font-family:var(--serif);font-size:16px;color:var(--st4)">✦ Crema Premium</b>
             <div style="font-size:12.5px;color:var(--ink2);margin:4px 0 12px">Add your own coffees &amp; roasters, and get early access to new features. Free while Crema is young — billing comes later.</div>
             <button class="btn block" data-action="toggle-premium">Turn Premium on</button></div>`}
      <div class="rlabel" style="margin-top:18px">Appearance</div>
      <div class="seg">${[['auto','Auto'],['light','Light'],['dark','Dark']].map(x=>`<button class="${th===x[0]?'on':''}" data-action="set-theme" data-t="${x[0]}">${x[1]}</button>`).join('')}</div>
      <div class="rlabel" style="margin-top:18px">About</div>
      <div class="mrow" data-action="open-scoring"><div class="mi">⭐</div>How levels work</div>
      <div style="font-size:11.5px;color:var(--muted);margin-top:14px;text-align:center">Signed in · your pours live in your account</div>
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
    <div class="rowfields"><div class="field sel"><label>Go-to drink</label><select id="ob-drink">${DRINKS.map(d=>`<option${d===state.me.favDrink?' selected':''}>${d}</option>`).join('')}</select></div>
    <div class="field sel"><label>Go-to milk</label><select id="ob-milk">${MILK_LIST.map(x=>`<option${x===state.me.favMilk?' selected':''}>${x}</option>`).join('')}</select></div></div>
    <div style="display:flex;gap:10px;margin-top:6px"><button class="btn ghost" data-action="ob-back">Back</button><button class="btn" style="flex:1" data-action="ob-finish">Start brewing ☕</button></div>`;
  return `<div class="ov-back"></div><div class="sheet" role="dialog" aria-label="Welcome"><div class="ov-body" style="padding:26px 22px">${dots}${body}</div></div>`;
}

function overlayCreate(){
  const c=ui.create||freshCreate(), isArt=!!DRINK_ART[c.drink];
  const pats=[['heart','Heart'],['rosetta','Rosetta'],['tulip','Tulip'],['swan','Swan']];
  const mkList=(base,cur)=>{const l=base.slice(); if(cur&&cur!==ADD_BEAN&&!l.includes(cur))l.push(cur); return l;};
  const sel=(list,cur,ph,extra)=>`<option value=""${cur?'':' selected'}>${ph}</option>`+list.map(o=>`<option${o===cur?' selected':''}>${esc(o)}</option>`).join('')+(extra?`<option${cur===extra?' selected':''}>${extra}</option>`:'');
  const chosenCafe=(c.source==='cafe'&&c.cafe)?CAFES.find(x=>x.id===c.cafe):null;
  const milkOpts=chosenCafe?chosenCafe.menu.milks:MILK_LIST;
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="New coffee">
    <div class="grab"></div>
    <div class="ov-bar" style="border:0"><b>New coffee</b><button class="iconbtn" data-action="close-ov" aria-label="Close">${icon('x',20)}</button></div>
    <div class="ov-body" style="padding:0 16px 16px">
      <div class="create-prev">
        ${c.img?`<img class="photo" src="${imageUrl(c.img,'feed')}" alt="your coffee photo">`:cupSVG(isArt&&c.pattern?c.pattern:'none',.85,999)}
        ${c.img?(c.uploading?`<span class="up-hint">Uploading…</span>`:''):`<span class="up-hint">${icon('cam',15)} Add a photo</span>`}
      </div>
      <div class="photo-actions">
        <label class="btn ghost sm"><input type="file" id="c-photo-cam" accept="image/*" capture="environment" hidden>${icon('cam',16)} ${c.img?'Retake':'Take photo'}</label>
        <label class="btn ghost sm"><input type="file" id="c-photo-lib" accept="image/*" hidden>🖼️ ${c.img?'Change':'Gallery'}</label>
      </div>
      <div class="field sel"><label>Drink</label><select id="c-drink">${DRINKS.map(d=>`<option${d===c.drink?' selected':''}>${d}</option>`).join('')}</select></div>
      ${isArt?`<div class="field"><label>Latte-art tag <span style="text-transform:none;letter-spacing:0;color:var(--muted)">· optional #hashtag, tap to toggle</span></label>
        <div class="patpick">${pats.map(p=>`<button class="${c.pattern===p[0]?'on':''}" data-action="cpat" data-p="${p[0]}">${cupSVG(p[0],.9,p[0].charCodeAt(0),{noCup:true})}<span>${p[1]}</span></button>`).join('')}</div></div>`:''}
      <div class="rlabel">Where did you have it?</div>
      <div class="seg" style="margin:-4px 0 12px">
        <button class="${c.source==='home'?'on':''}" data-action="csource" data-s="home">🏠 I made it</button>
        <button class="${c.source==='cafe'?'on':''}" data-action="csource" data-s="cafe">☕ At a café</button></div>
      ${c.source==='cafe'?`<div class="field sel"><label>Café</label><select id="c-cafe"><option value=""${c.cafe?'':' selected'}>Choose a café…</option>${CAFES.map(cf=>`<option value="${cf.id}"${cf.id===c.cafe?' selected':''}>${cf.name} · ${cf.area}</option>`).join('')}</select></div>`:''}
      ${HAS_MILK.has(c.drink)?`<div class="field sel"><label>Milk</label><select id="c-milk">${sel(mkList(milkOpts,c.milk),c.milk,'Optional')}</select></div>`:''}
      <div class="field"><label>Caption</label><textarea id="c-caption" placeholder="Say something about this coffee…">${esc(c.caption)}</textarea></div>
      ${c.source==='cafe' ? (chosenCafe?`
      <div class="rlabel">${esc(chosenCafe.name)}'s setup <span>· what they're pouring</span></div>
      <div class="field sel"><label>Bean</label><select id="c-bean">${sel(chosenCafe.menu.beans,c.bean,'Which bean did you have?')}</select></div>
      <div class="recipe-panel open" style="margin:0"><div class="recipe-grid">
        <div class="recipe-bean">🫘 <div><span>Roaster</span><b>${esc(chosenCafe.menu.roaster)}</b></div></div>
        <div class="recipe-mach"><span>Machine</span><b>${esc(chosenCafe.menu.machine)}</b></div></div></div>
      <div style="font-size:11.5px;color:var(--muted);margin:8px 2px 2px">Roaster & machine come from the café · your pour will be tagged 📍 ${esc(chosenCafe.name)}</div>`
      : `<div style="font-size:12.5px;color:var(--muted);margin:2px 2px 10px">Pick a café above to load the beans and gear they use.</div>`)
      : `
      <div class="rlabel">Recipe <span>· optional — add only what you know</span></div>
      <div class="field sel"><label>Coffee / beans</label><select id="c-bean">${beanSelectHTML(c.bean)}</select></div>
      ${c.bean===ADD_BEAN?`<div class="field"><label>Your coffee</label><input id="c-bean-custom" placeholder="e.g. My Local Roastery — House Espresso" value="${esc(c.beanCustom)}"></div>`:''}
      ${!state.me.premium?`<div style="font-size:11.5px;color:var(--muted);margin:-4px 2px 11px">🔒 Adding your own coffee is a <b style="color:var(--crema-deep);cursor:pointer" data-action="open-settings">Premium</b> feature.</div>`:''}
      <div class="field sel"><label>Roaster</label><select id="c-roaster">${sel(mkList(ROASTER_LIST,c.roaster),c.roaster,'Optional')}</select></div>
      ${machinePicker('c',c.machineBrand,c.machineModel)}
      <div class="rowfields">
        <div class="field"><label>Dose in</label><input id="c-dose" placeholder="—" value="${esc(c.dose)}"></div>
        <div class="field"><label>Yield out</label><input id="c-yield" placeholder="—" value="${esc(c.yield)}"></div>
        <div class="field"><label>Time</label><input id="c-time" placeholder="—" value="${esc(c.time)}"></div>
        <div class="field"><label>Temp</label><input id="c-temp" placeholder="—" value="${esc(c.temp)}"></div></div>`}
      <button class="btn block" style="margin-top:12px" data-action="submit-post">${icon('bolt',18)} Post</button>
      <div style="height:8px"></div>
    </div></div>`;
}
