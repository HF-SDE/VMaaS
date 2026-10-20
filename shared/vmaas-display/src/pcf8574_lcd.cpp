/**
 * @file pcf8574_lcd.cpp
 * @brief Pcf8574Lcd implementation. See pcf8574_lcd.h.
 */
#include "pcf8574_lcd.h"

namespace
{
    constexpr uint8_t PIN_RS = 0x01;
    constexpr uint8_t PIN_EN = 0x04;
    constexpr uint8_t PIN_BL = 0x08;

    // The three expander bytes that clock one nibble (in the high four bits
    // of `bits`, with RS/backlight in the low ones) into the HD44780. Data is
    // set before EN rises so RS meets its address setup time.
    void pulse(uint8_t bits, uint8_t* out)
    {
        out[0] = bits;
        out[1] = static_cast<uint8_t>(bits | PIN_EN);
        out[2] = bits;
    }

    // Both nibbles of one HD44780 byte: six expander bytes.
    void byte_out(uint8_t value, uint8_t flags, uint8_t* out)
    {
        pulse(static_cast<uint8_t>((value & 0xF0) | flags), out);
        pulse(static_cast<uint8_t>(((value << 4) & 0xF0) | flags), out + 3);
    }
}

namespace vmaas
{
    Pcf8574Lcd::Pcf8574Lcd(LcdPort& port) : CharLcd(port) {}

    bool Pcf8574Lcd::nibble(uint8_t bits)
    {
        uint8_t buf[3];
        pulse(static_cast<uint8_t>(bits | backlight_), buf);
        return port_.write(addr_, buf, sizeof(buf));
    }

    LcdError Pcf8574Lcd::command(uint8_t cmd)
    {
        uint8_t buf[6];
        byte_out(cmd, backlight_, buf);
        return port_.write(addr_, buf, sizeof(buf)) ? LcdError::None : LcdError::I2cWrite;
    }

    bool Pcf8574Lcd::write_chars(const char* bytes, size_t n)
    {
        uint8_t buf[6 * COLS];
        for (size_t i = 0; i < n; ++i) {
            byte_out(static_cast<uint8_t>(bytes[i]), static_cast<uint8_t>(PIN_RS | backlight_), buf + 6 * i);
        }
        return port_.write(addr_, buf, 6 * n);
    }

    LcdError Pcf8574Lcd::begin(uint8_t addr)
    {
        reset();
        addr_ = addr;
        backlight_ = PIN_BL;

        // HD44780 datasheet fig. 24: three 0x3 nibbles put the controller in
        // 8-bit mode from any state it powered up or was left in, then 0x2
        // switches it to 4-bit. Only after that are whole bytes understood.
        port_.delay_ms(50);
        if (!nibble(0x30)) return LcdError::I2cWrite;
        port_.delay_ms(5);
        if (!nibble(0x30)) return LcdError::I2cWrite;
        port_.delay_ms(1);
        if (!nibble(0x30)) return LcdError::I2cWrite;
        port_.delay_ms(1);
        if (!nibble(0x20)) return LcdError::I2cWrite;

        if (command(CMD_FUNCTION_SET) != LcdError::None) return LcdError::I2cWrite;
        if (command(CMD_DISPLAY_ON) != LcdError::None) return LcdError::I2cWrite;
        if (command(CMD_CLEAR) != LcdError::None) return LcdError::I2cWrite;
        port_.delay_ms(2);
        if (command(CMD_ENTRY_MODE) != LcdError::None) return LcdError::I2cWrite;

        mark_ready();
        return LcdError::None;
    }

    LcdError Pcf8574Lcd::set_rgb(uint8_t r, uint8_t g, uint8_t b)
    {
        if (!ready()) return LcdError::NotInitialized;
        backlight_ = (r | g | b) != 0 ? PIN_BL : 0;
        return port_.write(addr_, &backlight_, 1) ? LcdError::None : LcdError::I2cWrite;
    }
}
