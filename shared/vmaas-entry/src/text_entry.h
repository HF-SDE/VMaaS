#pragma once
/**
 * @file text_entry.h
 * @brief Character picker for a 16x2 display and a 12-key keypad.
 *
 * Row 0 shows the text, row 1 a window of the active character set with one
 * character bracketed. No display and no GPIO: feed it key events and ask what
 * the rows say.
 *
 * Keypad, as decided in the onboarding design:
 *
 *     1  previous character      2  cycle charset      3  next character
 *     4  cursor left             5  insert             6  cursor right
 *     7  jump five back          8  reveal (masked fields only)
 *     9  jump five forward
 *     *  delete, or leave the field when it is empty
 *     0  space                   #  field done
 */
#include <cstddef>
#include <cstdint>
#include "key_event.h"

namespace vmaas
{
    /// Longest text accepted, including the NUL. A WPA2 passphrase is at most 63 characters.
    constexpr size_t TEXT_ENTRY_MAX = 64;

    /// How far 7 and 9 move the selection.
    constexpr size_t TEXT_ENTRY_JUMP = 5;

    /// How long 8 shows a masked field in clear, in milliseconds.
    constexpr uint32_t TEXT_ENTRY_REVEAL_MS = 2000;

    /// Characters visible in the picker row at once.
    constexpr size_t TEXT_ENTRY_WINDOW = 8;

    /// Which character table 2 has selected.
    enum class Charset : uint8_t
    {
        Lower,   ///< a-z
        Upper,   ///< A-Z
        Digits,  ///< 0-9
        Symbols, ///< !"#$%&'()*+,-./:;<=>?@[\]^_{|}~
    };

    /// What the caller should do about the field.
    enum class TextEntryStatus : uint8_t
    {
        Editing,   ///< Still typing.
        Done,      ///< '#' on a field that may be submitted.
        Cancelled, ///< '*' on an empty field: leave this screen.
    };

    /// Everything the caller needs to draw the two rows.
    struct TextEntryState
    {
        TextEntryStatus status; ///< Editing until '#' or a '*' on an empty field.
        const char* text;       ///< What has been typed. Always NUL-terminated.
        char display[17];       ///< Row 0: the text, masked when masking is on.
        char picker[17];        ///< Row 1: the charset window, selection in brackets.
    };

    /// Character picker. Fixed buffers, no heap.
    class TextEntry
    {
    public:
        /**
         * @brief Configure the field.
         * @param max_len Characters accepted, clamped to TEXT_ENTRY_MAX - 1.
         * @param mask true for a password: every character but the one left of
         *        the cursor shows as '*', unless 8 has started a reveal.
         * @param allow_empty true when '#' may submit an empty field. Passwords
         *        allow it (open networks have none); an SSID does not.
         */
        TextEntry(size_t max_len, bool mask, bool allow_empty);

        /**
         * @brief Feed one key event.
         * @param ev Event from the keypad. Released events are ignored.
         * @return The resulting state. A Done or Cancelled status is
         *         informational only; the object is not reset by it, so the
         *         caller decides when to move on or call reset().
         */
        TextEntryState handle(const KeyEvent& ev);

        /**
         * @brief Advance the reveal timer.
         * @param now_ms Caller's monotonic clock in milliseconds.
         * @return The current state with status Editing. Ends the reveal once
         *         now_ms reaches the deadline set by '8'.
         */
        TextEntryState tick(uint32_t now_ms);

        /// @brief Current state without changing anything.
        TextEntryState state() const;

        /// @brief Empty the buffer, reset the cursor, charset and selection.
        void reset();

    private:
        TextEntryState snapshot(TextEntryStatus status) const;
        void render_display(char* out) const;
        void render_picker(char* out) const;
        const char* table() const;
        size_t table_len() const;
        void insert(char c);
        void erase_left();

        size_t max_len_;
        bool mask_;
        bool allow_empty_;

        char buffer_[TEXT_ENTRY_MAX] = {};
        size_t length_ = 0;
        size_t cursor_ = 0;        ///< 0..length_; insertion happens here.
        Charset charset_ = Charset::Lower;
        size_t selected_ = 0;      ///< Index into the active table.
        uint32_t reveal_until_ms_ = 0;
        bool revealing_ = false;
    };
}
