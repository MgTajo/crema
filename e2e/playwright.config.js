/* ============================================================
   Playwright — the four flows that must never break (Phase 2.5).

   Three things about this file are decisions rather than defaults.

   1. **The app is served straight out of the working tree.** No build,
      no bundle, no staging deployment. devserver.py serves the repo
      root, which IS the web root, and src/config.js resolves localhost
      to the staging backend on its own (step 1.2). So what the browser
      runs is exactly the commit, and pointing it at production would
      take an edit to src/config.js rather than a forgotten flag.
      ⚠️ devserver.py serves its WORKING DIRECTORY — `cwd` below is the
      repo root and must stay there. Started from crema/ it would
      publish brain/ and business/ on localhost.

   2. **One worker, no parallelism.** The specs share two accounts and
      one database. Redeeming Premium while another spec is posting is
      not a race worth debugging, and the whole suite is under two
      minutes serially.

   3. **Service workers are blocked.** sw.js is cache-first, and a test
      that has to reason about which of two versions of views.js it is
      driving is a test that fails for reasons that are not the app's.
      The service worker has its own guard now — the generated precache
      list, `node platform/gen-sw-assets.mjs --check` in CI.
   ============================================================ */
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './support/env.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP  = path.resolve(HERE, '..');
const PORT = new URL(BASE_URL).port || '4599';

export default defineConfig({
  testDir: HERE,
  /* Generous, and deliberately so: these are network round trips to a
     free-tier database in another region, not unit tests. */
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },   // the shape Crema is designed in
    locale: 'en-GB',
    timezoneId: 'Europe/Berlin',             // the clock the streak and the podium run on
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /accounts\.setup\.js/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'flows',
      testMatch: /tests\/.*\.spec\.js/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        /* Signed in as A. 01-sign-in.spec.js overrides this back to an
           empty state — it is the one flow that has to start cold. */
        storageState: path.join(HERE, '.auth', 'a.json'),
      },
    },
  ],

  webServer: {
    command: `python3 devserver.py ${PORT}`,
    cwd: APP,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
