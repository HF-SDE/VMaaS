#pragma once
/**
 * @file grove_lcd_rgb.h
 * @brief Driver for the Seeed Grove-LCD RGB Backlight (16x2 LCD + RGB backlight).
 *
 * Pure C++17 with no hardware dependency: all I2C traffic goes through an
 * LcdPort, so the driver is unit-tested on the host. Supports v4.0 (PCA9633
 * backlight at 0x62) and v5.0 (SGM31323 at 0x30); the chip is probed in
 * begin(). The LCD controller (AiP31068L, 0x3E) is HD44780-compatible.
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
     * @brief 16x2 character LCD with RGB backlight, driven over an LcdPort.
     *
     * Call begin() once. Then position with set_cursor() and write with
     * print(), or use print_at(). Rows printed with Overflow::Scroll keep
     * moving as long as tick() is called from the main loop.
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
    class GroveLcdRgb
    {
    public:
        static constexpr uint8_t COLS = 16;          /// Characters per row.
        static constexpr uint8_t ROWS = 2;           /// Number of rows.
        static constexpr size_t SCROLL_BUFFER = 64;  /// Longest text accepted by Overflow::Scroll.
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
         * @brief Whether the LCD part initialised, so text calls will work.
         *
         * True after a begin() that got through the LCD power-up sequence, even
         * if it then returned RgbChipNotFound or I2cWrite for the backlight chip.
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
         * @return LcdError::RgbChipNotFound if begin() found no backlight chip.
         */
        LcdError set_rgb(uint8_t r, uint8_t g, uint8_t b);

        /// @brief Turn the text on or off. The backlight is not affected.
        LcdError display(bool on);

    private:
        enum class RgbChip : uint8_t { None, Pca9633, Sgm31323 };

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

        LcdError command(uint8_t cmd);
        LcdError data(const char* bytes, size_t n);
        LcdError write_cursor(uint8_t col, uint8_t row);
        bool rgb_reg(uint8_t addr, uint8_t reg, uint8_t value);
        LcdError draw_window(uint8_t row);
        LcdError release_row(uint8_t row);
        LcdError release_for_print(uint8_t col, uint8_t row, size_t n, Overflow mode, bool& released);

        LcdPort& port_;
        bool initialised_ = false;
        RgbChip rgb_ = RgbChip::None;
        uint8_t col_ = 0; // next write column, may equal COLS when the row is full
        uint8_t row_ = 0;
        uint32_t scroll_interval_ms_ = 300;
        ScrollRow scroll_[ROWS];
    };
}
