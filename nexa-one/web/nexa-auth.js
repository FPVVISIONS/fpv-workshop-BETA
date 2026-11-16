/* ==========================================================================
   NEXA AUTH — sign up / sign in / account layer for NEXA ONE
   Self-contained (no dependencies) and independent of the React bundle.

   • Welcome gate on first launch: create account · sign in · continue as guest
   • Sign up (name, email, password + strength meter, terms)
   • Sign in (remember me, show/hide password, caps-lock hint, lockout after
     repeated failures) · Forgot password → 6-digit code → new password
   • Account sheet (header person icon): edit name, change password,
     app preferences (opens the app's original sheet), sign out, delete
   • Header avatar with the user's initials

   Storage: the default provider keeps accounts ON THIS DEVICE (passwords are
   PBKDF2-SHA256 hashed, 150k iterations, per-user salt). To use a real backend
   (Supabase, Firebase, your own API) call NexaAuth.useProvider({...}) with the
   same async methods as `LocalProvider` below — the UI does not change.
   ========================================================================== */
(() => {
  'use strict';

  const doc = document;
  const html = doc.documentElement;
  const K_DB = 'nexa-auth:v1';
  const K_SESSION = 'nexa-auth:session';
  const K_GUEST = 'nexa-auth:guest';
  const ITER = 150000;
  const MAX_FAILS = 5, LOCK_MS = 30000, CODE_TTL = 10 * 60000;

  const reduced = () =>
    (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) || html.hasAttribute('data-fx-reduce');
  const EASE = 'cubic-bezier(.22,1,.36,1)';
  const anim = (el, kf, o) => (el && el.animate && !reduced() ? el.animate(kf, o) : null);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ================================================================ crypto */
  const te = new TextEncoder();
  const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const randB64 = (n) => toB64(crypto.getRandomValues(new Uint8Array(n)));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : randB64(16));
  async function pbkdf2(secret, saltB64, iter = ITER) {
    if (!crypto.subtle) throw new AuthError('unsupported');
    const key = await crypto.subtle.importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations: iter }, key, 256);
    return toB64(bits);
  }
  const safeEq = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  };

  class AuthError extends Error {
    constructor(code, extra) { super(code); this.code = code; Object.assign(this, extra); }
  }

  /* ======================================================= local provider */
  const db = {
    read() {
      try { const d = JSON.parse(localStorage.getItem(K_DB)); if (d && d.users) return { fails: {}, resets: {}, ...d }; } catch (_) {}
      return { users: {}, fails: {}, resets: {} };
    },
    write(d) { localStorage.setItem(K_DB, JSON.stringify(d)); },
  };
  const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt });
  const keyOf = (email) => String(email || '').trim().toLowerCase();
  const findById = (d, id) => Object.values(d.users).find((u) => u.id === id);

  const LocalProvider = {
    name: 'local',
    async signUp({ name, email, password }) {
      const d = db.read(), k = keyOf(email);
      if (d.users[k]) throw new AuthError('exists');
      const salt = randB64(16);
      const u = { id: uid(), name: name.trim(), email: email.trim(), salt, iter: ITER, hash: await pbkdf2(password, salt), createdAt: Date.now() };
      d.users[k] = u; db.write(d);
      return publicUser(u);
    },
    async signIn({ email, password }) {
      const d = db.read(), k = keyOf(email);
      const f = d.fails[k];
      if (f && f.until > Date.now()) throw new AuthError('locked', { wait: Math.ceil((f.until - Date.now()) / 1000) });
      const u = d.users[k];
      // Hash even when the user doesn't exist so timing doesn't reveal it.
      const h = await pbkdf2(password, u ? u.salt : 'AAAAAAAAAAAAAAAAAAAAAA==', u ? u.iter : ITER);
      if (!u || !safeEq(h, u.hash)) {
        const n = ((f && f.n) || 0) + 1;
        d.fails[k] = n >= MAX_FAILS ? { n: 0, until: Date.now() + LOCK_MS } : { n, until: 0 };
        db.write(d);
        if (n >= MAX_FAILS) throw new AuthError('locked', { wait: LOCK_MS / 1000 });
        throw new AuthError('invalid', { left: MAX_FAILS - n });
      }
      delete d.fails[k]; db.write(d);
      return publicUser(u);
    },
    async requestReset({ email }) {
      const d = db.read(), k = keyOf(email);
      if (!d.users[k]) throw new AuthError('nouser');
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
      const salt = randB64(8);
      d.resets[k] = { salt, hash: await pbkdf2(code, salt, 1000), exp: Date.now() + CODE_TTL, tries: 0 };
      db.write(d);
      // A real backend e-mails the code. On-device there is no mail server,
      // so the code is handed back for the UI to show (clearly labelled demo).
      return { demoCode: code };
    },
    async confirmReset({ email, code, password }) {
      const d = db.read(), k = keyOf(email), r = d.resets[k], u = d.users[k];
      if (!r || !u) throw new AuthError('code-expired');
      if (r.exp < Date.now() || r.tries >= 5) { delete d.resets[k]; db.write(d); throw new AuthError('code-expired'); }
      if (!safeEq(await pbkdf2(code, r.salt, 1000), r.hash)) { r.tries++; db.write(d); throw new AuthError('code-invalid'); }
      u.salt = randB64(16); u.iter = ITER; u.hash = await pbkdf2(password, u.salt);
      delete d.resets[k]; delete d.fails[k]; db.write(d);
      return publicUser(u);
    },
    async updateProfile(id, { name }) {
      const d = db.read(), u = findById(d, id);
      if (!u) throw new AuthError('nouser');
      u.name = name.trim(); db.write(d);
      return publicUser(u);
    },
    async changePassword(id, { current, next }) {
      const d = db.read(), u = findById(d, id);
      if (!u) throw new AuthError('nouser');
      if (!safeEq(await pbkdf2(current, u.salt, u.iter), u.hash)) throw new AuthError('wrong-current');
      if (current === next) throw new AuthError('same-password');
      u.salt = randB64(16); u.iter = ITER; u.hash = await pbkdf2(next, u.salt); db.write(d);
    },
    async deleteAccount(id, { password }) {
      const d = db.read(), u = findById(d, id);
      if (!u) throw new AuthError('nouser');
      if (!safeEq(await pbkdf2(password, u.salt, u.iter), u.hash)) throw new AuthError('wrong-current');
      delete d.users[keyOf(u.email)]; db.write(d);
    },
    async exists(id) { return !!findById(db.read(), id); },
  };

  let provider = LocalProvider;

  /* ============================================================== session */
  const session = {
    get() {
      for (const s of [localStorage, sessionStorage]) {
        try { const v = JSON.parse(s.getItem(K_SESSION)); if (v && v.user) return v.user; } catch (_) {}
      }
      return null;
    },
    set(user, remember) {
      this.clear();
      (remember ? localStorage : sessionStorage).setItem(K_SESSION, JSON.stringify({ user, at: Date.now() }));
      try { localStorage.removeItem(K_GUEST); } catch (_) {}
    },
    clear() { localStorage.removeItem(K_SESSION); sessionStorage.removeItem(K_SESSION); },
  };
  const isGuest = () => { try { return localStorage.getItem(K_GUEST) === '1'; } catch (_) { return false; } };
  let user = session.get();
  const listeners = new Set();
  const setUser = (u, remember = true) => {
    user = u;
    if (u) session.set(u, remember); else session.clear();
    syncAvatar();
    listeners.forEach((fn) => { try { fn(u); } catch (_) {} });
  };

  /* ============================================================ messages */
  const MSG = {
    nameReq: 'נא להזין שם', nameShort: 'השם קצר מדי',
    emailReq: 'נא להזין אימייל', emailBad: 'כתובת האימייל לא תקינה',
    pwReq: 'נא להזין סיסמה', pwShort: 'לפחות 8 תווים', pwMix: 'הסיסמה צריכה לכלול אות ומספר',
    terms: 'יש לאשר את התנאים כדי להמשיך',
    codeReq: 'נא להזין את הקוד בן 6 הספרות',
    exists: 'כבר קיים חשבון עם האימייל הזה.',
    invalid: 'האימייל או הסיסמה שגויים',
    locked: (s) => `יותר מדי ניסיונות. נסו שוב בעוד ${s} שניות.`,
    nouser: 'לא נמצא חשבון עם האימייל הזה במכשיר',
    'code-invalid': 'הקוד שגוי. בדקו ונסו שוב.',
    'code-expired': 'תוקף הקוד פג. בקשו קוד חדש.',
    'wrong-current': 'הסיסמה שגויה',
    'same-password': 'הסיסמה החדשה זהה לנוכחית',
    unsupported: 'המכשיר לא תומך בהצפנה הנדרשת',
    generic: 'משהו השתבש. נסו שוב.',
  };
  const errText = (e) => (e && e.code === 'locked' ? MSG.locked(e.wait) : MSG[e && e.code] || MSG.generic);
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const validEmail = (v) => (!v.trim() ? MSG.emailReq : EMAIL_RE.test(v.trim()) ? '' : MSG.emailBad);
  const validNewPw = (v) => (!v ? MSG.pwReq : v.length < 8 ? MSG.pwShort : !(/[A-Za-z֐-׿]/.test(v) && /\d/.test(v)) ? MSG.pwMix : '');
  const validName = (v) => (!v.trim() ? MSG.nameReq : v.trim().length < 2 ? MSG.nameShort : '');
  const strength = (v) => {
    if (!v) return 0;
    let s = 0;
    if (v.length >= 8) s++;
    if (v.length >= 12) s++;
    if (/[a-z֐-׿]/.test(v) && /[A-Z]/.test(v)) s++;
    if (/\d/.test(v)) s++;
    if (/[^A-Za-z0-9֐-׿]/.test(v)) s++;
    return Math.max(1, Math.min(4, s));
  };
  const STRENGTH = ['', 'חלשה', 'בינונית', 'טובה', 'חזקה'];
  const initials = (name) => (name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '·';

  /* =============================================================== icons */
  const I = {
    mail: '<path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.6A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3.1 3.9M6.5 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    back: '<path d="M9 6l6 6-6 6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
    chev: '<path d="M15 6l-6 6 6 6"/>',
    key: '<circle cx="8" cy="15" r="3.5"/><path d="M10.5 12.5 19 4M16 7l2.5 2.5M14 9l2 2"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
    trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
    shield: '<path d="M12 3 5 6v6c0 4.2 3 7.4 7 9 4-1.6 7-4.8 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
    snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.01"/>',
  };
  const svg = (name, size = 20) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${I[name]}</svg>`;

  /* ============================================================ dom utils */
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
  let idSeq = 0;
  const nid = (p) => `fa-${p}-${++idSeq}`;

  /* --------------------------------------------------------------- toast */
  function toast(text, kind = 'ok') {
    const t = h('div', { class: `fa-toast fa-toast-${kind}`, role: 'status', 'aria-live': 'polite' },
      h('span', { class: 'fa-toast-ico', html: svg(kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'alert', 18) }),
      h('span', null, text));
    doc.body.append(t);
    anim(t, [{ opacity: 0, transform: 'translate(-50%,-16px) scale(.96)' }, { opacity: 1, transform: 'translate(-50%,0) scale(1)' }], { duration: 420, easing: EASE });
    setTimeout(() => {
      const a = anim(t, [{ opacity: 1 }, { opacity: 0, transform: 'translate(-50%,-10px)' }], { duration: 300, easing: 'ease-in', fill: 'forwards' });
      if (a) a.onfinish = () => t.remove(); else t.remove();
    }, 3000);
  }

  /* ---------------------------------------------------------------- fields */
  function field({ label, type = 'text', icon, autocomplete, inputmode, dir, placeholder, hint, maxlength, meter, value }) {
    const id = nid('in'), errId = id + '-err', hintId = id + '-hint';
    const input = h('input', {
      id, type, class: 'fa-input', autocomplete, inputmode, dir, placeholder: placeholder || ' ', maxlength,
      'aria-describedby': [hint && hintId, errId].filter(Boolean).join(' '), enterkeyhint: 'next', spellcheck: 'false',
      autocapitalize: type === 'email' || type === 'password' ? 'off' : undefined,
    });
    if (value) input.value = value;
    const ctrl = h('div', { class: 'fa-control' }, icon ? h('span', { class: 'fa-ico', html: svg(icon, 18) }) : null, input);
    let eye = null;
    if (type === 'password') {
      eye = h('button', { type: 'button', class: 'fa-eye', 'aria-label': 'הצגת הסיסמה', 'aria-pressed': 'false', html: svg('eye', 18) });
      eye.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        eye.innerHTML = svg(show ? 'eyeOff' : 'eye', 18);
        eye.setAttribute('aria-pressed', String(show));
        eye.setAttribute('aria-label', show ? 'הסתרת הסיסמה' : 'הצגת הסיסמה');
        input.focus({ preventScroll: true });
      });
      ctrl.append(eye);
    }
    const err = h('p', { class: 'fa-err', id: errId, 'aria-live': 'polite' });
    const caps = type === 'password' ? h('p', { class: 'fa-caps', hidden: true }, 'Caps Lock פועל') : null;
    let meterEl = null, bars = [], meterLbl = null;
    if (meter) {
      bars = [0, 1, 2, 3].map(() => h('span', { class: 'fa-bar' }));
      meterLbl = h('span', { class: 'fa-meter-lbl' });
      meterEl = h('div', { class: 'fa-meter', 'aria-hidden': 'true' }, h('div', { class: 'fa-bars' }, bars), meterLbl);
      input.addEventListener('input', () => {
        const s = strength(input.value);
        meterEl.dataset.s = String(s);
        bars.forEach((b, i) => b.classList.toggle('on', i < s));
        meterLbl.textContent = s ? `חוזק: ${STRENGTH[s]}` : '';
      });
    }
    const wrap = h('div', { class: 'fa-field fa-stagger' },
      h('label', { for: id, class: 'fa-label' }, label), ctrl, meterEl,
      hint ? h('p', { class: 'fa-hint', id: hintId }, hint) : null, caps, err);
    if (caps) {
      const upd = (e) => { if (e.getModifierState) caps.hidden = !e.getModifierState('CapsLock'); };
      input.addEventListener('keydown', upd); input.addEventListener('keyup', upd);
      input.addEventListener('blur', () => { caps.hidden = true; });
    }
    const api = {
      wrap, input,
      get value() { return input.value; },
      set(msg) {
        err.textContent = msg || '';
        wrap.classList.toggle('fa-invalid', !!msg);
        input.setAttribute('aria-invalid', msg ? 'true' : 'false');
        return !msg;
      },
    };
    input.addEventListener('input', () => { if (wrap.classList.contains('fa-invalid')) api.set(''); });
    return api;
  }

  function checkbox(label, checked) {
    const id = nid('cb');
    const input = h('input', { type: 'checkbox', id, class: 'fa-cb-input', checked });
    const err = h('p', { class: 'fa-err', 'aria-live': 'polite' });
    const wrap = h('div', { class: 'fa-cb-wrap fa-stagger' },
      h('label', { class: 'fa-cb', for: id }, input, h('span', { class: 'fa-cb-box', html: svg('check', 14) }), h('span', { class: 'fa-cb-text' }, label)),
      err);
    input.addEventListener('change', () => { err.textContent = ''; wrap.classList.remove('fa-invalid'); });
    return { wrap, input, set(m) { err.textContent = m || ''; wrap.classList.toggle('fa-invalid', !!m); return !m; } };
  }

  function primary(text, attrs) {
    const b = h('button', { class: 'fa-btn fa-btn-primary fa-stagger', type: 'submit', ...attrs }, h('span', { class: 'fa-btn-label' }, text), h('span', { class: 'fa-spin', 'aria-hidden': 'true' }));
    return b;
  }
  async function busy(btn, fn) {
    if (btn.dataset.busy) return;
    btn.dataset.busy = '1'; btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
    const t0 = performance.now();
    try {
      const r = await fn();
      const left = 550 - (performance.now() - t0);
      if (left > 0) await sleep(left); // let the spinner read as intentional
      return r;
    } finally {
      delete btn.dataset.busy; btn.removeAttribute('aria-busy'); btn.disabled = false;
    }
  }
  const shake = (el) => anim(el, [0, -9, 8, -6, 4, -2, 0].map((x) => ({ transform: `translateX(${x}px)` })), { duration: 460, easing: 'ease-out' });
  const banner = (kind, text, action) => h('div', { class: `fa-banner fa-banner-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    h('span', { class: 'fa-banner-ico', html: svg(kind === 'error' ? 'alert' : kind === 'demo' ? 'sparkle' : 'info', 18) }),
    h('div', { class: 'fa-banner-body' }, text, action || null));

  /* ======================================================= back-button stack
     Every layer/step pushes a history entry, so Android's back button (which
     Capacitor maps to history.back()) steps back through the flow.           */
  const layers = [];
  let swallowPops = 0, popWaiters = [];
  const pushLayer = (close) => { layers.push(close); history.pushState({ nexaAuth: layers.length }, ''); };
  addEventListener('popstate', () => {
    if (swallowPops > 0) {
      swallowPops--;
      const w = popWaiters; popWaiters = []; w.forEach((r) => r());
      return;
    }
    const close = layers.pop();
    if (close) close();
  });
  const goBack = () => { if (layers.length) history.back(); };
  /* Unwind all our history entries at once. history.go() is async, so this
     resolves once the traversal has landed — push nothing new before that. */
  const dropLayers = () => {
    const n = layers.length;
    layers.length = 0;
    if (!n) return Promise.resolve();
    swallowPops++;
    return new Promise((res) => {
      popWaiters.push(res);
      history.go(-n);
      setTimeout(res, 400); // safety net if popstate never arrives
    });
  };

  /* ============================================================ the gate */
  let gate = null; // { root, stage, current, mode }

  const brand = () => h('div', { class: 'fa-brand fa-stagger' },
    h('img', { src: './nexa-icon.svg', alt: '', width: 40, height: 40 }),
    h('span', { dir: 'ltr' }, 'NEXA ONE'));

  function screenShell({ title, sub, back, body, foot }) {
    const titleId = nid('t');
    const top = h('div', { class: 'fa-top' },
      back ? h('button', { type: 'button', class: 'fa-icon-btn', 'aria-label': 'חזרה', html: svg('back', 22), onclick: goBack }) : h('span'),
      gate && gate.mode === 'modal' ? h('button', { type: 'button', class: 'fa-icon-btn', 'aria-label': 'סגירה', html: svg('close', 22), onclick: () => closeGate() }) : h('span'));
    const el = h('section', { class: 'fa-screen', 'aria-labelledby': titleId },
      top,
      h('div', { class: 'fa-scroll' },
        h('div', { class: 'fa-inner' },
          title ? h('h1', { class: 'fa-title fa-stagger', id: titleId }, title) : null,
          sub ? h('p', { class: 'fa-sub fa-stagger' }, sub) : null,
          body,
          foot ? h('div', { class: 'fa-foot fa-stagger' }, foot) : null)));
    return el;
  }

  function show(el, dir) {
    const stage = gate.stage, prev = gate.current;
    stage.append(el);
    gate.current = el;
    const x = (dir || 0) * 36; // dir: +1 forward (enters from the left in RTL), -1 back
    if (prev) {
      const a = anim(prev, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${x * -0.6}px)` }], { duration: 220, easing: 'ease-in', fill: 'forwards' });
      if (a) a.onfinish = () => prev.remove(); else prev.remove();
    }
    anim(el, [{ opacity: 0, transform: `translateX(${-x}px)` }, { opacity: 1, transform: 'none' }], { duration: 420, delay: prev ? 120 : 0, easing: EASE, fill: 'backwards' });
    el.querySelectorAll('.fa-stagger').forEach((n, i) =>
      anim(n, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: (prev ? 160 : 260) + i * 45, easing: EASE, fill: 'backwards' }));
    if (!matchMedia('(pointer: coarse)').matches) {
      const first = el.querySelector('input');
      if (first) setTimeout(() => first.focus({ preventScroll: true }), 450);
    }
  }
  // Navigate to a sub-screen (pushes a back entry).
  function go(build) {
    const prev = gate.current;
    pushLayer(() => { if (gate) show(prev.__rebuild(), -1); });
    const el = build(); el.__rebuild = build;
    show(el, 1);
  }

  /* ---------------- screens */
  function welcomeScreen() {
    const feats = [
      ['snow', 'שליטה מלאה בקירור', 'הפעלה, יעד וקביעות מהירות'],
      ['chart', 'נתונים והיסטוריה', 'כל סשן נשמר ומחכה לכם'],
      ['shield', 'פרופיל אישי ומאובטח', 'הסיסמה מוצפנת ולא נשמרת כטקסט'],
    ];
    const el = h('section', { class: 'fa-screen fa-welcome', 'aria-label': 'ברוכים הבאים' },
      h('div', { class: 'fa-scroll' },
        h('div', { class: 'fa-inner' },
          h('div', { class: 'fa-hero fa-stagger' },
            h('div', { class: 'fa-hero-ring' }),
            h('img', { class: 'fa-hero-icon', src: './nexa-icon.svg', alt: '', width: 96, height: 96 })),
          h('p', { class: 'fa-eyebrow fa-stagger', dir: 'ltr' }, 'NEXA ONE · PRECISION COOLING'),
          h('h1', { class: 'fa-title fa-title-xl fa-stagger' }, 'ברוכים הבאים', h('br'), h('span', { class: 'fa-title-dim' }, 'לבקבוק החכם שלכם.')),
          h('ul', { class: 'fa-feats' }, feats.map(([ic, t, s]) =>
            h('li', { class: 'fa-feat fa-stagger' }, h('span', { class: 'fa-feat-ico', html: svg(ic, 20) }),
              h('span', null, h('strong', null, t), h('small', null, s))))),
          h('div', { class: 'fa-actions' },
            h('button', { type: 'button', class: 'fa-btn fa-btn-primary fa-stagger', onclick: () => go(signUpScreen) }, h('span', { class: 'fa-btn-label' }, 'יצירת חשבון')),
            h('button', { type: 'button', class: 'fa-btn fa-btn-ghost fa-stagger', onclick: () => go(signInScreen) }, 'כבר יש לי חשבון'),
            h('button', { type: 'button', class: 'fa-link fa-guest fa-stagger', onclick: continueAsGuest }, 'המשך כאורח')),
          h('p', { class: 'fa-note fa-stagger' }, provider.name === 'local' ? 'מצב הדגמה · החשבונות נשמרים במכשיר הזה בלבד' : ''))));
    return el;
  }

  function signInScreen(prefill = {}) {
    const email = field({ label: 'אימייל', type: 'email', icon: 'mail', autocomplete: 'email username', inputmode: 'email', dir: 'ltr', placeholder: 'name@example.com', value: prefill.email });
    const pw = field({ label: 'סיסמה', type: 'password', icon: 'lock', autocomplete: 'current-password', dir: 'ltr' });
    const remember = checkbox('לזכור אותי במכשיר הזה', true);
    const btn = primary('התחברות');
    const msg = h('div', { class: 'fa-msg' });
    const form = h('form', { class: 'fa-form', novalidate: true },
      msg, email.wrap, pw.wrap,
      h('div', { class: 'fa-row fa-stagger' }, remember.wrap,
        h('button', { type: 'button', class: 'fa-link', onclick: () => go(() => forgotScreen(email.value)) }, 'שכחתם סיסמה?')),
      btn);
    pw.input.setAttribute('enterkeyhint', 'go');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.replaceChildren();
      const ok = [email.set(validEmail(email.value)), pw.set(pw.value ? '' : MSG.pwReq)].every(Boolean);
      if (!ok) { shake(form); (form.querySelector('[aria-invalid="true"]') || {}).focus?.(); return; }
      try {
        const u = await busy(btn, () => provider.signIn({ email: email.value.trim(), password: pw.value }));
        await success(btn);
        setUser(u, remember.input.checked);
        closeGate(true);
        toast(`שלום שוב, ${u.name}`);
      } catch (err) {
        msg.replaceChildren(banner('error', errText(err)));
        if (err.code === 'invalid') { pw.input.value = ''; pw.input.focus(); }
        shake(form);
      }
    });
    return screenShell({
      title: 'התחברות', sub: 'שמחים לראות אתכם שוב.', back: true, body: form,
      foot: [h('span', null, 'אין לכם חשבון? '), h('button', { type: 'button', class: 'fa-link', onclick: () => replaceWith(() => signUpScreen({ email: email.value })) }, 'הרשמה')],
    });
  }

  function signUpScreen(prefill = {}) {
    const name = field({ label: 'שם', icon: 'user', autocomplete: 'name', placeholder: 'איך לקרוא לכם?', value: prefill.name });
    const email = field({ label: 'אימייל', type: 'email', icon: 'mail', autocomplete: 'email', inputmode: 'email', dir: 'ltr', placeholder: 'name@example.com', value: prefill.email });
    const pw = field({ label: 'סיסמה', type: 'password', icon: 'lock', autocomplete: 'new-password', dir: 'ltr', meter: true, hint: 'לפחות 8 תווים, כולל אות ומספר' });
    const terms = checkbox('אני מאשר/ת את תנאי השימוש ומדיניות הפרטיות', false);
    const btn = primary('יצירת חשבון');
    const msg = h('div', { class: 'fa-msg' });
    const form = h('form', { class: 'fa-form', novalidate: true }, msg, name.wrap, email.wrap, pw.wrap, terms.wrap, btn);
    pw.input.setAttribute('enterkeyhint', 'done');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.replaceChildren();
      const ok = [name.set(validName(name.value)), email.set(validEmail(email.value)), pw.set(validNewPw(pw.value)),
        terms.set(terms.input.checked ? '' : MSG.terms)].every(Boolean);
      if (!ok) { shake(form); (form.querySelector('[aria-invalid="true"]') || {}).focus?.(); return; }
      try {
        const u = await busy(btn, () => provider.signUp({ name: name.value, email: email.value, password: pw.value }));
        await success(btn);
        setUser(u, true);
        closeGate(true);
        toast(`החשבון נוצר. ברוכים הבאים, ${u.name}!`);
      } catch (err) {
        if (err.code === 'exists') {
          email.set(MSG.exists);
          msg.replaceChildren(banner('error', MSG.exists + ' ',
            h('button', { type: 'button', class: 'fa-link', onclick: () => replaceWith(() => signInScreen({ email: email.value })) }, 'להתחברות')));
        } else msg.replaceChildren(banner('error', errText(err)));
        shake(form);
      }
    });
    return screenShell({
      title: 'יצירת חשבון', sub: 'זה לוקח פחות מדקה.', back: true, body: form,
      foot: [h('span', null, 'כבר רשומים? '), h('button', { type: 'button', class: 'fa-link', onclick: () => replaceWith(() => signInScreen({ email: email.value })) }, 'התחברות')],
    });
  }

  function forgotScreen(prefillEmail) {
    const email = field({ label: 'אימייל', type: 'email', icon: 'mail', autocomplete: 'email', inputmode: 'email', dir: 'ltr', placeholder: 'name@example.com', value: prefillEmail });
    const btn = primary('שליחת קוד');
    const msg = h('div', { class: 'fa-msg' });
    const form = h('form', { class: 'fa-form', novalidate: true }, msg, email.wrap, btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.replaceChildren();
      if (!email.set(validEmail(email.value))) { shake(form); return; }
      try {
        const r = await busy(btn, () => provider.requestReset({ email: email.value.trim() }));
        go(() => resetScreen(email.value.trim(), r && r.demoCode));
      } catch (err) {
        if (err.code === 'nouser') email.set(MSG.nouser); else msg.replaceChildren(banner('error', errText(err)));
        shake(form);
      }
    });
    return screenShell({ title: 'איפוס סיסמה', sub: 'הזינו את האימייל של החשבון ונשלח אליו קוד אימות.', back: true, body: form });
  }

  function resetScreen(email, demoCode) {
    const code = field({ label: 'קוד אימות', icon: 'key', autocomplete: 'one-time-code', inputmode: 'numeric', dir: 'ltr', placeholder: '••••••', maxlength: 6 });
    code.input.classList.add('fa-code');
    code.input.addEventListener('input', () => { code.input.value = code.input.value.replace(/\D/g, '').slice(0, 6); });
    const pw = field({ label: 'סיסמה חדשה', type: 'password', icon: 'lock', autocomplete: 'new-password', dir: 'ltr', meter: true, hint: 'לפחות 8 תווים, כולל אות ומספר' });
    const btn = primary('שמירה והתחברות');
    const info = h('div', { class: 'fa-msg' });
    const showCode = (c) => info.replaceChildren(c
      ? banner('demo', h('span', null, 'מצב הדגמה — אין שליחת מיילים. הקוד שלכם: ', h('b', { class: 'fa-demo-code', dir: 'ltr' }, c)))
      : banner('info', `שלחנו קוד ל-${email}`));
    showCode(demoCode);
    const resend = h('button', { type: 'button', class: 'fa-link' }, 'שליחת קוד חדש');
    let cd = 0, timer = 0;
    const tick = () => {
      if (cd <= 0) { resend.disabled = false; resend.textContent = 'שליחת קוד חדש'; clearInterval(timer); return; }
      resend.disabled = true; resend.textContent = `שליחה חוזרת בעוד ${cd--} שנ׳`;
    };
    const startCd = () => { cd = 30; clearInterval(timer); tick(); timer = setInterval(tick, 1000); };
    startCd();
    resend.addEventListener('click', async () => {
      try { const r = await provider.requestReset({ email }); showCode(r && r.demoCode); startCd(); toast('נשלח קוד חדש', 'info'); }
      catch (err) { info.replaceChildren(banner('error', errText(err))); }
    });
    const form = h('form', { class: 'fa-form', novalidate: true }, info, code.wrap, pw.wrap, btn,
      h('div', { class: 'fa-center fa-stagger' }, resend));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ok = [code.set(/^\d{6}$/.test(code.value) ? '' : MSG.codeReq), pw.set(validNewPw(pw.value))].every(Boolean);
      if (!ok) { shake(form); return; }
      try {
        const u = await busy(btn, () => provider.confirmReset({ email, code: code.value, password: pw.value }));
        clearInterval(timer);
        await success(btn);
        setUser(u, true);
        closeGate(true);
        toast('הסיסמה עודכנה. התחברתם בהצלחה');
      } catch (err) {
        if (err.code === 'code-invalid') code.set(MSG['code-invalid']); else info.replaceChildren(banner('error', errText(err)));
        shake(form);
      }
    });
    return screenShell({ title: 'בחירת סיסמה חדשה', sub: h('span', null, 'הזינו את הקוד בן 6 הספרות שנשלח אל ', h('bdi', { dir: 'ltr' }, email)), back: true, body: form });
  }

  // Swap the current screen without adding a back entry (sign in ⇄ sign up).
  function replaceWith(build) {
    const el = build(); el.__rebuild = build;
    show(el, 1);
  }

  async function success(btn) {
    btn.classList.add('fa-done');
    btn.querySelector('.fa-btn-label').innerHTML = svg('check', 22);
    anim(btn, [{ transform: 'scale(.96)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 380, easing: EASE });
    await sleep(reduced() ? 0 : 380);
  }

  function setInert(on) {
    const root = doc.getElementById('root');
    if (!root) return;
    if (on) { root.setAttribute('inert', ''); root.setAttribute('aria-hidden', 'true'); }
    else { root.removeAttribute('inert'); root.removeAttribute('aria-hidden'); }
  }

  function openGate(mode = 'gate', first = 'welcome') {
    if (gate) return;
    const stage = h('div', { class: 'fa-stage' });
    const root = h('div', { id: 'fx-auth', class: `fa-overlay fa-${mode}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'חשבון NEXA' },
      h('div', { class: 'fa-aurora', 'aria-hidden': 'true' }), stage);
    gate = { root, stage, current: null, mode };
    doc.body.append(root);
    html.classList.add('fa-locked');
    setInert(true);
    if (mode === 'modal') {
      pushLayer(() => closeGate(false, true));
      anim(root, [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: EASE });
    }
    const build = first === 'signin' ? signInScreen : first === 'signup' ? signUpScreen : welcomeScreen;
    const el = build(); el.__rebuild = build;
    show(el, 0);
  }

  function closeGate(done, fromPop) {
    if (!gate) return;
    const g = gate;
    gate = null;
    if (!fromPop) dropLayers(); else layers.length = 0;
    html.classList.remove('fa-locked');
    setInert(false);
    const a = anim(g.root, [{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: done ? 'scale(1.04)' : 'translateY(24px)', filter: done ? 'blur(6px)' : 'blur(0)' }],
      { duration: done ? 480 : 300, easing: EASE, fill: 'forwards' });
    if (a) a.onfinish = () => g.root.remove(); else g.root.remove();
  }

  function continueAsGuest() {
    try { localStorage.setItem(K_GUEST, '1'); } catch (_) {}
    closeGate(true);
    toast('אפשר ליצור חשבון בכל רגע מאייקון הפרופיל', 'info');
  }

  /* ======================================================= account sheet */
  let sheet = null;

  function openSheet() {
    if (sheet) return;
    const panelHost = h('div', { class: 'fa-panels' });
    const card = h('div', { class: 'fa-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'החשבון שלי', tabindex: '-1' },
      h('div', { class: 'fa-grab', 'aria-hidden': 'true' }), panelHost);
    const backdrop = h('div', { class: 'fa-backdrop', onclick: () => closeSheet(false) });
    const root = h('div', { id: 'fx-account', class: 'fa-sheet-root' }, backdrop, card);
    sheet = { root, card, backdrop, panelHost, panel: null, depth: 0 };
    doc.body.append(root);
    setInert(true);
    pushLayer(() => closeSheet(true));
    anim(backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
    anim(card, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 520, easing: 'cubic-bezier(.2,1.1,.3,1)' });
    showPanel(accountPanel(), 0);
    enableDrag(card);
    setTimeout(() => card.focus({ preventScroll: true }), 50);
  }

  function closeSheet(fromPop, after) {
    if (!sheet) return;
    const s = sheet;
    sheet = null;
    const unwound = fromPop ? Promise.resolve() : dropLayers();
    if (fromPop) layers.length = 0;
    setInert(!!gate);
    anim(s.backdrop, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' });
    const from = getComputedStyle(s.card).transform;
    const a = anim(s.card, [{ transform: from === 'none' ? 'translateY(0)' : from }, { transform: 'translateY(100%)' }], { duration: 300, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    const finished = a ? a.finished.catch(() => {}) : Promise.resolve();
    Promise.all([finished, unwound]).then(() => { s.root.remove(); if (after) after(); });
  }

  function showPanel(el, dir) {
    const host = sheet.panelHost, prev = sheet.panel;
    const h0 = prev ? host.offsetHeight : 0;
    host.append(el);
    sheet.panel = el;
    if (prev) {
      prev.style.position = 'absolute'; prev.style.inset = '0 0 auto 0';
      const a = anim(prev, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${dir * 24}px)` }], { duration: 200, easing: 'ease-in', fill: 'forwards' });
      if (a) a.onfinish = () => prev.remove(); else prev.remove();
      const h1 = el.offsetHeight;
      anim(host, [{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 380, easing: EASE });
    }
    anim(el, [{ opacity: 0, transform: `translateX(${-dir * 28}px)` }, { opacity: 1, transform: 'none' }], { duration: 380, delay: prev ? 80 : 0, easing: EASE, fill: 'backwards' });
    el.querySelectorAll('.fa-stagger').forEach((n, i) =>
      anim(n, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 440, delay: (prev ? 120 : 180) + i * 40, easing: EASE, fill: 'backwards' }));
  }
  function subPanel(build) {
    const prev = sheet.panel;
    pushLayer(() => { if (sheet) showPanel(prev.__rebuild(), -1); });
    const el = build(); el.__rebuild = build;
    showPanel(el, 1);
  }

  const panelHead = (title, back) => h('div', { class: 'fa-ph' },
    back ? h('button', { type: 'button', class: 'fa-icon-btn', 'aria-label': 'חזרה', html: svg('back', 22), onclick: goBack }) : h('span', { class: 'fa-ph-sp' }),
    h('h2', { class: 'fa-ph-title' }, title),
    h('button', { type: 'button', class: 'fa-icon-btn', 'aria-label': 'סגירה', html: svg('close', 20), onclick: () => closeSheet(false) }));

  const row = (icon, title, sub, onclick, danger) => h('button', { type: 'button', class: `fa-rowbtn fa-stagger${danger ? ' fa-danger' : ''}`, onclick },
    h('span', { class: 'fa-row-ico', html: svg(icon, 20) }),
    h('span', { class: 'fa-row-txt' }, h('strong', null, title), sub ? h('small', null, sub) : null),
    danger ? null : h('span', { class: 'fa-row-chev', html: svg('chev', 18) }));

  function accountPanel() {
    const build = () => {
      if (!user) {
        return h('div', { class: 'fa-panel' }, panelHead('החשבון שלי'),
          h('div', { class: 'fa-guestcard fa-stagger' },
            h('div', { class: 'fa-avatar fa-avatar-guest', html: svg('user', 30) }),
            h('div', null, h('strong', null, 'אתם במצב אורח'), h('small', null, 'צרו חשבון כדי לקבל פרופיל אישי ומאובטח.'))),
          h('div', { class: 'fa-actions fa-actions-row' },
            h('button', { type: 'button', class: 'fa-btn fa-btn-primary fa-stagger', onclick: () => closeSheet(false, () => openGate('modal', 'signup')) }, h('span', { class: 'fa-btn-label' }, 'הרשמה')),
            h('button', { type: 'button', class: 'fa-btn fa-btn-ghost fa-stagger', onclick: () => closeSheet(false, () => openGate('modal', 'signin')) }, 'התחברות')),
          h('div', { class: 'fa-list' }, row('sliders', 'העדפות אפליקציה', 'שם לתצוגה, נתוני הדגמה, תנועה', openAppPrefs)));
      }
      const since = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' }).format(new Date(user.createdAt || Date.now()));
      return h('div', { class: 'fa-panel' }, panelHead('החשבון שלי'),
        h('div', { class: 'fa-profile fa-stagger' },
          h('div', { class: 'fa-avatar' }, initials(user.name)),
          h('div', { class: 'fa-profile-txt' },
            h('strong', null, user.name),
            h('bdi', { dir: 'ltr', class: 'fa-email' }, user.email),
            h('small', null, `חשבון מאז ${since}`))),
        h('div', { class: 'fa-list' },
          row('user', 'פרטים אישיים', 'שינוי השם שלכם', () => subPanel(editNamePanel)),
          row('key', 'שינוי סיסמה', 'מומלץ להחליף מדי פעם', () => subPanel(changePwPanel)),
          row('sliders', 'העדפות אפליקציה', 'נתוני הדגמה, הפחתת תנועה ועוד', openAppPrefs)),
        h('div', { class: 'fa-list' },
          row('logout', 'התנתקות', null, signOut, true),
          row('trash', 'מחיקת החשבון', null, () => subPanel(deletePanel), true)),
        provider.name === 'local' ? h('p', { class: 'fa-note fa-stagger' }, 'מצב הדגמה · החשבון נשמר במכשיר הזה בלבד') : null);
    };
    const el = build(); el.__rebuild = build;
    return el;
  }

  function formPanel(title, fields, btnText, onSubmit, opts = {}) {
    const btn = primary(btnText);
    if (opts.danger) btn.classList.add('fa-btn-danger');
    const msg = h('div', { class: 'fa-msg' });
    const form = h('form', { class: 'fa-form', novalidate: true }, opts.intro || null, msg, fields.map((f) => f.wrap), btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.replaceChildren();
      try { await onSubmit({ btn, msg, form }); }
      catch (err) { msg.replaceChildren(banner('error', errText(err))); shake(form); }
    });
    return h('div', { class: 'fa-panel' }, panelHead(title, true), form);
  }

  function editNamePanel() {
    const name = field({ label: 'שם', icon: 'user', autocomplete: 'name', value: user.name });
    return formPanel('פרטים אישיים', [name], 'שמירה', async ({ btn, form }) => {
      if (!name.set(validName(name.value))) { shake(form); return; }
      const u = await busy(btn, () => provider.updateProfile(user.id, { name: name.value }));
      await success(btn);
      setUser(u, !!localStorage.getItem(K_SESSION));
      goBack();
      toast('הפרטים נשמרו');
    });
  }

  function changePwPanel() {
    const cur = field({ label: 'סיסמה נוכחית', type: 'password', icon: 'lock', autocomplete: 'current-password', dir: 'ltr' });
    const next = field({ label: 'סיסמה חדשה', type: 'password', icon: 'lock', autocomplete: 'new-password', dir: 'ltr', meter: true, hint: 'לפחות 8 תווים, כולל אות ומספר' });
    return formPanel('שינוי סיסמה', [cur, next], 'עדכון סיסמה', async ({ btn, form }) => {
      const ok = [cur.set(cur.value ? '' : MSG.pwReq), next.set(validNewPw(next.value))].every(Boolean);
      if (!ok) { shake(form); return; }
      try {
        await busy(btn, () => provider.changePassword(user.id, { current: cur.value, next: next.value }));
      } catch (err) {
        if (err.code === 'wrong-current') { cur.set(MSG['wrong-current']); shake(form); return; }
        if (err.code === 'same-password') { next.set(MSG['same-password']); shake(form); return; }
        throw err;
      }
      await success(btn);
      goBack();
      toast('הסיסמה עודכנה');
    });
  }

  function deletePanel() {
    const pw = field({ label: 'הקלידו את הסיסמה לאישור', type: 'password', icon: 'lock', autocomplete: 'current-password', dir: 'ltr' });
    const intro = banner('error', 'המחיקה סופית: החשבון והפרטים שלו יימחקו מהמכשיר. היסטוריית הבקבוק והגדרות האפליקציה לא יימחקו.');
    return formPanel('מחיקת החשבון', [pw], 'מחיקה לצמיתות', async ({ btn, form }) => {
      if (!pw.set(pw.value ? '' : MSG.pwReq)) { shake(form); return; }
      try { await busy(btn, () => provider.deleteAccount(user.id, { password: pw.value })); }
      catch (err) { if (err.code === 'wrong-current') { pw.set(MSG['wrong-current']); shake(form); return; } throw err; }
      setUser(null);
      closeSheet(false, () => { openGate('gate'); toast('החשבון נמחק', 'info'); });
    }, { danger: true, intro });
  }

  function signOut() {
    setUser(null);
    closeSheet(false, () => { openGate('gate'); toast('התנתקתם מהחשבון', 'info'); });
  }

  /* ----- the app's original "profile & preferences" sheet stays reachable */
  let bypass = false;
  const PROFILE_BTN = 'header button[aria-label="פרופיל והעדפות"]';
  const findProfileBtns = () => {
    const out = Array.from(doc.querySelectorAll(PROFILE_BTN));
    for (const b of doc.querySelectorAll('aside button')) if (b.textContent.includes('פרופיל והעדפות')) out.push(b);
    return out;
  };
  function openAppPrefs() {
    const btn = findProfileBtns().find((b) => b.getClientRects().length);
    closeSheet(false, () => {
      if (!btn) return;
      bypass = true;
      try { btn.click(); } finally { bypass = false; }
    });
  }
  doc.addEventListener('click', (e) => {
    if (bypass || !e.target.closest) return;
    const b = e.target.closest('button');
    if (!b || !findProfileBtns().includes(b)) return;
    e.preventDefault();
    e.stopPropagation();
    openSheet();
  }, true);

  /* ------------------------------------------------- drag-to-dismiss sheet */
  function enableDrag(card) {
    let y0 = 0, dy = 0, t0 = 0, dragging = false;
    card.addEventListener('pointerdown', (e) => {
      const onGrab = e.target.closest('.fa-grab, .fa-ph');
      if (!onGrab || e.target.closest('button')) return;
      dragging = true; y0 = e.clientY; dy = 0; t0 = performance.now();
      card.setPointerCapture(e.pointerId);
      card.style.transition = 'none';
    });
    card.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dy = Math.max(0, e.clientY - y0);
      card.style.transform = `translateY(${dy}px)`;
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      const v = dy / Math.max(1, performance.now() - t0);
      if (dy > 110 || v > 0.6) { closeSheet(false); return; }
      card.style.transition = 'transform .35s cubic-bezier(.2,1.1,.3,1)';
      card.style.transform = '';
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
  }

  /* --------------------------------------------- keyboard: Esc + focus trap */
  doc.addEventListener('keydown', (e) => {
    const top = sheet ? sheet.card : gate ? gate.root : null;
    if (!top) return;
    if (e.key === 'Escape') {
      if (layers.length) { e.preventDefault(); goBack(); }
      return;
    }
    if (e.key !== 'Tab') return;
    const f = Array.from(top.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
      .filter((n) => n.getClientRects().length && !n.closest('[hidden]'));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ------------------------------------------------------ header avatar */
  function syncAvatar() {
    if (user) {
      html.setAttribute('data-auth', 'user');
      html.style.setProperty('--fa-initials', JSON.stringify(initials(user.name)));
    } else {
      html.setAttribute('data-auth', 'guest');
      html.style.removeProperty('--fa-initials');
    }
  }

  /* ================================================================ boot */
  async function boot() {
    syncAvatar();
    if (user && provider.exists && !(await provider.exists(user.id).catch(() => true))) setUser(null);
    if (!user && !isGuest()) openGate('gate');
  }

  window.NexaAuth = {
    get user() { return user; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    open(screen) { if (screen === 'account') openSheet(); else openGate('modal', screen || 'signin'); },
    signOut() { setUser(null); openGate('gate'); },
    /** Plug in a real backend. Must implement the LocalProvider methods. */
    useProvider(p) { provider = Object.assign({ name: 'custom' }, p); },
    AuthError,
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
