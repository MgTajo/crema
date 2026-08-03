#!/usr/bin/env node
/* ============================================================
   RLS policy test (Roadmap step 1.2)

   "Don't trust that they work because the app looks fine — the app
   runs as one user." This signs in as TWO users and asserts what
   each can and cannot do through the Data API, using the same
   publishable key the browser uses.

   Create two throwaway accounts in Authentication → Users first
   (or via the app's sign-up), then:

     CREMA_EMAIL_A=a@example.com CREMA_PW_A=… \
     CREMA_EMAIL_B=b@example.com CREMA_PW_B=… \
     node supabase/rls-test.mjs

   Exits non-zero if any policy is wrong.
   ============================================================ */

const URL  = process.env.CREMA_URL  || 'https://diabtvahplwoipvrprvb.supabase.co';
const KEY  = process.env.CREMA_KEY  || 'sb_publishable_Dl-0fert2JgI005EaRauNw_ytYbmeVL';
const A = { email: process.env.CREMA_EMAIL_A, pw: process.env.CREMA_PW_A };
const B = { email: process.env.CREMA_EMAIL_B, pw: process.env.CREMA_PW_B };

if (!A.email || !A.pw || !B.email || !B.pw) {
  console.error('Set CREMA_EMAIL_A / CREMA_PW_A / CREMA_EMAIL_B / CREMA_PW_B (two existing test accounts).');
  process.exit(2);
}

let pass = 0, fail = 0;
const ok   = m => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${m}`); };
const bad  = (m, d) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${m}${d ? `\n      ${d}` : ''}`); };
const check = (cond, m, d) => { cond ? ok(m) : bad(m, d); };

async function signIn({ email, pw }) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`sign-in failed for ${email}: ${j.error_description || j.msg || r.status}`);
  return { token: j.access_token, uid: j.user.id };
}

/* one REST call; returns {status, body} rather than throwing, because
   a 401/403 IS the expected result for half these assertions */
async function rest(path, { token, method = 'GET', body, prefer } = {}) {
  const h = { apikey: KEY, 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  if (prefer) h.Prefer = prefer;
  const r = await fetch(`${URL}/rest/v1/${path}`, { method, headers: h, body: body && JSON.stringify(body) });
  const text = await r.text();
  let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: r.status, body: parsed };
}

const run = async () => {
  console.log('\nSigning in as two users…');
  const a = await signIn(A), b = await signIn(B);
  console.log(`  A = ${a.uid}\n  B = ${b.uid}\n`);
  if (a.uid === b.uid) { console.error('Both env vars point at the same account.'); process.exit(2); }

  /* ---------- profiles ---------- */
  console.log('profiles');
  for (const [who, s] of [['A', a], ['B', b]]) {
    const r = await rest(`profiles?id=eq.${s.uid}`, { token: s.token });
    if (!r.body?.length) {
      const c = await rest('profiles', { token: s.token, method: 'POST', prefer: 'return=representation',
        body: { id: s.uid, handle: `rlstest_${who.toLowerCase()}_${Date.now()}`, name: `RLS Test ${who}` } });
      check(c.status === 201, `${who} can create their own profile`, `got ${c.status} ${JSON.stringify(c.body)}`);
    } else ok(`${who} already has a profile`);
  }
  {
    const r = await rest(`profiles?id=eq.${b.uid}`, { token: a.token });
    check(r.status === 200 && r.body?.length === 1, 'A can read B\'s profile (public)');
  }
  {
    const r = await rest(`profiles?id=eq.${b.uid}`, { token: a.token, method: 'PATCH',
      prefer: 'return=representation', body: { name: 'HACKED' } });
    check(r.status === 200 && r.body?.length === 0, 'A CANNOT edit B\'s profile',
      `expected 0 rows changed, got ${r.status} ${JSON.stringify(r.body)}`);
  }
  {
    const r = await rest('profiles', { token: a.token, method: 'POST',
      body: { id: b.uid, handle: `spoof_${Date.now()}`, name: 'Spoof' } });
    check(r.status >= 400, 'A CANNOT create a profile owned by B', `got ${r.status}`);
  }

  /* ---------- posts ---------- */
  console.log('\nposts');
  let postA;
  {
    const r = await rest('posts', { token: a.token, method: 'POST', prefer: 'return=representation',
      body: { user_id: a.uid, drink: 'Cappuccino', caption: 'rls test', art: true, pattern: 'heart' } });
    check(r.status === 201, 'A can create their own post', `got ${r.status} ${JSON.stringify(r.body)}`);
    postA = r.body?.[0]?.id;
  }
  {
    const r = await rest('posts', { token: b.token, method: 'POST',
      body: { user_id: a.uid, drink: 'Latte', caption: 'forged' } });
    check(r.status >= 400, 'B CANNOT create a post as A', `got ${r.status}`);
  }
  if (postA) {
    const anon = await rest(`posts?id=eq.${postA}`, {});
    check(anon.status === 200 && anon.body?.length === 1, 'signed-out reader can see the post (feed is public)');

    const r = await rest(`posts?id=eq.${postA}`, { token: b.token, method: 'PATCH',
      prefer: 'return=representation', body: { caption: 'HACKED' } });
    check(r.status === 200 && r.body?.length === 0, 'B CANNOT edit A\'s post',
      `expected 0 rows changed, got ${r.status} ${JSON.stringify(r.body)}`);

    const d = await rest(`posts?id=eq.${postA}`, { token: b.token, method: 'DELETE', prefer: 'return=representation' });
    check(d.status === 200 && d.body?.length === 0, 'B CANNOT delete A\'s post',
      `expected 0 rows deleted, got ${d.status} ${JSON.stringify(d.body)}`);
  }

  /* ---------- saves: private ---------- */
  console.log('\nsaves (must be owner-only)');
  if (postA) {
    await rest('saves', { token: a.token, method: 'POST', body: { user_id: a.uid, post_id: postA } });
    const mine = await rest(`saves?post_id=eq.${postA}`, { token: a.token });
    check(mine.body?.length === 1, 'A can read their own saves');
    const theirs = await rest(`saves?post_id=eq.${postA}`, { token: b.token });
    check(theirs.status === 200 && theirs.body?.length === 0, 'B CANNOT see A\'s saves',
      `leaked ${JSON.stringify(theirs.body)}`);
  }

  /* ---------- notifications: the one people get wrong ---------- */
  console.log('\nnotifications (must be owner-read-only)');
  {
    const r = await rest(`notifications?user_id=eq.${a.uid}`, { token: b.token });
    check(r.status === 200 && r.body?.length === 0, 'B CANNOT read A\'s notifications',
      `leaked ${JSON.stringify(r.body)}`);
    const i = await rest('notifications', { token: b.token, method: 'POST',
      body: { user_id: a.uid, type: 'like', body: 'forged' } });
    check(i.status >= 400, 'B CANNOT forge a notification for A', `got ${i.status}`);
  }

  /* ---------- reference data ---------- */
  console.log('\nreference data (public read, no client writes)');
  {
    const r = await rest('cafes?select=id&limit=1', {});
    check(r.status === 200, 'cafés readable signed-out', `got ${r.status}`);
    const w = await rest('cafes', { token: a.token, method: 'POST', body: { id: `x_${Date.now()}`, name: 'Fake Café' } });
    check(w.status >= 400, 'a signed-in user CANNOT insert a café', `got ${w.status}`);
    const u = await rest('cafes?id=eq.suedhang', { token: a.token, method: 'PATCH',
      prefer: 'return=representation', body: { rating: 1.0 } });
    check(u.status >= 400 || u.body?.length === 0, 'a signed-in user CANNOT edit a café',
      `got ${u.status} ${JSON.stringify(u.body)}`);
  }

  /* ---------- cleanup ---------- */
  if (postA) await rest(`posts?id=eq.${postA}`, { token: a.token, method: 'DELETE' });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
};

run().catch(e => { console.error('\n' + e.message + '\n'); process.exit(2); });
