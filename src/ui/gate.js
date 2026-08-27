"use strict";
/* ============================================================
   ui/gate — the sign-in screen.

   Not the front door any more. A visitor with no session lands on
   today's public feed and reads it as a guest; this screen is where they
   arrive once they reach for something that belongs to an account —
   posting, liking, following, their own profile. So it is answering a
   question they just asked rather than blocking the door, and it keeps a
   way back to what they were reading (`ui.gate`, ui/views.js).

   It is a *screen*, not an overlay, on purpose: overlays can be popped,
   and a half-finished sign-up shouldn't be.

   The session is stored in localStorage by data/supabase.js and only
   discarded when the server rejects it, so a returning visitor lands
   straight in the app and never sees this again.
   ============================================================ */
import { esc } from '../core/util.js';
import { ui } from '../store/store.js';
import { t } from '../i18n.js';
import { logoMark } from './icons.js';

export function authState(){
  if(!ui.auth) ui.auth={ mode:'in', email:'', error:'', notice:'', busy:false };
  return ui.auth;
}

const banner=(text,color,bg,border)=>`<div style="background:${bg};border:1px solid ${border};color:${color};border-radius:12px;padding:10px 12px;font-size:12.5px;line-height:1.45;margin-bottom:12px">${esc(text)}</div>`;

export function renderGate(){
  const a=authState();
  const up=a.mode==='up', forgot=a.mode==='forgot';
  const title = forgot ? t('Reset your password') : up ? t('Create your account') : t('Welcome back');
  const sub = forgot
    ? t('We will send you a link by email. Open it on this device and you can pick a new password.')
    : up
      ? t('Log the coffee you make and watch the habit build. The people here care about the same 30 seconds of the morning that you do.')
      : t('Sign in to pick up where you left off.');

  const emailField=`<div class="field"><label>${t('Email')}</label>
    <input id="au-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false"
      placeholder="${t('you@example.com')}" value="${esc(a.email||'')}" data-enter="auth-submit"></div>`;
  const pwField=`<div class="field"><label>${t('Password')}</label>
    <input id="au-pw" type="password" autocomplete="${up?'new-password':'current-password'}"
      placeholder="${up?t('At least 8 characters'):t('Your password')}" data-enter="auth-submit"></div>`;

  const oauth=`
    <div style="display:flex;align-items:center;gap:10px;margin:14px 0;color:var(--muted);font-size:11.5px">
      <i style="flex:1;height:1px;background:var(--line)"></i>${t('or')}<i style="flex:1;height:1px;background:var(--line)"></i></div>
    <button class="btn ghost block" data-action="auth-oauth" data-p="google">${t('Continue with Google')}</button>`;

  const body = forgot
    ? `${emailField}
       <button class="btn block"${a.busy?' disabled':''} data-action="auth-submit">${a.busy?t('Sending…'):t('Email me a reset link')}</button>
       <div style="text-align:center;margin-top:16px;font-size:13px">
         <b style="color:var(--crema-deep);cursor:pointer" data-action="auth-mode" data-m="in">${t('Back to sign in')}</b></div>`
    : `${emailField}${pwField}
       <button class="btn block"${a.busy?' disabled':''} data-action="auth-submit">${a.busy?t('Just a moment…'):(up?t('Create account'):t('Sign in'))}</button>
       ${up?'':`<div style="text-align:center;margin-top:12px;font-size:12.5px">
         <span style="color:var(--muted);cursor:pointer" data-action="auth-mode" data-m="forgot">${t('Forgot your password?')}</span></div>`}
       ${oauth}
       <div style="text-align:center;margin-top:16px;font-size:13px">
         <span style="color:var(--muted)">${up?t('Already have an account?')+' ':t('New to Crema?')+' '}</span>
         <b style="color:var(--crema-deep);cursor:pointer" data-action="auth-mode" data-m="${up?'in':'up'}">${up?t('Sign in'):t('Create one')}</b></div>`;

  return `<div class="pad" style="padding-top:26px">
    <div class="obhero">${logoMark(56)}<h1>${title}</h1><p>${sub}</p></div>
    ${a.notice?banner(a.notice,'var(--green)','var(--pm1)','var(--pm2)'):''}
    ${a.error?banner(a.error,'var(--terra)','rgba(168,84,74,.10)','rgba(168,84,74,.28)'):''}
    ${body}
    <div style="font-size:11px;color:var(--muted);margin-top:20px;text-align:center;line-height:1.55">
      ${t('Your coffee log is stored in the EU and belongs to you.')}<br>${t('Crema never posts anything without you.')}</div>
    <div style="text-align:center;margin-top:18px;font-size:13px;color:var(--muted);cursor:pointer" data-action="guest-back">← ${t('Keep reading today\'s pours')}</div>
    <div style="height:20px"></div>
  </div>`;
}
