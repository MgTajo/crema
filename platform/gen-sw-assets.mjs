#!/usr/bin/env node
/* ============================================================
   Generate the service worker's precache list and cache name.

     node platform/gen-sw-assets.mjs           # rewrite sw.js
     node platform/gen-sw-assets.mjs --check   # is sw.js current?
     node platform/gen-sw-assets.mjs --print   # print the block only

   Why this exists.

   `ASSETS` and `C` in sw.js were both maintained by hand, and they are
   the two values in this repo where a mistake is *sticky*. Miss a file
   out of ASSETS and it is simply never precached — the app still works,
   so nothing says so. Forget to bump `C` and every existing install
   keeps answering from a cache built out of the previous deploy; the
   stale-while-revalidate rewrite made that recoverable, but only for
   files that are in the list. A file that is missing from ASSETS is
   missing from the revalidation too.

   Neither failure is visible from here. There is no error monitoring
   for a signed-out visitor (brain/13-infrastructure-plan.md, 1b.5), and
   an install serving last week's `views.js` throws nothing — it just
   quietly is not the app that was deployed. So the list is derived
   rather than remembered, and CI fails a pull request that changed a
   precached file without re-running this.

   What it does NOT do: bundle, minify, hash filenames or add a build
   step. It reads files, writes two statements back into sw.js, and has
   no dependencies. `node platform/gen-sw-assets.mjs` is the whole of it,
   and the app stays servable straight out of the working tree.

   The cache name is a content hash of the list, so it changes exactly
   when the precached bytes change and never otherwise. That retires the
   hand-bumped `crema-vNN`: a deploy that touches no precached file does
   not evict a cache that is still correct, and one that touches any of
   them cannot fail to.
   ============================================================ */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP  = path.resolve(HERE, '..');          // the repo root, which is the web root
const SW   = path.join(APP, 'sw.js');

/* ------------------------------------------------------------
   What gets precached, and what deliberately does not.

   The repo root is the web root, so "every file in the repo" is the
   wrong rule — it would precache README.md, the SQL, the keystore's
   neighbours and the Android project. The rule is narrower: the files
   the app itself loads to open. Each exclusion below is a decision, not
   an oversight, and is written down as one.
   ------------------------------------------------------------ */
const RULES = [
  /* The document. './' is the URL a navigation actually asks for — the
     manifest's start_url is "." and the TWA launches the same address —
     so it is cached under that name and index.html supplies the bytes.
     Requesting '/index.html' directly misses the cache and goes to the
     network; nothing in the app does that. */
  { url: './', file: 'index.html' },
  { url: './manifest.webmanifest', file: 'manifest.webmanifest' },
  { url: './styles.css', file: 'styles.css' },

  /* Every ES module the app is made of. Tests are excluded because they
     never reach a browser: they are run by node, in CI. */
  { dir: 'src', match: /\.js$/, skip: /\.test\.m?js$/ },

  /* Artwork. Part of the app — the native bundle ships it, and sw.js
     serves it offline once it has been seen — but NOT part of opening
     the app, so `precache: false`: it is fetched on demand and the
     runtime cache-first branch in sw.js keeps it from then on.

     Measured 2026-09-04: this directory was 856 KB of the 1.76 MB
     `caches.addAll()` runs on a first visit, all-or-nothing, competing
     with the paint the visitor is waiting for. beans.jpg alone is
     141 KB and appears on a bean detail page. Nine of the twelve files
     are not referenced from src/ at all today, so precaching them
     bought a first visit nothing whatsoever.

     og-cover.png is excluded outright rather than deferred: it is the
     social preview in index.html's meta tags, fetched off the network
     by a crawler that has no service worker, so the app never asks for
     it and the runtime cache would never hold it either. */
  { dir: 'assets', match: /\.(?:jpg|png|svg|webp)$/, skip: /^og-cover\.png$/, precache: false },

  /* The icons, which live at the root because the manifest and
     assetlinks point at them there. */
  { url: './icon-192.png', file: 'icon-192.png' },
  { url: './icon-512.png', file: 'icon-512.png' },
  { url: './icon-monochrome.png', file: 'icon-monochrome.png' },
];

/* legal.css and legal.js are absent on purpose. They belong to
   /privacy, /impressum and /child-safety — separate documents, reached
   from a footer link, read once and never part of opening the app.
   Precaching them would put three pages nobody has asked for into every
   install. They are served from the network, which is where a legal
   page should be read from anyway: the current one. */

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(APP, dir), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

/* The list, in a deterministic order: rule by rule, and alphabetically
   within a directory. Order is part of the output, so it has to come
   from the rules rather than from the filesystem's mood. */
export function collect() {
  const entries = [];
  for (const r of RULES) {
    const pre = r.precache !== false;
    if (r.file) { entries.push({ url: r.url, file: r.file, precache: pre }); continue; }
    for (const rel of walk(r.dir)) {
      const base = path.basename(rel);
      if (r.match && !r.match.test(base)) continue;
      if (r.skip && r.skip.test(base)) continue;
      entries.push({ url: `./${rel}`, file: rel, precache: pre });
    }
  }
  return entries;
}

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

function build() {
  const entries = collect();
  const missing = entries.filter(e => !fs.existsSync(path.join(APP, e.file)));
  if (missing.length) {
    /* Not reachable through the rules — a rule names a file directly, or
       it walks a directory. It is checked anyway because a precache list
       containing one URL that 404s makes `cache.addAll()` reject, and
       sw.js swallows that: install() ends `.catch(() => {})`, so the
       whole precache silently does not happen. */
    console.error('missing file(s) named by a rule:\n  ' + missing.map(m => m.file).join('\n  '));
    process.exit(2);
  }
  /* The cache name is a hash of EVERY file the worker can end up
     holding — precached or runtime — not only the precache list.

     Precached files are the obvious half. The runtime half matters for
     a subtler reason: artwork is cache-first with no revalidation, so a
     changed assets/beans.jpg under the same name would otherwise be
     served out of the runtime cache forever. activate() deletes every
     cache that is not C, so folding the runtime files into the hash is
     what evicts them when they change. Two deploys that touch nothing
     the worker serves still share a cache name, which is the property
     this was written for. */
  const fingerprint = entries
    .map(e => `${e.url}\0${sha(fs.readFileSync(path.join(APP, e.file)))}`)
    .join('\n');
  const cache = 'crema-' + sha(Buffer.from(fingerprint)).slice(0, 12);

  /* ASSETS is only what install() fetches up front. The rest reaches the
     same cache through the fetch handler, the first time it is asked
     for, and is offline from then on. */
  const precached = entries.filter(e => e.precache);
  const list = precached.map(e => `  '${e.url}',`).join('\n');
  return { cache, entries, precached,
    block: `const C = '${cache}';\nconst ASSETS = [\n${list}\n];` };
}

/* The two statements live between markers so this script rewrites
   exactly them and never the prose around them — the comments in sw.js
   explaining why it caches the way it does are worth more than the list
   and are not generated. */
const BEGIN = '/* @generated by platform/gen-sw-assets.mjs — do not edit by hand */';
const END   = '/* @end generated */';

function splice(src, block) {
  const i = src.indexOf(BEGIN), j = src.indexOf(END);
  if (i < 0 || j < 0) {
    console.error(`sw.js has no ${BEGIN} … ${END} block to write into.`);
    process.exit(2);
  }
  return src.slice(0, i) + BEGIN + '\n' + block + '\n' + src.slice(j);
}

/* ------------------------------------------------------------
   Everything below is the command-line half, and it only runs when this
   file IS the command. platform/capacitor/sync.mjs imports collect()
   above to stage the native shell's assets from the same rules — the
   list of files the app is made of should exist once, not twice — and an
   import must not rewrite sw.js or call process.exit() as a side effect.
   ------------------------------------------------------------ */
const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) main();

function main() {
const { cache, entries, precached, block } = build();
const arg = process.argv[2] || '';

if (arg === '--print') { console.log(block); process.exit(0); }

const before = fs.readFileSync(SW, 'utf8');
const after  = splice(before, block);

if (arg === '--check') {
  if (before === after) {
    console.log(`sw.js is current — ${precached.length} precached, ${entries.length - precached.length} runtime-cached, cache ${cache}`);
    process.exit(0);
  }
  console.error('sw.js is out of date.\n');
  /* Only what is between the markers — the prose around them mentions
     './index.html' and './icon-192.png', and reading those as list
     entries would report files as dropped that were never in it. */
  const region = before.slice(before.indexOf(BEGIN), before.indexOf(END));
  const cur = new Set([...region.matchAll(/'(\.\/[^']*)'/g)].map(m => m[1]));
  const want = new Set(precached.map(e => e.url));
  const added   = [...want].filter(u => !cur.has(u));
  const dropped = [...cur].filter(u => !want.has(u));
  if (added.length)   console.error('  not precached: ' + added.join(', '));
  if (dropped.length) console.error('  no longer precached (gone, excluded, or now runtime-cached): ' + dropped.join(', '));
  if (!added.length && !dropped.length) console.error(`  the list is right; a precached file changed, so the cache name has to (${cache}).`);
  console.error('\nRun:  node platform/gen-sw-assets.mjs   and commit sw.js.');
  process.exit(1);
}

if (before === after) { console.log(`sw.js already current — ${precached.length} precached, ${entries.length - precached.length} runtime-cached, cache ${cache}`); process.exit(0); }
fs.writeFileSync(SW, after);
console.log(`sw.js rewritten — ${precached.length} precached, ${entries.length - precached.length} runtime-cached, cache ${cache}`);
}
