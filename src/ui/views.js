"use strict";
/* ============================================================
   ui/views — the four main screens plus the app bar and tab bar,
   and the top-level render() that repaints everything.
   Renderers are pure string→DOM: they read the store and emit HTML,
   then write it into the shell's mount points.
   ============================================================ */
import { $, esc, fmt, cap, initials, seedOf, agoDays, agoLabel } from '../core/util.js';
import { S } from '../data/assets.js';
import { beanCatalog, flag } from '../data/catalog.js';
import { USERS, CAFES, CHALLENGES, TOP_POSTS } from '../data/world.js';
import { state, ui, session, feed, discover, social, streak,
         myPosts, allPosts, myBeans, myCountries, activityBars, feedPosts } from '../store/store.js';
import { imageUrl } from '../data/media.js';
import { art, cupSVG } from '../domain/art.js';
import { computeBadges, levelOf, nextLevel, levelProgress } from '../domain/scoring.js';
import { postCard, searchHTML, avatar, lbRow, cafeCard, gcell, joinedLabel } from './components.js';
import { icon, pin, logoMark } from './icons.js';
import { renderOverlay } from './overlays.js';
import { renderGate } from './gate.js';

export function renderAppbar(){
  const bar=$('#appbar');
  if(!session){ bar.innerHTML=`<div class="title" data-action="reload" title="Reload Crema">${logoMark()} Crema</div>`; return; }
  const unread=state.notifications.some(n=>!n.read);
  const bell=`<button class="iconbtn" data-action="open-notifs" aria-label="Notifications">${icon('bell',20)}${unread?'<span class="ndot"></span>':''}</button>`;
  if(ui.route==='home'){ const s=streak(); const streakChip=s>0?`<div class="streak" title="Day streak">${icon('bolt',15)} ${s}</div>`:''; bar.innerHTML=`<div class="title" data-action="reload" title="Reload Crema">${logoMark()} Crema</div><div class="actions">${streakChip}${bell}</div>`; }
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
      : `<div class="empty"><div class="big">☕</div>No pours yet.<br>Tap ＋ to log the first one.</div>`;
  return `<div class="pad">
    <div class="seg">
      <button class="${ui.filter==='foryou'?'on':''}" data-action="filter" data-f="foryou">For you</button>
      <button class="${ui.filter==='following'?'on':''}" data-action="filter" data-f="following">Following</button>
    </div>
    ${list.length?list.map(postCard).join(''):empty}
  </div>`;
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
        <button class="btn sm block" data-action="follow" data-id="${u.id}">Follow</button></div>`).join('')}</div>`
      : '';
  return `<div class="pad">
    <div class="search"><span style="color:var(--muted)">${icon('search',20)}</span><input id="search-input" placeholder="Search people, beans, cafés, pours…" value="${esc(ui.searchQ)}" autocomplete="off" aria-label="Search"></div>
    <div id="explore-results">${ui.searchQ?searchHTML(ui.searchQ):''}</div>
    <div id="explore-normal" style="${ui.searchQ?'display:none':''}">
    ${people?`<div class="section-h"><h2>People to follow</h2></div>${people}`:''}
    ${CHALLENGES.length?`<div class="section-h"><h2>Challenges</h2><a data-action="open-challenges">See all</a></div>
    <div class="hscroll">${CHALLENGES.map(c=>{const j=state.challenges[c.id];return `<div class="ch-card">
      <div class="ch-top" data-action="open-challenge" data-id="${c.id}"><span class="ends">Ends in ${c.ends}</span>${cupSVG(c.pattern,.9,c.id.charCodeAt(0))}</div>
      <div class="ch-b"><h3>${c.title}</h3><p>${joinedLabel(c)} · ${c.tag}</p>
        <button class="btn ${j?'ghost':''} sm block" data-action="join" data-id="${c.id}">${j?'✓ Joined':'Join challenge'}</button></div></div>`;}).join('')}</div>`:''}
    <div class="section-h"><h2>Most-loved pours</h2>${lbPrev.length?'<a data-action="open-board">Full list</a>':''}</div>
    ${board}
    <div class="section-h"><h2>Trending patterns</h2></div>
    <div class="chips" style="margin-bottom:8px">${['rosetta','swan','tulip','heart','wave','phoenix'].map(t=>`<span class="chip tag" data-action="open-tag" data-id="${t}">#${t}</span>`).join('')}</div>
    </div>
  </div>`;
}

export function renderCafes(){
  const f=ui.cafeF;
  const list=CAFES.filter(c=>(!f.open||(c.hours||'').startsWith('Open'))&&(!f.promo||c.promo)&&(!f.top||c.rating>=4.8));
  if(!CAFES.length) return `<div class="pad">
    <div class="empty"><div class="big">🗺️</div>No cafés in the directory yet.<br>They'll appear here once Crema lists some.</div></div>`;
  return `<div class="pad">
    <div class="map"><svg viewBox="0 0 340 190" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="340" height="190" fill="#e7dcc8"/>
      <path d="M-10 120 Q120 90 180 140 T360 120 L360 200 L-10 200Z" fill="#cfe0dd" opacity=".7"/>
      <g stroke="#d8cbb2" stroke-width="8" fill="none" opacity=".8"><path d="M40 -10 L60 200"/><path d="M150 -10 L140 200"/><path d="M250 -10 L270 200"/><path d="M-10 60 L360 40"/><path d="M-10 130 L360 150"/></g>
      <g fill="#ddd0ba" opacity=".8"><rect x="70" y="50" width="60" height="60" rx="6"/><rect x="170" y="60" width="70" height="50" rx="6"/><rect x="80" y="150" width="50" height="40" rx="6"/><rect x="280" y="70" width="50" height="60" rx="6"/></g></svg>
      ${CAFES.map(c=>`<div class="pin" style="left:${c.x};top:${c.y}" data-action="open-cafe" data-id="${c.id}">${pin(c.color)}</div>`).join('')}</div>
    <div class="filters">${[['open','Open now'],['promo','Deals'],['top','Top rated']].map(x=>`<button class="fchip ${f[x[0]]?'on':''}" data-action="cafe-filter" data-f="${x[0]}">${x[1]}</button>`).join('')}</div>
    <div class="section-h" style="margin-top:4px"><h2>Near you</h2></div>
    ${list.length?list.map(cafeCard).join(''):`<div class="empty"><div class="big">🗺️</div>${CAFES.length?'No cafés match those filters.':'No cafés yet — they arrive from the Crema directory.'}</div>`}
  </div>`;
}

/* ----- profile ----- */
export function renderProfile(){
  const u=USERS.me, mine=myPosts(), savedPosts=allPosts().filter(p=>p.saved);
  const pourCount=Math.max(mine.length, social.counts.pours|0);
  const followingN=social.loaded ? (social.counts.following|0) : Object.values(state.follows).filter(Boolean).length;
  const days=streak();
  /* Level and points come from the profile row, where triggers keep them
     in step with the posts, likes, entries and votes behind them. */
  const points=state.me.points|0, lvl=levelOf(points), next=nextLevel(points);
  const hasPours=pourCount>0, beans=myBeans(), origins=myCountries(), ACT=activityBars();
  const recent=mine.slice().sort((a,b)=>agoDays(a.ago)-agoDays(b.ago)).slice(0,8);
  const grid = ui.profTab==='pours'
    ? (hasPours?`<div class="grid">${mine.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`:`<div class="empty"><div class="big">☕</div>No pours yet.<br>Tap ＋ to log your first coffee.</div>`)
    : ui.profTab==='saved'
    ? (savedPosts.length?`<div class="grid">${savedPosts.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`:`<div class="empty"><div class="big">🔖</div>No saved pours yet.<br>Tap the bookmark on any post.</div>`)
    : ui.profTab==='badges' ? renderBadges() : renderStats();
  const bioHTML = state.me.bio ? esc(state.me.bio) : `<span style="color:var(--muted);cursor:pointer" data-action="open-settings">＋ Add a bio in Settings</span>`;
  const journeyHTML = `<div class="journey"><h3>Recent activity</h3><p class="sub">Your last few weeks of coffee.</p>
      <div class="jstats">
        <div><b>${ACT.reduce((a,b)=>a+b,0)}</b><span>last 3 weeks</span></div>
        <div><b>${days}&nbsp;🔥</b><span>day streak</span></div>
        <div><b>${new Set(mine.filter(p=>p.pattern).map(p=>p.pattern)).size}</b><span>art styles</span></div></div>
      <div class="actbars">${ACT.map((c,i)=>{const d=new Date(Date.now()-(ACT.length-1-i)*864e5).toLocaleDateString('en',{weekday:'short',day:'numeric',month:'short'});return `<div class="ab${i===ACT.length-1?' today':''}" data-d="${d}" data-c="${c}"><i style="height:${c===0?8:c===1?52:100}%"></i></div>`;}).join('')}<div class="bartip" id="bartip" hidden></div></div>
      <div class="acthint"><span>3 weeks ago</span><span>today</span></div>
      <div class="recent">${recent.map(p=>`<div class="rp" data-action="open-post" data-id="${p.id}"><div class="rpimg">${art(imageUrl(p.img,'thumb'),p.pattern||'none',p.quality==null?0.9:p.quality,seedOf(p.id),p.drink)}</div><div class="rpd">${agoLabel(p.ago)}</div><div class="rpt">${esc(p.drink||'Coffee')}</div></div>`).join('')}</div></div>`;
  const startedHTML = `<div class="journey"><h3>Your journey starts here</h3><p class="sub" style="margin-bottom:12px">Every pour earns points, builds your streak and moves you up a level.</p>
      <div style="padding:0 12px 14px"><button class="btn block" data-action="open-create">${icon('bolt',18)} Log your first coffee</button></div></div>`;
  const passportHTML = beans.length?`<div class="section-h" style="margin-bottom:8px"><h2>Bean passport</h2><a data-action="open-passport">See all</a></div>
    <div class="passport"><div class="ph"><div class="lft"><img src="${S.beans}" alt="coffee beans"><b>${beans.length} bean${beans.length===1?'':'s'}</b></div><span data-action="open-passport" style="cursor:pointer">${origins.length?`${origins.length} origin${origins.length===1?'':'s'} · `:''}tap for details</span></div>
      <div class="beans">${beans.map(n=>{const cat=beanCatalog(n);return cat?`<div class="bean" data-action="open-bean" data-id="${esc(cat.n)}"><span class="fl">${flag[cat.c]||'🫘'}</span>${cat.n}</div>`:`<div class="bean" data-action="toast" data-msg="Your own bean — details coming soon">🫘 ${esc(n)}</div>`;}).join('')}</div></div>`:'';
  return `<div class="pad">
    <div class="prof-top"><div class="prof-av" style="background:${u.color};color:#fff;font-family:var(--serif);font-weight:600;font-size:30px">${initials(u.name)}</div>
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
