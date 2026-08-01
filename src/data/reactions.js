"use strict";
/* ============================================================
   data/reactions — three named ways to say what you liked.

   A heart says "yes"; a reaction says which part. They sit next to the
   like and are worth nothing on purpose: no points, no podium, no
   leaderboard. Nothing in domain/scoring.js reads them, and the
   supabase/step-1.19.sql that creates the table adds no trigger that
   touches `profiles.points`.

   One row per (person, pour, kind), so the same photo can be both
   lovely art and a lovely spot. Writes are optimistic like every other
   social write here — ui/actions.js reverts on failure.
   ============================================================ */
import { rest } from './supabase.js';

/* kind · icon name (ui/icons.js) · button label · what it means, in the
   tooltip.

   All three read "Nice ___", because that is what they are: three
   compliments about three different parts of the same photo. The
   parallel wording is the point — one glance says these are alternatives
   to each other, and the icon says which part each one is about. A
   rosetta is latte art, a pin is a place, a bean is the coffee; nobody
   has to read the label to guess right.

   Line icons rather than emoji, per §06: they inherit the chip's colour,
   so a picked reaction goes Roast along with its label instead of
   sitting there in a foreign palette.

   The `kind` keys are what the database stores and are deliberately
   unchanged — supabase/step-1.19.sql constrains them and builds its
   notification wording from them ("loved your latte art", "loved where
   you had it", "loved your choice of coffee"), which is still exactly
   what these three say.

   The order is the order the eye reads the photo in: the cup first,
   then the room, then what's in it. */
export const REACTIONS = [
  ['art',   'rosetta', 'Nice pour', 'Beautiful latte art'],
  ['scene', 'cafe',    'Nice spot', 'Lovely place to have it'],
  ['drink', 'bean',    'Nice pick', 'A good choice of coffee']
];
export const REACTION_KINDS = REACTIONS.map(r=>r[0]);

/* An empty tally, so every post has the same shape whether or not
   anyone has reacted and the views never guard for undefined. */
export const noReactions = () => ({ art:0, scene:0, drink:0 });

/* PostgREST needs a quoted, comma-joined list for in.(…) */
const inList = ids => `(${ids.map(id=>`"${id}"`).join(',')})`;

/* Every reaction on this page of the feed, in one request — which also
   answers "which ones are mine" without a second one, because the rows
   carry their author.

   Deliberately the rows rather than an aggregate: three counts per post
   AND the viewer's own three flags is two aggregates and a join to get
   any other way, and at Crema's size the rows are smaller than the
   query that would avoid them. The cap is the honest limit of that
   trade — a pour with a thousand reactions would need the view instead. */
export async function fetchReactions(postIds, myUid){
  const empty={ counts:{}, mine:{} };
  if(!postIds || !postIds.length) return empty;
  /* Never throws. This rides along with the like and save lookups in one
     Promise.all, and a rejection there would take both of those down with
     it — so on the deploy where step-1.19.sql has not been run yet, the
     404 for a table that doesn't exist would cost every heart and
     bookmark on the page its state. A missing TABLE is not something
     optionalColumns() can shrug off the way it does a missing column, so
     the shrug happens here instead: no reactions, everything else fine. */
  let rows;
  try{ rows = await rest(`reactions?select=post_id,kind,user_id&post_id=in.${inList(postIds)}&limit=2000`); }
  catch(e){ console.warn('reactions unavailable — run supabase/step-1.19.sql',e); return empty; }
  const counts={}, mine={};
  (rows||[]).forEach(r=>{
    const c = counts[r.post_id] || (counts[r.post_id]=noReactions());
    if(r.kind in c) c[r.kind]++;
    if(r.user_id===myUid){ (mine[r.post_id] || (mine[r.post_id]=[])).push(r.kind); }
  });
  return { counts, mine };
}

export const react   = (uid,postId,kind) =>
  rest('reactions',{ method:'POST', body:{ user_id:uid, post_id:postId, kind } });
export const unreact = (uid,postId,kind) =>
  rest(`reactions?user_id=eq.${uid}&post_id=eq.${postId}&kind=eq.${kind}`,{ method:'DELETE' });
