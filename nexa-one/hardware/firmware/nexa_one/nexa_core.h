// =============================================================================
//  NEXA ONE firmware — core logic (no Arduino / hardware dependencies)
//
//  Everything that decides *what* the bottle does lives here so it can be
//  unit-tested on a PC (see ../test/test_core.cpp). nexa_one.ino only wires
//  this to pins, sensors, the display and Bluetooth.
//
//  The behaviour mirrors the app's built-in simulator so the app needs no
//  UI changes: target 5–15 °C in whole degrees, ±0.2 °C "holding" band,
//  phases off / cooling / holding, battery-saver = 60 % power, sessions
//  started/ended by app, bottle (physical switch) or an empty battery.
// =============================================================================
#pragma once
#include <stdint.h>
#include <string.h>
#include <math.h>

namespace nexa {

// ----------------------------------------------------------------- limits
constexpr int    TARGET_MIN      = 5;      // °C  (app: 5–15)
constexpr int    TARGET_MAX      = 15;
constexpr int    TARGET_DEFAULT  = 8;
constexpr float  HOLD_BAND       = 0.2f;   // °C  (app: kt.holdBand)
constexpr float  SAVER_FACTOR    = 0.6f;   // app: kt.saverPowerFactor
constexpr float  HOT_SIDE_TRIP   = 65.0f;  // °C  heatsink over-temperature → stop
constexpr float  HOT_SIDE_RESET  = 45.0f;  // °C  may restart below this
constexpr float  DERATE_START    = 52.0f;  // °C  heatsink above this → power is reduced smoothly…
constexpr float  DERATE_END      = 62.0f;  // °C  …to zero here (so the trip above is a last resort)
constexpr float  FAN_ON_ABOVE    = 40.0f;  // °C  the fan runs whenever the heatsink is warmer than this
constexpr float  WATER_MIN_VALID = -10.0f; // °C  sensor sanity window
constexpr float  WATER_MAX_VALID = 80.0f;
constexpr int    BATTERY_CUTOFF  = 3;      // %   stop cooling (not charging)
constexpr float  FAN_RUN_ON_S    = 30.0f;  // s   fan keeps running after the TEC stops
constexpr float  DUTY_SLEW_PER_S = 0.25f;  //     soft-start: max duty change per second

enum Phase : uint8_t { PHASE_OFF = 0, PHASE_COOLING = 1, PHASE_HOLDING = 2 };
enum Actor : uint8_t { BY_APP = 0, BY_BOTTLE = 1, BY_BATTERY = 2, BY_FAULT = 3 };

inline int clampTarget(int t) { return t < TARGET_MIN ? TARGET_MIN : t > TARGET_MAX ? TARGET_MAX : t; }
inline float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }
inline int16_t toTenths(float c) { return (int16_t)lroundf(c * 10.0f); }

// ------------------------------------------------------------ battery (2S)
// Per-cell open-circuit voltage → state of charge for typical 18650 Li-ion.
// Under load the voltage sags, so the .ino only updates this while the TEC
// is off or from a smoothed value (see BatteryGauge there).
inline uint8_t cellVoltsToPercent(float v) {
  static const float V[] = {3.20f, 3.40f, 3.50f, 3.60f, 3.70f, 3.80f, 3.90f, 4.00f, 4.10f, 4.20f};
  static const float P[] = {0,     5,     10,    20,    35,    50,    65,    80,    90,    100};
  if (v <= V[0]) return 0;
  if (v >= V[9]) return 100;
  for (int i = 1; i < 10; i++) {
    if (v <= V[i]) {
      float f = (v - V[i - 1]) / (V[i] - V[i - 1]);
      return (uint8_t)lroundf(P[i - 1] + f * (P[i] - P[i - 1]));
    }
  }
  return 100;
}
inline uint8_t packVoltsToPercent(float packVolts, int cellsInSeries = 2) {
  return cellVoltsToPercent(packVolts / (float)cellsInSeries);
}

// -------------------------------------------------------------- the button
// Short press (<1 s, on release)     → toggle cooling
// Hold 3 s (fires while still held)  → pairing mode (Bluetooth icon blinks)
// Hold 10 s                          → factory reset
enum ButtonEvent : uint8_t { BTN_NONE = 0, BTN_SHORT, BTN_PAIR, BTN_RESET };

class Button {
 public:
  ButtonEvent update(bool pressed, uint32_t nowMs) {
    if (pressed != raw_) { raw_ = pressed; changedAt_ = nowMs; }
    if (nowMs - changedAt_ < DEBOUNCE_MS) return BTN_NONE;     // not stable yet
    if (raw_ == stable_) {
      if (stable_) {                                           // still held
        uint32_t held = nowMs - downAt_;
        if (!firedReset_ && held >= RESET_MS) { firedReset_ = true; return BTN_RESET; }
        if (!firedPair_ && held >= PAIR_MS) { firedPair_ = true; return BTN_PAIR; }
      }
      return BTN_NONE;
    }
    stable_ = raw_;
    if (stable_) { downAt_ = changedAt_; firedPair_ = firedReset_ = false; return BTN_NONE; }
    uint32_t held = changedAt_ - downAt_;                      // released
    return (held < SHORT_MAX_MS && !firedPair_) ? BTN_SHORT : BTN_NONE;
  }
  static constexpr uint32_t DEBOUNCE_MS = 30, SHORT_MAX_MS = 1000, PAIR_MS = 3000, RESET_MS = 10000;

 private:
  bool raw_ = false, stable_ = false, firedPair_ = false, firedReset_ = false;
  uint32_t changedAt_ = 0, downAt_ = 0;
};

// ----------------------------------------------------------------- sessions
struct Session {            // one cooling run, kept until the app syncs it
  uint32_t startS, endS;    // device uptime seconds (app converts to clock time)
  int16_t  startT10, endT10, minT10;
  uint8_t  target, battStart, battEnd;
  uint8_t  startedBy, endedBy;
  uint8_t  seq;
};

template <int N>
class SessionLog {          // ring buffer: oldest dropped when full
 public:
  void push(const Session& s) {
    if (count_ == N) { head_ = (head_ + 1) % N; count_--; }
    items_[(head_ + count_) % N] = s;
    count_++;
  }
  int count() const { return count_; }
  const Session& at(int i) const { return items_[(head_ + i) % N]; }   // 0 = oldest
  void dropOldest(int n) {
    if (n > count_) n = count_;
    head_ = (head_ + n) % N;
    count_ -= n;
  }
  void clear() { head_ = count_ = 0; }

 private:
  Session items_[N];
  int head_ = 0, count_ = 0;
};

// --------------------------------------------------------------- controller
struct Inputs {
  float waterC;        // water temperature (NAN if the sensor failed)
  float hotSideC;      // heatsink temperature (NAN if the sensor failed)
  uint8_t battery;     // %
  bool charging;
  uint32_t uptimeS;
};

struct Outputs {
  float tecDuty;       // 0..1 → PWM for the Peltier MOSFET
  bool fan;
};

class Controller {
 public:
  // --- commands (from the app or the physical switch) ---
  bool turnOn(Actor by, const Inputs& in) {
    if (coolingOn_) return true;
    if (in.battery <= BATTERY_CUTOFF && !in.charging) return false;
    if (overheat_ || !validWater(in.waterC) || isnan(in.hotSideC)) return false;
    coolingOn_ = true;
    phase_ = (in.waterC - target_ > HOLD_BAND) ? PHASE_COOLING : PHASE_HOLDING;
    cur_ = {};
    cur_.startS = in.uptimeS;
    cur_.startT10 = cur_.minT10 = toTenths(in.waterC);
    cur_.battStart = in.battery;
    cur_.startedBy = by;
    return true;
  }
  void turnOff(Actor by, const Inputs& in) {
    if (!coolingOn_) return;
    coolingOn_ = false;
    phase_ = PHASE_OFF;
    fanRunOn_ = FAN_RUN_ON_S;
    cur_.endS = in.uptimeS;
    cur_.endT10 = validWater(in.waterC) ? toTenths(in.waterC) : cur_.minT10;
    cur_.target = (uint8_t)target_;
    cur_.battEnd = in.battery;
    cur_.endedBy = by;
    cur_.seq = seq_++;
    log.push(cur_);
  }
  void toggle(Actor by, const Inputs& in) { coolingOn_ ? turnOff(by, in) : (void)turnOn(by, in); }
  void setTarget(int t) { target_ = clampTarget(t); }
  void setSaver(bool on) { saver_ = on; }

  // --- the control loop, call ~every 100 ms–1 s with elapsed seconds ---
  Outputs step(float dt, const Inputs& in) {
    // Safety first: heatsink over-temperature latches until it cools down,
    // and a missing heatsink sensor is a fault (we couldn't see overheating).
    const bool hotValid = !isnan(in.hotSideC);
    if (hotValid && in.hotSideC >= HOT_SIDE_TRIP) overheat_ = true;
    else if (overheat_ && hotValid && in.hotSideC <= HOT_SIDE_RESET) overheat_ = false;
    sensorFault_ = !validWater(in.waterC) || !hotValid;

    if (coolingOn_) {
      if (overheat_ || sensorFault_) turnOff(BY_FAULT, in);
      else if (in.battery <= BATTERY_CUTOFF && !in.charging) turnOff(BY_BATTERY, in);
    }

    float want = 0;
    if (coolingOn_) {
      float e = in.waterC - (float)target_;
      if (e > HOLD_BAND) {                       // pull down hard, proportional
        phase_ = PHASE_COOLING;
        want = clampf(0.45f + 0.12f * e, 0.45f, 1.0f);
      } else if (e < -HOLD_BAND) {               // overshoot: let it drift up
        phase_ = PHASE_HOLDING;
        want = 0;
      } else {                                   // hold gently around target
        phase_ = PHASE_HOLDING;
        want = clampf(0.25f + 0.5f * e, 0.0f, 0.35f);
      }
      if (saver_) want *= SAVER_FACTOR;
      // Heatsink derating: the hotter the heatsink, the less power we feed the Peltier,
      // so the bottle cools as fast as its heatsink can shed the heat instead of
      // running flat out until the safety trip stops it.
      if (!isnan(in.hotSideC) && in.hotSideC > DERATE_START)
        want *= clampf((DERATE_END - in.hotSideC) / (DERATE_END - DERATE_START), 0.0f, 1.0f);
      int16_t t10 = toTenths(in.waterC);
      if (t10 < cur_.minT10) cur_.minT10 = t10;
    }
    // Soft start / soft stop protects the Peltier from thermal shock and
    // avoids current spikes on the battery.
    float maxStep = DUTY_SLEW_PER_S * dt;
    if (!coolingOn_ || overheat_) duty_ = 0;      // stopping is always immediate
    else duty_ += clampf(want - duty_, -maxStep, maxStep);

    if (duty_ > 0.001f) fanRunOn_ = FAN_RUN_ON_S;
    else if (fanRunOn_ > 0) fanRunOn_ -= dt;
    // Overheat: TEC off but keep the fan blowing to cool the heatsink.
    bool fan = duty_ > 0.001f || fanRunOn_ > 0 || overheat_ || (!isnan(in.hotSideC) && in.hotSideC > FAN_ON_ABOVE);
    return {duty_, fan};
  }

  // --- state for the display and Bluetooth ---
  bool coolingOn() const { return coolingOn_; }
  Phase phase() const { return phase_; }
  int target() const { return target_; }
  bool saver() const { return saver_; }
  bool overheat() const { return overheat_; }
  bool sensorFault() const { return sensorFault_; }
  float duty() const { return duty_; }

  SessionLog<16> log;

 private:
  static bool validWater(float c) { return !isnan(c) && c > WATER_MIN_VALID && c < WATER_MAX_VALID; }
  bool coolingOn_ = false, saver_ = false, overheat_ = false, sensorFault_ = false;
  Phase phase_ = PHASE_OFF;
  int target_ = TARGET_DEFAULT;
  float duty_ = 0, fanRunOn_ = 0;
  uint8_t seq_ = 0;
  Session cur_ = {};
};

// ======================================================= Bluetooth protocol
// Must match app-integration/nexa-protocol.js. All values little-endian.
// Every packet fits in 20 bytes, so the default BLE MTU (23) is enough.
namespace proto {
constexpr uint8_t VERSION = 1;
// GATT UUIDs (custom 128-bit; base ends in 4e455841 = "NEXA")
#define NEXA_SERVICE_UUID  "8b6f0001-6e65-7861-a1b2-00004e455841"
#define NEXA_STATE_UUID    "8b6f0002-6e65-7861-a1b2-00004e455841"   // read + notify, 12 B
#define NEXA_CONTROL_UUID  "8b6f0003-6e65-7861-a1b2-00004e455841"   // write
#define NEXA_SESSIONS_UUID "8b6f0004-6e65-7861-a1b2-00004e455841"   // notify

enum StateFlag : uint8_t {
  F_COOLING = 1 << 0, F_CHARGING = 1 << 1, F_SAVER = 1 << 2,
  F_OVERHEAT = 1 << 3, F_SENSOR_FAULT = 1 << 4, F_PAIRING = 1 << 5,
};
enum Op : uint8_t {
  OP_SET_COOLING = 0x01,   // [0x01, on]
  OP_SET_TARGET = 0x02,    // [0x02, °C]
  OP_SET_SAVER = 0x03,     // [0x03, on]
  OP_SEND_SESSIONS = 0x10, // [0x10]       → session records + end marker on SESSIONS
  OP_ACK_SESSIONS = 0x11,  // [0x11, n]    → bottle deletes the n oldest records
  OP_IDENTIFY = 0x20,      // [0x20]       → blink the display
};
constexpr uint8_t REC_SESSION = 0x01, REC_END = 0xFF;
constexpr int STATE_LEN = 12, SESSION_LEN = 20, END_LEN = 6;

inline void put16(uint8_t* p, int16_t v) { p[0] = (uint8_t)(v & 0xFF); p[1] = (uint8_t)((uint16_t)v >> 8); }
inline void put32(uint8_t* p, uint32_t v) { for (int i = 0; i < 4; i++) p[i] = (uint8_t)(v >> (8 * i)); }

struct StateView {
  bool cooling, charging, saver, overheat, sensorFault, pairing;
  Phase phase;
  float waterC, hotSideC;
  uint8_t target, battery, health, pendingSessions;
};

// [0]ver [1]flags [2]phase [3-4]water×10 [5]target [6]battery% [7]health%
// [8-9]hotSide×10 [10]pending sessions [11]reserved
inline void packState(const StateView& s, uint8_t out[STATE_LEN]) {
  memset(out, 0, STATE_LEN);
  out[0] = VERSION;
  out[1] = (s.cooling ? F_COOLING : 0) | (s.charging ? F_CHARGING : 0) | (s.saver ? F_SAVER : 0) |
           (s.overheat ? F_OVERHEAT : 0) | (s.sensorFault ? F_SENSOR_FAULT : 0) | (s.pairing ? F_PAIRING : 0);
  out[2] = s.phase;
  put16(out + 3, isnan(s.waterC) ? INT16_MIN : toTenths(s.waterC));
  out[5] = s.target;
  out[6] = s.battery;
  out[7] = s.health;
  put16(out + 8, isnan(s.hotSideC) ? INT16_MIN : toTenths(s.hotSideC));
  out[10] = s.pendingSessions;
}

// [0]0x01 [1-4]startS [5-8]endS [9-10]start×10 [11-12]end×10 [13-14]min×10
// [15]target [16]batt start [17]batt end [18]startedBy|endedBy<<4 [19]seq
inline void packSession(const Session& s, uint8_t out[SESSION_LEN]) {
  out[0] = REC_SESSION;
  put32(out + 1, s.startS);
  put32(out + 5, s.endS);
  put16(out + 9, s.startT10);
  put16(out + 11, s.endT10);
  put16(out + 13, s.minT10);
  out[15] = s.target;
  out[16] = s.battStart;
  out[17] = s.battEnd;
  out[18] = (uint8_t)((s.startedBy & 0x0F) | ((s.endedBy & 0x0F) << 4));
  out[19] = s.seq;
}

// [0]0xFF [1-4]device uptime now (s) [5]records sent — lets the app turn
// uptime stamps into clock times without the bottle needing a real-time clock.
inline void packEnd(uint32_t uptimeNowS, uint8_t sent, uint8_t out[END_LEN]) {
  out[0] = REC_END;
  put32(out + 1, uptimeNowS);
  out[5] = sent;
}

// Applies one CONTROL write. Returns false for malformed/unknown packets.
// OP_SEND_SESSIONS / OP_IDENTIFY are reported via *needs so the .ino can do
// the I/O; everything else is applied to the controller directly.
enum Need : uint8_t { NEED_NONE = 0, NEED_SEND_SESSIONS, NEED_IDENTIFY };
inline bool applyCommand(const uint8_t* d, int len, Controller& c, const Inputs& in, Need* needs) {
  *needs = NEED_NONE;
  if (len < 1) return false;
  switch (d[0]) {
    case OP_SET_COOLING: if (len < 2) return false; d[1] ? (void)c.turnOn(BY_APP, in) : c.turnOff(BY_APP, in); return true;
    case OP_SET_TARGET:  if (len < 2) return false; c.setTarget(d[1]); return true;
    case OP_SET_SAVER:   if (len < 2) return false; c.setSaver(d[1] != 0); return true;
    case OP_SEND_SESSIONS: *needs = NEED_SEND_SESSIONS; return true;
    case OP_ACK_SESSIONS: if (len < 2) return false; c.log.dropOldest(d[1]); return true;
    case OP_IDENTIFY: *needs = NEED_IDENTIFY; return true;
    default: return false;
  }
}
}  // namespace proto
}  // namespace nexa
