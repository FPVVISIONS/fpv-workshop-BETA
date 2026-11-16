/* ==========================================================================
   NEXA GUIDE — first-time "connect your bottle" walkthrough
   Built on the app's own product render (nexa-guide-bottle.svg): one image,
   a camera that moves between the base, the button and the whole bottle,
   and the bottle's real display showing what the user should see.
   • Opens by itself the first time the disconnected home screen appears
     (after the welcome / sign-in screen). Never again once finished,
     skipped, or once a bottle has connected.
   • Re-open: account sheet → "מדריך חיבור הבקבוק", or NexaGuide.open().
   ========================================================================== */
(() => {
  'use strict';
  const doc = document, html = doc.documentElement;
  const K_DONE = 'nexa-guide:connect:v1';
  const SVGNS = 'http://www.w3.org/2000/svg';
  const reduced = () => (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) || html.hasAttribute('data-fx-reduce');
  const anim = (el, kf, o) => (el && el.animate && !reduced() ? el.animate(kf, o) : null);
  const done = () => { try { return localStorage.getItem(K_DONE) === '1'; } catch (_) { return false; } };
  const markDone = () => { try { localStorage.setItem(K_DONE, '1'); } catch (_) {} };

  /* Camera framings in the render's own coordinates (viewBox 0 20 360 850). */
  const SHOTS = {
    base: { x: 84, y: 652, w: 192, h: 170 },
    button: { x: 118, y: 714, w: 116, h: 84 },   // display + power button together
    bottle: { x: 70, y: 36, w: 220, h: 800 },
  };

  const STEPS = [
    {
      shot: 'base', screen: 'charging',
      title: 'טענו את הבקבוק',
      body: 'חברו כבל USB-C לבסיס. טעינה מלאה לוקחת כ-3 שעות, ואפשר להשתמש בבקבוק גם בזמן הטעינה.',
    },
    {
      shot: 'button', screen: 'pairing',
      title: 'החזיקו את המתג 3 שניות',
      body: 'עד שסמל ה-Bluetooth בצג מתחיל להבהב. הבקבוק נשאר זמין לחיבור במשך 2 דקות.',
    },
    {
      shot: 'bottle', screen: 'ready', last: true,
      title: 'התחברו מהטלפון',
      body: 'השאירו את הטלפון ליד הבקבוק ולחצו "התחברות". בפעם הראשונה Android יבקש גישה למכשירים בקרבת מקום. היא משמשת רק כדי למצוא את הבקבוק.',
    },
  ];

  const HELP = [
    'הסמל בצג לא מהבהב? החזיקו שוב את המתג 3 שניות.',
    'כבו והדליקו את ה-Bluetooth בטלפון.',
    'הסוללה ריקה? חברו למטען ונסו אחרי כמה דקות.',
    'עדיין לא? החזיקו את המתג 10 שניות כדי לאפס את הבקבוק.',
  ];

  /* ---------------------------------------------------------- dom helpers */
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
  function s(tag, attrs, ...kids) {
    const el = doc.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    for (const c of kids) el.append(c.nodeType ? c : doc.createTextNode(c));
    return el;
  }

  /* -------------------------------------------- the product render + states */
  let bottleSvgText = null;
  const loadBottle = () => bottleSvgText
    ? Promise.resolve(bottleSvgText)
    : fetch('./nexa-guide-bottle.svg').then((r) => (r.ok ? r.text() : '')).then((t) => (bottleSvgText = t)).catch(() => '');

  // Overlay drawn in the same coordinates as the render's display (x 126–194,
  // y 738–771) and power button (216, 755). Uses the render's own glow filter.
  function buildOverlay(svg) {
    const glow = 'url(#gb-segGlow)';
    const BLUE = '#35AFFF', DIM = '#3a5a72';
    const g = s('g', { id: 'gd-ov' });

    // Charging: battery gauge filling, percentage counting up.
    const charging = s('g', { class: 'gd-screen', 'data-screen': 'charging' },
      s('rect', { x: 134, y: 748, width: 28, height: 14, rx: 2.4, fill: 'none', stroke: BLUE, 'stroke-width': 1.1 }),
      s('rect', { x: 162.6, y: 752.5, width: 1.8, height: 5, rx: 0.6, fill: BLUE }),
      s('rect', { class: 'gd-batt', x: 136, y: 750, width: 24, height: 10, rx: 1.2, fill: BLUE, filter: glow }),
      s('path', { d: 'M149.4 750.6 l-3.6 5.1 h3 l-1.5 4.3 l4.4-5.6 h-3 z', fill: '#06090d' }),
      s('text', { class: 'gd-pct', x: 189, y: 759.4, 'text-anchor': 'end', 'font-size': 9.5, 'font-weight': 500, fill: BLUE, filter: glow,
        'font-family': "'Heebo Variable', Heebo, sans-serif", style: 'font-variant-numeric: tabular-nums' }, '64%'));

    // Pairing: Bluetooth rune blinking at ~1 Hz, hold-progress ring on the button.
    const rune = 'M155.5 748.6 L164.5 761.2 L160 765 L160 745 L164.5 748.8 L155.5 761.4';
    const pairing = s('g', { class: 'gd-screen', 'data-screen': 'pairing' },
      s('path', { class: 'gd-rune', d: rune, fill: 'none', stroke: BLUE, 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', filter: glow }));
    const ring = s('g', { class: 'gd-screen', 'data-screen': 'pairing' },
      s('circle', { cx: 216, cy: 755, r: 11.2, fill: 'none', stroke: '#22262d', 'stroke-width': 1 }),
      s('circle', { class: 'gd-hold', cx: 216, cy: 755, r: 11.2, fill: 'none', stroke: BLUE, 'stroke-width': 1.3, 'stroke-linecap': 'round',
        pathLength: 1, 'stroke-dasharray': '1 1', transform: 'rotate(-90 216 755)', filter: glow }));

    // Ready: the normal display, with a small steady Bluetooth mark.
    const ready = s('g', { class: 'gd-screen', 'data-screen': 'ready' },
      s('path', { d: 'M131.2 742.6 L135.2 748.2 L133.2 749.9 L133.2 741 L135.2 742.7 L131.2 748.3', fill: 'none', stroke: DIM, 'stroke-width': 0.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));

    g.append(charging, pairing, ring, ready);
    svg.append(g);
  }

  function setScreen(svg, name) {
    const display = svg.querySelector('#gb-display');
    if (display) display.style.opacity = name === 'ready' ? '1' : '0';
    svg.querySelectorAll('.gd-screen').forEach((el) => { el.style.display = el.dataset.screen === name ? '' : 'none'; });
    ui.timers.forEach(clearInterval); ui.timers = [];
    if (reduced()) return;
    if (name === 'charging') {
      const batt = svg.querySelector('.gd-batt'), pct = svg.querySelector('.gd-pct');
      let p = 64;
      const draw = () => { batt.setAttribute('width', (24 * p / 100).toFixed(2)); pct.textContent = `${p}%`; };
      draw();
      ui.timers.push(setInterval(() => { p = p >= 100 ? 64 : p + 1; draw(); }, 140));
    }
    if (name === 'pairing') {
      const hold = svg.querySelector('.gd-hold'), rune = svg.querySelector('.gd-rune');
      // 3 s hold fills the ring, then the rune blinks; loop.
      let t = 0;
      ui.timers.push(setInterval(() => {
        t = (t + 50) % 6000;
        const k = Math.min(1, t / 3000);
        hold.setAttribute('stroke-dashoffset', String(1 - k));
        hold.style.opacity = t < 3000 ? '1' : String(Math.max(0, 1 - (t - 3000) / 400));
        rune.style.opacity = t < 3000 ? '0.18' : (Math.floor((t - 3000) / 500) % 2 ? '0.18' : '1');
      }, 50));
    }
  }

  /* camera: tween the viewBox, framing the shot to the stage's aspect ratio */
  function frame(shot, stage) {
    const r = stage.getBoundingClientRect();
    const aspect = r.width / Math.max(1, r.height);
    let { x, y, w, h: hh } = SHOTS[shot];
    if (w / hh < aspect) { const nw = hh * aspect; x -= (nw - w) / 2; w = nw; }
    else { const nh = w / aspect; y -= (nh - hh) / 2; hh = nh; }
    return [x, y, w, hh];
  }
  function moveCamera(svg, stage, shot, instant) {
    const to = frame(shot, stage);
    const from = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    cancelAnimationFrame(ui.cam);
    if (instant || reduced() || from.length !== 4) { svg.setAttribute('viewBox', to.join(' ')); return; }
    const t0 = performance.now(), dur = 900;
    const ease = (t) => 1 - Math.pow(1 - t, 3.2);
    const tick = (now) => {
      const k = ease(Math.min(1, (now - t0) / dur));
      svg.setAttribute('viewBox', from.map((v, i) => v + (to[i] - v) * k).join(' '));
      if (k < 1) ui.cam = requestAnimationFrame(tick);
    };
    ui.cam = requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------------ ui */
  let ui = null;

  function findConnectBtn() {
    return Array.from(doc.querySelectorAll('main button')).find((b) => /^\s*התחברות/.test(b.textContent) && b.getClientRects().length) || null;
  }
  const demoMode = () => { const b = findConnectBtn(); return !!b && /הדגמה/.test(b.textContent); };
  function isConnected() {
    const dot = doc.querySelector('header button span.rounded-full');
    return !!(dot && dot.classList.contains('bg-volt'));
  }

  function renderText(i, dir) {
    const st = STEPS[i];
    const help = st.last ? h('div', { class: 'gd-help' },
      h('button', { type: 'button', class: 'gd-helplink', 'aria-expanded': 'false', onclick: (e) => {
        const open = e.currentTarget.getAttribute('aria-expanded') !== 'true';
        e.currentTarget.setAttribute('aria-expanded', String(open));
        list.hidden = !open;
        if (open) anim(list, [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'ease-out' });
      } }, 'לא מתחבר?')) : null;
    const list = st.last ? h('ul', { class: 'gd-helplist', hidden: true }, HELP.map((t) => h('li', null, t))) : null;
    if (help) help.append(list);

    const el = h('div', { class: 'gd-copy' },
      h('h2', { class: 'gd-title', id: 'gd-title' }, st.title),
      h('p', { class: 'gd-body' }, st.body),
      st.last && demoMode() ? h('p', { class: 'gd-note' }, 'בגרסת ההדגמה מתחברים לבקבוק מדומה, כך שאפשר לנסות גם בלי בקבוק.') : null,
      help);
    const prev = ui.copy;
    ui.text.append(el);
    ui.copy = el;
    if (prev) {
      const a = anim(prev, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-in', fill: 'forwards' });
      if (a) a.onfinish = () => prev.remove(); else prev.remove();
    }
    anim(el, [{ opacity: 0, transform: `translateX(${dir * -10}px)` }, { opacity: 1, transform: 'none' }],
      { duration: 420, delay: prev ? 140 : 0, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' });
  }

  function show(i, dir, instant) {
    const st = STEPS[i];
    ui.i = i;
    if (ui.svg) { moveCamera(ui.svg, ui.stage, st.shot, instant); setScreen(ui.svg, st.screen); }
    renderText(i, dir);
    ui.dots.forEach((d, k) => d.classList.toggle('on', k === i));
    ui.back.style.visibility = i === 0 ? 'hidden' : 'visible';
    ui.next.textContent = st.last ? 'התחברות' : 'המשך';
    ui.skip.style.visibility = st.last ? 'hidden' : 'visible';
    ui.live.textContent = `${i + 1} מתוך ${STEPS.length}: ${st.title}`;
  }
  function goTo(i) {
    if (!ui || i < 0 || i >= STEPS.length || i === ui.i) return;
    show(i, i > ui.i ? 1 : -1);
  }

  async function open() {
    if (ui) return;
    const stage = h('div', { class: 'gd-stage', 'aria-hidden': 'true' });
    const text = h('div', { class: 'gd-text' });
    const dots = STEPS.map(() => h('span', { class: 'gd-dot' }));
    const back = h('button', { type: 'button', class: 'gd-icon', 'aria-label': 'חזרה', onclick: () => goTo(ui.i - 1),
      html: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>' });
    const skip = h('button', { type: 'button', class: 'gd-skip', onclick: () => close(true) }, 'דילוג');
    const next = h('button', { type: 'button', class: 'gd-next', onclick: onNext }, 'המשך');
    const live = h('p', { class: 'gd-sr', 'aria-live': 'polite' });
    const root = h('div', { id: 'fx-guide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gd-title' },
      h('div', { class: 'gd-top' }, back, skip),
      stage,
      h('div', { class: 'gd-panel' }, text, h('div', { class: 'gd-foot' }, h('div', { class: 'gd-dots', 'aria-hidden': 'true' }, dots), next)),
      live);
    ui = { root, stage, text, dots, back, skip, next, live, i: 0, copy: null, svg: null, timers: [], cam: 0 };
    doc.body.append(root);
    html.classList.add('gd-locked');
    const appRoot = doc.getElementById('root');
    if (appRoot) { appRoot.setAttribute('inert', ''); appRoot.setAttribute('aria-hidden', 'true'); }
    history.pushState({ nexaGuide: 1 }, '');
    anim(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'ease-out' });

    const svgText = await loadBottle();
    if (!ui) return;
    if (svgText) {
      stage.innerHTML = svgText;
      const svg = stage.querySelector('svg');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      buildOverlay(svg);
      ui.svg = svg;
      anim(svg, [{ opacity: 0 }, { opacity: 1 }], { duration: 700, easing: 'ease-out' });
    }
    show(0, 0, true);
    swipe(root);
    addEventListener('resize', onResize);
    // Keyboard users land on the main button; touch screens get no focus ring.
    if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => next.focus({ preventScroll: true }), 350);
  }
  function onResize() { if (ui && ui.svg) moveCamera(ui.svg, ui.stage, STEPS[ui.i].shot, true); }

  function onNext() {
    if (!ui) return;
    if (!STEPS[ui.i].last) { goTo(ui.i + 1); return; }
    close(true, () => { const b = findConnectBtn(); if (b) b.click(); });
  }

  let ignorePop = false;
  function close(finished, after, fromPop) {
    if (!ui) return;
    const g = ui;
    ui = null;
    g.timers.forEach(clearInterval);
    cancelAnimationFrame(g.cam);
    removeEventListener('resize', onResize);
    if (finished) markDone();
    html.classList.remove('gd-locked');
    const appRoot = doc.getElementById('root');
    if (appRoot && !doc.getElementById('fx-auth') && !doc.getElementById('fx-account')) { appRoot.removeAttribute('inert'); appRoot.removeAttribute('aria-hidden'); }
    if (!fromPop) { ignorePop = true; history.back(); }
    const a = anim(g.root, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-in', fill: 'forwards' });
    const fin = () => { g.root.remove(); if (after) setTimeout(after, 60); };
    if (a) a.onfinish = fin; else fin();
  }
  addEventListener('popstate', () => {
    if (ignorePop) { ignorePop = false; return; }
    if (ui) close(false, null, true);
  });
  doc.addEventListener('keydown', (e) => {
    if (!ui) return;
    if (e.key === 'Escape') { e.preventDefault(); close(false); }
    else if (e.key === 'ArrowLeft') goTo(ui.i + 1);   // RTL: next is to the left
    else if (e.key === 'ArrowRight') goTo(ui.i - 1);
  });
  function swipe(el) {
    let x0 = null, y0 = 0;
    el.addEventListener('pointerdown', (e) => { if (e.target.closest('button, ul')) return; x0 = e.clientX; y0 = e.clientY; });
    el.addEventListener('pointerup', (e) => {
      if (x0 == null || !ui) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      x0 = null;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      goTo(ui.i + (dx > 0 ? 1 : -1));
    });
    el.addEventListener('pointercancel', () => { x0 = null; });
  }

  /* ------------------------------------------------- automatic first run */
  let armed = false;
  function check() {
    if (ui || armed || done()) return;
    if (isConnected()) { markDone(); return; }
    if (doc.getElementById('fx-auth') || doc.getElementById('fx-account') || doc.getElementById('fx-splash')) return;
    if (doc.querySelector('[role="dialog"], .fa-toast')) return;
    if (!findConnectBtn()) return;
    armed = true;
    loadBottle(); // warm the image while we wait
    setTimeout(() => {
      armed = false;
      if (!ui && !done() && findConnectBtn() && !doc.getElementById('fx-auth')) open();
    }, 700);
  }

  window.NexaGuide = { open: () => open(), get done() { return done(); } };
  const start = () => {
    new MutationObserver(check).observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    check();
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
