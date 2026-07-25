"use strict";
/* ============================================================
   store/persistence — the persistence seam.

   This is the ONE place that knows *where* data is kept. Today that
   is the browser's localStorage. To move to a real backend you write
   a second adapter with the same shape and hand it to the store —
   nothing else in the app changes.

   Adapter interface — every method is async, so a network adapter
   drops in without touching the store:
     read()        → the persisted blob, or null if none
     write(data)   → persist the blob; resolves true on success
     clear()       → remove the persisted blob

   localStorage is synchronous underneath; the async signatures just
   make the seam uniform. See ARCHITECTURE.md for the migration notes.
   ============================================================ */

export class LocalStoragePersistence {
  constructor(key){ this.key=key; }
  async read(){ try{ return JSON.parse(localStorage.getItem(this.key)); }catch(e){ return null; } }
  async write(data){ try{ localStorage.setItem(this.key,JSON.stringify(data)); return true; }catch(e){ /* quota — session only */ return false; } }
  async clear(){ try{ localStorage.removeItem(this.key); }catch(e){} }
}

/* ------------------------------------------------------------------
   The migration seam.

   Signed out → the demo world, in this browser, under the shared key.
   Signed in  → the same adapter under a key scoped to the user id, so
                two accounts on one browser never see each other's data.

   Note what this deliberately does NOT do: it does not ship the whole
   state blob to the server. Domains move to Postgres one at a time and
   each has its own module under data/ (posts.js today; follows, likes
   and comments in step 1.7). Whatever has not migrated yet keeps living
   in this blob, per user. That is what lets every step end in a working
   product instead of a half-migrated one.
   ------------------------------------------------------------------ */
export function makePersistence(session, key){
  return new LocalStoragePersistence(session ? `${key}:${session.user.id}` : key);
}
