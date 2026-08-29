"use strict";
/* ============================================================
   store/live — the app keeping up with the world while you look at it.

   Until this existed the feed, the bell and an open thread were only
   ever as fresh as the last fetch, and the only thing that caused
   another one was leaving the app and coming back (refreshOnReturn()
   in ui/actions.js). Someone poured, and you found out tomorrow.

   Two ways in, one way out:

     data/realtime.js   a socket says "posts changed"     (instant)
     the poller below   asks every 60s while you're here  (fallback)

   Both end in the same handlers, and the handlers re-ask through the
   ordinary data/ paths — so the feed's filters, the block list and RLS
   are applied by the same code that applies them on a cold load. The
   socket is an optimisation on *when*, never on *what*.

   The poller is not a temporary scaffold. Realtime needs `posts` and
   friends in the `supabase_realtime` publication (platform/supabase/
   step-1.25.sql), and WebSockets are the first thing a corporate proxy
   blocks. So the feature turns itself down rather than off — which is
   about the socket being refused, not about the schema. The schema now
   arrives before the code that needs it does.

   This layer owns state, never pixels — it is below ui/. It says what
   changed; ui/actions.js decides what that is allowed to repaint.
   ============================================================ */
import { LIVE_POLL_MS } from '../config.js';
import { onChange, onRealtimeStatus, startRealtime } from '../data/realtime.js';
import { applyRowEdit } from '../data/posts.js';
import { fetchNotifications } from '../data/notifications.js';
import { fetchFollowRequests } from '../data/social.js';
import { noReactions } from '../data/reactions.js';
import { state, session, social, findPost, forgetPost, fetchArrivals } from './store.js';

/* ---------- what ui/ hears ----------
   'feed'    pours arrived, or one was deleted — repaint the list
   'bell'    the inbox changed — repaint the appbar
   'post'    counts on one post moved — patch that card in place
   'thread'  a comment landed on a post — refresh it if it is open
   'requests' someone asked to follow you, or stopped — repaint the
              block above the feed */
const listeners = new Set();
export function onLive(fn){ listeners.add(fn); return () => listeners.delete(fn); }
function emit(what, arg){
  listeners.forEach(fn=>{ try{ fn(what, arg); }catch(e){ console.warn('live listener failed',e); } });
}

const myUid = () => (session && session.user) ? session.user.id : null;

/* A write of your own has already been applied optimistically by
   ui/actions.js — counting the echo would double it. */
const isMine = row => !!row && !!myUid() && row.user_id===myUid();

function debounce(fn, ms){
  let timer=null;
  return () => { clearTimeout(timer); timer=setTimeout(()=>{ timer=null; fn(); }, ms); };
}

/* ---------- the feed ----------
   Debounced because a burst is normal: a friend posting wakes `posts`,
   and the trigger that fans it out wakes `notifications` a moment
   later. One request per burst, not one per row. */
let checking=false;
async function checkFeed(){
  if(checking) return;
  checking=true;
  try{ if(await fetchArrivals()) emit('feed'); }
  finally{ checking=false; }
}
const checkFeedSoon = debounce(checkFeed, 400);

/* ---------- the bell ----------
   Refetched rather than built from the row: notificationOf() needs the
   actor's profile embed, and one request buys the whole inbox in the
   order the sheet renders it. */
async function checkBell(){
  const uid=myUid(); if(!uid) return;
  try{
    state.notifications=await fetchNotifications(uid);
    emit('bell');
  }catch(e){ console.warn('live notifications failed',e); }
}
const checkBellSoon = debounce(checkBell, 500);

/* ---------- follow requests ----------
   The block above the feed is the thing that actually answers a follow
   request, and until this existed it was only ever as fresh as the last
   hydrateRest() — someone asked to follow you and you found out by
   reopening the app. `follows` is deliberately not a Realtime table
   (one per-subscriber RLS check on every write, for a row that changes
   rarely), but the trigger in step-1.15.sql writes a `follow_request`
   notification to *you* on the same insert, and that table we do watch.
   So the notification is the signal and this re-asks through the
   ordinary path, exactly like the bell.

   Refetched rather than built from the row for the same reason as the
   bell: the block needs the asker's profile, and the row carries an id.

   Silent when nothing moved — the poller calls this every 60s, and a
   render per minute that changes no pixels would fight the reader's
   scroll for nothing. */
/* Accepting and declining are optimistic: ui/actions.js takes the row
   out of the block before the write lands. A refetch inside that window
   reads a row the server still calls pending and puts it straight back,
   so an answered request flickers back onto the screen. Held while an
   answer is in flight, and asked once when the last one is done. */
let answering=0;
export async function whileAnsweringRequest(fn){
  answering++;
  try{ return await fn(); }
  finally{ answering--; if(!answering) checkRequestsSoon(); }
}

async function checkRequests(){
  const uid=myUid(); if(!uid || answering) return;
  try{
    const reqs=await fetchFollowRequests(uid);
    const was=(social.requests||[]).map(r=>r.id).join(',');
    if(reqs.map(r=>r.id).join(',')===was) return;
    social.requests=reqs;
    emit('requests');
  }catch(e){ console.warn('live follow requests failed',e); }
}
const checkRequestsSoon = debounce(checkRequests, 500);

/* ---------- wiring ---------- */
function wire(){
  onChange('posts', ev=>{
    if(ev.type==='DELETE'){ if(forgetPost(ev.row.id)) emit('feed'); return; }
    if(ev.type==='UPDATE'){
      const p=findPost(ev.row.id); if(!p) return;
      applyRowEdit(p, ev.row);
      emit('feed');
      return;
    }
    /* INSERT. Your own pour is already on screen — submitPost() put it
       there — and fetchArrivals() would drop it as known anyway; this
       just saves the round trip. */
    if(isMine(ev.row)) return;
    checkFeedSoon();
  });

  onChange('notifications', ev=>{
    checkBellSoon();
    /* Only the one type moves the queue. An unknown row type means an
       older payload than this client knows about — ask anyway rather
       than swallow a request. */
    if(!ev.row || !ev.row.type || ev.row.type==='follow_request') checkRequestsSoon();
  });

  onChange('comments', ev=>{
    if(isMine(ev.row)) return;
    /* A DELETE carries the primary key and nothing else, so there is no
       post_id to count down — the thread refresh below is what fixes
       the number, and only for a post someone is actually looking at. */
    const pid=ev.row.post_id||null;
    if(pid && ev.type==='INSERT'){
      const p=findPost(pid);
      if(p){ p.commentN=(p.commentN|0)+1; emit('post', pid); }
    }
    emit('thread', pid);
  });

  onChange('likes', ev=>{
    if(isMine(ev.row)) return;
    const p=findPost(ev.row.post_id); if(!p) return;
    p.likes=Math.max(0,(p.likes|0)+(ev.type==='INSERT'?1:-1));
    emit('post', p.id);
  });

  onChange('reactions', ev=>{
    if(isMine(ev.row)) return;
    const kind=ev.row.kind; if(!kind) return;
    const p=findPost(ev.row.post_id); if(!p) return;
    if(!p.reactions) p.reactions=noReactions();
    p.reactions[kind]=Math.max(0,(p.reactions[kind]|0)+(ev.type==='INSERT'?1:-1));
    emit('post', p.id);
  });
}

/* ---------- the polling fallback ----------
   Only while the tab is on screen: a backgrounded tab spends requests
   to move pixels nobody is looking at, and coming back has its own
   refresh (refreshOnReturn() in ui/actions.js).

   Likes and reactions are deliberately NOT polled. They are a count on
   a card, they are corrected by the next feed load anyway, and asking
   for them every minute is the difference between a fallback and a
   second, worse realtime. */
let poller=null;
function tick(){
  if(document.visibilityState!=='visible') return;
  checkFeed();
  checkBell();
  /* Also the way a *withdrawn* request leaves the block: only INSERTs on
     notifications are watched, so the delete that the withdrawal fires
     never reaches this browser. */
  checkRequests();
}
function poll(on){
  if(on && !poller) poller=setInterval(tick, LIVE_POLL_MS);
  if(!on && poller){ clearInterval(poller); poller=null; }
}

export function startLive(){
  wire();
  /* Polling starts on, and the socket turns it off once it has actually
     joined — not when it connects. A socket that opens and is then
     refused its subscription would otherwise leave nothing running. */
  poll(true);
  onRealtimeStatus(live=>{ poll(!live); if(live) tick(); });
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible' && poller) tick();
  });
  startRealtime();
}
