#pragma once
/**
 * @file slot_entry.h
 * @brief Turns key events into a slot number.
 *
 * Knows nothing about GPIO, I2C or FreeRTOS: it consumes KeyEvent values and
 * returns EntryState values. That is deliberate, so the purchase flow and the
 * simulator can drive the same logic the board runs.
 *
 * Only Pressed events are acted on. Released events are accepted and ignored,
 * so a caller can forward everything the keypad emits without filtering.
 */
#include <cstdint>
#include "key_event.h"
#include "entry_state.h"

namespace vmaas
{
    /// Accumulates digits, handles '*' and '#', and times out.
    class SlotEntry
    {
    public:
        /**
         * @brief Configure the entry.
         * @param max_digits Digits the buffer holds. Clamped to 1..SLOT_ENTRY_MAX_DIGITS.
         * @param timeout_ms Inactivity before a partial entry is discarded. 0 disables the timeout.
         */
        explicit SlotEntry(uint8_t max_digits = SLOT_ENTRY_MAX_DIGITS,
                           uint32_t timeout_ms = SLOT_ENTRY_TIMEOUT_MS);

        /**
         * @brief Feed one key event.
         * @param ev Event from the keypad. Released events are ignored.
         * @return The resulting state. A Confirmed, Cancelled or TimedOut status
         *         is reported once; the object is already reset when it returns.
         */
        EntryState handle(const KeyEvent& ev);

        /**
         * @brief Advance the timeout.
         * @param now_ms Caller's monotonic clock in milliseconds.
         * @return TimedOut once when the window expires on a non-empty buffer,
         *         otherwise the current Editing state.
         */
        EntryState tick(uint32_t now_ms);

        /// @brief Current buffer with status Editing. Never reports a transient status.
        EntryState state() const;

        /// @brief Empty the buffer and stop the timeout.
        void reset();

    private:
        EntryState snapshot(EntryStatus status) const;

        uint8_t max_digits_;
        uint32_t timeout_ms_;
        char buffer_[SLOT_ENTRY_MAX_DIGITS + 1] = {};
        uint8_t length_ = 0;
        uint32_t last_key_ms_ = 0;
    };
}
