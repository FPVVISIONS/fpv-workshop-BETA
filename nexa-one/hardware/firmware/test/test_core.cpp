// Host unit tests for nexa_core.h — no ESP32 needed.
//   g++ -std=c++17 -Wall -Wextra -I../nexa_one test_core.cpp -o test_core && ./test_core fixtures.json
// Also writes protocol fixtures that app-integration/test-protocol.mjs decodes,
// proving the firmware and the app agree byte-for-byte.
#include "nexa_core.h"
#include <cstdio>
#include <string>

using namespace nexa;
static int fails = 0, passes = 0;
#define CHECK(cond) do { if (cond) passes++; else { fails++; std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); } } while (0)
#define NEAR(a, b, eps) CHECK(std::fabs((a) - (b)) <= (eps))

static Inputs in(float water, float hot = 30, uint8_t batt = 80, bool chg = false, uint32_t t = 100) {
  return Inputs{water, hot, batt, chg, t};
}

static void testThermostat() {
  Controller c;
  CHECK(c.phase() == PHASE_OFF && c.target() == 8);
  CHECK(c.turnOn(BY_APP, in(20)));
  CHECK(c.coolingOn() && c.phase() == PHASE_COOLING);
  // soft start: duty climbs by ≤0.25/s toward 0.45+0.12*12 → capped at 1.0
  Outputs o = c.step(1.0f, in(20));
  NEAR(o.tecDuty, 0.25f, 1e-4);
  CHECK(o.fan);
  for (int i = 0; i < 10; i++) o = c.step(1.0f, in(20));
  NEAR(o.tecDuty, 1.0f, 1e-4);
  // battery saver scales power to 60 %
  c.setSaver(true);
  for (int i = 0; i < 10; i++) o = c.step(1.0f, in(20));
  NEAR(o.tecDuty, 0.6f, 1e-4);
  c.setSaver(false);
  // inside the ±0.2 band → holding with gentle duty
  for (int i = 0; i < 10; i++) o = c.step(1.0f, in(8.1f));
  CHECK(c.phase() == PHASE_HOLDING);
  CHECK(o.tecDuty > 0.2f && o.tecDuty <= 0.35f);
  // overshoot below target-0.2 → TEC idles, still "holding", fan runs on
  for (int i = 0; i < 10; i++) o = c.step(1.0f, in(7.5f));
  NEAR(o.tecDuty, 0.0f, 1e-4);
  CHECK(c.phase() == PHASE_HOLDING && c.coolingOn());
  // target clamps to 5–15
  c.setTarget(2);  CHECK(c.target() == 5);
  c.setTarget(40); CHECK(c.target() == 15);
}

static void testSafety() {
  Controller c;
  CHECK(!c.turnOn(BY_APP, in(NAN)));                 // no water sensor → refuse
  CHECK(!c.turnOn(BY_APP, in(20, NAN)));             // no heatsink sensor → refuse
  CHECK(!c.turnOn(BY_APP, in(20, 30, 2)));           // empty battery → refuse
  CHECK(c.turnOn(BY_APP, in(20, 30, 2, true)));      // …unless charging
  c.turnOff(BY_APP, in(20));
  c.log.clear();

  CHECK(c.turnOn(BY_BOTTLE, in(20)));
  Outputs o = c.step(1, in(20, 66));                 // heatsink overheats
  CHECK(!c.coolingOn() && c.overheat());
  NEAR(o.tecDuty, 0.0f, 1e-6);
  CHECK(o.fan);                                      // fan keeps cooling the heatsink
  CHECK(c.log.count() == 1 && c.log.at(0).endedBy == BY_FAULT);
  c.step(1, in(20, 50));  CHECK(c.overheat());       // hysteresis: still latched at 50 °C
  CHECK(!c.turnOn(BY_APP, in(20, 50)));
  c.step(1, in(20, 44));  CHECK(!c.overheat());      // released below 45 °C
  CHECK(c.turnOn(BY_APP, in(20, 44)));

  c.step(1, in(20, 30, 3));                          // battery hits cut-off while cooling
  CHECK(!c.coolingOn() && c.log.at(c.log.count() - 1).endedBy == BY_BATTERY);

  CHECK(c.turnOn(BY_APP, in(20)));
  c.step(1, in(NAN));                                // water sensor drops out
  CHECK(!c.coolingOn() && c.sensorFault());
}

static void testDerating() {
  Controller c;
  CHECK(c.turnOn(BY_APP, in(20)));
  Outputs o{};
  for (int i = 0; i < 12; i++) o = c.step(1.0f, in(20, 40));        // cool heatsink → full power
  NEAR(o.tecDuty, 1.0f, 1e-4);
  for (int i = 0; i < 12; i++) o = c.step(1.0f, in(20, 57));        // halfway through the derate band
  NEAR(o.tecDuty, 0.5f, 1e-3);
  CHECK(c.coolingOn() && !c.overheat());                            // still cooling, just gently
  for (int i = 0; i < 12; i++) o = c.step(1.0f, in(20, 62.5f));     // past the band → TEC idle…
  NEAR(o.tecDuty, 0.0f, 1e-4);
  CHECK(c.coolingOn() && !c.overheat());                            // …but not tripped (trip is 65 °C)
  for (int i = 0; i < 60; i++) o = c.step(1.0f, in(20, 62.5f));     // long after the run-on timer
  CHECK(o.fan);                                                     // the fan keeps blowing while the heatsink is hot
  for (int i = 0; i < 12; i++) o = c.step(1.0f, in(20, 45));        // heatsink recovers → power returns
  CHECK(o.tecDuty > 0.9f);
  c.step(1, in(20, 66));                                            // the hard trip still works
  CHECK(!c.coolingOn() && c.overheat());
}

static void testSessionRecording() {
  Controller c;
  c.setTarget(10);
  c.turnOn(BY_BOTTLE, in(21.4f, 30, 90, false, 1000));
  c.step(1, in(15.0f, 30, 88, false, 1500));
  c.step(1, in(9.7f, 30, 85, false, 2000));
  c.turnOff(BY_APP, in(9.9f, 30, 84, false, 2600));
  CHECK(c.log.count() == 1);
  const Session& s = c.log.at(0);
  CHECK(s.startS == 1000 && s.endS == 2600);
  CHECK(s.startT10 == 214 && s.endT10 == 99 && s.minT10 == 97);
  CHECK(s.target == 10 && s.battStart == 90 && s.battEnd == 84);
  CHECK(s.startedBy == BY_BOTTLE && s.endedBy == BY_APP);
  // ring buffer keeps the newest 16
  for (int i = 0; i < 20; i++) { c.turnOn(BY_APP, in(20)); c.turnOff(BY_APP, in(19)); }
  CHECK(c.log.count() == 16);
  c.log.dropOldest(10);
  CHECK(c.log.count() == 6);
}

static void testBattery() {
  CHECK(packVoltsToPercent(8.40f) == 100);
  CHECK(packVoltsToPercent(7.60f) == 50);
  CHECK(packVoltsToPercent(6.40f) == 0);
  CHECK(packVoltsToPercent(7.50f) == 43);   // 3.75 V/cell → between 35 % and 50 %
}

static void testButton() {
  Button b;
  uint32_t t = 0;
  auto run = [&](bool pressed, uint32_t ms) { ButtonEvent last = BTN_NONE; for (uint32_t i = 0; i < ms; i += 10) { t += 10; ButtonEvent e = b.update(pressed, t); if (e) last = e; } return last; };
  run(false, 100);
  CHECK(run(true, 300) == BTN_NONE);
  CHECK(run(false, 100) == BTN_SHORT);                 // short press
  CHECK(run(true, 15) == BTN_NONE && run(false, 100) == BTN_NONE);  // bounce < 30 ms ignored
  CHECK(run(true, 3100) == BTN_PAIR);                  // 3 s hold fires while held
  CHECK(run(false, 100) == BTN_NONE);                  // release after a hold ≠ short press
  ButtonEvent seen = BTN_NONE;
  for (int i = 0; i < 1050; i++) { t += 10; ButtonEvent e = b.update(true, t); if (e == BTN_RESET) seen = e; }
  CHECK(seen == BTN_RESET);                            // 10 s hold → reset
  run(false, 100);
}

static void testCommands() {
  Controller c;
  proto::Need need;
  const uint8_t on[] = {0x01, 1}, tgt[] = {0x02, 12}, saver[] = {0x03, 1}, send[] = {0x10}, bad[] = {0x7E}, shortPkt[] = {0x02};
  CHECK(proto::applyCommand(tgt, 2, c, in(20), &need) && c.target() == 12);
  CHECK(proto::applyCommand(on, 2, c, in(20), &need) && c.coolingOn());
  CHECK(proto::applyCommand(saver, 2, c, in(20), &need) && c.saver());
  CHECK(proto::applyCommand(send, 1, c, in(20), &need) && need == proto::NEED_SEND_SESSIONS);
  CHECK(!proto::applyCommand(bad, 1, c, in(20), &need));
  CHECK(!proto::applyCommand(shortPkt, 1, c, in(20), &need));
}

static std::string hex(const uint8_t* p, int n) {
  std::string s; char b[3];
  for (int i = 0; i < n; i++) { std::snprintf(b, 3, "%02x", p[i]); s += b; }
  return s;
}

static void writeFixtures(const char* path) {
  proto::StateView v{true, false, true, false, false, true, PHASE_COOLING, 18.4f, 41.25f, 8, 76, 94, 3};
  uint8_t st[proto::STATE_LEN]; proto::packState(v, st);
  proto::StateView v2{false, true, false, false, true, false, PHASE_OFF, NAN, -3.5f, 15, 100, 100, 0};
  uint8_t st2[proto::STATE_LEN]; proto::packState(v2, st2);
  Session s{123456, 127056, 214, 99, 97, 10, 90, 84, BY_BOTTLE, BY_BATTERY, 7};
  uint8_t ss[proto::SESSION_LEN]; proto::packSession(s, ss);
  uint8_t en[proto::END_LEN]; proto::packEnd(200000, 1, en);
  CHECK(st[0] == 1 && st[1] == (proto::F_COOLING | proto::F_SAVER | proto::F_PAIRING) && st[3] == 0xB8 && st[4] == 0x00);
  FILE* f = std::fopen(path, "w");
  if (!f) { fails++; return; }
  std::fprintf(f, "{\n  \"state\": \"%s\",\n  \"stateFault\": \"%s\",\n  \"session\": \"%s\",\n  \"end\": \"%s\"\n}\n",
               hex(st, proto::STATE_LEN).c_str(), hex(st2, proto::STATE_LEN).c_str(),
               hex(ss, proto::SESSION_LEN).c_str(), hex(en, proto::END_LEN).c_str());
  std::fclose(f);
}

int main(int argc, char** argv) {
  testThermostat();
  testSafety();
  testDerating();
  testSessionRecording();
  testBattery();
  testButton();
  testCommands();
  writeFixtures(argc > 1 ? argv[1] : "fixtures.json");
  std::printf("%d passed, %d failed\n", passes, fails);
  return fails ? 1 : 0;
}
