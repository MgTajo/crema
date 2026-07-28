"use strict";
/* ============================================================
   data/notifications — the inbox, backed by real rows.

   Rows are created by Postgres triggers on likes/comments/follows
   (see supabase/step-1.8.sql), never by the client — there is no
   insert policy, so a client cannot forge one. Reads are owner-only.

   The inbox UI already renders an array of {u, text, time, read, …};
   this maps the table onto that shape, so overlayNotifs() is unchanged.
   ============================================================ */
import { agoFrom } from '../core/util.js';
import { rest, optionalColumns } from './supabase.js';
import { registerUser } from './world.js';
import { rowToUser } from './profiles.js';

/* Added by step-1.13.sql, run by hand against a live app — see
   optionalColumns() in data/supabase.js. */
const opt = optionalColumns(['avatar_key']);
const select = has => 'id,type,body,post_id,cafe_id,challenge_id,read,created_at,'
             + `profiles!notifications_actor_id_fkey(id,handle,name,city,avatar_color,level${has('avatar_key')?',avatar_key':''})`;

export function notificationOf(row){
  if(row.profiles) registerUser(rowToUser(row.profiles));
  return {
    id: row.id,
    u: row.profiles ? row.profiles.id : null,
    type: row.type,
    text: row.body || row.type,
    time: agoFrom(row.created_at),
    read: !!row.read,
    post: row.post_id || null,
    cafe: row.cafe_id || null,
    challenge: row.challenge_id || null
  };
}

export async function fetchNotifications(uid, { limit=50 }={}){
  const rows = await opt.run(has=>`notifications?select=${select(has)}&user_id=eq.${uid}&order=created_at.desc&limit=${limit}`);
  return (rows||[]).map(notificationOf);
}

export const markAllRead = uid =>
  rest(`notifications?user_id=eq.${uid}&read=is.false`,{ method:'PATCH', body:{ read:true } });
