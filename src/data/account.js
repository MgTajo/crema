"use strict";
/* ============================================================
   data/account — taking a copy of your account, and taking it away.

   Step 3.3 of brain/13-infrastructure-plan.md. Two calls, one of them
   irreversible, kept in their own module because that is what they have
   in common: everything else under data/ reads and writes rows, and
   these two act on the account itself.

   Both are thin on purpose. The export is one RPC — the database
   assembles the whole document, because RLS deliberately hides some of
   a person's own rows from them (client_errors is write-only to its
   author, moderation decisions are admin-only) and a client-side
   assembly could only ever export the readable half. The deletion is
   one Edge Function, because removing an auth user needs the
   service-role key and that key must never be in a browser.
   ============================================================ */
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';
import { rest, accessToken } from './supabase.js';

/* Everything Crema holds about the signed-in caller, as one object.
   No argument: the function reads auth.uid(), so there is no id here
   for anything to get wrong. */
export function exportMyData(){
  return rest('rpc/export_my_data', { method:'POST', body:{} });
}

/* Irreversible. `confirm` is the user's own @handle, typed out; the
   Edge Function checks it against the profile row rather than trusting
   this side to have done it.

   Resolves with { ok:true, photos:<n> } or throws with a message the
   sheet can show. */
export async function deleteMyAccount(confirm){
  const token = await accessToken();
  if(!token) throw new Error('Sign in first.');
  const r = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`,{
    method:'POST',
    headers:{ apikey:SUPABASE_KEY, Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ confirm })
  });
  const out = await r.json().catch(()=>({}));
  if(!r.ok || !out.ok) throw new Error(out.error || `Could not delete the account (${r.status})`);
  return out;
}
