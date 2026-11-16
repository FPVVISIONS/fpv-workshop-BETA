/* ==========================================================================
   NEXA SUPABASE — real accounts for NEXA ONE (Supabase Auth over plain fetch)

   Active only when nexa-config.js sets both values:
       window.NEXA_SUPABASE = { url: 'https://xxxx.supabase.co', anonKey: 'eyJ…' };
   Otherwise this file does nothing and the app keeps its on-device demo accounts.

   Only the PUBLIC "anon" key belongs here. Never put the service_role key in an app.

   Uses the Supabase Auth (GoTrue) REST API directly, so there is no library to bundle:
     sign up        POST /auth/v1/signup
     sign in        POST /auth/v1/token?grant_type=password
     refresh        POST /auth/v1/token?grant_type=refresh_token
     reset          POST /auth/v1/recover  → e-mail with a code → POST /auth/v1/verify → PUT /auth/v1/user
     profile        PUT  /auth/v1/user     (name in user_metadata, password)
     delete         POST /rest/v1/rpc/delete_my_account   (SQL function, see supabase/setup.sql)
     sign out       POST /auth/v1/logout
   ========================================================================== */
(() => {
  'use strict';
  const cfg = window.NEXA_SUPABASE || {};
  if (!cfg.url || !cfg.anonKey || !window.NexaAuth) return;

  const BASE = String(cfg.url).replace(/\/+$/, '');
  const KEY = cfg.anonKey;
  const K_TOK = 'nexa-supabase:tokens';
  const { AuthError } = window.NexaAuth;

  /* ------------------------------------------------------------- tokens */
  let tokens = (() => { try { return JSON.parse(localStorage.getItem(K_TOK)); } catch (_) { return null; } })();
  const saveTokens = (t) => {
    tokens = t && t.access_token ? { access: t.access_token, refresh: t.refresh_token, exp: Date.now() + (t.expires_in || 3600) * 1000 } : null;
    try { tokens ? localStorage.setItem(K_TOK, JSON.stringify(tokens)) : localStorage.removeItem(K_TOK); } catch (_) {}
  };

  /* ---------------------------------------------------------------- http */
  async function call(path, { method = 'GET', body, auth } = {}) {
    const headers = { apikey: KEY, 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = `Bearer ${auth}`;
    let res;
    try {
      res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (_) {
      throw new AuthError('network');
    }
    let json = null;
    try { json = await res.json(); } catch (_) { /* empty body */ }
    return { ok: res.ok, status: res.status, json: json || {} };
  }
  const errInfo = (r) => {
    const j = r.json || {};
    return `${j.error_code || ''} ${j.error || ''} ${j.msg || j.error_description || j.message || ''}`.toLowerCase();
  };

  /** Throws the right AuthError for a failed GoTrue response. */
  function fail(r, ctx) {
    const t = errInfo(r);
    if (r.status === 429 || t.includes('rate_limit') || t.includes('rate limit')) throw new AuthError('locked', { wait: 60 });
    if (t.includes('not confirmed') || t.includes('email_not_confirmed')) throw new AuthError('unconfirmed');
    if (t.includes('already') && (t.includes('registered') || t.includes('exists'))) throw new AuthError('exists');
    if (ctx === 'signin' && (r.status === 400 || r.status === 401 || t.includes('invalid'))) throw new AuthError('invalid');
    if (ctx === 'verify' && (r.status === 400 || r.status === 401 || r.status === 403 || t.includes('expired') || t.includes('invalid'))) {
      // Supabase says "Token has expired or is invalid" for both a wrong and an old code.
      throw new AuthError(t.includes('invalid') ? 'code-invalid' : 'code-expired');
    }
    if (ctx === 'recover' && r.status === 404) throw new AuthError('nouser');
    if (r.status >= 500) throw new AuthError('network');
    throw new AuthError('generic');
  }

  const toUser = (u) => ({
    id: u.id,
    name: (u.user_metadata && (u.user_metadata.name || u.user_metadata.full_name)) || (u.email || '').split('@')[0],
    email: u.email,
    createdAt: u.created_at ? Date.parse(u.created_at) : Date.now(),
  });

  /** A valid access token, refreshing it when it is about to expire. */
  async function accessToken() {
    if (!tokens) throw new AuthError('nouser');
    if (tokens.exp - Date.now() > 30000) return tokens.access;
    const r = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: tokens.refresh } });
    if (!r.ok) { if (r.status === 400 || r.status === 401) { saveTokens(null); throw new AuthError('nouser'); } throw new AuthError('network'); }
    saveTokens(r.json);
    return tokens.access;
  }

  /* ------------------------------------------------------------ provider */
  const provider = {
    name: 'supabase',

    async signUp({ name, email, password }) {
      const r = await call('/auth/v1/signup', { method: 'POST', body: { email: email.trim(), password, data: { name: name.trim() } } });
      if (!r.ok) fail(r, 'signup');
      const j = r.json;
      // E-mail already registered: with confirmation on, Supabase hides it by returning a user with no identities.
      if (j.user ? (j.user.identities && j.user.identities.length === 0) : (j.identities && j.identities.length === 0)) throw new AuthError('exists');
      if (!j.access_token) throw new AuthError('confirm');             // confirmation e-mail sent, no session yet
      saveTokens(j);
      return toUser(j.user);
    },

    async signIn({ email, password }) {
      const r = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: email.trim(), password } });
      if (!r.ok) fail(r, 'signin');
      saveTokens(r.json);
      return toUser(r.json.user);
    },

    async requestReset({ email }) {
      const r = await call('/auth/v1/recover', { method: 'POST', body: { email: email.trim() } });
      if (!r.ok) fail(r, 'recover');
      return {};                                                       // the code arrives by e-mail (no demoCode)
    },

    async confirmReset({ email, code, password }) {
      const v = await call('/auth/v1/verify', { method: 'POST', body: { type: 'recovery', email: email.trim(), token: String(code) } });
      if (!v.ok || !v.json.access_token) fail(v, 'verify');
      saveTokens(v.json);
      const u = await call('/auth/v1/user', { method: 'PUT', auth: v.json.access_token, body: { password } });
      if (!u.ok) { saveTokens(null); fail(u, 'update'); }
      return toUser(u.json);
    },

    async updateProfile(_id, { name }) {
      const u = await call('/auth/v1/user', { method: 'PUT', auth: await accessToken(), body: { data: { name: name.trim() } } });
      if (!u.ok) fail(u, 'update');
      return toUser(u.json);
    },

    async changePassword(_id, { current, next }) {
      const me = await call('/auth/v1/user', { auth: await accessToken() });
      if (!me.ok) fail(me, 'update');
      const chk = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: me.json.email, password: current } });
      if (!chk.ok) { if (chk.status === 400 || chk.status === 401) throw new AuthError('wrong-current'); fail(chk, 'update'); }
      saveTokens(chk.json);
      if (current === next) throw new AuthError('same-password');
      const u = await call('/auth/v1/user', { method: 'PUT', auth: tokens.access, body: { password: next } });
      if (!u.ok) {
        if (errInfo(u).includes('same')) throw new AuthError('same-password');
        fail(u, 'update');
      }
    },

    async deleteAccount(_id, { password }) {
      const me = await call('/auth/v1/user', { auth: await accessToken() });
      if (!me.ok) fail(me, 'update');
      const chk = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: me.json.email, password } });
      if (!chk.ok) { if (chk.status === 400 || chk.status === 401) throw new AuthError('wrong-current'); fail(chk, 'update'); }
      saveTokens(chk.json);
      const d = await call('/rest/v1/rpc/delete_my_account', { method: 'POST', auth: tokens.access, body: {} });
      if (!d.ok) throw new AuthError('generic');
      saveTokens(null);
    },

    /** false only when the server says this session is really gone; network problems keep the user signed in. */
    async exists() {
      if (!tokens) return false;
      const r = await call('/auth/v1/user', { auth: await accessToken() });
      if (r.ok) return true;
      if (r.status === 401 || r.status === 403 || r.status === 404) { saveTokens(null); return false; }
      throw new AuthError('network');
    },

    async signOut() {
      const t = tokens && tokens.access;
      saveTokens(null);
      if (t) { try { await call('/auth/v1/logout', { method: 'POST', auth: t }); } catch (_) { /* offline: tokens are already gone locally */ } }
    },
  };

  window.NexaAuth.useProvider(provider);
})();
