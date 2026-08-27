#!/usr/bin/env node
/* ============================================================
   Generate the push_i18n seed for step-1.32.sql.

     node platform/supabase/gen-push-i18n.mjs          # print the block
     node platform/supabase/gen-push-i18n.mjs --check  # is it in step?

   Why this exists.

   Push text is composed in plpgsql, hours after anyone was looking at a
   screen, so the German has to be somewhere Postgres can read it. That
   is a second copy of strings src/i18n.de.js already holds, and a second
   copy kept by hand is a second copy that drifts — the app would say
   "gefällt dein Kaffee" and the phone would say "liked your pour".

   So it isn't kept by hand. src/i18n.de.js stays the one place German is
   WRITTEN; this reads it and prints SQL. The keys are only those that
   can actually reach a push:

     * the notification bodies the triggers compose (KEYS below), each
       one grepped out of a migration and named with the file it lives in
     * every challenge title, read straight out of step-1.17.sql, so a
       template added there cannot be forgotten here
     * the four strings that exist only as push (streak, digest)

   Re-run it after touching any of those, paste the block into a new
   migration, and run that. `--check` says whether the committed
   step-1.32.sql still matches what src/i18n.de.js would produce now; it
   is what a future "did we forget" question should ask rather than a
   reader diffing 60 quoted strings by eye.
   ============================================================ */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP  = path.resolve(HERE, '../..');

const { DE } = await import(path.join(APP, 'src/i18n.de.js'));

/* Bodies written into `notifications` by a trigger. The client renders
   the same strings through notifBody() in src/data/notifications.js —
   that is the point: one vocabulary, two renderers. */
const KEYS = [
  // step-1.8 — likes, comments, follows
  'liked your pour',
  'commented on your pour',
  'started following you',
  'wants to follow you',
  'accepted your follow request',
  // step-1.19 — reactions and mentions
  'loved your latte art',
  'loved where you had it',
  'loved your choice of coffee',
  'reacted to your pour',
  'mentioned you in a comment',
  // step-1.18 — the podium, medal and all
  "🥇 1st place on today's podium",
  "🥈 2nd place on today's podium",
  "🥉 3rd place on today's podium",
  // step-1.17 — the challenge payout, which is built out of parts
  'Challenge complete: {title} · +{n} points',
  // step-1.30 / step-1.31 — the daily race and a friend's first pour
  'First coffee in Crema today · +20 points',
  'poured the first coffee of the day',
  'poured a coffee',
  // step-1.27 — telling a reporter what happened
  'We looked at what you reported and acted on it. Thank you for flagging it.',
  'We looked at what you reported and left it up. Thank you for flagging it.',
  // step-1.16 — the two Crema-initiated pushes. These never appear in
  // the inbox, so they exist in src/i18n.de.js for this alone.
  'Your streak ends tonight',
  '{n} days so far — one pour keeps it going.',
  'Your week in coffee',
  '{n} pour', '{n} pours',
  '{n} like', '{n} likes',
  '{n} new follower', '{n} new followers'
];

/* Every challenge title, from the templates themselves. The insert is
   one row per template: (code,cat,kind,goal,param, 'Title','Blurb',…) —
   the title is the first quoted string on the line after the code. */
function challengeTitles(){
  const sql = fs.readFileSync(path.join(HERE, 'step-1.17.sql'), 'utf8');
  const block = sql.split('insert into challenge_templates')[1] || '';
  const seed = block.split('on conflict')[0];
  const out = [];
  /* "   'Five Mornings','Log a coffee…','#ritual','heart',50)," — the
     title is the first of the four editorial strings on the line. */
  for (const line of seed.split('\n')) {
    const m = line.match(/^\s+'((?:''|[^'])+)','((?:''|[^'])+)','#/);
    if (m) out.push(m[1].replace(/''/g, "'"));
  }
  return out;
}

const rows = [];
const missing = [];
for (const k of [...KEYS, ...challengeTitles()]) {
  const de = DE[k];
  if (de == null) { missing.push(k); continue; }
  rows.push([k, de]);
}

const q = s => "'" + s.replace(/'/g, "''") + "'";
const block =
  'insert into push_i18n (key, lang, txt) values\n'
  + rows.map(([k, de]) => `  (${q(k)}, 'de', ${q(de)})`).join(',\n')
  + '\non conflict (key, lang) do update set txt = excluded.txt;';

if (process.argv.includes('--check')) {
  const cur = fs.readFileSync(path.join(HERE, 'step-1.32.sql'), 'utf8');
  const ok = cur.includes(block);
  if (missing.length) console.error('no German for: ' + missing.map(q).join(', '));
  console.log(ok ? 'step-1.32.sql seed matches src/i18n.de.js'
                 : 'DRIFT — step-1.32.sql seed is not what src/i18n.de.js would produce');
  process.exit(ok && !missing.length ? 0 : 1);
}

if (missing.length) {
  console.error('-- WARNING, no German for these — they will push in English:');
  missing.forEach(k => console.error('--   ' + q(k)));
}
console.log(block);
