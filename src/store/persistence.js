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

   The key is scoped to the signed-in user's id, so two accounts on one
   browser never see each other's data.

   Note what this deliberately does NOT do: it does not ship the whole
   state blob to the server. Posts, follows, likes, comments, challenge
   entries and notifications are all rows in Postgres, each with its own
   module under data/. What lives in this blob is the small remainder —
   theme, the create-sheet defaults, custom beans — plus a cache of the
   last-seen feed so the PWA opens with something on screen.
   ------------------------------------------------------------------ */
export function makePersistence(session, key){
  return new LocalStoragePersistence(session ? `${key}:${session.user.id}` : key);
}
