// Decodes the fixtures written by firmware/test/test_core.cpp and checks
// every field, proving firmware and app agree byte-for-byte.
//   node test-protocol.mjs ../firmware/test/fixtures.json
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { decodeState, decodeSessionPacket, toAppSession, cmd, OP } from './nexa-protocol.js';

const fx = JSON.parse(readFileSync(process.argv[2] || '../firmware/test/fixtures.json', 'utf8'));
const dv = (hex) => { const b = Buffer.from(hex, 'hex'); return new DataView(b.buffer, b.byteOffset, b.byteLength); };
let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const s = decodeState(dv(fx.state));
eq(s, { version: 1, coolingOn: true, charging: false, batterySaver: true, overheat: false, sensorFault: false, pairing: true,
  phase: 'cooling', waterTemp: 18.4, target: 8, battery: 76, health: 94, hotSideTemp: 41.3, pendingSessions: 3 }, 'state');

const f = decodeState(dv(fx.stateFault));
eq([f.charging, f.sensorFault, f.phase, f.waterTemp, f.hotSideTemp, f.target, f.battery], [true, true, 'off', null, -3.5, 15, 100], 'fault state');

const r = decodeSessionPacket(dv(fx.session));
eq(r, { type: 'session', startS: 123456, endS: 127056, startTemp: 21.4, endTemp: 9.9, minTemp: 9.7, target: 10,
  batteryStart: 90, batteryEnd: 84, startedBy: 'bottle', endedBy: 'battery', seq: 7 }, 'session record');

const e = decodeSessionPacket(dv(fx.end));
eq(e, { type: 'end', uptimeNow: 200000, count: 1 }, 'end marker');

const now = Date.UTC(2026, 10, 16, 12, 0, 0);
const app = toAppSession(r, e.uptimeNow, now);
eq(app.endedAt, now - (200000 - 127056) * 1000, 'uptime → clock time');
eq(app.endedAt - app.startedAt, 3600 * 1000, 'session lasted one hour');
eq([app.origin, app.startedBy, app.endedBy, app.batteryUsed, app.samples.length], ['bottle', 'bottle', 'battery', 6, 2], 'app session shape');

eq([...cmd.setTarget(40)], [OP.SET_TARGET, 15], 'target clamps high');
eq([...cmd.setTarget(2)], [OP.SET_TARGET, 5], 'target clamps low');
eq([...cmd.setCooling(true)], [OP.SET_COOLING, 1], 'cooling on');
console.log(`protocol: ${n} checks passed (firmware fixtures decoded correctly)`);
