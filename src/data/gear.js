"use strict";
/* ============================================================
   data/gear — the shelf, on the server.

   The coffees and machines someone added themselves, what they wrote
   about them, which ones are favourites, and the drink names they
   invented. All of it used to live in the `localStorage` blob, which
   meant it did not exist on their laptop — see step-1.29.sql for why
   that was the wrong place to have asked people to write things down.

   One row per item (`user_gear`, keyed by user + kind + name), so two
   devices adding two different coffees both keep theirs rather than one
   overwriting the other.

   Writes go through three RPCs rather than a PostgREST upsert, because
   an upsert writes a WHOLE row: noting a coffee would clear `own` and
   drop the star. Each function below touches one thing.

   Every write is fire-and-forget from the caller's point of view — the
   store has already changed and the UI has already repainted, exactly
   as likes and saves work. A failure warns; it never blocks somebody
   from naming their coffee.
   ============================================================ */
import { rest } from './supabase.js';

const KINDS = { bean:'bean', machine:'machine', drink:'drink' };
const kindOf = k => KINDS[k] || (k==='machines' ? 'machine' : k==='beans' ? 'bean' : null);

/* Everything on one person's shelf, in one request. Favourites come
   back newest-first, which is the order the picker wants and the order
   the old local array had by construction. */
export async function fetchGear(uid){
  if(!uid) return [];
  const rows = await rest(
    `user_gear?select=kind,name,own,info,fav_at&user_id=eq.${uid}&order=fav_at.desc.nullslast,name.asc`);
  return (rows||[]).map(r=>({
    kind: r.kind, name: r.name, own: !!r.own,
    info: r.info || null, fav: !!r.fav_at
  }));
}

const call = (fn, body) => rest(`rpc/${fn}`, { method:'POST', body });

/* "This one is mine" — a coffee or machine the catalogue does not have.
   Idempotent server-side, so calling it for something already on the
   shelf is free and needs no check here. */
export function rememberGear(kind, name){
  const k = kindOf(kind), n = (name||'').trim();
  if(!k || !n) return Promise.resolve();
  return call('gear_remember', { p_kind:k, p_name:n });
}

/* What they wrote. `info` null clears it — and on an entry that is
   neither theirs nor starred, the server drops the row entirely, since
   the row was only ever the note. */
export function noteGear(kind, name, info){
  const k = kindOf(kind), n = (name||'').trim();
  if(!k || !n) return Promise.resolve();
  const empty = !info || !Object.keys(info).some(x=>(''+(info[x]||'')).trim());
  return call('gear_note', { p_kind:k, p_name:n, p_info: empty ? null : info });
}

/* The star. */
export function favGear(kind, name, on){
  const k = kindOf(kind), n = (name||'').trim();
  if(!k || !n) return Promise.resolve();
  return call('gear_fav', { p_kind:k, p_name:n, p_on: !!on });
}
