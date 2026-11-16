// =============================================================================
//  NEXA ONE — settings you may want to change.  Everything else lives in
//  nexa_one.ino (hardware glue) and nexa_core.h (thermostat, safety, protocol).
// =============================================================================
#pragma once
#include <stdint.h>

// ---- Display: pick ONE (most 1.3" 128x64 modules are SH1106) ---------------------
#define OLED_SH1106
// #define OLED_SSD1306

// ---- Board: ESP32-C3 SuperMini -----------------------------------------------------
// GPIO 0 and 1 are used for battery and charger sensing. They are NOT broken out on the
// Seeed XIAO ESP32-C3, so that board needs different pins here.
// GPIO 2, 8 and 9 are the chip's boot-strapping pins; leave them alone.
constexpr int PIN_TEC = 3;        // Peltier MOSFET gate (PWM)
constexpr int PIN_FAN = 4;        // fan MOSFET gate
constexpr int PIN_WATER = 5;      // DS18B20 on the water vessel      (4.7 kΩ pull-up to 3V3)
constexpr int PIN_HOT = 10;       // DS18B20 on the heatsink          (4.7 kΩ pull-up to 3V3)
constexpr int PIN_BATT = 0;       // battery voltage divider midpoint (ADC)
constexpr int PIN_VBUS = 1;       // charger detect: PC817 optocoupler collector (pulls LOW while a charger is plugged in)
constexpr bool CHARGE_ACTIVE_LOW = true;   // an optocoupler is safe even if the charger negotiates 9-20 V; never wire a charger's USB voltage straight to a GPIO
constexpr int PIN_BUTTON = 20;    // push button to GND
constexpr int PIN_SDA = 6, PIN_SCL = 7;   // OLED

// ---- Battery gauge -----------------------------------------------------------------
// Divider from the pack + to GND: top resistor to the pack, bottom to GND.
// 330 kΩ / 100 kΩ puts 8.4 V at 1.95 V, inside the ADC's accurate range.
constexpr float BATT_R_TOP_K = 330.0f;
constexpr float BATT_R_BOTTOM_K = 100.0f;
constexpr float BATT_DIVIDER = (BATT_R_TOP_K + BATT_R_BOTTOM_K) / BATT_R_BOTTOM_K;
constexpr int BATT_CELLS_SERIES = 2;      // 2S pack
// Fine-tune without reflashing: type  calib 7.62  (your multimeter's pack voltage) in the serial monitor.

// ---- Peltier drive -----------------------------------------------------------------
constexpr uint32_t TEC_PWM_HZ = 25000;    // above hearing
constexpr uint8_t TEC_PWM_BITS = 10;

// ---- Bluetooth ---------------------------------------------------------------------
#define DEVICE_NAME "NEXA ONE"
constexpr uint32_t PAIRING_WINDOW_MS = 120000;   // after a 3 s button hold, discoverable for 2 minutes

// ---- Debug -------------------------------------------------------------------------
constexpr bool SERIAL_LOG = true;         // one status line per second on the USB serial port

// Safety limits (heatsink derating and trip, battery cut-off) are in nexa_core.h.
