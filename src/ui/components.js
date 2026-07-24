"use strict";
/* ============================================================
   ui/components — reusable HTML fragment builders.
   Small, composable pieces (avatars, chips, post cards, rows) the
   screen and overlay renderers assemble. They read data through the
   store selectors but never mutate state or touch the DOM directly.
   ============================================================ */
import { esc, fmt, seedOf, initials } from '../core/util.js';
import { MACHINES, MACHINE_BRANDS, BEANS, ADD_BEAN, flag } from '../data/catalog.js';
import { USERS, handleToUid, CAFES } from '../data/seed.js';
import { state, allPosts, findPost } from '../store/store.js';
import { art } from '../domain/art.js';
import { icon } from './icons.js';

export function mentionify(t){return esc(t).replace(/@([A-Za-z0-9_.]+)/g,(m,h)=>handleToUid[h]?`<span class="mention" data-action="open-user" data-id="${handleToUid[h]}">${m}</span>`:m);}

export function avatar(uid,cls=''){const u=USERS[uid]||{name:'☕',color:'var(--crema)'}; return `<div class="avatar ${cls}" style="background:${u.color}">${initials(u.name)}</div>`;}
export function cafeThumb(c){return `<div class="cafe-thumb" style="background:${c.color}">${initials(c.name)}</div>`;}

/* brand → model machine picker (used in create, onboarding & settings) */
export function machinePicker(pfx,brand,model){
  const models=(brand&&MACHINES[brand])||[];
  return `<div class="rowfields">
    <div class="field sel"><label>Machine brand</label><select id="${pfx}-mbrand"><option value=""${brand?'':' selected'}>Choose brand…</option>${MACHINE_BRANDS.map(b=>`<option${b===brand?' selected':''}>${esc(b)}</option>`).join('')}</select></div>
    <div class="field sel"><label>Model</label><select id="${pfx}-mmodel"${brand&&brand!=='Other'?'':' disabled'}><option value=""${model?'':' selected'}>${brand&&brand!=='Other'?'Choose model…':'—'}</option>${models.map(m=>`<option${m===model?' selected':''}>${esc(m)}</option>`).join('')}</select></div>
  </div>${brand==='Other'?`<div class="field"><label>Your machine</label><input id="${pfx}-mother" placeholder="e.g. Custom lever setup" value="${esc(model||'')}"></div>`:''}`;
}
/* branded-coffee <select>, grouped local/international; own-bean option gated behind Premium */
export function beanSelectHTML(cur){
  const opt=b=>`<option value="${esc(b.n)}"${b.n===cur?' selected':''}>${esc(b.roaster)} — ${esc(b.n)}</option>`;
  let h=`<option value=""${cur?'':' selected'}>Not sure / choose…</option>`;
  h+=`<optgroup label="Local · roasted in Germany">${BEANS.filter(b=>b.loc!=='INT').map(opt).join('')}</optgroup>`;
  h+=`<optgroup label="International · sold in Germany">${BEANS.filter(b=>b.loc==='INT').map(opt).join('')}</optgroup>`;
  if(state.customBeans.length) h+=`<optgroup label="Your coffees">${state.customBeans.map(n=>`<option${n===cur?' selected':''}>${esc(n)}</option>`).join('')}</optgroup>`;
  if(state.me.premium) h+=`<option${cur===ADD_BEAN?' selected':''}>${ADD_BEAN}</option>`;
  return h;
}
export const postLink=id=>location.href.split('#')[0]+'#p/'+id;

/* ----- recipe helpers (no fabricated defaults) ----- */
export function recipeRows(r){
  if(!r) return [];
  const rows=[]; const bean=[r.bean,r.roaster].filter(Boolean).join(' · ');
  if(bean) rows.push(['bean','Bean',bean]);
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
  return `<div class="recipe-grid">${rows.map(x=>x[0]==='bean'?`<div class="recipe-bean">🫘 <div><span>${x[1]}</span><b>${esc(x[2])}</b></div></div>`:x[0]==='mach'?`<div class="recipe-mach"><span>${x[1]}</span><b>${esc(x[2])}</b></div>`:`<div><span>${x[1]}</span><b>${esc(x[2])}</b></div>`).join('')}</div>`;
}
export const recipeBtnLabel=r=>(r.dose&&r.yield)?`Recipe · ${r.dose} in → ${r.yield} out`:'Recipe';

export function postCard(p){
  const u=USERS[p.user], following=p.user==='me'||state.follows[p.user], r=p.recipe, top=p.comments[0];
  const rows=recipeRows(r);
  return `<div class="card" data-post="${p.id}">
    <div class="p-head">
      <div class="idwrap" data-action="open-user" data-id="${p.user}">${avatar(p.user)}
        <div class="who"><b>${u.name} <span class="lvlchip">Lv${u.level}</span></b><span>${u.handle}${p.cafe?` · at ${p.cafe}`:''} · ${p.ago}</span></div></div>
      ${p.user==='me'?'':`<button class="followmini ${following?'on':''}" data-action="follow" data-id="${p.user}">${following?'Following':'Follow'}</button>`}
      <button class="kebab" data-action="open-menu" data-id="${p.id}" aria-label="More options">⋯</button></div>
    <div class="media" data-action="open-post" data-id="${p.id}">
      ${art(p.img,p.pattern,p.quality,seedOf(p.id),p.drink)}
      <div class="heartpop" id="hp-${p.id}">${icon('heartF',90)}</div></div>
    <div class="p-act">
      <button class="act like ${p.likedByMe?'liked':''}" data-action="like" data-id="${p.id}" aria-label="Like">${icon(p.likedByMe?'heartF':'heart',22)} <span class="cnt">${fmt(p.likes)}</span></button>
      <button class="act" data-action="open-post" data-id="${p.id}" aria-label="Comments">${icon('chat',22)} ${p.comments.length}</button>
      <button class="act" data-action="share-post" data-id="${p.id}" aria-label="Share">${icon('send',20)}</button>
      <div class="grow"></div>
      <button class="act save ${p.saved?'saved':''}" data-action="save" data-id="${p.id}" aria-label="Save">${icon(p.saved?'saveF':'save',22)}</button></div>
    <div class="p-body">
      <div class="cap"><b>${u.name}</b> ${mentionify(p.caption)}</div>
      <div class="chips">
        <span class="chip drinkchip">${esc(p.drink||'Coffee')}</span>
        ${p.art?`<span class="chip tag" data-action="open-tag" data-id="${p.pattern}">#${p.pattern}</span>`:''}
        ${r&&r.milk?`<span class="chip">🥛 ${esc(r.milk)}</span>`:''}
        ${r&&r.machine?`<span class="chip"><span class="g">${icon('mach',12)}</span>${esc(r.machine)}</span>`:''}
        ${p.cafe?`<span class="chip">📍 ${esc(p.cafe)}</span>`:''}
      </div>
      ${rows.length?`<button class="recipe-btn" data-action="recipe" data-id="${p.id}">☕ ${recipeBtnLabel(r)} ▾</button>
      <div class="recipe-panel" id="rp-${p.id}">${recipePanel(r)}
        <div style="padding:9px 12px;background:var(--surface)"><button class="btn ghost sm" data-action="brew" data-id="${p.id}">☕ Brew this recipe</button></div></div>`:''}
      ${p.comments.length?`<div class="cmt-preview">${p.comments.length>1?`<span class="more" data-action="open-post" data-id="${p.id}">View all ${p.comments.length} comments</span>`:''}<div class="one"><b>${(USERS[top.u]||{name:'Guest'}).name.split(' ')[0]}</b> ${mentionify(top.t)}</div></div>`:''}
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
  if(users.length) h+=`<div class="lb" style="margin-bottom:14px">${users.map(u=>`<div class="lb-row click" data-action="open-user" data-id="${u.id}">${avatar(u.id)}
    <div class="who" style="flex:1"><b>${u.name}</b><span>${u.handle} · ${u.city}</span></div><span class="lvlchip">Lv${u.level}</span></div>`).join('')}</div>`;
  if(beans.length||cbeans.length) h+=`<div class="chips" style="margin-bottom:14px">${beans.map(b=>`<span class="chip tag" data-action="open-bean" data-id="${esc(b.n)}">${flag[b.c]||'🫘'} ${b.n}</span>`).join('')}${cbeans.map(n=>`<span class="chip">🫘 ${esc(n)} <small style="color:var(--muted)">yours</small></span>`).join('')}</div>`;
  if(cafes.length) h+=cafes.map(cafeCard).join('');
  if(posts.length) h+=`<div class="grid" style="margin-bottom:14px">${posts.map(p=>gcell(p.pattern,p.quality,p.id,p.img)).join('')}</div>`;
  if(!users.length&&!beans.length&&!cbeans.length&&!cafes.length&&!posts.length) h+=`<div class="empty"><div class="big">🔍</div>No matches for “${esc(q)}”.<br>Try a name, bean, café or drink.</div>`;
  return h;
}

export function lbRow(r,i){const u=USERS[r.u];return `<div class="lb-row click ${r.u==='me'?'me':''}" data-action="open-user" data-id="${r.u}">
  <div class="lb-rank ${i<3?'top':''}">${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</div>${avatar(r.u)}
  <div class="who" style="flex:1"><b>${u.name}${r.u==='me'?' (you)':''}</b><span>${u.levelName}</span></div>
  <div class="lb-pts">${fmt(r.pts)} <small>pts</small></div></div>`;}

export function cafeCard(c){
  return `<div class="cafe-card" data-action="open-cafe" data-id="${c.id}">${cafeThumb(c)}
    <div class="info"><b>${c.name}</b><div class="meta">${c.spec} · ${c.area}</div>
      <div class="row2"><span class="star">★ ${c.rating}</span><span style="font-size:12px;color:var(--muted)">${fmt(c.followers)} followers</span>${c.promo?`<span class="promo">10% off · show post</span>`:''}</div></div>
    <div class="aod" title="Latte art of the day">${art(c.img,'rosetta',.9,seedOf(c.id))}</div></div>`;
}

export function gcell(pat,q,id,img){
  const p=findPost(id);
  return `<div class="gcell" data-action="open-post" data-id="${id}">${art(img,pat,q,seedOf(id),p?p.drink:'coffee')}</div>`;
}

export function sbar(l,v){return `<div class="sbar"><div class="l"><span>${l}</span><b>${v}</b></div><div class="track"><i style="width:${v*10}%"></i></div></div>`;}
export function commentRow(c,pid,idx){
  const u=USERS[c.u]||{name:'Guest',color:'#999',handle:''};
  return `<div class="cmt">${avatar(c.u)}
    <div class="cbody"><div class="t"><b data-action="open-user" data-id="${c.u||''}">${u.name}</b> ${mentionify(c.t)}</div>
      <div class="meta"><span>${c.ago||'now'}</span><span data-action="cmt-reply" data-handle="${u.handle||''}">Reply</span></div></div>
    <button class="clike ${c.likedByMe?'on':''}" data-action="cmt-like" data-pid="${pid}" data-idx="${idx}" aria-label="Like comment">${icon(c.likedByMe?'heartF':'heart',15)}<span>${c.likes||''}</span></button></div>`;
}
