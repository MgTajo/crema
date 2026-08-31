"use strict";
/* ============================================================
   ui/keepinput — a repaint must not throw away what somebody is typing.

   Crema paints from localStorage and goes to the network behind that
   paint (app.js). When the network lands, app.js calls render(), which
   replaces #view and #overlay wholesale — and until this module existed
   that emptied every field whose value was only in the DOM. Tap "Sign
   in", start typing, and about half a second later the email and the
   password were gone. The composer's caption and the Premium code went
   the same way, and so did anything else typed within the window. It
   was reproducible, nobody had reported it, and nobody could have:
   there is no error monitoring for a signed-out visitor, which is
   exactly who is on that screen. See Q17 in brain/11-open-questions.md.

   The fix is the one overlays.js already made for scroll position, for
   the same reason — replacing a container's HTML destroys state that
   lives in the elements rather than in `state`. Scroll offsets are
   carried across a repaint; so, now, are values, focus and the caret.

   **The rule, and it is the whole of the design:**

     On a repaint of the SAME screen or the SAME sheet, what somebody
     typed beats what the renderer re-derived — unless the renderer
     changed its mind about that field, in which case the renderer wins.

   Both halves matter. Without the first, a background repaint discards
   input. Without the second, `clear-search` could not clear the search
   box: it empties `ui.searchQ` and repaints the same route, and a naive
   "keep what is in the DOM" would put the query straight back.

   "Changed its mind" is decided by comparing what the renderer produced
   THIS paint against what it produced LAST paint — not against what is
   in the field, which is the person's business. Equal means the
   renderer has nothing new to say and the typing stands.

   A different screen or a different sheet restores nothing: the ids
   collide across sheets (#c-caption, #sp-code), and a value typed into
   one sheet has no business appearing in the next.

   **The one thing a caller still has to do.** Comparing renders cannot
   separate "the boot landed while somebody was typing" from "the person
   asked for this field to be emptied", when the field's state is kept
   in step on every keystroke — `ui.searchQ` is, so `clear-search`
   empties it, repaints the same route, and produces exactly the same
   HTML as the paint before. Both cases look identical from here.

   So an action that deliberately overwrites a field says so **in the
   DOM**, which is where addComment() has always cleared #cmt-input:

       ui.searchQ=''; const s=$('#search-input'); if(s) s.value='';

   There is one such caller today. The failure mode of forgetting is
   local and visible — a field that will not clear — rather than the
   silent, global one this module exists to end.
   ============================================================ */

import { dressSelects } from './selectsheet.js';

const FIELDS = 'input[id], textarea[id], select[id]';

/* What the renderer produced last time, per container. A WeakMap so a
   container that goes away takes its memory with it. */
const lastRendered = new WeakMap();

/* A file input's value cannot be set at all, and a hidden one is the
   renderer's own bookkeeping rather than anybody's typing. */
const carries = el => !(el.tagName === 'INPUT' && (el.type === 'file' || el.type === 'hidden'));

function fields(root) {
  const m = new Map();
  root.querySelectorAll(FIELDS).forEach(el => { if (carries(el)) m.set(el.id, el); });
  return m;
}
const valuesOf = m => { const v = new Map(); m.forEach((el, id) => v.set(id, read(el))); return v; };

const isTicked = el => el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio');
const read = el => isTicked(el) ? (el.checked ? '1' : '') : el.value;

function write(el, v) {
  if (isTicked(el)) { el.checked = v === '1'; return; }
  /* A <select> can only hold a value one of its options offers, and the
     options are rendered from state that a repaint may have changed —
     the café's bean list, the drink list. Dropping a value that is no
     longer on the list is better than assigning it and silently
     emptying the control. */
  if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === v)) return;
  el.value = v;
}

/* Where the caret was, if it was anywhere in here. Restoring the value
   without this is only half a fix: `el.value = …` puts the caret at the
   end, and a repaint that jumps the cursor mid-word is its own bug. */
function focusIn(root) {
  const el = document.activeElement;
  if (!el || !el.id || el === document.body || !root.contains(el)) return null;
  let start = null, end = null;
  /* selectionStart is null on input types that have no selection —
     type="email" is one, and #au-email is one of those. */
  try { start = el.selectionStart; end = el.selectionEnd; } catch (e) { /* same answer */ }
  return { id: el.id, start, end };
}

function refocus(now, where) {
  const el = now.get(where.id);
  if (!el || el === document.activeElement) return;
  /* preventScroll because renderOverlay restores the sheet's scroll
     position right after this, and a focus that scrolled would undo it. */
  try { el.focus({ preventScroll: true }); } catch (e) { return; }
  if (where.start == null) return;
  try { el.setSelectionRange(where.start, where.end); } catch (e) { /* email, number */ }
}

/* Paint `el`, carrying typing across when `same` says this is the same
   screen or sheet arriving again rather than a different one. `paint`
   does the innerHTML assignment and nothing else. */
export function keepInput(el, same, paint) {
  const typed = same ? valuesOf(fields(el)) : null;
  const where = same ? focusIn(el) : null;

  paint();

  /* Every <select> in the app has just been rebuilt from a string, so
     every one of them needs its tap target back. This is the only place
     #view's or #overlay's HTML is replaced, which is why it is called
     from here rather than from the two renderers — a screen added next
     year gets it without anyone remembering. See ui/selectsheet.js. */
  dressSelects(el);

  const now = fields(el);
  const fresh = valuesOf(now);

  if (same) {
    const before = lastRendered.get(el);
    now.forEach((node, id) => {
      /* No previous paint to compare against, or the renderer moved this
         field on its own: the renderer wins. */
      if (!before || before.get(id) !== fresh.get(id)) return;
      const mine = typed.get(id);
      if (mine === undefined || mine === fresh.get(id)) return;
      write(node, mine);
    });
    if (where) refocus(now, where);
  }

  lastRendered.set(el, fresh);
}
