/* NEXA ONE app icon — single source of truth.
   All artwork is drawn on Android's 108×108 adaptive-icon canvas; the
   important content stays inside the 66-unit safe circle at the centre.

   iconSVG({ bg })
     bg: 'none'   → transparent (adaptive-icon foreground layer)
         'square' → rounded-square legacy / web icon
         'circle' → round legacy icon
         'full'   → full-bleed square (store / PWA maskable)            */

const C = { ink: '#101114', coal: '#1b1e24', paper: '#F5F7FA', ice: '#8BDFFF', volt: '#35AFFF' };

function snowflake(cx, cy, r, sw) {
  let d = '';
  for (let k = 0; k < 3; k++) {
    const a = (Math.PI / 3) * k + Math.PI / 2;
    const dx = Math.cos(a) * r, dy = Math.sin(a) * r;
    d += `M${(cx - dx).toFixed(2)},${(cy - dy).toFixed(2)}L${(cx + dx).toFixed(2)},${(cy + dy).toFixed(2)}`;
    for (const s of [1, -1]) {
      const ex = cx + s * dx * 0.62, ey = cy + s * dy * 0.62; // chevron root
      const b = r * 0.3;
      for (const t of [1, -1]) {
        const aa = a + (s > 0 ? 0 : Math.PI) + t * 0.75;
        d += `M${ex.toFixed(2)},${ey.toFixed(2)}L${(ex + Math.cos(aa) * b).toFixed(2)},${(ey + Math.sin(aa) * b).toFixed(2)}`;
      }
    }
  }
  return `<path d="${d}" fill="none" stroke="#fff" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function iconSVG({ bg = 'square' } = {}) {
  const shape = {
    none: '',
    full: `<rect width="108" height="108" fill="url(#bg)"/>`,
    square: `<rect x="2" y="2" width="104" height="104" rx="24" fill="url(#bg)"/>`,
    circle: `<circle cx="54" cy="54" r="52" fill="url(#bg)"/>`,
  }[bg];
  const clip = { none: '', full: '', square: 'url(#clipSq)', circle: 'url(#clipCi)' }[bg];
  const showBgFx = bg !== 'none';

  // Bottle geometry (capsule body + cap + spout), centred on x = 54.
  const bx = 41, by = 34, bw = 26, bh = 50, br = 13;
  const wave = 'M38,58 C43,55.6 47,55.6 51,57.4 C55,59.2 59,59.4 63,57.4 C66,55.9 68,55.8 70,56.4 L70,90 L38,90 Z';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="108" height="108">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#222a35"/><stop offset=".55" stop-color="${C.ink}"/><stop offset="1" stop-color="#07080a"/>
    </linearGradient>
    <radialGradient id="aur" cx=".5" cy=".78" r=".62">
      <stop offset="0" stop-color="${C.volt}" stop-opacity=".55"/><stop offset=".45" stop-color="${C.volt}" stop-opacity=".14"/><stop offset="1" stop-color="${C.volt}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="halo" cx=".5" cy=".62" r=".5">
      <stop offset="0" stop-color="${C.ice}" stop-opacity=".5"/><stop offset=".55" stop-color="${C.volt}" stop-opacity=".12"/><stop offset="1" stop-color="${C.volt}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="liq" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c9f1ff"/><stop offset=".22" stop-color="${C.ice}"/><stop offset="1" stop-color="#1f8fff"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" x2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".3" stop-color="#fff" stop-opacity=".03"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="cap" x1="0" x2="1">
      <stop offset="0" stop-color="#e9edf3"/><stop offset=".5" stop-color="#ffffff"/><stop offset="1" stop-color="#b9c1cc"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".10"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="inner"><rect x="${bx + 2.4}" y="${by + 2.4}" width="${bw - 4.8}" height="${bh - 4.8}" rx="${br - 2.4}"/></clipPath>
    <clipPath id="clipSq"><rect x="2" y="2" width="104" height="104" rx="24"/></clipPath>
    <clipPath id="clipCi"><circle cx="54" cy="54" r="52"/></clipPath>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2"/></filter>
  </defs>
  ${shape}
  <g clip-path="${clip}">
    ${showBgFx ? `<rect width="108" height="108" fill="url(#aur)"/>
    <rect width="108" height="108" fill="url(#sheen)"/>` : ''}
    <ellipse cx="54" cy="64" rx="${showBgFx ? 30 : 26}" ry="${showBgFx ? 34 : 30}" fill="url(#halo)"/>
  </g>
  <!-- Legacy/web icons have no launcher mask cropping them, so the art can
       be larger than the adaptive safe zone allows. -->
  <g transform="${showBgFx ? 'translate(54 54) scale(1.22) translate(-54 -53)' : ''}">

  <!-- spout + cap -->
  <rect x="50.2" y="20.5" width="7.6" height="6" rx="2.2" fill="url(#cap)"/>
  <rect x="45" y="25.4" width="18" height="7.4" rx="2.6" fill="url(#cap)"/>
  <rect x="45" y="30.2" width="18" height="1.2" fill="#000" opacity=".18"/>

  <!-- liquid -->
  <g clip-path="url(#inner)">
    <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="#0c1016"/>
    <path d="${wave}" fill="url(#liq)"/>
    <path d="${wave}" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.1"/>
    <circle cx="47.5" cy="78" r="1.1" fill="#fff" opacity=".55"/>
    <circle cx="61" cy="65" r=".9" fill="#fff" opacity=".6"/>
    <circle cx="59" cy="79.5" r=".7" fill="#fff" opacity=".5"/>
    <rect x="${bx + 3}" y="${by}" width="7" height="${bh}" fill="url(#glass)"/>
  </g>
  <g opacity=".55" filter="url(#soft)">${snowflake(54, 70.5, 7.4, 2.2)}</g>
  ${snowflake(54, 70.5, 7.4, 1.6)}

  <!-- body outline -->
  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${br}" fill="none" stroke="${C.paper}" stroke-width="3.2"/>
  </g>
</svg>`;
}

module.exports = { iconSVG, C };
