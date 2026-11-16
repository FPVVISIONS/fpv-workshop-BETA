// =============================================================================
//  NEXA ONE — bottle firmware (ESP32-C3)
//
//  Board:     ESP32-C3 SuperMini (Arduino core 3.x). NOT the XIAO: it lacks GPIO0/1.
//  Settings:  config.h (pins, display type, battery divider, names)
//  Libraries: NimBLE-Arduino 2.x · OneWire · DallasTemperature · U8g2
//  Logic:     nexa_core.h (unit-tested on a PC, see ../test)
//  Protocol:  matches app-integration/nexa-protocol.js
//
//  Serial monitor (115200): status | calib <volts> | target <5-15> | pair | help
// =============================================================================
#include <Arduino.h>
#include <Wire.h>
#include <Preferences.h>
#include <NimBLEDevice.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <U8g2lib.h>
#include "config.h"
#include "nexa_core.h"

using namespace nexa;

// --------------------------------------------------------------- globals
Controller ctl;
Button button;
Preferences prefs;
OneWire owWater(PIN_WATER), owHot(PIN_HOT);
DallasTemperature waterSensor(&owWater), hotSensor(&owHot);
#if defined(OLED_SSD1306)
U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);
#else
U8G2_SH1106_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);
#endif

NimBLEServer* server = nullptr;
NimBLECharacteristic *chState = nullptr, *chControl = nullptr, *chSessions = nullptr;
volatile bool bleConnected = false;
bool paired = false;
uint32_t pairingUntil = 0, identifyUntil = 0;

float waterC = NAN, hotC = NAN, battRawEma = NAN;   // battRawEma: pack volts before calibration
float battCal = 1.0f;                                // calibration factor (saved in flash)
uint8_t batteryPct = 0, healthPct = 100;
float cyclesUsed = 0;                      // charge cycles, for a rough health figure
bool charging = false;

// Commands arrive on the BLE task; queue them for loop() to apply safely.
portMUX_TYPE cmdMux = portMUX_INITIALIZER_UNLOCKED;
uint8_t cmdBuf[8][8]; uint8_t cmdLen[8]; volatile int cmdHead = 0, cmdTail = 0;

static float battVolts() { return battRawEma * battCal; }
static uint32_t uptimeS() { return (uint32_t)(esp_timer_get_time() / 1000000ULL); }
static Inputs inputs() { return Inputs{waterC, hotC, batteryPct, charging, uptimeS()}; }

// ------------------------------------------------------------- Bluetooth
class ServerCB : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*, NimBLEConnInfo&) override {
    bleConnected = true;
    if (!paired) { paired = true; prefs.putBool("paired", true); }
    pairingUntil = 0;
  }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override {
    bleConnected = false;
    NimBLEDevice::startAdvertising();     // let the app reconnect automatically
  }
};

class ControlCB : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo&) override {
    NimBLEAttValue v = c->getValue();
    int n = v.length() > 8 ? 8 : (int)v.length();
    portENTER_CRITICAL(&cmdMux);
    int next = (cmdHead + 1) % 8;
    if (next != cmdTail) { memcpy(cmdBuf[cmdHead], v.data(), n); cmdLen[cmdHead] = (uint8_t)n; cmdHead = next; }
    portEXIT_CRITICAL(&cmdMux);
  }
};

static bool shouldAdvertise() { return paired || millis() < pairingUntil; }

static void setupBle() {
  NimBLEDevice::init(DEVICE_NAME);
  NimBLEDevice::setPower(3);               // dBm — plenty for a bottle-to-phone link
  server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCB());
  NimBLEService* svc = server->createService(NEXA_SERVICE_UUID);
  chState = svc->createCharacteristic(NEXA_STATE_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  chControl = svc->createCharacteristic(NEXA_CONTROL_UUID, NIMBLE_PROPERTY::WRITE);
  chControl->setCallbacks(new ControlCB());
  chSessions = svc->createCharacteristic(NEXA_SESSIONS_UUID, NIMBLE_PROPERTY::NOTIFY);
  svc->start();
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(NEXA_SERVICE_UUID);
  adv->setName(DEVICE_NAME);
  adv->enableScanResponse(true);
}

static void updateAdvertising() {
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  bool want = !bleConnected && shouldAdvertise();
  if (want && !adv->isAdvertising()) adv->start();
  if (!want && adv->isAdvertising()) adv->stop();
}

static void publishState() {
  proto::StateView v{ctl.coolingOn(), charging, ctl.saver(), ctl.overheat(), ctl.sensorFault(),
                     millis() < pairingUntil, ctl.phase(), waterC, hotC, (uint8_t)ctl.target(),
                     batteryPct, healthPct, (uint8_t)ctl.log.count()};
  uint8_t buf[proto::STATE_LEN];
  proto::packState(v, buf);
  chState->setValue(buf, sizeof buf);
  if (bleConnected) chState->notify();
}

static void sendSessions() {
  int n = ctl.log.count();
  uint8_t rec[proto::SESSION_LEN];
  for (int i = 0; i < n; i++) {
    proto::packSession(ctl.log.at(i), rec);
    chSessions->setValue(rec, sizeof rec);
    chSessions->notify();
    delay(15);                             // don't flood the phone's notification queue
  }
  uint8_t end[proto::END_LEN];
  proto::packEnd(uptimeS(), (uint8_t)n, end);
  chSessions->setValue(end, sizeof end);
  chSessions->notify();
}

static void drainCommands() {
  for (;;) {
    uint8_t buf[8]; int n;
    portENTER_CRITICAL(&cmdMux);
    if (cmdTail == cmdHead) { portEXIT_CRITICAL(&cmdMux); return; }
    n = cmdLen[cmdTail]; memcpy(buf, cmdBuf[cmdTail], n); cmdTail = (cmdTail + 1) % 8;
    portEXIT_CRITICAL(&cmdMux);
    proto::Need need;
    if (proto::applyCommand(buf, n, ctl, inputs(), &need)) {
      if (need == proto::NEED_SEND_SESSIONS) sendSessions();
      if (need == proto::NEED_IDENTIFY) identifyUntil = millis() + 3000;
      if (buf[0] == proto::OP_SET_TARGET) prefs.putUChar("target", (uint8_t)ctl.target());
      if (buf[0] == proto::OP_SET_SAVER) prefs.putBool("saver", ctl.saver());
      publishState();
    }
  }
}

// --------------------------------------------------------------- sensors
static void readSensors() {
  // Non-blocking DS18B20: request now, read on the next pass (750 ms later).
  static uint32_t requestedAt = 0;
  static bool pending = false;
  if (!pending) {
    waterSensor.requestTemperatures();
    hotSensor.requestTemperatures();
    requestedAt = millis();
    pending = true;
  } else if (millis() - requestedAt >= 760) {
    float w = waterSensor.getTempCByIndex(0), h = hotSensor.getTempCByIndex(0);
    waterC = (w == DEVICE_DISCONNECTED_C) ? NAN : w;
    hotC = (h == DEVICE_DISCONNECTED_C) ? NAN : h;
    pending = false;
  }

  float v = analogReadMilliVolts(PIN_BATT) / 1000.0f * BATT_DIVIDER;
  battRawEma = isnan(battRawEma) ? v : battRawEma + 0.05f * (v - battRawEma);
  charging = (digitalRead(PIN_VBUS) == LOW) == CHARGE_ACTIVE_LOW;
  uint8_t pct = packVoltsToPercent(battVolts(), BATT_CELLS_SERIES);
  // Voltage sags under the Peltier's load: only let the % fall while
  // discharging and rise while charging, so it never jumps around.
  if (charging && pct > batteryPct) { cyclesUsed += (pct - batteryPct) / 100.0f; batteryPct = pct; }
  if (!charging && pct < batteryPct) batteryPct = pct;
  healthPct = (uint8_t)(100 - fminf(40.0f, cyclesUsed * 0.04f));   // ~80 % after 500 cycles
}

// --------------------------------------------------------------- display
// Mirrors the bottle in the app ("תצוגת הבקבוק"): big temperature on the left,
// snowflake + target + battery stacked on the right, all on black.
// Coordinates are the render's display (68x33 units) x 1.88 → 128x64 pixels.
// If your font metrics differ, nudge the constants here.
constexpr int TEMP_X = 8, TEMP_BASE_Y = 47;        // big digits
constexpr int SNOW_CX = 113, SNOW_CY = 14, SNOW_R = 7;
constexpr int TARGET_X = 100, TARGET_Y = 38;       // "8°"
constexpr int BATT_X = 100, BATT_Y = 46, BATT_W = 22, BATT_H = 10;

static void drawSnowflake(int cx, int cy, int r) {
  int h = (r * 87) / 100, v = r / 2;               // cos30, sin30
  oled.drawLine(cx, cy - r, cx, cy + r);
  oled.drawLine(cx - h, cy - v, cx + h, cy + v);
  oled.drawLine(cx - h, cy + v, cx + h, cy - v);
}
static void drawBluetooth(int cx, int cy, int s) {   // the rune used in the app's guide
  oled.drawLine(cx - s, cy - s, cx + s, cy + s / 2 + 1);
  oled.drawLine(cx + s, cy + s / 2 + 1, cx, cy + s * 2);
  oled.drawLine(cx, cy - s * 2, cx, cy + s * 2);
  oled.drawLine(cx, cy - s * 2, cx + s, cy - s / 2 - 1);
  oled.drawLine(cx + s, cy - s / 2 - 1, cx - s, cy + s);
}

static void drawDisplay() {
  static uint32_t last = 0;
  if (millis() - last < 200) return;
  last = millis();
  bool blink = (millis() / 500) % 2;
  oled.clearBuffer();
  if (millis() < identifyUntil && blink) { oled.sendBuffer(); return; }

  bool pairing = millis() < pairingUntil && !bleConnected;
  if (pairing) {
    // Same state the app's guide shows: Bluetooth rune blinking, nothing else.
    if (blink) drawBluetooth(64, 32, 9);
    oled.sendBuffer();
    return;
  }

  if (charging && !ctl.coolingOn()) {
    // Charging screen: big battery that fills, with the percentage.
    oled.drawFrame(14, 18, 76, 28);
    oled.drawBox(90, 26, 5, 12);
    oled.drawBox(17, 21, (uint8_t)(70 * batteryPct / 100), 22);
    char pc[8]; snprintf(pc, sizeof pc, "%u%%", batteryPct);
    oled.setFont(u8g2_font_6x10_tf);
    oled.drawStr(100, 36, pc);
    oled.sendBuffer();
    return;
  }

  char t[8];
  if (isnan(waterC)) snprintf(t, sizeof t, "--.-");
  else snprintf(t, sizeof t, "%.1f", waterC);
  oled.setFont(u8g2_font_logisoso22_tn);
  oled.drawStr(TEMP_X, TEMP_BASE_Y, t);
  oled.setFont(u8g2_font_6x10_tf);
  oled.drawStr(TEMP_X + 66, TEMP_BASE_Y - 20, "o");               // degree mark

  if (ctl.coolingOn()) drawSnowflake(SNOW_CX, SNOW_CY, SNOW_R);
  char tg[8]; snprintf(tg, sizeof tg, "%d", ctl.target());
  oled.drawCircle(TARGET_X - 5, TARGET_Y - 4, 3);                   // target mark
  oled.drawBox(TARGET_X - 6, TARGET_Y - 5, 3, 3);
  oled.drawStr(TARGET_X + 2, TARGET_Y, tg);

  oled.drawFrame(BATT_X, BATT_Y, BATT_W, BATT_H);                    // battery
  oled.drawBox(BATT_X + BATT_W, BATT_Y + 3, 2, BATT_H - 6);
  oled.drawBox(BATT_X + 2, BATT_Y + 2, (uint8_t)((BATT_W - 4) * batteryPct / 100), BATT_H - 4);
  if (charging && blink) oled.drawStr(BATT_X - 8, BATT_Y + 9, "+");

  if (bleConnected) drawBluetooth(8, 8, 3);                          // top-left, small
  if (ctl.overheat()) oled.drawStr(TEMP_X, 62, "HOT - COOLING DOWN");
  else if (ctl.sensorFault()) oled.drawStr(TEMP_X, 62, "SENSOR ERROR");
  oled.sendBuffer();
}

// ---------------------------------------------------------------- serial
static void logStatus() {
  Serial.printf("[nexa] water=%.1fC heatsink=%.1fC batt=%u%% (%.2fV raw %.2fV cal %.3f) charging=%d  "
                "cooling=%d phase=%d target=%d saver=%d tec=%.0f%% fan=%d  ble=%d paired=%d%s%s\n",
                waterC, hotC, batteryPct, battVolts(), battRawEma, battCal, charging, ctl.coolingOn(), (int)ctl.phase(),
                ctl.target(), ctl.saver(), ctl.duty() * 100.0f, digitalRead(PIN_FAN), bleConnected, paired,
                ctl.overheat() ? "  OVERHEAT" : "", ctl.sensorFault() ? "  SENSOR-FAULT" : "");
}

static void handleSerial() {
  static char buf[48];
  static int n = 0;
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c != '\n') { if (n < (int)sizeof buf - 1) buf[n++] = c; continue; }
    buf[n] = 0; n = 0;
    if (!strcmp(buf, "status")) {
      logStatus();
    } else if (!strncmp(buf, "calib ", 6)) {
      float volts = atof(buf + 6);
      if (volts > 5.0f && volts < 9.0f && battRawEma > 1.0f) {
        battCal = volts / battRawEma;
        prefs.putFloat("batcal", battCal);
        Serial.printf("[nexa] battery calibrated: factor %.3f (pack now %.2f V)\n", battCal, battVolts());
      } else Serial.println("[nexa] usage: calib <pack volts from a multimeter, 5-9>");
    } else if (!strncmp(buf, "target ", 7)) {
      ctl.setTarget(atoi(buf + 7));
      prefs.putUChar("target", (uint8_t)ctl.target());
      Serial.printf("[nexa] target %d C\n", ctl.target());
    } else if (!strcmp(buf, "pair")) {
      pairingUntil = millis() + PAIRING_WINDOW_MS;
      Serial.println("[nexa] pairing mode on for 2 minutes");
    } else {
      Serial.println("[nexa] commands: status | calib <volts> | target <5-15> | pair");
    }
  }
}

// ------------------------------------------------------------------ main
void setup() {
  Serial.begin(115200);
  pinMode(PIN_FAN, OUTPUT);  digitalWrite(PIN_FAN, LOW);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_VBUS, INPUT_PULLUP);
  ledcAttach(PIN_TEC, TEC_PWM_HZ, TEC_PWM_BITS);
  ledcWrite(PIN_TEC, 0);
  analogReadResolution(12);
  prefs.begin("nexa", false);
  battCal = prefs.getFloat("batcal", 1.0f);
  // Initial battery reading (averaged) so the gauge starts at the real level.
  float sum = 0;
  for (int i = 0; i < 16; i++) { sum += analogReadMilliVolts(PIN_BATT); delay(2); }
  battRawEma = sum / 16 / 1000.0f * BATT_DIVIDER;
  batteryPct = packVoltsToPercent(battVolts(), BATT_CELLS_SERIES);
  charging = (digitalRead(PIN_VBUS) == LOW) == CHARGE_ACTIVE_LOW;

  paired = prefs.getBool("paired", false);
  ctl.setTarget(prefs.getUChar("target", TARGET_DEFAULT));
  ctl.setSaver(prefs.getBool("saver", false));
  cyclesUsed = prefs.getFloat("cycles", 0);

  waterSensor.begin(); waterSensor.setWaitForConversion(false); waterSensor.setResolution(11);
  hotSensor.begin();   hotSensor.setWaitForConversion(false);   hotSensor.setResolution(10);
  Wire.begin(PIN_SDA, PIN_SCL);
  oled.begin();

  setupBle();
  if (SERIAL_LOG) Serial.println("[nexa] ready. Type 'help' for commands.");
  if (!paired) pairingUntil = millis() + PAIRING_WINDOW_MS;   // first boot: discoverable
  updateAdvertising();
}

void loop() {
  static uint32_t lastStep = millis(), lastPublish = 0, lastCyclesSave = 0;
  uint32_t now = millis();

  readSensors();
  drainCommands();
  handleSerial();

  switch (button.update(digitalRead(PIN_BUTTON) == LOW, now)) {
    case BTN_SHORT: ctl.toggle(BY_BOTTLE, inputs()); publishState(); break;
    case BTN_PAIR:  pairingUntil = now + PAIRING_WINDOW_MS; break;
    case BTN_RESET:
      ctl.turnOff(BY_BOTTLE, inputs());
      ctl.log.clear();
      prefs.clear();
      prefs.putFloat("batcal", battCal);        // the battery calibration belongs to the hardware, keep it
      paired = false;
      ctl.setTarget(TARGET_DEFAULT);
      ctl.setSaver(false);
      if (bleConnected) server->disconnect(server->getPeerInfo(0).getConnHandle());
      pairingUntil = now + PAIRING_WINDOW_MS;
      break;
    default: break;
  }

  if (now - lastStep >= 100) {
    float dt = (now - lastStep) / 1000.0f;
    lastStep = now;
    Outputs o = ctl.step(dt, inputs());
    ledcWrite(PIN_TEC, (uint32_t)(o.tecDuty * ((1 << TEC_PWM_BITS) - 1)));
    digitalWrite(PIN_FAN, o.fan ? HIGH : LOW);
  }
  if (now - lastPublish >= 1000) { lastPublish = now; publishState(); if (SERIAL_LOG) logStatus(); }
  if (now - lastCyclesSave >= 600000) { lastCyclesSave = now; prefs.putFloat("cycles", cyclesUsed); }

  updateAdvertising();
  drawDisplay();
  delay(5);
}
