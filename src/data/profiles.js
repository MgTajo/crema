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
    /* Sent, but no longer obeyed on the way up: since step-1.21.sql a
       false→true here is silently reverted by the guard trigger, and
       only redeemPremium() below can raise it. Kept in the row so that
       turning Premium *off* still works from an ordinary profile save —
       giving something up should never need a code. */
    premium: !!me.premium
  };
  /* An R2 object key, never the image — same rule as posts.image_key. */
  row.avatar_key = me.avatar || null;
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
    /* Written by this client, but read back from the row like everything
       else: the row is what other people see, so it is the honest answer
       to "which badges do I have". meToRow never sends it — pushBadges()
       does, on its own, when the set actually grows. */
    badges: Array.isArray(row.badges) ? row.badges : [],
    /* Notification switches (step-1.16.sql). Read here off `select=*` so
       an unrun migration simply leaves them undefined; written only by
       setNotifyPrefs(), never by meToRow — "Save profile" must not be
       able to silently reset what someone chose in the reminders sheet.
       The defaults match the column defaults, all three on since
       step-1.19.sql. */
    notifySocial: row.notify_social===undefined ? true : !!row.notify_social,
    notifyStreak: row.notify_streak===undefined ? true : !!row.notify_streak,
    notifyDigest: row.notify_digest===undefined ? true : !!row.notify_digest,
    /* step-1.20.sql. Same undefined-means-not-run-yet contract, same
       default-true reasoning: nothing sends without the device having
       granted push in the first place. */
    notifyMorning: row.notify_morning===undefined ? true : !!row.notify_morning,
    /* step-1.30.sql. A friend's morning is a different volume of thing
       from somebody answering you — bounded by how many people you
       follow rather than by how much you post — so it gets its own
       switch instead of riding notify_social. Same
       undefined-means-not-run-yet contract, same default. */
    notifyFriends: row.notify_friends===undefined ? true : !!row.notify_friends,
    /* step-1.27.sql. Read-only here in the strongest sense: meToRow
       never writes either of them back, and a client PATCH that tried
       would be reverted by profiles_guard_admin() in Postgres. This
       flag decides whether Settings shows the moderation row — it is
       not what decides whether moderation works, which every mod_*
       function checks for itself. */
    isAdmin: !!row.is_admin,
    /* A timestamp, not a flag, so it expires without anyone
       remembering to lift it. Null for almost everybody. */
    suspendedUntil: row.suspended_until || null
  };
}

/* The five notification switches, written on their own. They arrived
   across step-1.16, 1.20 and 1.30, and until the release workflow
   existed each one had to be able to not be there yet. */
export function setNotifyPrefs(uid, me){
  return rest(`profiles?id=eq.${uid}`, { method:'PATCH', body:{
    notify_social:  !!me.notifySocial,
    notify_streak:  !!me.notifyStreak,
    notify_digest:  !!me.notifyDigest,
    notify_morning: !!me.notifyMorning,
    notify_friends: !!me.notifyFriends
  }});
}

/* Which timezone this person's mornings happen in, as minutes east of
   UTC — the sign convention Postgres wants, hence the negation of
   getTimezoneOffset(), which counts the other way.

   The database can't work this out on its own: it sees a UTC timestamp
   and nothing else, so without this "log a coffee on five different
   days" and "before 8am" would be measured in UTC and be wrong for
   everyone outside it (platform/supabase/step-1.17.sql). Written on sign-in
   rather than once at signup so it follows people who travel or move. */
export function setTimezone(uid){
  return rest(`profiles?id=eq.${uid}`,
    { method:'PATCH', body:{ tz_offset: -new Date().getTimezoneOffset() } });
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
  /* The gold ring is drawn wherever an avatar is, so it has to travel
     with every embedded author rather than being looked up per face.
     `in row` rather than a null check, for the same reason avatar_key
     uses one: false is its real value for most people, and "they let
     Premium lapse" has to survive registerUser()'s merge exactly as
     "they redeemed a code" does. */
  if('premium' in row) u.premium = !!row.premium;
  /* Same `in row` rule as the two above: a query that did not select
     badges must not blank out the ones registerUser() already merged
     in, and an empty array is a real value — it is what everybody who
     has earned none has. */
  if('badges' in row) u.badges = Array.isArray(row.badges) ? row.badges : [];
  return u;
}

const clean = s => (s||'').toString().toLowerCase().replace(/^@+/,'').replace(/[^a-z0-9._]/g,'');

function deriveHandle(me, email){
  return clean(me.handle) || clean(me.name).slice(0,20) || clean((email||'').split('@')[0]) || 'barista';
}

/* Is this username already somebody's?

   Answerable signed out — `profiles are public` for select (schema.sql)
   — which is the whole reason sign-up can ask before the account
   exists. Without it a taken username is only discovered by
   ensureProfile(), which quietly suffixes it with four digits and never
   says so.

   A network failure answers "no" on purpose: the suffix retry is still
   there behind it, so the worst case is the behaviour we had, and
   nobody is stopped from signing up because a check failed. */
export async function handleTaken(handle){
  const h = clean(handle);
  if(!h) return false;
  try{
    const rows = await rest(`profiles?handle=eq.${encodeURIComponent(h)}&select=id&limit=1`);
    return !!(rows && rows.length);
  }catch(e){ console.warn('username check failed',e); return false; }
}

/* Read the signed-in user's profile, creating a row on first sign-in.
   Returns { me, created } — `created` is what tells the app this is a
   brand-new account. Throws if the backend could not be reached; the
   caller decides what to do about it.

   Since sign-up asks for the setup first, `me` is normally already
   filled in — so the row this creates is a real profile rather than the
   nameless placeholder it used to be, and onboarding has nothing left to
   ask (syncProfile in ui/actions.js). It still has to survive an empty
   `me`: a first Google sign-in from the "Sign in" side, or a browser
   whose sign-up draft never made it, both land here with nothing, and
   that is what the onboarding sheet is now for. */
export async function ensureProfile(uid, email, me){
  const rows = await rest(`profiles?id=eq.${uid}&select=*`);
  if(rows && rows.length) return { me:rowToMe(rows[0]), created:false };

  /* First sign-in: claim a handle. It is unique per the schema, so a
     collision is expected rather than exceptional — retry with a suffix. */
  const base = deriveHandle(me, email);
  for(let attempt=0; attempt<5; attempt++){
    const handle = attempt===0 ? base : `${base}${Math.floor(Math.random()*9000)+1000}`;
    try{
      const created = await rest('profiles', { method:'POST',
        prefer:'return=representation', body: meToRow(me, uid, handle) });
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
/* ------------------------------------------------------------
   The badges this person has earned, written to their own row.

   Its own function rather than a field on meToRow(), because the two
   are written at different moments and for different reasons: a profile
   is saved when somebody presses Save, and badges change when they post
   a coffee. Folding them together would mean either writing badges on
   every profile save (pointless) or waiting for one (badges that appear
   on your profile the next time you rename yourself).

   Fire and forget at the call site — see syncBadges() in store.js. A
   badge that fails to reach the row is re-sent on the next open, and
   nothing on screen is waiting for it.
   ------------------------------------------------------------ */
export async function pushBadges(uid, ids){
  return rest(`profiles?id=eq.${uid}`, { method:'PATCH', body:{ badges: ids } });
}

export async function pushProfile(uid, me){
  const row = meToRow(me, uid, clean(me.handle) || 'barista');
  delete row.id;
  return rest(`profiles?id=eq.${uid}`, { method:'PATCH', body:row });
}

/* ---------- Premium ----------
   The unlock that counts happens in Postgres: redeem_premium() is the
   only thing that can raise the flag (see platform/supabase/step-1.21.sql),
   so this is a real switch on a real row rather than a local boolean —
   it survives a reinstall and it follows the account to another device.
   The client checks the code first only so the wrong one can be
   answered instantly and offline.

   Returns false for a wrong code rather than throwing: that is an
   answer, not a failure, and the caller says so in the field.

   There used to be a fallback here for a database where step-1.21 had
   not been run: PATCH profiles.premium directly, which worked precisely
   because the guard trigger was not there either. It went with
   optionalColumns() and for the same reason — a client that can raise
   its own Premium flag is worth keeping only while the alternative is a
   broken screen, and that window no longer exists. */
export async function redeemPremium(code){
  const ok = await rest('rpc/redeem_premium', { method:'POST', body:{ code } });
  return ok===true || (Array.isArray(ok) && ok[0]===true);
}
/* Giving it up. Always allowed, never a code, never a conversation. */
export function dropPremium(uid){
  return rest(`profiles?id=eq.${uid}`, { method:'PATCH', body:{ premium:false } });
}

/* Just the name. Deliberately not pushProfile(), for the same reason
   pushAvatar() isn't: this runs as a background repair (see syncProfile
   in ui/actions.js), and pushProfile would also send the handle — which
   can come back 409 on someone else's username and turn a silent fix
   into a silent failure. One column, nothing to collide with. */
export function pushName(uid, name){
  return rest(`profiles?id=eq.${uid}`, { method:'PATCH', body:{ name:(name||'').trim() } });
}

/* Just the photo. Deliberately not pushProfile(): picking an avatar
   should not also write back a half-typed username from the settings
   fields, and it must not be able to fail with a 409 on someone else's
   handle. `key` is an R2 object key, or null to go back to initials. */
export function pushAvatar(uid, key){
  return rest(`profiles?id=eq.${uid}`, { method:'PATCH', body:{ avatar_key: key || null } });
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
/* `badges` rides along with every face the app draws, for the same
   reason `premium` does: a badge is now something OTHER people see, so
   it has to arrive with the author embed rather than needing a lookup
   of its own. See migrations/20260905090000_badges_are_public.sql. */
const CARD = 'id,handle,name,city,bio,avatar_color,level,premium,avatar_key,badges';

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

/* Profiles by exact username, for the @mentions in a comment thread.
   mentionify() can only link a handle it has an id for, so a mention of
   someone who is nowhere else on the screen renders as plain text —
   correct, but a dead end. This is what turns it back into a link.

   Handles are stored lowercase (see clean() above), so the lookup
   lowercases too rather than asking Postgres to. */
export async function fetchProfilesByHandles(handles, limit=20){
  const list=[...new Set((handles||[]).map(clean).filter(Boolean))].slice(0,limit);
  if(!list.length) return [];
  const rows = await rest(
    `profiles?select=${CARD}&handle=in.(${list.map(h=>`"${h}"`).join(',')})`);
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
