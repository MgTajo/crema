"use strict";
/* ============================================================
   ui/gate — the sign-in screen.

   Crema needs an account: your pours, follows and challenge entries are
   rows that belong to a user, so there is nothing meaningful to show
   before we know who you are. This screen is the whole app until then —
   it replaces the feed, and there is no tab bar to escape it with.

   It is a *screen*, not an overlay, on purpose: overlays can be popped.

   The session is stored in localStorage by data/supabase.js and only
   discarded when the server rejects it, so a returning visitor lands
   straight in the app and never sees this again.
   ============================================================ */
import { esc } from '../core/util.js';
import { ui } from '../store/store.js';
import { logoMark } from './icons.js';

export function authState(){
  if(!ui.auth) ui.auth={ mode:'in', email:'', error:'', notice:'', busy:false };
  return ui.auth;
}

const banner=(text,color,bg,border)=>`<div style="background:${bg};border:1px solid ${border};color:${color};border-radius:12px;padding:10px 12px;font-size:12.5px;line-height:1.45;margin-bottom:12px">${esc(text)}</div>`;

export function renderGate(){
  const a=authState();
  const up=a.mode==='up', forgot=a.mode==='forgot';
  const title = forgot ? 'Reset your password' : up ? 'Create your account' : 'Welcome back';
  const sub = forgot
    ? 'We\'ll email you a link. Open it on this device and you\'ll be signed in, ready to pick a new password.'
    : up
      ? 'Every pour is progress. Start logging your coffees, grow your craft, and meet people who care about the same 30 seconds of the morning that you do.'
      : 'Sign in to pick up where you left off.';

  const emailField=`<div class="field"><label>Email</label>
    <input id="au-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false"
      placeholder="you@example.com" value="${esc(a.email||'')}" data-enter="auth-submit"></div>`;
  const pwField=`<div class="field"><label>Password</label>
    <input id="au-pw" type="password" autocomplete="${up?'new-password':'current-password'}"
      placeholder="${up?'At least 8 characters':'Your password'}" data-enter="auth-submit"></div>`;

  const oauth=`
    <div style="display:flex;align-items:center;gap:10px;margin:14px 0;color:var(--muted);font-size:11.5px">
      <i style="flex:1;height:1px;background:var(--line)"></i>or<i style="flex:1;height:1px;background:var(--line)"></i></div>
    <button class="btn ghost block" data-action="auth-oauth" data-p="google">Continue with Google</button>
    <button class="btn ghost block" style="margin-top:8px" data-action="auth-oauth" data-p="apple">Continue with Apple</button>`;

  const body = forgot
    ? `${emailField}
       <button class="btn block"${a.busy?' disabled':''} data-action="auth-submit">${a.busy?'Sending…':'Email me a reset link'}</button>
       <div style="text-align:center;margin-top:16px;font-size:13px">
         <b style="color:var(--crema-deep);cursor:pointer" data-action="auth-mode" data-m="in">Back to sign in</b></div>`
    : `${emailField}${pwField}
       <button class="btn block"${a.busy?' disabled':''} data-action="auth-submit">${a.busy?'Just a moment…':(up?'Create account':'Sign in')}</button>
       ${up?'':`<div style="text-align:center;margin-top:12px;font-size:12.5px">
         <span style="color:var(--muted);cursor:pointer" data-action="auth-mode" data-m="forgot">Forgot your password?</span></div>`}
       ${oauth}
       <div style="text-align:center;margin-top:16px;font-size:13px">
         <span style="color:var(--muted)">${up?'Already have an account? ':'New to Crema? '}</span>
         <b style="color:var(--crema-deep);cursor:pointer" data-action="auth-mode" data-m="${up?'in':'up'}">${up?'Sign in':'Create one'}</b></div>`;

  return `<div class="pad" style="padding-top:26px">
    <div class="obhero">${logoMark(56)}<h1>${title}</h1><p>${sub}</p></div>
    ${a.notice?banner(a.notice,'var(--green)','var(--pm1)','var(--pm2)'):''}
    ${a.error?banner(a.error,'var(--terra)','rgba(168,84,74,.10)','rgba(168,84,74,.28)'):''}
    ${body}
    <div style="font-size:11px;color:var(--muted);margin-top:20px;text-align:center;line-height:1.55">
      Your coffee log is stored in the EU and is yours alone.<br>Crema never posts anything without you.</div>
    <div style="height:20px"></div>
  </div>`;
}
