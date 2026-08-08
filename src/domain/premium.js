"use strict";
/* ============================================================
   domain/premium — what opens Premium.

   Pure rules: no DOM, no network, no state. The same answer is
   needed in the settings sheet, in every lock that raises the offer,
   and — in the same words — in plpgsql, because a check that only
   runs in the browser is a message rather than a lock. The server
   copy lives in platform/supabase/step-1.21.sql, and the two have to
   be changed together.

   One shared code rather than a key per person. Crema is small
   enough that the bottleneck is the conversation, not the
   cryptography, and a code someone can say out loud in a reply is
   one they pass on to the next person. Rotating it is one line here
   and one line of SQL.
   ============================================================ */

/* Where a code comes from. The same inbox the café pilot writes to —
   there is one address behind Crema, and inventing a second one only
   costs somebody a bounced mail. */
export const PREMIUM_MAIL='hello@crema-app.com';

/* Compared normalised, because nobody types a code the way it is
   printed. "first pour", "First-Pour" and "FIRSTPOUR" are the same
   code, and rejecting one of them for a space is a support mail
   neither side wanted. */
export const PREMIUM_CODE='FIRSTPOUR';
export const normalizeCode = s => (''+(s==null?'':s)).toUpperCase().replace(/[^A-Z0-9]/g,'');
export const codeValid = s => { const c=normalizeCode(s); return !!c && c===PREMIUM_CODE; };
