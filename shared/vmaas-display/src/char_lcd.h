#pragma once
/**
 * @file char_lcd.h
 * @brief 16x2 HD44780-style character LCD: cursor, overflow and marquee logic.
 *
 * Shared by every display the Main-Controller can carry. A backend says how
 * one command byte and one run of characters reach the controller, and how
 * the backlight works; everything visible on the screen is decided here, so
 * text looks the same on each.
 *
 * Backends: GroveLcdRgb (Seeed Grove-LCD RGB Backlight) and Pcf8574Lcd (1602A
 * behind a PCF8574 I2C backpack). detect_lcd() picks one at boot.
 *
 * The driver tracks the cursor itself, so print() knows how many columns are
 * left on the row. Only the cells a text covers are written; everything else
 * on the display stays as it was.
 */
#include <cstddef>
#include <cstdint>
#include "lcd_error.h"
#include "lcd_port.h"

namespace vmaas
{
    /// What print() does with text that does not fit on the row.
    enum class Overflow : uint8_t
    {
        Truncate, /// Cut at the last column of the row.
        Wrap,     /// Continue on row 1 from column 0; cut at the end of row 1.
        Scroll    /// Marquee inside the window from the cursor column to column 15.
    };

    /**
     * @brief 16x2 character LCD, driven over an LcdPort by a backend subclass.
     *
     * Call the backend's begin() once. Then position with set_cursor() and
     * write with print(), or use print_at(). Rows printed with
     * Overflow::Scroll keep moving as long as tick() is called from the main
     * loop.
     *
     * @par Printing onto a scrolling row replaces the marquee
     *
     * Any print() or print_at() that lands on a scrolling row (for Wrap also
     * the row it spills onto) first stops that marquee and blanks the window
     * it occupied, then writes the new text. No tail of the old text stays
     * visible. All releases happen before the first byte of new text, so the
     * display is never half updated. To stop a marquee without writing, use
     * stop_scroll(), clear_row() or clear().
     */
    class CharLcd
    {
    public:
        static constexpr uint8_t COLS = 16;          /// Characters per row.
        static constexpr uint8_t ROWS = 2;           /// Number of rows.
        static constexpr size_t SCROLL_BUFFER = 64;  /// Longest text accepted by Overflow::Scroll.

        virtual ~CharLcd() = default;

        /**
         * @brief Whether the LCD part initialised, so text calls will work.
         *
         * True after a begin() that got through the LCD power-up sequence, even
         * if it then reported a backlight problem.
         */
        bool ready() const { return initialised_; }

        /// @brief Clear the display, home the cursor and stop all scrolling.
        LcdError clear();

        /**
         * @brief Overwrite one row with spaces and stop scrolling on it.
         * @param row 0 or 1.
         * @return LcdError::InvalidArgument if @p row is out of range.
         */
        LcdError clear_row(uint8_t row);

        /**
         * @brief Move the write position.
         * @param col 0..15.
         * @param row 0..1.
         * @return LcdError::InvalidArgument if out of range.
         */
        LcdError set_cursor(uint8_t col, uint8_t row);

        /**
         * @brief Write text at the current cursor.
         * @param text NUL-terminated ASCII. nullptr gives LcdError::InvalidArgument.
         * @param mode Overflow handling, see Overflow and the class description.
         * @return LcdError::InvalidArgument if Scroll text is longer than
         *         SCROLL_BUFFER. A marquee on the target row is replaced, see
         *         the class description.
         */
        LcdError print(const char* text, Overflow mode = Overflow::Truncate);

        /**
         * @brief Position the cursor and print in one call.
         *
         * Validates all arguments first, then releases any marquee the text
         * would land on, then writes the cursor command once and the text.
         * A rejected call performs no I2C write.
         */
        LcdError print_at(uint8_t col, uint8_t row, const char* text, Overflow mode = Overflow::Truncate);

        /**
         * @brief Stop a marquee and leave the currently visible slice in place.
         * @param row 0 or 1. Rows that are not scrolling are accepted silently.
         */
        LcdError stop_scroll(uint8_t row);

        /**
         * @brief Advance scrolling rows. Call once per main-loop iteration.
         *
         * The first tick after a Scroll print only records the time; the text
         * moves one character every scroll interval after that. An I2C failure
         * during a redraw is ignored; the next step redraws at the following
         * offset.
         * @warning tick() repositions the cursor when it redraws a scrolling
         *          row. After a tick, call set_cursor() or use print_at()
         *          before print(); do not rely on the cursor left by an earlier
         *          print() across a tick().
         * @param now_ms Monotonic time in milliseconds (wrap-around is handled).
         */
        void tick(uint32_t now_ms);

        /// @brief Time between marquee steps. Default 300 ms.
        void set_scroll_interval(uint32_t ms) { scroll_interval_ms_ = ms; }

        /**
         * @brief Set the backlight colour.
         *
         * Backends without colour map it to what they have; see each backend.
         */
        virtual LcdError set_rgb(uint8_t r, uint8_t g, uint8_t b) = 0;

        /// @brief Turn the text on or off. The backlight is not affected.
        LcdError display(bool on);

    protected:
        static constexpr uint8_t CMD_CLEAR = 0x01;
        static constexpr uint8_t CMD_ENTRY_MODE = 0x06;   // increment, no shift
        static constexpr uint8_t CMD_DISPLAY_OFF = 0x08;
        static constexpr uint8_t CMD_DISPLAY_ON = 0x0C;   // display on, cursor off, blink off
        static constexpr uint8_t CMD_FUNCTION_SET = 0x28; // 4-bit/serial, 2 lines, 5x8 font
        static constexpr uint8_t CMD_SET_DDRAM = 0x80;

        /// @param port Shared with the backend. Must outlive the driver.
        explicit CharLcd(LcdPort& port) : port_(port) {}

        /// Send one HD44780 instruction byte.
        virtual LcdError command(uint8_t cmd) = 0;

        /// Send @p n (1..COLS) display-data bytes in one transfer. False on a failed write.
        virtual bool write_chars(const char* bytes, size_t n) = 0;

        /// Forget the previous begin(): uninitialised, no marquees.
        void reset();

        /// The controller is up: text calls work from here, cursor at 0,0.
        void mark_ready();

        LcdPort& port_;

    private:
        struct ScrollRow
        {
            bool active = false;
            bool primed = false;              // first tick seen since print()
            char text[SCROLL_BUFFER + 3];     // text + 3 spaces padding, no NUL needed
            uint8_t len = 0;                  // strlen(text) + 3
            uint8_t window_col = 0;
            uint8_t window_width = 0;
            uint8_t offset = 0;
            uint32_t last_step_ms = 0;
        };

        LcdError data(const char* bytes, size_t n);
        LcdError write_cursor(uint8_t col, uint8_t row);
        LcdError draw_window(uint8_t row);
        LcdError release_row(uint8_t row);
        LcdError release_for_print(uint8_t col, uint8_t row, size_t n, Overflow mode, bool& released);

        bool initialised_ = false;
        uint8_t col_ = 0; // next write column, may equal COLS when the row is full
        uint8_t row_ = 0;
        uint32_t scroll_interval_ms_ = 300;
        ScrollRow scroll_[ROWS];
    };
}
