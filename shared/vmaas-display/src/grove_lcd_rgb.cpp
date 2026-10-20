/**
 * @file grove_lcd_rgb.cpp
 * @brief GroveLcdRgb implementation. See grove_lcd_rgb.h.
 */
#include "grove_lcd_rgb.h"
#include <cstring>

namespace
{
    constexpr uint8_t CTRL_COMMAND = 0x80;
    constexpr uint8_t CTRL_DATA = 0x40;

    // PCA9633 (v4.0)
    constexpr uint8_t PCA_MODE1 = 0x00, PCA_MODE2 = 0x01, PCA_LEDOUT = 0x08;
    constexpr uint8_t PCA_BLUE = 0x02, PCA_GREEN = 0x03, PCA_RED = 0x04;
    // SGM31323 (v5.0)
    constexpr uint8_t SGM_ENABLE = 0x00, SGM_MODE = 0x04;
    constexpr uint8_t SGM_RED = 0x06, SGM_GREEN = 0x07, SGM_BLUE = 0x08;
}

namespace vmaas
{
    GroveLcdRgb::GroveLcdRgb(LcdPort& port) : CharLcd(port) {}

    LcdError GroveLcdRgb::command(uint8_t cmd)
    {
        const uint8_t buf[2] = {CTRL_COMMAND, cmd};
        return port_.write(LCD_ADDR, buf, sizeof(buf)) ? LcdError::None : LcdError::I2cWrite;
    }

    bool GroveLcdRgb::write_chars(const char* bytes, size_t n)
    {
        uint8_t buf[1 + COLS];
        buf[0] = CTRL_DATA;
        std::memcpy(buf + 1, bytes, n);
        return port_.write(LCD_ADDR, buf, n + 1);
    }

    bool GroveLcdRgb::rgb_reg(uint8_t addr, uint8_t reg, uint8_t value)
    {
        const uint8_t buf[2] = {reg, value};
        return port_.write(addr, buf, sizeof(buf));
    }

    LcdError GroveLcdRgb::begin()
    {
        reset();
        rgb_ = RgbChip::None;

        port_.delay_ms(50);
        if (command(CMD_FUNCTION_SET) != LcdError::None) return LcdError::I2cWrite;
        port_.delay_ms(5);
        if (command(CMD_FUNCTION_SET) != LcdError::None) return LcdError::I2cWrite;
        port_.delay_ms(1);
        if (command(CMD_DISPLAY_ON) != LcdError::None) return LcdError::I2cWrite;
        if (command(CMD_CLEAR) != LcdError::None) return LcdError::I2cWrite;
        port_.delay_ms(2);
        if (command(CMD_ENTRY_MODE) != LcdError::None) return LcdError::I2cWrite;

        mark_ready();

        if (rgb_reg(RGB_ADDR_V5, SGM_ENABLE, 0x07)) {
            rgb_ = RgbChip::Sgm31323;
            if (!rgb_reg(RGB_ADDR_V5, SGM_MODE, 0x15)) return LcdError::I2cWrite;
        } else if (rgb_reg(RGB_ADDR_V4, PCA_MODE1, 0x00)) {
            rgb_ = RgbChip::Pca9633;
            if (!rgb_reg(RGB_ADDR_V4, PCA_LEDOUT, 0xFF)) return LcdError::I2cWrite;
            if (!rgb_reg(RGB_ADDR_V4, PCA_MODE2, 0x20)) return LcdError::I2cWrite;
        } else {
            return LcdError::RgbChipNotFound;
        }
        return set_rgb(255, 255, 255);
    }

    LcdError GroveLcdRgb::set_rgb(uint8_t r, uint8_t g, uint8_t b)
    {
        if (!ready()) return LcdError::NotInitialized;
        bool ok = false;
        switch (rgb_)
        {
            case RgbChip::Pca9633:
                ok = rgb_reg(RGB_ADDR_V4, PCA_RED, r) && rgb_reg(RGB_ADDR_V4, PCA_GREEN, g) &&
                     rgb_reg(RGB_ADDR_V4, PCA_BLUE, b);
                break;
            case RgbChip::Sgm31323:
                ok = rgb_reg(RGB_ADDR_V5, SGM_RED, r) && rgb_reg(RGB_ADDR_V5, SGM_GREEN, g) &&
                     rgb_reg(RGB_ADDR_V5, SGM_BLUE, b);
                break;
            case RgbChip::None:
                return LcdError::RgbChipNotFound;
        }
        return ok ? LcdError::None : LcdError::I2cWrite;
    }
}
