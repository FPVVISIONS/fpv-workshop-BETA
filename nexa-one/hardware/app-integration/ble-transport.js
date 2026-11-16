// =============================================================================
//  BleBottle — talks to a real NEXA ONE bottle over Bluetooth LE.
//
//  Drop-in replacement for the app's simulator (`class LV`, `kind:
//  "simulator"`): same snapshot shape and the same methods the UI calls
//  (connect, disconnect, setCooling, setTarget, setBatterySaver, getBottle,
//  subscribe/getSnapshot, deleteAllSessions, pressPhysicalSwitch).
//
//  Needs the Capacitor plugin (native code, so it must be added to the app's
//  SOURCE project — it can't be patched into a built APK):
//    npm i @capacitor-community/bluetooth-le && npx cap sync android
//  Then, where the app creates its bottle store:
//    - const store = new SimulatorBottle();
//    + const store = new BleBottle();           // or pick by a setting
// =============================================================================
import { BleClient } from '@capacitor-community/bluetooth-le';
import { UUID, decodeState, decodeSessionPacket, toAppSession, cmd } from './nexa-protocol.js';

const KEY = 'nexa-one:ble:v1';
const SAMPLE_EVERY_MS = 5000; // same as the simulator (kt.sampleEveryMs)
const MAX_SAMPLES = 240;
const RETRY_MS = [2000, 5000, 10000, 20000, 30000];

const MSG = {
  notFound: 'לא מצאנו את הבקבוק. ודאו שסמל ה-Bluetooth בצג מהבהב ונסו שוב.',
  btOff: 'ה-Bluetooth כבוי. הפעילו אותו ונסו שוב.',
  noPermission: 'בלי הרשאת "מכשירים בקרבת מקום" אי אפשר למצוא את הבקבוק.',
  lost: 'הבקבוק לא הגיב בזמן. ודאו שהוא קרוב ונסו שוב.',
};

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const toView = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

export class BleBottle {
  kind = 'ble';
  connection = 'disconnected';
  connectionError = null;
  listeners = new Set();
  state = null;            // last decoded STATE packet
  active = null;           // live session being charted while connected
  inbox = [];              // session records arriving during a sync
  syncing = false;
  retry = 0;
  retryTimer = null;

  constructor() {
    const saved = load();
    this.link = { deviceId: saved.deviceId || null, paired: !!saved.deviceId, wantConnected: !!saved.wantConnected, sessions: saved.sessions || [] };
    this.rebuild();
    if (this.link.wantConnected && this.link.deviceId) this.connect();
  }

  // ------------------------------------------------------------ store API
  getSnapshot = () => this.snapshot;
  subscribe = (fn) => (this.listeners.add(fn), () => this.listeners.delete(fn));

  connect = async () => {
    if (this.connection !== 'disconnected') return;
    clearTimeout(this.retryTimer);
    this.connection = 'connecting';
    this.connectionError = null;
    this.link.wantConnected = true;
    this.changed();
    try {
      await BleClient.initialize({ androidNeverForLocation: true }); // asks for "Nearby devices"
      if (!(await BleClient.isEnabled())) {
        try { await BleClient.requestEnable(); } catch { throw Object.assign(new Error('bt-off'), { code: 'btOff' }); }
      }
      let id = this.link.deviceId;
      if (!id) {
        // First time: the system picker lists bottles in pairing mode.
        const dev = await BleClient.requestDevice({ services: [UUID.service], namePrefix: 'NEXA' });
        id = dev.deviceId;
      }
      await BleClient.connect(id, () => this.onDropped(), { timeout: 10000 });
      await BleClient.startNotifications(id, UUID.service, UUID.state, (dv) => this.onState(dv));
      await BleClient.startNotifications(id, UUID.service, UUID.sessions, (dv) => this.onSessionPacket(dv));
      this.deviceId = id;
      this.link.deviceId = id;
      this.link.paired = true;
      this.connection = 'connected';
      this.retry = 0;
      this.onState(await BleClient.read(id, UUID.service, UUID.state));
      this.syncSessions();
    } catch (e) {
      this.connection = 'disconnected';
      const msg = String((e && e.message) || e);
      if (/cancel/i.test(msg)) this.connectionError = null;               // user closed the picker
      else if (e && e.code === 'btOff') this.connectionError = MSG.btOff;
      else if (/permission|denied/i.test(msg)) this.connectionError = MSG.noPermission;
      else if (!this.link.deviceId) this.connectionError = MSG.notFound;
      else { this.connectionError = MSG.lost; this.scheduleRetry(); }
      if (!this.link.deviceId || /cancel|permission|denied/i.test(msg)) this.link.wantConnected = false;
      this.changed();
    }
  };

  disconnect = async () => {
    this.link.wantConnected = false;
    clearTimeout(this.retryTimer);
    const id = this.deviceId;
    this.connection = 'disconnected';
    this.connectionError = null;
    this.changed();
    if (id) { try { await BleClient.disconnect(id); } catch { /* already gone */ } }
  };

  /** Forget the bottle (e.g. after a factory reset of the bottle). */
  forget = async () => { await this.disconnect(); this.link.deviceId = null; this.link.paired = false; this.changed(); };

  setCooling = (on) => this.send(cmd.setCooling(on));
  setTarget = (c) => this.send(cmd.setTarget(c));
  setBatterySaver = (on) => this.send(cmd.setSaver(on));
  identify = () => this.send(cmd.identify());
  pressPhysicalSwitch = () => this.setCooling(!(this.state && this.state.coolingOn));
  deleteAllSessions = () => { this.link.sessions = []; this.changed(); };

  getBottle = () => {
    const s = this.state || {};
    return {
      coolingOn: !!s.coolingOn, phase: s.phase || 'off', waterTemp: s.waterTemp ?? NaN, target: s.target ?? 8,
      battery: s.battery ?? 0, charging: !!s.charging, batterySaver: !!s.batterySaver, at: this.stateAt || Date.now(),
      ambient: null, health: s.health ?? 100, session: this.active,
      // Extra fields a real bottle has (the simulator doesn't):
      hotSideTemp: s.hotSideTemp ?? null, overheat: !!s.overheat, sensorFault: !!s.sensorFault,
    };
  };

  // Simulator-only tools: no-ops on real hardware (hide them in the UI when kind !== 'simulator').
  setChargerConnected = () => {};
  drainBattery = () => {};
  setFailNextConnect = () => {};
  resetSimulator = () => {};
  get failNextConnect() { return false; }

  // ------------------------------------------------------------ internals
  async send(bytes) {
    if (this.connection !== 'connected') return;
    try { await BleClient.write(this.deviceId, UUID.service, UUID.control, toView(bytes)); }
    catch { /* a drop is handled by onDropped */ }
  }

  onState(dv) {
    const prev = this.state;
    this.state = decodeState(dv);
    this.stateAt = Date.now();
    const s = this.state;
    // Build the live chart for the current cooling run.
    if (s.coolingOn && !this.active && s.waterTemp != null) {
      this.active = { id: `live-${this.stateAt}`, startedAt: this.stateAt, startTemp: s.waterTemp, startBattery: s.battery, startedBy: 'bottle', samples: [{ t: this.stateAt, temp: s.waterTemp }] };
    } else if (this.active && s.coolingOn && s.waterTemp != null && this.stateAt - this.active.samples.at(-1).t >= SAMPLE_EVERY_MS) {
      this.active.samples.push({ t: this.stateAt, temp: s.waterTemp });
      if (this.active.samples.length > MAX_SAMPLES) this.active.samples = this.active.samples.filter((_, i, a) => i % 2 === 0 || i === a.length - 1);
    }
    if (prev && prev.coolingOn && !s.coolingOn) {
      // The run just ended: keep our detailed chart for the record the bottle sends.
      this.lastSamples = this.active ? this.active.samples : null;
      this.active = null;
    }
    if (s.pendingSessions > 0 && !this.syncing) this.syncSessions();
    this.changed();
  }

  syncSessions() {
    if (this.syncing || this.connection !== 'connected') return;
    this.syncing = true;
    this.inbox = [];
    this.send(cmd.sendSessions());
    setTimeout(() => { this.syncing = false; }, 5000); // safety net if the end marker is lost
  }

  onSessionPacket(dv) {
    const p = decodeSessionPacket(dv);
    if (p.type === 'session') { this.inbox.push(p); return; }
    const now = Date.now();
    const fresh = this.inbox.map((r) => toAppSession(r, p.uptimeNow, now));
    // Attach the live-recorded chart to the newest run if it matches.
    const newest = fresh.at(-1);
    if (newest && this.lastSamples && Math.abs(this.lastSamples[0].t - newest.startedAt) < 60000) {
      newest.samples = [...this.lastSamples, { t: newest.endedAt, temp: newest.endTemp }];
      this.lastSamples = null;
    }
    const byId = new Map(this.link.sessions.map((s) => [s.id, s]));
    fresh.forEach((s) => byId.set(s.id, s));
    this.link.sessions = [...byId.values()].sort((a, b) => b.startedAt - a.startedAt);
    if (p.count) this.send(cmd.ackSessions(p.count));   // bottle may now delete them
    this.inbox = [];
    this.syncing = false;
    this.changed();
  }

  onDropped() {
    this.connection = 'disconnected';
    this.active = null;
    this.changed();
    if (this.link.wantConnected) this.scheduleRetry();
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    const wait = RETRY_MS[Math.min(this.retry++, RETRY_MS.length - 1)];
    this.retryTimer = setTimeout(() => { if (this.link.wantConnected) this.connect(); }, wait);
  }

  rebuild() {
    const s = this.state;
    this.snapshot = {
      connection: this.connection,
      connectionError: this.connectionError,
      paired: this.link.paired,
      reading: s && this.connection === 'connected'
        ? { coolingOn: s.coolingOn, phase: s.phase, waterTemp: s.waterTemp, target: s.target, battery: s.battery, charging: s.charging, batterySaver: s.batterySaver, at: this.stateAt }
        : (this.snapshot && this.snapshot.reading) || null,
      activeSession: this.active ? { ...this.active, samples: [...this.active.samples] } : null,
      sessions: this.link.sessions,
      pendingSync: s ? s.pendingSessions : 0,
    };
  }

  changed() {
    try { localStorage.setItem(KEY, JSON.stringify({ deviceId: this.link.deviceId, wantConnected: this.link.wantConnected, sessions: this.link.sessions })); } catch { /* storage full */ }
    this.rebuild();
    this.listeners.forEach((fn) => fn());
  }
}
