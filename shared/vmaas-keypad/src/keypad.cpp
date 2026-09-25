/**
 * @file keypad.cpp
 * @brief Matrix scan, debounce and event queue.
 */
#include "keypad.h"

namespace vmaas
{
    Keypad::Keypad(KeypadPort& port, uint32_t debounce_ms): port_(port), debounce_ms_(debounce_ms) {}

    char Keypad::key_of(size_t index)
    {
        return KEYPAD_KEY_MAP[index / KEYPAD_COL_COUNT][index % KEYPAD_COL_COUNT];
    }

    KeypadError Keypad::begin(const int* rows, size_t row_count, const int* cols, size_t col_count)
    {
        ready_ = false;

        if (rows == nullptr || cols == nullptr)
            return KeypadError::BadPinConfig;
        if (row_count != KEYPAD_ROW_COUNT || col_count != KEYPAD_COL_COUNT)
            return KeypadError::BadPinConfig;

        // Gather every pin once so a row/column clash is caught as easily as a
        // row/row one. A repeated pin means two lines are shorted on the board.
        int all[KEYPAD_ROW_COUNT + KEYPAD_COL_COUNT];
        for (size_t i = 0; i < row_count; ++i) all[i] = rows[i];
        for (size_t i = 0; i < col_count; ++i) all[row_count + i] = cols[i];

        const size_t total = row_count + col_count;
        for (size_t i = 0; i < total; ++i)
        {
            if (all[i] < 0)
                return KeypadError::BadPinConfig;
            for (size_t j = 0; j < i; ++j)
                if (all[i] == all[j])
                    return KeypadError::BadPinConfig;
        }

        const KeypadError err = port_.configure(rows, row_count, cols, col_count);
        if (err != KeypadError::None)
            return err;

        for (size_t k = 0; k < KEYPAD_KEY_COUNT; ++k)
        {
            raw_[k] = false;
            stable_[k] = false;
            changed_at_[k] = 0;
        }
        active_ = -1;
        head_ = tail_ = count_ = 0;
        dropped_ = 0;

        ready_ = true;
        return KeypadError::None;
    }

    void Keypad::tick(uint32_t now_ms)
    {
        if (!ready_)
            return;

        // One row low at a time. Any other row left low would let a second
        // switch pull the same column down and blur two keys into one.
        uint16_t raw = 0;
        for (size_t r = 0; r < KEYPAD_ROW_COUNT; ++r)
        {
            port_.drive_row(r, false);              // select: drive low
            for (size_t c = 0; c < KEYPAD_COL_COUNT; ++c)
                if (!port_.read_col(c))             // low against the pull-up = pressed
                    raw |= static_cast<uint16_t>(1u << (r * KEYPAD_COL_COUNT + c));
            port_.drive_row(r, true);               // deselect: back high
        }

        debounce(raw, now_ms);
    }

    bool Keypad::next_event(KeyEvent& out)
    {
        if (count_ == 0)
            return false;
        out = queue_[head_];
        head_ = (head_ + 1) % QUEUE_SIZE;
        --count_;
        return true;
    }

    void Keypad::push(char key, KeyEventType type, uint32_t at_ms)
    {
        if (count_ == QUEUE_SIZE)
        {
            ++dropped_;
            return;
        }
        queue_[tail_] = KeyEvent{key, type, at_ms};
        tail_ = (tail_ + 1) % QUEUE_SIZE;
        ++count_;
    }

    void Keypad::debounce(uint16_t raw, uint32_t now_ms)
    {
        for (size_t k = 0; k < KEYPAD_KEY_COUNT; ++k)
        {
            const bool bit = ((raw >> k) & 1u) != 0u;

            // Any movement restarts the clock: chatter never accumulates credit.
            if (bit != raw_[k])
            {
                raw_[k] = bit;
                changed_at_[k] = now_ms;
                continue;
            }
            if (bit == stable_[k])
                continue;
            if (now_ms - changed_at_[k] < debounce_ms_)
                continue;

            stable_[k] = bit;

            // The single-key gate. stable_ is updated either way, so an ignored
            // key does not emit a stray Released when it comes back up.
            if (bit)
            {
                if (active_ < 0)
                {
                    active_ = static_cast<int>(k);
                    push(key_of(k), KeyEventType::Pressed, now_ms);
                }
            }
            else if (active_ == static_cast<int>(k))
            {
                active_ = -1;
                push(key_of(k), KeyEventType::Released, now_ms);
            }
        }
    }
}
