"use strict";
/* ============================================================
   ui/components — reusable HTML fragment builders.
   Small, composable pieces (avatars, chips, post cards, rows) the
   screen and overlay renderers assemble. They read data through the
   store selectors but never mutate state or touch the DOM directly.
   ============================================================ */
import { esc, fmt, seedOf, initials } from '../core/util.js';
import { BEANS, ADD_DRINK, DRINKS, beanCatalog, combineMachine, flag } from '../data/catalog.js';
import { USERS, handleToUid, CAFES, userOf } from '../data/world.js';
import { state, allPosts, findPost } from '../store/store.js';
import { REACTIONS } from '../data/reactions.js';
import { imageUrl } from '../data/media.js';
import { art, artSet } from '../domain/art.js';
import { t, tn } from '../i18n.js';
import { icon } from './icons.js';

/* @handles become links to the person named, when we know who that is.
   Case-insensitive on purpose: handles are stored lowercase, but nobody
   types a name that way, and a mention that fails to link because it was
   capitalised is a mention that looks broken. An unknown handle stays
   plain text — see fetchProfilesByHandles() for how a comment thread
   turns its unknowns into knowns. */
export function mentionify(t){
  return esc(t).replace(/@([A-Za-z0-9_.]+)/g,(m,h)=>{
    const uid=handleToUid[h]||handleToUid[h.toLowerCase()];
    return uid?`<span class="mention" data-action="open-user" data-id="${uid}">${m}</span>`:m;
  });
}

/* A photo if they picked one, initials on their generated colour if they
   didn't. The initials are always in the markup and the photo sits on top
   of them, so they show through while it loads and come back on their own
   if it 404s — a deleted R2 object degrades to the old avatar rather than
   to an empty circle.

   Deliberately NOT loading="lazy": the app scrolls inside its own
   container rather than the document, and the browser's lazy heuristic
   never considers these visible — a lazy avatar sitting in the middle of
   the feed simply never loads. They're 240px thumbs, so eager is cheap
   and, unlike lazy, it works. */
export function avatar(uid,cls=''){
  const u=USERS[uid]||{name:'☕',color:'var(--crema)'};
  const photo=u.avatar
    ? `<img src="${esc(imageUrl(u.avatar,'thumb'))}" alt="" onerror="this.remove()">`
    : '';
  /* The gold ring rides on the face rather than sitting beside the name,
     because it has to survive every context an avatar appears in — a
     26px stacked face on the today strip has no room for a chip. It
     travels with the author embed (see rowToUser), so it is drawn from
     the same row everything else about them comes from and never needs
     its own lookup. */
  const ring=u.premium?' prem':'';
  return `<div class="avatar ${cls}${ring}" style="background:${u.color}">${initials(u.name)}${photo}</div>`;
}
export function cafeThumb(c){return `<div class="cafe-thumb" style="background:${c.color}">${initials(c.name)}</div>`;}

/* ----- catalogue fields -----
   A machine and a coffee are both "one row out of a list nobody can
   finish writing", so both are the same control: a field that shows what
   is chosen and opens a searchable sheet (overlayPicker) when tapped.

   It replaced two chained <select>s each. The old shape asked you to
   know the brand before the thing — that Silvia is a Rancilio, that
   Bellarom is Lidl's — and then to scroll 45 brands on a phone wheel to
   say so. `pfx` is which form is asking ('c' create, 'sp' settings,
   'ob' onboarding); the sheet writes its answer straight back there. */
function pickerField(pfx,kind,label,value,sub,ph){
  const has=!!(value||'').trim();
  return `<div class="field">
    <label>${label}</label>
    <button type="button" class="pickfield${has?' has':''}" data-action="open-picker" data-kind="${kind}" data-pfx="${pfx}">
      <span class="pf-v">${has?esc(value):esc(ph)}${has&&sub?`<small>${esc(sub)}</small>`:''}</span>
      <span class="pf-go">${has?t('Change'):t('Search')}</span>
    </button></div>`;
}
/* Machine picker (used in create, onboarding & settings). Brand and
   model are still stored apart — combineMachine/splitMachine are
   unchanged — the two are simply chosen in one step now. */
export function machinePicker(pfx,brand,model){
  const label=combineMachine(brand,model);
  return pickerField(pfx,'machine',t('Machine / brewer'),label,
    brand==='Other'&&label?t('Your own'):'', t('Search machines & brewers…'));
}
/* Coffee picker. Takes just the name: the roaster is looked up from the
   catalogue for the subtitle rather than being a second thing to pick,
   and a coffee you added yourself simply has no roaster to show. */
export function beanPicker(pfx,bean){
  const cat=bean&&beanCatalog(bean);
  return pickerField(pfx,'bean',t('Coffee / beans'),bean,
    cat?cat.roaster:(bean?t('Your own coffee'):''), t('Search coffees, or add yours…'));
}
/* Drink-type dropdown. Every drink in DRINKS is free — sixteen names is
   a list, not a catalogue, and gating it made people log the wrong
   coffee. What stays Premium is naming one of your own
   (state.customDrinks — visible only to them, never to anyone else's
   picker). `allowAdd:false` drops that sentinel for pickers
   (onboarding) that have no text field to catch it. */
export function drinkOptions(current,{allowAdd=true}={}){
  const base=DRINKS;
  const list=base.concat(state.customDrinks.filter(d=>!base.includes(d)));
  if(current&&current!==ADD_DRINK&&!list.includes(current)) list.push(current);
  return list.map(d=>`<option${d===current?' selected':''}>${esc(d)}</option>`).join('')
    +(allowAdd&&state.me.premium?`<option value="${esc(ADD_DRINK)}"${current===ADD_DRINK?' selected':''}>${ADD_DRINK}</option>`:'');
}
/* ----- Premium, wherever it is met -----
   Every locked thing says the same two things in the same shape: what
   Premium would give you here, and that it currently costs nothing but
   a code. A lock that only said "Premium" would read as a wall, and
   someone who walks away from a wall never finds out that the door is
   open and that asking takes one line of email.

   Tapping raises the offer sheet with the thing they just reached for
   named at the top of it — not Settings. Sending someone off to find a
   screen is how an offer gets lost between the tap and the arrival. */
export function premiumNote(what){
  if(state.me.premium) return '';
  return `<div class="pnote" data-action="open-premium" data-f="${esc(what)}">
    <span class="pn-lock">🔒</span>
    <span>${t('<b>{what}</b> is Premium — <u>free right now, with a code</u>.',{what:esc(what)})}</span></div>`;
}

/* ----- follow buttons -----
   A follow has three states since step-1.15: none → requested →
   following. Every follow button in the app renders through here so they
   can't drift apart, and the class names match what paintFollow() in
   ui/actions.js toggles when one is tapped. */
export const followState = uid => state.follows[uid] ? 'following' : state.followPending[uid] ? 'pending' : 'none';
export const followText  = uid => ({following:t('Following'), pending:t('Requested'), none:t('Follow')})[followState(uid)];
export function followMini(uid){
  const s=followState(uid);
  return `<button class="followmini ${s!=='none'?'on':''} ${s==='pending'?'pending':''}" data-action="follow" data-id="${uid}">${followText(uid)}</button>`;
}
export function followBtn(uid, cls='sm', style=''){
  const s=followState(uid), on=s!=='none';
  return `<button class="btn ${cls} ${on?'ghost on':''} ${s==='pending'?'pending':''}"${style?` style="${style}"`:''} data-action="follow" data-id="${uid}">${followText(uid)}</button>`;
}

export const postLink=id=>location.href.split('#')[0]+'#p/'+id;

/* Challenge participation, straight from challenge_joins. Zero is a real
   number here, and reads better as an invitation than as "0 joined". */

/* ----- recipe helpers (no fabricated defaults) ----- */
export function recipeRows(r){
  if(!r) return [];
  const rows=[];
  if(r.bean) rows.push(['bean',t('Coffee'),r.bean]);
  if(r.machine) rows.push(['mach',t('Machine / brewer'),r.machine]);
  if(r.milk) rows.push(['h',t('Milk'),r.milk]);
  if(r.dose) rows.push(['h',t('Dose in'),r.dose]);
  if(r.yield) rows.push(['h',t('Yield out'),r.yield]);
  if(r.time) rows.push(['h',t('Time'),r.time]);
  if(r.temp) rows.push(['h',t('Temp'),r.temp]);
  return rows;
}
/* The coffee and the machine are the two rows worth tapping: both have
   a page behind them now, and someone reading a stranger's recipe is
   exactly the person who doesn't know what a Silvano Evo is. Everything
   else on the grid is a number and stays inert. */
export function recipePanel(r){
  const rows=recipeRows(r); if(!rows.length) return '';
  return `<div class="recipe-grid">${rows.map(x=>x[0]==='bean'
    ?`<div class="recipe-bean click" data-action="open-bean" data-id="${esc(x[2])}"><span class="g">${icon('bean',18)}</span><div><span>${x[1]}</span><b>${esc(x[2])}</b></div></div>`
    :x[0]==='mach'
    ?`<div class="recipe-mach click" data-action="open-machine" data-id="${esc(x[2])}"><span>${x[1]}</span><b>${esc(x[2])}</b></div>`
    :`<div><span>${x[1]}</span><b>${esc(x[2])}</b></div>`).join('')}</div>`;
}
export const recipeBtnLabel=r=>(r.dose&&r.yield)?t('Recipe · {a} in → {b} out',{a:r.dose,b:r.yield}):t('Recipe');

/* Remote posts carry a comment count from the feed query and load the
   thread only when opened, so prefer the count when we have one. */
export const commentCount = p => (p.commentN!=null ? p.commentN : p.comments.length);

/* Your own pour shows its like count but cannot be liked. The server
   refuses a self-like too (step-1.10.sql) — this only keeps the UI from
   offering something that would be rejected. */
export function likeButton(p,size=22){
  if(p.user==='me') return `<div class="act like own" title="${t('Your own pour')}">${icon('heart',size)} <span class="cnt">${fmt(p.likes)}</span></div>`;
  return `<button class="act like ${p.likedByMe?'liked':''}" data-action="like" data-id="${p.id}" aria-label="${t('Like')}">${icon(p.likedByMe?'heartF':'heart',size)} <span class="cnt">${fmt(p.likes)}</span></button>`;
}

/* ----- reactions -----
   Three compliments — "Nice pour", "Nice spot", "Nice pick" — next to
   the heart but never part of it. A like is the app's currency: it moves
   points and it decides the podium. A reaction is a sentence you didn't
   have to type and is worth nothing anywhere — no points, no podium, no
   level. Both can be true of one pour at once, which is why this is a
   second row rather than a replacement for the first.

   Your own pour shows the tally without the buttons, exactly as the like
   count does. The counts mean "other people said so", and the database
   refuses a self-reaction anyway (platform/supabase/step-1.19.sql). */
export function reactionBar(p){
  const mine=p.myReactions||[], n=p.reactions||{}, own=p.user==='me';
  const cells=REACTIONS.map(([k,ic,label,hint])=>{
    const c=n[k]|0, on=mine.indexOf(k)>=0;
    const inner=`<i>${icon(ic,14)}</i>${t(label)}${c?`<span>${fmt(c)}</span>`:''}`;
    return own
      ? `<div class="react own" title="${esc(t(hint))}">${inner}</div>`
      : `<button class="react${on?' on':''}" data-action="react" data-id="${p.id}" data-k="${k}"
           title="${esc(t(hint))}" aria-pressed="${on}" aria-label="${esc(t(hint))}">${inner}</button>`;
  }).join('');
  return `<div class="reacts" data-reacts="${p.id}">${cells}</div>`;
}

/* An edited pour says so — in the timestamp line, in the same dimmed
   type as the rest of it. Honest, and quiet enough that nobody has to
   feel watched for fixing a typo. */
export const editedMark = p => p.edited ? ` · <span class="edited">${t('edited')}</span>` : '';

/* A followers-only pour says so, to its author. Nobody else can see one
   in the first place (RLS, step-1.15), so this is not a warning — it's a
   reminder of a choice you made, in the same dimmed type as the rest of
   the line. */
export const privateMark = p => p.visibility==='followers'
  ? ` · <span class="edited" title="${t('Only people who follow you can see this')}">🔒 ${t('followers')}</span>` : '';

/* A pour a moderator has hidden. RLS hands the row to nobody but its
   author and an admin, so this line is only ever read by someone who is
   entitled to know — and the author has already been told why, in
   words, in their inbox. Without it the pour would sit in their profile
   looking exactly as it always did, which would make the notice they
   received look like it did nothing. */
export const hiddenMark = p => p.hidden
  ? ` · <span class="edited" title="${t('Hidden after a report. Check your notifications.')}">🚫 ${t('hidden')}</span>` : '';

export function postCard(p){
  const u=userOf(p.user), following=p.user==='me'||state.follows[p.user], r=p.recipe, top=p.comments[0];
  const rows=recipeRows(r), cn=commentCount(p);
  return `<div class="card" data-post="${p.id}">
    <div class="p-head">
      <div class="idwrap" data-action="open-user" data-id="${p.user}">${avatar(p.user)}
        <div class="who"><b>${esc(u.name)} <span class="lvlchip">Lv${u.level}</span></b><span>${esc(u.handle)}${p.cafe?` · ${t('at')} ${p.cafe}`:''} · ${p.ago}${editedMark(p)}${privateMark(p)}${hiddenMark(p)}</span></div></div>
      ${p.user==='me'?'':followMini(p.user)}
      <button class="kebab" data-action="open-menu" data-id="${p.id}" aria-label="${t('More options')}">⋯</button></div>
    <div class="media" data-action="open-post" data-id="${p.id}" data-media="${p.id}">
      ${artSet((p.imgs&&p.imgs.length?p.imgs:[p.img]).map(k=>imageUrl(k,'feed')),p.pattern,p.quality,seedOf(p.id),p.drink)}
      <div class="heartpop" data-hp="${p.id}">${icon('heartF',90)}</div></div>
    <div class="p-act">
      ${likeButton(p)}
      <button class="act" data-action="open-post" data-id="${p.id}" aria-label="${t('Comments')}">${icon('chat',22)} <span class="cnt" data-cmtn="${p.id}">${cn}</span></button>
      <button class="act" data-action="share-post" data-id="${p.id}" aria-label="${t('Share')}">${icon('share',20)}</button>
      <div class="grow"></div>
      <button class="act save ${p.saved?'saved':''}" data-action="save" data-id="${p.id}" aria-label="${t('Save')}">${icon(p.saved?'saveF':'save',22)}</button></div>
    ${reactionBar(p)}
    <div class="p-body">
      <div class="cap"><b>${esc(u.name)}</b> ${mentionify(p.caption)}</div>
      <div class="chips">
        <span class="chip drinkchip">${esc(p.drink||t('Coffee'))}</span>
        ${p.art&&p.pattern?`<span class="chip tag" data-action="open-tag" data-id="${p.pattern}">#${p.pattern}</span>`:''}
        ${r&&r.milk?`<span class="chip"><span class="g">${icon('milk',12)}</span>${esc(r.milk)}</span>`:''}
        ${r&&r.machine?`<span class="chip tag" data-action="open-machine" data-id="${esc(r.machine)}"><span class="g">${icon('mach',12)}</span>${esc(r.machine)}</span>`:''}
        ${p.cafe?`<span class="chip"><span class="g">${icon('cafe',12)}</span>${esc(p.cafe)}</span>`:''}
      </div>
      ${rows.length?`<button class="recipe-btn" data-action="recipe" data-id="${p.id}">☕ ${recipeBtnLabel(r)} ▾</button>
      <div class="recipe-panel" id="rp-${p.id}">${recipePanel(r)}
        <div style="padding:9px 12px;background:var(--surface)"><button class="btn ghost sm" data-action="brew" data-id="${p.id}">☕ ${t('Brew this recipe')}</button></div></div>`:''}
      ${top?`<div class="cmt-preview">${cn>1?`<span class="more" data-action="open-post" data-id="${p.id}">${t('View all {n} comments',{n:cn})}</span>`:''}<div class="one"><b>${esc(userOf(top.u).name.split(' ')[0])}</b> ${mentionify(top.t)}</div></div>`:''}
    </div></div>`;
}

/* ----- search ----- */
export function searchHTML(q){
  const ql=q.trim().toLowerCase(); if(!ql) return '';
  const users=Object.values(USERS).filter(u=>u.id!=='me'&&(u.name+' '+u.handle+' '+u.city).toLowerCase().includes(ql));
  const beans=BEANS.filter(b=>(b.n+' '+b.c+' '+b.notes.join(' ')).toLowerCase().includes(ql));
  const cbeans=state.customBeans.filter(n=>n.toLowerCase().includes(ql));
  const cafes=CAFES.filter(c=>(c.name+' '+c.area+' '+c.spec).toLowerCase().includes(ql));
  const posts=allPosts().filter(p=>((p.caption||'')+' '+(p.drink||'')+' '+(p.pattern||'')+' '+((p.recipe&&p.recipe.bean)||'')).toLowerCase().includes(ql));
  let h=`<div class="section-h" style="margin-top:10px"><h2>${t('Results for “{q}”',{q:esc(q)})}</h2><a data-action="clear-search">${t('Clear')}</a></div>`;
  if(users.length) h+=`<div class="rlist" style="margin-bottom:14px">${users.map(u=>`<div class="rlist-row click" data-action="open-user" data-id="${u.id}">${avatar(u.id)}
    <div class="who" style="flex:1"><b>${esc(u.name)}</b><span>${esc(u.handle)}${u.city?' · '+esc(u.city):''}</span></div><span class="lvlchip">Lv${u.level}</span></div>`).join('')}</div>`;
  if(beans.length||cbeans.length) h+=`<div class="chips" style="margin-bottom:14px">${beans.map(b=>`<span class="chip tag" data-action="open-bean" data-id="${esc(b.n)}">${flag[b.c]||'🫘'} ${b.n}</span>`).join('')}${cbeans.map(n=>`<span class="chip">🫘 ${esc(n)} <small style="color:var(--muted)">${t('yours')}</small></span>`).join('')}</div>`;
  if(cafes.length) h+=cafes.map(cafeCard).join('');
  if(posts.length) h+=`<div class="grid" style="margin-bottom:14px">${posts.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`;
  if(!users.length&&!beans.length&&!cbeans.length&&!cafes.length&&!posts.length) h+=`<div class="empty"><div class="big">🔍</div>${t('No matches for “{q}”.',{q:esc(q)})}<br>${t('Try a name, a bean, a café or a drink.')}</div>`;
  return h;
}

/* A podium row is one of today's three most-engaged pours — tapping it
   opens the post, not the person.

   The medal comes from `p.place`, which Postgres decided and already told
   the author about in a notification, rather than from this row's position
   in the array. Blocking someone can leave a gap in what you personally
   see, and a silver medal must not turn into a gold one just because the
   pour above it is hidden from you.

   `.rlist-row` is the shared row-list style (follower lists, search
   results, the scoring table, the bean passport all use it); only the
   medal and the pour thumbnail are the podium's own.

   The place is decided by likes AND comments (step-1.18.sql, weighted the
   way POINT_RULES already weights them), so the row shows both counts —
   otherwise a pour with fewer hearts outranking one with more looks like
   a bug instead of the comments it earned. */
export function podiumRow(p){
  if(!p) return '';
  const u=userOf(p.user);
  const line=(p.caption||'').trim()||p.drink||t('Coffee');
  const place=p.place|0;
  const medal=place===1?'🥇':place===2?'🥈':place===3?'🥉':place;
  return `<div class="rlist-row click ${p.user==='me'?'me':''}" data-action="open-post" data-id="${p.id}">
  <div class="pod-rank top">${medal}</div>
  <div class="pod-thumb">${art(imageUrl(p.img,'thumb'),p.pattern,p.quality,seedOf(p.id),p.drink)}</div>
  <div class="who" style="flex:1;min-width:0"><b>${esc(u.name)}${p.user==='me'?' '+t('(you)'):''}</b>
    <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(line)}</span></div>
  <div class="rlist-val" style="text-align:right">${icon('heartF',13)} ${fmt(p.likes)}${p.commentN?`<br><span style="font-size:11px;font-weight:600;color:var(--muted)">${icon('chat',11)} ${fmt(p.commentN)}</span>`:''}</div></div>`;}

export function cafeCard(c){
  return `<div class="cafe-card" data-action="open-cafe" data-id="${c.id}">${cafeThumb(c)}
    <div class="info"><b>${c.name}</b><div class="meta">${c.spec} · ${c.area}</div>
      <div class="row2"><span class="star">★ ${c.rating}</span><span style="font-size:12px;color:var(--muted)">${t('{n} followers',{n:fmt(c.followers)})}</span>${c.promo?`<span class="promo">${t('10% off · show post')}</span>`:''}</div></div>
    <div class="aod" title="${t('Latte art of the day')}">${art(c.img,'rosetta',.9,seedOf(c.id))}</div></div>`;
}

export function gcell(pat,q,id,img){
  const p=findPost(id);
  return `<div class="gcell" data-action="open-post" data-id="${id}">${art(imageUrl(img,'thumb'),pat,q,seedOf(id),p?p.drink:'coffee')}</div>`;
}

export function sbar(l,v){return `<div class="sbar"><div class="l"><span>${l}</span><b>${v}</b></div><div class="track"><i style="width:${v*10}%"></i></div></div>`;}
export function commentRow(c,pid,idx){
  const u=c.u==='me'?USERS.me:userOf(c.u);
  return `<div class="cmt">${avatar(c.u)}
    <div class="cbody"><div class="t"><b data-action="open-user" data-id="${c.u||''}">${u.name}</b> ${mentionify(c.t)}</div>
      <div class="meta"><span>${c.ago||t('now')}</span><span data-action="cmt-reply" data-handle="${u.handle||''}">${t('Reply')}</span></div></div>
    <button class="clike ${c.likedByMe?'on':''}" data-action="cmt-like" data-pid="${pid}" data-idx="${idx}" data-cid="${c.id||''}" aria-label="${t('Like comment')}">${icon(c.likedByMe?'heartF':'heart',15)}<span>${c.likes||''}</span></button></div>`;
}
