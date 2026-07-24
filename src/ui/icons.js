"use strict";
/* ============================================================
   ui/icons — inline SVG icon set and small brand marks.
   Pure string builders; no state.
   ============================================================ */
export const I={
  home:'<path d="M4 11l8-7 8 7"/><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"/>',
  homeF:'<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" fill="currentColor" stroke="none"/>',
  compass:'<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z" fill="currentColor" stroke="none" opacity=".9"/>',
  cup:'<path d="M5 8h11v5a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5z"/><path d="M16 9h2.5a2.5 2.5 0 0 1 0 5H16"/><path d="M7 3v2M10 3v2M13 3v2" stroke-linecap="round"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 5-5 8-5s6.5 1 8 5"/>',
  userF:'<circle cx="12" cy="8" r="4" fill="currentColor" stroke="none"/><path d="M4 20c1.5-4 5-5 8-5s6.5 1 8 5" fill="currentColor" stroke="none"/>',
  plus:'<path d="M12 5v14M5 12h14" stroke-linecap="round"/>',
  heart:'<path d="M12 20s-7-4.4-9.3-8.3C1 8.5 2.6 5.5 5.7 5.5c1.9 0 3.1 1 4.3 2.4C11.2 6.5 12.4 5.5 14.3 5.5c3.1 0 4.7 3 3 6.2C15 15.6 12 20 12 20z"/>',
  heartF:'<path d="M12 20s-7-4.4-9.3-8.3C1 8.5 2.6 5.5 5.7 5.5c1.9 0 3.1 1 4.3 2.4C11.2 6.5 12.4 5.5 14.3 5.5c3.1 0 4.7 3 3 6.2C15 15.6 12 20 12 20z" fill="currentColor" stroke="none"/>',
  chat:'<path d="M4 5h16v11H9l-4 4z" stroke-linejoin="round"/>',
  save:'<path d="M6 4h12v16l-6-4-6 4z" stroke-linejoin="round"/>',
  saveF:'<path d="M6 4h12v16l-6-4-6 4z" fill="currentColor" stroke="none"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5" stroke-linecap="round"/>',
  bell:'<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  back:'<path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round"/>',
  x:'<path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/>',
  send:'<path d="M4 12l16-8-6 16-3-6z" stroke-linejoin="round"/>',
  sendF:'<path d="M4 12l16-8-6 16-3-6z" stroke-linejoin="round" fill="currentColor"/>',
  bolt:'<path d="M13 3L5 13h5l-1 8 8-10h-5z" stroke-linejoin="round" fill="currentColor" stroke="none"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.5 5.5l2 2M16.5 16.5l2 2M18.5 5.5l-2 2M7.5 16.5l-2 2"/>',
  mach:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 4v4h8V4M9 12h6l-1 4h-4z" stroke-linejoin="round"/>',
  cam:'<path d="M4 8h3l1.5-2h7L17 8h3v11H4z" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5"/>'
};
export const icon=(n,w=24)=>`<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">${I[n]}</svg>`;
export const pin=color=>`<svg viewBox="0 0 24 30" aria-hidden="true"><path d="M12 0C6 0 2 4.2 2 10c0 7 10 20 10 20s10-13 10-20C22 4.2 18 0 12 0z" fill="${color}"/><circle cx="12" cy="10" r="4.4" fill="#fff"/></svg>`;
export const logoMark=(s=26)=>`<svg width="${s}" height="${s}" viewBox="0 0 40 40" style="vertical-align:-4px" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#8a5a30"/><path d="M20 12c-4.5 3.5-4.5 9 0 12.5 4.5-3.5 4.5-9 0-12.5z" fill="#f3e6d2"/></svg>`;
