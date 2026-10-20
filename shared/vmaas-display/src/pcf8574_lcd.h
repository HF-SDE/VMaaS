#pragma once
/**
 * @file pcf8574_lcd.h
 * @brief Backend for a 1602A (HD44780) behind a PCF8574 I2C backpack.
 *
 * The backpack is an 8-bit port expander wired P0=RS, P1=RW, P2=EN,
 * P3=backlight, P4-P7=D4-D7, so the LCD runs in 4-bit mode: every HD44780
 * byte is two nibbles, each clocked in by an EN pulse written as three
 * expander bytes (data, data|EN, data). RW is always low; the driver never
 * reads the busy flag and relies on the I2C byte time (~90 us at 100 kHz)
 * being longer than any command except clear, which gets its own delay.
 *
 * The backlight is on/off only: set_rgb() turns it off for 0,0,0 and on for
 * any other colour. Contrast is the pot on the backpack, not software.
 *
 * Text, cursor and scrolling live in CharLcd; see char_lcd.h.
 */
#include <cstddef>
#include <cstdint>
#include "char_lcd.h"

namespace vmaas
{
    /// 1602A + PCF8574 backpack, driven over an LcdPort.
    class Pcf8574Lcd : public CharLcd
    {
    public:
        static constexpr uint8_t ADDR_PCF8574 = 0x27;  /// PCF8574 with A0-A2 open.
        static constexpr uint8_t ADDR_PCF8574A = 0x3F; /// PCF8574A with A0-A2 open.

        /**
         * @brief Bind the driver to a port. The port must outlive the driver.
         * @param port I2C + delay implementation.
         */
        explicit Pcf8574Lcd(LcdPort& port);

        /**
         * @brief Run the HD44780 4-bit power-up sequence with the backlight on.
         *
         * Blocks for roughly 60 ms. If any write fails, the driver stays
         * uninitialised and every other call returns LcdError::NotInitialized.
         * @param addr The backpack's 7-bit address, normally from detect_lcd().
         * @return LcdError::None on success, LcdError::I2cWrite otherwise.
         */
        LcdError begin(uint8_t addr = ADDR_PCF8574);

        /**
         * @brief Backlight off for 0,0,0, on for any other colour.
         * @return LcdError::I2cWrite if the expander did not take the write.
         */
        LcdError set_rgb(uint8_t r, uint8_t g, uint8_t b) override;

    protected:
        LcdError command(uint8_t cmd) override;
        bool write_chars(const char* bytes, size_t n) override;

    private:
        bool nibble(uint8_t bits);

        uint8_t addr_ = ADDR_PCF8574;
        uint8_t backlight_ = 0; // P3 bit or 0, OR-ed into every expander byte
    };
}
