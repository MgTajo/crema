"use strict";
/* ============================================================
   ui/selectsheet — the dropdown, in Crema's handwriting.

   Reported from the Play alpha: "the selection menu does not look good,
   it is the basic Android selection menu." It was. The FIELD has always
   been Crema's — `.field.sel` in styles.css draws the border, the radius,
   the type and the ▾ — but the list that drops out of it belongs to the
   platform, and on Android that is a grey system dialog in the middle of
   the screen with the app's typeface nowhere in it.

   There is no CSS for that list. `appearance:none` styles the closed
   control and nothing else; the popup is drawn by the OS. So the popup
   has to be ours, which means the tap has to be ours.

   THE DESIGN, and the two things it is careful about:

   1. THE <select> STAYS. It is not replaced, not hidden, not mirrored
      into state. It remains the element that holds the value, which
      means every existing reader keeps working with no change at all:
      syncCreate() / syncOb() / syncSettings() / saveGear() read
      `$('#c-drink').value`, the delegated `change` handler in
      ui/actions.js still fires, and ui/keepinput.js still carries the
      value across a repaint. A choice made here ends with
      `el.value = v` and a dispatched `change` — exactly what a tap on
      the native menu did. Nothing downstream can tell the difference.

      What is added is one transparent button lying over the field, so
      the pointer never reaches the <select> and the OS never opens
      anything. The <select> keeps its place in the tab order and its
      own popup for anyone driving the app from a keyboard or a screen
      reader — the button is aria-hidden and untabbable, so this makes
      the app prettier to touch without taking anything away from the
      people for whom the native control is the accessible one.

   2. IT PAINTS IN ITS OWN LAYER, not into #overlay. Every other sheet
      replaces #overlay's HTML, which destroys the DOM of the sheet
      underneath — fine for the machine picker, which syncs the create
      form first, and NOT fine here: the gear-details sheet keeps its
      roaster, origin and notes nowhere but in its own inputs until Save
      is pressed, so covering it in the usual way would lose whatever had
      been typed. A second layer leaves the sheet below untouched, which
      is also what a dropdown should look like: the field you are
      changing stays on screen behind it.

      It is still a real entry on ui.ovStack, so the Android back
      gesture, the browser back button and the backdrop all close it
      through exactly the paths they already use (ui/history.js,
      popOv()).
   ============================================================ */
import { $, esc } from '../core/util.js';
import { ui } from '../store/store.js';
import { t } from '../i18n.js';
import { icon } from './icons.js';

/* ---------- 1. the invisible hit target ---------- */
/* Called from ui/keepinput.js, which is the one place either container's
   HTML is replaced — so a select cannot arrive on screen undressed, and
   nobody has to remember to call this from a new renderer. */
export function dressSelects(root){
  if(!root || !root.querySelectorAll) return;
  root.querySelectorAll('.field.sel > select[id]').forEach(sel => {
    const field = sel.parentElement;
    if(!field || field.querySelector(':scope > .selhit')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'selhit';
    /* Not a control as far as assistive technology is concerned: the
       <select> underneath is the control, and it is still there. */
    b.tabIndex = -1;
    b.setAttribute('aria-hidden', 'true');
    b.dataset.action = 'open-select';
    b.dataset.for = sel.id;
    field.appendChild(b);
  });
}

/* ---------- 2. the sheet ---------- */
/* Its own element, made on first use rather than added to index.html —
   the repo root is the web root and one fewer edit there is one fewer
   thing to keep in step with sw.js's precache hash. Same approach
   offlineBar() takes in ui/shell.js. */
function layer(){
  let el = document.getElementById('overlay2');
  if(el) return el;
  const screen = document.querySelector('.screen');
  if(!screen) return null;
  el = document.createElement('div');
  el.id = 'overlay2';
  el.className = 'overlay';
  screen.appendChild(el);
  return el;
}

/* A row per option, in the order the <select> declares them — which is
   the order somebody already decided on, in the renderer that built it.
   An option with an empty value is the placeholder ("Optional", "Choose
   a café…"); it is still offered, because clearing a field you filled by
   mistake is a thing people do, and it is drawn as the aside it is. */
function rows(s){
  return s.opts.map(o => {
    const on = o.v === s.cur;
    /* `ic` is optional and only a choice sheet sets it — an <option>
       has nothing to draw. It is a glyph, not markup, and goes through
       esc() like everything else. */
    return `<button type="button" class="selrow${on?' on':''}${o.v?'':' none'}"
      role="option" aria-selected="${on?'true':'false'}"${o.dis?' disabled':''}
      data-action="select-pick" data-v="${esc(o.v)}">
      ${o.ic?`<span class="selrow-i" aria-hidden="true">${esc(o.ic)}</span>`:''}
      <span class="selrow-t">${esc(o.l)}${o.sub?`<small>${esc(o.sub)}</small>`:''}</span>
      <span class="selrow-c">${on?'✓':''}</span></button>`;
  }).join('');
}

/* Which dropdown the layer is currently showing, so a background repaint
   — and there are several a minute — does not rebuild it and replay the
   slide-up under the reader's thumb. Same problem `.overlay.again` solves
   for the sheets in #overlay; simpler here because a dropdown's contents
   cannot change while it is open. */
let showing = null;

export function paintSelectSheet(){
  const el = layer(), s = ui.select;
  if(!el) return;
  if(!s){ clearSelectSheet(); return; }
  if(showing === s.id && el.innerHTML) return;
  showing = s.id;
  const title = s.title || t('Choose');
  el.className = 'overlay show';
  el.innerHTML =
    `<div class="ov-back" data-action="close-ov"></div>
     <div class="sheet bottom selsheet" role="dialog" aria-label="${esc(title)}">
       <div class="grab"></div>
       <div class="ov-bar" style="border:0"><b>${esc(title)}</b>
         <button class="iconbtn" data-action="close-ov" aria-label="${t('Close')}">${icon('x',20)}</button></div>
       <div class="ov-body"><div class="sellist" role="listbox" aria-label="${esc(title)}">${rows(s)}</div>
         <div style="height:8px"></div></div>
     </div>`;
  /* A list of sixteen drinks opens on the first one, and the one you are
     already on can be off the bottom of it. Instant, not smooth: the
     sheet is still sliding up and a second animation reads as a jump. */
  const on = el.querySelector('.selrow.on');
  if(on && on.scrollIntoView) on.scrollIntoView({ block:'center' });
}

export function clearSelectSheet(){
  showing = null;
  const el = document.getElementById('overlay2');
  if(el && el.innerHTML){ el.className = 'overlay'; el.innerHTML = ''; }
  /* Also cleared here rather than only where a choice is made, because
     the sheet can be dismissed by routes that know nothing about it —
     the Android back gesture, the backdrop, signing out. */
  ui.select = null;
  /* A choice sheet that got here was dismissed rather than answered, and
     its caller is awaiting a promise. Resolving with null is what turns
     "they pressed back" into a cancel instead of a photo that never
     arrives and a spinner nobody clears. Harmless when a choice was
     just made: settleChoice() has already taken the resolver. */
  settleChoice(null);
}

/* ---------- 3. opening and choosing ---------- */
/* The title comes off the field's own <label>, so the sheet is headed
   with the same word the form is, in whichever language it is in — and a
   field whose label changes never needs telling twice. */
export function openSelect(id){
  const sel = $('#' + id);
  if(!sel || sel.disabled) return;
  const label = sel.parentElement && sel.parentElement.querySelector('label');
  ui.select = {
    id,
    title: label ? (label.textContent || '').trim() : '',
    cur: sel.value,
    opts: [...sel.options].map(o => ({ v:o.value, l:o.text, dis:o.disabled })),
  };
  return true;
}

/* Set the value and say so, which is the whole of the write. `change`
   bubbles because the handler in ui/actions.js is delegated on document,
   and because it is the event a human choosing from the native menu
   would have produced — a listener added later has no reason to know
   this file exists. */
export function applySelect(v){
  const s = ui.select;
  if(!s) return null;
  ui.select = null;
  return { id: s.id, value: v, changed: s.cur !== v };
}

export function writeSelect(id, v){
  const el = $('#' + id);
  if(!el || el.value === v) return;
  el.value = v;
  el.dispatchEvent(new Event('change', { bubbles:true }));
}

/* ---------- 4. the same sheet, without a <select> under it ----------

   Reported from the Play alpha, and it is the same complaint the
   dropdown got: adding a second photo raised Android's own "Gallery /
   Take photo / Cancel" list, which is a grey system dialog with none of
   Crema in it. @capacitor/camera draws that itself when it is asked for
   source:'PROMPT' — the labels can be translated and nothing else about
   it can be touched.

   So Crema asks the question instead and tells the plugin the answer.
   Everything the dropdown already solved is reused as it stands: the
   second layer (so the create sheet's typed caption survives), the
   ovStack entry (so the back gesture closes it), the rows, the CSS.
   What differs is only that there is no element holding the value, so
   the answer goes to a callback rather than to `el.value`.

   The callback is module-private rather than a field on `ui.select`,
   because `ui` is read and rebuilt by renderers that have no business
   holding a function. */
let pending = null;

export function openChoice({ id, title, options }){
  ui.select = { id, title, cur:'', opts: options, choice:true };
  return new Promise(resolve => { pending = resolve; });
}

/* Answers the promise openChoice() returned — with the chosen value, or
   with null when the sheet was dismissed rather than answered. Every
   caller therefore has exactly one place to handle "they backed out",
   which is the case the native prompt reported as a cancel. */
export function settleChoice(v){
  const f = pending; pending = null;
  if(ui.select && ui.select.choice) ui.select = null;
  if(f) f(v == null ? null : v);
}
