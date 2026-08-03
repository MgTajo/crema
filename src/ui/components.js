"use strict";
/* ============================================================
   ui/components — reusable HTML fragment builders.
   Small, composable pieces (avatars, chips, post cards, rows) the
   screen and overlay renderers assemble. They read data through the
   store selectors but never mutate state or touch the DOM directly.
   ============================================================ */
import { esc, fmt, seedOf, initials } from '../core/util.js';
import { MACHINES, MACHINE_BRANDS, BEANS, ADD_BEAN, MY_BEANS, DRINKS, FREE_DRINKS, ADD_DRINK, beanBrands, beansByBrand, flag } from '../data/catalog.js';
import { USERS, handleToUid, CAFES, userOf } from '../data/world.js';
import { state, allPosts, findPost } from '../store/store.js';
import { REACTIONS } from '../data/reactions.js';
import { imageUrl } from '../data/media.js';
import { art } from '../domain/art.js';
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
  return `<div class="avatar ${cls}" style="background:${u.color}">${initials(u.name)}${photo}</div>`;
}
export function cafeThumb(c){return `<div class="cafe-thumb" style="background:${c.color}">${initials(c.name)}</div>`;}

/* brand → model machine picker (used in create, onboarding & settings) */
export function machinePicker(pfx,brand,model){
  const models=(brand&&MACHINES[brand])||[];
  return `<div class="rowfields">
    <div class="field sel"><label>Machine brand</label><select id="${pfx}-mbrand"><option value=""${brand?'':' selected'}>Choose brand…</option>${MACHINE_BRANDS.map(b=>`<option${b===brand?' selected':''}>${esc(b)}</option>`).join('')}</select></div>
    <div class="field sel"><label>Model</label><select id="${pfx}-mmodel"${brand&&brand!=='Other'?'':' disabled'}><option value=""${model?'':' selected'}>${brand&&brand!=='Other'?'Choose model…':'—'}</option>${models.map(m=>`<option${m===model?' selected':''}>${esc(m)}</option>`).join('')}</select></div>
  </div>${brand==='Other'?`<div class="field"><label>Your machine</label><input id="${pfx}-mother" placeholder="e.g. Custom lever setup" value="${esc(model||'')}"></div>`:''}`;
}
/* Brand → coffee bean picker: pick the brand off the shelf first, then
   which of their coffees, same as buying beans in a supermarket (or
   picking a specialty roaster's espresso vs. filter blend). Mirrors
   machinePicker's brand→model shape. Own-bean option gated behind
   Premium; previously-added own coffees get their own brand slot. */
export function beanPicker(pfx,brand,bean){
  const brands=beanBrands();
  const bopt=b=>`<option${b.name===brand?' selected':''}>${esc(b.name)}</option>`;
  const known=brand===MY_BEANS?state.customBeans.map(n=>({n})):(brand&&brand!==ADD_BEAN)?beansByBrand(brand):[];
  /* A coffee that's already on the post but isn't in the list it belongs
     to — an older pour, a café's bean, a name from before the catalogue
     had it — stays on the list anyway. Otherwise reopening that post in
     the sheet shows an empty Coffee field and saving quietly drops what
     it used to say. */
  const beans=(bean&&bean!==ADD_BEAN&&!known.some(b=>b.n===bean))?known.concat({n:bean}):known;
  const copt=b=>`<option value="${esc(b.n)}"${b.n===bean?' selected':''}>${esc(b.n)}</option>`;
  const hasSecond=(!!brand&&brand!==ADD_BEAN)||beans.length>0;
  return `<div class="rowfields">
    <div class="field sel"><label>Brand</label><select id="${pfx}-bbrand">
      <option value=""${brand?'':' selected'}>Not sure / choose…</option>
      <optgroup label="Local · roasted in Germany">${brands.filter(b=>b.loc!=='INT').map(bopt).join('')}</optgroup>
      <optgroup label="International · sold in Germany">${brands.filter(b=>b.loc==='INT').map(bopt).join('')}</optgroup>
      ${state.customBeans.length?`<option value="${esc(MY_BEANS)}"${brand===MY_BEANS?' selected':''}>Your own coffees</option>`:''}
      ${state.me.premium?`<option value="${esc(ADD_BEAN)}"${brand===ADD_BEAN?' selected':''}>${ADD_BEAN}</option>`:''}
    </select></div>
    <div class="field sel"><label>Coffee</label><select id="${pfx}-bean"${hasSecond?'':' disabled'}>
      <option value=""${bean?'':' selected'}>${hasSecond?'Choose…':'—'}</option>
      ${beans.map(copt).join('')}
    </select></div>
  </div>`;
}
/* Drink-type dropdown: the free tier only ever sees the everyday six
   (FREE_DRINKS); Premium unlocks the rest of DRINKS, plus this user's
   own custom ones tacked on the end (state.customDrinks — visible only
   to them, never to anyone else's picker), plus the option to add
   another. Mirrors beanPicker's own-coffee gating, just flat since a
   drink type has no brand step. `allowAdd:false` drops the "add your
   own" sentinel for pickers (onboarding) that don't have a text field
   to catch it. */
export function drinkOptions(current,{allowAdd=true}={}){
  const base=state.me.premium?DRINKS:DRINKS.filter(d=>FREE_DRINKS.includes(d));
  const list=base.concat(state.customDrinks.filter(d=>!base.includes(d)));
  if(current&&current!==ADD_DRINK&&!list.includes(current)) list.push(current);
  return list.map(d=>`<option${d===current?' selected':''}>${esc(d)}</option>`).join('')
    +(allowAdd&&state.me.premium?`<option value="${esc(ADD_DRINK)}"${current===ADD_DRINK?' selected':''}>${ADD_DRINK}</option>`:'');
}
/* ----- follow buttons -----
   A follow has three states since step-1.15: none → requested →
   following. Every follow button in the app renders through here so they
   can't drift apart, and the class names match what paintFollow() in
   ui/actions.js toggles when one is tapped. */
export const followState = uid => state.follows[uid] ? 'following' : state.followPending[uid] ? 'pending' : 'none';
export const followText  = uid => ({following:'Following', pending:'Requested', none:'Follow'})[followState(uid)];
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
  if(r.bean) rows.push(['bean','Coffee',r.bean]);
  if(r.machine) rows.push(['mach','Machine / brewer',r.machine]);
  if(r.milk) rows.push(['h','Milk',r.milk]);
  if(r.dose) rows.push(['h','Dose in',r.dose]);
  if(r.yield) rows.push(['h','Yield out',r.yield]);
  if(r.time) rows.push(['h','Time',r.time]);
  if(r.temp) rows.push(['h','Temp',r.temp]);
  return rows;
}
export function recipePanel(r){
  const rows=recipeRows(r); if(!rows.length) return '';
  return `<div class="recipe-grid">${rows.map(x=>x[0]==='bean'?`<div class="recipe-bean"><span class="g">${icon('bean',18)}</span><div><span>${x[1]}</span><b>${esc(x[2])}</b></div></div>`:x[0]==='mach'?`<div class="recipe-mach"><span>${x[1]}</span><b>${esc(x[2])}</b></div>`:`<div><span>${x[1]}</span><b>${esc(x[2])}</b></div>`).join('')}</div>`;
}
export const recipeBtnLabel=r=>(r.dose&&r.yield)?`Recipe · ${r.dose} in → ${r.yield} out`:'Recipe';

/* Remote posts carry a comment count from the feed query and load the
   thread only when opened, so prefer the count when we have one. */
export const commentCount = p => (p.commentN!=null ? p.commentN : p.comments.length);

/* Your own pour shows its like count but cannot be liked. The server
   refuses a self-like too (step-1.10.sql) — this only keeps the UI from
   offering something that would be rejected. */
export function likeButton(p,size=22){
  if(p.user==='me') return `<div class="act like own" title="Your own pour">${icon('heart',size)} <span class="cnt">${fmt(p.likes)}</span></div>`;
  return `<button class="act like ${p.likedByMe?'liked':''}" data-action="like" data-id="${p.id}" aria-label="Like">${icon(p.likedByMe?'heartF':'heart',size)} <span class="cnt">${fmt(p.likes)}</span></button>`;
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
    const inner=`<i>${icon(ic,14)}</i>${label}${c?`<span>${fmt(c)}</span>`:''}`;
    return own
      ? `<div class="react own" title="${esc(hint)}">${inner}</div>`
      : `<button class="react${on?' on':''}" data-action="react" data-id="${p.id}" data-k="${k}"
           title="${esc(hint)}" aria-pressed="${on}" aria-label="${esc(hint)}">${inner}</button>`;
  }).join('');
  return `<div class="reacts" data-reacts="${p.id}">${cells}</div>`;
}

/* An edited pour says so — in the timestamp line, in the same dimmed
   type as the rest of it. Honest, and quiet enough that nobody has to
   feel watched for fixing a typo. */
export const editedMark = p => p.edited ? ' · <span class="edited">edited</span>' : '';

/* A followers-only pour says so, to its author. Nobody else can see one
   in the first place (RLS, step-1.15), so this is not a warning — it's a
   reminder of a choice you made, in the same dimmed type as the rest of
   the line. */
export const privateMark = p => p.visibility==='followers'
  ? ' · <span class="edited" title="Only people who follow you can see this">🔒 followers</span>' : '';

export function postCard(p){
  const u=userOf(p.user), following=p.user==='me'||state.follows[p.user], r=p.recipe, top=p.comments[0];
  const rows=recipeRows(r), cn=commentCount(p);
  return `<div class="card" data-post="${p.id}">
    <div class="p-head">
      <div class="idwrap" data-action="open-user" data-id="${p.user}">${avatar(p.user)}
        <div class="who"><b>${esc(u.name)} <span class="lvlchip">Lv${u.level}</span></b><span>${esc(u.handle)}${p.cafe?` · at ${p.cafe}`:''} · ${p.ago}${editedMark(p)}${privateMark(p)}</span></div></div>
      ${p.user==='me'?'':followMini(p.user)}
      <button class="kebab" data-action="open-menu" data-id="${p.id}" aria-label="More options">⋯</button></div>
    <div class="media" data-action="open-post" data-id="${p.id}">
      ${art(imageUrl(p.img,'feed'),p.pattern,p.quality,seedOf(p.id),p.drink)}
      <div class="heartpop" id="hp-${p.id}">${icon('heartF',90)}</div></div>
    <div class="p-act">
      ${likeButton(p)}
      <button class="act" data-action="open-post" data-id="${p.id}" aria-label="Comments">${icon('chat',22)} ${cn}</button>
      <button class="act" data-action="share-post" data-id="${p.id}" aria-label="Share">${icon('share',20)}</button>
      <div class="grow"></div>
      <button class="act save ${p.saved?'saved':''}" data-action="save" data-id="${p.id}" aria-label="Save">${icon(p.saved?'saveF':'save',22)}</button></div>
    ${reactionBar(p)}
    <div class="p-body">
      <div class="cap"><b>${esc(u.name)}</b> ${mentionify(p.caption)}</div>
      <div class="chips">
        <span class="chip drinkchip">${esc(p.drink||'Coffee')}</span>
        ${p.art&&p.pattern?`<span class="chip tag" data-action="open-tag" data-id="${p.pattern}">#${p.pattern}</span>`:''}
        ${r&&r.milk?`<span class="chip"><span class="g">${icon('milk',12)}</span>${esc(r.milk)}</span>`:''}
        ${r&&r.machine?`<span class="chip"><span class="g">${icon('mach',12)}</span>${esc(r.machine)}</span>`:''}
        ${p.cafe?`<span class="chip"><span class="g">${icon('cafe',12)}</span>${esc(p.cafe)}</span>`:''}
      </div>
      ${rows.length?`<button class="recipe-btn" data-action="recipe" data-id="${p.id}">☕ ${recipeBtnLabel(r)} ▾</button>
      <div class="recipe-panel" id="rp-${p.id}">${recipePanel(r)}
        <div style="padding:9px 12px;background:var(--surface)"><button class="btn ghost sm" data-action="brew" data-id="${p.id}">☕ Brew this recipe</button></div></div>`:''}
      ${top?`<div class="cmt-preview">${cn>1?`<span class="more" data-action="open-post" data-id="${p.id}">View all ${cn} comments</span>`:''}<div class="one"><b>${esc(userOf(top.u).name.split(' ')[0])}</b> ${mentionify(top.t)}</div></div>`:''}
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
  let h=`<div class="section-h" style="margin-top:10px"><h2>Results for “${esc(q)}”</h2><a data-action="clear-search">Clear</a></div>`;
  if(users.length) h+=`<div class="rlist" style="margin-bottom:14px">${users.map(u=>`<div class="rlist-row click" data-action="open-user" data-id="${u.id}">${avatar(u.id)}
    <div class="who" style="flex:1"><b>${esc(u.name)}</b><span>${esc(u.handle)}${u.city?' · '+esc(u.city):''}</span></div><span class="lvlchip">Lv${u.level}</span></div>`).join('')}</div>`;
  if(beans.length||cbeans.length) h+=`<div class="chips" style="margin-bottom:14px">${beans.map(b=>`<span class="chip tag" data-action="open-bean" data-id="${esc(b.n)}">${flag[b.c]||'🫘'} ${b.n}</span>`).join('')}${cbeans.map(n=>`<span class="chip">🫘 ${esc(n)} <small style="color:var(--muted)">yours</small></span>`).join('')}</div>`;
  if(cafes.length) h+=cafes.map(cafeCard).join('');
  if(posts.length) h+=`<div class="grid" style="margin-bottom:14px">${posts.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`;
  if(!users.length&&!beans.length&&!cbeans.length&&!cafes.length&&!posts.length) h+=`<div class="empty"><div class="big">🔍</div>No matches for “${esc(q)}”.<br>Try a name, bean, café or drink.</div>`;
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
  const line=(p.caption||'').trim()||p.drink||'Coffee';
  const place=p.place|0;
  const medal=place===1?'🥇':place===2?'🥈':place===3?'🥉':place;
  return `<div class="rlist-row click ${p.user==='me'?'me':''}" data-action="open-post" data-id="${p.id}">
  <div class="pod-rank top">${medal}</div>
  <div class="pod-thumb">${art(imageUrl(p.img,'thumb'),p.pattern,p.quality,seedOf(p.id),p.drink)}</div>
  <div class="who" style="flex:1;min-width:0"><b>${esc(u.name)}${p.user==='me'?' (you)':''}</b>
    <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(line)}</span></div>
  <div class="rlist-val" style="text-align:right">${icon('heartF',13)} ${fmt(p.likes)}${p.commentN?`<br><span style="font-size:11px;font-weight:600;color:var(--muted)">${icon('chat',11)} ${fmt(p.commentN)}</span>`:''}</div></div>`;}

export function cafeCard(c){
  return `<div class="cafe-card" data-action="open-cafe" data-id="${c.id}">${cafeThumb(c)}
    <div class="info"><b>${c.name}</b><div class="meta">${c.spec} · ${c.area}</div>
      <div class="row2"><span class="star">★ ${c.rating}</span><span style="font-size:12px;color:var(--muted)">${fmt(c.followers)} followers</span>${c.promo?`<span class="promo">10% off · show post</span>`:''}</div></div>
    <div class="aod" title="Latte art of the day">${art(c.img,'rosetta',.9,seedOf(c.id))}</div></div>`;
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
      <div class="meta"><span>${c.ago||'now'}</span><span data-action="cmt-reply" data-handle="${u.handle||''}">Reply</span></div></div>
    <button class="clike ${c.likedByMe?'on':''}" data-action="cmt-like" data-pid="${pid}" data-idx="${idx}" data-cid="${c.id||''}" aria-label="Like comment">${icon(c.likedByMe?'heartF':'heart',15)}<span>${c.likes||''}</span></button></div>`;
}
