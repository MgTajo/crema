"use strict";
/* ============================================================
   data/notifications — the inbox, backed by real rows.

   Rows are created by Postgres triggers on likes/comments/follows
   (see platform/supabase/step-1.8.sql), never by the client — there is no
   insert policy, so a client cannot forge one. Reads are owner-only.

   The inbox UI already renders an array of {u, text, time, read, …};
   this maps the table onto that shape, so overlayNotifs() is unchanged.
   ============================================================ */
import { agoFrom } from '../core/util.js';
import { t } from '../i18n.js';
import { rest, optionalColumns } from './supabase.js';
import { registerUser } from './world.js';
import { rowToUser } from './profiles.js';

/* Added by step-1.13.sql, run by hand against a live app — see
   optionalColumns() in data/supabase.js. */
const opt = optionalColumns(['avatar_key']);
const select = has => 'id,type,body,post_id,cafe_id,challenge_id,read,created_at,'
             + `profiles!notifications_actor_id_fkey(id,handle,name,city,avatar_color,level,premium${has('avatar_key')?',avatar_key':''})`;

export function notificationOf(row){
  if(row.profiles) registerUser(rowToUser(row.profiles));
  return {
    id: row.id,
    u: row.profiles ? row.profiles.id : null,
    type: row.type,
    text: row.body || row.type,
    time: agoFrom(row.created_at),
    at: row.created_at,          // ui/timeago.js re-reads this; `time` is only the first label
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

/* ---------- saying it in the reader's language ----------
   Every body above was composed by a Postgres trigger, in English,
   with no idea who would open the inbox — the row is written once and
   read by whoever the notification is for. So the whole sentence is a
   translation key, matched literally in i18n.de.js.

   The one body the server builds out of parts is the challenge payout
   (step-1.17.sql): the title and the points are substituted in before
   the row is written, so an exact match is impossible and the pieces
   are pulled back out here instead. The title is itself a value from
   challenge_templates and gets the same treatment.

   Anything with no German — a body from a migration newer than the
   bundle — falls back to the English the server sent, which is what
   t() does anyway. Nothing here can fail to render. */
const CHALLENGE_DONE=/^Challenge complete: (.+) · \+(\d+) points$/;

export function notifBody(body){
  const s=(body||'').trim();
  if(!s) return '';
  const m=s.match(CHALLENGE_DONE);
  if(m) return t('Challenge complete: {title} · +{n} points',{ title:t(m[1]), n:m[2] });
  return t(s);
}

export const markAllRead = uid =>
  rest(`notifications?user_id=eq.${uid}&read=is.false`,{ method:'PATCH', body:{ read:true } });
