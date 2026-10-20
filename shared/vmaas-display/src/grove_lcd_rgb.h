#pragma once
/**
 * @file grove_lcd_rgb.h
 * @brief Backend for the Seeed Grove-LCD RGB Backlight (16x2 LCD + RGB backlight).
 *
 * Pure C++17 with no hardware dependency: all I2C traffic goes through an
 * LcdPort, so the driver is unit-tested on the host. Supports v4.0 (PCA9633
 * backlight at 0x62) and v5.0 (SGM31323 at 0x30); the chip is probed in
 * begin(). The LCD controller (AiP31068L, 0x3E) is HD44780-compatible.
 *
 * Text, cursor and scrolling live in CharLcd; see char_lcd.h.
 */
#include <cstddef>
#include <cstdint>
#include "char_lcd.h"

namespace vmaas
{
    /// Grove-LCD RGB Backlight, driven over an LcdPort.
    class GroveLcdRgb : public CharLcd
    {
    public:
        static constexpr uint8_t LCD_ADDR = 0x3E;    /// AiP31068L LCD controller.
        static constexpr uint8_t RGB_ADDR_V4 = 0x62; /// PCA9633 backlight (v4.0).
        static constexpr uint8_t RGB_ADDR_V5 = 0x30; /// SGM31323 backlight (v5.0).

        /**
         * @brief Bind the driver to a port. The port must outlive the driver.
         * @param port I2C + delay implementation.
         */
        explicit GroveLcdRgb(LcdPort& port);

        /**
         * @brief Run the LCD power-up sequence, detect the backlight chip and set it to white.
         *
         * Blocks for roughly 60 ms. If the LCD part fails, the driver stays
         * uninitialised and every other call returns LcdError::NotInitialized.
         * If only the backlight chip is missing, text still works;
         * LcdError::RgbChipNotFound is returned here and from every set_rgb().
         * If the backlight chip is detected but a follow-up configuration
         * write to it fails (NAK), begin() returns LcdError::I2cWrite; the
         * driver still counts as initialised and the LCD text functions
         * remain usable.
         * @return LcdError::None on full success.
         */
        LcdError begin();

        /**
         * @brief Set the backlight colour.
         * @return LcdError::RgbChipNotFound if begin() found no backlight chip.
         */
        LcdError set_rgb(uint8_t r, uint8_t g, uint8_t b) override;

    protected:
        LcdError command(uint8_t cmd) override;
        bool write_chars(const char* bytes, size_t n) override;

    private:
        enum class RgbChip : uint8_t { None, Pca9633, Sgm31323 };

        bool rgb_reg(uint8_t addr, uint8_t reg, uint8_t value);

        RgbChip rgb_ = RgbChip::None;
    };
}
