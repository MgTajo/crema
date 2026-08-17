"use strict";
/* ============================================================
   data/realtime — a minimal, dependency-free Supabase Realtime client.

   The same bargain as data/supabase.js: ~200 lines of the Phoenix
   channel protocol instead of a vendored SDK, so the app stays a static
   site with no build step and nothing to go stale.

   What it is NOT: a data source. A change event carries a row, but the
   row has no `profiles` embed, no counts, and no RLS-shaped view of what
   the *reader* is allowed to see beyond the one row Realtime decided to
   send. So this layer only ever answers "something on `posts` changed" —
   store/live.js then re-asks through the ordinary PostgREST paths, which
   already know the feed's filters. That is also why the polling fallback
   in store/live.js is a real fallback rather than a second half-built
   implementation: it produces the exact same signal.

   Everything here fails soft. No socket, a blocked WebSocket, or a
   publication that hasn't had step-1.25.sql run against it yet all end
   the same way — `live` goes false, listeners are told, and the app
   falls back to polling. Nothing throws, and nothing above data/ knows
   whether a change arrived over a socket or over a poll.
   ============================================================ */
import { SUPABASE_URL, SUPABASE_KEY, BACKEND } from '../config.js';
import { accessToken, getSession, onAuthChange } from './supabase.js';

/* One channel for the whole app. Realtime bills and limits by
   *connection*, and every table we care about can ride the same one. */
const TOPIC = 'realtime:crema';
const socketUrl = () =>
  `${SUPABASE_URL.replace(/^http/, 'ws')}/realtime/v1/websocket`
  + `?apikey=${encodeURIComponent(SUPABASE_KEY)}&vsn=1.0.0`;

/* Supabase closes a socket that hasn't said anything for 60s. */
const HEARTBEAT_MS = 25000;
/* Two missed heartbeats and we stop believing the socket, whatever the
   readyState claims — a half-open TCP connection looks OPEN forever. */
const SILENCE_MS = HEARTBEAT_MS * 2 + 5000;
const BACKOFF = [1000, 2000, 5000, 15000, 30000];
/* A refused subscription is not a network problem and retrying it on the
   backoff above would be one handshake every 30s against a server that
   is going to say no again. But it is not permanent either — it is
   step-1.25.sql not having been run *yet*, and the browser that is open
   while it is run should start receiving without needing a reload. So:
   slow, indefinite, and cheap enough to leave running all morning. */
const REFUSED_RETRY_MS = 5 * 60 * 1000;

const handlers = new Map();      // table → Set(fn)
const statusFns = new Set();

let ws = null;
let ref = 0, joinRef = null;
let beat = null, retryTimer = null, tries = 0;
let lastHeard = 0;
let live = false;
let started = false;
/* open() awaits a token before it has a socket to guard on, so the
   `ws` check alone would let two callers through and leave one socket
   orphaned, heartbeatless and holding a connection slot. */
let opening = false;

/* ---------- what the app subscribes to ----------
   `*` on the four public tables, and your own notifications only —
   the filter is applied by Realtime, so nobody else's inbox is even
   sent to this browser, let alone dropped by it.

   Deliberately absent: follows, challenges, podium. They change rarely
   or are recomputed by Postgres on a schedule the client can't shortcut,
   and every extra table is a per-subscriber RLS check on every write. */
function watching(){
  const s = getSession();
  const rows = [
    { event:'*', schema:'public', table:'posts' },
    { event:'*', schema:'public', table:'comments' },
    { event:'*', schema:'public', table:'likes' },
    { event:'*', schema:'public', table:'reactions' }
  ];
  if(s) rows.push({ event:'INSERT', schema:'public', table:'notifications',
                    filter:`user_id=eq.${s.user.id}` });
  return rows;
}

/* ---------- listeners ---------- */
export function onChange(table, fn){
  if(!handlers.has(table)) handlers.set(table, new Set());
  handlers.get(table).add(fn);
  return () => handlers.get(table).delete(fn);
}
export function onRealtimeStatus(fn){ statusFns.add(fn); return () => statusFns.delete(fn); }
export const realtimeLive = () => live;

function emitChange(table, ev){
  const set = handlers.get(table); if(!set) return;
  set.forEach(fn=>{ try{ fn(ev); }catch(e){ console.warn('realtime listener failed',e); } });
}
function setLive(v){
  if(live===v) return;
  live = v;
  statusFns.forEach(fn=>{ try{ fn(v); }catch(e){ console.warn('realtime status listener failed',e); } });
}

/* ---------- the socket ---------- */
function send(event, payload, topic=TOPIC){
  if(!ws || ws.readyState!==1) return null;
  const r = String(++ref);
  try{ ws.send(JSON.stringify({ topic, event, payload, ref:r, join_ref:joinRef })); }
  catch(e){ return null; }
  return r;
}

async function open(){
  if(!BACKEND || ws || opening) return;
  opening = true;
  let token;
  try{ token = await accessToken(); }catch(e){ token = null; }

  let sock;
  try{ sock = new WebSocket(socketUrl()); }
  catch(e){ opening = false; console.warn('realtime socket failed to open',e); scheduleRetry(); return; }
  ws = sock; opening = false;

  sock.addEventListener('open', ()=>{
    if(ws!==sock) return;
    lastHeard = Date.now();
    joinRef = String(++ref);
    /* The join carries the whole subscription. A reply with status "ok"
       is the only thing that makes us believe the socket; an error (an
       unpublished table, a rejected token) leaves `live` false and the
       poller running. */
    try{
      sock.send(JSON.stringify({
        topic: TOPIC, event: 'phx_join', ref: joinRef, join_ref: joinRef,
        payload: {
          config: {
            broadcast: { ack:false, self:false },
            presence: { key:'' },
            postgres_changes: watching(),
            private: false
          },
          /* No session means a guest, and the anon role is what the
             publishable key already grants — same as every REST call. */
          access_token: token || SUPABASE_KEY
        }
      }));
    }catch(e){ console.warn('realtime join failed',e); }
    beat = setInterval(heartbeat, HEARTBEAT_MS);
  });

  sock.addEventListener('message', ev=>{ if(ws===sock) onMessage(ev); });
  sock.addEventListener('error', ()=>{ /* 'close' always follows */ });
  sock.addEventListener('close', ()=>{
    if(ws!==sock) return;
    teardown();
    setLive(false);
    scheduleRetry();
  });
}

function onMessage(ev){
  lastHeard = Date.now();
  let m; try{ m = JSON.parse(ev.data); }catch(e){ return; }

  if(m.event==='phx_reply' && m.ref===joinRef){
    const ok = m.payload && m.payload.status==='ok';
    if(ok){ tries = 0; setLive(true); }
    else {
      console.warn('realtime join refused — falling back to polling.',
                   m.payload && m.payload.response);
      refused();
    }
    return;
  }

  /* Realtime reports a refused subscription on the channel rather than
     in the join reply, and it refuses the whole join over one unpublished
     table — so this is the message you get until step-1.25.sql is run,
     and it names whichever table it tripped on first. */
  if(m.event==='system' && m.payload && m.payload.status==='error'){
    console.warn('realtime unavailable — falling back to polling.'
               + ' If this says "Unable to subscribe", run platform/supabase/step-1.25.sql.',
                 m.payload.message);
    refused();
    return;
  }

  if(m.event==='phx_error' || m.event==='phx_close'){ setLive(false); return; }

  if(m.event==='postgres_changes'){
    const d = m.payload && m.payload.data; if(!d || !d.table) return;
    /* INSERT/UPDATE carry `record`; DELETE carries `old_record`, which
       holds the replica identity — the primary key. That is enough for
       every table here: `likes` and `reactions` key on (user_id,
       post_id[,kind]), so a removed like still names its post. */
    const row = (d.record && Object.keys(d.record).length) ? d.record : (d.old_record || {});
    emitChange(d.table, { type:d.type, table:d.table, row });
  }
}

function heartbeat(){
  if(Date.now() - lastHeard > SILENCE_MS){ reconnect(); return; }
  if(!ws || ws.readyState!==1){ reconnect(); return; }
  try{ ws.send(JSON.stringify({ topic:'phoenix', event:'heartbeat', payload:{}, ref:String(++ref) })); }
  catch(e){ reconnect(); }
}

function teardown(){
  if(beat){ clearInterval(beat); beat = null; }
  ws = null; joinRef = null;
}

function close(){
  const sock = ws;
  teardown();
  setLive(false);
  if(sock){ try{ sock.close(); }catch(e){} }
}

function reconnect(){
  close();
  scheduleRetry();
}

function scheduleRetry(wait){
  if(retryTimer || !started) return;
  /* Nothing is on screen to update, so nothing is worth a retry — the
     visibilitychange handler below reconnects on the way back in. */
  if(document.visibilityState!=='visible') return;
  if(wait==null){ wait = BACKOFF[Math.min(tries, BACKOFF.length-1)]; tries++; }
  retryTimer = setTimeout(()=>{ retryTimer = null; open(); }, wait);
}

/* The channel said no. The socket itself is fine and Phoenix would hold
   it open forever, unsubscribed — so it is dropped deliberately, or this
   browser would never find out that the publication had changed. */
function refused(){
  close();
  tries = 0;
  scheduleRetry(REFUSED_RETRY_MS);
}

/* ---------- lifecycle ---------- */
export function startRealtime(){
  if(started) return;
  started = true;
  if(!BACKEND || typeof WebSocket==='undefined'){ setLive(false); return; }

  /* Signing in or out changes the notifications filter, and a filter
     lives in the join — so the channel is rebuilt rather than patched.
     The access_token push alone would leave the old uid subscribed. */
  onAuthChange(()=>{ tries = 0; reconnect(); });

  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState!=='visible') return;
    if(live){ heartbeat(); return; }
    /* A socket that died while the tab was in the background left no
       retry behind — scheduleRetry() refuses to arm one for a screen
       nobody is looking at — so coming back is when it gets rebuilt.
       A retry that IS pending is left alone, deliberately: after a
       refused join that timer is the five-minute one, and tabbing away
       and back must not turn it into a handshake per glance. */
    if(!retryTimer) open();
  });

  /* A socket left open through a bfcache freeze comes back half-dead, so
     it is dropped on the way out and rebuilt on the way back — `pageshow`
     rather than visibilitychange, which a bfcache restore need not fire. */
  window.addEventListener('pagehide',()=>{ close(); });
  window.addEventListener('pageshow',()=>{ if(!live && !retryTimer) open(); });
  /* Coming back onto the network is worth jumping the queue for: the
     pending retry, if any, was armed for a connection that had no
     chance of working. */
  window.addEventListener('online',()=>{
    if(live) return;
    tries = 0;
    if(retryTimer){ clearTimeout(retryTimer); retryTimer = null; }
    reconnect();
  });

  open();
}
