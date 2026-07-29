"use strict";
/* ============================================================
   data/profiles — the `profiles` table ⇄ the app's `state.me`.

   One row per auth user, created the first time that user signs in and
   filled in by onboarding. On every later sign-in the row wins over
   whatever this browser remembers — that is what makes an account
   portable between devices.
   ============================================================ */
import { rest, optionalColumns } from './supabase.js';
import { registerUser } from './world.js';
import { LEVELS } from './catalog.js';

const levelName = n => (LEVELS.find(l=>l[0]===n)||LEVELS[0])[1];
const opt = optionalColumns(['avatar_key']);

/* the app's me-object → a profiles row */
export function meToRow(me, uid, handle, withAvatar=true){
  const row = {
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
  /* An R2 object key, never the image — same rule as posts.image_key.
     Omitted entirely (rather than sent as null) when the column may not
     exist yet, because a write naming it fails the same way a read does. */
  if(withAvatar) row.avatar_key = me.avatar || null;
  return row;
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
    avatar: row.avatar_key || '',
    /* Both are maintained by triggers (step-1.9.sql) and are read-only
       here — meToRow never writes them back. */
    points: row.points|0,
    level: row.level || 1,
    /* Notification switches (step-1.16.sql). Read here off `select=*` so
       an unrun migration simply leaves them undefined; written only by
       setNotifyPrefs(), never by meToRow — "Save profile" must not be
       able to silently reset what someone chose in the reminders sheet.
       The defaults match the column defaults. */
    notifySocial: row.notify_social===undefined ? true  : !!row.notify_social,
    notifyStreak: row.notify_streak===undefined ? false : !!row.notify_streak,
    notifyDigest: row.notify_digest===undefined ? false : !!row.notify_digest
  };
}

/* The three notification switches, written on their own. Uses its own
   optionalColumns() so that on a deploy where step-1.16.sql has not been
   run yet the toggles quietly do nothing instead of failing the save —
   same contract as avatar_key above. */
const notifyOpt = optionalColumns(['notify_social','notify_streak','notify_digest']);
export function setNotifyPrefs(uid, me){
  return notifyOpt.run(has=>{
    const body={};
    if(has('notify_social')) body.notify_social = !!me.notifySocial;
    if(has('notify_streak')) body.notify_streak = !!me.notifyStreak;
    if(has('notify_digest')) body.notify_digest = !!me.notifyDigest;
    return { path:`profiles?id=eq.${uid}`, method:'PATCH', body };
  });
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
     `city` must not blank out a city we already know. `avatar_key` is
     checked with `in` rather than for null, because null is its real
     value for everyone who hasn't picked a photo — and "they removed it"
     has to survive the merge in registerUser() just as "they added one"
     does. */
  if(row.city!=null)   u.city   = row.city || '';
  if(row.bio!=null)    u.bio    = row.bio  || '';
  if(row.points!=null) u.points = row.points|0;
  if('avatar_key' in row) u.avatar = row.avatar_key || '';
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
      const created = await opt.run(has=>({ path:'profiles', method:'POST',
        prefer:'return=representation', body: meToRow(me, uid, handle, has('avatar_key')) }));
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
  return opt.run(has=>{
    const row = meToRow(me, uid, clean(me.handle) || 'barista', has('avatar_key'));
    delete row.id;
    return { path:`profiles?id=eq.${uid}`, method:'PATCH', body:row };
  });
}

/* Just the photo. Deliberately not pushProfile(): picking an avatar
   should not also write back a half-typed username from the settings
   fields, and it must not be able to fail with a 409 on someone else's
   handle. `key` is an R2 object key, or null to go back to initials. */
export function pushAvatar(uid, key){
  return opt.run(has=>{
    if(!has('avatar_key')) throw new Error('Profile photos need supabase/step-1.13.sql');
    return { path:`profiles?id=eq.${uid}`, method:'PATCH', body:{ avatar_key: key || null } };
  });
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
/* `avatar_key` arrives with step-1.13.sql, run by hand while the app is
   already live — so every query naming it has to survive its absence.
   See optionalColumns() in data/supabase.js. */
const card = has => `id,handle,name,city,bio,avatar_color,level${has('avatar_key')?',avatar_key':''}`;

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
    opt.run(has=>`profiles?id=eq.${uid}&select=${card(has)}`),
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
  const rows = await opt.run(has=>{
    let q = `profiles?select=${card(has)}&id=neq.${uid}&order=created_at.desc&limit=${limit}`;
    if(blocked.length) q += `&id=not.in.(${blocked.map(id=>`"${id}"`).join(',')})`;
    return q;
  });
  return (rows||[]).map(r=>registerUser(rowToUser(r)));
}

/* Search people by name or username. */
export async function searchProfiles(uid, q, limit=8, blocked=[]){
  const term = q.trim().replace(/[%,()*]/g,'');
  if(!term) return [];
  const pat = `*${term}*`;
  const rows = await opt.run(has=>{
    let query = `profiles?select=${card(has)}&id=neq.${uid}&or=(handle.ilike.${pat},name.ilike.${pat},city.ilike.${pat})&limit=${limit}`;
    if(blocked.length) query += `&id=not.in.(${blocked.map(id=>`"${id}"`).join(',')})`;
    return query;
  });
  return (rows||[]).map(r=>registerUser(rowToUser(r)));
}
