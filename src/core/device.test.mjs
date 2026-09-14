/* ============================================================
   device — who is offered the Play Store, and how often.

     node src/core/device.test.mjs

   The offer is only worth making to somebody who can take it. An iPhone
   shown "Crema is on Google Play" has been told about an app it cannot
   install, and a desktop shown it has been interrupted for nothing — so
   the part of this that matters is the classification, and the user
   agents below are real ones, not invented shapes.

   The second half is the rest period, and the third is a cross-check
   that the listing URL still names the package the Android build is
   actually published under.
   ============================================================ */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mobileOS, playOfferDue, PLAY_REST, PLAY_URL } from './device.js';

let n = 0;
const check = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

const UA = {
  pixel:   'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  firefox: 'Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0',
  tablet:  'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  iphone:  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  crios:   'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/139.0.0.0 Mobile/15E148 Safari/604.1',
  macOS:   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  linux:   'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
};
const nav = (userAgent, platform = '', maxTouchPoints = 0, userAgentData) =>
  ({ userAgent, platform, maxTouchPoints, userAgentData });

console.log('\nwhich phone');
check('Chrome on a Pixel is Android', () => assert.equal(mobileOS(nav(UA.pixel, 'Linux armv81', 5)), 'android'));
check('Samsung Internet is Android', () => assert.equal(mobileOS(nav(UA.samsung, 'Linux armv8l', 5)), 'android'));
check('Firefox on Android is Android', () => assert.equal(mobileOS(nav(UA.firefox, 'Linux aarch64', 5)), 'android'));
check('an Android tablet is Android', () => assert.equal(mobileOS(nav(UA.tablet, 'Linux armv8l', 10)), 'android'));
check('Chrome "desktop site" on Android is still Android through client hints', () =>
  assert.equal(mobileOS(nav(UA.linux, 'Linux x86_64', 5, { platform: 'Android', mobile: false })), 'android'));
check('Safari on an iPhone is iOS', () => assert.equal(mobileOS(nav(UA.iphone, 'iPhone', 5)), 'ios'));
check('Chrome on an iPhone is iOS, not Android', () => assert.equal(mobileOS(nav(UA.crios, 'iPhone', 5)), 'ios'));
check('an iPad in desktop mode is iOS', () => assert.equal(mobileOS(nav(UA.macOS, 'MacIntel', 5)), 'ios'));
check('a real Mac is not iOS', () => assert.equal(mobileOS(nav(UA.macOS, 'MacIntel', 0)), 'other'));
check('Windows is neither', () => assert.equal(mobileOS(nav(UA.windows, 'Win32', 0)), 'other'));
check('desktop Linux is not Android', () => assert.equal(mobileOS(nav(UA.linux, 'Linux x86_64', 0)), 'other'));
check('no navigator at all is neither, and does not throw', () => assert.equal(mobileOS(undefined), 'other'));

console.log('\nhow often');
const now = Date.UTC(2026, 8, 14, 9, 0);
const DAY = 864e5;
check('never offered: due', () => assert.equal(playOfferDue(null, now), true));
check('a garbled record: due', () => assert.equal(playOfferDue({ what: 'shown', at: 'yesterday' }, now), true));
check('shown three days ago: resting', () => assert.equal(playOfferDue({ what: 'shown', at: now - 3 * DAY }, now), false));
check('shown a week ago: due again', () => assert.equal(playOfferDue({ what: 'shown', at: now - PLAY_REST.shown }, now), true));
check('tapped through ten days ago: resting', () => assert.equal(playOfferDue({ what: 'opened', at: now - 10 * DAY }, now), false));
check('tapped through a month ago: due again', () => assert.equal(playOfferDue({ what: 'opened', at: now - 30 * DAY }, now), true));
check('an unknown outcome rests like a plain showing', () => assert.equal(playOfferDue({ what: 'maybe', at: now - 3 * DAY }, now), false));
check('a clock set back past the last offer: due', () => assert.equal(playOfferDue({ what: 'opened', at: now + 5 * DAY }, now), true));

console.log('\nthe listing');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const cap = JSON.parse(fs.readFileSync(path.join(HERE, '../../platform/capacitor/capacitor.config.json'), 'utf8'));
check(`PLAY_URL names ${cap.appId}, the package the Android build ships as`, () =>
  assert.equal(new URL(PLAY_URL).searchParams.get('id'), cap.appId));

console.log(`\n${n} assertions passed\n`);
