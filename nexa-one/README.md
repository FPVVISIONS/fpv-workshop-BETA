# NEXA ONE — FX upgrade

A motion and polish layer for the **NEXA ONE** companion app (Capacitor + React,
`com.nexa.one`). It ships as two drop-in files and leaves the app's own code alone.
The only change to the compiled bundle is a single transition tweak.

## What's new

| Area | Before | After |
|---|---|---|
| **Launch** | Static logo and "loading…" text that vanish abruptly | Animated splash: logo springs in, spinning frost ring, letter-spaced wordmark, shimmer bar, smooth fade into the app |
| **Tab switching** | ~370 ms exit wait before the next screen; tab bar jumped ~27 px on every switch | Exit is now 160 ms (**~40% faster**). The tab-bar jump is fixed. Screen content rises in with a staggered cascade |
| **Bottom tab bar** | Static 2 px line under the active tab | Glowing indicator that glides between tabs with a spring, plus a "pop" on the newly active icon |
| **Taps** | No touch feedback on cards and buttons | Size-aware press-scale and a frost-tinted ripple from the touch point. Touches that start a scroll don't trigger it |
| **Cooling ON** | Small arc on the power button | Shock-wave when you toggle the power button, a spinning comet ring, a breathing glow, a frost-particle field across the app, an aurora backdrop, and a frosty halo behind the hero bottle |
| **Home bottle** | Static render | Gentle 6.5 s float |
| **Lists** (history, settings, data) | Appear all at once | Items reveal as you scroll |
| **Controls** | — | Slider thumb swells while dragging; switches and the slider fill glow when on; segmented pill lifts; primary CTA has a sheen sweep |
| **Header** | Flat | Lifts with a shadow once you scroll; "connected" dot pulses |
| **Convenience** | — | Tapping the active tab scrolls back to the top |

**Accessibility:** all motion turns off when the OS "reduce motion" setting is on,
**or** when the app's own *Settings → הפחתת תנועה* switch is on. The layer reads
that switch directly from `localStorage["nexa-one:prefs:v1"]`.

**Safety:** `nexa-fx.js` never edits React-owned `className`, `style` or text. It
animates with the Web Animations API, `data-*` attributes and its own overlay
elements. Each feature is wrapped so an error disables only that feature. If
the two files are removed, the app works exactly as before.

## New app icon & launch splash

The old launcher icon was a plain outline capsule. The native launch splash was
Capacitor's **default white screen with the blue ✕ logo**, so the app flashed
white on every launch.

- **Icon:** the brand capsule becomes a bottle with a spout cap, glowing
  ice-blue liquid with a wave, a snowflake and a frost halo. Rendered as an
  adaptive icon (foreground layer on the app's `#101114` background, inside the
  66 dp safe zone), legacy square and round icons for every density, the web
  icons (`icon-512.png`, `apple-touch-icon.png`, `nexa-icon.svg`) and a 512 px
  store icon (`icon/out/preview/`).
- **Splash:** every `splash.png` (portrait and landscape, all densities) is now
  the new icon and wordmark on the app's own ink background, so the native
  splash hands off seamlessly to the in-app splash.

The source is a single SVG generator, `icon/icon.js`. Run `node icon/render.js`
to re-render everything into `icon/out/` (it needs Playwright). `build_apk.py`
swaps the files in automatically.

> Android 12+ draws its own splash from the launcher icon, so it gets the new
> icon automatically. Its background colour comes from the app theme, which
> isn't changed here. For a dark Android 12+ splash, set
> `windowSplashScreenBackground` to `#101114` in the source project's
> `styles.xml`.

## Accounts: sign up, sign in and more

`nexa-auth.js` / `nexa-auth.css` add a complete account flow, in Hebrew and RTL like the app:

| Screen | What's in it |
|---|---|
| **Welcome** (first launch) | Animated hero, three feature highlights, *Create account*, *I have an account*, *Continue as guest* |
| **Sign up** | Name, email, password with a live strength meter, terms consent, inline validation, duplicate-email detection with a jump to sign-in |
| **Sign in** | Email and password, show/hide password, Caps Lock warning, *Remember me*, 30 s lockout after 5 failed attempts |
| **Forgot password** | Email → 6-digit code → new password → signed in. Codes expire after 10 min or 5 wrong tries; 30 s resend cooldown |
| **Account sheet** (header person icon) | Initials avatar, email, member-since date, edit name, change password, **App preferences** (opens the app's original sheet), sign out, delete account (password-confirmed) |
| **Guest mode** | Never asked again on launch; the account sheet offers sign-up / sign-in any time |

UX details: the signed-in user's initials replace the header person icon. Android's
back button steps back through every screen and closes sheets. You can swipe the
sheet down to dismiss it. Errors shake the form, and success turns the button into a
green check. Toasts confirm actions. Fields use proper `autocomplete` values, so
password managers and Android autofill work. The app behind a sheet is made
`inert` for screen readers. Esc and a focus trap are handled on desktop. All motion
honours reduce-motion.

### Where accounts live and how to connect a real backend

By default accounts are stored **on the device** (`localStorage`). Passwords are
never stored: only a PBKDF2-SHA256 hash (150,000 iterations, per-user salt) is
kept. No mail server exists on the device, so the reset code is shown on screen
in a clearly marked **demo** banner. The UI also says "demo mode · accounts are
saved on this device only".

To make accounts real (sync across devices, e-mailed codes), plug in a backend.
The UI stays the same:

```js
// e.g. in a small script loaded after nexa-auth.js
NexaAuth.useProvider({
  name: 'supabase',
  async signUp({ name, email, password }) { /* → { id, name, email, createdAt } */ },
  async signIn({ email, password })       { /* → user, or throw new NexaAuth.AuthError('invalid') */ },
  async requestReset({ email })           { /* send the e-mail; return {} (no demoCode) */ },
  async confirmReset({ email, code, password }) { /* → user */ },
  async updateProfile(id, { name })       { /* → user */ },
  async changePassword(id, { current, next }) {},
  async deleteAccount(id, { password })   {},
  async exists(id)                        { return true; },
});
```

Error codes the UI understands: `exists`, `invalid`, `locked` (with `wait`),
`nouser`, `code-invalid`, `code-expired`, `wrong-current`, `same-password`.
Other code can use `NexaAuth.user`, `NexaAuth.onChange(fn)`,
`NexaAuth.open('signin' | 'signup' | 'account')` and `NexaAuth.signOut()`.

> Before a public release, link the "תנאי השימוש ומדיניות הפרטיות" consent line to
> your real Terms and Privacy pages.

## First-time connection guide

`nexa-guide.js` / `nexa-guide.css` / `nexa-guide-bottle.svg`: a 3-step
walkthrough that opens automatically the first time the user reaches the
disconnected home screen (after the welcome / sign-in screen).

It's built on the app's **own product render** (extracted into
`nexa-guide-bottle.svg`), not on illustrations. A camera moves over that one
image, and the bottle's real display shows what the user should look for:

1. **Charge:** close-up of the base; the display's battery gauge fills and the % counts up.
2. **Hold the button 3 s:** close-up of the display and button; a hold ring fills around
   the button, then the Bluetooth symbol blinks on the display.
3. **Connect:** the whole bottle. A short note explains the "Nearby devices" permission,
   plus a plain "לא מתחבר?" list and a demo-mode note. The button presses the app's own
   connect button.

The copy is short and specific, and the chrome reuses the app's own type and
primary button.

Swipe, arrow keys, Back/Next, *Skip* and Android back all work. It never opens
automatically again once finished, skipped, or once a bottle has connected.
Re-open it from the account sheet ("מדריך חיבור הבקבוק") or with
`NexaGuide.open()`. The button gestures and timings it teaches match the
firmware in `hardware/`.

## Build the real bottle

See **[hardware/BUILD-GUIDE.md](hardware/BUILD-GUIDE.md)**: parts list, wiring,
assembly, honest Peltier/battery numbers, safety, the ESP32-C3 firmware, the
Bluetooth protocol, and how to connect the app's source project to the real
bottle (`hardware/app-integration/ble-transport.js`).

## Make the bottle look like the app

See **[hardware/APPEARANCE-GUIDE.md](hardware/APPEARANCE-GUIDE.md)**: the app's
bottle render turned into real dimensions (`hardware/design/bottle-dimensions.png`),
a fit check (`fit_check.py`), a printable base (`base_shell.py` → `stl/`), and a
build order. The firmware draws the app's "bottle display" layout on a 1.3″ OLED.
It also records two findings: the render's base is too short to hold the battery,
and the vessel should be aluminium.

## Files

```
web/
  nexa-fx.css     motion styles, keyframes, reduced-motion rules
  nexa-fx.js      motion behaviour (no dependencies, ~20 KB unminified)
  nexa-auth.css   account screens
  nexa-auth.js    sign up / sign in / reset / account sheet (no dependencies)
  nexa-guide.css  connection guide styles + illustration animations
  nexa-guide.js   first-time "connect your bottle" walkthrough
  index.html      original index.html + splash markup + the six tags
hardware/
  BUILD-GUIDE.md  how to build the Peltier bottle and connect it
  firmware/       ESP32-C3 firmware (nexa_core.h is unit-tested: firmware/test)
  APPEARANCE-GUIDE.md  how to make it look like the app (dimensions, sleeve, base, order)
  design/         fit_check.py, base_shell.py (→ stl/), drawing.py, bottle-dimensions.png
  app-integration/ Bluetooth protocol + BleBottle transport for the app source
icon/
  icon.js         the app icon as a single SVG generator
  render.js       renders all launcher, splash and web icons → icon/out/
  out/            rendered assets (paths mirror the APK)
build/
  build_apk.py    rebuilds and signs the APK from the original
  apkzip.py       exact ZIP rewriter + 4-byte zipalign
  apksign_v2.py   APK Signature Scheme v2 signer
```

## Option A: put it into the app's source project (recommended)

1. Copy the six `web/nexa-*` files into the Vite `public/` folder.
2. In the source `index.html` `<head>`, after the app's own stylesheet:
   ```html
   <link rel="stylesheet" href="./nexa-fx.css">
   <script defer src="./nexa-fx.js"></script>
   <link rel="stylesheet" href="./nexa-auth.css">
   <script defer src="./nexa-auth.js"></script>
   <link rel="stylesheet" href="./nexa-guide.css">
   <script defer src="./nexa-guide.js"></script>
   ```
   Also copy the `<div id="fx-splash">…</div>` block from `web/index.html` into
   `<body>`, right after `<div id="root">…</div>`.
3. Faster screen exits: in the route-transition variants (`enter` / `center` / `exit`,
   used with `<AnimatePresence mode="wait">`), give `exit` its own transition:
   ```js
   exit: (d) => ({ opacity: 0, x: d === 0 ? 0 : d > 0 ? 18 : -18,
                   transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } }),
   ```
4. In the preferences sheet, change the copy "פרופיל מקומי" / "…אין צורך בחשבון."
   (see `BUNDLE_PATCHES` in `build/build_apk.py` for the replacement text).
5. Icons: copy `icon/out/res/*` into `android/app/src/main/res/`, dropping the
   `-v4` suffix from the folder names (the APK's compiled names, e.g.
   `mipmap-xxxhdpi-v4` → `mipmap-xxxhdpi`). Copy `icon/out/assets/public/*`
   into `public/`.
6. Run `npm run build && npx cap sync android` and build in Android Studio as usual,
   signed with **your** release key.

## Option B: rebuild the APK directly

```bash
python3 -m venv .venv && .venv/bin/pip install cryptography
keytool -genkeypair -keystore keys/release.p12 -storetype PKCS12 -alias nexa \
        -keyalg RSA -keysize 2048 -validity 10950 -dname "CN=NEXA ONE" \
        -storepass:file keys/release.pass
.venv/bin/python build/build_apk.py --apk NEXA-ONE.apk \
        --keystore keys/release.p12 --storepass-file keys/release.pass \
        --out dist/NEXA-ONE-FX.apk
```

The output is zipaligned and signed with v1 (JAR, needed because minSdk is 23) and
v2. Verified with `jarsigner -verify`, `apksigtool verify` and androguard.

> **Note:** a rebuilt APK is signed with a different key from the original,
> so Android won't install it as an update over the original. Uninstall the
> original first. For Play Store releases, use Option A with your own upload key.
