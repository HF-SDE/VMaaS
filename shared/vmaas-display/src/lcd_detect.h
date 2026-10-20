#pragma once
/**
 * @file lcd_detect.h
 * @brief Find out at boot which character display is on the I2C bus.
 */
#include <cstdint>
#include "lcd_port.h"

namespace vmaas
{
    /// Which display answered.
    enum class LcdKind : uint8_t
    {
        None,    /// Nothing at any known address.
        Grove,   /// Grove-LCD RGB Backlight; drive with GroveLcdRgb.
        Pcf8574, /// 1602A behind a PCF8574 backpack; drive with Pcf8574Lcd.
    };

    /// Result of detect_lcd().
    struct DetectedLcd
    {
        LcdKind kind;
        uint8_t addr; ///< The address that answered; 0 for LcdKind::None.
    };

    /**
     * @brief Probe 0x3E (Grove), 0x27 (PCF8574), then 0x3F (PCF8574A).
     *
     * The first address that acknowledges wins. Only probes are sent, so a
     * display that is not chosen never receives a byte.
     */
    DetectedLcd detect_lcd(LcdPort& port);

    /// Log-friendly name, e.g. "PCF8574 1602".
    const char* to_string(LcdKind kind);
}
