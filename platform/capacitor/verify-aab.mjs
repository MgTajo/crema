#!/usr/bin/env node
/* ============================================================
   Check the built Android bundle before it goes anywhere near Play.

     node verify-aab.mjs [path/to/app-release.aab]

   Two questions, and they are the two that are expensive to get wrong.

   1. IS IT SIGNED WITH THE KEY PLAY EXPECTS?

      Play registers exactly one upload certificate per app and rejects
      anything else — but not helpfully: the error arrives after the
      upload, in the browser, and says little. Worse, this repo contains
      three plausible-looking candidates and two of them are wrong:

        pwab/signing.keystore, my-key-alias   01:1A:73:…  ← the real one
        android.keystore                       E6:38:C8:…  superseded
        upload-certificate.pem                 E6:38:C8:…  ← NOT the
                                                            upload cert,
                                                            despite the
                                                            filename

      The secrets file records the second as "generated locally before we
      knew Play already had an upload key registered". The .pem is that
      same superseded certificate. So the name of the file is actively
      misleading, and a fingerprint check is the only thing that settles
      it. This script does that check.

   2. IS THERE ANYTHING IN THE BUNDLE THAT SHOULD NOT SHIP?

      The same rule sync.mjs enforces on the staged web assets, applied
      to the finished artefact instead of the intent. An .aab is a zip
      file and anyone who downloads the app can open it. sync.mjs is a
      whitelist and should make this impossible; this is the check that
      it did, run against the thing that actually ships.

   Exit 0 means both hold. Anything else means do not upload.
   ============================================================ */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* The fingerprint Play has registered. Hard-coded on purpose: the whole
   point is to compare against a constant that a wrong keystore cannot
   change. It matches entry 4 of app/.well-known/assetlinks.json. */
const EXPECTED =
  '01:1A:73:4E:76:F1:86:C9:A2:5C:91:3C:3C:DA:D6:F8:39:57:5A:04:4B:24:A6:D0:E0:20:52:85:F3:7B:A6:A6';

const AAB = process.argv[2]
  || path.join(HERE, 'android/app/build/outputs/bundle/release/app-release.aab');

if(!fs.existsSync(AAB)){
  console.error(`no bundle at ${AAB}\nRun:  npm run build:android`);
  process.exit(2);
}

const fail = [];
const say  = s => console.log('  ' + s);

console.log(`\nchecking ${path.relative(HERE, AAB)}\n`);

/* ---------- 1. the signature ---------- */
console.log('signature');
let printed = '';
try{
  /* keytool reads the signature block out of the zip. apksigner does not
     understand .aab, and jarsigner's output is harder to parse — this is
     the portable way to ask "who signed this". */
  printed = execSync(
    `unzip -p ${JSON.stringify(AAB)} 'META-INF/*.RSA' 2>/dev/null | keytool -printcert 2>/dev/null`
    + ` || unzip -p ${JSON.stringify(AAB)} 'META-INF/*.EC' 2>/dev/null | keytool -printcert 2>/dev/null`,
    { shell:'/bin/bash', encoding:'utf8' });
}catch(e){ printed = ''; }

const m = /SHA256:\s*([0-9A-F:]{95})/i.exec(printed);
if(!m){
  fail.push('could not read a certificate from the bundle — is it signed at all?');
  say('✗ no certificate found. An unsigned bundle means keystore.properties');
  say('  was missing when Gradle ran; see keystore.properties.example.');
}
else{
  const got = m[1].toUpperCase();
  if(got === EXPECTED){
    say('✓ signed with the registered Play upload key');
    say(`  ${got.slice(0, 47)}…`);
  }else{
    fail.push('signed with the WRONG key — Play will reject this upload');
    say('✗ wrong signing key.');
    say(`  expected ${EXPECTED}`);
    say(`  got      ${got}`);
    say('  The right one is pwab/signing.keystore, alias my-key-alias —');
    say('  NOT android.keystore and NOT upload-certificate.pem.');
  }
}

/* ---------- 2. the contents ---------- */
console.log('\ncontents');
const FORBIDDEN = [
  /\.keystore$/i, /\.jks$/i, /\.pem$/i, /\.p12$/i, /\.p8$/i,
  /\.sql$/i, /\.env$/i, /secret/i, /credential/i, /DO-NOT-COMMIT/i,
  /keystore\.properties$/i, /(^|\/)STRATEGY\.md$/, /service[-_]?role/i,
];
let listing = '';
try{ listing = execSync(`unzip -Z1 ${JSON.stringify(AAB)}`, { encoding:'utf8' }); }
catch(e){ fail.push('could not list the bundle'); }

const entries = listing.split('\n').filter(Boolean);
const bad = entries.filter(f => FORBIDDEN.some(re => re.test(f)));
if(bad.length){
  fail.push('the bundle contains files that must not ship');
  say('✗ found:');
  for(const f of bad) say('    ' + f);
}else{
  say(`✓ ${entries.length} entries, nothing forbidden`);
}

/* A positive check too: the app's own code should actually be in there.
   A bundle that is clean because it is empty is not a success. */
const assets = entries.filter(f => /assets\/public\//.test(f));
if(assets.length < 40){
  fail.push(`only ${assets.length} web assets in the bundle — expected ~70`);
  say(`✗ assets/public/ has ${assets.length} files; the web app is missing or partial`);
}else{
  say(`✓ assets/public/ carries ${assets.length} files`);
}

/* ---------- verdict ---------- */
if(fail.length){
  console.error('\nDO NOT UPLOAD:');
  for(const f of fail) console.error('  · ' + f);
  process.exit(1);
}
console.log('\nok — safe to upload\n');
