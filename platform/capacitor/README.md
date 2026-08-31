# The Capacitor shell

Step **4.1** of `brain/13-infrastructure-plan.md`. This directory wraps the web app — the
repo root, unchanged — as a native app for iOS and Android.

**The web app is not affected by anything in here.** `crema-app.com` is still a buildless
static PWA served from the repo root, it still deploys on a tag, and every native branch in
`src/` is dead code in a browser. That is the acceptance criterion the step was held to, and
`src/config.test.mjs` plus the checks in CI are what keep it true.

---

## The commands

```bash
cd platform/capacitor
npm install          # once
npm run sync         # stage www/ from the repo root, then `cap sync`
npm run ios          # sync, then open Xcode
npm run android      # sync, then open Android Studio
```

`node sync.mjs --check` answers "is `www/` current?" and is what CI runs.

---

## How the web app gets into the binary

`sync.mjs` stages an **allowlist** into `www/`. It is not a copy of the repo root, and the
header of that file explains at length why it must never become one: Capacitor copies
`webDir` wholesale, an `.ipa` and an `.apk` are both zip files, and the repo root contains
`platform/android-twa/android.keystore`. Publishing the Play signing key to every person who
installs Crema is not a recoverable mistake.

The list is **not maintained here**. `sync.mjs` imports `collect()` from
`platform/gen-sw-assets.mjs` — the same rules that build the service worker's precache list,
which is already "the files the app is made of". Add a module to `src/` and it lands in the
binary for the same reason it lands in the precache. Nobody has to remember this directory
exists.

On top of that list the native bundle adds the **legal pages** (App Review follows the
privacy link, possibly offline) and `offline.html`, and leaves out **`sw.js`** (a service
worker in front of local assets can only ever be wrong — `src/app.js` skips registering it
when `native()` is true).

---

## What is tracked, and what is not

`ios/` and `android/` are **generated** and git-ignored. `npx cap add ios|android` recreates
both from `capacitor.config.json` and `package.json`.

⚠️ **Three things in them were edited by hand and will not come back on their own.** If
either project is ever recreated, restore these:

| File | What was added |
|---|---|
| `android/app/src/main/AndroidManifest.xml` | App Links intent filter for `crema-app.com` (`autoVerify`), the `crema://` scheme, and the `CAMERA` / `POST_NOTIFICATIONS` permissions |
| `ios/App/App/Info.plist` | `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `CFBundleURLTypes` (`crema://`), `UIBackgroundModes: remote-notification`, portrait-only on iPhone |
| `android/app/build.gradle` | signing config for the existing keystore — **step 4.3, not done yet** |

Each block is marked in the file with a comment saying it is Crema's and not generated. This
table is the checklist.

---

## What is not finished, and what it is waiting on

This step delivered the **shell and every client-side branch**. Three things need a human
with an account, and none of them can be done from code:

1. **`crema://auth` must be added to Supabase → Authentication → URL Configuration →
   Redirect URLs.** Without it, Google sign-in inside the app lands on the project's Site URL
   and cannot hand the session back. Email and password are unaffected.
2. **Native push has storage but no sender.** `native_push_tokens` (migration
   `20260831090000`) holds the device token; sending to it needs an APNs key from an Apple
   Developer account and an FCM service account from a Firebase project. Both are step 4.2.
   Web Push on the web is untouched and still works.
3. **Nothing here has been run on a device or a simulator.** There is no Xcode on this
   machine — only Command Line Tools — so the iOS project has been generated and configured
   but never compiled. The Android project syncs its Gradle files but has not been assembled.

`brain/11-open-questions.md` carries these as open items with the same numbering.

---

## Why the tab bar is not a `UITabBar`

Because it should not be. The plan's phrase "native tab bar" invites the picture of UIKit
chrome hosting a WebView; that design is the one App Review treats with most suspicion, it
puts a bridge round trip in front of every route change, and it would fork
`renderTabbar()` into two implementations to keep in step by hand.

Crema's tab bar is already the right shape — pinned, one screen tall, reading
`env(safe-area-inset-bottom)`, with `ui/viewport.js` keeping `--app-h` honest across
resumes. What it lacked was everything *around* it, and that is what `src/ui/shell.js`
supplies: the status bar, the splash, the hardware back button, haptics, and the keyboard's
resize contract. The honest summary is that the tab bar did not need porting; it needed a
shell around it.
