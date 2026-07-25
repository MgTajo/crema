"use strict";
/* ============================================================
   data/supabase — a minimal, dependency-free Supabase client.

   Only what Crema actually uses: GoTrue auth (email + OAuth via PKCE,
   with refresh) and PostgREST queries. Roughly 150 lines instead of a
   vendored bundle, which keeps the app a static site with no build
   step and nothing to go stale.

   Everything here fails soft: calls reject with a message the UI can
   show, and nothing throws during module evaluation. A rejected refresh
   token signs the user out; a network failure never does.

   The seam this sits behind: nothing above data/ imports fetch.
   ============================================================ */
import { SUPABASE_URL, SUPABASE_KEY, BACKEND } from '../config.js';

const SESSION_KEY  = 'crema_session';
const VERIFIER_KEY = 'crema_pkce_verifier';

let session = null;              // {access_token, refresh_token, expires_at, user}
let refreshing = null;           // in-flight refresh, so parallel calls share one
const listeners = new Set();

/* ---------- session storage ---------- */
function readStored(){
  try{ const s=JSON.parse(localStorage.getItem(SESSION_KEY)); return s&&s.access_token?s:null; }catch(e){ return null; }
}
function store(s){
  session = s;
  try{ s ? localStorage.setItem(SESSION_KEY,JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); }catch(e){}
}
function shape(json){
  return { access_token:json.access_token, refresh_token:json.refresh_token,
           expires_at: Date.now() + ((json.expires_in||3600)*1000), user:json.user };
}
function emit(){ listeners.forEach(fn=>{ try{ fn(session); }catch(e){ console.warn('auth listener failed',e); } }); }

export const getSession = () => session;
export const currentUser = () => session && session.user;
export function onAuthChange(fn){ listeners.add(fn); return ()=>listeners.delete(fn); }

/* ---------- low-level auth calls ---------- */
async function authPost(path, body, token){
  const headers = { apikey:SUPABASE_KEY, 'Content-Type':'application/json' };
  if(token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/${path}`,{
    method:'POST', headers, body: JSON.stringify(body) });
  const json = await r.json().catch(()=>({}));
  if(!r.ok){
    const e = new Error(json.error_description || json.msg || json.message || `Auth error ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return json;
}

/* A 4xx from the auth server is final: the token was rejected and the
   user has to sign in again. Anything else — offline, DNS, a 5xx — is
   transient, and must NOT cost someone their session. That distinction
   is the whole reason "stay signed in across days" works on a flaky
   connection. */
const fatalAuth = e => !!(e && e.status >= 400 && e.status < 500);

/* ---------- PKCE (OAuth) ---------- */
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function randomVerifier(){
  const a=new Uint8Array(64); crypto.getRandomValues(a);
  return b64url(a.buffer);
}
async function challengeOf(verifier){
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(digest);
}

/* Strip auth params so a refresh doesn't try to redeem a spent code. */
function cleanUrl(keepHash){
  const u=new URL(location.href);
  ['code','error','error_description','error_code','state'].forEach(k=>u.searchParams.delete(k));
  history.replaceState({}, '', u.pathname + (u.searchParams.toString()?'?'+u.searchParams:'') + (keepHash?u.hash:''));
}

/* Password-recovery and magic links come back with the tokens in the URL
   fragment rather than as a code to redeem. Pick them up, then wipe the
   fragment so the tokens don't sit in the address bar or get shared.
   Returns 'recovery' when the link was a password reset. */
function completeHashTokens(){
  const h=location.hash||'';
  if(h.indexOf('access_token=')<0) return null;
  const p=new URLSearchParams(h.replace(/^#/,''));
  const at=p.get('access_token'), rt=p.get('refresh_token');
  const kind=p.get('type');
  if(at&&rt){
    store({ access_token:at, refresh_token:rt,
            expires_at: Date.now() + ((+p.get('expires_in')||3600)*1000), user:null });
  }
  history.replaceState({}, '', location.pathname + location.search);
  return kind==='recovery' ? 'recovery' : (at?'link':null);
}

/* The hash-token path gives us tokens but no user object. Everything
   above data/ reads session.user, so fill it in before returning. */
async function fetchUser(){
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`,{
    headers:{ apikey:SUPABASE_KEY, Authorization:`Bearer ${session.access_token}` } });
  if(!r.ok){ const e=new Error(`Could not load your account (${r.status})`); e.status=r.status; throw e; }
  const user = await r.json();
  store({ ...session, user });
  return user;
}

/* The verifier is written before we navigate away and read when we come
   back. It carries the time it was issued, so a flow that never
   completed can be told apart from one nobody started. */
function takeVerifier(){
  let raw=null;
  try{ raw=localStorage.getItem(VERIFIER_KEY); localStorage.removeItem(VERIFIER_KEY); }catch(e){}
  if(!raw) return null;
  try{ const o=JSON.parse(raw); return o&&o.v ? o : null; }
  catch(e){ return { v:raw, at:0 }; }        // written by an older build
}

/* Returns an error string if the round trip didn't bring us a session. */
async function completeOAuthRedirect(){
  const p = new URLSearchParams(location.search);
  const err = p.get('error_description') || p.get('error');
  if(err){ takeVerifier(); cleanUrl(); return err; }

  const code = p.get('code');
  if(!code){
    /* We started a sign-in and came back with nothing to redeem. That is
       almost always the provider redirect landing somewhere other than
       this app: Supabase falls back to the project's Site URL when the
       app's URL is not in Auth → URL Configuration → Redirect URLs.
       Silence here reads as "the button does nothing", so say it. */
    const pending=takeVerifier();
    if(pending && pending.at && Date.now()-pending.at < 10*60*1000){
      return 'Sign-in didn\'t come back with a session. Check that this app\'s URL is listed under Redirect URLs in the Supabase auth settings.';
    }
    return null;
  }

  const pending=takeVerifier();
  cleanUrl();
  if(!pending) return 'Sign-in could not be completed — please try again.';
  try{
    store(shape(await authPost('token?grant_type=pkce',{ auth_code:code, code_verifier:pending.v })));
    return null;
  }catch(e){ return e.message; }
}

/* ---------- public auth API ---------- */
/* Restore the stored session, if there is one, and finish any redirect
   we were sent back from. This is what "no need to sign in again
   tomorrow" rests on: the refresh token lives in localStorage and is
   only ever discarded when the server actually rejects it. */
export async function initAuth(){
  if(!BACKEND) return { session:null, error:'Crema is not configured to reach its backend.', recovery:false };
  session = readStored();
  const kind = completeHashTokens();
  const error = await completeOAuthRedirect();
  if(session && !session.user){
    try{ await fetchUser(); }
    catch(e){ if(fatalAuth(e)) store(null); }
  }
  if(session && session.expires_at - Date.now() < 60000){
    try{ await refresh(); }
    catch(e){ if(fatalAuth(e)) store(null); }
  }
  return { session, error, recovery: kind==='recovery' && !!session };
}

async function refresh(){
  if(refreshing) return refreshing;
  refreshing = (async()=>{
    try{
      const user = session.user;
      const next = shape(await authPost('token?grant_type=refresh_token',{ refresh_token:session.refresh_token }));
      /* the refresh response carries the user, but keep ours if it doesn't */
      store({ ...next, user: next.user || user });
      return session;
    } finally { refreshing = null; }
  })();
  return refreshing;
}

/* A valid access token, refreshed if it is about to expire. Returns the
   stale token rather than nothing when a refresh fails for a reason that
   isn't the token being rejected — the request may still fail, but the
   user stays signed in and the next attempt can succeed. */
export async function accessToken(){
  if(!session) return null;
  if(session.expires_at - Date.now() < 60000){
    try{ await refresh(); }
    catch(e){ if(fatalAuth(e)){ store(null); emit(); return null; } }
  }
  return session && session.access_token;
}

export async function signUp(email,password){
  const json = await authPost(`signup?redirect_to=${encodeURIComponent(appUrl())}`,{ email, password });
  /* With email confirmation on, signup returns a user but no session. */
  if(json.access_token){ store(shape(json)); emit(); return { session, confirmationRequired:false }; }
  return { session:null, confirmationRequired:true };
}

export async function signInWithPassword(email,password){
  store(shape(await authPost('token?grant_type=password',{ email, password })));
  emit();
  return session;
}

/* Email a password-reset link back to this app. The link returns with
   tokens in the fragment; completeHashTokens() picks them up, so the
   user lands signed in and can set a new password in Settings. */
export async function sendPasswordReset(email){
  return authPost(`recover?redirect_to=${encodeURIComponent(appUrl())}`,{ email });
}

/* Change the password of the signed-in user. */
export async function updatePassword(password){
  const token = await accessToken();
  if(!token) throw new Error('Sign in first.');
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`,{
    method:'PUT', headers:{ apikey:SUPABASE_KEY, Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ password }) });
  const json = await r.json().catch(()=>({}));
  if(!r.ok){
    const e=new Error(json.error_description || json.msg || json.message || `Could not change the password (${r.status})`);
    e.status=r.status; throw e;
  }
  return json;
}

const appUrl = () => location.href.split('#')[0].split('?')[0];

export async function signInWithOAuth(provider){
  const verifier = randomVerifier();
  try{ localStorage.setItem(VERIFIER_KEY, JSON.stringify({ v:verifier, at:Date.now() })); }
  catch(e){ throw new Error('Sign-in needs browser storage — check your privacy settings.'); }
  const challenge = await challengeOf(verifier);
  const redirect = appUrl();
  location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=${encodeURIComponent(provider)}`
    + `&redirect_to=${encodeURIComponent(redirect)}`
    + `&code_challenge=${challenge}&code_challenge_method=s256`;
}

export async function signOut(){
  const token = session && session.access_token;
  store(null); emit();
  /* Best-effort server-side revoke; the local session is already gone. */
  if(token) fetch(`${SUPABASE_URL}/auth/v1/logout`,{ method:'POST',
    headers:{ apikey:SUPABASE_KEY, Authorization:`Bearer ${token}` } }).catch(()=>{});
}

/* ---------- PostgREST ---------- */
/* path is everything after /rest/v1/, e.g. "posts?select=*&limit=10" */
export async function rest(path,{ method='GET', body, prefer, signal }={}){
  if(!BACKEND) throw new Error('Backend disabled');
  const token = await accessToken();
  const headers = { apikey:SUPABASE_KEY, 'Content-Type':'application/json' };
  if(token) headers.Authorization = `Bearer ${token}`;
  if(prefer) headers.Prefer = prefer;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`,
    { method, headers, body: body===undefined?undefined:JSON.stringify(body), signal });
  if(!r.ok){
    const detail = await r.text().catch(()=>'');
    const e = new Error(`${method} ${path.split('?')[0]} → ${r.status} ${detail}`);
    e.status = r.status;
    throw e;
  }
  if(r.status===204) return null;
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}
