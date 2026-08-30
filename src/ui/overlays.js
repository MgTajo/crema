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
import { LEVELS, MILK_LIST, DRINK_ART, HAS_MILK, ADD_DRINK, BEANS, POPULAR_MACHINES, popularBeans,
         beanCatalog, beanInfo, roastStep, machineInfo, MACHINE_KINDS, ROAST_MAX,
         machineIndex, norm, searchMachines, searchBeans, searchOwn, machineKnown, beanKnown,
         flag } from '../data/catalog.js';
import { USERS, CAFES, CHALLENGES, userOf } from '../data/world.js';
import { state, ui, session, social, findPost, allPosts, myPosts, freshCreate, challenges,
         beanPassport, machinePassport, canEdit, streakInfo, myMachines, myCoffees, isPinned,
         gearNote, weekRecap, RECAP_PICKS, admin } from '../store/store.js';
import { REST_AFTER } from '../domain/streak.js';
import { PREMIUM_MAIL, PHOTOS_PREMIUM } from '../domain/premium.js';
import { statementFor } from '../data/moderation.js';
import { notifBody } from '../data/notifications.js';
import { objectPosition } from '../domain/framing.js';
import { recapSVG, shotPhotos } from './recap.js';
import { pushSupported, iosNeedsInstall, pushPermission, standalone } from '../data/push.js';
import { art, artSet, cupSVG } from '../domain/art.js';
import { levelOf, nextLevel, levelProgress, POINT_RULES } from '../domain/scoring.js';
import { t, tn } from '../i18n.js';
import { avatar, cafeThumb, mentionify, recipeRows, recipePanel, commentRow, machinePicker, beanPicker, drinkOptions, selectOptions, premiumNote, gcell, commentCount, likeButton, reactionBar, editedMark, privateMark, hiddenMark, followMini, followBtn, followState } from './components.js';
import { icon, logoMark } from './icons.js';
import { agoTag } from './timeago.js';
import { keepInput } from './keepinput.js';
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
  /* Is this the same sheet painting again, or a different one arriving?
     It decides whether the entrance animation is allowed to run, and
     that distinction is the whole fix for the flash people saw when
     they opened someone's profile: the sheet is pushed, painted, and
     then painted a SECOND time when their profile and pours land. A
     fresh .sheet element restarts `slideup`, which begins at opacity 0
     — so the sheet that was already on screen faded out to the pale
     backdrop and slid back in, a blink that reads as the page breaking.

     Every repaint-in-place has it: the upload progress on the create
     sheet, the follower lists, the moderation tabs. So the rule lives
     here rather than at any one call site — a sheet animates when it
     arrives, and never again while it stays. */
  const again=painted===key;
  painted=key;
  ov.className='overlay show'+(again?' again':'');
  const T=top.type;
  /* `again` does a second job here. It already decides whether the
     entrance animation may run; it is also exactly the condition under
     which carrying typing across the repaint is safe — the same sheet
     arriving again, rather than a different one whose #c-caption or
     #sp-code means something else entirely. See ui/keepinput.js, Q17. */
  keepInput(ov, again, () => { ov.innerHTML =
    T==='post'?overlayPost(top.id):
    T==='cafe'?overlayCafe(top.id):
    T==='bean'?overlayBean(top.id):
    T==='machine'?overlayMachine(top.id):
    T==='gearedit'?overlayGearEdit(top):
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
    T==='gearpass'?overlayGearPassport():
    T==='settings'?overlaySettings():
    T==='admin'?overlayAdmin():
    T==='premium'?overlayPremium(top.feature):
    T==='recap'?overlayRecap():
    T==='onboard'?overlayOnboard():
    T==='password'?overlayPassword():
    T==='delaccount'?overlayDeleteAccount():
    T==='signin'?overlaySignin(top.why):
    T==='ios'?overlayIosInstall():
    T==='whatsnew'?overlayWhatsNew():
    T==='picker'?overlayPicker():
    T==='create'?overlayCreate():''; });
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
  premium:  [t('Sign in for Premium'), t('Premium lives on your account, so it needs one. Creating it is free, and so is Premium right now.')],
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

/* ---------- add Crema to the Home Screen (iOS) ----------
   A large part of Crema's audience reads it in a Safari tab on an
   iPhone, and that tab is the worst version of the app: no icon to come
   back to, browser chrome eating the top of every screen, and — because
   Apple ships no Web Push outside an installed PWA — not one
   notification, ever. The fix is two taps and nobody finds it on their
   own, because "Add to Home Screen" is inside a share menu that most
   people only ever use to send a link to somebody.

   So Crema asks, and it says what it gets you rather than what it is:
   an icon, a full screen, and the reminders that are otherwise
   impossible on this device. Shown only where the steps below are
   literally true — Safari, on iOS, in a tab (canInstallOnIOS) — and
   never once the app is running from the Home Screen, which is the
   whole point of asking.

   Raised once per app open, from app.js, and only when nothing else
   already has the screen. */
function overlayIosInstall(){
  const step=(n,txt)=>`<div class="iosstep"><i>${n}</i><span>${txt}</span></div>`;
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="${t('Add Crema to your Home Screen')}">
    <div class="grab"></div>
    <div class="ov-body" style="padding:8px 20px 22px;text-align:center">
      ${logoMark(46)}
      <h2 style="font-family:var(--serif);font-weight:400;font-size:24px;letter-spacing:-.02em;margin:12px 0 6px">${t('Put Crema on your Home Screen')}</h2>
      <p style="color:var(--ink2);font-size:13.5px;line-height:1.55;margin:0 auto 18px;max-width:300px">${t('It opens full screen, with its own icon — and on an iPhone it is the only way Crema can remind you about your streak.')}</p>
      <div class="iossteps">
        ${step(1,t('Tap <b>Share</b> at the bottom of Safari')+' <span class="iosicon">'+icon('share',15)+'</span>')}
        ${step(2,t('Scroll down and tap <b>Add to Home Screen</b>'))}
        ${step(3,t('Tap <b>Add</b>. That is it.'))}
      </div>
      <button class="btn ghost block" style="margin-top:16px" data-action="close-ov">${t('Maybe later')}</button>
    </div></div>`;
}

/* ---------- what changed while you were away ----------
   Raised once per browser, ever, from app.js — see core/announce.js for
   where that "once" is kept, and why the correction below is a NEW
   announcement id rather than an edit to the old card's copy.

   It exists because a reward nobody knows about is not a reward. Points
   in Crema are quiet by design: they arrive on a profile row and nothing
   announces them, which is right for the ones you earn by being
   *noticed* — a like, a comment, a podium finish — and wrong for one you
   have to change your behaviour to collect.

   And this one is a race, which raises the bar again: nobody enters a
   competition they have not been told is running. So the card says the
   three things you need in order to play — that there is exactly one a
   day, that being first is what wins it, and what it pays. It does not
   say "new!", it does not list a changelog, and it has exactly one
   button, which closes it.

   The second line is the other half of the same release, and it is one
   line rather than a section because a card that announces two things
   announces neither.

   Both the button and the backdrop go through `dismiss-whatsnew` rather
   than `close-ov`: closing it IS the acknowledgement, and a card that
   came back tomorrow because somebody tapped beside it instead of on it
   would be the one thing this is not allowed to be. */
function overlayWhatsNew(){
  const bonus = (POINT_RULES.find(r=>/first coffee in crema/i.test(r[0]))||['','+20'])[1];
  return `<div class="ov-back" data-action="dismiss-whatsnew"></div><div class="sheet bottom" role="dialog" aria-label="${t('First coffee in Crema wins the morning')}">
    <div class="grab"></div>
    <div class="ov-body" style="padding:10px 20px 22px;text-align:center">
      <div style="font-size:42px;line-height:1">🥇</div>
      <h2 style="font-family:var(--serif);font-weight:400;font-size:24px;letter-spacing:-.02em;margin:10px 0 6px">${t('First coffee in Crema wins the morning')}</h2>
      <p style="color:var(--ink2);font-size:13.5px;line-height:1.55;margin:0 auto 16px;max-width:300px">${t('Every day, the very first coffee logged in the whole app pays {n} points towards your level. One a day, for one person. Log yours early enough and it is yours.',{n:bonus})}</p>
      <p style="color:var(--muted);font-size:12.5px;line-height:1.5;margin:0 auto 18px;max-width:300px">${t('And you will hear about it whenever someone you follow logs a coffee. You can turn that off in Settings.')}</p>
      <button class="btn block" data-action="dismiss-whatsnew">${t('Got it')}</button>
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
      <div class="media" data-action="none" data-media="${p.id}">${artSet((p.imgs&&p.imgs.length?p.imgs:[p.img]).map(k=>imageUrl(k,'hero')),p.pattern,p.quality,seedOf(p.id),p.drink)}<div class="heartpop" data-hp="${p.id}">${icon('heartF',90)}</div></div>
      <div class="p-head">
        <div class="idwrap" data-action="open-user" data-id="${p.user}">${avatar(p.user)}
          <div class="who"><b>${esc(u.name)} <span class="lvlchip">Lv${u.level}</span></b><span>${esc(u.handle)}${p.cafe?` · ${t('at')} ${esc(p.cafe)}`:''} · ${agoTag(p.createdAt,p.ago)}${editedMark(p)}${privateMark(p)}${hiddenMark(p)}</span></div></div>
        ${p.user==='me'?'':followMini(p.user)}
        <button class="kebab" data-action="open-menu" data-id="${p.id}" aria-label="${t('More options')}">⋯</button></div>
      <div class="p-body"><div class="cap"><b>${esc(u.name)}</b> ${mentionify(p.caption)}</div>
        <div class="chips"><span class="chip drinkchip">${esc(t(p.drink||'Coffee'))}</span>${p.art&&p.pattern?`<span class="chip tag" data-action="open-tag" data-id="${p.pattern}">#${p.pattern}</span>`:''}${r&&r.milk?`<span class="chip">🥛 ${esc(t(r.milk))}</span>`:''}${p.cafe?`<span class="chip">📍 ${esc(p.cafe)}</span>`:''}</div></div>
      ${reactionBar(p)}
      ${rows.length?`<div class="scoreblk" style="padding-top:0"><div class="recipe-panel open" style="margin:0">${recipePanel(r)}
        <div style="padding:9px 12px;background:var(--surface)"><button class="btn ghost sm" data-action="brew" data-id="${p.id}">☕ ${t('Brew this recipe')}</button></div></div></div>`:''}
      <div id="cmt-head" style="padding:14px 14px 4px;font-weight:700;font-family:var(--serif);font-size:16px">${commentCount(p)} ${t('comments')}</div>
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

/* ---------- the bean and machine sheets ----------
   Every coffee and every brewer in Crema now has a page, and the page
   answers the same shape of question for both: what is this, what does
   it do, and what have *I* done with it.

   The facts come from the catalogue and are shown as the catalogue's,
   never restated as ours: tasting notes are what the roaster claims,
   and a machine's row says what kind of machine it is rather than
   pretending to know one model's boiler. Anything the catalogue is
   silent about is simply absent — an empty row is a better answer than
   a confident guess.

   A coffee or a machine somebody typed in themselves has no catalogue
   row at all, so the page is whatever they wrote down (Premium, and
   theirs alone — see gearNote in store/store.js) and an invitation to
   write it if they haven't. That is the whole of the Premium line
   here: everyone can log any coffee and read every page; Premium is
   the one that lets you fill in the blanks on your own bag. */

/* Rows the detail sheets share, so a bean page and a machine page can
   never drift into two different-looking things. */
const detailRows=rows=>{
  const live=rows.filter(r=>r[1]&&(''+r[1]).trim());
  return live.length?`<div class="recipe-panel open" style="margin:0"><div class="recipe-grid">${
    live.map(r=>`<div><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('')}</div></div>`:'';
};
/* Roast said as a position rather than only as a word. Five steps
   because that is how many the catalogue's `roast` column has — this
   draws the value, it does not invent a finer one. */
const roastScale=step=>!step?'':`<div class="roastbar" aria-hidden="true">${
  Array.from({length:ROAST_MAX},(_,i)=>`<i class="${i<step?'on':''}"></i>`).join('')}</div>`;
/* The notes are the roaster's claim and stay the roaster's claim; t()
   only says it in the reader's language. A note somebody typed onto
   their own bag isn't in the bundle and falls back to itself. */
const noteChips=list=>(list||[]).filter(Boolean).length
  ? `<div class="chips">${list.filter(Boolean).map(x=>`<span class="chip tag">${esc(t(x))}</span>`).join('')}</div>` : '';

/* Your own pours with this thing, and — for a coffee — what you brewed
   it on. Both are counted off your own rows, so they are the only
   numbers on either page that are measured rather than catalogued. */
function gearPours(kind,name){
  const n=norm(name);
  return myPosts().filter(p=>{
    const v=p.recipe&&(kind==='machine'?p.recipe.machine:p.recipe.bean);
    return v&&norm(v)===n;
  });
}
function alsoUsed(posts,key){
  const m=new Map();
  posts.forEach(p=>{ const v=p.recipe&&p.recipe[key]; if(v) m.set(v,(m.get(v)||0)+1); });
  return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]);
}

/* The block a Premium user writes and everyone else is offered. `own`
   is true for something they added themselves, which is the only case
   where the full card is theirs to fill — a catalogue coffee takes a
   private note and keeps its roaster's facts. */
function gearOwnBlock(kind,name,own){
  const g=gearNote(kind,name);
  const has=g&&Object.keys(g).some(k=>(''+(g[k]||'')).trim());
  const what=own?(kind==='machine'?t('Details for your own machine'):t('Details for your own coffee'))
                :t('Your private note');
  if(!state.me.premium) return has?'':premiumNote(what);
  return `<button class="btn ghost block" style="margin-top:12px" data-action="gear-edit" data-kind="${kind}" data-v="${esc(name)}">
    ${has?t('Edit these details'):(own?t('＋ Add details'):t('＋ Add a private note'))}</button>`;
}

function overlayBean(name){
  const b=beanInfo(name);
  const own=!b;
  const g=gearNote('bean',name)||{};
  const posts=gearPours('bean',name);
  const machines=alsoUsed(posts,'machine');
  const roaster=b?b.roaster:(g.roaster||'');
  const origin=b?b.origin:(g.origin||'');
  const roast=b?b.roast:(g.roast||'');
  const notes=b?b.notes:(g.notes||'').split(',').map(s=>s.trim()).filter(Boolean);
  const step=b?b.step:roastStep(roast);
  const country=b?b.c:'';
  /* Four facts, so the two-column grid comes out square. Blend vs single
     origin is deliberately NOT a fifth: it is a reading of the origin
     line sitting directly above it, and a row that repeats its
     neighbour in fewer words is noise. */
  const rows=[
    [t('Roaster'),roaster],
    [t('Origin'),origin?t(origin):''],
    [t('Roast level'),roast?t(roast):''],
    b?[t('Availability'),b.loc==='INT'?t('Sold in Germany'):t('Roasted in Germany')]:null
  ].filter(Boolean);
  const heroSub=[roaster,origin&&t(origin)].filter(Boolean).join(' · ')||(own?t('Your own coffee'):'');
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${esc(name)}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="${t('Back')}">${icon('back',20)}</button><b>${esc(name)}</b></div>
    <div class="ov-body">
      <div class="bean-hero"><img src="${S.beans}" alt=""><div class="bean-hero-t"><span class="fl">${flag[country]||'🫘'}</span>
        <div><b>${esc(name)}</b><span>${esc(heroSub)}</span></div></div></div>
      <div style="padding:16px">
        ${notes.length?`<div class="section-h" style="margin:2px 0 10px"><h2>${t('Tasting notes')}</h2>
          ${b?`<span style="font-size:11.5px;color:var(--muted)">${t('as the roaster describes it')}</span>`:''}</div>
          ${noteChips(notes)}`:''}
        ${rows.some(r=>r[1])?`<div class="section-h" style="margin:18px 0 10px"><h2>${t('Details')}</h2></div>
          ${detailRows(rows)}${roastScale(step)}`
        :`<div class="empty" style="padding:18px 0">${own
            ? t('Nothing written down about this coffee yet — it is yours, so nobody else can fill it in.')
            : t('The catalogue has no details for this coffee yet.')}</div>`}
        ${g.note?`<div class="ownnote"><b>${t('Your note')}</b><p>${esc(g.note)}</p></div>`:''}
        ${gearOwnBlock('bean',name,own)}
        ${machines.length?`<div class="section-h" style="margin:18px 0 10px"><h2>${t('You brew it on')}</h2></div>
          <div class="chips">${machines.map(m=>`<span class="chip tag" data-action="open-machine" data-id="${esc(m)}">${icon('mach',12)} ${esc(m)}</span>`).join('')}</div>`:''}
        <div class="section-h" style="margin:18px 0 10px"><h2>${t('Your pours with this coffee')}</h2></div>
        ${posts.length?`<div class="grid">${posts.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`
          :`<div class="empty" style="padding:22px 0">${t('No pours logged with this bean yet.')}</div>`}
        <div style="height:8px"></div>
      </div></div></div>`;
}

function overlayMachine(name){
  const i=machineInfo(name);
  const own=!i;
  const g=gearNote('machine',name)||{};
  const ownKind=g.kind&&MACHINE_KINDS[g.kind];
  const posts=gearPours('machine',name);
  const beans=alsoUsed(posts,'bean');
  const kind=i||ownKind||null;
  /* Four facts, so the two-column grid comes out square. The brand and
     where it is from are one row rather than two: nobody wants one
     without the other, and split across a grid they read as unrelated. */
  const rows=[
    [t('Type'),kind?t(kind.label):''],
    [t('How it brews'),kind?t(kind.method):''],
    [t('Milk'),kind?t(kind.milk):''],
    [t('Brand'),i?i.brand+' · '+t(i.country):'']
  ];
  const heroSub=kind?t(kind.label):(own?t('Your own machine'):'');
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${esc(name)}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="${t('Back')}">${icon('back',20)}</button><b>${esc(name)}</b></div>
    <div class="ov-body">
      <div class="bean-hero"><img src="${S.esp}" alt=""><div class="bean-hero-t"><span class="fl">${icon('mach',30)}</span>
        <div><b>${esc(name)}</b><span>${esc(heroSub)}</span></div></div></div>
      <div style="padding:16px">
        ${rows.some(r=>r[1])?`<div class="section-h" style="margin:2px 0 10px"><h2>${t('Details')}</h2></div>${detailRows(rows)}
          ${i?`<div style="font-size:11.5px;color:var(--muted);line-height:1.5;margin:8px 2px 0">${t('True of every {brand} of this kind. Crema does not hold specs for individual models.',{brand:esc(i.brand)})}</div>`:''}`
        :`<div class="empty" style="padding:18px 0">${own
            ? t('Nothing written down about this brewer yet — it is yours, so nobody else can fill it in.')
            : t('The catalogue has no details for this machine yet.')}</div>`}
        ${g.note?`<div class="ownnote"><b>${t('Your note')}</b><p>${esc(g.note)}</p></div>`:''}
        ${gearOwnBlock('machine',name,own)}
        ${beans.length?`<div class="section-h" style="margin:18px 0 10px"><h2>${t('You brew with')}</h2></div>
          <div class="chips">${beans.map(b=>`<span class="chip tag" data-action="open-bean" data-id="${esc(b)}">${icon('bean',12)} ${esc(b)}</span>`).join('')}</div>`:''}
        <div class="section-h" style="margin:18px 0 10px"><h2>${t('Your pours on this machine')}</h2></div>
        ${posts.length?`<div class="grid">${posts.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`
          :`<div class="empty" style="padding:22px 0">${t('No pours logged on this machine yet.')}</div>`}
        <div style="height:8px"></div>
      </div></div></div>`;
}

/* The editor behind both. One sheet, two shapes: your own entry gets
   the fields a catalogue row would have had, a catalogue entry gets the
   note and nothing else — its roaster's facts are not yours to rewrite,
   and a private edit of a shared name would be a fact that disagrees
   with everyone else's copy of the same bag. */
function overlayGearEdit(o){
  const kind=o.kind, name=o.id||'', isM=kind==='machine';
  const g=gearNote(kind,name)||{};
  const own=isM?!machineInfo(name):!beanInfo(name);
  const fields=!own?'' : isM
    ? `<div class="field sel"><label>${t('Type')}</label><select id="ge-kind">
        <option value=""${g.kind?'':' selected'}>${t('Not sure')}</option>
        ${Object.keys(MACHINE_KINDS).map(k=>`<option value="${k}"${g.kind===k?' selected':''}>${t(MACHINE_KINDS[k].label)}</option>`).join('')}
      </select></div>`
    : `<div class="field"><label>${t('Roaster')}</label><input id="ge-roaster" placeholder="${t('Who roasted it')}" value="${esc(g.roaster||'')}"></div>
       <div class="field"><label>${t('Origin')}</label><input id="ge-origin" placeholder="${t('e.g. Ethiopia · Sidama, or Blend')}" value="${esc(g.origin||'')}"></div>
       <div class="field sel"><label>${t('Roast level')}</label><select id="ge-roast">
         <option value=""${g.roast?'':' selected'}>${t('Not sure')}</option>
         ${['Light','Light-medium','Medium','Medium-dark','Dark'].map(r=>`<option value="${r}"${g.roast===r?' selected':''}>${t(r)}</option>`).join('')}
       </select></div>
       <div class="field"><label>${t('Tasting notes')}</label><input id="ge-notes" placeholder="${t('Chocolate, red berry, caramel')}" value="${esc(g.notes||'')}"></div>`;
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="${t('Details')}">
    <div class="grab"></div>
    <div class="ov-bar" style="border:0"><b>${esc(name)}</b><button class="iconbtn" data-action="close-ov" aria-label="${t('Close')}">${icon('x',20)}</button></div>
    <div class="ov-body" style="padding:0 16px 16px">
      <p style="font-size:12.5px;color:var(--ink2);line-height:1.55;margin:0 0 14px">${own
        ? t('This one is yours. What you write here stays on your device and shows up on this page and in your passport — nobody else sees it, and nobody else can pick this entry.')
        : t('This coffee or machine is in the catalogue, so its facts stay as they are. Your note is yours alone.')}</p>
      ${fields}
      <div class="field"><label>${t('Note')}</label><textarea id="ge-note" placeholder="${isM?t('Grind setting, what it likes, what it hates…'):t('Where you bought it, what it cost, how you dial it in…')}">${esc(g.note||'')}</textarea></div>
      <button class="btn block" style="margin-top:6px" data-action="gear-save" data-kind="${kind}" data-v="${esc(name)}">${t('Save')}</button>
      <div style="height:8px"></div>
    </div></div>`;
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
    /* A moderation notice has no actor either — nobody did this to you,
       a decision did — and it is the one row where the symbol carries
       weight, so it gets its own rather than the default cup. */
    const noFace=n.type==='challenge'?'🏆':n.type==='podium'?'🏅'
                :n.type==='daily_champion'?'🥇'
                :n.type==='moderation'?'⚖️':n.type==='report_update'?'🚩':'☕';
    const av=n.u?avatar(n.u):`<div class="avatar" style="background:var(--crema)">${noFace}</div>`;
    /* A request is the one notification that is a question, so it keeps
       its buttons here too — the row above the feed is the prominent
       copy, this is the one you find when you come looking. */
    const ask=n.type==='follow_request'&&n.u&&(social.requests||[]).some(r=>r.id===n.u)
      ? `<div class="nact"><button class="btn sm" data-action="accept-follow" data-id="${n.u}">${t('Accept')}</button>
         <button class="btn ghost sm" data-action="decline-follow" data-id="${n.u}">${t('Decline')}</button></div>` : '';
    return `<div class="nrow ${n.read?'':'unread'}" ${ask?'':`data-action="notif-go" data-idx="${i}"`}>${av}
      <div class="nb"><div class="nt">${n.u?`<b>${esc(userOf(n.u).name)}</b> `:''}${esc(notifBody(n.text))}</div><span>${t('{time} ago',{time:agoTag(n.at,n.time)})}</span>${ask}</div></div>`;}).join('');
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
      <b>${esc(t(ch.title))}</b>
      <div class="chcard-s">${esc(t(ch.blurb))}</div>
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
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${esc(t(ch.title))}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="${t('Back')}">${icon('back',20)}</button><b>${esc(t(ch.title))}</b></div>
    <div class="ov-body"><div style="padding:0 16px 20px">
      <div class="ch-top" style="height:150px;border-radius:16px;margin-top:14px">${cupSVG(ch.pattern,.92,ch.id.length)}<span class="ends">${ch.done?t('Complete'):t('{time} left',{time:endsIn(ch)})}</span></div>
      <div style="margin:14px 2px 4px">
        <b style="font-family:var(--serif);font-size:22px">${esc(t(ch.title))}</b>
        <div class="chips" style="margin:8px 0">
          <span class="chip">${catLabel(ch.cat)}</span>
          <span class="chip tag">${esc(t(ch.tag))}</span>
          <span class="chip" style="color:var(--st4);border-color:var(--st3);background:var(--st1)">${t('+{n} points',{n:ch.points})}</span>
          ${ch.done?`<span class="chip" style="color:var(--green)">✓ ${t('Earned')}</span>`:''}</div>
        <p style="font-size:13.5px;color:var(--ink2);line-height:1.5;margin:4px 0 14px">${esc(t(ch.blurb))}</p>
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
      ${sw('toggle-notify-friends',state.me.notifyFriends,t('When friends pour'),t('Every coffee they log'))}
      ${sw('toggle-notify-streak',state.me.notifyStreak,t('Streak reminder'),t('Evenings, only when your streak is at risk'))}
      ${sw('toggle-notify-digest',state.me.notifyDigest,t('Your week in coffee'),
           state.me.premium?t('Sunday at 4pm, when your card is ready'):t('Sunday afternoon, if you poured that week'))}
      <button class="btn ghost block" style="margin-top:10px" data-action="push-off"${p.busy?' disabled':''}>${t('Turn off on this device')}</button>`;
  }
}

/* The bean passport — every coffee you have logged, in one place.
   Built from all of your pours, not the feed page. */
function overlayPassport(){
  const beans=beanPassport();
  const origins=[...new Set(beans.map(b=>b.cat&&b.cat.c).filter(Boolean))];
  const totalPours=beans.reduce((n,b)=>n+b.pours,0);
  /* Every row opens now, catalogue or not. It used to be that a coffee
     you added yourself was the one row that did nothing when tapped —
     the bag you know best, and the only dead end on the page. It has a
     sheet of its own to go to, empty until you fill it in. */
  const row=b=>{
    const own=gearNote('bean',b.name)||{};
    const sub=[b.cat&&b.cat.roaster, b.cat&&t(b.cat.origin), b.cat&&t(b.cat.roast)].filter(Boolean).join(' · ')
      || [own.roaster,own.origin&&t(own.origin),own.roast&&t(own.roast)].filter(Boolean).join(' · ');
    return `<div class="rlist-row click" data-action="open-bean" data-id="${esc(b.name)}">
      <div class="bean-fl">${(b.cat&&flag[b.cat.c])||'🫘'}</div>
      <div class="who" style="flex:1;min-width:0"><b>${esc(b.name)}</b>
        <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${sub?esc(sub):t('Your own coffee')}</span></div>
      <div class="rlist-val">${b.pours?`${b.pours} <small>${tn(b.pours,'pour','pours')}</small>`:`<small>${t('not logged yet')}</small>`}</div>
    </div>`;
  };
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${t('Bean passport')}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="${t('Back')}">${icon('back',20)}</button><b>${t('Bean passport')}</b>
      <button class="act" style="margin-left:auto" data-action="open-gearpass">${icon('mach',20)}</button></div>
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
        <button class="btn ghost block" style="margin-top:16px" data-action="open-gearpass">${icon('mach',17)} ${t('Machine passport')}</button>
        <div style="height:8px"></div>
      </div></div></div>`;
}

/* ---------- the machine passport ----------
   The bean passport's twin, and it earns the pairing rather than just
   mirroring it. A bean passport is a list of things you tried once; a
   machine passport is a list of things you *own*, so the interesting
   number is not how long it is but how the pours split across it —
   which brewer is actually the morning one, and which came out for a
   weekend and never went back in the cupboard.

   Same rows, same sort, same source: your own pours. Gear you have
   named but never poured on sits at the bottom at zero rather than
   being hidden, because "not logged yet" is a truer thing to say about
   the AeroPress in the drawer than nothing at all. */
function overlayGearPassport(){
  const list=machinePassport();
  const kinds=[...new Set(list.map(m=>m.info&&m.info.label).filter(Boolean))];
  const totalPours=list.reduce((n,m)=>n+m.pours,0);
  const most=list.length&&list[0].pours?list[0]:null;
  const row=m=>{
    const own=gearNote('machine',m.name)||{};
    const ownKind=own.kind&&MACHINE_KINDS[own.kind];
    const sub=m.info?[t(m.info.label),t(m.info.country)].filter(Boolean).join(' · ')
                    :(ownKind?t(ownKind.label):t('Your own machine'));
    /* The share of your pours, not a second raw count: with one machine
       it says 100% and stops being interesting, which is exactly right —
       the bar only has something to say once there are two. */
    const pct=totalPours?Math.round(m.pours/totalPours*100):0;
    return `<div class="rlist-row click" data-action="open-machine" data-id="${esc(m.name)}">
      <div class="bean-fl">${icon('mach',20)}</div>
      <div class="who" style="flex:1;min-width:0"><b>${esc(m.name)}</b>
        <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(sub)}</span></div>
      <div class="rlist-val">${m.pours?`${m.pours} <small>${tn(m.pours,'pour','pours')}</small>${list.length>1?`<br><span style="font-size:11px;font-weight:600;color:var(--muted)">${pct}%</span>`:''}`
        :`<small>${t('not logged yet')}</small>`}</div>
    </div>`;
  };
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="${t('Machine passport')}">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="${t('Back')}">${icon('back',20)}</button><b>${t('Machine passport')}</b>
      <button class="act" style="margin-left:auto" data-action="open-passport">${icon('bean',20)}</button></div>
    <div class="ov-body">
      <div class="bean-hero"><img src="${S.esp}" alt=""><div class="bean-hero-t">
        <span class="fl">🛠️</span><div><b>${tn(list.length,'{n} brewer','{n} brewers')}</b>
        <span>${tn(totalPours,'{n} pour','{n} pours')}${kinds.length>1?' · '+tn(kinds.length,'{n} kind','{n} kinds'):''}</span></div></div></div>
      <div style="padding:16px">
        ${kinds.length?`<div class="chips" style="margin:0 0 14px">${kinds.map(k=>`<span class="chip">${icon('mach',12)} ${esc(t(k))}</span>`).join('')}</div>`:''}
        ${list.length
          ? `<div class="rlist">${list.map(row).join('')}</div>
             <div style="font-size:12px;color:var(--muted);text-align:center;margin-top:12px">${most&&list.length>1
                ? t('Most of your coffee comes off the {name}.',{name:esc(most.name)})
                : t('Every brewer you have logged, most-poured first.')}</div>`
          : `<div class="empty"><div class="big">🛠️</div>${t('No brewers yet.')}<br>${t('Name the machine you used when you log a pour and it lands here.')}<br><br>
             <button class="btn sm" data-action="open-create">${t('Log a coffee')}</button></div>`}
        <button class="btn ghost block" style="margin-top:16px" data-action="open-passport">${icon('bean',17)} ${t('Bean passport')}</button>
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
        <div class="field sel"><label>${t('Go-to milk')}</label><select id="sp-milk">${selectOptions(MILK_LIST,m.favMilk)}</select></div></div>
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
      ${state.me.isAdmin?`<div class="rlabel" style="margin-top:18px">Moderation</div>
      <div class="mrow" data-action="open-admin"><div class="mi">⚖️</div>Reports &amp; decisions</div>`:''}
      <div class="rlabel" style="margin-top:18px">${t('Your data')}</div>
      <div class="mrow" data-action="export-data"><div class="mi">📦</div>
        <div style="flex:1">${ui.exporting?t('Putting it together…'):t('Download your data')}
          <div style="font-size:11.5px;color:var(--muted);font-weight:500">${t('One file with every pour, comment and setting')}</div></div></div>
      <div class="mrow danger" data-action="open-delete-account"><div class="mi">🗑️</div>
        <div style="flex:1">${t('Delete your account')}
          <div style="font-size:11.5px;color:var(--muted);font-weight:500">${t('Everything goes. This cannot be undone.')}</div></div></div>
      <div class="rlabel" style="margin-top:18px">${t('Legal')}</div>
      <a class="mrow" href="/impressum/" target="_blank" rel="noopener"><div class="mi">📄</div>Impressum</a>
      <a class="mrow" href="/privacy/" target="_blank" rel="noopener"><div class="mi">🔒</div>${t('Datenschutz / Privacy Policy')}</a>
    </div></div>`;
}

/* ---------- deleting an account ----------
   The last screen anybody sees, so it is written to be read rather than
   dismissed: what goes, what stays, and a field that will not accept
   anything except their own username typed out.

   The typed handle is not theatre. Every other destructive control in
   the app is one tap away from an undo — a hidden post can be unhidden,
   a like can be given back — and this one is not, so the confirmation
   has to cost more than a tap that a thumb can make by accident. The
   Edge Function checks the same string server-side; this side is where
   it is explained. */
function overlayDeleteAccount(){
  const d=ui.del||(ui.del={error:'',busy:false});
  const handle=(USERS.me.handle||'').replace(/^@/,'');
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="${t('Delete your account')}">
    <div class="grab"></div>
    <div class="ov-bar" style="border:0"><b>${t('Delete your account')}</b><button class="iconbtn" data-action="close-ov" aria-label="${t('Close')}">${icon('x',20)}</button></div>
    <div class="ov-body" style="padding:0 16px 18px">
      ${d.error?`<div style="background:rgba(168,84,74,.10);border:1px solid rgba(168,84,74,.28);color:var(--terra);border-radius:12px;padding:10px 12px;font-size:12.5px;margin-bottom:12px">${esc(d.error)}</div>`:''}
      <p style="font-size:13.5px;line-height:1.55;color:var(--muted);margin:2px 0 10px">
        ${t('Your pours, photos, comments, likes, streak, level and settings are deleted straight away. Comments other people left on your pours go with them.')}</p>
      <p style="font-size:13.5px;line-height:1.55;color:var(--muted);margin:0 0 14px">
        ${t('What stays: any moderation decision about you, with your name removed. Nothing else.')}</p>
      <div class="mrow" data-action="export-data" style="border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:14px">
        <div class="mi">📦</div><div style="flex:1">${ui.exporting?t('Putting it together…'):t('Download your data first')}
        <div style="font-size:11.5px;color:var(--muted);font-weight:500">${t('You cannot get it back afterwards')}</div></div></div>
      <!-- The label is generic and the username is the placeholder, not
           the label: .field label is uppercased in styles.css, and a
           handle rendered as DELCHECK33 above a field that wants
           delcheck33 asks people to type the wrong thing. -->
      <div class="field"><label>${t('Type your username to confirm')}</label>
        <input id="del-confirm" value="" placeholder="${esc(handle)}" autocomplete="off" autocapitalize="off" spellcheck="false" data-enter="delete-account"></div>
      <button class="btn block"${d.busy?' disabled':''} style="background:var(--terra);border-color:var(--terra)" data-action="delete-account">
        ${d.busy?t('Deleting…'):t('Delete my account for good')}</button>
      <button class="btn ghost block" style="margin-top:8px" data-action="close-ov">${t('Keep my account')}</button>
      <div style="height:6px"></div>
    </div></div>`;
}

/* ============================================================
   Moderation — the screen that makes the report sheet true

   The report sheet promises every user that a person reads what they
   send. Until this existed a person was *emailed*, and then had no tool
   to do anything about it except open the SQL editor. This is the tool.

   Three deliberate shapes:

     * Hiding leads, removing follows. Hiding is reversible and a
       reversible action is the one to reach for at 07:00 on a phone.
     * The statement of reasons is a text box, not a dropdown, and it is
       filled in before you decide rather than after. What is in that
       box is what the person is sent and what the audit row keeps —
       the same string, never a code that gets translated into an
       explanation later by somebody guessing.
     * Dismissing is a button with the same weight as the others,
       because "we looked and left it up" is a decision and a queue
       that cannot record it cannot tell reviewed from ignored.

   Not translated, on purpose: one person sees this screen and the
   German bundle exists for users. The statement itself is typed by
   hand, in whatever language the person being written to reads.
   ============================================================ */
const modWhen = ts => { try{ return new Date(ts).toLocaleString(); }catch(e){ return ts||''; } };

/* Anything on this screen came from somebody else's keyboard — the
   caption that got reported, the comment, the handle, the reporter's
   note. All of it goes through esc(), the same as everywhere else. */
function modTarget(r){
  const tg=r.target||{}, a=tg.author||{};
  const who=`<span class="mod-who" data-action="open-user" data-id="${esc(a.id||'')}">@${esc(a.handle||'unknown')}</span>`;
  const susp=a.suspended_until && new Date(a.suspended_until)>new Date()
    ? `<span class="chip" style="background:var(--pm1)">paused until ${esc(modWhen(a.suspended_until))}</span>` : '';
  const flags=`${tg.hidden?'<span class="chip">hidden</span>':''}${susp}`;

  if(tg.kind==='post') return `<div class="mod-target">
    <div class="mod-thumb">${tg.image_key
      ? `<img src="${esc(imageUrl(tg.image_key,'thumb'))}" alt="" onerror="this.remove()">`
      : '<span>☕</span>'}</div>
    <div class="mod-tb">
      <b>${esc(tg.drink||'pour')}</b> by ${who} ${flags}
      <p>${esc(tg.caption||'(no caption)')}</p>
      <span class="mod-meta">${esc(modWhen(tg.created_at))} ·
        <a data-action="open-post" data-id="${esc(tg.id||'')}">open the pour</a></span>
    </div></div>`;

  if(tg.kind==='comment') return `<div class="mod-target">
    <div class="mod-thumb"><span>💬</span></div>
    <div class="mod-tb">
      comment by ${who} ${flags}
      <p>${esc(tg.body||'')}</p>
      <span class="mod-meta">${esc(modWhen(tg.created_at))} ·
        <a data-action="open-post" data-id="${esc(tg.post_id||'')}">open the pour it is under</a></span>
    </div></div>`;

  return `<div class="mod-target">
    <div class="mod-thumb"><span>👤</span></div>
    <div class="mod-tb">the account ${who} ${flags}
      <p>Reported as a person rather than as one pour.</p></div></div>`;
}

function modCard(r){
  const tg=r.target||{}, a=tg.author||{};
  const kind=tg.kind||'user';
  const id=esc(r.id);
  /* Prefilled from the reason the reporter picked, then edited. The
     default action a moderator reaches for is hiding, so that is the
     statement the box starts with. */
  const draft=statementFor(kind==='comment'?'hide_comment':'hide_post',{ reason:r.reason||'our content rules' });
  const done=r.status!=='open';
  const btn=(k,label,cls='')=>`<button class="btn sm ${cls}" data-action="mod-act" data-k="${k}"
      data-id="${id}" data-t="${esc(kind)}" data-tid="${esc(tg.id||'')}" data-uid="${esc(a.id||'')}"
      data-reason="${esc(r.reason||'')}">${label}</button>`;

  return `<div class="mod-card${done?' done':''}">
    <div class="mod-head">
      <b>${esc(r.reason||'reported')}</b>
      <span class="mod-meta">${esc(modWhen(r.created_at))} · from @${esc((r.reporter&&r.reporter.handle)||'someone')}</span>
      ${done?`<span class="chip">${esc(r.status)}${r.resolution?' · '+esc(r.resolution):''}</span>`:''}
    </div>
    ${r.note?`<p class="mod-note">“${esc(r.note)}”</p>`:''}
    ${modTarget(r)}
    ${done?'':`
    <label class="mod-label" for="mod-st-${id}">What this person will be told — sent to their inbox and kept on the record</label>
    <textarea class="mod-statement" id="mod-st-${id}" rows="3">${esc(draft)}</textarea>
    <div class="mod-acts">
      ${tg.hidden?btn('unhide','Put it back','ghost'):btn('hide','Hide it')}
      ${kind==='user'?'':btn('remove','Remove it','ghost')}
      ${a.id?btn('suspend','Pause the account 7 days','ghost'):''}
      ${btn('dismiss','Leave it up','ghost')}
    </div>`}
  </div>`;
}

function modLogRow(m){
  const s=m.subject||{};
  return `<div class="mod-card done">
    <div class="mod-head"><b>${esc(m.action)}</b>
      <span class="mod-meta">${esc(modWhen(m.created_at))} · @${esc(s.handle||'—')} · ${esc(m.reason||'')}</span></div>
    ${m.statement?`<p class="mod-note">“${esc(m.statement)}”</p>`:''}
    ${m.evidence&&m.evidence.image_key
      ? `<span class="mod-meta">photo still in R2: <code>${esc(m.evidence.image_key)}</code></span>` : ''}
  </div>`;
}

function overlayAdmin(){
  const tabs=[['open','Open'],['all','All reports'],['log','Decisions']]
    .map(x=>`<button class="${admin.tab===x[0]?'on':''}" data-action="mod-tab" data-t="${x[0]}">${x[1]}</button>`).join('');
  const body = admin.err
    ? `<div class="empty"><div class="big">⚠️</div>${esc(admin.err)}</div>`
    : admin.loading && !admin.loaded
      ? `<div class="empty"><div class="big">⚖️</div>Loading the queue…</div>`
      : admin.tab==='log'
        ? (admin.log.length ? admin.log.map(modLogRow).join('')
           : `<div class="empty"><div class="big">📋</div>No decisions recorded yet.</div>`)
        : (admin.list.length ? admin.list.map(modCard).join('')
           : `<div class="empty"><div class="big">✅</div>${admin.tab==='open'?'Nothing waiting. The queue is empty.':'No reports.'}</div>`);

  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet" role="dialog" aria-label="Moderation">
    <div class="ov-bar"><button class="iconbtn" data-action="close-ov" aria-label="${t('Back')}">${icon('back',20)}</button><b>Moderation</b></div>
    <div class="ov-body" style="padding:0 14px 20px">
      <div class="seg" style="margin:12px 0">${tabs}</div>
      <p class="mod-meta" style="display:block;margin:0 0 12px">
        Every action here is recorded with what you wrote, and the person is told.
        Hiding can be undone; removing cannot, and leaves the photo in R2 —
        <code>metrics.sql</code> block I lists those.</p>
      ${body}
    </div></div>`;
}

/* ============================================================
   Premium — the offer, in one place

   Everything that makes a coffee log true — every drink, every machine,
   every coffee, including the ones we've never heard of — is
   deliberately NOT on this list. That is free, permanently. A paywall
   in front of an honest record would be a worse product before it was
   ever a better business, and it would poison the data the rest of the
   app is built on. What Premium sells is the layer on top of the log:
   what the log *tells* you, and what you can hand to someone else.

   Two surfaces render the same offer — the block in Settings and the
   sheet a lock raises — so both are built from premiumOffer() below and
   cannot drift into saying different things about the same money.
   ============================================================ */
export const PERKS=()=>[
  ['📅',t('Your week in coffee'),t('A card of your week, made to post')],
  ['📊',t('Your stats'),t('What you actually brew, when, and at what ratio')],
  ['◍',t('The gold ring'),t('Your avatar wears it everywhere you appear')],
  ['🚫',t('Always ad-free'),t('Whatever Crema does later, not to you')],
  ['★',t('Favourites'),t('Hold the ones you use at the top of every picker')],
  ['🥤',t('Name your own drink types'),t('Ristretto, Bombón, whatever you actually order')],
  ['📷',t('Three photos on a pour'),t('The shot and the cup, not one or the other')],
  ['✎',t('Your own bean & machine details'),t('Fill in the coffees and gear you added yourself')]
];
const perkList=()=>PERKS().map(p=>
  `<div class="pm-perk"><span>${p[0]}</span><div><b>${p[1]}</b><i>${p[2]}</i></div></div>`).join('');

/* The code field, the ask, and the address to ask at. `id` differs per
   surface because both can be in the DOM at once — the settings sheet
   stays mounted underneath while the offer sheet covers it, and two
   inputs sharing an id means the wrong one gets read. */
function codeForm(id){
  const err=(ui.premium&&ui.premium.err)||'';
  const busy=!!(ui.premium&&ui.premium.busy);
  return `<div class="pm-code">
    <label for="${id}">${t('Activation code')}</label>
    <div class="pm-in">
      <input id="${id}" type="text" autocapitalize="characters" autocorrect="off" spellcheck="false"
             placeholder="${t('Type it exactly as it came')}" data-enter="redeem" data-i="${id}"${busy?' disabled':''}>
      <button class="btn" data-action="redeem-premium" data-i="${id}"${busy?' disabled':''}>${busy?t('Checking…'):t('Unlock')}</button>
    </div>
    ${err?`<div class="pm-err">${esc(err)}</div>`:''}
    <div class="pm-ask">${t('No code yet?')}
      <a href="mailto:${PREMIUM_MAIL}?subject=${encodeURIComponent(t('Crema Premium code'))}" data-action="premium-mail">${t('Write to {mail}',{mail:PREMIUM_MAIL})}</a>
      ${t('and you get one back. One line is enough.')}</div>
    <div class="pm-copy" data-action="copy-premium-mail">${t('or tap to copy the address')}</div>
  </div>`;
}

/* The offer itself. `lead` is what the surface wants said first — a lock
   names the thing that was just reached for, Settings names nothing and
   opens on the general case. */
export function premiumOffer(id,lead){
  return `<div class="pm-card on">
    <b class="pm-h">${t('✦ Crema Premium')}</b>
    ${lead?`<div class="pm-lead">${lead}</div>`:''}
    <div class="pm-free">${t('Free right now, while Crema is young — no card, no trial countdown, no price to compare. It needs a code, and the codes are being handed out by hand. That will not last: when billing starts, this window shuts.')}</div>
    ${perkList()}
    ${codeForm(id)}
    <div class="pm-fine">${t('Logging your coffee stays free for everyone, always, whatever the drink, the machine or the bean.')}</div></div>`;
}

/* The block in Settings — where every 🔒 in the app eventually points. */
function premiumBlock(m){
  if(m.premium) return `
    <div class="mrow" style="cursor:default;border-bottom:0"><div class="mi">✦</div>
      <div style="flex:1">${t('Premium active')}<div style="font-size:11.5px;color:var(--muted);font-weight:500">${t('Free for now. We will ask you before anything costs money.')}</div></div>
      <span class="lvlchip" style="background:var(--gold);color:var(--on-crema);border-color:transparent">${t('ACTIVE')}</span></div>
    <div class="pm-card" style="margin:4px 0 8px">${perkList()}</div>
    <button class="btn ghost block" data-action="premium-off">${t('Turn Premium off')}</button>`;
  return premiumOffer('sp-code','');
}

/* The sheet a lock raises. Same offer, but it opens by naming the thing
   they just reached for: the ask lands better as the answer to something
   someone was already trying to do, and they were — that is why the
   sheet is here at all. Deliberately not a toast: a toast cannot hold
   the code field, so the old one asked people to go and find Settings,
   and most of them didn't. */
function overlayPremium(feature){
  const lead=feature
    ? t('<b>{what}</b> is part of Premium.',{what:esc(feature)})
    : '';
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="${t('Crema Premium')}">
    <div class="grab"></div>
    <div class="ov-bar" style="border:0"><b>${t('Crema Premium')}</b><button class="iconbtn" data-action="close-ov" aria-label="${t('Close')}">${icon('x',20)}</button></div>
    <div class="ov-body" style="padding:0 16px 20px">
      ${premiumOffer('pm-code',lead)}
      <div style="text-align:center;font-size:13px;color:var(--muted);margin-top:14px;cursor:pointer" data-action="close-ov">${t('Not now')}</div>
    </div></div>`;
}

/* ---------- your week in coffee ----------
   The card is the whole sheet. It is an SVG (see ui/recap.js for why the
   preview and the export are the same string), shown at whatever width
   the phone has, with one button under it.

   Share first, download second: on a phone `navigator.share` puts the
   PNG straight into Instagram's composer, which is where this is going.
   The download is the desktop answer and the fallback, and actions.js
   decides between them rather than the markup guessing. */
/* The three pictures, and the choosing of them.
   Only pours with a photo appear: a generated cup is a fine thumbnail
   in a grid and a poor centrepiece at a third of the card. The strip is
   in the week's own order, each pick numbered where it was tapped, so
   swapping the fourth one in for the oldest is something you watch
   happen rather than something you deduce. */
function standoutPicker(r){
  if(r.candidates.length<2) return '';
  const picked=r.standouts.map(s=>s.id);
  return `<div class="rc-pick">
    <div class="rc-pick-h"><b>${t('The three you want shown')}</b>
      <span>${t('{n} of {max}',{n:picked.length,max:RECAP_PICKS})}</span></div>
    <div class="rc-strip">
      ${r.candidates.map(s=>{
        const i=picked.indexOf(s.id);
        return `<button class="rc-shot${i>=0?' on':''}" data-action="pick-standout" data-id="${s.id}"
          aria-pressed="${i>=0}" aria-label="${esc(cap(s.drink||t('Pour')))}">
          <img src="${esc(imageUrl(s.img,'thumb'))}" alt="" loading="lazy">
          ${i>=0?`<span class="rc-n">${i+1}</span>`:''}</button>`;
      }).join('')}
    </div>
    <div class="rc-hint">${r.chosen?t('Tap to swap one out.'):t('Your most-loved three, until you pick your own.')}</div>
  </div>`;
}

function overlayRecap(){
  const r=weekRecap();
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="${t('Your week in coffee')}">
    <div class="grab"></div>
    <div class="ov-bar" style="border:0"><b>${t('Your week in coffee')}</b><button class="iconbtn" data-action="close-ov" aria-label="${t('Close')}">${icon('x',20)}</button></div>
    <div class="ov-body" style="padding:0 16px 20px">
      ${r?`<div class="recap-card">${recapSVG(r,state.me,shotPhotos())}</div>
      ${standoutPicker(r)}
      <button class="btn block" style="margin-top:14px" data-action="share-recap">${icon('share',18)} ${t('Share your week')}</button>
      <div class="recap-note">${t('Saves as a picture, sized for a post or a story. Nothing leaves Crema until you send it.')}
        ${r.live?`<br>${t('This week is still running — the card counts every pour until midnight.')}`:''}</div>`
      : `<div class="empty"><div class="big">📅</div>${t('No coffee logged this week.')}<br>${t('This card covers one Monday to Sunday, and lands every Sunday at 4pm.')}<br><br>
         <button class="btn sm" data-action="open-create">${t('Log a coffee')}</button></div>`}
    </div></div>`;
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
      <span class="lvlchip" style="color:var(--green);border-color:var(--pm2);background:var(--pm1)">${t('SYNCED')}</span></div>
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
    <div class="field sel"><label>${t('Go-to milk')}</label><select id="ob-milk">${selectOptions(MILK_LIST,state.me.favMilk)}</select></div></div>
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
/* ---------- the machine / coffee picker ----------
   Two lists and a search box, and that is the whole sheet.

   It used to be four: your shelf, a dozen common ones, forty-five brand
   chips to browse by, and the search. The brand wall was the mistake —
   it looked like the main way in, so people scanned forty names for
   theirs instead of typing three letters, and the two rows that would
   have answered them in one tap sat above it unread. Browsing a
   catalogue nobody can finish writing is a worse tool than searching it,
   so the chips are gone and the search says how much is behind it.

   What is left is ordered by how likely it is to be the answer: what
   you poured yesterday, then the handful of machines and bags that are
   in most kitchens, then everything else through the field at the top.
   Both lists are short on purpose — a shortlist that scrolls is a
   dropdown wearing a hat. */
const SHELF_N=5;     // your own, most recent first
const COMMON_N=6;    // the fixed shortlist everyone sees

function pickerRow(kind,value,sub,cur,pinnable){
  const on=value===cur;
  return `<div class="pk-row${on?' on':''}" data-action="pick" data-kind="${kind}" data-v="${esc(value)}">
    <span class="pk-i">${icon(kind==='machine'?'mach':'bean',17)}</span>
    <span class="pk-t"><b>${esc(value)}</b>${sub?`<span>${esc(sub)}</span>`:''}</span>
    <button class="pk-info" data-action="gear-info" data-kind="${kind}" data-v="${esc(value)}"
      aria-label="${t('Details')}">${icon('info',16)}</button>
    ${pinnable?`<button class="pk-pin${isPinned(kind,value)?' on':''}" data-action="pin" data-kind="${kind}" data-v="${esc(value)}"
       aria-label="${isPinned(kind,value)?t('Remove from favourites'):t('Add to favourites')}">★</button>`:''}
    ${on?`<span class="pk-on">✓</span>`:''}</div>`;
}
const pkSection=(title,body,note)=>body?`<div class="pk-sec"><div class="pk-h">${title}${note?`<span>${note}</span>`:''}</div>${body}</div>`:'';

/* One line under a row: what the thing is, in the words the detail
   sheet would use. A coffee shows its roaster, a machine what kind of
   brewer it is — the two facts that tell a Silvia from a Silvano
   without opening anything. */
function pickerSub(kind,v){
  if(kind==='machine'){
    const i=machineInfo(v); if(i) return t(i.label);
    const own=gearNote('machine',v);
    return own&&own.kind&&MACHINE_KINDS[own.kind] ? t(MACHINE_KINDS[own.kind].label) : t('Your own machine');
  }
  const c=beanCatalog(v); if(c) return c.roaster;
  const own=gearNote('bean',v);
  return (own&&(own.roaster||'').trim()) || t('Your own coffee');
}

export function pickerList(){
  const p=ui.picker; if(!p) return '';
  const isM=p.kind==='machine', q=(p.q||'').trim(), cur=p.current||'';
  const sub=v=>pickerSub(p.kind,v);
  const mine=isM?myMachines():myCoffees();
  let h='';

  if(q){
    /* Your own shelf is searched first and separately. A search that
       reaches the whole catalogue but not the bag you typed in
       yesterday is not a search, and yours is the likelier answer —
       so it goes above the catalogue rather than into it. */
    const own=searchOwn(mine,q).filter(v=>isM?!machineKnown(v):!beanKnown(v));
    h+=pkSection(t('Yours'), own.map(v=>pickerRow(p.kind,v,sub(v),cur,false)).join(''));
    const hits=isM?searchMachines(q):searchBeans(q);
    h+=pkSection(tn(hits.length,'{n} match','{n} matches'),
      hits.map(x=>pickerRow(p.kind,isM?x.label:x.name,sub(isM?x.label:x.name),cur,false)).join(''));
    /* Nothing found, or rows that aren't what they meant — either way
       the way out is the same, and it is never a dead end. The line
       under it has to match what is on screen: telling someone their
       coffee is "not in the list" directly below three matching rows
       reads as the search being broken, not as an offer. */
    const exact=(isM?machineKnown(q):beanKnown(q)) || own.some(v=>v.toLowerCase()===q.toLowerCase());
    if(!exact) h+=`<div class="pk-add" data-action="pick-new" data-kind="${p.kind}">
      <span class="pk-i">＋</span>
      <span class="pk-t"><b>${t('Add “{q}”',{q:esc(q)})}</b><span>${(hits.length||own.length)
        ? (isM?t('None of these? Save it as your own machine'):t('None of these? Save it as your own coffee'))
        : (isM?t('Not in the list. Save it as your own machine'):t('Not in the list. Save it as your own coffee'))}</span></span></div>`;
    if(!hits.length&&!own.length) h+=`<div class="pk-empty">${isM
      ? t('Nothing in the catalogue matches that. Yours works just as well: it lands on your gear and is there next time.')
      : t('Nothing in the catalogue matches that. Yours works just as well: it lands on your shelf and is there next time.')}</div>`;
    return h;
  }

  /* Favourites are the one list you arranged yourself, so they sit above
     the one the app arranged for you. They only exist once there are two
     of something to order — with one entry the star could only ever say
     yes — and that is also the first morning the order matters. */
  const favs=mine.filter(v=>isPinned(p.kind,v));
  const rest=mine.filter(v=>!isPinned(p.kind,v));
  const canPin=mine.length>1;
  h+=pkSection('★ '+t('Favourites'), favs.map(v=>pickerRow(p.kind,v,sub(v),cur,canPin)).join(''));
  h+=pkSection(favs.length?t('Also yours'):t('Yours'),
    rest.slice(0,SHELF_N).map(v=>pickerRow(p.kind,v,sub(v),cur,canPin)).join(''),
    rest.length?t('most recent first'):'');
  if(!state.me.premium&&canPin)
    h+=`<div class="pk-note" data-action="open-premium" data-f="${t('Favourites')}"><span>★</span>
      <span>${t('Star the ones you use most to hold them at the top. That is Premium, <u>free right now, with a code</u>.')}</span></div>`;

  const pop=(isM
    ? POPULAR_MACHINES.map(([b,m])=>b+' '+m)
    : popularBeans()).filter(v=>!mine.includes(v)).slice(0,COMMON_N);
  h+=pkSection(mine.length?t('Common ones'):t('Popular'),
    pop.map(v=>pickerRow(p.kind,v,sub(v),cur,false)).join(''));

  /* The way to everything else is one sentence naming the size of what
     is behind the field, because "search" as a bare word reads as a
     filter over the six rows already on screen. */
  const n=isM?machineIndex().length:BEANS.length;
  h+=`<div class="pk-add" data-action="pk-focus"><span class="pk-i">${icon('search',18)}</span>
    <span class="pk-t"><b>${isM?t('Search all {n} machines & brewers',{n}):t('Search all {n} coffees',{n})}</b>
    <span>${isM?t('By brand, model or kind — “moka”, “silvia”, “bean-to-cup”. Not there? Add your own.')
                :t('By name, roaster, origin or taste — “lidl”, “ethiopia”, “fruity”. Not there? Add your own.')}</span></span></div>`;
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

/* ---------- the photo strip ----------
   Only there once there is a photo, because until then the big preview
   is the whole story and a row of empty tiles under it would be the app
   explaining a feature to someone who has not used the first one yet.

   The ＋ tile is where the Premium line actually falls, and it is the
   only place it does: everything above it — taking a photo, reframing
   it, retaking it — is the same for everyone. On a free account the
   tile is still there and still tappable; it says what it would do and
   how to get it, rather than being hidden so the possibility is never
   discovered. */
function photoStrip(c,pics,n,editing){
  if(!n||editing) return '';
  const cell=(sh,i)=>`<button class="pstrip-i${i===c.photoI?' on':''}" data-action="photo-pick" data-i="${i}" aria-label="${t('Photo {n}',{n:i+1})}">
    <img src="${esc(sh.preview||imageUrl(sh.img,'thumb'))}" alt="">
    ${sh.uploading?`<i class="pstrip-up"></i>`:''}${sh.failed?`<i class="pstrip-bad">!</i>`:''}
    ${i===0&&n>1?`<span class="pstrip-first">${t('Cover')}</span>`:''}</button>`;
  const room=n<PHOTOS_PREMIUM;
  const add=!room ? '' : state.me.premium
    ? `<label class="pstrip-add" title="${t('Add another photo')}"><input type="file" id="c-photo-add" accept="image/*" hidden>＋</label>`
    : `<button class="pstrip-add locked" data-action="photo-premium" title="${t('Up to three photos on a pour')}">＋<i>🔒</i></button>`;
  const note=n>1
    ? t('The first photo is the cover — it is the one the feed, your grid and the link preview show.')
    : state.me.premium
      ? t('Add up to three. The first stays the cover.')
      : t('Up to three photos on a pour is Premium — <u>free right now, with a code</u>.');
  return `<div class="pstrip">${pics.map(cell).join('')}${add}</div>
    <div class="pstrip-n"${state.me.premium||n>1?'':` data-action="photo-premium" style="cursor:pointer"`}>${note}</div>`;
}

/* The same sheet does double duty: with `editId` set it edits that pour
   instead of starting a new one. Everything except the photo is the same
   form, so an edit looks and behaves exactly like the post did — the
   camera row is simply not there, because the photo is not editable.

   The "Add a photo" badge over the empty preview reads as a button and
   was not one, so the biggest target on the sheet did nothing. It is a
   <label for="c-photo-cam"> now: same camera as the Take photo button,
   which is what someone starting a post is reaching for. Gallery is
   still one tap away in the row underneath. */
function overlayCreate(){
  const c=ui.create||freshCreate(), isArt=!!DRINK_ART[c.drink], editing=!!c.editId;
  const pics=c.photos||[], sh=pics[c.photoI]||null, n=pics.length;
  /* A picked photo can be reframed while the sheet is open: only while
     its pixels are still here (preview), and only if it isn't already
     square — a square has exactly one crop. */
  const framing=!!(sh&&sh.preview&&sh.adjustable);
  const anyFailed=pics.some(x=>x.failed);
  const pats=[['heart',t('Heart')],['rosetta',t('Rosetta')],['tulip',t('Tulip')],['swan',t('Swan')],['abstract',t('Abstract art')]];
  const mkList=(base,cur)=>{const l=base.slice(); if(cur&&!l.includes(cur))l.push(cur); return l;};
  /* `translate` is on for catalogue values (milk) and off for names
     that are nobody's to translate — a café's own bean list. Either way
     the option carries the stored string in `value`. */
  const sel=(list,cur,ph,{translate=false}={})=>`<option value=""${cur?'':' selected'}>${ph}</option>`
    +(translate?selectOptions(list,cur):list.map(o=>`<option value="${esc(o)}"${o===cur?' selected':''}>${esc(o)}</option>`).join(''));
  const chosenCafe=(c.source==='cafe'&&c.cafe)?CAFES.find(x=>x.id===c.cafe):null;
  const milkOpts=chosenCafe?chosenCafe.menu.milks:MILK_LIST;
  return `<div class="ov-back" data-action="close-ov"></div><div class="sheet bottom" role="dialog" aria-label="${editing?t('Edit coffee'):t('New coffee')}">
    <div class="grab"></div>
    <div class="ov-bar" style="border:0"><b>${editing?t('Edit coffee'):t('New coffee')}</b><button class="iconbtn" data-action="close-ov" aria-label="${t('Close')}">${icon('x',20)}</button></div>
    <div class="ov-body" style="padding:0 16px 16px">
      <div class="create-prev">
        ${sh?(framing
          /* The whole photo, squared by CSS rather than by pixels, so
             the drag that moves the crop is the crop itself. What the
             upload baked is already this square — see bakeAndUpload(). */
          ?`<img class="photo frameable" src="${sh.preview}" style="object-position:${objectPosition(sh.w,sh.h,sh.focus)}" alt="${t('your coffee photo')}" draggable="false">`
          :`<img class="photo" src="${esc(imageUrl(sh.img,'feed'))}" alt="${t('your coffee photo')}">`)
        :cupSVG(isArt&&c.pattern?c.pattern:'none',.85,999)}
        ${sh?(sh.uploading?`<span class="up-hint">${t('Uploading…')}</span>`:(sh.failed?`<span class="up-hint" style="background:rgba(168,84,74,.9)">${t('Upload failed')}</span>`:''))
          :(editing?'':`<label class="up-hint tap" for="c-photo-cam">${icon('cam',15)} ${t('Add a photo')}</label>`)}
        ${sh&&!editing?`<button class="prev-x" data-action="photo-remove" data-i="${c.photoI}" aria-label="${t('Remove this photo')}">${icon('x',15)}</button>`:''}
      </div>
      ${photoStrip(c,pics,n,editing)}
      ${!editing&&anyFailed?`<div style="background:rgba(168,84,74,.10);border:1px solid rgba(168,84,74,.28);color:var(--terra);border-radius:12px;padding:10px 12px;font-size:12.5px;line-height:1.45;margin:10px 0 2px">
        ${t('That photo could not reach the server. Tap Post to try again, or drop it and post without a photo.')}
        <button class="btn ghost sm" style="margin-top:8px" data-action="drop-photo">${t('Post without the photo')}</button></div>`:''}
      ${editing?`<div style="font-size:11.5px;color:var(--muted);margin:10px 2px 12px">${tn(n,'The photo stays as it was poured. Everything else is yours to fix.','The photos stay as they were poured. Everything else is yours to fix.')}</div>`
      :`${framing?`<div class="frame-hint">${t('Drag the photo to pick what stays in the square.')}</div>`:''}
      <div class="photo-actions">
        <label class="btn ghost sm"><input type="file" id="c-photo-cam" accept="image/*" capture="environment" hidden>${icon('cam',16)} ${n?t('Retake'):t('Take photo')}</label>
        <label class="btn ghost sm"><input type="file" id="c-photo-lib" accept="image/*" hidden>🖼️ ${n?t('Change'):t('Gallery')}</label>
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
      ${HAS_MILK.has(c.drink)?`<div class="field sel"><label>${t('Milk')}</label><select id="c-milk">${sel(mkList(milkOpts,c.milk),c.milk,t('Optional'),{translate:true})}</select></div>`:''}
      <div class="field"><label>${t('Caption')}</label><textarea id="c-caption" placeholder="${t('Say something about this coffee…')}">${esc(c.caption)}</textarea></div>
      ${visibilityPicker(c)}
      ${c.source==='cafe' ? (chosenCafe?`
      <div class="rlabel">${t('{cafe}\'s setup',{cafe:esc(chosenCafe.name)})} <span>· ${t('what they are pouring')}</span></div>
      <div class="field sel"><label>${t('Bean')}</label><select id="c-bean">${sel(chosenCafe.menu.beans,c.bean,t('Which bean did you have?'))}</select></div>
      ${chosenCafe.menu&&chosenCafe.menu.machine?`<div class="recipe-panel open" style="margin:0"><div class="recipe-grid">
        <div class="recipe-mach"><span>${t('Machine')}</span><b>${esc(chosenCafe.menu.machine)}</b></div></div></div>`:''}
      <div style="font-size:11.5px;color:var(--muted);margin:8px 2px 2px">${t('Your pour will be tagged 📍 {cafe}',{cafe:esc(chosenCafe.name)})}</div>`
      : `<div style="font-size:12.5px;color:var(--muted);margin:2px 2px 10px">${t('Pick a café above to load the beans and gear they use.')}</div>`)
      : (c.recipeOpen ? `
      <div class="rlabel">${t('Recipe')} <span>· ${t('optional, add only what you know')}</span></div>
      ${beanPicker('c',c.bean)}
      ${machinePicker('c',c.machineBrand,c.machineModel)}
      <div class="rowfields">
        <div class="field"><label>${t('Dose in')}</label><input id="c-dose" inputmode="decimal" placeholder="—" value="${esc(withUnit(c.dose,'g'))}"></div>
        <div class="field"><label>${t('Yield out')}</label><input id="c-yield" inputmode="decimal" placeholder="—" value="${esc(withUnit(c.yield,'g'))}"></div>
        <div class="field"><label>${t('Time')}</label><input id="c-time" inputmode="decimal" placeholder="—" value="${esc(withUnit(c.time,'s'))}"></div>
        <div class="field"><label>${t('Temp')}</label><input id="c-temp" inputmode="decimal" placeholder="—" value="${esc(withUnit(c.temp,'°'))}"></div></div>
      <button type="button" class="btn ghost sm" style="margin-top:8px" data-action="close-recipe">${t('Remove recipe')}</button>`
      : `<button type="button" class="btn ghost block" style="margin-top:4px" data-action="open-recipe">${t('+ Add recipe (bean, machine, dose…)')}</button>`)}
      <button class="btn block" style="margin-top:12px" data-action="submit-post">${editing?t('Save changes'):`${icon('bolt',18)} ${t('Post it')}`}</button>
      ${editing?`<button class="btn ghost block" style="margin-top:8px" data-action="close-ov">${t('Cancel')}</button>`:''}
      <div style="height:8px"></div>
    </div></div>`;
}
