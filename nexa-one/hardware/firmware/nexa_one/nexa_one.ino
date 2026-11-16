// =============================================================================
//  NEXA ONE — bottle firmware (ESP32-C3)
//
//  Board:     ESP32-C3 SuperMini / Seeed XIAO ESP32-C3 (Arduino core 3.x)
//  Libraries: NimBLE-Arduino 2.x · OneWire · DallasTemperature · U8g2
//  Logic:     nexa_core.h (unit-tested on a PC, see ../test)
//  Protocol:  matches app-integration/nexa-protocol.js
//
//  Pin map (avoids the C3 strapping pins 2, 8, 9):
//    GPIO3  → Peltier MOSFET gate  (PWM 25 kHz)
//    GPIO4  → fan MOSFET gate
//    GPIO5  ← DS18B20 water probe   (4.7 kΩ pull-up to 3V3)
//    GPIO10 ← DS18B20 heatsink probe (4.7 kΩ pull-up to 3V3)
//    GPIO0  ← battery divider 220 kΩ / 100 kΩ (8.4 V → 2.63 V)
//    GPIO1  ← USB VBUS divider 10 kΩ / 20 kΩ (charging detect)
//    GPIO20 ← push button to GND (internal pull-up)
//    GPIO6/7  I2C SDA/SCL → SSD1306 128×32 OLED
// =============================================================================
#include <Arduino.h>
#include <Wire.h>
#include <Preferences.h>
#include <NimBLEDevice.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <U8g2lib.h>
#include "nexa_core.h"

using namespace nexa;

// ------------------------------------------------------------------ pins
constexpr int PIN_TEC = 3, PIN_FAN = 4, PIN_WATER = 5, PIN_HOT = 10;
constexpr int PIN_BATT = 0, PIN_VBUS = 1, PIN_BUTTON = 20, PIN_SDA = 6, PIN_SCL = 7;
constexpr float BATT_DIVIDER = (220.0f + 100.0f) / 100.0f;
constexpr uint32_t TEC_PWM_HZ = 25000;     // above hearing; LC filter optional (see guide)
constexpr uint8_t  TEC_PWM_BITS = 10;
constexpr uint32_t PAIRING_WINDOW_MS = 120000;

// --------------------------------------------------------------- globals
Controller ctl;
Button button;
Preferences prefs;
OneWire owWater(PIN_WATER), owHot(PIN_HOT);
DallasTemperature waterSensor(&owWater), hotSensor(&owHot);
U8G2_SSD1306_128X32_UNIVISION_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);

NimBLEServer* server = nullptr;
NimBLECharacteristic *chState = nullptr, *chControl = nullptr, *chSessions = nullptr;
volatile bool bleConnected = false;
bool paired = false;
uint32_t pairingUntil = 0, identifyUntil = 0;

float waterC = NAN, hotC = NAN, battVoltsEma = NAN;
uint8_t batteryPct = 0, healthPct = 100;
float cyclesUsed = 0;                      // charge cycles, for a rough health figure
bool charging = false;

// Commands arrive on the BLE task; queue them for loop() to apply safely.
portMUX_TYPE cmdMux = portMUX_INITIALIZER_UNLOCKED;
uint8_t cmdBuf[8][8]; uint8_t cmdLen[8]; volatile int cmdHead = 0, cmdTail = 0;

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
  NimBLEDevice::init("NEXA ONE");
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
  adv->setName("NEXA ONE");
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
  battVoltsEma = isnan(battVoltsEma) ? v : battVoltsEma + 0.05f * (v - battVoltsEma);
  charging = digitalRead(PIN_VBUS) == HIGH;
  uint8_t pct = packVoltsToPercent(battVoltsEma);
  // Voltage sags under the Peltier's load: only let the % fall while
  // discharging and rise while charging, so it never jumps around.
  if (charging && pct > batteryPct) { cyclesUsed += (pct - batteryPct) / 100.0f; batteryPct = pct; }
  if (!charging && pct < batteryPct) batteryPct = pct;
  healthPct = (uint8_t)(100 - fminf(40.0f, cyclesUsed * 0.04f));   // ~80 % after 500 cycles
}

// --------------------------------------------------------------- display
static void drawDisplay() {
  static uint32_t last = 0;
  if (millis() - last < 200) return;
  last = millis();
  bool blink = (millis() / 400) % 2;
  oled.clearBuffer();
  if (millis() < identifyUntil && blink) { oled.sendBuffer(); return; }
  char t[8];
  if (isnan(waterC)) snprintf(t, sizeof t, "--.-");
  else snprintf(t, sizeof t, "%.1f", waterC);
  oled.setFont(u8g2_font_logisoso24_tn);
  oled.drawStr(0, 28, t);
  oled.setFont(u8g2_font_6x10_tf);
  oled.drawStr(76, 10, ctl.coolingOn() ? "*" : " ");                  // cooling indicator
  char tg[8]; snprintf(tg, sizeof tg, "%d", ctl.target());
  oled.drawStr(86, 10, tg);
  bool pairing = millis() < pairingUntil;
  if (bleConnected || (pairing && blink)) oled.drawStr(110, 10, "BT");
  if (ctl.overheat()) oled.drawStr(76, 31, "HOT!");
  else if (ctl.sensorFault()) oled.drawStr(76, 31, "SENS");
  oled.drawFrame(100, 22, 24, 9);                                       // battery
  oled.drawBox(124, 24, 2, 5);
  oled.drawBox(102, 24, (uint8_t)(20 * batteryPct / 100), 5);
  if (charging && blink) oled.drawStr(90, 31, "+");
  oled.sendBuffer();
}

// ------------------------------------------------------------------ main
void setup() {
  Serial.begin(115200);
  pinMode(PIN_FAN, OUTPUT);  digitalWrite(PIN_FAN, LOW);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_VBUS, INPUT);
  ledcAttach(PIN_TEC, TEC_PWM_HZ, TEC_PWM_BITS);
  ledcWrite(PIN_TEC, 0);
  analogReadResolution(12);
  // Initial battery reading (averaged) so the gauge starts at the real level.
  float sum = 0;
  for (int i = 0; i < 16; i++) { sum += analogReadMilliVolts(PIN_BATT); delay(2); }
  battVoltsEma = sum / 16 / 1000.0f * BATT_DIVIDER;
  batteryPct = packVoltsToPercent(battVoltsEma);
  charging = digitalRead(PIN_VBUS) == HIGH;

  prefs.begin("nexa", false);
  paired = prefs.getBool("paired", false);
  ctl.setTarget(prefs.getUChar("target", TARGET_DEFAULT));
  ctl.setSaver(prefs.getBool("saver", false));
  cyclesUsed = prefs.getFloat("cycles", 0);

  waterSensor.begin(); waterSensor.setWaitForConversion(false); waterSensor.setResolution(11);
  hotSensor.begin();   hotSensor.setWaitForConversion(false);   hotSensor.setResolution(10);
  Wire.begin(PIN_SDA, PIN_SCL);
  oled.begin();

  setupBle();
  if (!paired) pairingUntil = millis() + PAIRING_WINDOW_MS;   // first boot: discoverable
  updateAdvertising();
}

void loop() {
  static uint32_t lastStep = millis(), lastPublish = 0, lastCyclesSave = 0;
  uint32_t now = millis();

  readSensors();
  drainCommands();

  switch (button.update(digitalRead(PIN_BUTTON) == LOW, now)) {
    case BTN_SHORT: ctl.toggle(BY_BOTTLE, inputs()); publishState(); break;
    case BTN_PAIR:  pairingUntil = now + PAIRING_WINDOW_MS; break;
    case BTN_RESET:
      ctl.turnOff(BY_BOTTLE, inputs());
      ctl.log.clear();
      prefs.clear();
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
  if (now - lastPublish >= 1000) { lastPublish = now; publishState(); }
  if (now - lastCyclesSave >= 600000) { lastCyclesSave = now; prefs.putFloat("cycles", cyclesUsed); }

  updateAdvertising();
  drawDisplay();
  delay(5);
}
