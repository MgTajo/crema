"use strict";
/* ============================================================
   data/supabase — a minimal, dependency-free Supabase client.

   Only what Crema actually uses: GoTrue auth (email + OAuth via PKCE,
   with refresh) and PostgREST queries. Roughly 150 lines instead of a
   vendored bundle, which keeps the app a static site with no build
   step and nothing to go stale.

   Everything here fails soft. If the network is down or the project is
   misconfigured, calls reject and the caller falls back to demo mode —
   they never throw during module evaluation.

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
async function authPost(path, body){
  const r = await fetch(`${SUPABASE_URL}/auth/v1/${path}`,{
    method:'POST', headers:{ apikey:SUPABASE_KEY, 'Content-Type':'application/json' },
    body: JSON.stringify(body) });
  const json = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(json.error_description || json.msg || json.message || `Auth error ${r.status}`);
  return json;
}

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
function cleanUrl(){
  const u=new URL(location.href);
  ['code','error','error_description','error_code','state'].forEach(k=>u.searchParams.delete(k));
  history.replaceState({}, '', u.pathname + (u.searchParams.toString()?'?'+u.searchParams:'') + u.hash);
}

/* Returns an error string if the provider bounced us back with one. */
async function completeOAuthRedirect(){
  const p = new URLSearchParams(location.search);
  const err = p.get('error_description') || p.get('error');
  if(err){ cleanUrl(); return err; }
  const code = p.get('code');
  if(!code) return null;
  let verifier=null;
  try{ verifier=localStorage.getItem(VERIFIER_KEY); localStorage.removeItem(VERIFIER_KEY); }catch(e){}
  cleanUrl();
  if(!verifier) return 'Sign-in could not be completed — please try again.';
  try{
    store(shape(await authPost('token?grant_type=pkce',{ auth_code:code, code_verifier:verifier })));
    return null;
  }catch(e){ return e.message; }
}

/* ---------- public auth API ---------- */
export async function initAuth(){
  if(!BACKEND) return { session:null, error:null };
  session = readStored();
  const error = await completeOAuthRedirect();
  if(session && session.expires_at - Date.now() < 60000){
    try{ await refresh(); }catch(e){ store(null); }
  }
  return { session, error };
}

async function refresh(){
  if(refreshing) return refreshing;
  refreshing = (async()=>{
    try{
      store(shape(await authPost('token?grant_type=refresh_token',{ refresh_token:session.refresh_token })));
      return session;
    } finally { refreshing = null; }
  })();
  return refreshing;
}

/* A valid access token, refreshed if it is about to expire. Null when
   signed out — callers then query as the anon role. */
export async function accessToken(){
  if(!session) return null;
  if(session.expires_at - Date.now() < 60000){
    try{ await refresh(); }
    catch(e){ store(null); emit(); return null; }
  }
  return session.access_token;
}

export async function signUp(email,password){
  const json = await authPost('signup',{ email, password });
  /* With email confirmation on, signup returns a user but no session. */
  if(json.access_token){ store(shape(json)); emit(); return { session, confirmationRequired:false }; }
  return { session:null, confirmationRequired:true };
}

export async function signInWithPassword(email,password){
  store(shape(await authPost('token?grant_type=password',{ email, password })));
  emit();
  return session;
}

export async function signInWithOAuth(provider){
  const verifier = randomVerifier();
  try{ localStorage.setItem(VERIFIER_KEY, verifier); }
  catch(e){ throw new Error('Sign-in needs browser storage — check your privacy settings.'); }
  const challenge = await challengeOf(verifier);
  const redirect = location.href.split('#')[0].split('?')[0];
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
