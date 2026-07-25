"use strict";
/* ============================================================
   data/profiles — the `profiles` table ⇄ the app's `state.me`.

   One row per auth user. On first sign-in the row is created from the
   onboarding data the user already entered locally, so signing in
   never feels like starting over. On later sign-ins the row wins —
   that is what makes an account portable between devices.
   ============================================================ */
import { rest } from './supabase.js';
import { LEVELS } from './catalog.js';

const levelName = n => (LEVELS.find(l=>l[0]===n)||LEVELS[0])[1];

/* the app's me-object → a profiles row */
export function meToRow(me, uid, handle){
  return {
    id: uid,
    handle,
    name: (me.name||'').trim() || 'Barista',
    city: (me.city||'').trim() || null,
    bio: me.bio || null,
    machine_brand: me.machineBrand || null,
    machine_model: me.machineModel || null,
    fav_drink: me.favDrink || null,
    fav_milk: me.favMilk || null,
    premium: !!me.premium
  };
}

/* a profiles row → the app's me-object */
export function rowToMe(row){
  return {
    name: row.name || '',
    handle: row.handle || '',
    city: row.city || '',
    bio: row.bio || '',
    machineBrand: row.machine_brand || '',
    machineModel: row.machine_model || '',
    favDrink: row.fav_drink || 'Cappuccino',
    favMilk: row.fav_milk || 'Whole milk',
    premium: !!row.premium
  };
}

/* a remote profile → the shape ui/ expects in the USERS map */
export function rowToUser(row){
  return {
    id: row.id,
    name: row.name || 'Barista',
    handle: '@' + (row.handle||'barista'),
    color: row.avatar_color || '#8a5a30',
    level: row.level || 1,
    levelName: levelName(row.level || 1),
    city: row.city || '',
    followerN: 0, pourN: 0,
    bio: row.bio || ''
  };
}

const clean = s => (s||'').toString().toLowerCase().replace(/^@+/,'').replace(/[^a-z0-9._]/g,'');

function deriveHandle(me, email){
  return clean(me.handle) || clean(me.name).slice(0,20) || clean((email||'').split('@')[0]) || 'barista';
}

/* Read the signed-in user's profile, creating it from local state on
   first sign-in. Returns the me-object to merge into the store, or null
   if the backend could not be reached (caller stays in local mode). */
export async function ensureProfile(uid, email, me){
  const rows = await rest(`profiles?id=eq.${uid}&select=*`);
  if(rows && rows.length) return rowToMe(rows[0]);

  /* First sign-in: claim a handle. It is unique per the schema, so a
     collision is expected rather than exceptional — retry with a suffix. */
  const base = deriveHandle(me, email);
  for(let attempt=0; attempt<5; attempt++){
    const handle = attempt===0 ? base : `${base}${Math.floor(Math.random()*9000)+1000}`;
    try{
      const created = await rest('profiles',{ method:'POST', prefer:'return=representation',
        body: meToRow(me, uid, handle) });
      return rowToMe(created[0]);
    }catch(e){
      if(e.status===409) continue;      // handle taken, try another
      throw e;
    }
  }
  throw new Error('Could not claim a username — try a different one in Settings.');
}

/* Push local profile edits up. Fire-and-forget at the call site. */
export async function pushProfile(uid, me){
  const row = meToRow(me, uid, clean(me.handle) || 'barista');
  delete row.id;
  return rest(`profiles?id=eq.${uid}`,{ method:'PATCH', body:row });
}
