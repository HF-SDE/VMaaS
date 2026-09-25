/**
 * @file slot_entry.cpp
 * @brief Buffer, '*', '#' and the inactivity timeout.
 */
#include "slot_entry.h"

namespace vmaas
{
    SlotEntry::SlotEntry(uint8_t max_digits, uint32_t timeout_ms): max_digits_(max_digits), timeout_ms_(timeout_ms)
    {
        if (max_digits_ < 1)
            max_digits_ = 1;
        if (max_digits_ > SLOT_ENTRY_MAX_DIGITS)
            max_digits_ = SLOT_ENTRY_MAX_DIGITS;
        reset();
    }

    void SlotEntry::reset()
    {
        for (uint8_t i = 0; i <= SLOT_ENTRY_MAX_DIGITS; ++i)
            buffer_[i] = '\0';
        length_ = 0;
        last_key_ms_ = 0;
    }

    EntryState SlotEntry::snapshot(EntryStatus status) const
    {
        EntryState st{};
        for (uint8_t i = 0; i <= SLOT_ENTRY_MAX_DIGITS; ++i)
            st.buffer[i] = buffer_[i];
        st.status = status;
        return st;
    }

    EntryState SlotEntry::state() const
    {
        return snapshot(EntryStatus::Editing);
    }

    EntryState SlotEntry::tick(uint32_t now_ms)
    {
        if (timeout_ms_ == 0 || length_ == 0)
            return state();
        if (now_ms - last_key_ms_ < timeout_ms_)
            return state();

        const EntryState out = snapshot(EntryStatus::TimedOut);
        reset();
        return out;
    }

    EntryState SlotEntry::handle(const KeyEvent& ev)
    {
        if (ev.type != KeyEventType::Pressed)
            return state();

        last_key_ms_ = ev.at_ms;

        // numeric keys
        if (ev.key >= '0' && ev.key <= '9')
        {
            // Shift left
            if (length_ >= max_digits_)
            {
                // A leading zero is kept, so "07" confirms as slot 7.
                for (uint8_t i = 0; i + 1 < max_digits_; ++i)
                    buffer_[i] = buffer_[i + 1];
                buffer_[max_digits_ - 1] = ev.key;
                buffer_[max_digits_] = '\0';
            }
            else
            {
                buffer_[length_++] = ev.key;
                buffer_[length_] = '\0';
            }
            return state();
        }

        if (ev.key == '*')
        {
            if (length_ == 0)
            {
                reset();
                return snapshot(EntryStatus::Cancelled);
            }
            buffer_[--length_] = '\0';
            return state();
        }

        if (ev.key == '#')
        {
            // '#' on an empty buffer cancels rather than doing nothing, so
            // either key gets a customer out of a half-started entry.
            if (length_ == 0)
            {
                reset();
                return snapshot(EntryStatus::Cancelled);
            }
            const EntryState out = snapshot(EntryStatus::Confirmed);
            reset();
            return out;
        }

        return state();
    }
}
