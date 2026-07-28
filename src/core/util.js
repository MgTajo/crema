"use strict";
/* ============================================================
   core/util — pure, dependency-free helpers.
   Nothing here touches app state, data or the network, so every
   function is portable as-is to a React Native / backend codebase.
   The only browser coupling is the DOM query helpers ($, $$).
   ============================================================ */

/* ---------- DOM query helpers ---------- */
export const $  = (s,r=document)=>r.querySelector(s);
export const $$ = (s,r=document)=>[...r.querySelectorAll(s)];

/* ---------- number / string formatting ---------- */
export const fmt = n => n>=1000 ? (n/1000).toFixed(n<10000?1:0).replace(/\.0$/,'')+'k' : ''+n;
export function rng(seed){let t=(seed>>>0)||1;return()=>{t+=0x6D2B79F5;let r=Math.imul(t^t>>>15,1|t);r^=r+Math.imul(r^r>>>7,61|r);return((r^r>>>14)>>>0)/4294967296;};}
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const lerp=(a,b,t)=>a+(b-a)*t;
export const lerpC=(a,b,t)=>[Math.round(lerp(a[0],b[0],t)),Math.round(lerp(a[1],b[1],t)),Math.round(lerp(a[2],b[2],t))];
export const rgb=a=>`rgb(${a[0]},${a[1]},${a[2]})`;
export const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
export const seedOf=id=>(''+id).split('').reduce((a,c)=>a+c.charCodeAt(0),0);
export const esc=s=>(''+(s==null?'':s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
export const clone=o=>JSON.parse(JSON.stringify(o));
export const initials=n=>n.split(' ').map(w=>w[0]).slice(0,2).join('');

/* Strips everything but digits/one decimal point out of a recipe field
   and tacks the unit back on — the mask behind the dose/yield/time/temp
   inputs, so "18" becomes "18g" as you type and stays that way however
   the value got there (typed, pasted, or loaded from an old post). */
export function withUnit(raw,unit){
  let n=(''+(raw==null?'':raw)).replace(/[^0-9.]/g,'');
  const dot=n.indexOf('.');
  if(dot!==-1) n=n.slice(0,dot+1)+n.slice(dot+1).replace(/\./g,'');
  return n?n+unit:'';
}

/* ---------- relative-time helpers ---------- */
export function agoDays(a){if(!a||a==='now')return 0;const m=(''+a).match(/(\d+)([hdw])/);if(!m)return 0;const n=+m[1];return m[2]==='h'?0:m[2]==='d'?n:n*7;}
/* timestamptz → the compact relative label the UI already speaks ('2h', '3d') */
export function agoFrom(iso){
  const t=Date.parse(iso); if(!isFinite(t)) return 'now';
  const mins=Math.max(0,(Date.now()-t)/60000);
  if(mins<1) return 'now';
  if(mins<60) return Math.floor(mins)+'m';
  const h=mins/60; if(h<24) return Math.floor(h)+'h';
  const d=h/24;    if(d<7)  return Math.floor(d)+'d';
  return Math.floor(d/7)+'w';
}
/* Was this timestamp today, in the *user's* local calendar day? Editing a
   pour is allowed only on the day it was poured, and "the day" is the one
   the user lived through, not UTC's. */
export function isToday(iso){
  const t=Date.parse(iso); if(!isFinite(t)) return false;
  const d=new Date(t), n=new Date();
  return d.getFullYear()===n.getFullYear() && d.getMonth()===n.getMonth() && d.getDate()===n.getDate();
}
export function agoLabel(a){const d=agoDays(a);if(d===0)return'Today';if(d===1)return'Yesterday';if(d<7)return new Date(Date.now()-d*864e5).toLocaleDateString('en',{weekday:'short'});return a+' ago';}
