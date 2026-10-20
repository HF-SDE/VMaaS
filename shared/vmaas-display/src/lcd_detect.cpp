/**
 * @file lcd_detect.cpp
 * @brief detect_lcd() implementation. See lcd_detect.h.
 */
#include "lcd_detect.h"
#include "grove_lcd_rgb.h"
#include "pcf8574_lcd.h"

namespace vmaas
{
    DetectedLcd detect_lcd(LcdPort& port)
    {
        if (port.probe(GroveLcdRgb::LCD_ADDR)) return {LcdKind::Grove, GroveLcdRgb::LCD_ADDR};
        if (port.probe(Pcf8574Lcd::ADDR_PCF8574)) return {LcdKind::Pcf8574, Pcf8574Lcd::ADDR_PCF8574};
        if (port.probe(Pcf8574Lcd::ADDR_PCF8574A)) return {LcdKind::Pcf8574, Pcf8574Lcd::ADDR_PCF8574A};
        return {LcdKind::None, 0};
    }

    const char* to_string(LcdKind kind)
    {
        switch (kind)
        {
            case LcdKind::None:
                return "None";
            case LcdKind::Grove:
                return "Grove-LCD RGB";
            case LcdKind::Pcf8574:
                return "PCF8574 1602";
        }
        return "Unknown";
    }
}
