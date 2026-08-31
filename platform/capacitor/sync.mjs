#!/usr/bin/env node
/* ============================================================
   Stage the web app into platform/capacitor/www/ for Capacitor.

     node sync.mjs            # rebuild www/ from the repo root
     node sync.mjs --check    # is www/ current? (exit 1 if not)

   WHY THIS FILE EXISTS AT ALL — and why `webDir` is not the repo root.

   brain/13-infrastructure-plan.md's prompt for step 4.1 says "webDir
   pointing at the repo root as it is". It cannot be, and the reason is
   worth stating in full because the instruction reads so reasonably.

   Capacitor copies `webDir` **wholesale** into the app bundle. The repo
   root is the web root, and it also holds things that are in the repo
   but are not the web app: platform/android-twa/android.keystore, the
   upload certificate, keystore-secrets.DO-NOT-COMMIT.txt, the untracked
   STRATEGY.md, every .sql migration, e2e/ and its node_modules, and
   .git itself. An .ipa and an .apk are both zip files. Anyone who
   downloads the app from either store can unzip it.

   Pointing webDir at the root would therefore publish the Play signing
   key to every person who installs Crema — which is worse than any
   outage this whole plan is written to prevent, and unrecoverable: a
   leaked upload key means a new package name and a new listing.

   So the shell gets an ALLOWLIST, not a directory. And the allowlist is
   not typed out here either — it is the same rules that build the
   service worker's precache list, imported from
   platform/gen-sw-assets.mjs. That list is already, by construction,
   "the files the app is made of": it is what a browser needs to open
   Crema with no network, which is exactly what a native bundle is.
   One list, one place, no drift. Adding a module to src/ puts it in the
   binary for the same reason it puts it in the precache — nobody has to
   remember this file exists.

   WHAT THE NATIVE BUNDLE ADDS on top of that list, and why each:

     · the legal pages (privacy/, impressum/, child-safety/, legal.css,
       legal.js). Deliberately NOT precached for the web — see the note
       in gen-sw-assets.mjs, they are documents you read once from the
       network so you get the current one. But a native app is expected
       to open them offline, App Review follows the privacy link on a
       device that may be in airplane mode, and there is no network
       fallback inside a binary. So they ship.
     · offline.html — the shell's own error page. See below.

   WHAT IT LEAVES OUT, deliberately:

     · sw.js and its registration. A service worker inside a Capacitor
       app is a second cache in front of assets that are ALREADY local,
       with stale-while-revalidate revalidating against capacitor://
       localhost — it can only ever be wrong. Native gets its assets
       from the binary and its pushes from APNs/FCM, which are the two
       jobs sw.js does on the web. src/core/native.js is what tells
       app.js to skip registering it.
     · og-cover.png, the same exclusion the precache makes: a social
       preview fetched by crawlers off the network, never by the app.
   ============================================================ */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { collect } from '../gen-sw-assets.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP  = path.resolve(HERE, '../..');       // the repo root = the web root
const WWW  = path.join(HERE, 'www');

/* Files the app is made of, from the single source of truth, plus the
   native-only additions above. `url` is './something' — the path
   relative to the web root, which is also where it lands in www/. */
function manifest(){
  const entries = collect().map(e => e.file);

  /* The legal pages, walked rather than listed: a fourth one added next
     month should ship without anyone editing this file. */
  for(const dir of ['privacy', 'impressum', 'child-safety']){
    const abs = path.join(APP, dir);
    if(!fs.existsSync(abs)) continue;
    for(const name of fs.readdirSync(abs).sort()){
      if(fs.statSync(path.join(abs, name)).isFile()) entries.push(`${dir}/${name}`);
    }
  }
  entries.push('legal.css', 'legal.js');

  /* index.html is in the precache list as './' — the URL a navigation
     asks for. A file on disk needs its real name. */
  return [...new Set(entries.map(f => f === 'index.html' ? 'index.html' : f))];
}

/* ------------------------------------------------------------
   The assertion this file is really for.

   Everything above is a list of things to INCLUDE, so in principle
   nothing else can get in. This checks the result anyway, because the
   cost of being wrong is the signing key and the cost of the check is
   nothing. It runs on the staged output, not on the intent.
   ------------------------------------------------------------ */
const FORBIDDEN = [
  /\.keystore$/i, /\.jks$/i, /\.pem$/i, /\.p12$/i, /\.p8$/i, /\.mobileprovision$/i,
  /\.aab$/i, /\.apk$/i, /\.sql$/i, /\.env$/i, /(^|\/)\.git(\/|$)/,
  /secret/i, /credential/i, /service[-_]?role/i, /DO-NOT-COMMIT/i,
  /(^|\/)STRATEGY\.md$/, /(^|\/)node_modules(\/|$)/, /(^|\/)e2e(\/|$)/,
  /(^|\/)brain(\/|$)/, /(^|\/)business(\/|$)/,
];

function auditStaged(files){
  const bad = files.filter(f => FORBIDDEN.some(re => re.test(f)));
  if(bad.length){
    console.error('REFUSING TO STAGE — these would have been copied into the app binary:');
    for(const f of bad) console.error('  ' + f);
    console.error('\nAn .ipa and an .apk are zip files. Read the header of this script.');
    process.exit(2);
  }
}

/* A second, blunter net: nothing outside the repo root, no symlinks
   pointing out of it, and no file the manifest did not name. */
function resolveSafe(rel){
  const abs = path.resolve(APP, rel);
  if(abs !== path.normalize(abs) || !abs.startsWith(APP + path.sep)){
    console.error(`refusing a path that escapes the web root: ${rel}`);
    process.exit(2);
  }
  return abs;
}

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

function build(){
  const files = manifest();
  auditStaged(files);

  const missing = files.filter(f => !fs.existsSync(resolveSafe(f)));
  if(missing.length){
    console.error('named by a rule but not on disk:\n  ' + missing.join('\n  '));
    process.exit(2);
  }

  const out = new Map();                       // relative path → bytes
  for(const f of files) out.set(f, fs.readFileSync(resolveSafe(f)));
  out.set('offline.html', fs.readFileSync(path.join(HERE, 'offline.html')));
  return out;
}

/* A content hash of the whole staged tree, so --check can answer
   "is www/ current?" without diffing 60-odd files by hand, and so a
   release can tell whether the shell's assets moved at all. */
function fingerprint(map){
  return sha(Buffer.from([...map.keys()].sort()
    .map(k => `${k}\0${sha(map.get(k))}`).join('\n')));
}

function readStaged(){
  if(!fs.existsSync(WWW)) return null;
  const map = new Map();
  const walk = dir => {
    for(const e of fs.readdirSync(path.join(WWW, dir), { withFileTypes:true })){
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if(e.isDirectory()) walk(rel);
      else map.set(rel, fs.readFileSync(path.join(WWW, rel)));
    }
  };
  walk('');
  return map;
}

const want = build();
const arg  = process.argv[2] || '';

if(arg === '--check'){
  const have = readStaged();
  if(have && fingerprint(have) === fingerprint(want)){
    console.log(`www/ is current — ${want.size} files, ${fingerprint(want).slice(0,12)}`);
    process.exit(0);
  }
  console.error('www/ is out of date. Run:  node platform/capacitor/sync.mjs');
  process.exit(1);
}

/* Rebuilt from empty every time. An incremental copy leaves a file that
   was REMOVED from src/ sitting in the bundle, still being loaded by an
   index.html that no longer mentions it — the exact stale-asset class of
   bug Phase 2 was written to end. */
fs.rmSync(WWW, { recursive:true, force:true });
for(const [rel, bytes] of want){
  const dest = path.join(WWW, rel);
  fs.mkdirSync(path.dirname(dest), { recursive:true });
  fs.writeFileSync(dest, bytes);
}
console.log(`www/ staged — ${want.size} files, ${fingerprint(want).slice(0,12)}`);
