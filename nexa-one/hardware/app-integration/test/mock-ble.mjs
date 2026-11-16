// MOCK of @capacitor-community/bluetooth-le for tests only — not the real plugin.
// Fake BLE bottle for testing BleBottle: runs the protocol like the firmware would.
const enc = (arr) => new DataView(new Uint8Array(arr).buffer);
const le16 = (v) => [v & 255, (v >> 8) & 255], le32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
const dev = { on: false, target: 8, water: 20.0, saver: false, sessions: [], uptime: 5000 };
let stateCb, sessCb, dropCb;
const state = () => enc([1, (dev.on ? 1 : 0) | (dev.saver ? 4 : 0), dev.on ? 1 : 0, ...le16(Math.round(dev.water * 10)), dev.target, 70, 98, ...le16(300), dev.sessions.length, 0]);
export const BleClient = {
  calls: [],
  async initialize() {}, async isEnabled() { return true; }, async requestEnable() {},
  async requestDevice(o) { this.calls.push(['requestDevice', o.services[0]]); return { deviceId: 'AA:BB' }; },
  async connect(id, onDis) { dropCb = onDis; this.calls.push(['connect', id]); },
  async disconnect() { this.calls.push(['disconnect']); },
  async startNotifications(id, s, c, cb) { if (c.startsWith('8b6f0002')) stateCb = cb; else if (c.startsWith('8b6f0004')) sessCb = cb; },
  async read() { return state(); },
  async write(id, s, c, dv) {
    const op = dv.getUint8(0), arg = dv.byteLength > 1 ? dv.getUint8(1) : 0;
    this.calls.push(['write', op, arg]);
    if (op === 1) { if (arg && !dev.on) { dev.on = true; dev.start = dev.uptime; } else if (!arg && dev.on) { dev.on = false; dev.sessions.push([dev.start, dev.uptime, 200, 90, 88, dev.target, 80, 70, 0 | (0 << 4), 1]); } stateCb(state()); }
    if (op === 2) { dev.target = Math.max(5, Math.min(15, arg)); stateCb(state()); }
    if (op === 0x10) { for (const s of dev.sessions) sessCb(enc([1, ...le32(s[0]), ...le32(s[1]), ...le16(s[2]), ...le16(s[3]), ...le16(s[4]), s[5], s[6], s[7], s[8], s[9]])); sessCb(enc([0xff, ...le32(dev.uptime), dev.sessions.length])); }
    if (op === 0x11) dev.sessions.splice(0, arg);
  },
  _tick(sec, water) { dev.uptime += sec; dev.water = water; stateCb(state()); },
  _drop() { dropCb(); }, _dev: dev,
};
