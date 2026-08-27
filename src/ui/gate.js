"use strict";
/* ============================================================
   ui/gate — the sign-up / sign-in screen.

   Not the front door any more. A visitor with no session lands on
   today's public feed and reads it as a guest; this screen is where they
   arrive once they reach for something that belongs to an account —
   posting, liking, following, their own profile. So it is answering a
   question they just asked rather than blocking the door, and it keeps a
   way back to what they were reading (`ui.gate`, ui/views.js).

   It is a *screen*, not an overlay, on purpose: overlays can be popped,
   and a half-finished sign-up shouldn't be.

   **Signing up is the setup, and the account comes last.** Three steps:
   who you are, what you brew on, and only then the email and password.
   It used to be the other way round — account first, then an onboarding
   sheet with no way out — which asked a stranger to hand over
   credentials before Crema had shown them a single thing worth
   answering. The answers are the cheap half and they are about coffee,
   so they go first; the account is what keeps them.

   Nothing here needs a session: the fields write straight into
   `state.me` (the guest store), and `keepSignupDraft()` is what carries
   them across the moment the store re-keys itself to the new user id.
   See ui/actions.js and store/store.js.

   The session is stored in localStorage by data/supabase.js and only
   discarded when the server rejects it, so a returning visitor lands
   straight in the app and never sees this again.
   ============================================================ */
import { esc } from '../core/util.js';
import { state, ui } from '../store/store.js';
import { MILK_LIST } from '../data/catalog.js';
import { t } from '../i18n.js';
import { machinePicker, drinkOptions, selectOptions } from './components.js';
import { logoMark } from './icons.js';

export function authState(){
  if(!ui.auth) ui.auth={ mode:'in', step:1, email:'', error:'', notice:'', busy:false };
  /* Anything that set ui.auth before the sign-up gained steps — and a
     session restored from an older tab — still has to land on step 1. */
  if(!ui.auth.step) ui.auth.step=1;
  return ui.auth;
}
/* Which of the three sign-up steps we are on. Clamped rather than
   trusted: `step` survives a mode switch, and the last two steps make no
   sense under "Sign in". */
export const signupStep = a => Math.min(3,Math.max(1,a.step||1));

const banner=(text,color,bg,border)=>`<div style="background:${bg};border:1px solid ${border};color:${color};border-radius:12px;padding:10px 12px;font-size:12.5px;line-height:1.45;margin-bottom:12px">${esc(text)}</div>`;

export function renderGate(){
  const a=authState();
  const up=a.mode==='up', forgot=a.mode==='forgot';
  const step=up?signupStep(a):3;

  /* The logo hero belongs to the first screen of a visit and nowhere
     else: repeated over every step it stops meaning "you are at the
     start of something" and starts meaning nothing. Steps 2 and 3 get
     the smaller heading onboarding used for its second step. */
  const title = forgot ? t('Reset your password')
    : !up ? t('Welcome back')
    : step===1 ? t('Welcome to Crema')
    : step===2 ? t('Your setup')
    : t('Create your account');
  const sub = forgot
    ? t('We will send you a link by email. Open it on this device and you can pick a new password.')
    : !up ? t('Sign in to pick up where you left off.')
    : step===1 ? t('Log the coffee you make and watch the habit build. The people here care about the same 30 seconds of the morning that you do.')
    : step===2 ? t('New posts start with this filled in. You can change it any time in Settings.')
    : t('Last step. The account is what keeps your setup, your streak and your pours.');

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

  const haveOne=`<div style="text-align:center;margin-top:16px;font-size:13px">
    <span style="color:var(--muted)">${t('Already have an account?')} </span>
    <b style="color:var(--crema-deep);cursor:pointer" data-action="auth-mode" data-m="in">${t('Sign in')}</b></div>`;

  /* The three dots are the promise that this ends — a stranger typing
     their name into a screen with no visible end is the one who leaves. */
  const dots=up?`<div class="obdots">${[1,2,3].map(i=>`<i class="${i===step?'on':''}"></i>`).join('')}</div>`:'';

  /* ---- the sign-up steps: setup first, account last ---- */
  const signupBody = step===1
    ? `<div class="field"><label>${t('Your name')}</label>
         <input id="ob-name" value="${esc(state.me.name)}" placeholder="${t('e.g. Alex Rivera')}" autocomplete="name" data-enter="signup-next"></div>
       <div class="rowfields">
         <div class="field"><label>${t('Username')}</label>
           <input id="ob-handle" value="${esc(state.me.handle||'')}" placeholder="${t('yourname')}" autocomplete="off" autocapitalize="off" spellcheck="false" data-enter="signup-next"></div>
         <div class="field"><label>${t('City')}</label>
           <input id="ob-city" value="${esc(state.me.city)}" placeholder="${t('Your city')}" data-enter="signup-next"></div></div>
       <button class="btn block"${a.busy?' disabled':''} data-action="signup-next">${a.busy?t('Just a moment…'):t('Continue')}</button>
       ${haveOne}`
    : step===2
    ? `${machinePicker('ob',state.me.machineBrand,state.me.machineModel)}
       <div class="rowfields">
         <div class="field sel"><label>${t('Go-to drink')}</label><select id="ob-drink">${drinkOptions(state.me.favDrink,{allowAdd:false})}</select></div>
         <div class="field sel"><label>${t('Go-to milk')}</label><select id="ob-milk">${selectOptions(MILK_LIST,state.me.favMilk)}</select></div></div>
       <div style="display:flex;gap:10px;margin-top:6px">
         <button class="btn ghost" data-action="signup-back">${t('Back')}</button>
         <button class="btn" style="flex:1" data-action="signup-next">${t('Continue')}</button></div>`
    : `${emailField}${pwField}
       <button class="btn block"${a.busy?' disabled':''} data-action="auth-submit">${a.busy?t('Just a moment…'):t('Create account')}</button>
       ${oauth}
       <div style="display:flex;justify-content:center;margin-top:14px">
         <button class="btn ghost" data-action="signup-back">${t('Back to your setup')}</button></div>
       ${haveOne}`;

  const body = forgot
    ? `${emailField}
       <button class="btn block"${a.busy?' disabled':''} data-action="auth-submit">${a.busy?t('Sending…'):t('Email me a reset link')}</button>
       <div style="text-align:center;margin-top:16px;font-size:13px">
         <b style="color:var(--crema-deep);cursor:pointer" data-action="auth-mode" data-m="in">${t('Back to sign in')}</b></div>`
    : up ? signupBody
    : `${emailField}${pwField}
       <button class="btn block"${a.busy?' disabled':''} data-action="auth-submit">${a.busy?t('Just a moment…'):t('Sign in')}</button>
       <div style="text-align:center;margin-top:12px;font-size:12.5px">
         <span style="color:var(--muted);cursor:pointer" data-action="auth-mode" data-m="forgot">${t('Forgot your password?')}</span></div>
       ${oauth}
       <div style="text-align:center;margin-top:16px;font-size:13px">
         <span style="color:var(--muted)">${t('New to Crema?')} </span>
         <b style="color:var(--crema-deep);cursor:pointer" data-action="auth-mode" data-m="up">${t('Create one')}</b></div>`;

  const head = up && step>1
    ? `<h2 class="obh2">${title}</h2><p class="obsub">${sub}</p>`
    : `<div class="obhero">${logoMark(56)}<h1>${title}</h1><p>${sub}</p></div>`;

  return `<div class="pad" style="padding-top:26px">
    ${dots}
    ${head}
    ${a.notice?banner(a.notice,'var(--green)','var(--pm1)','var(--pm2)'):''}
    ${a.error?banner(a.error,'var(--terra)','rgba(168,84,74,.10)','rgba(168,84,74,.28)'):''}
    ${body}
    <div style="font-size:11px;color:var(--muted);margin-top:20px;text-align:center;line-height:1.55">
      ${t('Your coffee log is stored in the EU and belongs to you.')}<br>${t('Crema never posts anything without you.')}</div>
    <div style="text-align:center;margin-top:18px;font-size:13px;color:var(--muted);cursor:pointer" data-action="guest-back">← ${t('Keep reading today\'s pours')}</div>
    <div style="height:20px"></div>
  </div>`;
}
