/* ============================================================
   Every file under src/ has to parse as an ES module.

     node src/modules.test.mjs

   WHY THIS EXISTS, and it is a specific embarrassment rather than a
   general principle.

   `node --check file.js` parses a file as a SCRIPT. Crema is written in
   ES modules, and the two grammars differ in exactly the place this
   codebase spends most of its time: a script-mode parse of a file with
   an unbalanced template literal can succeed, because the leftover
   backtick simply opens a string that runs to the next one. On
   2026-09-05 a stray fragment left behind by an edit sat in views.js
   past `node --check`, and the first thing that noticed was a blank
   screen — the module failed to compile, so app.js never ran, so
   nothing painted and nothing was logged anywhere a person would see.

   There is no build step to catch this and there is not going to be one
   (STRATEGY.md §2.2). This is the cheapest possible substitute: import
   every module and let the engine's own parser answer. It runs in about
   a second, needs nothing installed, and fails loudly on the one class
   of mistake that otherwise ships silently.

   It IMPORTS rather than merely parsing, so it also catches a bad
   specifier — a moved file, a renamed export used as a default. Modules
   that touch the DOM at evaluation time are the reason for the stubs
   below: they are a browser's globals, not a judgement about the code.

   WHAT COUNTS AS A FAILURE is narrower than "it threw", and
   deliberately so. A SyntaxError or a specifier that does not resolve
   means the module could never load in a browser either — that is the
   bug. Anything else means the module compiled and linked and then went
   looking for a browser it is not in: src/app.js is the composition
   root and its whole job is to start the app at import time, and it
   should not be redesigned so a test can import it. Those are reported
   as "compiled" and pass. The stubs below exist to make that line rare,
   not to build a DOM.
   ============================================================ */
import fs from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* Enough of a browser for a module to finish evaluating. Deliberately
   the smallest possible set: this is not a DOM, and a module that needs
   more than this at import time is doing work at import time, which is
   itself worth finding out about. */
const noop = () => {};
const el = () => ({
  style:{ setProperty:noop, removeProperty:noop, getPropertyValue:()=>'' }, classList:{ add:noop, remove:noop, toggle:noop, contains:()=>false },
  setAttribute:noop, getAttribute:()=>null, removeAttribute:noop,
  appendChild:noop, insertBefore:noop, remove:noop, addEventListener:noop,
  querySelector:()=>null, querySelectorAll:()=>[], getBoundingClientRect:()=>({width:0,height:0,top:0,left:0}),
  innerHTML:'', textContent:'', dataset:{}, hidden:false, parentElement:null, parentNode:null,
});
const store = () => { const m = new Map();
  return { getItem:k=>m.has(k)?m.get(k):null, setItem:(k,v)=>m.set(k,String(v)),
           removeItem:k=>m.delete(k), clear:()=>m.clear(), key:()=>null, length:0 }; };

/* Node 21+ defines `navigator` itself, as a getter with no setter, so
   plain assignment throws. defineProperty is the form that works on
   both, and writable:true keeps a later assignment from surprising
   anybody who edits this. */
const define = (name, value) =>
  Object.defineProperty(globalThis, name, { value, writable:true, configurable:true });

globalThis.window = globalThis;
/* `window` IS globalThis here, so the listener APIs a browser puts on
   the window object have to exist on it — app.js, actions.js and
   viewport.js all attach one at import time. Nothing is dispatched; the
   point is that evaluation finishes. */
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.dispatchEvent = noop;
globalThis.scrollTo = noop;
globalThis.innerWidth = 412; globalThis.innerHeight = 915;
globalThis.devicePixelRatio = 3;
globalThis.visualViewport = { width:412, height:915, addEventListener:noop, removeEventListener:noop };
globalThis.document = {
  documentElement: el(), body: el(), head: el(),
  createElement: el, createElementNS: el, createTextNode: el,
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
  visibilityState: 'visible', referrer: '', cookie: '',
};
define('navigator', { language:'en', languages:['en'], userAgent:'node', onLine:true });
define('location', new URL('https://crema-app.com/'));
define('localStorage', store());
define('sessionStorage', store());
globalThis.matchMedia = () => ({ matches:false, addEventListener:noop, removeEventListener:noop, addListener:noop, removeListener:noop });
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = noop;
define('history', { replaceState:noop, pushState:noop, back:noop, length:1, state:null });
globalThis.CustomEvent = class { constructor(t, o){ this.type=t; Object.assign(this, o||{}); } };
globalThis.Event = globalThis.CustomEvent;
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });

function walk(dir, out = []){
  for(const e of fs.readdirSync(dir, { withFileTypes:true }).sort((a,b)=>a.name<b.name?-1:1)){
    const abs = path.join(dir, e.name);
    if(e.isDirectory()) walk(abs, out);
    /* .test.mjs files are run by name, by CI, and several of them are
       meant to be entry points rather than imports. */
    else if(/\.js$/.test(e.name) && !/\.test\.m?js$/.test(e.name)) out.push(abs);
  }
  return out;
}

const files = walk(HERE);
let failed = 0;

console.log(`modules — ${files.length} files under src/ must parse and import\n`);

/* Could this module never have loaded in a browser? */
const isLoadFailure = e =>
  e instanceof SyntaxError ||
  e instanceof ReferenceError && /is not defined/.test(e.message) === false ||
  ['ERR_MODULE_NOT_FOUND','ERR_UNSUPPORTED_DIR_IMPORT','ERR_UNKNOWN_FILE_EXTENSION',
   'ERR_IMPORT_ATTRIBUTE_MISSING'].includes(e.code);

let ranAnyway = 0;

for(const abs of files){
  const rel = path.relative(path.resolve(HERE, '..'), abs);
  try{
    await import(pathToFileURL(abs).href);
    console.log(`  ok   ${rel}`);
  }catch(e){
    if(isLoadFailure(e)){
      failed++;
      const kind = e instanceof SyntaxError ? 'SYNTAX' : (e.code || e.constructor.name);
      console.log(`  FAIL ${rel}\n         ${kind}: ${String(e.message).split('\n')[0]}`);
    }else{
      ranAnyway++;
      console.log(`  ok   ${rel}  (compiled; wanted a browser to finish: ${String(e.message).split('\n')[0]})`);
    }
  }
}

console.log(`\n${files.length - failed} passed, ${failed} failed` +
  (ranAnyway ? ` — ${ranAnyway} compiled without finishing evaluation, which is what a composition root does` : ''));
process.exit(failed ? 1 : 0);
