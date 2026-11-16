// A small stand-in for Supabase Auth (GoTrue) used to test nexa-supabase.js without a real project.
// It follows the documented behaviour of the endpoints the app uses; it is NOT Supabase itself.
//   node test/mock-supabase.mjs [port] [--no-confirm] [--ttl=seconds]
// Test hooks: GET /__confirm/<email>  GET /__codes/<email>  GET /__log  GET /__drop/<email>  POST /__config
import http from 'node:http';
import crypto from 'node:crypto';

const port = Number(process.argv[2]) || 8790;
const state = { confirm: !process.argv.includes('--no-confirm'), ttl: Number((process.argv.find((a) => a.startsWith('--ttl=')) || '--ttl=3600').slice(6)) };
const ANON = 'test.anon.key';
const users = new Map(), tokens = new Map(), refresh = new Map(), codes = new Map(), log = [];
const id = () => crypto.randomUUID();
const publicUser = (u) => ({ id: u.id, email: u.email, created_at: u.created_at, user_metadata: u.meta, identities: [{ id: u.id }], email_confirmed_at: u.confirmed ? u.created_at : null });
const session = (u) => {
  const at = 'at-' + id(), rt = 'rt-' + id();
  tokens.set(at, { uid: u.id, exp: Date.now() + state.ttl * 1000 }); refresh.set(rt, u.id);
  return { access_token: at, refresh_token: rt, token_type: 'bearer', expires_in: state.ttl, user: publicUser(u) };
};
const userFor = (req) => {
  const t = tokens.get((req.headers.authorization || '').replace('Bearer ', ''));
  if (!t || t.exp < Date.now()) return null;
  return [...users.values()].find((u) => u.id === t.uid) || null;
};
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
const err = (res, code, error_code, msg) => send(res, code, { code, error_code, msg });

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'apikey, authorization, content-type, x-client-info');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://x');
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch (_) {}
    const p = url.pathname;
    log.push(`${req.method} ${p}${url.search}`);
    // --- test hooks
    if (p.startsWith('/__confirm/')) { const u = users.get(decodeURIComponent(p.slice(11))); if (u) u.confirmed = true; return send(res, 200, {}); }
    if (p.startsWith('/__codes/')) return send(res, 200, { code: codes.get(decodeURIComponent(p.slice(9))) || null });
    if (p.startsWith('/__drop/')) { const u = users.get(decodeURIComponent(p.slice(8))); if (u) users.delete(u.email); return send(res, 200, {}); }
    if (p === '/__log') return send(res, 200, log);
    if (p === '/__config') { Object.assign(state, body); return send(res, 200, state); }
    if (req.headers.apikey !== ANON) return err(res, 401, 'no_authorization', 'Invalid API key');

    if (p === '/auth/v1/signup' && req.method === 'POST') {
      const email = String(body.email || '').toLowerCase();
      if (!/.+@.+\..+/.test(email) || !body.password || body.password.length < 6) return err(res, 422, 'weak_password', 'Password should be at least 6 characters.');
      const exists = users.get(email);
      if (exists) {
        if (state.confirm) return send(res, 200, { ...publicUser(exists), identities: [] });          // obfuscated, as Supabase does
        return err(res, 422, 'user_already_exists', 'User already registered');
      }
      const u = { id: id(), email, pw: body.password, meta: body.data || {}, confirmed: !state.confirm, created_at: new Date().toISOString() };
      users.set(email, u);
      return send(res, 200, state.confirm ? publicUser(u) : session(u));
    }
    if (p === '/auth/v1/token' && req.method === 'POST') {
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const uid = refresh.get(body.refresh_token); const u = [...users.values()].find((x) => x.id === uid);
        if (!u) return err(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token');
        refresh.delete(body.refresh_token); return send(res, 200, session(u));
      }
      const u = users.get(String(body.email || '').toLowerCase());
      if (!u || u.pw !== body.password) return err(res, 400, 'invalid_credentials', 'Invalid login credentials');
      if (!u.confirmed) return err(res, 400, 'email_not_confirmed', 'Email not confirmed');
      return send(res, 200, session(u));
    }
    if (p === '/auth/v1/user') {
      const u = userFor(req); if (!u) return err(res, 401, 'bad_jwt', 'invalid JWT');
      if (req.method === 'GET') return send(res, 200, publicUser(u));
      if (req.method === 'PUT') {
        if (body.password) { if (body.password === u.pw) return err(res, 422, 'same_password', 'New password should be different from the old password.'); u.pw = body.password; }
        if (body.data) u.meta = { ...u.meta, ...body.data };
        return send(res, 200, publicUser(u));
      }
    }
    if (p === '/auth/v1/recover' && req.method === 'POST') {
      const email = String(body.email || '').toLowerCase();
      if (users.has(email)) codes.set(email, String(crypto.randomInt(0, 1000000)).padStart(6, '0'));
      return send(res, 200, {});                                                                 // same answer for unknown e-mails
    }
    if (p === '/auth/v1/verify' && req.method === 'POST') {
      const email = String(body.email || '').toLowerCase(); const u = users.get(email);
      if (!u || codes.get(email) !== body.token) return err(res, 403, 'otp_expired', 'Token has expired or is invalid');
      codes.delete(email); u.confirmed = true; return send(res, 200, session(u));
    }
    if (p === '/auth/v1/logout' && req.method === 'POST') { tokens.delete((req.headers.authorization || '').replace('Bearer ', '')); return send(res, 204); }
    if (p === '/rest/v1/rpc/delete_my_account' && req.method === 'POST') {
      const u = userFor(req); if (!u) return err(res, 401, 'bad_jwt', 'invalid JWT');
      users.delete(u.email); return send(res, 200, null);
    }
    err(res, 404, 'not_found', 'not found');
  });
}).listen(port, () => console.log(`mock supabase on :${port} (confirm email: ${state.confirm}, token ttl ${state.ttl}s)`));
