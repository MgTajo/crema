"use strict";
/* ============================================================
   data/profiles — the `profiles` table ⇄ the app's `state.me`.

   One row per auth user, created the first time that user signs in and
   filled in by onboarding. On every later sign-in the row wins over
   whatever this browser remembers — that is what makes an account
   portable between devices.
   ============================================================ */
import { rest } from './supabase.js';
import { registerUser } from './world.js';
import { LEVELS } from './catalog.js';

const levelName = n => (LEVELS.find(l=>l[0]===n)||LEVELS[0])[1];

/* the app's me-object → a profiles row */
export function meToRow(me, uid, handle){
  return {
    id: uid,
    handle,
    /* No placeholder name: a fresh row is genuinely nameless until
       onboarding asks, and the UI asks rather than inventing one. */
    name: (me.name||'').trim(),
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
    premium: !!row.premium,
    /* Both are maintained by triggers (step-1.9.sql) and are read-only
       here — meToRow never writes them back. */
    points: row.points|0,
    level: row.level || 1
  };
}

/* a remote profile → the shape ui/ expects in the USERS map.
   Deliberately no follower/pour counts: this shape arrives with every
   embedded author on every post, comment and notification, and if it
   carried zeros it would wipe the real counts fetchUserCard() looked
   up. registerUser() supplies 0 for people we're seeing for the first
   time; counts only ever come from profile_counts. */
export function rowToUser(row){
  const u = {
    id: row.id,
    name: row.name || 'Barista',
    handle: '@' + (row.handle||'barista'),
    /* Straight into style="background:…", and users can PATCH their own
       row — so anything that isn't a plain hex colour is discarded. */
    color: /^#[0-9a-f]{3,8}$/i.test(row.avatar_color||'') ? row.avatar_color : '#8a5a30',
    level: row.level || 1,
    levelName: levelName(row.level || 1)
  };
  /* Same reasoning for the optional columns: a query that didn't select
     `city` must not blank out a city we already know. */
  if(row.city!=null)   u.city   = row.city || '';
  if(row.bio!=null)    u.bio    = row.bio  || '';
  if(row.points!=null) u.points = row.points|0;
  return u;
}

const clean = s => (s||'').toString().toLowerCase().replace(/^@+/,'').replace(/[^a-z0-9._]/g,'');

function deriveHandle(me, email){
  return clean(me.handle) || clean(me.name).slice(0,20) || clean((email||'').split('@')[0]) || 'barista';
}

/* Read the signed-in user's profile, creating a row on first sign-in.
   Returns { me, created } — `created` is what tells the app this is a
   brand-new account and onboarding should run. Throws if the backend
   could not be reached; the caller decides what to do about it. */
export async function ensureProfile(uid, email, me){
  const rows = await rest(`profiles?id=eq.${uid}&select=*`);
  if(rows && rows.length) return { me:rowToMe(rows[0]), created:false };

  /* First sign-in: claim a handle. It is unique per the schema, so a
     collision is expected rather than exceptional — retry with a suffix. */
  const base = deriveHandle(me, email);
  for(let attempt=0; attempt<5; attempt++){
    const handle = attempt===0 ? base : `${base}${Math.floor(Math.random()*9000)+1000}`;
    try{
      const created = await rest('profiles',{ method:'POST', prefer:'return=representation',
        body: meToRow(me, uid, handle) });
      return { me:rowToMe(created[0]), created:true };
    }catch(e){
      if(e.status===409) continue;      // handle taken, try another
      throw e;
    }
  }
  throw new Error('Could not claim a username — try a different one in Settings.');
}

/* Push local profile edits up. A 409 means the username is taken — the
   caller surfaces that, because it is the user's to fix. */
export async function pushProfile(uid, me){
  const row = meToRow(me, uid, clean(me.handle) || 'barista');
  delete row.id;
  return rest(`profiles?id=eq.${uid}`,{ method:'PATCH', body:row });
}

/* Points and level after something that moves them (a new pour, a
   deleted one). The triggers have already run server-side; this reads
   the result rather than guessing at it locally. */
export async function fetchScore(uid){
  const rows = await rest(`profiles?id=eq.${uid}&select=points,level`);
  const r = (rows && rows[0]) || {};
  return { points: r.points|0, level: r.level || 1 };
}

/* ---------- reads about other people ---------- */
const CARD = 'id,handle,name,city,bio,avatar_color,level';

/* Follower / following / pour counts, from the profile_counts view.
   Counted in Postgres rather than kept in columns, so they can't drift. */
export async function fetchProfileCounts(uid){
  const rows = await rest(`profile_counts?profile_id=eq.${uid}&select=*`);
  const r = (rows && rows[0]) || {};
  return { followers:r.follower_count|0, following:r.following_count|0, pours:r.pour_count|0 };
}

/* One profile, with its counts, for the user sheet. */
export async function fetchUserCard(uid){
  const [rows, counts] = await Promise.all([
    rest(`profiles?id=eq.${uid}&select=${CARD}`),
    fetchProfileCounts(uid).catch(()=>({followers:0,following:0,pours:0}))
  ]);
  if(!rows || !rows.length) return null;
  const u = registerUser(rowToUser(rows[0]));
  u.followerN = counts.followers; u.pourN = counts.pours;
  return u;
}

/* People to follow: the most recent accounts that aren't you and aren't
   blocked. Real accounts only — when Crema is empty, so is this list. */
export async function fetchSuggestedProfiles(uid, blocked=[], limit=10){
  let q = `profiles?select=${CARD}&id=neq.${uid}&order=created_at.desc&limit=${limit}`;
  if(blocked.length) q += `&id=not.in.(${blocked.map(id=>`"${id}"`).join(',')})`;
  const rows = await rest(q);
  return (rows||[]).map(r=>registerUser(rowToUser(r)));
}

/* Search people by name or username. */
export async function searchProfiles(uid, q, limit=8, blocked=[]){
  const term = q.trim().replace(/[%,()*]/g,'');
  if(!term) return [];
  const pat = `*${term}*`;
  let query = `profiles?select=${CARD}&id=neq.${uid}&or=(handle.ilike.${pat},name.ilike.${pat},city.ilike.${pat})&limit=${limit}`;
  if(blocked.length) query += `&id=not.in.(${blocked.map(id=>`"${id}"`).join(',')})`;
  const rows = await rest(query);
  return (rows||[]).map(r=>registerUser(rowToUser(r)));
}
