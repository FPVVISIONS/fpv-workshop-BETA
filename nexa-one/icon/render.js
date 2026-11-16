/* Render every icon / splash asset from icon.js with headless Chromium.
   Usage: node icon/render.js [outDir]   (default: icon/out)
   Output paths mirror the APK, e.g. out/res/mipmap-xxxhdpi-v4/ic_launcher.png */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { iconSVG, C } = require('./icon');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'out'));
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

function splashSVG(w, h) {
  const s = Math.min(w, h) * 0.46; // icon size
  const icon = iconSVG({ bg: 'none' }).replace('<svg ', `<svg x="${(w - s) / 2}" y="${(h - s) / 2 - s * 0.08}" width="${s}" height="${s}" `);
  const word = Math.max(12, Math.round(Math.min(w, h) * 0.034));
  // Flat ink = the app's own background (seamless hand-off) and ~10× smaller
  // PNGs than a full-frame gradient. The icon carries its own glow.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="${C.ink}"/>
    ${icon}
    <text x="${w / 2}" y="${(h + s) / 2 + word * 1.2}" text-anchor="middle" fill="${C.paper}"
      font-family="Heebo, 'Segoe UI', Roboto, Arial, sans-serif" font-size="${word}" letter-spacing="${word * 0.42}">NEXA ONE</text>
  </svg>`;
}

const jobs = [];
for (const [d, k] of Object.entries(DENS)) {
  jobs.push({ file: `res/mipmap-${d}-v4/ic_launcher.png`, size: 48 * k, svg: iconSVG({ bg: 'square' }) });
  jobs.push({ file: `res/mipmap-${d}-v4/ic_launcher_round.png`, size: 48 * k, svg: iconSVG({ bg: 'circle' }) });
  jobs.push({ file: `res/mipmap-${d}-v4/ic_launcher_foreground.png`, size: 108 * k, svg: iconSVG({ bg: 'none' }) });
}
const SPLASH = {
  'res/drawable/splash.png': [480, 320],
  ...Object.fromEntries(Object.entries({ mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] })
    .flatMap(([d, [w, h]]) => [[`res/drawable-port-${d}-v4/splash.png`, [w, h]], [`res/drawable-land-${d}-v4/splash.png`, [d === 'xxxhdpi' ? 1920 : h, d === 'xxxhdpi' ? 1280 : w]]])),
};
for (const [file, [w, h]] of Object.entries(SPLASH)) jobs.push({ file, w, h, svg: splashSVG(w, h), opaque: true });
jobs.push({ file: 'assets/public/icon-512.png', size: 512, svg: iconSVG({ bg: 'square' }) });
jobs.push({ file: 'assets/public/apple-touch-icon.png', size: 180, svg: iconSVG({ bg: 'full' }), opaque: true });
jobs.push({ file: 'preview/icon-store-512.png', size: 512, svg: iconSVG({ bg: 'full' }), opaque: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const j of jobs) {
    const w = j.w || j.size, h = j.h || j.size;
    await page.setViewportSize({ width: w, height: h });
    const svg = j.svg.replace(/width="\d+(\.\d+)?" height="\d+(\.\d+)?"/, `width="${w}" height="${h}"`);
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    const dest = path.join(OUT, j.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await page.screenshot({ path: dest, omitBackground: !j.opaque, clip: { x: 0, y: 0, width: w, height: h } });
  }
  // Web favicon/brand mark used by the app's boot screen and splash.
  fs.mkdirSync(path.join(OUT, 'assets/public'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'assets/public/nexa-icon.svg'), iconSVG({ bg: 'square' }));
  await browser.close();
  console.log(`rendered ${jobs.length + 1} assets → ${OUT}`);
})();
