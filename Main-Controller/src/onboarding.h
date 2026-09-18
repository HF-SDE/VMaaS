#pragma once
/**
 * @file onboarding.h
 * @brief Blocking Wi-Fi onboarding: BLE by default, keypad as the fallback.
 *
 * Runs before the sales loop and owns the keypad and the display while it does.
 * Returns only once the device has an IP address, so a mistyped password can
 * never leave the machine holding credentials that do not work.
 */
#include "device_config.h"
#include "grove_lcd_rgb.h"

/// Wi-Fi onboarding for the Main-Controller.
namespace onboarding
{
    /**
     * @brief Run the onboarding flow to completion.
     * @param cfg Device configuration; only name is used.
     * @param lcd Display. Must already be begun.
     * @param backlight_ok false when the RGB probe failed; colour calls are skipped.
     */
    void run(const vmaas::DeviceConfig& cfg, vmaas::GroveLcdRgb& lcd, bool backlight_ok);
}
