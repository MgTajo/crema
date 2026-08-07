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
import { USERS, PODIUM, CHALLENGES } from '../data/world.js';
import { state, ui, session, feed, discover, social, saved, mine, challenges, streak, streakInfo,
         myPosts, allPosts, myBeans, myCountries, activityBars, feedPosts, coffeeStats } from '../store/store.js';
import { imageUrl } from '../data/media.js';
import { art } from '../domain/art.js';
import { computeBadges, levelOf, nextLevel, levelProgress } from '../domain/scoring.js';
import { postCard, searchHTML, avatar, podiumRow, gcell, followBtn } from './components.js';
import { icon, logoMark } from './icons.js';
import { renderOverlay, challengeCard } from './overlays.js';
import { renderGate } from './gate.js';
import { arm } from './history.js';

export function renderAppbar(){
  const bar=$('#appbar');
  if(!session){
    /* On the sign-in screen the only move is back to what they were
       reading — no bell, no streak, nothing that needs an account. */
    if(ui.gate){ bar.innerHTML=`<button class="iconbtn" data-action="guest-back" aria-label="Back to today's pours">${icon('back',20)}</button><div class="title">${logoMark()} Crema</div>`; return; }
    bar.innerHTML=`<div class="title" data-action="reload" title="Reload Crema">${logoMark()} Crema</div>
      <div class="actions"><button class="btn sm" data-action="guest-signin" data-m="in">Sign in</button></div>`;
    return;
  }
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
  else if(ui.route==='cafes') bar.innerHTML=`<div class="title">Cafés</div><div class="actions">${USERS.me.city?`<div class="streak" style="background:var(--pm1);border-color:var(--pm2);color:var(--green)">${icon('cafe',14)} ${esc(USERS.me.city)}</div>`:''}${bell}</div>`;
  else if(ui.route==='profile') bar.innerHTML=`<div class="title">Profile</div><div class="actions"><button class="iconbtn" data-action="open-settings" aria-label="Settings">${icon('gear',20)}</button></div>`;
}

export function renderHome(){
  const list=feedPosts();
  const empty = feed.loading&&!feed.loaded
    ? `<div class="empty"><div class="big">☕</div>Loading ${session?'your feed':'today\'s pours'}…</div>`
    : ui.filter==='following'
      ? `<div class="empty"><div class="big">👥</div>No pours from people you follow yet.<br>Find baristas on Explore.</div>`
      : `<div class="empty"><div class="big">🌅</div>Nobody has poured today yet.<br>${session?'Tap ＋ and be the first.':'Come back in the morning.'}</div>`;
  return `<div class="pad">
    ${followRequestsBlock()}
    ${streakBlock()}
    <div class="seg">
      <button class="${ui.filter==='today'?'on':''}" data-action="filter" data-f="today">Today</button>
      <button class="${ui.filter==='following'?'on':''}" data-action="filter" data-f="following">Following</button>
    </div>
    ${list.length?list.map(postCard).join(''):empty}
    ${guestPitch()}
  </div>`;
}

/* The one thing on a guest's screen that asks for anything, and it sits
   *under* the feed — after the pours have made whatever case they are
   going to make. Everything above this is the product working.

   The sign-in sheet (ui/overlays) catches guests who reach for a button;
   this catches the ones who just read to the bottom and would otherwise
   have nothing to tap. */
function guestPitch(){
  if(session) return '';
  return `<div class="gpitch">
    <b>Every cup, kept.</b>
    <p>Your streak, your beans, and the people who care about the same 30 seconds of the morning that you do.</p>
    <button class="btn block" data-action="guest-signin" data-m="up">Create your account</button>
    <div class="alt">Already have one? <b data-action="guest-signin" data-m="in">Sign in</b></div>
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
  /* Three, never more. PODIUM already arrives capped at three from the
     server; the slice is belt-and-braces so a future caller asking for a
     wider window can't quietly widen the podium too. */
  const podium=PODIUM.slice(0,3);
  const board=podium.length
    ? `<div class="rlist">${podium.map(podiumRow).join('')}</div>`
    : `<div class="empty" style="padding:22px">🏆<br>No pours on today's podium yet.<br>Post one — the day's three most-loved coffees land here.</div>`;
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
    <div class="section-h"><h2>This week's challenges</h2>${CHALLENGES.length?'<a data-action="open-challenges">All three</a>':''}</div>
    ${challengeBlock()}
    <div class="section-h"><h2>Today's podium</h2></div>
    ${board}
    <div style="font-size:12px;color:var(--muted);text-align:center;margin:8px 2px 0">
      The three most-loved pours of the day — likes and comments both count. It clears at midnight — everyone starts level tomorrow.</div>
    <div class="section-h"><h2>Trending patterns</h2></div>
    <div class="chips" style="margin-bottom:8px">${['rosetta','swan','tulip','heart','abstract','wave','phoenix'].map(t=>`<span class="chip tag" data-action="open-tag" data-id="${t}">#${t}</span>`).join('')}</div>
    </div>
  </div>`;
}

/* The three live challenges. They are the same cards as the sheet, so
   there is one place that decides what a challenge looks like.

   `challenges.loaded` separates "none are running" from "we haven't
   asked yet" — the first is a real state worth a sentence, the second
   would be a lie. */
function challengeBlock(){
  if(!CHALLENGES.length)
    return `<div class="empty" style="padding:18px 20px">${challenges.loaded
      ? 'No challenges running right now.<br>Three new ones land every Monday.'
      : 'Loading this week\u2019s challenges…'}</div>`;
  return CHALLENGES.map(challengeCard).join('');
}

/* ----- cafés -----
   The café side of Crema is designed and not yet open: the schema, the
   café page, the follow and the tagged pour all exist, there are simply
   no cafés on it yet. So this screen does the one useful thing an unbuilt
   section can — it tells the people who would fill it how to get in.

   The ask is a prefilled email rather than a form. At pilot volumes an
   email is the better instrument: it opens a conversation with a named
   human instead of dropping a row somewhere, it needs no backend, no
   third-party form embed and no new entry in the privacy policy, and
   hello@crema-app.com is already the address the Impressum publishes.
   The prefilled body does what the form fields would have done. Worth
   revisiting if this ever gets loud — see the note in CAFE_PITCH below.

   The copy is written to create urgency out of things that are true —
   a pilot is genuinely small, early cafés genuinely shape what gets
   built — and never out of invented traction. No counters, no "43 cafés
   already signed up". A number nobody can verify is the fastest way to
   lose the kind of owner worth having. */
export const CAFE_MAIL='hello@crema-app.com';
const CAFE_SUBJECT='Crema — café pilot';
const CAFE_BODY=`Hi Magnus,

I'd like to put my café on Crema.

Café:
City:
Website / Instagram:
What we pour:

What I'm most interested in:

Thanks!`;
const cafeMailto=()=>`mailto:${CAFE_MAIL}?subject=${encodeURIComponent(CAFE_SUBJECT)}&body=${encodeURIComponent(CAFE_BODY)}`;

export function renderCafes(){
  const perks=[
    ['📍','Your café, on the map','A page with the beans you pour and the machine you pull them on.'],
    ['☕','Every pour tagged to you','Someone photographs their flat white at your bar and your name is on it.'],
    ['❤️','Regulars you can actually see','People follow your café and see what gets poured there.'],
    ['🎁','An offer worth showing','Put something behind a posted pour — a discount, a filter on the house.']
  ];
  return `<div class="pad">
    <div class="cafe-soon">
      <div class="cs-badge">Opening city by city</div>
      <h3>The best coffee near you, from the people drinking it</h3>
      <p>Crema is people logging what they pour. Cafés are the other half of that — and they're being switched on one city at a time.</p>
    </div>

    <div class="cafe-pitch">
      <div class="cp-top"><span>☕</span><div><b>Own a café?</b><i>Get in before your street does.</i></div></div>
      <p class="cp-lead">We're opening Crema to a small first group of cafés. Pilot places are handled in the order they arrive, one city at a time — and the cafés in that first group are the ones whose feedback decides what gets built next.</p>
      <div class="cp-perks">${perks.map(p=>`<div><span>${p[0]}</span><div><b>${p[1]}</b><i>${p[2]}</i></div></div>`).join('')}</div>
      <a class="btn block" href="${cafeMailto()}" data-action="cafe-lead">✉️ Ask for a pilot place</a>
      <div class="cp-mail" data-action="copy-cafe-mail">or write to <b>${CAFE_MAIL}</b> · tap to copy</div>
      <p class="cp-fine">Tell us your café and city and we'll come back to you when your city opens. No cost during the pilot.</p>
    </div>

    <div class="cafe-nudge">
      <b>Not an owner?</b> Tell your favourite café about Crema — the ones people ask for get opened first.
      <button class="btn ghost sm" data-action="share-crema">Share Crema</button>
    </div>
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
      <div class="prof-id"><b>${esc(u.name)}</b><div class="h">${u.handle}${u.city?` · ${esc(u.city)}`:''}</div>
        <span class="lvl" data-action="open-scoring">${icon('bolt',13)} Level ${lvl[0]} · ${lvl[1]}</span>${state.me.premium?`<span class="lvlchip" style="margin-left:6px;background:var(--gold);color:var(--on-crema);border-color:transparent">PREMIUM</span>`:''}</div></div>
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
/* ----- stats -----
   Coffee people keep numbers. This tab is the one place in a social app
   where that is the point, so it answers questions rather than listing
   fields: which coffee do I actually make, how much of it, when, and —
   for anyone who fills the recipe in — what does my espresso look like
   as a ratio.

   Everything comes from coffeeStats() and nothing is padded out. A
   section whose data has never been logged is absent, not shown empty:
   a "0.0 average ratio" for someone who has never weighed a shot is
   noise pretending to be insight, and it would bury the two or three
   numbers that are real. */
const pct=(a,b)=>b?Math.round(a/b*100):0;
const oneDp=v=>(Math.round(v*10)/10).toFixed(1);
const hourLabel=h=>(h<10?'0':'')+h+':00';

/* A drink split as one bar. Three named, the rest collected — a legend
   with eleven entries stops being a legend. */
function drinkMix(drinks,total){
  const top=drinks.slice(0,3), rest=drinks.slice(3).reduce((a,d)=>a+d.count,0);
  const seg=(w,i)=>`<i style="width:${w}%" class="s${i}"></i>`;
  return `<div class="stx-mix">${top.map((d,i)=>seg(pct(d.count,total),i)).join('')}${rest?seg(pct(rest,total),3):''}</div>
    <div class="stx-leg">${top.map((d,i)=>`<span><i class="s${i}"></i>${esc(d.name)} ${pct(d.count,total)}%</span>`).join('')}
      ${rest?`<span><i class="s3"></i>Other ${pct(rest,total)}%</span>`:''}</div>`;
}
function statCard(title,body,note){
  return `<div class="stx-card"><h4>${title}</h4>${body}${note?`<p class="stx-note">${note}</p>`:''}</div>`;
}
const statRows=rows=>`<div class="stx-rows">${rows.map(r=>
  `<div><span>${esc(r[0])}</span><b>${esc(r[1])}</b>${r[2]?`<i>${esc(r[2])}</i>`:''}</div>`).join('')}</div>`;

export function renderStats(){
  const s=coffeeStats();
  if(!s) return `<div class="empty"><div class="big">📊</div>No numbers yet.<br>Log a few coffees and this fills up on its own.<br><br>
    <button class="btn sm" data-action="open-create">Log a coffee</button></div>`;
  const top=s.drinks[0];
  const out=[];

  /* The headline answers the question people actually ask of an app like
     this, and answers it by counting rather than by repeating the
     preference they set during onboarding. */
  out.push(`<div class="stx-hero">
    <span class="stx-k">Your coffee</span>
    <b>${esc(top.name)}</b>
    <span class="stx-sub">${top.count} of ${s.pours} pour${s.pours===1?'':'s'} · ${pct(top.count,s.pours)}% of everything you log</span>
    ${s.drinks.length>1?drinkMix(s.drinks,s.pours):''}
  </div>`);

  out.push(`<div class="stx-tiles">
    <div><b>${oneDp(s.perDay)}</b><span>coffees a day</span></div>
    <div><b>${s.pours}</b><span>pours logged</span></div>
    <div><b>${s.daysLogged}</b><span>day${s.daysLogged===1?'':'s'} with coffee</span></div>
    <div><b>${s.best}</b><span>best streak</span></div>
  </div>`);

  /* Rounded to one decimal, which is the honest precision for a rate
     built out of a handful of days. The second line says what the
     average is actually over, because "1.4 a day" means something very
     different across nine days than across nine months. */
  const rhythm=[`Across ${s.span} day${s.span===1?'':'s'} since your first pour — that's about ${oneDp(s.perWeek)} a week.`];
  if(s.busiest>1) rhythm.push(`Your biggest day was ${s.busiest} coffees.`);
  if(s.streak>0) rhythm.push(`You're ${s.streak} day${s.streak===1?'':'s'} into a streak right now.`);
  out.push(statCard('Your rhythm',`<p class="stx-p">${rhythm.join(' ')}</p>`));

  /* The hour histogram only claims the pours that carry a real
     timestamp, and says so when that isn't all of them. */
  if(s.timed>=3&&s.peakHour!=null){
    const max=Math.max(...s.hours);
    const bars=s.hours.map((c,h)=>`<i class="${h===s.peakHour?'on':''}" style="height:${c?Math.max(9,Math.round(c/max*100)):3}%" title="${hourLabel(h)} · ${c}"></i>`).join('');
    out.push(statCard('When you pour',
      `<div class="stx-hours">${bars}</div>
       <div class="stx-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>`,
      `Most of your coffee happens around <b>${hourLabel(s.peakHour)}</b>${s.timed<s.pours?` · from the ${s.timed} pours with a recorded time`:''}.`));
  }

  const setup=[];
  if(s.beans[0])    setup.push(['Most-poured coffee',s.beans[0].name,`${s.beans[0].count}×`]);
  if(s.roasters[0]) setup.push(['Roaster you return to',s.roasters[0].name,`${s.roasters[0].count}×`]);
  if(s.machines[0]) setup.push(['Machine',s.machines[0].name,`${s.machines[0].count}×`]);
  if(s.milks[0])    setup.push(['Milk',s.milks[0].name,`${pct(s.milks[0].count,s.pours)}%`]);
  /* The pattern's own count, not every art pour — a row reading
     "Rosetta · 7 pours" next to a total that also happens to be 7 is a
     number that means one thing and looks like another. */
  if(s.patterns[0]) setup.push(['Latte art',cap(s.patterns[0].name),`${s.patterns[0].count}×`]);
  if(s.cafePours)   setup.push(['Poured at a café',`${pct(s.cafePours,s.pours)}%`,`${s.cafePours}×`]);
  if(setup.length){
    const notes=[];
    if(s.beans.length>1) notes.push(`${s.beans.length} different coffees so far.`);
    if(s.artPours) notes.push(`You poured art on ${pct(s.artPours,s.pours)}% of your coffees.`);
    out.push(statCard('What you brew with',statRows(setup),notes.join(' ')));
  }

  /* Only for people who weigh things — which is exactly the group this
     section is for, and no use at all to anyone else. */
  if(s.brew) out.push(statCard('Your espresso',
    `<div class="stx-tiles sm">
      <div><b>1:${oneDp(s.brew.ratio)}</b><span>average ratio</span></div>
      <div><b>${oneDp(s.brew.dose)}g</b><span>dose in</span></div>
      <div><b>${oneDp(s.brew.out)}g</b><span>yield out</span></div>
      ${s.brew.secs?`<div><b>${Math.round(s.brew.secs)}s</b><span>shot time</span></div>`:''}
    </div>`,
    `From the ${s.brew.n} pour${s.brew.n===1?'':'s'} where you logged both dose and yield.`));
  else out.push(`<div class="stx-hint" data-action="open-create">⚖️ Log a dose and a yield on your next pour and your brew ratio shows up here.</div>`);

  return `<div class="stx">${out.join('')}</div>`;
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
  /* No tab bar on the sign-in screen: there is nowhere else to go.
     A guest keeps it, though — the tabs are the shape of the app, and
     one that shows what it has is more honest than one that hides it.
     Every tab but Home asks them to sign in when tapped. */
  if(!session&&ui.gate){ bar.innerHTML=''; bar.hidden=true; return; }
  bar.hidden=false;
  const t=(r,ic,icF,label)=>`<button class="tab ${ui.route===r?'on':''}" data-action="nav" data-r="${r}"><span class="ic">${icon(ui.route===r&&icF?icF:ic,25)}</span><span>${label}</span></button>`;
  bar.innerHTML=t('home','home','homeF','Home')+t('explore','compass','compass','Explore')+`<button class="tab plus" data-action="open-create" aria-label="New coffee"><span class="fab">${icon('plus',26)}</span></button>`+t('cafes','cafe','cafe','Cafés')+t('profile','user','userF','You');
}
export function renderView(){
  /* Signed out there are two screens, not one: the guest feed, and the
     sign-in gate they can step into and back out of. */
  const v=$('#view'), route=session?ui.route:(ui.gate?'gate':'guest');
  const reset=v.dataset.route!==route; v.dataset.route=route;
  v.innerHTML = !session?(ui.gate?renderGate():renderHome())
    : ui.route==='home'?renderHome() : ui.route==='explore'?renderExplore() : ui.route==='cafes'?renderCafes() : renderProfile();
  if(reset) v.scrollTop=0;
}
export function render(){renderAppbar();renderTabbar();renderView();renderOverlay();arm();}
