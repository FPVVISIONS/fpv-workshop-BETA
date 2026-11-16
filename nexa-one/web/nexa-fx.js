/* ==========================================================================
   NEXA FX — motion & polish layer for NEXA ONE
   A dependency-free enhancement script that runs beside the React bundle.
   Rules it follows so it can never break the app:
     • never rewrites React-owned className / style / text;
     • only animates via the Web Animations API, data-attributes and its own
       out-of-tree overlay elements;
     • every feature fails closed (a thrown error disables that feature only);
     • prefers-reduced-motion turns the motion off.
   ========================================================================== */
(() => {
  'use strict';

  const doc = document;
  const html = doc.documentElement;
  const RM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  /* Motion is off when the OS asks for it OR the app's own
     Settings → "הפחתת תנועה" switch is on (prefs.motion === "reduce"). */
  let prefAt = -1e9, prefReduce = false;
  const appReduce = () => {
    const now = performance.now();
    if (now - prefAt > 400) {
      prefAt = now;
      try { prefReduce = JSON.parse(localStorage.getItem('nexa-one:prefs:v1') || '{}').motion === 'reduce'; }
      catch (_) { prefReduce = false; }
    }
    return prefReduce;
  };
  const reduced = () => RM.matches || appReduce();
  const EASE_OUT = 'cubic-bezier(.22,1,.36,1)';
  const SPRING = 'cubic-bezier(.34,1.56,.64,1)';
  const rtl = () => (html.getAttribute('dir') || doc.body?.dir || 'ltr').toLowerCase() === 'rtl';
  const safe = (fn) => (...a) => { try { return fn(...a); } catch (e) { if (window.__NEXA_FX_DEBUG__) console.warn('[nexa-fx]', e); } };
  const canAnimate = typeof Element !== 'undefined' && 'animate' in Element.prototype;

  html.setAttribute('data-fx', '');

  /* ------------------------------------------------------------------ utils */
  const $ = (s, r = doc) => r.querySelector(s);
  const $$ = (s, r = doc) => Array.from(r.querySelectorAll(s));
  const anim = (el, kf, opts) => (canAnimate && !reduced() && el ? el.animate(kf, opts) : null);
  const bottomInset = () => {
    const n = $('nav.fixed.bottom-0');
    return n && n.getClientRects().length ? n.getBoundingClientRect().height : 0;
  };

  /* -------------------------------------------------------- ambient layers */
  let ambient, frost;
  const ensureAmbient = safe(() => {
    if (!ambient || !ambient.isConnected) {
      ambient = doc.createElement('div');
      ambient.id = 'fx-ambient';
      ambient.setAttribute('aria-hidden', 'true');
      doc.body.prepend(ambient);
    }
    if (!frost || !frost.isConnected) {
      frost = doc.createElement('canvas');
      frost.id = 'fx-frost';
      frost.setAttribute('aria-hidden', 'true');
      doc.body.prepend(frost);
      Frost.attach(frost);
    }
  });

  /* Frost particles: drifting ice motes, only rendered while cooling. */
  const Frost = (() => {
    let cv, ctx, parts = [], raf = 0, on = false, w = 0, h = 0, dpr = 1, last = 0;
    const rand = (a, b) => a + Math.random() * (b - a);
    const spawn = (anywhere) => ({
      x: rand(0, w),
      y: anywhere ? rand(0, h) : rand(-20, -4),
      r: Math.random() < 0.12 ? rand(2.2, 3.6) : rand(0.6, 1.8),
      vy: rand(6, 18),
      sway: rand(8, 22),
      ph: rand(0, Math.PI * 2),
      sp: rand(0.25, 0.7),
      tw: rand(0.6, 1.6),
    });
    const resize = () => {
      if (!cv) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = innerWidth; h = innerHeight;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.round(Math.min(70, Math.max(28, (w * h) / 14000)));
      while (parts.length < target) parts.push(spawn(true));
      parts.length = target;
    };
    const frame = (t) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.y += p.vy * dt;
        p.ph += p.sp * dt;
        const x = p.x + Math.sin(p.ph) * p.sway;
        if (p.y > h + 8) Object.assign(p, spawn(false));
        const a = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(t / 1000 * p.tw + p.ph * 3));
        if (p.r > 2) {
          const g = ctx.createRadialGradient(x, p.y, 0, x, p.y, p.r * 3);
          g.addColorStop(0, `rgba(139,223,255,${a * 0.55})`);
          g.addColorStop(1, 'rgba(139,223,255,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(x, p.y, p.r * 3, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = `rgba(200,238,255,${a})`;
          ctx.beginPath(); ctx.arc(x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        }
      }
    };
    const run = () => {
      const want = on && !reduced() && !doc.hidden && cv;
      if (want && !raf) { last = 0; raf = requestAnimationFrame(frame); }
      if (!want && raf) { cancelAnimationFrame(raf); raf = 0; ctx && ctx.clearRect(0, 0, w, h); }
    };
    addEventListener('resize', () => { resize(); }, { passive: true });
    doc.addEventListener('visibilitychange', run);
    return {
      attach(c) { cv = c; ctx = c.getContext('2d'); resize(); run(); },
      set(v) { on = v; run(); },
    };
  })();

  /* ------------------------------------------------------ cooling detection */
  let cooling = false;
  const detectCooling = () => {
    const status = $('header button span.rounded-full');
    if (status && !status.classList.contains('bg-volt')) return false; // disconnected
    const sw = $('main button[role="switch"].absolute.rounded-full');
    if (sw) return sw.getAttribute('aria-checked') === 'true';
    for (const dt of $$('main dl dt')) {
      if (dt.textContent.trim() === 'קירור') {
        const v = (dt.nextElementSibling?.textContent || '').trim();
        if (v) return v !== 'כבוי';
      }
    }
    return null; // unknown on this screen — keep last known state
  };
  const syncCooling = safe(() => {
    const v = detectCooling();
    if (v === null || v === cooling) return;
    cooling = v;
    if (v) html.setAttribute('data-fx-cooling', ''); else html.removeAttribute('data-fx-cooling');
    Frost.set(v);
  });

  /* ------------------------------------------------- bottom tab indicator */
  let indicator, lastActiveHref = null;
  const tabLinks = () => $$('nav.fixed.bottom-0 li a');
  const activeTab = () => {
    const links = tabLinks();
    return links.find((a) => a.querySelector(':scope > span.absolute')) ||
           links.find((a) => !a.classList.contains('text-mute')) || null;
  };
  const syncTabs = safe((instant) => {
    const nav = $('nav.fixed.bottom-0');
    if (!nav) return;
    nav.setAttribute('data-fx-tabs', '');
    if (!indicator || !nav.contains(indicator)) {
      indicator = doc.createElement('div');
      indicator.id = 'fx-tab-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      indicator.classList.add('fx-no-anim');
      nav.appendChild(indicator);
      instant = true;
    }
    const a = activeTab();
    if (!a) { indicator.style.opacity = '0'; return; }
    indicator.style.opacity = '1';
    const nr = nav.getBoundingClientRect();
    const ar = a.getBoundingClientRect();
    indicator.style.setProperty('--fx-x', `${Math.round(ar.left - nr.left + ar.width / 2 - 18)}px`);
    if (instant) {
      void indicator.offsetWidth;
      requestAnimationFrame(() => indicator.classList.remove('fx-no-anim'));
    }
    const href = a.getAttribute('href');
    if (lastActiveHref !== null && href !== lastActiveHref) {
      const icon = a.querySelector('svg');
      anim(icon, [
        { scale: '1', translate: '0 0' },
        { scale: '.78', translate: '0 1px', offset: 0.25 },
        { scale: '1.16', translate: '0 -3px', offset: 0.6 },
        { scale: '1', translate: '0 0' },
      ], { duration: 520, easing: 'ease-out' });
    }
    lastActiveHref = href;
  });

  /* ---------------------------------------------------- route transitions */
  const routeKey = (h) => (h || '').replace(/^#\/?/, '').split(/[?&]/)[0];

  const blocksOf = (view) => {
    let list = Array.from(view.children);
    if (list.length === 1 && list[0].children.length) list = Array.from(list[0].children);
    const out = [];
    for (const el of list) {
      const r = el.getBoundingClientRect();
      if (el.children.length > 1 && r.height > innerHeight * 0.6 && !el.matches('ul,ol,dl,nav,section,table')) {
        out.push(...el.children);
      } else out.push(el);
    }
    return out.filter((e) => e.getClientRects().length && !(e.style.opacity || e.style.transform)).slice(0, 14);
  };

  /* Scroll-reveal for content that starts below the fold. */
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    let i = 0;
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const el = en.target;
      io.unobserve(el);
      el.removeAttribute('data-fx-pending');
      anim(el, [
        { opacity: 0, translate: '0 18px' },
        { opacity: 1, translate: '0 0' },
      ], { duration: 560, delay: Math.min(i++, 6) * 55, easing: EASE_OUT, fill: 'backwards' });
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.01 }) : null;

  const armReveal = (view) => {
    if (!io || reduced()) return;
    const limit = innerHeight - bottomInset();
    const cands = $$('li, section, article, dl, figure, .rounded-2xl', view)
      .filter((el) => !el.querySelector('li, section, article, dl, figure, .rounded-2xl'))
      .filter((el) => !(el.style.opacity || el.style.transform) && !el.closest('[data-fx-pending]'))
      .slice(0, 240);
    for (const el of cands) {
      if (el.getBoundingClientRect().top > limit) {
        el.setAttribute('data-fx-pending', '');
        io.observe(el);
      }
    }
  };

  /* The app already slides whole screens (Framer Motion AnimatePresence).
     This adds what that lacks: a staggered rise of the blocks inside the
     incoming screen, plus scroll-reveal for content below the fold. */
  const enterView = safe((view) => {
    view = view || $('#main > div > *');
    if (!view || reduced()) return;
    blocksOf(view).forEach((el, i) => {
      if (el.getBoundingClientRect().top > innerHeight) return;
      anim(el, [
        { opacity: 0, translate: '0 16px' },
        { opacity: 1, translate: '0 0' },
      ], { duration: 560, delay: 40 + i * 45, easing: EASE_OUT, fill: 'backwards' });
    });
    armReveal(view);
  });

  /* A new screen (route change) or a new screen body inside the same route
     (e.g. "connect demo" → dashboard) both get the entrance. */
  let lastView = null, lastBody = null;
  const watchViewSwap = safe(() => {
    const v = $('#main > div > *');
    const body = v && v.firstElementChild;
    if (!v || (v === lastView && body === lastBody)) return;
    const first = !lastView;
    lastView = v; lastBody = body;
    if (!first) enterView(v); // first mount is handled by the splash hand-off
  });

  /* Tapping the already-active tab glides back to the top. */
  doc.addEventListener('click', safe((e) => {
    const a = e.target.closest && e.target.closest('nav.fixed.bottom-0 li a');
    if (!a) return;
    if (routeKey(a.getAttribute('href')) === routeKey(location.hash) && scrollY > 0) {
      scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
    }
  }));

  /* ------------------------------------------- press feedback + ripples */
  const PRESSABLE = 'button, a[href], [role="button"], [role="radio"], [role="tab"], [role="menuitem"], summary, label[for]';
  let press = null;

  const lum = (rgb) => {
    const m = rgb && rgb.match(/[\d.]+/g);
    if (!m || (m[3] !== undefined && +m[3] < 0.35)) return 0;
    return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
  };

  const ripple = (el, x, y) => {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    const cs = getComputedStyle(el);
    const host = doc.createElement('div');
    host.className = 'fx-ripple-host';
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, {
      left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px',
      borderRadius: cs.borderRadius,
    });
    const dot = doc.createElement('span');
    dot.className = 'fx-ripple';
    const size = Math.hypot(Math.max(x - r.left, r.right - x), Math.max(y - r.top, r.bottom - y)) * 2;
    const light = lum(cs.backgroundColor) > 0.6;
    Object.assign(dot.style, {
      width: size + 'px', height: size + 'px',
      left: x - r.left - size / 2 + 'px', top: y - r.top - size / 2 + 'px',
      background: light
        ? 'radial-gradient(circle, rgba(16,17,20,.16) 0%, rgba(16,17,20,.10) 60%, transparent 72%)'
        : 'radial-gradient(circle, rgba(139,223,255,.20) 0%, rgba(245,247,250,.08) 60%, transparent 72%)',
    });
    host.appendChild(dot);
    doc.body.appendChild(host);
    const a1 = anim(dot, [{ transform: 'scale(.08)', opacity: 1 }, { transform: 'scale(1)', opacity: 1 }],
      { duration: 420, easing: EASE_OUT, fill: 'forwards' });
    const finish = () => {
      const a2 = anim(host, [{ opacity: 1 }, { opacity: 0 }], { duration: 380, easing: 'ease-out', fill: 'forwards' });
      if (a2) a2.onfinish = () => host.remove(); else host.remove();
    };
    return { finish: () => (a1 && a1.playState === 'running' ? (a1.onfinish = finish) : finish()) };
  };

  const pressDown = (el) => {
    const r = el.getBoundingClientRect();
    const s = Math.max(0.94, Math.min(0.985, 1 - 7 / Math.max(r.width, 1)));
    return anim(el, [{ scale: '1' }, { scale: String(s) }], { duration: 130, easing: 'ease-out', fill: 'forwards' })
      && { s, el };
  };
  const pressUp = (p) => {
    if (!p || !p.el) return;
    p.el.getAnimations?.().forEach((a) => { if (a.effect && a.effect.getKeyframes?.().some((k) => k.scale)) a.cancel(); });
    anim(p.el, [{ scale: String(p.s) }, { scale: '1' }], { duration: 480, easing: SPRING });
  };

  const releasePress = () => {
    if (!press) return;
    clearTimeout(press.timer);
    if (press.started) { pressUp(press.pd); press.rip && press.rip.finish(); }
    press = null;
  };

  doc.addEventListener('pointerdown', safe((e) => {
    if (e.button !== 0 || reduced()) return;
    const el = e.target.closest && e.target.closest(PRESSABLE);
    if (!el || el.matches(':disabled, [aria-disabled="true"]') || el.closest('[role="slider"]')) return;
    releasePress();
    const isPower = el.matches('button[role="switch"].absolute.rounded-full');
    const p = { el, x: e.clientX, y: e.clientY, started: false };
    // Small delay so a scroll gesture that starts on a card doesn't flash it.
    p.timer = setTimeout(() => {
      p.started = true;
      p.pd = pressDown(el);
      if (!isPower && !el.closest('nav.fixed.bottom-0')) p.rip = ripple(el, p.x, p.y);
    }, e.pointerType === 'touch' ? 60 : 0);
    press = p;
  }), { passive: true });
  doc.addEventListener('pointermove', (e) => {
    if (press && !press.started && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) {
      clearTimeout(press.timer); press = null;
    }
  }, { passive: true });
  doc.addEventListener('pointerup', (e) => {
    if (press && !press.started) {
      // Quick tap: play the whole press in one go.
      clearTimeout(press.timer);
      const p = press; press = null;
      p.pd = pressDown(p.el);
      if (!p.el.matches('button[role="switch"].absolute.rounded-full') && !p.el.closest('nav.fixed.bottom-0')) p.rip = ripple(p.el, e.clientX, e.clientY);
      setTimeout(() => { pressUp(p.pd); p.rip && p.rip.finish(); }, 110);
      return;
    }
    releasePress();
  }, { passive: true });
  doc.addEventListener('pointercancel', () => { if (press) { press.started ? releasePress() : (clearTimeout(press.timer), press = null); } }, { passive: true });
  addEventListener('blur', releasePress);

  /* Slider: mark drag state so the thumb stays swollen outside :active too. */
  doc.addEventListener('pointerdown', (e) => {
    const s = e.target.closest && e.target.closest('[role="slider"]');
    if (!s) return;
    s.setAttribute('data-fx-drag', '');
    const up = () => { s.removeAttribute('data-fx-drag'); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
    addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }, { passive: true });

  /* ----------------------------------------- power toggle shock-wave */
  doc.addEventListener('click', safe((e) => {
    const btn = e.target.closest && e.target.closest('button[role="switch"]');
    if (!btn || reduced()) return;
    const big = btn.matches('.absolute.rounded-full') || btn.getBoundingClientRect().width >= 56;
    if (!big) return;
    const turningOn = btn.getAttribute('aria-checked') !== 'true';
    const r = btn.getBoundingClientRect();
    const make = (delay, scaleTo) => {
      const ring = doc.createElement('div');
      ring.className = 'fx-shock';
      ring.setAttribute('aria-hidden', 'true');
      Object.assign(ring.style, {
        left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px',
        borderColor: turningOn ? '' : '#6b717c',
        boxShadow: turningOn ? '' : 'none',
      });
      doc.body.appendChild(ring);
      const a = anim(ring, [
        { transform: 'scale(.92)', opacity: 0.95 },
        { transform: `scale(${scaleTo})`, opacity: 0 },
      ], { duration: 900, delay, easing: EASE_OUT, fill: 'both' });
      if (a) a.onfinish = () => ring.remove(); else ring.remove();
    };
    make(0, 1.55);
    if (turningOn) make(140, 1.95);
  }), true);

  /* ------------------------------------------------------ header elevation */
  const syncHeader = safe(() => {
    const h = $('header.sticky');
    if (!h) return;
    if (scrollY > 4) h.setAttribute('data-fx-scrolled', ''); else h.removeAttribute('data-fx-scrolled');
  });
  addEventListener('scroll', syncHeader, { passive: true });

  /* --------------------------------------------------------------- splash */
  const bootAt = performance.now();
  const syncSplash = safe(() => {
    const sp = $('#fx-splash');
    if (!sp || sp.classList.contains('fx-leave')) return;
    const root = $('#root');
    if (!root || $('#boot', root) || !root.firstElementChild) return;
    const wait = Math.max(0, 650 - (performance.now() - bootAt));
    setTimeout(() => {
      sp.classList.add('fx-leave');
      sp.addEventListener('animationend', () => sp.remove(), { once: true });
      setTimeout(() => sp.remove(), 900);
      // First paint of the app gets the same staggered entrance as routes.
      enterView();
    }, wait);
  });

  /* ---------------------------------------------------------- orchestration */
  let scheduled = false;
  const sync = () => {
    scheduled = false;
    const r = reduced();
    if (r !== html.hasAttribute('data-fx-reduce')) {
      if (r) html.setAttribute('data-fx-reduce', ''); else html.removeAttribute('data-fx-reduce');
      Frost.set(cooling);
    }
    ensureAmbient();
    syncSplash();
    syncTabs(false);
    syncCooling();
    syncHeader();
  };
  const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(sync); } };

  const start = () => {
    const mo = new MutationObserver(() => { schedule(); watchViewSwap(); });
    mo.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-checked', 'class'] });
    addEventListener('resize', () => syncTabs(true), { passive: true });
    if (RM.addEventListener) RM.addEventListener('change', () => { Frost.set(cooling); schedule(); });
    sync();
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
