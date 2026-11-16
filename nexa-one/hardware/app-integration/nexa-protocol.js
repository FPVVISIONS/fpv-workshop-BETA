// NEXA ONE Bluetooth protocol v1 — app side.
// Must match firmware/nexa_one/nexa_core.h (namespace nexa::proto).
// All multi-byte values are little-endian; every packet is ≤ 20 bytes.

export const UUID = {
  service: '8b6f0001-6e65-7861-a1b2-00004e455841',
  state: '8b6f0002-6e65-7861-a1b2-00004e455841', // read + notify (12 bytes)
  control: '8b6f0003-6e65-7861-a1b2-00004e455841', // write
  sessions: '8b6f0004-6e65-7861-a1b2-00004e455841', // notify
};

export const OP = { SET_COOLING: 0x01, SET_TARGET: 0x02, SET_SAVER: 0x03, SEND_SESSIONS: 0x10, ACK_SESSIONS: 0x11, IDENTIFY: 0x20 };
export const PHASES = ['off', 'cooling', 'holding'];
export const ACTORS = ['app', 'bottle', 'battery', 'fault'];
const NO_READING = -32768; // INT16_MIN = sensor missing

const temp = (dv, o) => { const v = dv.getInt16(o, true); return v === NO_READING ? null : v / 10; };

/** STATE characteristic → plain object. */
export function decodeState(dv) {
  if (dv.byteLength < 12) throw new Error(`state packet too short (${dv.byteLength})`);
  const flags = dv.getUint8(1);
  return {
    version: dv.getUint8(0),
    coolingOn: !!(flags & 1),
    charging: !!(flags & 2),
    batterySaver: !!(flags & 4),
    overheat: !!(flags & 8),
    sensorFault: !!(flags & 16),
    pairing: !!(flags & 32),
    phase: PHASES[dv.getUint8(2)] || 'off',
    waterTemp: temp(dv, 3),
    target: dv.getUint8(5),
    battery: dv.getUint8(6),
    health: dv.getUint8(7),
    hotSideTemp: temp(dv, 8),
    pendingSessions: dv.getUint8(10),
  };
}

/** SESSIONS notification → a session record or the end-of-batch marker. */
export function decodeSessionPacket(dv) {
  const type = dv.getUint8(0);
  if (type === 0xff) return { type: 'end', uptimeNow: dv.getUint32(1, true), count: dv.getUint8(5) };
  if (type !== 0x01 || dv.byteLength < 20) throw new Error('unknown session packet');
  const by = dv.getUint8(18);
  return {
    type: 'session',
    startS: dv.getUint32(1, true),
    endS: dv.getUint32(5, true),
    startTemp: temp(dv, 9),
    endTemp: temp(dv, 11),
    minTemp: temp(dv, 13),
    target: dv.getUint8(15),
    batteryStart: dv.getUint8(16),
    batteryEnd: dv.getUint8(17),
    startedBy: ACTORS[by & 0x0f] || 'bottle',
    endedBy: ACTORS[by >> 4] || 'bottle',
    seq: dv.getUint8(19),
  };
}

/**
 * Bottle record → the app's session shape (same fields the simulator writes).
 * The bottle has no real-time clock: it stamps uptime seconds and tells us its
 * uptime "now", so clock time = nowMs − (uptimeNow − stamp) × 1000.
 */
export function toAppSession(rec, uptimeNow, nowMs = Date.now()) {
  const at = (s) => nowMs - (uptimeNow - s) * 1000;
  const startedAt = Math.round(at(rec.startS));
  const endedAt = Math.round(at(rec.endS));
  return {
    id: `bottle-${Math.round(startedAt / 1000)}-${rec.seq}`,
    origin: 'bottle',
    startedAt,
    endedAt,
    startTemp: rec.startTemp,
    endTemp: rec.endTemp,
    minTemp: rec.minTemp,
    target: rec.target,
    batteryStart: rec.batteryStart,
    batteryEnd: rec.batteryEnd,
    batteryUsed: Math.max(0, rec.batteryStart - rec.batteryEnd),
    startedBy: rec.startedBy === 'app' ? 'app' : 'bottle',
    // The app's UI knows app / bottle / battery; a safety stop shows as "bottle".
    endedBy: rec.endedBy === 'fault' ? 'bottle' : rec.endedBy,
    endedByFault: rec.endedBy === 'fault',
    // Only start/end points come from the bottle; the live chart is recorded
    // by the app while connected (see ble-transport.js).
    samples: [{ t: startedAt, temp: rec.startTemp }, { t: endedAt, temp: rec.endTemp }],
  };
}

const bytes = (...b) => new Uint8Array(b);
export const cmd = {
  setCooling: (on) => bytes(OP.SET_COOLING, on ? 1 : 0),
  setTarget: (c) => bytes(OP.SET_TARGET, Math.max(5, Math.min(15, Math.round(c)))),
  setSaver: (on) => bytes(OP.SET_SAVER, on ? 1 : 0),
  sendSessions: () => bytes(OP.SEND_SESSIONS),
  ackSessions: (n) => bytes(OP.ACK_SESSIONS, Math.max(0, Math.min(255, n))),
  identify: () => bytes(OP.IDENTIFY),
};
