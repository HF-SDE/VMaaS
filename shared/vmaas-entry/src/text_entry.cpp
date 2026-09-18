#include "text_entry.h"

#include <cstring>

namespace vmaas
{
    namespace
    {
        constexpr const char* LOWER   = "abcdefghijklmnopqrstuvwxyz";
        constexpr const char* UPPER   = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        constexpr const char* DIGITS  = "0123456789";
        constexpr const char* SYMBOLS = "!\"#$%&'()*+,-./:;<=>?@[\\]^_{|}~";

        Charset next_charset(Charset c)
        {
            switch (c)
            {
                case Charset::Lower:   return Charset::Upper;
                case Charset::Upper:   return Charset::Digits;
                case Charset::Digits:  return Charset::Symbols;
                case Charset::Symbols: return Charset::Lower;
            }
            return Charset::Lower;
        }
    }

    TextEntry::TextEntry(size_t max_len, bool mask, bool allow_empty): max_len_(max_len > TEXT_ENTRY_MAX - 1 ? TEXT_ENTRY_MAX - 1 : max_len), mask_(mask), allow_empty_(allow_empty)
    {
    }

    const char* TextEntry::table() const
    {
        switch (charset_)
        {
            case Charset::Lower:  return LOWER;
            case Charset::Upper:  return UPPER;
            case Charset::Digits: return DIGITS;
            case Charset::Symbols:return SYMBOLS;
        }
        return LOWER;
    }

    size_t TextEntry::table_len() const { return std::strlen(table()); }

    /*
     * Row 1 is built from a window of TEXT_ENTRY_WINDOW characters joined by
     * single spaces - 8 characters and 7 separators, 15 columns. The separator
     * immediately left of the selection becomes '[' and the one immediately
     * right becomes ']', so the row stays 15 columns and is padded to 16.
     * At the window edges there is no separator to replace, so the bracket is
     * inserted instead and no padding is needed.
     */
    void TextEntry::render_picker(char* out) const
    {
        const char* t = table();
        const size_t len = table_len();

        // Keep the selection at window index 3 where the table allows it.
        size_t start = (selected_ > 3) ? selected_ - 3 : 0;
        if (len > TEXT_ENTRY_WINDOW && start + TEXT_ENTRY_WINDOW > len) {
            start = len - TEXT_ENTRY_WINDOW;
        }
        const size_t count = (len - start < TEXT_ENTRY_WINDOW) ? len - start : TEXT_ENTRY_WINDOW;

        size_t col = 0;
        for (size_t i = 0; i < count && col < 16; ++i)
        {
            const size_t idx = start + i;
            if (idx == selected_)
            {
                if (col < 16) out[col++] = '[';
                if (col < 16) out[col++] = t[idx];
                if (col < 16) out[col++] = ']';
            }
            else
            {
                // The separator before this character, unless a ']' already
                // provided one or this is the first column.
                if (col > 0 && out[col - 1] != ']' && col < 16) {
                    out[col++] = ' ';
                }
                if (col < 16){
                    out[col++] = t[idx];
                }
            }
        }
        while (col < 16) {
            out[col++] = ' ';
        }
        out[16] = '\0';
    }

    /*
     * Row 0 is a 16-column window into buffer_, not the whole buffer: text
     * can run to TEXT_ENTRY_MAX - 1 characters, far more than fits. The
     * window follows the cursor so the character being typed is always
     * visible, sliding back as '4' moves the cursor back into the text.
     */
    void TextEntry::render_display(char* out) const
    {
        const bool clear = !mask_ || revealing_;
        const size_t start = (cursor_ > 16) ? cursor_ - 16 : 0;
        size_t n = 0;
        for (; n < 16 && start + n < length_; ++n)
        {
            const size_t idx = start + n;
            const bool at_cursor = (cursor_ > 0 && idx == cursor_ - 1);
            out[n] = (clear || at_cursor) ? buffer_[idx] : '*';
        }
        out[n] = '\0';
    }

    TextEntryState TextEntry::snapshot(TextEntryStatus status) const
    {
        TextEntryState st{};
        st.status = status;
        st.text = buffer_;
        render_display(st.display);
        render_picker(st.picker);
        return st;
    }

    TextEntryState TextEntry::state() const { return snapshot(TextEntryStatus::Editing); }

    void TextEntry::reset()
    {
        buffer_[0] = '\0';
        length_ = 0;
        cursor_ = 0;
        charset_ = Charset::Lower;
        selected_ = 0;
        revealing_ = false;
        reveal_until_ms_ = 0;
    }

    TextEntryState TextEntry::tick(uint32_t now_ms)
    {
        if (revealing_ && static_cast<int32_t>(now_ms - reveal_until_ms_) >= 0) {
            revealing_ = false;
        }
        return snapshot(TextEntryStatus::Editing);
    }

    TextEntryState TextEntry::handle(const KeyEvent& ev)
    {
        if (ev.type != KeyEventType::Pressed) return snapshot(TextEntryStatus::Editing);

        // Any key but 8 ends a reveal at once.
        if (ev.key != '8') {
            revealing_ = false;
        }

        const size_t len = table_len();

        switch (ev.key)
        {
            case '1':
                if (selected_ > 0) --selected_;
                break;
            case '3':
                if (selected_ + 1 < len) ++selected_;
                break;
            case '7':
                selected_ = (selected_ > TEXT_ENTRY_JUMP) ? selected_ - TEXT_ENTRY_JUMP : 0;
                break;
            case '9':
                selected_ = (selected_ + TEXT_ENTRY_JUMP < len) ? selected_ + TEXT_ENTRY_JUMP : len - 1;
                break;
            case '2':
                charset_ = next_charset(charset_);
                selected_ = 0;
                break;
            case '4':
                if (cursor_ > 0) --cursor_;
                break;
            case '6':
                if (cursor_ < length_) ++cursor_;
                break;
            case '5':
                insert(table()[selected_]);
                break;
            case '0':
                insert(' ');
                break;
            case '8':
                if (mask_)
                {
                    revealing_ = true;
                    reveal_until_ms_ = ev.at_ms + TEXT_ENTRY_REVEAL_MS;
                }
                break;
            case '*':
                if (length_ == 0)
                    return snapshot(TextEntryStatus::Cancelled);
                erase_left();
                break;
            case '#':
                if (length_ > 0 || allow_empty_)
                    return snapshot(TextEntryStatus::Done);
                break;
            default:
                break;
        }
        return snapshot(TextEntryStatus::Editing);
    }

    void TextEntry::insert(char c)
    {
        if (length_ >= max_len_) return;
        for (size_t i = length_; i > cursor_; --i) {
            buffer_[i] = buffer_[i - 1];
        }
        buffer_[cursor_] = c;
        ++length_;
        ++cursor_;
        buffer_[length_] = '\0';
    }

    void TextEntry::erase_left()
    {
        if (cursor_ == 0) return;
        for (size_t i = cursor_ - 1; i + 1 < length_; ++i) {
            buffer_[i] = buffer_[i + 1];
        }
        --length_;
        --cursor_;
        buffer_[length_] = '\0';
    }
}
