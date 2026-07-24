"use strict";
/* ============================================================
   store/persistence — the persistence seam.

   This is the ONE place that knows *where* data is kept. Today that
   is the browser's localStorage. To move to a real backend you write
   a second adapter with the same shape and hand it to the store —
   nothing else in the app changes.

   Adapter interface
   -----------------
     read()        → the persisted blob, or null if none
     write(data)   → persist the blob; returns true on success
     clear()       → remove the persisted blob

   The current app treats reads/writes synchronously. A network
   adapter would return Promises here; see RemotePersistence below
   for the intended shape, and ARCHITECTURE.md for the migration
   notes (making the store's load()/save() awaitable).
   ============================================================ */

export class LocalStoragePersistence {
  constructor(key){ this.key=key; }
  read(){ try{ return JSON.parse(localStorage.getItem(this.key)); }catch(e){ return null; } }
  write(data){ try{ localStorage.setItem(this.key,JSON.stringify(data)); return true; }catch(e){ /* quota — session only */ return false; } }
  clear(){ try{ localStorage.removeItem(this.key); }catch(e){} }
}

/* ------------------------------------------------------------------
   Sketch of the backend adapter for the target iOS/Android app.
   Drop-in replacement once the store's load()/save() are awaited.

   export class RemotePersistence {
     constructor(baseUrl, token){ this.baseUrl=baseUrl; this.token=token; }
     async read(){
       const r=await fetch(`${this.baseUrl}/me/state`,{headers:{Authorization:`Bearer ${this.token}`}});
       return r.ok ? r.json() : null;
     }
     async write(data){
       const r=await fetch(`${this.baseUrl}/me/state`,{method:'PUT',
         headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},
         body:JSON.stringify(data)});
       return r.ok;
     }
     async clear(){
       await fetch(`${this.baseUrl}/me/state`,{method:'DELETE',headers:{Authorization:`Bearer ${this.token}`}});
     }
   }
   ------------------------------------------------------------------ */
