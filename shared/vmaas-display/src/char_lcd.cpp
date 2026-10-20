/**
 * @file char_lcd.cpp
 * @brief CharLcd implementation. See char_lcd.h.
 */
#include "char_lcd.h"
#include <cstring>

namespace
{
    constexpr uint8_t ROW_OFFSET[] = {0x00, 0x40};
    constexpr uint8_t SCROLL_PADDING = 3;
}

namespace vmaas
{
    void CharLcd::reset()
    {
        initialised_ = false;
        for (ScrollRow& s : scroll_) {
            s.active = false;
        }
    }

    void CharLcd::mark_ready()
    {
        initialised_ = true;
        col_ = 0;
        row_ = 0;
    }

    LcdError CharLcd::data(const char* bytes, size_t n)
    {
        if (n == 0) return LcdError::None;
        if (n > COLS) {
            n = COLS;
        }
        if (!write_chars(bytes, n)) return LcdError::I2cWrite;
        const unsigned next = col_ + n;
        col_ = next > COLS ? COLS : static_cast<uint8_t>(next);
        return LcdError::None;
    }

    LcdError CharLcd::write_cursor(uint8_t col, uint8_t row)
    {
        const LcdError err = command(static_cast<uint8_t>(CMD_SET_DDRAM | (ROW_OFFSET[row] + col)));
        if (err != LcdError::None) return err;
        col_ = col;
        row_ = row;
        return LcdError::None;
    }

    LcdError CharLcd::set_cursor(uint8_t col, uint8_t row)
    {
        if (!initialised_) return LcdError::NotInitialized;
        if (col >= COLS || row >= ROWS) return LcdError::InvalidArgument;
        return write_cursor(col, row);
    }

    LcdError CharLcd::clear()
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

    LcdError CharLcd::clear_row(uint8_t row)
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

    LcdError CharLcd::display(bool on)
    {
        if (!initialised_) return LcdError::NotInitialized;
        return command(on ? CMD_DISPLAY_ON : CMD_DISPLAY_OFF);
    }

    // Stop the marquee on `row` (if any) and blank the window it occupied, so
    // no tail of the old text stays visible. Leaves the cursor at the end of
    // that window; callers reposition afterwards.
    LcdError CharLcd::release_row(uint8_t row)
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
    LcdError CharLcd::release_for_print(uint8_t col, uint8_t row, size_t n, Overflow mode, bool& released)
    {
        released = false;
        if (scroll_[row].active) {
            released = true;
            const LcdError err = release_row(row);
            if (err != LcdError::None) return err;
        }
        const bool spills = mode == Overflow::Wrap && row == 0 && n > static_cast<size_t>(COLS - col);
        if (spills && scroll_[1].active) {
            released = true;
            return release_row(1);
        }
        return LcdError::None;
    }

    LcdError CharLcd::print(const char* text, Overflow mode)
    {
        if (!initialised_) return LcdError::NotInitialized;
        if (text == nullptr) return LcdError::InvalidArgument;

        const size_t n = std::strlen(text);
        if (mode == Overflow::Scroll && n > SCROLL_BUFFER) return LcdError::InvalidArgument;

        const uint8_t col = col_;
        const uint8_t row = row_;
        bool released = false;
        LcdError err = release_for_print(col, row, n, mode, released);
        if (err != LcdError::None) return err;
        if (released) {
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
            if (remaining == 0) return LcdError::None;
            if (n <= remaining) return data(text, n);
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

    LcdError CharLcd::print_at(uint8_t col, uint8_t row, const char* text, Overflow mode)
    {
        if (!initialised_) return LcdError::NotInitialized;
        if (col >= COLS || row >= ROWS) return LcdError::InvalidArgument;
        if (text == nullptr) return LcdError::InvalidArgument;

        const size_t n = std::strlen(text);
        if (mode == Overflow::Scroll && n > SCROLL_BUFFER) return LcdError::InvalidArgument;

        bool released = false;
        LcdError err = release_for_print(col, row, n, mode, released);
        if (err != LcdError::None) return err;

        err = write_cursor(col, row);
        if (err != LcdError::None) return err;
        return print(text, mode);
    }

    LcdError CharLcd::stop_scroll(uint8_t row)
    {
        if (!initialised_) return LcdError::NotInitialized;
        if (row >= ROWS) return LcdError::InvalidArgument;
        scroll_[row].active = false;
        return LcdError::None;
    }

    LcdError CharLcd::draw_window(uint8_t row)
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

    void CharLcd::tick(uint32_t now_ms)
    {
        if (!initialised_) return;
        for (uint8_t row = 0; row < ROWS; ++row)
        {
            ScrollRow& s = scroll_[row];
            if (!s.active) {
                continue;
            }
            if (!s.primed) {
                s.primed = true;
                s.last_step_ms = now_ms;
                continue;
            }
            if (static_cast<uint32_t>(now_ms - s.last_step_ms) < scroll_interval_ms_) {
                continue;
            }

            s.last_step_ms = now_ms;
            s.offset = static_cast<uint8_t>((s.offset + 1) % s.len);
            draw_window(row);
        }
    }
}
