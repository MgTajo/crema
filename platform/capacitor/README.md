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
npm install                # once
npm run sync               # stage www/, cap sync, re-apply Crema's native config
npm run build:android      # ...and produce a signed .aab
npm run verify:android     # check the .aab before it goes near Play
npm run ios                # sync, then open Xcode
npm run android            # sync, then open Android Studio
npm run check              # is everything current? (what CI runs)
```

⚠️ **Android needs JDK 21.** Capacitor 8's plugins declare a Java 21 toolchain
and Gradle will not fall back:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=$HOME/Library/Android/sdk
```

`android/local.properties` (git-ignored, generated once) holds `sdk.dir`.

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

✅ **They are no longer hand-edited.** After 4.1 this section carried a three-row checklist of
edits that "will not come back" if the projects were regenerated — a landmine with a timer on
it, because nothing fails when it fires. `configure-native.mjs` replaces the checklist: it
re-applies every one of them, is idempotent, and `--check` says whether the working tree's
native projects are what the repo intends. Run `npm run sync` and the projects are correct by
construction.

What it applies:

| | |
|---|---|
| **Android manifest** | App Links for `crema-app.com` (`autoVerify`), the `crema://` scheme, `CAMERA` + `POST_NOTIFICATIONS` |
| **Android strings** | `custom_url_scheme` = `crema`, so the OAuth callback matches what `data/supabase.js` asks for |
| **Android icons** | the TWA's launcher and notification icons, byte-for-byte — this is an in-place update of an app already on home screens, so the icon must not change |
| **Android version** | `versionName` from the git tag, `versionCode` derived arithmetically (`1.8.0` → `10800`) |
| **Android signing** | reads `keystore.properties`, git-ignored; absent, release signing is skipped and debug builds still work |
| **iOS Info.plist** | camera and photo-library usage strings, `crema://`, `remote-notification`, portrait-only on iPhone |

Edits live between `@crema:begin`/`@crema:end` markers, so the script owns exactly its own
lines and never the generator's.

---

## Signing

`keystore.properties` is git-ignored; `keystore.properties.example` is the template.

⚠️ **There are three plausible-looking keys in this repo and two of them are wrong.**

| | SHA-256 | |
|---|---|---|
| `android-twa/pwab/signing.keystore`, alias `my-key-alias` | `01:1A:73:…` | ✅ **the registered upload key** |
| `android-twa/android.keystore` | `E6:38:C8:…` | superseded |
| `android-twa/upload-certificate.pem` | `E6:38:C8:…` | ❌ **not the upload certificate**, despite the name — it is `android.keystore`'s |

Play rejects a bundle signed with anything but the first, after the upload, with a thin error.
`npm run verify:android` checks the fingerprint against the constant before you upload, and
also audits the bundle's contents the way `sync.mjs` audits the staged assets.

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
