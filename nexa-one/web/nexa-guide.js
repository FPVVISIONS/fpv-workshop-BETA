/* ==========================================================================
   NEXA GUIDE — first-time "connect your bottle" walkthrough
   • Opens automatically the first time the user lands on the disconnected
     home screen (after the sign-in gate, if any). Never again once finished,
     skipped, or once the bottle has connected.
   • Re-open any time: account sheet → "מדריך חיבור הבקבוק", or NexaGuide.open().
   • 5 animated steps, swipe / arrows / buttons, Android back closes it,
     troubleshooting tips on the last step, which ends by pressing the app's
     own "connect" button.
   ========================================================================== */
(() => {
  'use strict';
  const doc = document, html = doc.documentElement;
  const K_DONE = 'nexa-guide:connect:v1';
  const EASE = 'cubic-bezier(.22,1,.36,1)';
  const reduced = () => (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) || html.hasAttribute('data-fx-reduce');
  const anim = (el, kf, o) => (el && el.animate && !reduced() ? el.animate(kf, o) : null);
  const done = () => { try { return localStorage.getItem(K_DONE) === '1'; } catch (_) { return false; } };
  const markDone = () => { try { localStorage.setItem(K_DONE, '1'); } catch (_) {} };

  /* ------------------------------------------------------- illustrations */
  const BOTTLE_BASE = `
    <rect x="70" y="10" width="100" height="120" rx="18" fill="url(#gBody)"/>
    <rect x="66" y="112" width="108" height="64" rx="12" fill="url(#gBase)" stroke="#2c3038"/>
    <rect x="84" y="128" width="46" height="26" rx="6" fill="#06090d" stroke="#1d2a36"/>
    <g fill="#2a2f37">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<circle cx="${80 + i * 10}" cy="168" r="1.4"/>`).join('')}</g>`;
  const DEFS = `<defs>
    <linearGradient id="gBody" x1="0" x2="1"><stop offset="0" stop-color="#30343c"/><stop offset=".3" stop-color="#1c1e23"/><stop offset=".9" stop-color="#121317"/><stop offset="1" stop-color="#3e5563"/></linearGradient>
    <linearGradient id="gBase" x1="0" x2="1"><stop offset="0" stop-color="#2a2e35"/><stop offset=".5" stop-color="#17191d"/><stop offset="1" stop-color="#2a3a46"/></linearGradient>
    <linearGradient id="gCold" x1="0" x2="1"><stop offset="0" stop-color="#8BDFFF"/><stop offset="1" stop-color="#35AFFF"/></linearGradient>
    <radialGradient id="gGlow"><stop offset="0" stop-color="#35AFFF" stop-opacity=".55"/><stop offset="1" stop-color="#35AFFF" stop-opacity="0"/></radialGradient>
  </defs>`;
  const BT = (x, y, s = 1, cls = '') => `<path class="${cls}" transform="translate(${x} ${y}) scale(${s})" d="M-4 -5 L4 3 L0 7 L0 -7 L4 -3 L-4 5" fill="none" stroke="#8BDFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
  const PHONE = (x, y, inner) => `<g transform="translate(${x} ${y})">
    <rect width="74" height="140" rx="14" fill="#0c0e12" stroke="#3a3f48" stroke-width="2"/>
    <rect x="6" y="8" width="62" height="124" rx="9" fill="#121519"/>
    <rect x="29" y="12" width="16" height="3" rx="1.5" fill="#2a2f37"/>${inner}</g>`;

  const ART = {
    charge: `<svg viewBox="0 0 240 190">${DEFS}
      <ellipse cx="120" cy="150" rx="90" ry="40" fill="url(#gGlow)" opacity=".5"/>
      ${BOTTLE_BASE}
      <g class="gd-cable"><path d="M236 150 H196" stroke="#4a515c" stroke-width="5" stroke-linecap="round"/><rect x="176" y="144" width="22" height="12" rx="4" fill="#c9d0da"/><rect x="172" y="147" width="6" height="6" rx="1.5" fill="#8a929e"/></g>
      <rect x="90" y="133" width="30" height="12" rx="2.5" fill="none" stroke="#35AFFF" stroke-width="1.4"/>
      <rect x="121" y="136.5" width="2.4" height="5" rx="1" fill="#35AFFF"/>
      <rect class="gd-fill" x="92" y="135" width="26" height="8" rx="1.5" fill="url(#gCold)"/>
      <path class="gd-bolt" d="M106 133.5 l-4 6 h4 l-2 5.5 l6-7.5 h-4 l2-4z" fill="#fff"/>
    </svg>`,
    power: `<svg viewBox="0 0 240 190">${DEFS}
      ${BOTTLE_BASE}
      <circle class="gd-ring r1" cx="150" cy="141" r="9" fill="none" stroke="#35AFFF" stroke-width="2"/>
      <circle class="gd-ring r2" cx="150" cy="141" r="9" fill="none" stroke="#35AFFF" stroke-width="2"/>
      <circle cx="150" cy="141" r="8" fill="#0d1116" stroke="#35AFFF" stroke-width="1.6"/>
      <path d="M150 136.5 v4.5 M146.6 138.6 a5 5 0 1 0 6.8 0" fill="none" stroke="#8BDFFF" stroke-width="1.5" stroke-linecap="round"/>
      <g class="gd-blink">${BT(107, 141, 1)}</g>
      <g class="gd-finger"><path d="M168 190 C166 172 158 162 156 152 c-1-4 4-6 6-2 l4 9 l1-12 c0-4 6-4 6 0 l0 4 c0-4 6-4 6 0 l0 3 c0-3 6-3 6 1 l-1 20 c0 8-3 12-4 18" fill="#e9c9a9" stroke="#b58e6c" stroke-width="1.2"/></g>
      <text x="120" y="24" text-anchor="middle" fill="#9299a5" font-size="11" font-family="Heebo, sans-serif">3 שניות</text>
      <rect x="90" y="30" width="60" height="3" rx="1.5" fill="#262a32"/><rect class="gd-hold" x="90" y="30" width="60" height="3" rx="1.5" fill="url(#gCold)"/>
    </svg>`,
    bluetooth: `<svg viewBox="0 0 240 190">${DEFS}
      ${PHONE(83, 24, `
        <rect x="12" y="30" width="50" height="22" rx="8" fill="#1b1e24"/>
        ${BT(22, 41, .9)}
        <rect x="34" y="35" width="22" height="12" rx="6" class="gd-toggle-track" fill="#2c3038"/>
        <circle class="gd-toggle" cx="40" cy="41" r="4.5" fill="#f5f7fa"/>
        <g class="gd-perm"><rect x="8" y="64" width="58" height="52" rx="8" fill="#20242b" stroke="#343943"/>
          <rect x="14" y="72" width="40" height="4" rx="2" fill="#9299a5"/><rect x="14" y="80" width="30" height="3" rx="1.5" fill="#4a515c"/>
          <rect x="14" y="96" width="46" height="13" rx="6.5" fill="#35AFFF"/><text x="37" y="105.5" text-anchor="middle" font-size="7" fill="#06121c" font-family="Heebo, sans-serif">אישור</text></g>`)}
    </svg>`,
    nearby: `<svg viewBox="0 0 240 190">${DEFS}
      <ellipse cx="160" cy="120" rx="70" ry="60" fill="url(#gGlow)" opacity=".35"/>
      ${PHONE(14, 30, `${BT(37, 70, 1.6)}`)}
      <g transform="translate(118 2) scale(.82)">${BOTTLE_BASE}</g>
      <g fill="none" stroke="#35AFFF" stroke-width="2" stroke-linecap="round">
        <path class="gd-wave w1" d="M100 86 q8 14 0 28"/><path class="gd-wave w2" d="M110 78 q13 22 0 44"/><path class="gd-wave w3" d="M120 70 q18 30 0 60"/></g>
      <path d="M50 182 H188" stroke="#4a515c" stroke-dasharray="4 4"/><path d="M50 177 v10 M188 177 v10" stroke="#4a515c"/>
      <text x="119" y="176" text-anchor="middle" fill="#9299a5" font-size="11" font-family="Heebo, sans-serif">עד מטר</text>
    </svg>`,
    connect: `<svg viewBox="0 0 240 190">${DEFS}
      <circle cx="120" cy="94" r="80" fill="url(#gGlow)" opacity=".4"/>
      ${PHONE(83, 24, `
        <circle cx="37" cy="54" r="20" fill="#0f1b26" stroke="#35AFFF" stroke-width="1.5"/>
        <path class="gd-check" d="M28 54 l6 6 l12 -13" fill="none" stroke="#8BDFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="14" y="86" width="46" height="5" rx="2.5" fill="#f5f7fa"/><rect x="20" y="96" width="34" height="4" rx="2" fill="#4a515c"/>
        <rect x="12" y="110" width="50" height="14" rx="7" fill="#f5f7fa"/>`)}
      <g class="gd-spark"><path d="M58 40 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3z" fill="#8BDFFF"/><path d="M186 120 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2z" fill="#35AFFF"/></g>
    </svg>`,
  };

  const STEPS = [
    { art: 'charge', title: 'טעינה ראשונה', body: 'חברו כבל USB-C לבסיס הבקבוק. הצג יראה ברק ואת מצב הסוללה. מומלץ להתחיל עם סוללה מלאה.', tips: ['טעינה מלאה לוקחת כ-3 שעות', 'אפשר להשתמש בבקבוק גם בזמן הטעינה'] },
    { art: 'power', title: 'הפעלת הבקבוק', body: 'לחצו לחיצה ארוכה של 3 שניות על המתג שבבסיס, עד שסמל ה-Bluetooth בצג מתחיל להבהב. זה אומר שהבקבוק מחכה לחיבור.', tips: ['לחיצה קצרה מפעילה ומכבה את הקירור', 'מצב החיבור נשאר פעיל 2 דקות'] },
    { art: 'bluetooth', title: 'Bluetooth והרשאה', body: 'ודאו ש-Bluetooth פועל בטלפון. בחיבור הראשון נבקש הרשאת "מכשירים בקרבת מקום". אשרו אותה כדי שנוכל למצוא את הבקבוק.', tips: ['ההרשאה משמשת רק לחיבור לבקבוק', 'אפשר לבטל אותה בכל רגע בהגדרות הטלפון'] },
    { art: 'nearby', title: 'קרבו את הטלפון', body: 'בחיבור הראשון, החזיקו את הטלפון במרחק של עד מטר מהבקבוק. אחר כך החיבור יעבוד גם מרחוק יותר.', tips: ['מכשירים רבים בסביבה יכולים להאט את החיפוש'] },
    { art: 'connect', title: 'מתחברים!', body: 'לחצו "התחברות" והבקבוק יתחבר תוך כמה שניות. מהפעם הבאה האפליקציה תתחבר אליו לבד.', tips: [], last: true },
  ];

  const TROUBLE = [
    'ודאו שסמל ה-Bluetooth בצג מהבהב. אם לא, לחצו שוב 3 שניות על המתג.',
    'כבו והדליקו את ה-Bluetooth בטלפון.',
    'בדקו שהסוללה לא ריקה וחברו למטען.',
    'איפוס הבקבוק: לחיצה ארוכה של 10 שניות על המתג.',
  ];

  /* ------------------------------------------------------------------ ui */
  function h(tag, attrs, ...kids) {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : doc.createTextNode(c));
    return el;
  }

  let ui = null;

  function demoMode() { return !!findConnectBtn() && /הדגמה/.test(findConnectBtn().textContent); }
  function findConnectBtn() {
    return Array.from(doc.querySelectorAll('main button')).find((b) => /^\s*התחברות/.test(b.textContent) && b.getClientRects().length) || null;
  }
  function isConnected() {
    const dot = doc.querySelector('header button span.rounded-full');
    return !!(dot && dot.classList.contains('bg-volt'));
  }

  function render(i, dir) {
    const s = STEPS[i];
    const body = h('div', { class: 'gd-step', role: 'group', 'aria-roledescription': 'שלב', 'aria-label': `שלב ${i + 1} מתוך ${STEPS.length}` },
      h('div', { class: `gd-art gd-art-${s.art}`, 'aria-hidden': 'true', html: ART[s.art] }),
      h('p', { class: 'gd-count gd-in' }, `שלב ${i + 1} מתוך ${STEPS.length}`),
      h('h2', { class: 'gd-title gd-in', id: 'gd-title' }, s.title),
      h('p', { class: 'gd-body gd-in' }, s.body),
      s.tips.length ? h('ul', { class: 'gd-tips gd-in' }, s.tips.map((t) => h('li', null, t))) : null,
      s.last && demoMode() ? h('p', { class: 'gd-demo gd-in' }, 'בגרסת ההדגמה מתחברים לבקבוק מדומה. לא צריך בקבוק אמיתי.') : null,
      s.last ? h('details', { class: 'gd-trouble gd-in' }, h('summary', null, 'לא מצליחים להתחבר?'), h('ol', null, TROUBLE.map((t) => h('li', null, t)))) : null);

    const prev = ui.stepEl;
    ui.stage.append(body);
    ui.stepEl = body;
    const x = dir * 40; // dir +1 = forward; RTL: next content comes from the left
    if (prev) {
      const a = anim(prev, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${x}px)` }], { duration: 220, easing: 'ease-in', fill: 'forwards' });
      if (a) a.onfinish = () => prev.remove(); else prev.remove();
    }
    anim(body.querySelector('.gd-art'), [{ opacity: 0, transform: `translateX(${-x}px) scale(.94)` }, { opacity: 1, transform: 'none' }], { duration: 520, delay: prev ? 120 : 200, easing: EASE, fill: 'backwards' });
    body.querySelectorAll('.gd-in').forEach((n, k) =>
      anim(n, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: (prev ? 180 : 280) + k * 50, easing: EASE, fill: 'backwards' }));

    ui.bars.forEach((b, k) => { b.classList.toggle('on', k <= i); b.classList.toggle('cur', k === i); });
    ui.back.hidden = i === 0;
    ui.next.querySelector('span').textContent = s.last ? 'התחברות לבקבוק' : 'הבא';
    ui.next.classList.toggle('gd-cta', !!s.last);
    ui.skip.hidden = !!s.last;
    ui.live.textContent = `שלב ${i + 1} מתוך ${STEPS.length}: ${s.title}`;
  }

  function goTo(i) {
    if (!ui || i < 0 || i >= STEPS.length || i === ui.i) return;
    const dir = i > ui.i ? 1 : -1;
    ui.i = i;
    render(i, dir);
  }

  function open(auto) {
    if (ui) return;
    const stage = h('div', { class: 'gd-stage' });
    const bars = STEPS.map(() => h('span', { class: 'gd-bar' }));
    const skip = h('button', { type: 'button', class: 'gd-skip', onclick: () => close(true) }, 'דילוג');
    const back = h('button', { type: 'button', class: 'gd-btn gd-btn-ghost', onclick: () => goTo(ui.i - 1) }, 'חזרה');
    const next = h('button', { type: 'button', class: 'gd-btn gd-btn-primary', onclick: onNext }, h('span', null, 'הבא'));
    const live = h('p', { class: 'gd-sr', 'aria-live': 'polite' });
    const root = h('div', { id: 'fx-guide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gd-title' },
      h('div', { class: 'gd-aurora', 'aria-hidden': 'true' }),
      h('div', { class: 'gd-shell' },
        h('div', { class: 'gd-top' }, h('span', { class: 'gd-kicker' }, 'מדריך חיבור'), skip),
        stage,
        h('div', { class: 'gd-bottom' }, h('div', { class: 'gd-bars', 'aria-hidden': 'true' }, bars), h('div', { class: 'gd-nav' }, back, next))),
      live);
    ui = { root, stage, bars, skip, back, next, live, i: 0, stepEl: null, auto };
    doc.body.append(root);
    html.classList.add('gd-locked');
    const appRoot = doc.getElementById('root');
    if (appRoot) { appRoot.setAttribute('inert', ''); appRoot.setAttribute('aria-hidden', 'true'); }
    history.pushState({ nexaGuide: 1 }, '');
    anim(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
    render(0, 0);
    swipe(stage);
    setTimeout(() => next.focus({ preventScroll: true }), 400);
  }

  function onNext() {
    if (!ui) return;
    if (!STEPS[ui.i].last) { goTo(ui.i + 1); return; }
    close(true, () => {
      const btn = findConnectBtn();
      if (btn) btn.click();
    });
  }

  function close(finished, after, fromPop) {
    if (!ui) return;
    const g = ui;
    ui = null;
    if (finished) markDone();
    html.classList.remove('gd-locked');
    const appRoot = doc.getElementById('root');
    if (appRoot && !doc.getElementById('fx-auth') && !doc.getElementById('fx-account')) { appRoot.removeAttribute('inert'); appRoot.removeAttribute('aria-hidden'); }
    if (!fromPop) { ignorePop = true; history.back(); }
    const a = anim(g.root, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(1.03)' }], { duration: 300, easing: EASE, fill: 'forwards' });
    const fin = () => { g.root.remove(); if (after) setTimeout(after, 60); };
    if (a) a.onfinish = fin; else fin();
  }

  let ignorePop = false;
  addEventListener('popstate', () => {
    if (ignorePop) { ignorePop = false; return; }
    if (ui) close(false, null, true);
  });
  doc.addEventListener('keydown', (e) => {
    if (!ui) return;
    if (e.key === 'Escape') { e.preventDefault(); close(false); }
    // In RTL the "next" step is to the left.
    else if (e.key === 'ArrowLeft' && !e.target.closest('input')) goTo(ui.i + 1);
    else if (e.key === 'ArrowRight' && !e.target.closest('input')) goTo(ui.i - 1);
  });

  function swipe(el) {
    let x0 = null, y0 = 0;
    el.addEventListener('pointerdown', (e) => { if (e.target.closest('summary, details, button')) return; x0 = e.clientX; y0 = e.clientY; });
    el.addEventListener('pointerup', (e) => {
      if (x0 == null || !ui) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      x0 = null;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      goTo(ui.i + (dx > 0 ? 1 : -1)); // RTL: swipe right reveals the next step
    });
    el.addEventListener('pointercancel', () => { x0 = null; });
  }

  /* ------------------------------------------------- automatic first run */
  let armed = false;
  function check() {
    if (ui || armed || done()) return;
    if (isConnected()) { markDone(); return; }
    if (doc.getElementById('fx-auth') || doc.getElementById('fx-account') || doc.getElementById('fx-splash')) return;
    if (doc.querySelector('[role="dialog"], .fa-toast')) return; // let toasts finish first
    if (!findConnectBtn()) return;
    armed = true;
    setTimeout(() => {
      armed = false;
      if (!ui && !done() && findConnectBtn() && !doc.getElementById('fx-auth')) open(true);
    }, 700);
  }

  window.NexaGuide = { open: () => open(false), get done() { return done(); } };

  const start = () => {
    new MutationObserver(check).observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    check();
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
