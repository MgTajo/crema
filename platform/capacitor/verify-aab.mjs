#!/usr/bin/env node
/* ============================================================
   Check the built Android bundle before it goes anywhere near Play.

     node verify-aab.mjs [path/to/app-release.aab]

   Three questions, and they are the ones that are expensive to get
   wrong. The third was added on 2026-09-08 and is the reason the file is
   worth running at all — see brain/16-release-discipline.md, gate G2.

   0. IS THIS BUNDLE FROM A RELEASE THAT PASSED?

      On 2026-09-05 a bundle was built forty minutes before CI had ever
      seen the commit inside it, from a tag that existed on one laptop.
      The Release run then failed, so the migration never ran and the web
      was correctly held back — but the .aab had already gone to Play,
      where nothing can hold anything back and nothing can be rolled
      back. Every Android user read every profile as empty for two days.

      This script ran on that bundle and printed `ok — safe to upload`,
      because both of the questions below are about the BOX. Neither is
      about what is in it, and neither could have known. ⚠️ A verifier
      that overstates its scope is worse than one that does not run: it
      is what made the upload feel checked.

      So five checks come first, and they are all about provenance.

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

   3. DID R8 LEAVE THE CAPACITOR BRIDGE ALONE?

      Added 2026-09-13, after v1.9.4 shipped a crash that only a release
      build could have: switching the language closed the app. The path
      was set-lang → syncPush() → pushEnabled() → the PushNotifications
      plugin's checkPermissions, and R8 had deleted
      `PluginHandle.pluginAnnotation` — so Plugin.getPermissionStates()
      read the annotation as null, threw on the CapacitorPlugins thread,
      and an uncaught exception on any thread ends the process. ⚠️ No
      try/catch in JavaScript can prevent that; core/native.js's call()
      has already returned by the time Java throws.

      Every debug build in the project's history was fine, because R8
      does not run on one. So the only place this is visible before a
      user finds it is the release build's OWN REPORT: R8 writes
      `usage.txt` next to the bundle listing everything it removed. If
      anything of substance in com.getcapacitor or com.capacitorjs is in
      that list, the bridge has been shrunk and some plugin call will
      fail on a device. Compiler artefacts — <clinit>, synthetic lambdas,
      R8's own -IA classes — are not source and are ignored.

      This is the cheapest possible stand-in for running the store build
      on a phone, which nothing in CI does.

   Exit 0 means all four hold. Anything else means do not upload.
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

/* ---------- 0. the provenance ----------
   Everything here is a question about the COMMIT, asked of git, of
   origin, of GitHub Actions and of production — never of the zip. The
   order is cheapest-and-most-local first, so a laptop mistake is caught
   before the network is touched.

   `soft` marks the checks that need a network or a CLI that may not be
   installed. Those cannot fail the build — a verifier that refuses to
   answer when the wifi is down would simply be skipped, and a skipped
   gate is no gate. They downgrade the verdict instead, which is what the
   closing line now reports honestly. */
console.log('provenance');
let unchecked = 0;
const soft = (label, why) => { unchecked++; say(`? ${label} — not checked (${why})`); };
const git = c => execSync(c, { cwd: HERE, encoding:'utf8', stdio:['ignore','pipe','ignore'] }).trim();

/* 1. exactly on a tag, not near one. `--exact-match` is the whole point:
      `git describe` alone happily answers v1.9.2-3-gabc1234. */
let tag = '';
try{ tag = git('git describe --tags --exact-match HEAD'); }catch(e){ tag = ''; }
if(!tag){
  fail.push('HEAD is not exactly on a tag — a store build must be a release, not a commit');
  say('✗ HEAD is not on a tag. versionCode is derived from one, and Play');
  say('  never lets a versionCode be used twice.');
}else say(`✓ HEAD is exactly ${tag}`);

/* 2. a clean tree. Anything uncommitted is, by definition, not in the
      tag — and would be in the bundle. */
let dirty = '';
try{ dirty = git('git status --porcelain'); }catch(e){ dirty = ''; }
if(dirty){
  fail.push('the working tree is dirty — the bundle would contain code that is not in the tag');
  say('✗ uncommitted changes:');
  for(const l of dirty.split('\n').slice(0, 8)) say('    ' + l);
}else say('✓ working tree is clean');

/* 3. the tag is on origin. THIS ONE ALONE WOULD HAVE STOPPED v1.9.0:
      at the moment that bundle was built the tag was local only, so no
      CI anywhere had been given the chance to have an opinion. */
if(tag){
  let remote = null;
  try{ remote = git(`git ls-remote --tags origin refs/tags/${tag}`); }
  catch(e){ remote = null; }
  if(remote === null) soft(`${tag} on origin`, 'could not reach origin');
  else if(!remote){
    fail.push(`${tag} exists only on this machine — push it and let the release run`);
    say(`✗ ${tag} is not on origin. Nothing has built or tested this commit.`);
    say(`  Run:  git push origin ${tag}`);
  }else say(`✓ ${tag} is on origin`);
}

/* 4. that tag's Release run went green. The bundle is an input to a
      store, so the pipeline cannot hold it back; this is the one place
      the pipeline's verdict can be made to matter. */
if(tag){
  let runs = null;
  try{
    runs = JSON.parse(execSync(
      `gh run list --workflow Release --limit 40 --json headBranch,headSha,conclusion,status,displayTitle`,
      { cwd: HERE, encoding:'utf8', stdio:['ignore','pipe','ignore'] }));
  }catch(e){ runs = null; }
  if(!runs) soft(`the Release run for ${tag}`, 'gh unavailable or not authenticated');
  else{
    let sha = '';
    try{ sha = git(`git rev-list -n1 ${tag}`); }catch(e){ sha = ''; }
    const run = runs.find(r => r.headBranch === tag || (sha && r.headSha === sha));
    if(!run) soft(`the Release run for ${tag}`, 'no run found yet — has the tag finished pushing?');
    else if(run.conclusion === 'success') say(`✓ the Release run for ${tag} is green`);
    else{
      fail.push(`the Release run for ${tag} is ${run.status === 'completed' ? run.conclusion : run.status}`);
      say(`✗ Release for ${tag}: ${run.status} / ${run.conclusion}`);
      say('  Migrations and the web deploy are gated on that run. A bundle');
      say('  built now can meet a production database the run never updated.');
    }
  }
}

/* 5. production already has every migration in the repo. This is the
      check that maps directly onto the bug: v1.9.0 asked production for
      profiles.badges, and production did not have it, because `migrate`
      was skipped by the failed run above. Ordering, not existence — the
      files are the source of truth for what the code expects. */
{
  const dir = path.join(HERE, '../supabase/migrations');
  let want = [];
  try{
    want = fs.readdirSync(dir).filter(f => /^\d{14}.*\.sql$/.test(f)).map(f => f.slice(0, 14)).sort();
  }catch(e){ want = []; }
  if(!want.length) soft('production migrations', 'no migrations directory to compare against');
  else{
    let listed = '';
    try{
      listed = execSync('supabase migration list --linked', {
        cwd: path.join(HERE, '../supabase'), encoding:'utf8', stdio:['ignore','pipe','ignore'] });
    }catch(e){ listed = ''; }
    if(!listed) soft('production migrations', 'supabase CLI unavailable or not linked');
    else{
      /* ⚠️ TWO OUTPUT SHAPES, and getting this wrong is worse than not
         checking: the first version of this parser read the JSON as a
         table and declared all ten migrations missing on a database that
         had every one of them. A gate that cries wolf is a gate someone
         turns off.

         CLI 2.109 prints a JSON document ({migrations:[{local,remote}]}),
         older builds print a `local | remote | time` table. Take the
         JSON when it is there, and read the table only as a fallback —
         in both, `remote` being non-empty is the whole question. */
      const remote = new Set();
      const json = /\{\s*"migrations"\s*:.*\}/s.exec(listed);
      if(json){
        try{
          for(const r of JSON.parse(json[0]).migrations || []) if(r && r.remote) remote.add(String(r.remote));
        }catch(e){ /* fall through to the table reader */ }
      }
      if(!remote.size){
        for(const line of listed.split('\n')){
          const cols = line.split('|');
          if(cols.length < 3) continue;
          const rem = (cols[1] || '').trim();
          if(/^\d{14}$/.test(rem)) remote.add(rem);
        }
      }
      const missing = want.filter(v => !remote.has(v));
      if(missing.length){
        fail.push(`production is missing ${missing.length} migration(s) this build expects`);
        say('✗ not applied to production:');
        for(const v of missing) say('    ' + v);
        say('  This is the shape of the v1.9.0 incident: new code, old schema.');
      }else say(`✓ production has all ${want.length} migrations`);
    }
  }
}

console.log('');
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

/* ---------- 3. what R8 took out ----------
   The bundle cannot answer this; R8's report beside it can. usage.txt
   lists every class and member the shrinker removed, one class per
   unindented line with its removed members indented under it.

   A short list of shapes is ignored, and every one of them is something
   a compiler wrote rather than a person:

     <clinit>                        a static initialiser R8 folded away
     $$…SyntheticLambda              desugaring's own classes
     $r8$lambda$…                    and its methods
     …-IA                            R8's interface-abstraction synthetics

   Anything else in com.getcapacitor or com.capacitorjs means a keep rule
   in configure-native.mjs no longer covers what it used to. */
console.log('\nR8');
{
  const mapping = path.resolve(path.dirname(AAB), '../../mapping/release/usage.txt');
  if(!fs.existsSync(mapping)) soft('what R8 removed', 'no usage.txt beside the bundle');
  else if(fs.statSync(mapping).mtimeMs < fs.statSync(AAB).mtimeMs - 15 * 60 * 1000){
    soft('what R8 removed', 'usage.txt is older than the bundle — stale report');
  }else{
    const BRIDGE = /^(com\.getcapacitor|com\.capacitorjs)[.$]/;
    const ARTEFACT = /<clinit>|SyntheticLambda|\$r8\$lambda\$|-IA$/;
    const gone = [];
    let cls = '';
    for(const raw of fs.readFileSync(mapping, 'utf8').split('\n')){
      if(!raw.trim()) continue;
      if(/^\s/.test(raw)){
        if(cls && !ARTEFACT.test(raw)) gone.push(`${cls}: ${raw.trim()}`);
        continue;
      }
      const name = raw.replace(/:$/, '').trim();
      cls = BRIDGE.test(name) && !ARTEFACT.test(name) ? name : '';
      /* A whole class removed is listed with no members under it. */
      if(cls && !raw.endsWith(':') && !ARTEFACT.test(name)) gone.push(cls);
    }
    if(gone.length){
      fail.push(`R8 removed ${gone.length} thing(s) from the Capacitor bridge — plugin calls will crash on a device`);
      say('✗ shrunk out of the bridge:');
      for(const g of gone.slice(0, 12)) say('    ' + g);
      if(gone.length > 12) say(`    …and ${gone.length - 12} more`);
      say('  This is the v1.9.4 language-switch crash. Check the keep rules');
      say('  in configure-native.mjs, re-run it, and rebuild.');
    }else say('✓ the Capacitor bridge survived the shrinker intact');
  }
}

/* ---------- verdict ---------- */
if(fail.length){
  console.error('\nDO NOT UPLOAD:');
  for(const f of fail) console.error('  · ' + f);
  process.exit(1);
}
if(unchecked){
  console.log(`\nchecked what it could — ${unchecked} question(s) went unanswered above.`);
  console.log('The box is sound. Whether this commit is a release, this could not fully say.\n');
  process.exit(0);
}
console.log('\nok — safe to upload\n');
