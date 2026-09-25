#pragma once
/**
 * @file keypad.h
 * @brief Debounced scanner for a passive 4x3 matrix keypad (SparkFun COM-14662).
 *
 * The keypad has no driver chip: 12 switches share 7 lines, each switch
 * joining one row to one column. tick() drives each row low in turn and
 * samples the columns, then debounces in the time domain against the caller's
 * clock. Because now_ms is a parameter rather than a call into FreeRTOS.
 *
 * tick() never blocks and never sleeps: one call is one scan pass. On the
 * board a dedicated task calls it every KEYPAD_DEFAULT_SCAN_MS.
 *
 * @section keypad_onekey One key at a time
 *
 * The matrix has no diodes, so three simultaneous presses can make a fourth
 * key read as pressed. The driver therefore reports at most one key: while a
 * key is held, other presses are ignored until it is released. That removes
 * ghosting entirely and matches how a vending keypad is used.
 */
#include <cstddef>
#include <cstdint>
#include "key_event.h"
#include "keypad_error.h"
#include "keypad_port.h"

namespace vmaas
{
    /// Rows in the matrix. Fixed by the key map.
    inline constexpr size_t KEYPAD_ROW_COUNT = 4;
    /// Columns in the matrix. Fixed by the key map.
    inline constexpr size_t KEYPAD_COL_COUNT = 3;
    /// Switches in the matrix.
    inline constexpr size_t KEYPAD_KEY_COUNT = KEYPAD_ROW_COUNT * KEYPAD_COL_COUNT;
    /// How long a raw state must hold before it is believed, in milliseconds.
    inline constexpr uint32_t KEYPAD_DEFAULT_DEBOUNCE_MS = 20;
    /// Recommended gap between tick() calls, in milliseconds. Keep it at or
    /// below half the debounce window so a press is sampled several times.
    inline constexpr uint32_t KEYPAD_DEFAULT_SCAN_MS = 10;

    /// Standard keypad layout, indexed [row][col].
    inline constexpr char KEYPAD_KEY_MAP[KEYPAD_ROW_COUNT][KEYPAD_COL_COUNT] = {
        {'1', '2', '3'},
        {'4', '5', '6'},
        {'7', '8', '9'},
        {'*', '0', '#'},
    };

    /// Scans a 4x3 matrix keypad and emits debounced KeyEvents.
    class Keypad
    {
    public:
        /**
         * @brief Bind the driver to a port. The port must outlive the driver.
         * @param port Row-drive and column-read abstraction.
         * @param debounce_ms How long a raw state must hold before it is accepted.
         */
        explicit Keypad(KeypadPort& port, uint32_t debounce_ms = KEYPAD_DEFAULT_DEBOUNCE_MS);

        /**
         * @brief Validate the pins and claim them through the port.
         * @param rows Row GPIO numbers, exactly KEYPAD_ROW_COUNT of them.
         * @param row_count Must equal KEYPAD_ROW_COUNT.
         * @param cols Column GPIO numbers, exactly KEYPAD_COL_COUNT of them.
         * @param col_count Must equal KEYPAD_COL_COUNT.
         * @return None on success; BadPinConfig for a null array, a negative pin,
         *         a duplicate pin or a wrong count; GpioInitFailed if the port refused.
         */
        KeypadError begin(const int* rows, size_t row_count,
                          const int* cols, size_t col_count);

        /**
         * @brief Run one scan pass and update the debounce state.
         * @param now_ms Caller's monotonic clock in milliseconds.
         *
         * Does nothing when begin() has not succeeded. Never blocks.
         */
        void tick(uint32_t now_ms);

        /**
         * @brief Take the oldest pending event.
         * @param out Filled in when an event was waiting.
         * @return false when the queue is empty.
         */
        bool next_event(KeyEvent& out);

        /**
         * @brief Change the debounce window after construction.
         *
         * The Main-Controller reads this from config.json, which is not
         * available when the object is constructed at file scope.
         * @param debounce_ms How long a raw state must hold before it is accepted.
         */
        void set_debounce_ms(uint32_t debounce_ms) { debounce_ms_ = debounce_ms; }

        /// @brief True once begin() has succeeded.
        bool ready() const { return ready_; }

        /// @brief Events discarded because the queue was full. Diagnostics only.
        uint32_t dropped_events() const { return dropped_; }

    private:
        /// Depth of the internal ring buffer.
        static constexpr size_t QUEUE_SIZE = 16;

        void debounce(uint16_t raw, uint32_t now_ms);
        void push(char key, KeyEventType type, uint32_t at_ms);
        static char key_of(size_t index);

        KeypadPort& port_;
        uint32_t debounce_ms_;
        bool ready_ = false;

        bool raw_[KEYPAD_KEY_COUNT] = {};            // last sampled state per key
        bool stable_[KEYPAD_KEY_COUNT] = {};         // accepted state per key
        uint32_t changed_at_[KEYPAD_KEY_COUNT] = {}; // when raw_ last moved
        int active_ = -1;                            // key index currently reported, or -1

        KeyEvent queue_[QUEUE_SIZE] = {};
        size_t head_ = 0;
        size_t tail_ = 0;
        size_t count_ = 0;
        uint32_t dropped_ = 0;
    };
}
