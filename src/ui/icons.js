"use strict";
/* ============================================================
   ui/icons — inline SVG icon set and small brand marks.
   Pure string builders; no state.

   Brand guidelines §06: 24 px grid, 1.75 px stroke, round caps and
   joins, no fills except the like state. The icons are geometric and
   slightly rounded so they sit next to the disc without arguing with
   it, and the like heart is the brand heart at icon scale — the only
   glyph that ever fills, and it fills in Roast (--like).

   The `F` suffix on a name is that glyph's filled state. Only the ones
   that have a real on/off meaning get one (liked, saved, current tab).
   ============================================================ */
export const I={
  /* feed — the brand's grid, and the app's Home */
  home:'<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  homeF:'<rect x="3.5" y="3.5" width="7" height="7" rx="2" fill="currentColor"/><rect x="13.5" y="3.5" width="7" height="7" rx="2" fill="currentColor"/><rect x="3.5" y="13.5" width="7" height="7" rx="2" fill="currentColor"/><rect x="13.5" y="13.5" width="7" height="7" rx="2" fill="currentColor"/>',
  /* explore — a compass, stroked. Nothing fills but the heart. */
  compass:'<circle cx="12" cy="12" r="8.5"/><path d="M15.4 8.6l-2 4.8-4.8 2 2-4.8z"/>',
  /* brew — the cup from §06 */
  cup:'<path d="M4.5 6.5h11v6.5a5.5 5.5 0 0 1-5.5 5.5h0a5.5 5.5 0 0 1-5.5-5.5z"/><path d="M15.5 8.5H18a2.75 2.75 0 0 1 0 5.5h-2.5"/><path d="M4.5 21h13"/>',
  /* café — the place, not the drink */
  cafe:'<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  bean:'<ellipse cx="12" cy="12" rx="6" ry="8.5" transform="rotate(-30 12 12)"/><path d="M8.6 6.4c3 3.6 3 7.6 0 11.2"/>',
  /* rosetta — the brand's leaf (§02, latte-art system) with its spine.
     Drawn as one leaf rather than the disc's stacked pair: at the 15px
     the reaction chips use it, two overlapping leaves collapse into a
     squiggle, and one leaf still says "latte art" at a glance. */
  rosetta:'<path d="M12 2.5c5.2 4.6 5.2 14.4 0 19-5.2-4.6-5.2-14.4 0-19z"/><path d="M12 6.5v11"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  userF:'<circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" fill="currentColor"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  /* the brand heart, at icon scale */
  heart:'<path d="M12 20.5S3.5 14.2 3.5 8.9C3.5 5.9 5.8 4 8.3 4c1.7 0 3 1 3.7 2.4C12.7 5 14 4 15.7 4c2.5 0 4.8 1.9 4.8 4.9 0 5.3-8.5 11.6-8.5 11.6z"/>',
  heartF:'<path d="M12 20.5S3.5 14.2 3.5 8.9C3.5 5.9 5.8 4 8.3 4c1.7 0 3 1 3.7 2.4C12.7 5 14 4 15.7 4c2.5 0 4.8 1.9 4.8 4.9 0 5.3-8.5 11.6-8.5 11.6z" fill="currentColor"/>',
  chat:'<rect x="3" y="4" width="18" height="13" rx="4"/><path d="M8 17v4l4.5-4"/>',
  save:'<path d="M6 3.5h12v17l-6-5-6 5z"/>',
  saveF:'<path d="M6 3.5h12v17l-6-5-6 5z" fill="currentColor"/>',
  /* share — out of the tray, per §06 */
  share:'<path d="M12 16V3"/><path d="M7.5 7.5 12 3l4.5 4.5"/><path d="M4.5 14v6h15v-6"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  bell:'<path d="M6 9.5a6 6 0 0 1 12 0c0 4.5 1.8 5.5 1.8 5.5H4.2S6 14 6 9.5z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  back:'<path d="M15 5l-7 7 7 7"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>',
  send:'<path d="M4 12l16-8-6 16-3-6z"/>',
  sendF:'<path d="M4 12l16-8-6 16-3-6z" fill="currentColor"/>',
  /* streak — the flame from §06. Named `bolt` since step one; every
     call site says "streak", so the name is the only thing left of the
     lightning it used to be. */
  bolt:'<path d="M12 3c4 5.2 6 7.4 6 10.5a6 6 0 0 1-12 0C6 10.4 8 8.2 12 3z"/>',
  /* challenge — the trophy */
  trophy:'<path d="M8 3.5h8V9a4 4 0 0 1-8 0z"/><path d="M8 5.5H5A3 3 0 0 0 8 9"/><path d="M16 5.5h3A3 3 0 0 1 16 9"/><path d="M12 13v4"/><path d="M8.5 20.5h7"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
  mach:'<rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="M8 3.5v4h8v-4"/><path d="M9.5 11.5h5l-1 4.5h-3z"/>',
  cam:'<path d="M4 8.5h3L8.5 6h7L17 8.5h3v10.5H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
  /* milk — the pitcher, not a glass. Not in §06, drawn in its language:
     same 24 grid, same weight, same rounded joins. */
  milk:'<path d="M6 8.5h8V17a4 4 0 0 1-4 4h0a4 4 0 0 1-4-4z"/><path d="M6 8.5V6h8v2.5"/><path d="M14 10.5l4-2.4v5.8l-4-2.4z"/>',
  /* info — the way into a bean or machine sheet from a row that is
     already doing something else when you tap it. Same 24 grid and
     weight as the rest; the dot is a 1px stroke rather than a fill so
     it holds up at 16px, which is the only size it is ever drawn at. */
  info:'<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.6v.6"/>',
  /* the eye — "let me read what I just typed", inside a password field.
     Drawn on the same 24 grid at the same weight as the rest, and
     nothing fills: the state is carried by the slash, not by a fill.
     eyeOff is the same lid with the pupil cut down to the arc a stroke
     can still read at 18px, which is the only size either is drawn at. */
  eye:'<path d="M2.6 12S6.2 5.8 12 5.8 21.4 12 21.4 12 17.8 18.2 12 18.2 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="3.1"/>',
  eyeOff:'<path d="M9.7 6.1A9.7 9.7 0 0 1 12 5.8c5.8 0 9.4 6.2 9.4 6.2a17.3 17.3 0 0 1-3.4 4.1"/><path d="M6.3 7.8A17 17 0 0 0 2.6 12S6.2 18.2 12 18.2a9.9 9.9 0 0 0 3.7-.7"/><path d="M9.9 9.9a3.1 3.1 0 0 0 4.3 4.3"/><path d="M4.2 4.2l15.6 15.6"/>'
};
export const icon=(n,w=24)=>`<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;
export const pin=color=>`<svg viewBox="0 0 24 30" aria-hidden="true"><path d="M12 0C6 0 2 4.2 2 10c0 7 10 20 10 20s10-13 10-20C22 4.2 18 0 12 0z" fill="${color}"/><circle cx="12" cy="10" r="4.4" fill="#FFFDF9"/></svg>`;

/* ----- the mark -----
   A cup seen from above with latte art on it: a solid Roast disc and
   the heart in the same cream the foam is. Guidelines §02 — the ring of
   milk foam is the brand's only geometry, so the disc is a circle, it
   is never a squircle, it never carries a gradient, and the heart never
   touches the rim (it sits at ~40% of the disc's width, per the 42-on-90
   lockup the guidelines draw).

   The two fills come from --mark-disc / --mark-heart rather than being
   hard-coded, because §04 is explicit that Roast does not read on
   #17100B — the guidelines draw the dark app icon as a Crema disc with
   an Espresso heart, and this is the same mark at app-bar scale. Both
   are still "brown, ink, or knockout", never a gradient, never a
   squircle. */
export const logoMark=(s=26)=>`<svg width="${s}" height="${s}" viewBox="0 0 40 40" style="vertical-align:-4px" aria-hidden="true"><circle cx="20" cy="20" r="20" fill="var(--mark-disc)"/><path transform="translate(11.1,11.1) scale(.178)" fill="var(--mark-heart)" d="M50 92C50 92 6 62 6 34.5 6 18.5 17.5 8 30.5 8 39.5 8 46 13.2 50 20.5 54 13.2 60.5 8 69.5 8 82.5 8 94 18.5 94 34.5 94 62 50 92 50 92Z"/></svg>`;
