"use strict";
/* ============================================================
   data/moderation — the admin's side of the report sheet.

   Every function here is a Postgres RPC (platform/supabase/step-1.27.sql),
   and every one of them checks is_admin() inside the database. Nothing
   in this file is a permission: hiding the admin row in Settings is a
   convenience, not a lock, and a hand-written fetch from the console
   gets a 42501 exactly like a tap would.

   Three things the API insists on, so the UI cannot forget them:

     * an action against a person requires a statement of reasons, in
       words, which is what that person is then sent;
     * every decision — including "leave it up" — writes an audit row;
     * closing a report is part of the same call, so a decision cannot
       be taken and left off the queue.

   All of it fails soft the same way the rest of data/ does: an unrun
   migration answers 404 for the function, which callers surface as "the
   moderation migration hasn't been run", never as a broken screen.
   ============================================================ */
import { rest } from './supabase.js';

/* PostgREST answers 404 for a function that does not exist yet, and 403
   / 42501 for one this account may not call. Both are worth telling
   apart on screen — one is a migration, the other is a permission. */
function callRpc(name, body){
  return rest(`rpc/${name}`,{ method:'POST', body })
    .catch(e=>{
      if(e && e.status===404) e.needsMigration = true;
      if(e && (e.status===403 || /42501/.test(e.message||''))) e.notAdmin = true;
      throw e;
    });
}

/* The queue. `status` is 'open' (the default view), one of the other
   report statuses, or 'all'. Returns the array the sheet renders:
   report + reporter + the target with its author, including targets
   that are already hidden — the moderator is the one person who has to
   be able to see what they are deciding about. */
export const fetchQueue = (status='open', limit=60) =>
  callRpc('mod_queue',{ p_status:status, p_limit:limit }).then(rows=>rows||[]);

/* The decisions, newest first. This is the answer to "what did you do
   about it", which is a question with a legal shape as well as a human
   one. */
export const fetchLog = (limit=60) =>
  callRpc('mod_log',{ p_limit:limit }).then(rows=>rows||[]);

/* ---------- pours ----------
   Hiding is the reversible one and the one the sheet leads with.
   Deleting is final for the row and, for the photo, only the start:
   the object stays in R2 and the audit row carries its key. */
export const hidePost = (postId, reason, statement, reportId=null, note=null) =>
  callRpc('mod_hide_post',{ p_post:postId, p_reason:reason, p_statement:statement, p_report:reportId, p_note:note });

export const unhidePost = (postId, reason='restored on review', statement=null, reportId=null) =>
  callRpc('mod_unhide_post',{ p_post:postId, p_reason:reason, p_statement:statement, p_report:reportId });

export const deletePost = (postId, reason, statement, reportId=null, note=null) =>
  callRpc('mod_delete_post',{ p_post:postId, p_reason:reason, p_statement:statement, p_report:reportId, p_note:note });

/* ---------- comments ---------- */
export const hideComment = (commentId, reason, statement, reportId=null, note=null) =>
  callRpc('mod_hide_comment',{ p_comment:commentId, p_reason:reason, p_statement:statement, p_report:reportId, p_note:note });

export const unhideComment = (commentId, reason='restored on review', statement=null, reportId=null) =>
  callRpc('mod_unhide_comment',{ p_comment:commentId, p_reason:reason, p_statement:statement, p_report:reportId });

export const deleteComment = (commentId, reason, statement, reportId=null, note=null) =>
  callRpc('mod_delete_comment',{ p_comment:commentId, p_reason:reason, p_statement:statement, p_report:reportId, p_note:note });

/* ---------- people ----------
   Days, not a date: a suspension that nobody set an end for is the one
   that turns into a forgotten ban. It lifts itself. */
export const suspendUser = (userId, days, reason, statement, reportId=null, note=null) =>
  callRpc('mod_suspend_user',{ p_user:userId, p_days:days, p_reason:reason, p_statement:statement, p_report:reportId, p_note:note });

export const unsuspendUser = (userId, reason='lifted', statement=null) =>
  callRpc('mod_unsuspend_user',{ p_user:userId, p_reason:reason, p_statement:statement });

/* ---------- deciding to do nothing ----------
   Its own action with its own audit row. A queue where dismissal is
   untracked cannot tell reviewed apart from ignored. */
export const dismissReport = (reportId, reason='no violation found', note=null) =>
  callRpc('mod_dismiss_report',{ p_report:reportId, p_reason:reason, p_note:note });

/* ---------- what gets said ----------
   Starting points, not boilerplate to send unread: the moderator edits
   the text before it goes, and what they send is what is stored on the
   audit row. Written in the second person and without euphemism —
   somebody is being told their pour came down, and "content policy
   violation" tells them nothing about what they did.

   English only, and deliberately: this is a one-person screen, and the
   German bundle exists to be read by users, not by its author. The
   statement itself can of course be typed in whatever language the
   person being written to speaks. */
export const STATEMENTS = {
  hide_post: 'Your pour has been hidden from Crema because it broke our rules on {reason}. It is not visible to other people. Reply to hello@crema-app.com if you think this is wrong and it will be looked at again.',
  delete_post: 'Your pour has been removed from Crema because it broke our rules on {reason}. Reply to hello@crema-app.com if you think this is wrong.',
  hide_comment: 'Your comment has been hidden from Crema because it broke our rules on {reason}. Reply to hello@crema-app.com if you think this is wrong and it will be looked at again.',
  delete_comment: 'Your comment has been removed from Crema because it broke our rules on {reason}. Reply to hello@crema-app.com if you think this is wrong.',
  suspend_user: 'Your account is paused for {days} days because of repeated breaches of our rules ({reason}). You can still read Crema; you cannot post or comment until then. Reply to hello@crema-app.com if you think this is wrong.'
};

export function statementFor(action, { reason='our content rules', days=7 }={}){
  return (STATEMENTS[action]||'').replace('{reason}', reason).replace('{days}', String(days));
}
