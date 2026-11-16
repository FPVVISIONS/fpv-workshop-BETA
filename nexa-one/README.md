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

## Files

```
web/
  nexa-fx.css     styles, keyframes, reduced-motion rules
  nexa-fx.js      behaviour (no dependencies, ~15 KB)
  index.html      original index.html + splash markup + the two tags above
build/
  build_apk.py    rebuilds and signs the APK from the original
  apkzip.py       exact ZIP rewriter + 4-byte zipalign
  apksign_v2.py   APK Signature Scheme v2 signer
```

## Option A: put it into the app's source project (recommended)

1. Copy `web/nexa-fx.css` and `web/nexa-fx.js` into the Vite `public/` folder.
2. In the source `index.html` `<head>`, after the app's own stylesheet:
   ```html
   <link rel="stylesheet" href="./nexa-fx.css">
   <script defer src="./nexa-fx.js"></script>
   ```
   Also copy the `<div id="fx-splash">…</div>` block from `web/index.html` into
   `<body>`, right after `<div id="root">…</div>`.
3. Faster screen exits: in the route-transition variants (`enter` / `center` / `exit`,
   used with `<AnimatePresence mode="wait">`), give `exit` its own transition:
   ```js
   exit: (d) => ({ opacity: 0, x: d === 0 ? 0 : d > 0 ? 18 : -18,
                   transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } }),
   ```
4. Run `npm run build && npx cap sync android` and build in Android Studio as usual,
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
