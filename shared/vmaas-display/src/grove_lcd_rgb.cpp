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

    constexpr uint8_t CMD_CLEAR = 0x01;
    constexpr uint8_t CMD_ENTRY_MODE = 0x06;   // increment, no shift
    constexpr uint8_t CMD_DISPLAY_OFF = 0x08;
    constexpr uint8_t CMD_DISPLAY_ON = 0x0C;   // display on, cursor off, blink off
    constexpr uint8_t CMD_FUNCTION_SET = 0x28; // 2 lines, 5x8 font
    constexpr uint8_t CMD_SET_DDRAM = 0x80;

    constexpr uint8_t ROW_OFFSET[] = {0x00, 0x40};

    // PCA9633 (v4.0)
    constexpr uint8_t PCA_MODE1 = 0x00, PCA_MODE2 = 0x01, PCA_LEDOUT = 0x08;
    constexpr uint8_t PCA_BLUE = 0x02, PCA_GREEN = 0x03, PCA_RED = 0x04;
    // SGM31323 (v5.0)
    constexpr uint8_t SGM_ENABLE = 0x00, SGM_MODE = 0x04;
    constexpr uint8_t SGM_RED = 0x06, SGM_GREEN = 0x07, SGM_BLUE = 0x08;

    constexpr uint8_t SCROLL_PADDING = 3;
}

namespace vmaas
{
    GroveLcdRgb::GroveLcdRgb(LcdPort& port) : port_(port) {}

    LcdError GroveLcdRgb::command(uint8_t cmd)
    {
        const uint8_t buf[2] = {CTRL_COMMAND, cmd};
        return port_.write(LCD_ADDR, buf, sizeof(buf)) ? LcdError::None : LcdError::I2cWrite;
    }

    LcdError GroveLcdRgb::data(const char* bytes, size_t n)
    {
        if (n == 0) return LcdError::None;
        uint8_t buf[1 + COLS];
        if (n > COLS) n = COLS;
        buf[0] = CTRL_DATA;
        std::memcpy(buf + 1, bytes, n);
        if (!port_.write(LCD_ADDR, buf, n + 1)) return LcdError::I2cWrite;
        const unsigned next = col_ + n;
        col_ = next > COLS ? COLS : static_cast<uint8_t>(next);
        return LcdError::None;
    }

    LcdError GroveLcdRgb::write_cursor(uint8_t col, uint8_t row)
    {
        const LcdError err = command(static_cast<uint8_t>(CMD_SET_DDRAM | (ROW_OFFSET[row] + col)));
        if (err != LcdError::None) return err;
        col_ = col;
        row_ = row;
        return LcdError::None;
    }

    bool GroveLcdRgb::rgb_reg(uint8_t addr, uint8_t reg, uint8_t value)
    {
        const uint8_t buf[2] = {reg, value};
        return port_.write(addr, buf, sizeof(buf));
    }

    LcdError GroveLcdRgb::begin()
    {
        initialised_ = false;
        rgb_ = RgbChip::None;
        for (ScrollRow& s : scroll_) {
            s.active = false;
        }

        port_.delay_ms(50);
        if (command(CMD_FUNCTION_SET) != LcdError::None) return LcdError::I2cWrite;
        port_.delay_ms(5);
        if (command(CMD_FUNCTION_SET) != LcdError::None) return LcdError::I2cWrite;
        port_.delay_ms(1);
        if (command(CMD_DISPLAY_ON) != LcdError::None) return LcdError::I2cWrite;
        if (command(CMD_CLEAR) != LcdError::None) return LcdError::I2cWrite;
        port_.delay_ms(2);
        if (command(CMD_ENTRY_MODE) != LcdError::None) return LcdError::I2cWrite;

        initialised_ = true;
        col_ = 0;
        row_ = 0;

        if (rgb_reg(RGB_ADDR_V5, SGM_ENABLE, 0x07))
        {
            rgb_ = RgbChip::Sgm31323;
            if (!rgb_reg(RGB_ADDR_V5, SGM_MODE, 0x15)) {
                return LcdError::I2cWrite;
            }
        }
        else if (rgb_reg(RGB_ADDR_V4, PCA_MODE1, 0x00))
        {
            rgb_ = RgbChip::Pca9633;
            if (!rgb_reg(RGB_ADDR_V4, PCA_LEDOUT, 0xFF)) {
                return LcdError::I2cWrite;
            }
            if (!rgb_reg(RGB_ADDR_V4, PCA_MODE2, 0x20)) {
                return LcdError::I2cWrite;
            }
        }
        else
        {
            return LcdError::RgbChipNotFound;
        }
        return set_rgb(255, 255, 255);
    }

    LcdError GroveLcdRgb::set_rgb(uint8_t r, uint8_t g, uint8_t b)
    {
        if (!initialised_) return LcdError::NotInitialized;
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

    LcdError GroveLcdRgb::set_cursor(uint8_t col, uint8_t row)
    {
        if (!initialised_) return LcdError::NotInitialized;
        if (col >= COLS || row >= ROWS) return LcdError::InvalidArgument;
        return write_cursor(col, row);
    }

    LcdError GroveLcdRgb::clear()
    {
        if (!initialised_) return LcdError::NotInitialized;
        const LcdError err = command(CMD_CLEAR);
        if (err != LcdError::None) return err;
        port_.delay_ms(2);
        col_ = 0;
        row_ = 0;
        for (ScrollRow& s : scroll_) {
            s.active = false;
        }
        return LcdError::None;
    }

    LcdError GroveLcdRgb::clear_row(uint8_t row)
    {
        if (!initialised_) return LcdError::NotInitialized;
        if (row >= ROWS) return LcdError::InvalidArgument;
        scroll_[row].active = false;
        const LcdError err = write_cursor(0, row);
        if (err != LcdError::None) return err;
        char spaces[COLS];
        std::memset(spaces, ' ', COLS);
        return data(spaces, COLS);
    }

    LcdError GroveLcdRgb::display(bool on)
    {
        if (!initialised_) return LcdError::NotInitialized;
        return command(on ? CMD_DISPLAY_ON : CMD_DISPLAY_OFF);
    }

    // Stop the marquee on `row` (if any) and blank the window it occupied, so
    // no tail of the old text stays visible. Leaves the cursor at the end of
    // that window; callers reposition afterwards.
    LcdError GroveLcdRgb::release_row(uint8_t row)
    {
        ScrollRow& s = scroll_[row];
        if (!s.active) return LcdError::None;
        s.active = false;
        const LcdError err = write_cursor(s.window_col, row);
        if (err != LcdError::None) return err;
        char spaces[COLS];
        std::memset(spaces, ' ', COLS);
        return data(spaces, s.window_width);
    }

    // Release every marquee a print of `n` chars at (col,row) in `mode` would
    // land on: the target row, and for a spilling Wrap also row 1. Runs before
    // any new text is written so the display is never half updated.
    LcdError GroveLcdRgb::release_for_print(uint8_t col, uint8_t row, size_t n, Overflow mode, bool& released)
    {
        released = false;
        if (scroll_[row].active)
        {
            released = true;
            const LcdError err = release_row(row);
            if (err != LcdError::None) return err;
        }
        const bool spills = mode == Overflow::Wrap && row == 0 && n > static_cast<size_t>(COLS - col);
        if (spills && scroll_[1].active)
        {
            released = true;
            return release_row(1);
        }
        return LcdError::None;
    }

    LcdError GroveLcdRgb::print(const char* text, Overflow mode)
    {
        if (!initialised_) return LcdError::NotInitialized;
        if (text == nullptr) return LcdError::InvalidArgument;

        const size_t n = std::strlen(text);
        if (mode == Overflow::Scroll && n > SCROLL_BUFFER) return LcdError::InvalidArgument;

        // Replace any marquee we would land on, then come back to where the
        // caller positioned us (release_row moves the cursor).
        const uint8_t col = col_;
        const uint8_t row = row_;
        bool released = false;
        LcdError err = release_for_print(col, row, n, mode, released);
        if (err != LcdError::None) return err;
        if (released)
        {
            err = write_cursor(col, row);
            if (err != LcdError::None) return err;
        }

        const size_t remaining = COLS - col_;

        switch (mode)
        {
        case Overflow::Truncate:
        {
            return data(text, n < remaining ? n : remaining);
        }
        case Overflow::Wrap:
        {
            const size_t first = n < remaining ? n : remaining;
            const bool spill = n > first && row_ == 0;

            err = data(text, first);
            if (err != LcdError::None) return err;
            if (!spill) return LcdError::None;

            err = write_cursor(0, 1);
            if (err != LcdError::None) return err;
            const size_t rest = n - first;
            return data(text + first, rest < COLS ? rest : COLS);
        }
        case Overflow::Scroll:
        {
            if (remaining == 0) {
                return LcdError::None; // nothing visible could scroll; same as Truncate on a full row
            }
            if (n <= remaining) {
                return data(text, n);
            }
            ScrollRow& s = scroll_[row_];
            std::memcpy(s.text, text, n);
            std::memset(s.text + n, ' ', SCROLL_PADDING);
            s.len = static_cast<uint8_t>(n + SCROLL_PADDING);
            s.window_col = col_;
            s.window_width = static_cast<uint8_t>(remaining);
            s.offset = 0;
            s.primed = false;
            s.active = true;
            return draw_window(row_);
        }
        }
        return LcdError::InvalidArgument;
    }

    LcdError GroveLcdRgb::print_at(uint8_t col, uint8_t row, const char* text, Overflow mode)
    {
        if (!initialised_) return LcdError::NotInitialized;
        if (col >= COLS || row >= ROWS) return LcdError::InvalidArgument;
        if (text == nullptr) return LcdError::InvalidArgument;

        const size_t n = std::strlen(text);
        if (mode == Overflow::Scroll && n > SCROLL_BUFFER) return LcdError::InvalidArgument;

        // Release first, so the cursor command below is the only positioning
        // write for the text itself (print() then finds no active marquee).
        bool released = false;
        LcdError err = release_for_print(col, row, n, mode, released);
        if (err != LcdError::None) return err;

        err = write_cursor(col, row);
        if (err != LcdError::None) return err;
        return print(text, mode);
    }

    LcdError GroveLcdRgb::stop_scroll(uint8_t row)
    {
        if (!initialised_) return LcdError::NotInitialized;
        if (row >= ROWS) return LcdError::InvalidArgument;
        scroll_[row].active = false;
        return LcdError::None;
    }

    LcdError GroveLcdRgb::draw_window(uint8_t row)
    {
        ScrollRow& s = scroll_[row];
        char slice[COLS];
        for (uint8_t i = 0; i < s.window_width; ++i) {
            slice[i] = s.text[(s.offset + i) % s.len];
        }
        const LcdError err = write_cursor(s.window_col, row);
        if (err != LcdError::None) return err;
        return data(slice, s.window_width);
    }

    void GroveLcdRgb::tick(uint32_t now_ms)
    {
        if (!initialised_) return;
        for (uint8_t row = 0; row < ROWS; ++row)
        {
            ScrollRow& s = scroll_[row];
            if (!s.active) continue;
            if (!s.primed)
            {
                s.primed = true;
                s.last_step_ms = now_ms;
                continue;
            }
            if (static_cast<uint32_t>(now_ms - s.last_step_ms) < scroll_interval_ms_) continue;
            
            s.last_step_ms = now_ms;
            s.offset = static_cast<uint8_t>((s.offset + 1) % s.len);
            draw_window(row); // failures are ignored; the next step redraws
        }
    }
}
