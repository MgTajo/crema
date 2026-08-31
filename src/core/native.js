"use strict";
/* ============================================================
   core/native — is this the app, or is this the web?

   Crema ships twice from one codebase: as the static PWA at
   crema-app.com, and as a Capacitor shell in the two stores
   (brain/13-infrastructure-plan.md, step 4.1). This module is the only
   place that knows which, and it is in `core` because both `data/` and
   `ui/` need the answer and the layering runs core → data →
   domain/store → ui.

   THE RULE THIS FILE EXISTS TO ENFORCE — and it is the acceptance
   criterion the whole step is held to:

     In a browser, every export here is falsy or a no-op, and nothing
     downstream of it changes behaviour by a single line.

   People are using crema-app.com right now. The native work is not
   allowed to be a rewrite that the web happens to survive; it is a set
   of branches that the web never enters. So `native()` is false in
   every browser, `plugin()` returns null, and each caller is written so
   that null means "do exactly what you did before". There is no
   polyfill, no shim, and nothing to load: a browser pays one property
   read for all of this.

   WHY FEATURE DETECTION AND NOT A BUILD FLAG. The repo root is
   buildless and stays that way — there is no define to substitute at
   deploy time and no bundler to do it. Capacitor injects
   `window.Capacitor` before any application code runs, so the question
   is answerable at runtime, for free, by the same file in both builds.
   That is also what keeps the two from drifting: there is one
   index.html, one src/, and one deploy of each.

   HOW PLUGINS ARE REACHED. Through `Capacitor.Plugins.<Name>`, never
   through `import '@capacitor/camera'`. A bare-module import is a build
   step by another name — it needs node_modules and a resolver, neither
   of which exists at the repo root, and it would 404 in a browser and
   take the app down with it. The plugins are registered on the global
   by the native runtime; `plugin('Camera')` is how you ask whether this
   build has one.
   ============================================================ */

const cap = () => (typeof window !== 'undefined' && window.Capacitor) || null;

/* Running inside the Capacitor shell rather than a browser tab.
   `isNativePlatform` is a function on Capacitor 4+; the truthiness
   check on the object is what answers it on older shells and on the
   web-target build, where it is absent entirely. */
export function native(){
  const c = cap();
  if(!c) return false;
  try{ return typeof c.isNativePlatform === 'function' ? c.isNativePlatform() : !!c.isNative; }
  catch(e){ return false; }
}

/* 'ios' | 'android' | 'web'. Note that Capacitor reports 'web' for the
   PWA too, so this is the one export that is meaningful in a browser —
   and it answers 'web' there, which is what callers expect. */
export function platform(){
  const c = cap();
  if(!c) return 'web';
  try{ return (typeof c.getPlatform === 'function' ? c.getPlatform() : c.platform) || 'web'; }
  catch(e){ return 'web'; }
}

export const isIOSNative     = () => native() && platform() === 'ios';
export const isAndroidNative = () => native() && platform() === 'android';

/* A registered plugin, or null. Every caller in this repo treats null
   as "use the web path", which is why nothing here throws or warns: a
   missing plugin is the normal case in a browser, not a fault. */
export function plugin(name){
  const c = cap();
  if(!c || !c.Plugins) return null;
  const p = c.Plugins[name];
  return p || null;
}

/* Await a plugin call and fall back rather than propagate. Native
   bridges reject for reasons the web path does not have — permission
   refused, the user cancelled the sheet, a plugin missing from THIS
   build because the shell was cut before it was added — and none of
   those should reach a user as a broken button. Returns a
   { ok, value, error } record so callers can tell "the user said no"
   from "it did not work", which matter differently.

   The distinction the app cares about most is CANCELLATION. Someone who
   backs out of the camera has not hit an error and must not be shown
   one; every native SDK signals it differently, so it is normalised
   here, once. */
const CANCEL = /cancel|abort|dismiss|denied by user|user denied|no image picked/i;

export async function call(pluginName, method, args){
  const p = plugin(pluginName);
  if(!p || typeof p[method] !== 'function'){
    return { ok:false, cancelled:false, error:new Error(`${pluginName}.${method} unavailable`) };
  }
  try{
    return { ok:true, cancelled:false, value: await p[method](args || {}) };
  }catch(err){
    const msg = (err && (err.message || err.errorMessage)) || '';
    return { ok:false, cancelled: CANCEL.test(String(msg)), error: err };
  }
}

/* ------------------------------------------------------------
   Small helpers that exist so callers do not each grow their own.
   ------------------------------------------------------------ */

/* Haptics, when the shell has them. Deliberately fire-and-forget and
   deliberately silent on the web: a tap that buzzes on a phone and does
   nothing in a browser is the same code path, and neither is an error.

   `Haptics.impact` wants a style; the three the app uses are the three
   iOS has. Anything else falls through to a medium tap. */
export function haptic(style){
  if(!native()) return;
  const s = String(style || 'light').toUpperCase();
  const known = s === 'LIGHT' || s === 'MEDIUM' || s === 'HEAVY';
  call('Haptics', 'impact', { style: known ? s : 'MEDIUM' });
}

/* A data: URI or a base64 payload from a plugin, as a File the existing
   upload path can take unchanged.

   This is the seam that keeps the native camera from being a rewrite.
   ui/actions.js's handleUpload() and uploadAvatar() both take a File and
   do everything else themselves — downscale, square, focus-pick, upload,
   the photo cap. The native camera returns base64, so the whole of the
   native branch is "make a File out of it and call the same function".
   Nothing about the image pipeline is duplicated, which also means the
   Premium three-photo cap and the rate limit cannot be bypassed by
   coming in through the native path. */
export function fileFromBase64(b64, mime, name){
  const raw = atob(String(b64 || '').replace(/^data:[^,]*,/, ''));
  const bytes = new Uint8Array(raw.length);
  for(let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const type = mime || 'image/jpeg';
  return new File([bytes], name || `photo-${Date.now()}.jpg`, { type });
}
