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
         myPosts, allPosts, myBeans, myCountries, machinePassport, activityBars, feedPosts, coffeeStats,
         friendsToday, weekRecap, arrivals } from '../store/store.js';
import { imageUrl } from '../data/media.js';
import { art } from '../domain/art.js';
import { computeBadges, levelOf, nextLevel, levelProgress } from '../domain/scoring.js';
import { t, tn, lang, locale, LANGS } from '../i18n.js';
import { postCard, searchHTML, avatar, podiumRow, gcell, followBtn } from './components.js';
import { icon, logoMark } from './icons.js';
import { hhmm } from './recap.js';
import { renderOverlay, challengeCard } from './overlays.js';
import { renderGate } from './gate.js';
import { arm } from './history.js';

export function renderAppbar(){
  const bar=$('#appbar');
  if(!session){
    /* On the sign-in screen the only move is back to what they were
       reading — no bell, no streak, nothing that needs an account. */
    if(ui.gate){ bar.innerHTML=`<button class="iconbtn" data-action="guest-back" aria-label="${t('Back to today\'s pours')}">${icon('back',20)}</button><div class="title">${logoMark()} Crema</div>`; return; }
    bar.innerHTML=`<div class="title" data-action="reload" title="${t('Reload Crema')}">${logoMark()} Crema</div>
      <div class="actions"><button class="btn sm" data-action="guest-signin" data-m="in">${t('Sign in')}</button></div>`;
    return;
  }
  const unread=state.notifications.some(n=>!n.read);
  const bell=`<button class="iconbtn" data-action="open-notifs" aria-label="${t('Notifications')}">${icon('bell',20)}${unread?'<span class="ndot"></span>':''}</button>`;
  if(ui.route==='home'){
    /* The chip goes hollow when the streak is unfinished today. It is
       the same number either way — what changes is whether it looks
       banked or still owed. */
    const s=streakInfo();
    const streakChip=s.days>0
      ? `<div class="streak${s.atRisk?' open':''}" data-action="open-streak" title="${s.atRisk?t('Not poured today'):t('Day streak')}">${icon('bolt',15)} ${s.days}</div>`
      : '';
    bar.innerHTML=`<div class="title" data-action="reload" title="${t('Reload Crema')}">${logoMark()} Crema</div><div class="actions">${streakChip}${bell}</div>`;
  }
  else if(ui.route==='explore') bar.innerHTML=`<div class="title">${t('Explore')}</div><div class="actions">${bell}</div>`;
  else if(ui.route==='cafes') bar.innerHTML=`<div class="title">${t('Cafés')}</div><div class="actions">${USERS.me.city?`<div class="streak" style="background:var(--pm1);border-color:var(--pm2);color:var(--green)">${icon('cafe',14)} ${esc(USERS.me.city)}</div>`:''}${bell}</div>`;
  else if(ui.route==='profile') bar.innerHTML=`<div class="title">${t('Profile')}</div><div class="actions"><button class="iconbtn" data-action="open-settings" aria-label="${t('Settings')}">${icon('gear',20)}</button></div>`;
}

export function renderHome(){
  const list=feedPosts();
  const empty = feed.loading&&!feed.loaded
    ? `<div class="empty"><div class="big">☕</div>${session?t('Loading your feed…'):t('Loading today\'s pours…')}</div>`
    : ui.filter==='following'
      ? `<div class="empty"><div class="big">👥</div>${t('Nobody you follow has poured yet.')}<br>${t('Find baristas on Explore.')}</div>`
      : `<div class="empty"><div class="big">🌅</div>${t('Nobody has poured today yet.')}<br>${session?t('Tap ＋ and be the first.'):t('Come back in the morning.')}</div>`;
  return `<div class="pad">
    ${followRequestsBlock()}
    ${streakBlock()}
    ${friendsTodayStrip()}
    <div class="seg">
      <button class="${ui.filter==='today'?'on':''}" data-action="filter" data-f="today">${t('Today')}</button>
      <button class="${ui.filter==='following'?'on':''}" data-action="filter" data-f="following">${t('Following')}</button>
    </div>
    ${arrivalsPill()}
    ${list.length?list.map(postCard).join(''):empty}
    ${guestPitch()}
  </div>`;
}

/* Pours that landed while this screen was open, waiting to be let in.
   It only ever appears when ui/actions.js decided it was not safe to
   splice them in — which means the reader is somewhere below the top of
   the feed, and shifting the card under their thumb would cost them
   their place. See `arrivals` in store/store.js.

   A count rather than a dot: "3 new pours" is worth a tap on a morning
   when the feed is otherwise the same six it was an hour ago, and a
   bare dot isn't. */
function arrivalsPill(){
  const n=arrivals.list.length; if(!n) return '';
  return `<button class="newpours" data-action="show-arrivals">
    <i>${icon('back',13)}</i>${tn(n,'{n} new pour','{n} new pours')}</button>`;
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
    <b>${t('Every cup, kept.')}</b>
    <p>${t('Your streak and your beans, plus the people who care about the same 30 seconds of the morning that you do.')}</p>
    <button class="btn block" data-action="guest-signin" data-m="up">${t('Create your account')}</button>
    <div class="alt">${t('Already have one?')} <b data-action="guest-signin" data-m="in">${t('Sign in')}</b></div>
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
    <div class="freq-h">${icon('bell',15)} ${tn(reqs.length,'{n} follow request','{n} follow requests')}</div>
    ${reqs.map(r=>`<div class="freq-row">
      <div class="idwrap" data-action="open-user" data-id="${r.id}">${avatar(r.id)}
        <div class="who"><b>${esc(r.user.name)}</b><span>${esc(r.user.handle)} · ${r.ago}</span></div></div>
      <button class="btn sm" data-action="accept-follow" data-id="${r.id}">${t('Accept')}</button>
      <button class="btn ghost sm" data-action="decline-follow" data-id="${r.id}">${t('Decline')}</button>
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
    const rest=s.canRest ? t('A rest day would cover you, once.')
             : s.rested  ? t('Rest day already used.')
             : tn(s.days,'{n} day on the line.','{n} days on the line.');
    return `<div class="stk warn">
      <div class="stk-n">${icon('bolt',16)} ${s.days}</div>
      <div class="stk-b"><b>${t('No pour yet today')}</b><div class="stk-sub">${rest}</div></div>
      <button class="btn sm" data-action="open-create">${t('Log one')}</button></div>`;
  }

  if(s.poured && MILESTONES.includes(s.days)){
    const best=s.days>=s.best?t('Your best yet.'):t('Best: {n} days.',{n:s.best});
    return `<div class="stk good">
      <div class="stk-n">${icon('bolt',16)} ${s.days}</div>
      <div class="stk-b"><b>${t('{n} days in a row',{n:s.days})}</b><div class="stk-sub">${best}</div></div></div>`;
  }

  /* Lapsed, but recently. Past about a week this is just a reminder of
     failure, so it stops asking. */
  if(!s.days && s.best>=3){
    const gap=Math.min(...myPosts().map(p=>daysAgo(p.createdAt,p.ago)).filter(d=>d>=0), Infinity);
    if(gap>=2 && gap<=7) return `<div class="stk">
      <div class="stk-n">${icon('bolt',16)} 0</div>
      <div class="stk-b"><b>${t('Start a new streak')}</b><div class="stk-sub">${t('Your best was {n} days.',{n:s.best})}</div></div>
      <button class="btn sm" data-action="open-create">${t('Log a pour')}</button></div>`;
  }
  return '';
}

/* "N friends already brewed today" — reciprocity, not a task list: unlike
   followRequestsBlock() above it, nothing here needs an answer from you.
   Tapping it opens the same Following tab loadFriendsToday() itself
   draws from, so the strip is never claiming something the tab beneath
   it can't back up.

   Silent until friendsToday has actually loaded and silent when it's
   empty — a strip reading "0 friends" the first time anyone opens the
   app on a given morning is worse than no strip, and loaded starts
   false specifically so this can tell "not fetched yet" apart from
   "fetched, nobody yet". */
function friendsTodayStrip(){
  if(!session || !friendsToday.loaded) return '';
  const ids=friendsToday.list; if(!ids.length) return '';
  const shown=ids.slice(0,6), extra=ids.length-shown.length;
  return `<div class="ftoday" data-action="filter" data-f="following">
    <div class="ftoday-faces">${shown.map(id=>avatar(id)).join('')}${extra>0?`<div class="ftoday-more">+${extra}</div>`:''}</div>
    <div class="ftoday-t">${tn(ids.length,'{n} friend has already brewed today ☕','{n} friends have already brewed today ☕',{n:ids.length})}</div>
  </div>`;
}

export function renderExplore(){
  const sugg=discover.list.filter(u=>u&&!state.follows[u.id]).slice(0,8);
  /* Three, never more. PODIUM already arrives capped at three from the
     server; the slice is belt-and-braces so a future caller asking for a
     wider window can't quietly widen the podium too. */
  const podium=PODIUM.slice(0,3);
  const board=podium.length
    ? `<div class="rlist">${podium.map(podiumRow).join('')}</div>`
    : `<div class="empty" style="padding:22px">🏆<br>${t('Nothing on today\'s podium yet.')}<br>${t('Post a pour. The day\'s three most-loved coffees land here.')}</div>`;
  const people=discover.loaded&&!sugg.length
    ? `<div class="empty" style="padding:20px">👋<br>${t('Nobody else to follow yet. You are early.')}</div>`
    : sugg.length
      ? `<div class="hscroll">${sugg.map(u=>`<div class="ucard"><div data-action="open-user" data-id="${u.id}" style="cursor:pointer">${avatar(u.id,'big')}<b>${esc(u.name)}</b><span>${u.city?esc(u.city):u.levelName}</span></div>
        ${followBtn(u.id,'sm block')}</div>`).join('')}</div>`
      : '';
  return `<div class="pad">
    <div class="search"><span style="color:var(--muted)">${icon('search',20)}</span><input id="search-input" placeholder="${t('Search people, beans, cafés, pours…')}" value="${esc(ui.searchQ)}" autocomplete="off" aria-label="${t('Search')}"></div>
    <div id="explore-results">${ui.searchQ?searchHTML(ui.searchQ):''}</div>
    <div id="explore-normal" style="${ui.searchQ?'display:none':''}">
    ${people?`<div class="section-h"><h2>${t('People to follow')}</h2></div>${people}`:''}
    <div class="section-h"><h2>${t('This week\'s challenges')}</h2>${CHALLENGES.length?`<a data-action="open-challenges">${t('All three')}</a>`:''}</div>
    ${challengeBlock()}
    <div class="section-h"><h2>${t('Today\'s podium')}</h2></div>
    ${board}
    <div style="font-size:12px;color:var(--muted);text-align:center;margin:8px 2px 0">
      ${t('The three most-loved pours of the day, counting likes and comments alike. The board clears at midnight, so everyone starts level tomorrow.')}</div>
    <div class="section-h"><h2>${t('Trending patterns')}</h2></div>
    <div class="chips" style="margin-bottom:8px">${['rosetta','swan','tulip','heart','abstract','wave','phoenix'].map(x=>`<span class="chip tag" data-action="open-tag" data-id="${x}">#${x}</span>`).join('')}</div>
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
      ? t('No challenges are running right now.')+'<br>'+t('Three new ones land every Monday.')
      : t('Loading this week’s challenges…')}</div>`;
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
const CAFE_SUBJECT=()=>t('Crema — café pilot');
const CAFE_BODY=()=>t(`Hi Magnus,

I would like to put my café on Crema.

Café:
City:
Website / Instagram:
What we pour:

What I am most interested in:

Thanks!`);
const cafeMailto=()=>`mailto:${CAFE_MAIL}?subject=${encodeURIComponent(CAFE_SUBJECT())}&body=${encodeURIComponent(CAFE_BODY())}`;

export function renderCafes(){
  const perks=[
    ['📍',t('Your café, on the map'),t('A page with the beans you pour and the machine you pull them on.')],
    ['☕',t('Every pour tagged to you'),t('Someone photographs their flat white at your bar and your name is on it.')],
    ['❤️',t('Regulars you can actually see'),t('People follow your café and see what gets poured there.')],
    ['🎁',t('An offer worth showing'),t('Put something behind a posted pour: a discount, a filter on the house.')]
  ];
  return `<div class="pad">
    <div class="cafe-soon">
      <div class="cs-badge">${t('Opening city by city')}</div>
      <h3>${t('The best coffee near you, from the people drinking it')}</h3>
      <p>${t('Crema is people logging what they pour. Cafés are the other half of that, and they are being switched on one city at a time.')}</p>
    </div>

    <div class="cafe-pitch">
      <div class="cp-top"><span>☕</span><div><b>${t('Own a café?')}</b><i>${t('Get in before your street does.')}</i></div></div>
      <p class="cp-lead">${t('We are opening Crema to a small first group of cafés. Pilot places are handled in the order they arrive, one city at a time, and the cafés in that first group decide with their feedback what gets built next.')}</p>
      <div class="cp-perks">${perks.map(p=>`<div><span>${p[0]}</span><div><b>${p[1]}</b><i>${p[2]}</i></div></div>`).join('')}</div>
      <a class="btn block" href="${cafeMailto()}" data-action="cafe-lead">✉️ ${t('Ask for a pilot place')}</a>
      <div class="cp-mail" data-action="copy-cafe-mail">${t('or write to')} <b>${CAFE_MAIL}</b> · ${t('tap to copy')}</div>
      <p class="cp-fine">${t('Tell us your café and your city, and we will come back to you when your city opens. It costs nothing during the pilot.')}</p>
    </div>

    <div class="cafe-nudge">
      <b>${t('Not an owner?')}</b> ${t('Tell your favourite café about Crema. The ones people ask for get opened first.')}
      <button class="btn ghost sm" data-action="share-crema">${t('Share Crema')}</button>
    </div>
  </div>`;
}

/* ----- profile ----- */
/* The language switch. It lives at the top of the profile rather than
   three taps deep in Settings because it is the one setting somebody
   needs *before* they can read the settings sheet: a German speaker who
   opens Crema in English has to find this without reading English to do
   it, so it is two visible words on the screen the "You" tab lands on. */
function langToggle(){
  return `<div class="langsw" role="group" aria-label="${t('Language')}">
    ${LANGS.map(([code,label])=>`<button class="${lang===code?'on':''}" data-action="set-lang" data-l="${code}" lang="${code}">${label}</button>`).join('')}
  </div>`;
}

/* The way into the week card. Only appears once there is a week worth
   looking at — a recap of one pour on one day is a worse advert for the
   feature than no recap at all, and it is the one surface where Premium
   is being sold rather than used, so it has to be at its best.

   A locked account still gets the row, with the real count in it. That
   number is theirs and it is the argument: "you poured nine coffees this
   week" is a more honest reason to want the card than any adjective. */
function recapTeaser(){
  const r=weekRecap();
  if(!r||r.pours<3) return '';
  const prem=state.me.premium;
  return `<div class="recap-row" data-action="${prem?'open-recap':'open-premium'}"${prem?'':` data-f="${t('Your week in coffee')}"`}>
    <div class="rr-i">${prem?'📅':'🔒'}</div>
    <div class="rr-t"><b>${t('Your week in coffee')}</b>
      <span>${tn(r.pours,'{n} pour on {d} of 7 days — your week, as a card you can post','{n} pours on {d} of 7 days — your week, as a card you can post',{d:r.daysWithCoffee})}</span></div>
    <div class="rr-go">${prem?t('Open'):t('Premium')}</div></div>`;
}

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
    ? (hasPours?`<div class="grid">${mine.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`:`<div class="empty"><div class="big">☕</div>${t('No pours yet.')}<br>${t('Tap ＋ to log your first coffee.')}</div>`)
    : ui.profTab==='saved'
    ? (savedPosts.length?`<div class="grid">${savedPosts.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`
       : saved.loading&&!saved.loaded ? `<div class="empty">${t('Loading your collection…')}</div>`
       : `<div class="empty"><div class="big">🔖</div>${t('Nothing saved yet.')}<br>${t('Tap the bookmark on any post.')}</div>`)
    : ui.profTab==='badges' ? renderBadges() : renderStats();
  const bioHTML = state.me.bio ? esc(state.me.bio) : `<span style="color:var(--muted);cursor:pointer" data-action="open-settings">＋ ${t('Add a bio in Settings')}</span>`;
  const journeyHTML = `<div class="journey"><h3>${t('Recent activity')}</h3><p class="sub">${t('Your last few weeks of coffee.')}</p>
      <div class="jstats">
        <div><b>${ACT.reduce((a,b)=>a+b,0)}</b><span>${t('last 3 weeks')}</span></div>
        <div><b>${days}&nbsp;🔥</b><span>${t('day streak')}</span></div>
        <div><b>${new Set(mine.filter(p=>p.pattern).map(p=>p.pattern)).size}</b><span>${t('art styles')}</span></div></div>
      <div class="actbars">${ACT.map((c,i)=>{const d=new Date(Date.now()-(ACT.length-1-i)*864e5).toLocaleDateString(locale(),{weekday:'short',day:'numeric',month:'short'});return `<div class="ab${i===ACT.length-1?' today':''}" data-d="${d}" data-c="${c}"><i style="height:${c===0?8:c===1?52:100}%"></i></div>`;}).join('')}<div class="bartip" id="bartip" hidden></div></div>
      <div class="acthint"><span>${t('3 weeks ago')}</span><span>${t('today')}</span></div>
      <div class="recent">${recent.map(p=>`<div class="rp" data-action="open-post" data-id="${p.id}"><div class="rpimg">${art(imageUrl(p.img,'thumb'),p.pattern||'none',p.quality==null?0.9:p.quality,seedOf(p.id),p.drink)}</div><div class="rpd">${agoLabel(p.createdAt,p.ago)}</div><div class="rpt">${esc(p.drink||t('Coffee'))}</div></div>`).join('')}</div></div>`;
  const startedHTML = `<div class="journey"><h3>${t('Your journey starts here')}</h3><p class="sub" style="margin-bottom:12px">${t('Every pour earns points and builds your streak, and enough of them move you up a level.')}</p>
      <div style="padding:0 12px 14px"><button class="btn block" data-action="open-create">${icon('bolt',18)} ${t('Log your first coffee')}</button></div></div>`;
  /* The gear twin of the bean strip. Only once there is something to
     show: someone who has never named a machine has nothing to look at
     here, and an empty card teaching them that would be the app talking
     about itself. */
  const gear=machinePassport();
  const gearHTML = gear.length?`<div class="section-h" style="margin:18px 0 8px"><h2>${t('Machine passport')}</h2><a data-action="open-gearpass">${t('See all')}</a></div>
    <div class="passport"><div class="ph"><div class="lft"><img src="${S.esp}" alt="${t('espresso machine')}"><b>${tn(gear.length,'{n} brewer','{n} brewers')}</b></div><span data-action="open-gearpass" style="cursor:pointer">${t('tap for details')}</span></div>
      <div class="beans">${gear.map(m=>`<div class="bean" data-action="open-machine" data-id="${esc(m.name)}"><span class="fl">${icon('mach',14)}</span>${esc(m.name)}</div>`).join('')}</div></div>`:'';
  const passportHTML = beans.length?`<div class="section-h" style="margin-bottom:8px"><h2>${t('Bean passport')}</h2><a data-action="open-passport">${t('See all')}</a></div>
    <div class="passport"><div class="ph"><div class="lft"><img src="${S.beans}" alt="${t('coffee beans')}"><b>${tn(beans.length,'{n} bean','{n} beans')}</b></div><span data-action="open-passport" style="cursor:pointer">${origins.length?`${tn(origins.length,'{n} origin','{n} origins')} · `:''}${t('tap for details')}</span></div>
      <div class="beans">${beans.map(n=>{const cat=beanCatalog(n);return `<div class="bean" data-action="open-bean" data-id="${esc(cat?cat.n:n)}"><span class="fl">${(cat&&flag[cat.c])||'🫘'}</span>${esc(cat?cat.n:n)}</div>`;}).join('')}</div></div>`:'';
  return `<div class="pad">
    ${langToggle()}
    <div class="prof-top"><div class="prof-av${state.me.premium?' prem':''}" style="background:${u.color};color:#fff;font-family:var(--serif);font-weight:600;font-size:30px;cursor:pointer" data-action="open-settings" title="${t('Change your photo in Settings')}">${initials(u.name)}${u.avatar?`<img src="${esc(imageUrl(u.avatar,'thumb'))}" alt="" onerror="this.remove()">`:''}</div>
      <div class="prof-id"><b>${esc(u.name)}</b><div class="h">${u.handle}${u.city?` · ${esc(u.city)}`:''}</div>
        <span class="lvl" data-action="open-scoring">${icon('bolt',13)} ${t('Level')} ${lvl[0]} · ${t(lvl[1])}</span>${state.me.premium?`<span class="lvlchip" style="margin-left:6px;background:var(--gold);color:var(--on-crema);border-color:transparent">PREMIUM</span>`:''}</div></div>
    <div class="bio">${bioHTML}</div>
    <div class="lvlbar" data-action="open-scoring" style="cursor:pointer">
      <div class="top"><b>${t('{n} points',{n:fmt(points)})}</b><span>${next?t('{n} to {level}',{n:fmt(next[2]-points),level:t(next[1])}):t('Top level reached')}</span></div>
      <div class="track"><i style="width:${Math.round(levelProgress(points)*100)}%"></i></div></div>
    <div class="stats">
      <div><b>${pourCount}</b><span>${t('Pours')}</span></div>
      <div class="click" data-action="open-flist" data-id="followers"><b>${fmt(u.followerN)}</b><span>${t('Followers')}</span></div>
      <div class="click" data-action="open-flist" data-id="following"><b>${followingN}</b><span>${t('Following')}</span></div>
      <div><b>${days} 🔥</b><span>${t('Day streak')}</span></div></div>
    ${hasPours?journeyHTML:startedHTML}
    ${recapTeaser()}
    ${passportHTML}
    ${gearHTML}
    <div class="seg" style="margin-top:18px">
      <button class="${ui.profTab==='stats'?'on':''}" data-action="ptab" data-t="stats">${t('Stats')}</button>
      <button class="${ui.profTab==='pours'?'on':''}" data-action="ptab" data-t="pours">${t('Pours')} ${pourCount}</button>
      <button class="${ui.profTab==='saved'?'on':''}" data-action="ptab" data-t="saved">${t('Saved')}</button>
      <button class="${ui.profTab==='badges'?'on':''}" data-action="ptab" data-t="badges">${t('Badges')}</button></div>
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
      ${rest?`<span><i class="s3"></i>${t('Other')} ${pct(rest,total)}%</span>`:''}</div>`;
}
function statCard(title,body,note){
  return `<div class="stx-card"><h4>${title}</h4>${body}${note?`<p class="stx-note">${note}</p>`:''}</div>`;
}
const statRows=rows=>`<div class="stx-rows">${rows.map(r=>
  `<div><span>${esc(r[0])}</span><b>${esc(r[1])}</b>${r[2]?`<i>${esc(r[2])}</i>`:''}</div>`).join('')}</div>`;

/* ----- the long arc -----
   The profile above already draws 21 daily bars, and a second bar chart
   of the same days in the same shape is not worth paying for — so this
   one is deliberately a different question and a different drawing.
   Weekly totals over up to three months as a filled curve, and above it
   the only number that matters: which way it is going.

   Drawn stretched (preserveAspectRatio="none") so the curve fills
   whatever width the phone has; the stroke is pinned with
   vector-effect so the line doesn't smear along with it. */
function arcCard(s){
  const w=s.weeks;
  if(!w || w.length<3) return '';
  const n=w.length, max=Math.max(...w,1), H=34;
  const px=i=>(i/(n-1))*100, py=v=>H-(v/max)*(H-3)-1.5;
  const pts=w.map((v,i)=>`${px(i).toFixed(2)},${py(v).toFixed(2)}`).join(' ');
  const chart=`<svg class="stx-arc" viewBox="0 0 100 ${H}" preserveAspectRatio="none" aria-hidden="true">
      <polygon points="0,${H} ${pts} 100,${H}"/>
      <polyline points="${pts}" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="stx-axis"><span>${tn(n,'a week ago','{n} weeks ago')}</span><span>${t('this week')}</span></div>`;

  /* The headline. A percentage needs two whole months behind it, and a
     month that was empty has no percentage at all — "up ∞%" is not a
     fact about anyone's coffee. */
  const tr=s.trend;
  let head, dir='';
  if(tr && tr.pct!=null && Math.abs(tr.pct)>=5){
    dir=tr.pct>0?'up':'down';
    head=tr.pct>0
      ? t('You are pouring <b>{p}% more</b> than the month before.',{p:tr.pct})
      : t('You are pouring <b>{p}% less</b> than the month before.',{p:Math.abs(tr.pct)});
  }else if(tr && tr.pct!=null){
    dir='flat';
    head=t('About the same as the month before — <b>{a}</b> against <b>{b}</b>.',{a:tr.recent,b:tr.prev});
  }else if(tr){
    head=t('<b>{a}</b> this month, after a month with none logged.',{a:tr.recent});
  }else{
    head=t('Keep logging and the month-on-month comparison shows up here.');
  }
  const chip=dir?`<span class="stx-dir ${dir}">${dir==='up'?'↑':dir==='down'?'↓':'→'} ${tr.recent}/${tr.prev}</span>`:'';
  return `<div class="stx-card">
    <h4>${t('Where it is going')}${chip}</h4>
    <p class="stx-p" style="margin-bottom:12px">${head}</p>
    ${chart}
    <p class="stx-note">${t('Pours a week, {n} weeks back. The busiest was {m}.',{n,m:max})}</p>
  </div>`;
}

/* The teaser a free account gets instead. It shows the real headline —
   their drink, counted from their own pours — and stops there. An
   entirely blurred screen would be a wall; one true number is an offer,
   and it is the number that makes the rest of the tab worth wanting. */
function statsLocked(s){
  const top=s.drinks[0];
  return `<div class="stx">
    <div class="stx-hero">
      <span class="stx-k">${t('Your coffee')}</span>
      <b>${esc(top.name)}</b>
      <span class="stx-sub">${tn(s.pours,'{c} of {n} pour','{c} of {n} pours',{c:top.count})} · ${t('{p}% of everything you log',{p:pct(top.count,s.pours)})}</span>
      ${s.drinks.length>1?drinkMix(s.drinks,s.pours):''}
    </div>
    <div class="stx-lock" data-action="open-premium" data-f="${t('Your stats')}">
      <div class="stx-blur" aria-hidden="true">
        <div class="stx-tiles">
          <div><b>${oneDp(s.perDay)}</b><span>${t('coffees a day')}</span></div>
          <div><b>${s.pours}</b><span>${t('pours logged')}</span></div>
          <div><b>${s.daysLogged}</b><span>${tn(s.daysLogged,'day with coffee','days with coffee')}</span></div>
          <div><b>${s.best}</b><span>${t('best streak')}</span></div>
        </div>
        <div class="stx-card"><h4>${t('When you pour')}</h4>
          <div class="stx-hours">${s.hours.map((c,h)=>`<i class="${h===s.peakHour?'on':''}" style="height:${c?Math.max(9,Math.round(c/Math.max(1,Math.max(...s.hours))*100)):3}%"></i>`).join('')}</div></div>
      </div>
      <div class="stx-lockmsg">
        <span class="pn-lock">🔒</span>
        <b>${t('The rest of your numbers are Premium')}</b>
        <i>${t('Your rhythm, the hour you pour at, your machine and milk, your brew ratio, your week and your shelf.')}</i>
        <span class="pchip">${t('Free right now, with a code')}</span>
      </div>
    </div>
  </div>`;
}

export function renderStats(){
  const s=coffeeStats();
  if(!s) return `<div class="empty"><div class="big">📊</div>${t('No numbers yet.')}<br>${t('Log a few coffees and this fills up on its own.')}<br><br>
    <button class="btn sm" data-action="open-create">${t('Log a coffee')}</button></div>`;
  if(!state.me.premium) return statsLocked(s);
  const top=s.drinks[0];
  const out=[];

  /* The headline answers the question people actually ask of an app like
     this, and answers it by counting rather than by repeating the
     preference they set during onboarding. */
  out.push(`<div class="stx-hero">
    <span class="stx-k">${t('Your coffee')}</span>
    <b>${esc(top.name)}</b>
    <span class="stx-sub">${tn(s.pours,'{c} of {n} pour','{c} of {n} pours',{c:top.count})} · ${t('{p}% of everything you log',{p:pct(top.count,s.pours)})}</span>
    ${s.drinks.length>1?drinkMix(s.drinks,s.pours):''}
  </div>`);

  out.push(`<div class="stx-tiles">
    <div><b>${oneDp(s.perDay)}</b><span>${t('coffees a day')}</span></div>
    <div><b>${s.pours}</b><span>${t('pours logged')}</span></div>
    <div><b>${s.daysLogged}</b><span>${tn(s.daysLogged,'day with coffee','days with coffee')}</span></div>
    <div><b>${s.best}</b><span>${t('best streak')}</span></div>
  </div>`);

  /* Rounded to one decimal, which is the honest precision for a rate
     built out of a handful of days. The second line says what the
     average is actually over, because "1.4 a day" means something very
     different across nine days than across nine months. */
  const rhythm=[tn(s.span,'That is one day since your first pour, and about {w} a week.','That is {n} days since your first pour, and about {w} a week.',{w:oneDp(s.perWeek)})];
  if(s.busiest>1) rhythm.push(t('Your biggest day was {n} coffees.',{n:s.busiest}));
  /* The weekday split, as one sentence rather than a seven-bar chart —
     the chart said the same thing as the profile's own bars and looked
     like them, and the interesting part was always this line. Only
     worth saying once one weekday is genuinely ahead. */
  const wdMax=Math.max(...s.weekdays);
  if(wdMax>=2 && s.weekdays.filter(c=>c===wdMax).length===1){
    const d=new Date(2024,0,7+s.weekdays.indexOf(wdMax));
    rhythm.push(t('{d} is your biggest coffee day.',{d:d.toLocaleDateString(locale(),{weekday:'long'})}));
  }
  if(s.streak>0) rhythm.push(tn(s.streak,'You are one day into a streak right now.','You are {n} days into a streak right now.'));
  out.push(statCard(t('Your rhythm'),`<p class="stx-p">${rhythm.join(' ')}</p>`));

  /* The hour histogram only claims the pours that carry a real
     timestamp, and says so when that isn't all of them. The headline
     time is peakMin — usualMinute() from store.js, the same clustering
     the week card's "coffee o'clock" tile runs — rather than whichever
     hourly bucket happens to have the most pours in it; the bars stay
     hourly (that's the shape a 24-slot histogram can draw) and peakHour
     just says which one to light up. */
  if(s.timed>=3&&s.peakMin!=null){
    const max=Math.max(...s.hours);
    const bars=s.hours.map((c,h)=>`<i class="${h===s.peakHour?'on':''}" style="height:${c?Math.max(9,Math.round(c/max*100)):3}%" title="${hourLabel(h)} · ${c}"></i>`).join('');
    out.push(statCard(t('When you pour'),
      `<div class="stx-hours">${bars}</div>
       <div class="stx-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>`,
      t('Most of your coffee happens around <b>{h}</b>.',{h:hhmm(s.peakMin)})
        +(s.timed<s.pours?' '+t('Counted from the {n} pours that carry a recorded time.',{n:s.timed}):'')));
  }

  out.push(arcCard(s));

  const setup=[];
  if(s.beans[0])    setup.push([t('Most-poured coffee'),s.beans[0].name,`${s.beans[0].count}×`]);
  if(s.roasters[0]) setup.push([t('Roaster you return to'),s.roasters[0].name,`${s.roasters[0].count}×`]);
  if(s.machines[0]) setup.push([t('Machine'),s.machines[0].name,`${s.machines[0].count}×`]);
  if(s.milks[0])    setup.push([t('Milk'),s.milks[0].name,`${pct(s.milks[0].count,s.pours)}%`]);
  /* The pattern's own count, not every art pour — a row reading
     "Rosetta · 7 pours" next to a total that also happens to be 7 is a
     number that means one thing and looks like another. */
  if(s.patterns[0]) setup.push([t('Latte art'),cap(s.patterns[0].name),`${s.patterns[0].count}×`]);
  if(s.cafePours)   setup.push([t('Poured at a café'),`${pct(s.cafePours,s.pours)}%`,`${s.cafePours}×`]);
  if(setup.length){
    const notes=[];
    if(s.beans.length>1) notes.push(t('{n} different coffees so far.',{n:s.beans.length}));
    if(s.artPours) notes.push(t('You poured art on {p}% of your coffees.',{p:pct(s.artPours,s.pours)}));
    out.push(statCard(t('What you brew with'),statRows(setup),notes.join(' ')));
  }

  /* Only for people who weigh things — which is exactly the group this
     section is for, and no use at all to anyone else. */
  if(s.brew) out.push(statCard(t('Your espresso'),
    `<div class="stx-tiles sm">
      <div><b>1:${oneDp(s.brew.ratio)}</b><span>${t('average ratio')}</span></div>
      <div><b>${oneDp(s.brew.dose)}g</b><span>${t('dose in')}</span></div>
      <div><b>${oneDp(s.brew.out)}g</b><span>${t('yield out')}</span></div>
      ${s.brew.secs?`<div><b>${Math.round(s.brew.secs)}s</b><span>${t('shot time')}</span></div>`:''}
    </div>`,
    tn(s.brew.n,'From the one pour where you logged both dose and yield.','From the {n} pours where you logged both dose and yield.')));
  else out.push(`<div class="stx-hint" data-action="open-create">⚖️ ${t('Log a dose and a yield on your next pour, and your brew ratio shows up here.')}</div>`);

  return `<div class="stx">${out.join('')}</div>`;
}
export function renderBadges(){
  const b=computeBadges(), earned=b.filter(x=>x.e).length;
  return `<div style="font-size:12.5px;color:var(--muted);font-weight:600;margin:6px 2px 2px">${t('{a} of {b} earned',{a:earned,b:b.length})}</div>
  <div class="bgrid">${b.map(x=>`<div class="badge ${x.e?'':'locked'}"><div class="bic">${x.i}</div>
    <div><b>${t(x.n)}</b><span>${x.e?t(x.d):(x.p?t(x.d)+' · '+x.p:t(x.d))}</span></div></div>`).join('')}</div>`;
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
  const tab=(r,ic,icF,label)=>`<button class="tab ${ui.route===r?'on':''}" data-action="nav" data-r="${r}"><span class="ic">${icon(ui.route===r&&icF?icF:ic,25)}</span><span>${label}</span></button>`;
  bar.innerHTML=tab('home','home','homeF',t('Home'))+tab('explore','compass','compass',t('Explore'))+`<button class="tab plus" data-action="open-create" aria-label="${t('New coffee')}"><span class="fab">${icon('plus',26)}</span></button>`+tab('cafes','cafe','cafe',t('Cafés'))+tab('profile','user','userF',t('You'));
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
