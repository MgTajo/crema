"use strict";
/* ============================================================
   ui/views — the four main screens plus the app bar and tab bar,
   and the top-level render() that repaints everything.
   Renderers are pure string→DOM: they read the store and emit HTML,
   then write it into the shell's mount points.
   ============================================================ */
import { $, esc, fmt, cap, initials, seedOf, daysAgo, agoLabel } from '../core/util.js';
import { S } from '../data/assets.js';
import { beanCatalog, flag } from '../data/catalog.js';
import { USERS, TOP_POSTS } from '../data/world.js';
import { state, ui, session, feed, discover, social, saved, mine, streak, streakInfo,
         myPosts, allPosts, myBeans, myCountries, activityBars, feedPosts } from '../store/store.js';
import { imageUrl } from '../data/media.js';
import { art } from '../domain/art.js';
import { computeBadges, levelOf, nextLevel, levelProgress } from '../domain/scoring.js';
import { postCard, searchHTML, avatar, lbRow, gcell, followBtn } from './components.js';
import { icon, logoMark } from './icons.js';
import { renderOverlay } from './overlays.js';
import { renderGate } from './gate.js';

export function renderAppbar(){
  const bar=$('#appbar');
  if(!session){ bar.innerHTML=`<div class="title" data-action="reload" title="Reload Crema">${logoMark()} Crema</div>`; return; }
  const unread=state.notifications.some(n=>!n.read);
  const bell=`<button class="iconbtn" data-action="open-notifs" aria-label="Notifications">${icon('bell',20)}${unread?'<span class="ndot"></span>':''}</button>`;
  if(ui.route==='home'){
    /* The chip goes hollow when the streak is unfinished today. It is
       the same number either way — what changes is whether it looks
       banked or still owed. */
    const s=streakInfo();
    const streakChip=s.days>0
      ? `<div class="streak${s.atRisk?' open':''}" data-action="open-streak" title="${s.atRisk?'Not poured today':'Day streak'}">${icon('bolt',15)} ${s.days}</div>`
      : '';
    bar.innerHTML=`<div class="title" data-action="reload" title="Reload Crema">${logoMark()} Crema</div><div class="actions">${streakChip}${bell}</div>`;
  }
  else if(ui.route==='explore') bar.innerHTML=`<div class="title">Explore</div><div class="actions">${bell}</div>`;
  else if(ui.route==='cafes') bar.innerHTML=`<div class="title">Cafés</div><div class="actions">${USERS.me.city?`<div class="streak" style="background:var(--pm1);border-color:var(--pm2);color:var(--green)">📍 ${esc(USERS.me.city)}</div>`:''}${bell}</div>`;
  else if(ui.route==='profile') bar.innerHTML=`<div class="title">Profile</div><div class="actions"><button class="iconbtn" data-action="open-settings" aria-label="Settings">${icon('gear',20)}</button></div>`;
}

export function renderHome(){
  const list=feedPosts();
  const empty = feed.loading&&!feed.loaded
    ? `<div class="empty"><div class="big">☕</div>Loading your feed…</div>`
    : ui.filter==='following'
      ? `<div class="empty"><div class="big">👥</div>No pours from people you follow yet.<br>Find baristas on Explore.</div>`
      : `<div class="empty"><div class="big">🌅</div>Nobody has poured today yet.<br>Tap ＋ and be the first.</div>`;
  return `<div class="pad">
    ${followRequestsBlock()}
    ${streakBlock()}
    <div class="seg">
      <button class="${ui.filter==='today'?'on':''}" data-action="filter" data-f="today">Today</button>
      <button class="${ui.filter==='following'?'on':''}" data-action="filter" data-f="following">Following</button>
    </div>
    ${list.length?list.map(postCard).join(''):empty}
  </div>`;
}

/* Follow requests sit above the feed, not behind the bell. Someone
   waiting to be let in is the one thing here that needs an answer from
   you, and a badge on an icon is easy to scroll past — so it takes the
   full width, keeps its own colour, and carries the two buttons that
   resolve it. It disappears the moment the queue is empty. */
function followRequestsBlock(){
  const reqs=social.requests||[]; if(!reqs.length) return '';
  return `<div class="freq">
    <div class="freq-h">${icon('bell',15)} ${reqs.length===1?'1 follow request':`${reqs.length} follow requests`}</div>
    ${reqs.map(r=>`<div class="freq-row">
      <div class="idwrap" data-action="open-user" data-id="${r.id}">${avatar(r.id)}
        <div class="who"><b>${esc(r.user.name)}</b><span>${esc(r.user.handle)} · ${r.ago}</span></div></div>
      <button class="btn sm" data-action="accept-follow" data-id="${r.id}">Accept</button>
      <button class="btn ghost sm" data-action="decline-follow" data-id="${r.id}">Decline</button>
    </div>`).join('')}
  </div>`;
}

/* Milestones worth interrupting someone for. Sparse on purpose: a
   banner that appears every single day is wallpaper by week two. */
const MILESTONES=[3,7,14,30,50,100,200,365];

/* The streak nudge, above the feed and below follow requests.
   It says something on exactly three occasions:

     · the streak is alive but today is still empty — the only genuinely
       actionable state, and the reason this block exists;
     · today's pour just hit a milestone — worth a moment;
     · a streak ended recently enough to be worth restarting.

   Every other day it renders nothing. The number already lives in the
   app bar for anyone who wants to check it, and a habit app that
   congratulates you every morning stops being read.

   Nothing renders before mine.loaded either: myPosts() is the feed page
   until the user's own pours arrive, so an early paint would tell
   someone their streak was over while it was still loading. */
function streakBlock(){
  if(!mine.loaded) return '';
  const s=streakInfo();

  if(s.atRisk){
    /* The badge already carries the number, so the headline doesn't
       repeat it — three columns on a narrow phone, and a headline long
       enough to wrap pushes the button off its line. */
    const rest=s.canRest ? 'A rest day would cover you — once.'
             : s.rested  ? 'Rest day already used.'
             : `${s.days} ${s.days===1?'day':'days'} on the line.`;
    return `<div class="stk warn">
      <div class="stk-n">${icon('bolt',16)} ${s.days}</div>
      <div class="stk-b"><b>No pour yet today</b><div class="stk-sub">${rest}</div></div>
      <button class="btn sm" data-action="open-create">Log one</button></div>`;
  }

  if(s.poured && MILESTONES.includes(s.days)){
    const best=s.days>=s.best?`Your best yet.`:`Best: ${s.best} days.`;
    return `<div class="stk good">
      <div class="stk-n">${icon('bolt',16)} ${s.days}</div>
      <div class="stk-b"><b>${s.days} days in a row</b><div class="stk-sub">${best}</div></div></div>`;
  }

  /* Lapsed, but recently. Past about a week this is just a reminder of
     failure, so it stops asking. */
  if(!s.days && s.best>=3){
    const gap=Math.min(...myPosts().map(p=>daysAgo(p.createdAt,p.ago)).filter(d=>d>=0), Infinity);
    if(gap>=2 && gap<=7) return `<div class="stk">
      <div class="stk-n">${icon('bolt',16)} 0</div>
      <div class="stk-b"><b>Start a new streak</b><div class="stk-sub">Your best was ${s.best} days.</div></div>
      <button class="btn sm" data-action="open-create">Log a pour</button></div>`;
  }
  return '';
}

export function renderExplore(){
  const sugg=discover.list.filter(u=>u&&!state.follows[u.id]).slice(0,8);
  const lbPrev=TOP_POSTS.slice(0,5);
  const board=lbPrev.length
    ? `<div class="lb">${lbPrev.map((r,i)=>lbRow(r,i)).join('')}</div>`
    : `<div class="empty" style="padding:22px">🏆<br>No liked pours yet.<br>Post one — the most-liked coffees land here.</div>`;
  const people=discover.loaded&&!sugg.length
    ? `<div class="empty" style="padding:20px">👋<br>No one else to follow yet — you're early.</div>`
    : sugg.length
      ? `<div class="hscroll">${sugg.map(u=>`<div class="ucard"><div data-action="open-user" data-id="${u.id}" style="cursor:pointer">${avatar(u.id,'big')}<b>${esc(u.name)}</b><span>${u.city?esc(u.city):u.levelName}</span></div>
        ${followBtn(u.id,'sm block')}</div>`).join('')}</div>`
      : '';
  return `<div class="pad">
    <div class="search"><span style="color:var(--muted)">${icon('search',20)}</span><input id="search-input" placeholder="Search people, beans, cafés, pours…" value="${esc(ui.searchQ)}" autocomplete="off" aria-label="Search"></div>
    <div id="explore-results">${ui.searchQ?searchHTML(ui.searchQ):''}</div>
    <div id="explore-normal" style="${ui.searchQ?'display:none':''}">
    ${people?`<div class="section-h"><h2>People to follow</h2></div>${people}`:''}
    <div class="section-h"><h2>Challenges</h2></div>
    <div class="empty" style="padding:18px 20px">Coming soon</div>
    <div class="section-h"><h2>Most-loved pours</h2>${lbPrev.length?'<a data-action="open-board">Full list</a>':''}</div>
    ${board}
    <div class="section-h"><h2>Trending patterns</h2></div>
    <div class="chips" style="margin-bottom:8px">${['rosetta','swan','tulip','heart','abstract','wave','phoenix'].map(t=>`<span class="chip tag" data-action="open-tag" data-id="${t}">#${t}</span>`).join('')}</div>
    </div>
  </div>`;
}

export function renderCafes(){
  return `<div class="pad">
    <div class="section-h"><h2>Cafés</h2></div>
    <div class="empty" style="padding:18px 20px">Coming soon</div>
  </div>`;
}

/* ----- profile ----- */
export function renderProfile(){
  const u=USERS.me, mine=myPosts();
  /* The saved collection comes from the `saves` table, merged with
     anything just bookmarked in this session. */
  const savedPosts=[...saved.list, ...allPosts().filter(p=>p.saved&&!saved.list.some(s=>s.id===p.id))]
    .filter(p=>p.saved!==false);
  const pourCount=Math.max(mine.length, social.counts.pours|0);
  const followingN=social.loaded ? (social.counts.following|0) : Object.values(state.follows).filter(Boolean).length;
  const days=streak();
  /* Level and points come from the profile row, where triggers keep them
     in step with the posts, likes, entries and votes behind them. */
  const points=state.me.points|0, lvl=levelOf(points), next=nextLevel(points);
  const hasPours=pourCount>0, beans=myBeans(), origins=myCountries(), ACT=activityBars();
  const recent=mine.slice().sort((a,b)=>daysAgo(a.createdAt,a.ago)-daysAgo(b.createdAt,b.ago)).slice(0,8);
  const grid = ui.profTab==='pours'
    ? (hasPours?`<div class="grid">${mine.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`:`<div class="empty"><div class="big">☕</div>No pours yet.<br>Tap ＋ to log your first coffee.</div>`)
    : ui.profTab==='saved'
    ? (savedPosts.length?`<div class="grid">${savedPosts.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`
       : saved.loading&&!saved.loaded ? `<div class="empty">Loading your collection…</div>`
       : `<div class="empty"><div class="big">🔖</div>No saved pours yet.<br>Tap the bookmark on any post.</div>`)
    : ui.profTab==='badges' ? renderBadges() : renderStats();
  const bioHTML = state.me.bio ? esc(state.me.bio) : `<span style="color:var(--muted);cursor:pointer" data-action="open-settings">＋ Add a bio in Settings</span>`;
  const journeyHTML = `<div class="journey"><h3>Recent activity</h3><p class="sub">Your last few weeks of coffee.</p>
      <div class="jstats">
        <div><b>${ACT.reduce((a,b)=>a+b,0)}</b><span>last 3 weeks</span></div>
        <div><b>${days}&nbsp;🔥</b><span>day streak</span></div>
        <div><b>${new Set(mine.filter(p=>p.pattern).map(p=>p.pattern)).size}</b><span>art styles</span></div></div>
      <div class="actbars">${ACT.map((c,i)=>{const d=new Date(Date.now()-(ACT.length-1-i)*864e5).toLocaleDateString('en',{weekday:'short',day:'numeric',month:'short'});return `<div class="ab${i===ACT.length-1?' today':''}" data-d="${d}" data-c="${c}"><i style="height:${c===0?8:c===1?52:100}%"></i></div>`;}).join('')}<div class="bartip" id="bartip" hidden></div></div>
      <div class="acthint"><span>3 weeks ago</span><span>today</span></div>
      <div class="recent">${recent.map(p=>`<div class="rp" data-action="open-post" data-id="${p.id}"><div class="rpimg">${art(imageUrl(p.img,'thumb'),p.pattern||'none',p.quality==null?0.9:p.quality,seedOf(p.id),p.drink)}</div><div class="rpd">${agoLabel(p.createdAt,p.ago)}</div><div class="rpt">${esc(p.drink||'Coffee')}</div></div>`).join('')}</div></div>`;
  const startedHTML = `<div class="journey"><h3>Your journey starts here</h3><p class="sub" style="margin-bottom:12px">Every pour earns points, builds your streak and moves you up a level.</p>
      <div style="padding:0 12px 14px"><button class="btn block" data-action="open-create">${icon('bolt',18)} Log your first coffee</button></div></div>`;
  const passportHTML = beans.length?`<div class="section-h" style="margin-bottom:8px"><h2>Bean passport</h2><a data-action="open-passport">See all</a></div>
    <div class="passport"><div class="ph"><div class="lft"><img src="${S.beans}" alt="coffee beans"><b>${beans.length} bean${beans.length===1?'':'s'}</b></div><span data-action="open-passport" style="cursor:pointer">${origins.length?`${origins.length} origin${origins.length===1?'':'s'} · `:''}tap for details</span></div>
      <div class="beans">${beans.map(n=>{const cat=beanCatalog(n);return cat?`<div class="bean" data-action="open-bean" data-id="${esc(cat.n)}"><span class="fl">${flag[cat.c]||'🫘'}</span>${cat.n}</div>`:`<div class="bean" data-action="toast" data-msg="Your own bean — details coming soon">🫘 ${esc(n)}</div>`;}).join('')}</div></div>`:'';
  return `<div class="pad">
    <div class="prof-top"><div class="prof-av" style="background:${u.color};color:#fff;font-family:var(--serif);font-weight:600;font-size:30px;cursor:pointer" data-action="open-settings" title="Change your photo in Settings">${initials(u.name)}${u.avatar?`<img src="${esc(imageUrl(u.avatar,'thumb'))}" alt="" onerror="this.remove()">`:''}</div>
      <div class="prof-id"><b>${esc(u.name)}</b><div class="h">${u.handle}${u.city?` · 📍 ${esc(u.city)}`:''}</div>
        <span class="lvl" data-action="open-scoring">${icon('bolt',13)} Level ${lvl[0]} · ${lvl[1]}</span>${state.me.premium?`<span class="lvlchip" style="margin-left:6px;background:linear-gradient(135deg,#f5d78a,#e0b25a);color:#5a3d17;border-color:#e6c98a">✦ PREMIUM</span>`:''}</div></div>
    <div class="bio">${bioHTML}</div>
    <div class="lvlbar" data-action="open-scoring" style="cursor:pointer">
      <div class="top"><b>${fmt(points)} points</b><span>${next?`${fmt(next[2]-points)} to ${next[1]}`:'Top level reached'}</span></div>
      <div class="track"><i style="width:${Math.round(levelProgress(points)*100)}%"></i></div></div>
    <div class="stats">
      <div><b>${pourCount}</b><span>Pours</span></div>
      <div class="click" data-action="open-flist" data-id="followers"><b>${fmt(u.followerN)}</b><span>Followers</span></div>
      <div class="click" data-action="open-flist" data-id="following"><b>${followingN}</b><span>Following</span></div>
      <div><b>${days} 🔥</b><span>Day streak</span></div></div>
    ${hasPours?journeyHTML:startedHTML}
    ${passportHTML}
    <div class="seg" style="margin-top:18px">
      <button class="${ui.profTab==='pours'?'on':''}" data-action="ptab" data-t="pours">Pours ${pourCount}</button>
      <button class="${ui.profTab==='saved'?'on':''}" data-action="ptab" data-t="saved">Saved</button>
      <button class="${ui.profTab==='badges'?'on':''}" data-action="ptab" data-t="badges">Badges</button>
      <button class="${ui.profTab==='stats'?'on':''}" data-action="ptab" data-t="stats">Stats</button></div>
    ${grid}</div>`;
}
export function renderStats(){
  const mine=myPosts();
  const pats=mine.filter(p=>p.pattern).map(p=>p.pattern);
  const styleCount={}; pats.forEach(p=>styleCount[p]=(styleCount[p]||0)+1);
  const topStyle=Object.keys(styleCount).sort((a,b)=>styleCount[b]-styleCount[a])[0];
  const beans=myBeans(), origins=myCountries();
  const rows=[
    ['Favourite drink',state.me.favDrink||'—',''],
    ['Most-used style',topStyle?cap(topStyle):'—',topStyle?Math.round(styleCount[topStyle]/pats.length*100)+'% of art pours':''],
    ['Current streak',`${streak()} day${streak()===1?'':'s'}`,''],
    ['Beans tried',''+beans.length,origins.length?`${origins.length} origin${origins.length===1?'':'s'}`:''],
    ['Total pours',''+mine.length,''],
    ['Points',fmt(state.me.points|0),`Level ${levelOf(state.me.points|0)[0]}`]
  ];
  return `<div class="lb" style="margin-top:2px">${rows.map(r=>`<div class="lb-row"><div style="flex:1"><b style="font-size:14px">${r[0]}</b></div><div style="text-align:right"><b style="font-family:var(--serif);font-size:16px">${esc(r[1])}</b>${r[2]?`<div style="font-size:11px;color:var(--green);font-weight:700">${esc(r[2])}</div>`:''}</div></div>`).join('')}</div>`;
}
export function renderBadges(){
  const b=computeBadges(), earned=b.filter(x=>x.e).length;
  return `<div style="font-size:12.5px;color:var(--muted);font-weight:600;margin:6px 2px 2px">${earned} of ${b.length} earned</div>
  <div class="bgrid">${b.map(x=>`<div class="badge ${x.e?'':'locked'}"><div class="bic">${x.i}</div>
    <div><b>${x.n}</b><span>${x.e?x.d:(x.p?x.d+' · '+x.p:x.d)}</span></div></div>`).join('')}</div>`;
}

/* ----- tabbar & master render ----- */
export function renderTabbar(){
  const bar=$('#tabbar');
  /* No tab bar on the sign-in screen: there is nowhere else to go. */
  if(!session){ bar.innerHTML=''; bar.hidden=true; return; }
  bar.hidden=false;
  const t=(r,ic,icF,label)=>`<button class="tab ${ui.route===r?'on':''}" data-action="nav" data-r="${r}"><span class="ic">${icon(ui.route===r&&icF?icF:ic,25)}</span><span>${label}</span></button>`;
  bar.innerHTML=t('home','home','homeF','Home')+t('explore','compass','compass','Explore')+`<button class="tab plus" data-action="open-create" aria-label="New coffee"><span class="fab">${icon('plus',26)}</span></button>`+t('cafes','cup','cup','Cafés')+t('profile','user','userF','You');
}
export function renderView(){
  const v=$('#view'), route=session?ui.route:'gate';
  const reset=v.dataset.route!==route; v.dataset.route=route;
  v.innerHTML = !session?renderGate()
    : ui.route==='home'?renderHome() : ui.route==='explore'?renderExplore() : ui.route==='cafes'?renderCafes() : renderProfile();
  if(reset) v.scrollTop=0;
}
export function render(){renderAppbar();renderTabbar();renderView();renderOverlay();}
