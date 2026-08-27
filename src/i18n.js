"use strict";
/* ============================================================
   i18n — the app in two languages.

   Sits below every other layer: it imports nothing from the app and
   touches no state, so `data/`, `domain/` and `ui/` can all call `t()`
   without creating a cycle.

   The key IS the English sentence. There is no build step here and no
   extraction tool, so a key like `gate.sub.signup` would mean every
   string in the source became a lookup nobody could read. Written this
   way the English copy stays legible where it is used, an untranslated
   string falls back to itself instead of to a missing-key marker, and
   the German file (i18n.de.js) is the only thing that has to be kept in
   step.

   Language lives in localStorage rather than in the store: it has to be
   known at first paint, before load() has resolved, and a signed-out
   visitor gets to pick it too.
   ============================================================ */
import { DE } from './i18n.de.js';

const KEY='crema.lang';
export const LANGS=[['en','English'],['de','Deutsch']];
const SUPPORTED=LANGS.map(l=>l[0]);

function detect(){
  try{ const saved=localStorage.getItem(KEY); if(SUPPORTED.includes(saved)) return saved; }catch(e){}
  const nav=(navigator.languages&&navigator.languages[0])||navigator.language||'en';
  return /^de/i.test(nav)?'de':'en';
}

export let lang=detect();

/* The page's own static text — the pitch beside the phone frame in
   index.html — is marked `data-t` and swapped here.

   It lives in the HTML rather than in a render function because it has
   to paint before a single module has run (D-2026-08-20-01), which is
   also why it cannot simply call t() where it is written. The English
   in the file is the key, read once and kept, so switching back and
   forth does not translate a translation. Everything else on screen is
   rendered by ui/ and asks t() directly. */
const statics=new Map();

export function applyLang(){
  document.documentElement.setAttribute('lang',lang);
  document.querySelectorAll('[data-t]').forEach(el=>{
    if(!statics.has(el)) statics.set(el, el.textContent.trim());
    el.textContent=t(statics.get(el));
  });
}

export function setLang(l){
  if(!SUPPORTED.includes(l)||l===lang) return false;
  lang=l;
  try{ localStorage.setItem(KEY,l); }catch(e){}
  applyLang();
  return true;
}

const fill=(s,v)=>v ? s.replace(/\{(\w+)\}/g,(m,k)=>v[k]==null?m:v[k]) : s;

/* One string, optionally with {placeholders}. */
export function t(s,v){
  if(lang==='en') return fill(s,v);
  const de=DE[s];
  return fill(de==null?s:de,v);
}

/* Singular / plural. German splits at one just as English does, so the
   count decides the form in both. `{n}` is filled in for free. */
export function tn(n,one,other,v){
  return t(n===1?one:other, Object.assign({n},v));
}

/* Dates and numbers follow the language, not the device. Someone reading
   Crema in German on an English phone should still get "Mo., 4. Aug.". */
export const locale=()=>lang==='de'?'de-DE':'en-GB';
