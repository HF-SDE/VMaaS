# Main-Controller Wi-Fi Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a technician put a Main-Controller onto Wi-Fi without a laptop — over Bluetooth LE with Espressif's phone app, or entirely from the 12-key keypad and the 16x2 display.

**Architecture:** Two host-tested pure-logic classes carry everything that can be reasoned about without hardware: `TextEntry` (the character picker) and `OnboardingFlow` (the screen state machine, which returns the two display rows as text rather than drawing them). A thin blocking driver, `onboarding::run()`, joins them to the keypad, the display, the BLE provisioning component and `wifi_sta`. There is no `Screen` interface and no screen stack.

**Tech Stack:** ESP-IDF 6.1 (`framework = espidf`), PlatformIO Core 6.2, C++17, Unity for host tests, managed component `espressif/network_provisioning` ^1.2.4, `esp_srp` from ESP-IDF's `protocomm`.

**Spec:** `docs/superpowers/specs/2026-09-17-main-controller-wifi-onboarding-design.md`

## Global Constraints

- **Never run `git commit`.** It is denied in this project. Tasks end by **staging** with `git add`; the user commits.
- `framework = espidf` only. **No Arduino headers.**
- C++17. Exceptions and RTTI are disabled on both boards. Virtual functions are fine; `dynamic_cast` and `typeid` are not.
- `CONFIG_FREERTOS_HZ=100`, so one FreeRTOS tick is 10 ms.
- **No heap** in `vmaas-entry`. Fixed buffers only, as `SlotEntry` already does.
- **Every row-0 string and short message fits in 16 characters.** `print_at` truncates silently, so an over-long string is caught by no test — it just looks wrong on the bench. Only `ERROR_ROW1` scrolls.
- **UI strings are English and ASCII.** The HD44780 has no `æ ø å`.
- Every public header gets Doxygen comments (`@file`, `@brief`, `@param`, `@return`).
- **Colour never carries meaning alone.** `backlight_ok` can be false; red/green is the most confused pair. The text must say it too.

**Toolchain paths.** Neither tool is on this shell's PATH:

```bash
# PlatformIO
"C:/Users/temp/.platformio/penv/Scripts/pio.exe"

# Host GCC, needed for `platform = native` — prefix the command with this
export PATH="/c/Users/temp/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
```

**Hardware.** WROVER on **COM6**. `pio device monitor` needs a TTY and will not run from a tool shell — read the port with pyserial instead:

```bash
export PYTHONIOENCODING=utf-8
"C:/Users/temp/.platformio/penv/Scripts/python.exe" -c "
import serial,time,sys
s=serial.Serial('COM6',115200,timeout=0.2)
s.setDTR(False); s.setRTS(True); time.sleep(0.15); s.setRTS(False); time.sleep(0.05); s.setDTR(True)
end=time.time()+20
while time.time()<end:
    d=s.read(4096)
    if d: sys.stdout.write(d.decode('utf-8','replace')); sys.stdout.flush()
s.close()"
```

To reach the onboarding screen at all, the board must have no stored credentials:

```bash
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Main-Controller -t erase
```

Erasing wipes LittleFS too, so follow it with `-t uploadfs` and `-t upload`.

## File Structure

| File | Responsibility |
|---|---|
| `shared/vmaas-entry/src/text_entry.h` | NEW. `Charset`, `TextEntryStatus`, `TextEntryState`, `TextEntry`. |
| `shared/vmaas-entry/src/text_entry.cpp` | NEW. Character tables, cursor and window arithmetic, masking. |
| `shared/vmaas-entry/src/onboarding_flow.h` | NEW. `OnboardingScreen`, `FlowState`, `OnboardingFlow`. |
| `shared/vmaas-entry/src/onboarding_flow.cpp` | NEW. Screen transitions and row rendering. |
| `shared/vmaas-entry/test/test_text_entry/` | NEW. Insertion, charset, cursor, window. |
| `shared/vmaas-entry/test/test_text_mask/` | NEW. Masking, reveal, empty-field semantics. |
| `shared/vmaas-entry/test/test_onboarding_flow/` | NEW. Screens, transitions, backlight, row cycle. |
| `Main-Controller/src/provisioning.h/.cpp` | NEW. PIN, SRP6a salt and verifier, BLE lifecycle. |
| `Main-Controller/src/onboarding.h/.cpp` | NEW. The blocking driver. |
| `Main-Controller/src/wifi_sta.h/.cpp` | MODIFY. Add `scan()`. |
| `Main-Controller/src/main.cpp` | MODIFY. Call `onboarding::run()`; shorten `PROMPT_ROW0`. |
| `Main-Controller/src/idf_component.yml` | MODIFY. Add `espressif/network_provisioning`. |

---

### Task 1: `TextEntry` — characters, cursor and the picker row

The picker is the one genuinely fiddly piece of UI in this feature, and it is pure arithmetic: which character is selected, where the cursor sits in the text, and what the 16 columns of row 1 say. All of it is testable on the host.

**Files:**
- Create: `shared/vmaas-entry/src/text_entry.h`, `shared/vmaas-entry/src/text_entry.cpp`
- Test: `shared/vmaas-entry/test/test_text_entry/test_main.cpp`
- Modify: `shared/vmaas-entry/library.json`

**Interfaces:**
- Consumes: `vmaas::KeyEvent` and `vmaas::KeyEventType` from `shared/vmaas-keypad/src/key_event.h` (already on the include path via `platformio.ini`'s `-I../vmaas-keypad/src`).
- Produces: `vmaas::TextEntry`, `vmaas::TextEntryState`, `vmaas::TextEntryStatus`, `vmaas::Charset`, `vmaas::TEXT_ENTRY_MAX`, `vmaas::TEXT_ENTRY_JUMP`, `vmaas::TEXT_ENTRY_REVEAL_MS`.

- [ ] **Step 1: Write the header**

Create `shared/vmaas-entry/src/text_entry.h`:

```c++
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

        /// @brief Feed one key event. Released events are ignored.
        TextEntryState handle(const KeyEvent& ev);

        /// @brief Advance the reveal timer.
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
```

- [ ] **Step 2: Write the failing test**

Create `shared/vmaas-entry/test/test_text_entry/test_main.cpp`:

```c++
/**
 * @file test_main.cpp
 * @brief Host tests for TextEntry: characters, cursor and the picker row.
 *
 * The contract under test: every key does one thing, the picker row is always
 * exactly 16 columns with the selection bracketed, and the cursor can go back
 * into the text so a typo does not cost the whole field.
 */
#include <unity.h>
#include <cstring>
#include "text_entry.h"

using namespace vmaas;

namespace
{
    KeyEvent press(char k, uint32_t at_ms = 0)
    {
        return KeyEvent{k, KeyEventType::Pressed, at_ms};
    }

    // Feeds a whole string of key presses, left to right.
    TextEntryState type(TextEntry& e, const char* keys)
    {
        TextEntryState st = e.state();
        for (const char* p = keys; *p != '\0'; ++p)
            st = e.handle(press(*p));
        return st;
    }
}

void setUp() {}
void tearDown() {}

void test_insert_puts_the_selected_character_in_the_text()
{
    TextEntry e(16, false, true);
    // Charset starts at Lower with 'a' selected, so 5 inserts 'a'.
    TEST_ASSERT_EQUAL_STRING("a", type(e, "5").text);
}

void test_three_steps_forward_then_insert()
{
    TextEntry e(16, false, true);
    TEST_ASSERT_EQUAL_STRING("d", type(e, "3335").text);
}

void test_one_steps_back_and_stops_at_the_start()
{
    TextEntry e(16, false, true);
    // 'a' is the first character: 1 cannot go below it.
    TEST_ASSERT_EQUAL_STRING("a", type(e, "115").text);
}

void test_nine_jumps_five_forward()
{
    TextEntry e(16, false, true);
    TEST_ASSERT_EQUAL_STRING("f", type(e, "95").text);
}

void test_seven_jumps_five_back_and_clamps()
{
    TextEntry e(16, false, true);
    // 9 to 'f', then 7 back to 'a', then 7 again stays at 'a'.
    TEST_ASSERT_EQUAL_STRING("a", type(e, "9775").text);
}

void test_two_cycles_the_charsets_and_wraps()
{
    TextEntry e(16, false, true);
    TEST_ASSERT_EQUAL_STRING("A", type(e, "25").text);          // Lower -> Upper
    e.reset();
    TEST_ASSERT_EQUAL_STRING("0", type(e, "225").text);         // -> Digits
    e.reset();
    TEST_ASSERT_EQUAL_STRING("!", type(e, "2225").text);        // -> Symbols
    e.reset();
    TEST_ASSERT_EQUAL_STRING("a", type(e, "22225").text);       // wraps to Lower
}

void test_charset_switch_resets_the_selection_to_the_first_character()
{
    TextEntry e(16, false, true);
    // Move well into a-z, switch to Upper: selection must be 'A', not the 10th letter.
    TEST_ASSERT_EQUAL_STRING("A", type(e, "99925").text);
}

void test_zero_inserts_a_space()
{
    TextEntry e(16, false, true);
    TEST_ASSERT_EQUAL_STRING("a b", type(e, "5035").text);
}

void test_star_deletes_the_character_left_of_the_cursor()
{
    TextEntry e(16, false, true);
    TEST_ASSERT_EQUAL_STRING("a", type(e, "535*").text);
}

void test_cursor_can_go_back_and_insert_in_the_middle()
{
    TextEntry e(16, false, true);
    // Type "ac", move left once, insert 'b' -> "abc".
    type(e, "5335");               // "ac"
    TEST_ASSERT_EQUAL_STRING("ac", e.state().text);
    type(e, "4");                  // cursor between a and c
    TEST_ASSERT_EQUAL_STRING("abc", type(e, "115").text);
}

void test_cursor_clamps_at_both_ends()
{
    TextEntry e(16, false, true);
    type(e, "5");                  // "a", cursor at 1
    type(e, "4444");               // cannot go below 0
    TEST_ASSERT_EQUAL_STRING("ba", type(e, "35").text);
    type(e, "6666");               // cannot go past the end
    TEST_ASSERT_EQUAL_STRING("baa", type(e, "115").text);
}

void test_max_length_is_respected()
{
    TextEntry e(3, false, true);
    type(e, "5555");               // four inserts into a field of three
    TEST_ASSERT_EQUAL_STRING("aaa", e.state().text);
}

void test_picker_row_is_always_sixteen_columns()
{
    TextEntry e(16, false, true);
    TEST_ASSERT_EQUAL_UINT(16, std::strlen(e.state().picker));
    type(e, "999");                // deep into the table
    TEST_ASSERT_EQUAL_UINT(16, std::strlen(e.state().picker));
    type(e, "2");                  // shortest table (Digits has 10)
    TEST_ASSERT_EQUAL_UINT(16, std::strlen(e.state().picker));
}

void test_picker_row_brackets_the_selection()
{
    TextEntry e(16, false, true);
    type(e, "999");                // selection is 'p' (index 15)
    const char* p = e.state().picker;
    const char* open = std::strchr(p, '[');
    TEST_ASSERT_NOT_NULL(open);
    TEST_ASSERT_EQUAL_CHAR('p', open[1]);
    TEST_ASSERT_EQUAL_CHAR(']', open[2]);
}

void test_picker_row_at_the_start_of_the_table()
{
    TextEntry e(16, false, true);
    // Selection is 'a', the very first character: the bracket has to open the row.
    TEST_ASSERT_EQUAL_STRING("[a]b c d e f g h", e.state().picker);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_insert_puts_the_selected_character_in_the_text);
    RUN_TEST(test_three_steps_forward_then_insert);
    RUN_TEST(test_one_steps_back_and_stops_at_the_start);
    RUN_TEST(test_nine_jumps_five_forward);
    RUN_TEST(test_seven_jumps_five_back_and_clamps);
    RUN_TEST(test_two_cycles_the_charsets_and_wraps);
    RUN_TEST(test_charset_switch_resets_the_selection_to_the_first_character);
    RUN_TEST(test_zero_inserts_a_space);
    RUN_TEST(test_star_deletes_the_character_left_of_the_cursor);
    RUN_TEST(test_cursor_can_go_back_and_insert_in_the_middle);
    RUN_TEST(test_cursor_clamps_at_both_ends);
    RUN_TEST(test_max_length_is_respected);
    RUN_TEST(test_picker_row_is_always_sixteen_columns);
    RUN_TEST(test_picker_row_brackets_the_selection);
    RUN_TEST(test_picker_row_at_the_start_of_the_table);
    return UNITY_END();
}
```

- [ ] **Step 3: Run it and watch it fail to link**

```bash
export PATH="/c/Users/temp/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" test -e native -d shared/vmaas-entry -f test_text_entry 2>&1 | tail -20
```

Expected: undefined references to `vmaas::TextEntry::TextEntry(...)` and friends.

- [ ] **Step 4: Write the implementation**

Create `shared/vmaas-entry/src/text_entry.cpp`. The picker row is the part worth
specifying exactly, because "roughly centred" is not testable:

```c++
#include "text_entry.h"

#include <cstdio>
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
            case Charset::Lower:  return Charset::Upper;
            case Charset::Upper:  return Charset::Digits;
            case Charset::Digits: return Charset::Symbols;
            case Charset::Symbols:return Charset::Lower;
            }
            return Charset::Lower;
        }
    }

    TextEntry::TextEntry(size_t max_len, bool mask, bool allow_empty)
        : max_len_(max_len > TEXT_ENTRY_MAX - 1 ? TEXT_ENTRY_MAX - 1 : max_len),
          mask_(mask), allow_empty_(allow_empty)
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
        if (len > TEXT_ENTRY_WINDOW && start + TEXT_ENTRY_WINDOW > len)
            start = len - TEXT_ENTRY_WINDOW;
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
                if (col > 0 && out[col - 1] != ']' && col < 16)
                    out[col++] = ' ';
                if (col < 16) out[col++] = t[idx];
            }
        }
        while (col < 16)
            out[col++] = ' ';
        out[16] = '\0';
    }

    void TextEntry::render_display(char* out) const
    {
        const bool clear = !mask_ || revealing_;
        size_t n = 0;
        for (; n < length_ && n < 16; ++n)
        {
            // The character left of the cursor is the one just typed or just
            // moved past, so it is the one worth showing.
            const bool at_cursor = (cursor_ > 0 && n == cursor_ - 1);
            out[n] = (clear || at_cursor) ? buffer_[n] : '*';
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
        if (revealing_ && static_cast<int32_t>(now_ms - reveal_until_ms_) >= 0)
            revealing_ = false;
        return snapshot(TextEntryStatus::Editing);
    }

    TextEntryState TextEntry::handle(const KeyEvent& ev)
    {
        if (ev.type != KeyEventType::Pressed)
            return snapshot(TextEntryStatus::Editing);

        // Any key but 8 ends a reveal at once.
        if (ev.key != '8')
            revealing_ = false;

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
}
```

Add the two private helpers to the header's private section and implement them:

```c++
        void insert(char c);
        void erase_left();
```

```c++
    void TextEntry::insert(char c)
    {
        if (length_ >= max_len_)
            return;
        // Shift right from the cursor so a character can land mid-string.
        for (size_t i = length_; i > cursor_; --i)
            buffer_[i] = buffer_[i - 1];
        buffer_[cursor_] = c;
        ++length_;
        ++cursor_;
        buffer_[length_] = '\0';
    }

    void TextEntry::erase_left()
    {
        if (cursor_ == 0)
            return;
        for (size_t i = cursor_ - 1; i + 1 < length_; ++i)
            buffer_[i] = buffer_[i + 1];
        --length_;
        --cursor_;
        buffer_[length_] = '\0';
    }
```

- [ ] **Step 5: Run the tests**

```bash
export PATH="/c/Users/temp/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" test -e native -d shared/vmaas-entry -f test_text_entry 2>&1 | tail -25
```

Expected: 15 tests, all passing. If `test_picker_row_at_the_start_of_the_table`
fails, compare the produced row against `[a]b c d e f g h` character by character
— the separator rule is where this goes wrong.

- [ ] **Step 6: Update `library.json`**

```json
  "headers": ["slot_entry.h", "entry_state.h", "text_entry.h", "onboarding_flow.h"]
```

`onboarding_flow.h` arrives in Task 3. Listing it now avoids a second edit, and
`headers` is metadata PlatformIO does not verify.

- [ ] **Step 7: Stage**

```bash
git add shared/vmaas-entry/src/text_entry.h shared/vmaas-entry/src/text_entry.cpp shared/vmaas-entry/test/test_text_entry shared/vmaas-entry/library.json
```

---

### Task 2: `TextEntry` — masking, reveal and empty fields

**Files:**
- Test: `shared/vmaas-entry/test/test_text_mask/test_main.cpp`
- Modify: `shared/vmaas-entry/src/text_entry.cpp` (only if a test exposes a gap)

**Interfaces:**
- Consumes: everything Task 1 produced
- Produces: nothing new

The spec lists `test_text_empty` as a fourth suite. Its cases live at the bottom
of this one instead: they are three assertions about the same class, and a suite
per assertion costs more to run than it earns.

- [ ] **Step 1: Write the failing tests**

Create `shared/vmaas-entry/test/test_text_mask/test_main.cpp`:

```c++
/**
 * @file test_main.cpp
 * @brief Host tests for TextEntry masking, the reveal key, and empty fields.
 *
 * The contract under test: a masked field shows the character at the cursor and
 * nothing else, 8 lifts that for two seconds, and '*' on an empty field leaves
 * the screen rather than doing nothing.
 */
#include <unity.h>
#include <cstring>
#include "text_entry.h"

using namespace vmaas;

namespace
{
    KeyEvent press(char k, uint32_t at_ms = 0)
    {
        return KeyEvent{k, KeyEventType::Pressed, at_ms};
    }

    TextEntryState type(TextEntry& e, const char* keys, uint32_t at_ms = 0)
    {
        TextEntryState st = e.state();
        for (const char* p = keys; *p != '\0'; ++p)
            st = e.handle(press(*p, at_ms));
        return st;
    }
}

void setUp() {}
void tearDown() {}

void test_unmasked_field_shows_everything()
{
    TextEntry e(16, false, true);
    TEST_ASSERT_EQUAL_STRING("ab", type(e, "5335").display);
}

void test_masked_field_shows_only_the_character_left_of_the_cursor()
{
    TextEntry e(16, true, true);
    // "ab" with the cursor at the end: the 'b' shows, the 'a' does not.
    TEST_ASSERT_EQUAL_STRING("*b", type(e, "5335").display);
}

void test_masking_follows_the_cursor_back_into_the_text()
{
    TextEntry e(16, true, true);
    type(e, "53353335");             // "abc"
    TEST_ASSERT_EQUAL_STRING("**c", e.state().display);
    e.handle(press('4'));            // cursor between b and c
    TEST_ASSERT_EQUAL_STRING("*b*", e.state().display);
}

void test_cursor_at_zero_masks_everything()
{
    TextEntry e(16, true, true);
    type(e, "5335");                 // "ab"
    type(e, "44");                   // cursor to 0
    TEST_ASSERT_EQUAL_STRING("**", e.state().display);
}

void test_eight_reveals_the_whole_field()
{
    TextEntry e(16, true, true);
    type(e, "5335", 1000);
    e.handle(press('8', 1000));
    TEST_ASSERT_EQUAL_STRING("ab", e.state().display);
}

void test_reveal_ends_by_itself_after_two_seconds()
{
    TextEntry e(16, true, true);
    type(e, "5335", 1000);
    e.handle(press('8', 1000));
    TEST_ASSERT_EQUAL_STRING("ab", e.tick(1000 + TEXT_ENTRY_REVEAL_MS - 1).display);
    TEST_ASSERT_EQUAL_STRING("*b", e.tick(1000 + TEXT_ENTRY_REVEAL_MS).display);
}

void test_any_other_key_ends_the_reveal_at_once()
{
    TextEntry e(16, true, true);
    type(e, "5335", 1000);
    e.handle(press('8', 1000));
    TEST_ASSERT_EQUAL_STRING("ab", e.state().display);
    TEST_ASSERT_EQUAL_STRING("**c", e.handle(press('5', 1100)).display);
}

void test_eight_does_nothing_on_an_unmasked_field()
{
    TextEntry e(16, false, true);
    type(e, "5335");
    TEST_ASSERT_EQUAL_STRING("ab", e.handle(press('8')).display);
}

void test_star_on_an_empty_field_cancels()
{
    TextEntry e(16, true, true);
    TEST_ASSERT_EQUAL(TextEntryStatus::Cancelled, e.handle(press('*')).status);
}

void test_star_with_text_deletes_instead_of_cancelling()
{
    TextEntry e(16, true, true);
    type(e, "5");
    const TextEntryState st = e.handle(press('*'));
    TEST_ASSERT_EQUAL(TextEntryStatus::Editing, st.status);
    TEST_ASSERT_EQUAL_STRING("", st.text);
}

void test_hash_accepts_an_empty_password()
{
    TextEntry e(16, true, true);
    TEST_ASSERT_EQUAL(TextEntryStatus::Done, e.handle(press('#')).status);
}

void test_hash_refuses_an_empty_ssid()
{
    TextEntry e(32, false, false);
    TEST_ASSERT_EQUAL(TextEntryStatus::Editing, e.handle(press('#')).status);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_unmasked_field_shows_everything);
    RUN_TEST(test_masked_field_shows_only_the_character_left_of_the_cursor);
    RUN_TEST(test_masking_follows_the_cursor_back_into_the_text);
    RUN_TEST(test_cursor_at_zero_masks_everything);
    RUN_TEST(test_eight_reveals_the_whole_field);
    RUN_TEST(test_reveal_ends_by_itself_after_two_seconds);
    RUN_TEST(test_any_other_key_ends_the_reveal_at_once);
    RUN_TEST(test_eight_does_nothing_on_an_unmasked_field);
    RUN_TEST(test_star_on_an_empty_field_cancels);
    RUN_TEST(test_star_with_text_deletes_instead_of_cancelling);
    RUN_TEST(test_hash_accepts_an_empty_password);
    RUN_TEST(test_hash_refuses_an_empty_ssid);
    return UNITY_END();
}
```

- [ ] **Step 2: Run them**

```bash
export PATH="/c/Users/temp/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" test -e native -d shared/vmaas-entry -f test_text_mask 2>&1 | tail -20
```

Expected: 12 tests. Several may already pass from Task 1's implementation — that
is fine. Any that fail point at a real gap.

- [ ] **Step 3: Fix whatever failed**

Change `text_entry.cpp` only. Do not weaken a test: in particular
`test_masking_follows_the_cursor_back_into_the_text` is the whole reason the rule
is "character left of the cursor" rather than "last character".

- [ ] **Step 4: Run the whole library**

```bash
export PATH="/c/Users/temp/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" test -e native -d shared/vmaas-entry 2>&1 | tail -15
```

Expected: the four existing suites plus the two new ones, all passing.

- [ ] **Step 5: Stage**

```bash
git add shared/vmaas-entry
```

---

### Task 3: `OnboardingFlow` — screens and transitions

**Files:**
- Create: `shared/vmaas-entry/src/onboarding_flow.h`, `shared/vmaas-entry/src/onboarding_flow.cpp`
- Test: `shared/vmaas-entry/test/test_onboarding_flow/test_main.cpp`

**Interfaces:**
- Consumes: `vmaas::TextEntry` (Task 1), `vmaas::KeyEvent`
- Produces: `vmaas::OnboardingFlow`, `vmaas::FlowState`, `vmaas::OnboardingScreen`, `vmaas::ONBOARDING_MAX_NETWORKS`, `vmaas::ONBOARDING_PIN_MS`, `vmaas::ONBOARDING_HINT_MS`

- [ ] **Step 1: Write the header**

Create `shared/vmaas-entry/src/onboarding_flow.h`:

```c++
#pragma once
/**
 * @file onboarding_flow.h
 * @brief The Wi-Fi onboarding screen flow, without a display or a radio.
 *
 * Feed it key events and connection results; ask it what the two display rows
 * say and what colour the backlight should be. Every side effect - scanning,
 * storing credentials, waiting for an IP - belongs to the driver.
 */
#include <cstddef>
#include <cstdint>
#include "key_event.h"
#include "text_entry.h"

namespace vmaas
{
    /// Networks kept from a scan. The list always has one more row: [Enter manually].
    constexpr size_t ONBOARDING_MAX_NETWORKS = 20;
    constexpr size_t ONBOARDING_SSID_MAX = 33;   ///< 32 + NUL.
    constexpr size_t ONBOARDING_PASS_MAX = 64;   ///< 63 + NUL.

    constexpr uint32_t ONBOARDING_PIN_MS = 5000;   ///< How long the BLE row shows the PIN.
    constexpr uint32_t ONBOARDING_HINT_MS = 3000;  ///< How long it shows the manual-setup hint.
    constexpr uint32_t ONBOARDING_CONNECTED_MS = 2000; ///< Green before the sales loop.

    enum class OnboardingScreen : uint8_t
    {
        BleWaiting,    ///< Device name and PIN; * goes manual.
        NetworkList,   ///< Scan results plus [Enter manually].
        SsidEntry,     ///< Only reached through [Enter manually].
        PasswordEntry,
        Connecting,
        WrongPassword,
        Connected,
    };

    /// Everything the driver needs for one pass of the loop.
    struct FlowState
    {
        OnboardingScreen screen;
        char row0[17];
        char row1[17];
        uint8_t r, g, b;        ///< Backlight for this screen.
        bool connect_requested; ///< True for one call: connect with ssid and password.
        const char* ssid;       ///< Valid while connect_requested.
        const char* password;   ///< Valid while connect_requested.
        bool done;              ///< Onboarding is finished; start the sales loop.
    };

    /// The onboarding screen flow. Fixed buffers, no heap.
    class OnboardingFlow
    {
    public:
        /**
         * @param device_name Shown on the BLE screen and by the phone app. At most 16 characters.
         * @param pin Eight digits, shown as "PIN 1234 5678".
         */
        OnboardingFlow(const char* device_name, const char* pin);

        /// @brief Replace the scan results. [Enter manually] is appended by the flow.
        void set_networks(const char* const* ssids, size_t count);

        /// @brief Report what the driver's connection attempt did.
        void on_connect_result(bool ok);

        FlowState handle(const KeyEvent& ev);

        /// @brief Advances the BLE row cycle and the timed screens.
        FlowState tick(uint32_t now_ms);

        FlowState state() const;
    };
}
```

- [ ] **Step 2: Write the failing test**

Create `shared/vmaas-entry/test/test_onboarding_flow/test_main.cpp`:

```c++
/**
 * @file test_main.cpp
 * @brief Host tests for the onboarding screen flow.
 *
 * The contract under test: every screen says what it should, every key leads
 * where it should, no screen is a dead end, and done is true only after a
 * connection actually succeeded.
 */
#include <unity.h>
#include <cstring>
#include "onboarding_flow.h"

using namespace vmaas;

namespace
{
    KeyEvent press(char k, uint32_t at_ms = 0)
    {
        return KeyEvent{k, KeyEventType::Pressed, at_ms};
    }

    const char* const NETS[] = {"Cafe-Gaesten", "Office-5G"};

    OnboardingFlow make()
    {
        OnboardingFlow f("VMaaS-0042", "12345678");
        f.set_networks(NETS, 2);
        return f;
    }

    FlowState type(OnboardingFlow& f, const char* keys, uint32_t at_ms = 0)
    {
        FlowState st = f.state();
        for (const char* p = keys; *p != '\0'; ++p)
            st = f.handle(press(*p, at_ms));
        return st;
    }
}

void setUp() {}
void tearDown() {}

void test_starts_on_the_ble_screen_with_the_device_name()
{
    OnboardingFlow f = make();
    const FlowState st = f.state();
    TEST_ASSERT_EQUAL(OnboardingScreen::BleWaiting, st.screen);
    TEST_ASSERT_EQUAL_STRING("VMaaS-0042", st.row0);
    TEST_ASSERT_EQUAL_STRING("PIN 1234 5678", st.row1);
}

void test_ble_backlight_is_blue()
{
    OnboardingFlow f = make();
    const FlowState st = f.state();
    TEST_ASSERT_EQUAL_UINT8(0, st.r);
    TEST_ASSERT_EQUAL_UINT8(80, st.g);
    TEST_ASSERT_EQUAL_UINT8(255, st.b);
}

void test_ble_row_holds_the_pin_for_five_seconds_then_the_hint_for_three()
{
    OnboardingFlow f = make();
    TEST_ASSERT_EQUAL_STRING("PIN 1234 5678", f.tick(ONBOARDING_PIN_MS - 1).row1);
    TEST_ASSERT_EQUAL_STRING("* = manual setup", f.tick(ONBOARDING_PIN_MS).row1);
    TEST_ASSERT_EQUAL_STRING("* = manual setup",
                             f.tick(ONBOARDING_PIN_MS + ONBOARDING_HINT_MS - 1).row1);
    TEST_ASSERT_EQUAL_STRING("PIN 1234 5678",
                             f.tick(ONBOARDING_PIN_MS + ONBOARDING_HINT_MS).row1);
}

void test_star_opens_the_network_list()
{
    OnboardingFlow f = make();
    const FlowState st = f.handle(press('*'));
    TEST_ASSERT_EQUAL(OnboardingScreen::NetworkList, st.screen);
    TEST_ASSERT_EQUAL_STRING("Select network", st.row0);
    TEST_ASSERT_EQUAL_STRING("[Cafe-Gaesten]", st.row1);
}

void test_star_from_the_list_goes_back_to_ble()
{
    OnboardingFlow f = make();
    f.handle(press('*'));
    TEST_ASSERT_EQUAL(OnboardingScreen::BleWaiting, f.handle(press('*')).screen);
}

void test_one_and_three_move_through_the_list()
{
    OnboardingFlow f = make();
    f.handle(press('*'));
    TEST_ASSERT_EQUAL_STRING("[Office-5G]", f.handle(press('3')).row1);
    TEST_ASSERT_EQUAL_STRING("[Cafe-Gaesten]", f.handle(press('1')).row1);
}

void test_enter_manually_is_always_the_last_entry()
{
    OnboardingFlow f = make();
    f.handle(press('*'));
    f.handle(press('3'));
    TEST_ASSERT_EQUAL_STRING("[Enter manually]", f.handle(press('3')).row1);
    // And it does not run off the end.
    TEST_ASSERT_EQUAL_STRING("[Enter manually]", f.handle(press('3')).row1);
}

void test_enter_manually_is_offered_even_with_no_networks()
{
    OnboardingFlow f("VMaaS-0042", "12345678");
    f.set_networks(nullptr, 0);
    f.handle(press('*'));
    TEST_ASSERT_EQUAL_STRING("[Enter manually]", f.state().row1);
}

void test_picking_a_network_skips_the_ssid_screen()
{
    OnboardingFlow f = make();
    f.handle(press('*'));
    TEST_ASSERT_EQUAL(OnboardingScreen::PasswordEntry, f.handle(press('5')).screen);
}

void test_enter_manually_opens_the_ssid_screen()
{
    OnboardingFlow f = make();
    f.handle(press('*'));
    type(f, "33");
    TEST_ASSERT_EQUAL(OnboardingScreen::SsidEntry, f.handle(press('5')).screen);
}

void test_password_screen_labels_row0_until_something_is_typed()
{
    OnboardingFlow f = make();
    f.handle(press('*'));
    TEST_ASSERT_EQUAL_STRING("Password", f.handle(press('5')).row0);
    TEST_ASSERT_EQUAL_STRING("a", f.handle(press('5')).row0);
}

void test_finishing_the_password_requests_a_connection()
{
    OnboardingFlow f = make();
    f.handle(press('*'));
    f.handle(press('5'));                 // pick Cafe-Gaesten
    f.handle(press('5'));                 // type 'a'
    const FlowState st = f.handle(press('#'));
    TEST_ASSERT_EQUAL(OnboardingScreen::Connecting, st.screen);
    TEST_ASSERT_TRUE(st.connect_requested);
    TEST_ASSERT_EQUAL_STRING("Cafe-Gaesten", st.ssid);
    TEST_ASSERT_EQUAL_STRING("a", st.password);
    // The request is raised once, not on every poll.
    TEST_ASSERT_FALSE(f.state().connect_requested);
}

void test_a_failed_connection_shows_the_error_screen()
{
    OnboardingFlow f = make();
    type(f, "*55#");
    f.on_connect_result(false);
    const FlowState st = f.state();
    TEST_ASSERT_EQUAL(OnboardingScreen::WrongPassword, st.screen);
    TEST_ASSERT_EQUAL_STRING("Wrong password", st.row0);
    TEST_ASSERT_EQUAL_STRING("5=retry  *=back", st.row1);
    TEST_ASSERT_EQUAL_UINT8(255, st.r);
    TEST_ASSERT_EQUAL_UINT8(0, st.g);
    TEST_ASSERT_FALSE(st.done);
}

void test_retry_returns_to_the_password_screen_for_the_same_network()
{
    OnboardingFlow f = make();
    type(f, "*55#");
    f.on_connect_result(false);
    const FlowState st = f.handle(press('5'));
    TEST_ASSERT_EQUAL(OnboardingScreen::PasswordEntry, st.screen);
    TEST_ASSERT_EQUAL_STRING("Password", st.row0);   // the old attempt is cleared
}

void test_back_from_the_error_screen_returns_to_the_list()
{
    OnboardingFlow f = make();
    type(f, "*55#");
    f.on_connect_result(false);
    TEST_ASSERT_EQUAL(OnboardingScreen::NetworkList, f.handle(press('*')).screen);
}

void test_done_only_after_a_successful_result_and_the_green_hold()
{
    OnboardingFlow f = make();
    type(f, "*55#", 1000);
    f.on_connect_result(true);
    const FlowState st = f.state();
    TEST_ASSERT_EQUAL(OnboardingScreen::Connected, st.screen);
    TEST_ASSERT_EQUAL_STRING("WiFi connected", st.row0);
    TEST_ASSERT_EQUAL_STRING("Cafe-Gaesten", st.row1);
    TEST_ASSERT_EQUAL_UINT8(0, st.r);
    TEST_ASSERT_EQUAL_UINT8(255, st.g);
    TEST_ASSERT_FALSE(st.done);
    TEST_ASSERT_TRUE(f.tick(1000 + ONBOARDING_CONNECTED_MS).done);
}

void test_star_on_an_empty_password_returns_to_the_list()
{
    OnboardingFlow f = make();
    f.handle(press('*'));
    f.handle(press('5'));
    TEST_ASSERT_EQUAL(OnboardingScreen::NetworkList, f.handle(press('*')).screen);
}

void test_every_row_fits_the_display()
{
    OnboardingFlow f = make();
    const OnboardingScreen seen[] = {OnboardingScreen::BleWaiting, OnboardingScreen::NetworkList};
    (void)seen;
    TEST_ASSERT_LESS_OR_EQUAL_UINT(16, std::strlen(f.state().row0));
    TEST_ASSERT_LESS_OR_EQUAL_UINT(16, std::strlen(f.state().row1));
    f.handle(press('*'));
    TEST_ASSERT_LESS_OR_EQUAL_UINT(16, std::strlen(f.state().row0));
    TEST_ASSERT_LESS_OR_EQUAL_UINT(16, std::strlen(f.state().row1));
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_starts_on_the_ble_screen_with_the_device_name);
    RUN_TEST(test_ble_backlight_is_blue);
    RUN_TEST(test_ble_row_holds_the_pin_for_five_seconds_then_the_hint_for_three);
    RUN_TEST(test_star_opens_the_network_list);
    RUN_TEST(test_star_from_the_list_goes_back_to_ble);
    RUN_TEST(test_one_and_three_move_through_the_list);
    RUN_TEST(test_enter_manually_is_always_the_last_entry);
    RUN_TEST(test_enter_manually_is_offered_even_with_no_networks);
    RUN_TEST(test_picking_a_network_skips_the_ssid_screen);
    RUN_TEST(test_enter_manually_opens_the_ssid_screen);
    RUN_TEST(test_password_screen_labels_row0_until_something_is_typed);
    RUN_TEST(test_finishing_the_password_requests_a_connection);
    RUN_TEST(test_a_failed_connection_shows_the_error_screen);
    RUN_TEST(test_retry_returns_to_the_password_screen_for_the_same_network);
    RUN_TEST(test_back_from_the_error_screen_returns_to_the_list);
    RUN_TEST(test_done_only_after_a_successful_result_and_the_green_hold);
    RUN_TEST(test_star_on_an_empty_password_returns_to_the_list);
    RUN_TEST(test_every_row_fits_the_display);
    return UNITY_END();
}
```

- [ ] **Step 2b: Run it and watch it fail to link**

```bash
export PATH="/c/Users/temp/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" test -e native -d shared/vmaas-entry -f test_onboarding_flow 2>&1 | tail -15
```

Expected: undefined references to `vmaas::OnboardingFlow`.

- [ ] **Step 3: Write the implementation**

Create `shared/vmaas-entry/src/onboarding_flow.cpp`. Add this private section to
the header first, so the two files agree:

```c++
    private:
        FlowState snapshot() const;
        void go(OnboardingScreen next, uint32_t now_ms);
        const char* row_for_list_selection() const;

        OnboardingScreen screen_ = OnboardingScreen::BleWaiting;
        char name_[17] = {};
        char pin_row_[17] = {};   ///< "PIN 1234 5678", built once in the constructor.

        char networks_[ONBOARDING_MAX_NETWORKS][ONBOARDING_SSID_MAX] = {};
        size_t network_count_ = 0;
        size_t selection_ = 0;    ///< 0..network_count_; the last row is [Enter manually].

        TextEntry ssid_entry_{32, false, false};   ///< No mask, no empty SSID.
        TextEntry pass_entry_{63, true, true};     ///< Masked, empty allowed (open networks).
        char chosen_ssid_[ONBOARDING_SSID_MAX] = {};

        bool connect_pending_ = false;
        bool done_ = false;
        uint32_t screen_since_ms_ = 0;
        uint32_t now_ms_ = 0;     ///< Last time seen, so state() can render the BLE cycle.
```

The shape of the implementation:

- Private members: `OnboardingScreen screen_`, the device name and PIN as fixed
  buffers, `char networks_[ONBOARDING_MAX_NETWORKS][ONBOARDING_SSID_MAX]`,
  `size_t network_count_`, `size_t selection_`, a `TextEntry ssid_entry_{32, false, false}`,
  a `TextEntry pass_entry_{63, true, true}`, the chosen SSID as a fixed buffer,
  `bool connect_pending_`, `uint32_t screen_since_ms_`, `bool done_`.
- `handle()` switches on `screen_`, and on the two entry screens forwards the key
  to the matching `TextEntry` and reacts to its `TextEntryStatus`:
  `Cancelled` returns to the list, `Done` moves on.
- The list holds `network_count_ + 1` rows; the last is `[Enter manually]`.
  Selection clamps at both ends rather than wrapping — wrapping makes a long list
  feel like it is going nowhere.
- `set_networks(nullptr, 0)` is valid and leaves only the manual row.
- Row 1 on the list is the SSID wrapped in `[` `]`, truncated to 16 columns.
- The BLE row cycle is `(now_ms - screen_since_ms_) % (PIN_MS + HINT_MS)` compared
  against `PIN_MS`. Modulo rather than a toggle so a missed tick cannot leave the
  two halves out of step.
- `connect_requested` is raised by `#` on the password screen and lowered by the
  next call to `state()`, `handle()` or `tick()`, so a polling driver acts on it
  exactly once.
- `on_connect_result(false)` moves to `WrongPassword` and calls
  `pass_entry_.reset()`, so retry starts from an empty field. `true` moves to
  `Connected` and records the time; `tick()` raises `done` once
  `ONBOARDING_CONNECTED_MS` has passed.

Backlight per screen, from the spec:

| Screen | r, g, b |
|---|---|
| `BleWaiting` | 0, 80, 255 |
| `NetworkList`, `SsidEntry`, `PasswordEntry` | 255, 255, 255 |
| `Connecting` | 255, 200, 0 |
| `WrongPassword` | 255, 0, 0 |
| `Connected` | 0, 255, 0 |

- [ ] **Step 4: Run the tests**

```bash
export PATH="/c/Users/temp/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" test -e native -d shared/vmaas-entry 2>&1 | tail -15
```

Expected: all seven suites pass — the four that existed, plus `test_text_entry`,
`test_text_mask` and `test_onboarding_flow`.

- [ ] **Step 5: Stage**

```bash
git add shared/vmaas-entry
```

---

### Task 4: `wifi_sta::scan()`

**Files:**
- Modify: `Main-Controller/src/wifi_sta.h`, `Main-Controller/src/wifi_sta.cpp`

**Interfaces:**
- Consumes: the `wifi_sta` module from the config-and-wifi work
- Produces: `int wifi_sta::scan(char out[][wifi_sta::MAX_SSID_LEN], size_t max)`

- [ ] **Step 1: Add the declaration**

In `Main-Controller/src/wifi_sta.h`, inside `namespace wifi_sta`:

```c++
    constexpr size_t MAX_SSID_LEN = 33; ///< 32 characters + NUL.

    /**
     * @brief Scan for access points. Blocks for roughly two seconds.
     *
     * Results are strongest first with duplicate SSIDs removed: one access
     * point on two bands otherwise appears twice under the same name, and a
     * list with the same entry twice looks broken.
     *
     * @param out Destination, at least @p max rows.
     * @param max Rows available.
     * @return Number of entries written, or a negative esp_err_t.
     */
    int scan(char out[][MAX_SSID_LEN], size_t max);
```

- [ ] **Step 2: Implement it**

In `Main-Controller/src/wifi_sta.cpp`:

```c++
    int scan(char out[][MAX_SSID_LEN], size_t max)
    {
        if (out == nullptr || max == 0)
            return -ESP_ERR_INVALID_ARG;

        // The driver must be started for a scan, even without credentials.
        esp_err_t err = esp_wifi_start();
        if (err != ESP_OK && err != ESP_ERR_WIFI_CONN)
            return -err;

        wifi_scan_config_t cfg = {};
        cfg.show_hidden = false; // A hidden network has no name to list.
        if ((err = esp_wifi_scan_start(&cfg, true)) != ESP_OK)
            return -err;

        uint16_t found = 0;
        if ((err = esp_wifi_scan_get_ap_num(&found)) != ESP_OK)
            return -err;
        if (found == 0)
            return 0;

        static wifi_ap_record_t records[ONBOARDING_SCAN_RECORDS];
        uint16_t want = (found > ONBOARDING_SCAN_RECORDS) ? ONBOARDING_SCAN_RECORDS : found;
        if ((err = esp_wifi_scan_get_ap_records(&want, records)) != ESP_OK)
            return -err;

        // esp_wifi returns records strongest first, so the first occurrence of
        // a name is the one worth keeping.
        size_t n = 0;
        for (uint16_t i = 0; i < want && n < max; ++i)
        {
            const char* ssid = reinterpret_cast<const char*>(records[i].ssid);
            if (ssid[0] == '\0')
                continue;
            bool seen = false;
            for (size_t j = 0; j < n; ++j)
                if (std::strcmp(out[j], ssid) == 0) { seen = true; break; }
            if (seen)
                continue;
            std::snprintf(out[n], MAX_SSID_LEN, "%s", ssid);
            ++n;
        }
        return static_cast<int>(n);
    }
```

Add near the top of the file, in the anonymous namespace:

```c++
    /// Records pulled from the driver before de-duplication. .bss, not the task stack.
    constexpr uint16_t ONBOARDING_SCAN_RECORDS = 30;
```

`records` is `static` on purpose: 30 `wifi_ap_record_t` is well over a kilobyte
and would not survive on a task stack.

- [ ] **Step 3: Build**

```bash
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Main-Controller 2>&1 | tail -6
```

Expected: `[SUCCESS]`.

- [ ] **Step 4: Stage**

```bash
git add Main-Controller/src/wifi_sta.h Main-Controller/src/wifi_sta.cpp
```

---

### Task 5: `provisioning` — PIN, salt and verifier, BLE

**Files:**
- Create: `Main-Controller/src/provisioning.h`, `Main-Controller/src/provisioning.cpp`
- Modify: `Main-Controller/src/idf_component.yml`, `Main-Controller/sdkconfig.defaults`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `provisioning::begin(const char* device_name)`, `provisioning::pin()`, `provisioning::stop()`

- [ ] **Step 1: Add the managed component**

`Main-Controller/src/idf_component.yml` becomes:

```yaml
## ESP-IDF component manager manifest for the Main-Controller app component.
dependencies:
  idf: ">=5.0"
  joltwallet/littlefs: "^1.16.0"
  espressif/network_provisioning: "^1.2.4"
```

ESP-IDF 6.0 moved `wifi_provisioning` out of the monorepo. The component is now
`espressif/network_provisioning` and every `wifi_prov_*` symbol is renamed
`network_prov_*`. Anything you find online showing `wifi_prov_mgr_*` will not
compile here.

- [ ] **Step 1b: Turn Bluetooth on**

Nothing in this firmware has needed Bluetooth before, so it is off. Append to
`Main-Controller/sdkconfig.defaults`:

```
# BLE provisioning. NimBLE rather than Bluedroid: much smaller, and the
# provisioning component supports both. BLE only - no classic Bluetooth.
CONFIG_BT_ENABLED=y
CONFIG_BT_NIMBLE_ENABLED=y
CONFIG_BTDM_CTRL_MODE_BLE_ONLY=y
CONFIG_BTDM_CTRL_MODE_BR_EDR_ONLY=n
CONFIG_BTDM_CTRL_MODE_BTDM=n
```

Then delete `Main-Controller/sdkconfig.main-controller` so it is regenerated from
the defaults — an existing sdkconfig wins over `sdkconfig.defaults`, and without
deleting it the Bluetooth options never take effect:

```bash
rm Main-Controller/sdkconfig.main-controller
```

The next build writes it again with Bluetooth enabled and the partition table
settings preserved.

- [ ] **Step 2: Write the header**

```c++
#pragma once
/**
 * @file provisioning.h
 * @brief BLE provisioning with a PIN the device generates and shows.
 *
 * The machine draws a fresh eight-digit PIN at the start of every onboarding
 * session, computes the SRP6a salt and verifier from it on the spot, and prints
 * it on the display. The PIN is never stored and never leaves the device except
 * on that screen, so there is no factory tooling, no provisioning database and
 * no QR sticker.
 */
#include "esp_err.h"

/// BLE provisioning for the Main-Controller.
namespace provisioning
{
    constexpr int PIN_DIGITS = 8;

    /**
     * @brief Draw a PIN, compute its salt and verifier, and start advertising.
     * @param device_name Service name shown by the phone app. At most 16 characters.
     * @return ESP_OK once the service is running.
     */
    esp_err_t begin(const char* device_name);

    /// @return The current session's PIN as eight digits plus NUL. "" before begin().
    const char* pin();

    /// @brief Stop advertising and release the Bluetooth memory.
    void stop();
}
```

- [ ] **Step 3: Write the implementation**

```c++
#include "provisioning.h"

#include <cstdio>
#include <cstring>
#include "esp_log.h"
#include "esp_random.h"
#include "esp_srp.h"
#include "network_provisioning/manager.h"
#include "network_provisioning/scheme_ble.h"

namespace
{
    constexpr const char* TAG = "Provisioning";
    constexpr const char* USERNAME = "vmaas";
    constexpr int SALT_LEN = 16;

    char s_pin[provisioning::PIN_DIGITS + 1] = {};
    char* s_salt = nullptr;
    char* s_verifier = nullptr;
    int s_verifier_len = 0;
    network_prov_security2_params_t s_sec2 = {};
}

namespace provisioning
{
    const char* pin() { return s_pin; }

    esp_err_t begin(const char* device_name)
    {
        // esp_random() is a true hardware RNG only while the RF subsystem is on.
        // BLE is started below, but the PIN is drawn first - so seed from the
        // entropy already available and accept it: this runs once per session
        // and an attacker must be in Bluetooth range to use it at all.
        for (int i = 0; i < PIN_DIGITS; ++i)
            s_pin[i] = static_cast<char>('0' + (esp_random() % 10));
        s_pin[PIN_DIGITS] = '\0';

        esp_err_t err = esp_srp_gen_salt_verifier(USERNAME, std::strlen(USERNAME),
                                                  s_pin, std::strlen(s_pin),
                                                  &s_salt, SALT_LEN,
                                                  &s_verifier, &s_verifier_len);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "salt/verifier generation failed: %s", esp_err_to_name(err));
            return err;
        }

        s_sec2.salt = s_salt;
        s_sec2.salt_len = SALT_LEN;
        s_sec2.verifier = s_verifier;
        s_sec2.verifier_len = static_cast<uint16_t>(s_verifier_len);

        network_prov_mgr_config_t cfg = {};
        cfg.scheme = network_prov_scheme_ble;
        cfg.scheme_event_handler = NETWORK_PROV_SCHEME_BLE_EVENT_HANDLER_FREE_BTDM;
        if ((err = network_prov_mgr_init(cfg)) != ESP_OK)
            return err;

        ESP_LOGI(TAG, "provisioning as '%s', pin %s", device_name, s_pin);
        return network_prov_mgr_start_provisioning(NETWORK_PROV_SECURITY_2,
                                                   &s_sec2, device_name, nullptr);
    }

    void stop()
    {
        network_prov_mgr_stop_provisioning();
        network_prov_mgr_deinit();
        // esp_srp_gen_salt_verifier allocates; the caller frees.
        free(s_salt);
        free(s_verifier);
        s_salt = nullptr;
        s_verifier = nullptr;
    }
}
```

`esp_srp_gen_salt_verifier()`'s own documentation says the salt and verifier
"need to be freed by caller" — hence the `free()` calls in `stop()`.

- [ ] **Step 4: Build**

```bash
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Main-Controller 2>&1 | tail -8
```

Expected: `[SUCCESS]`, and flash usage roughly 180 KB higher than before — that
is the Bluetooth stack. If it does not fit, the 2 MB `factory` partition from the
previous plan is the thing to check first.

- [ ] **Step 5: Stage**

```bash
git add Main-Controller/src/provisioning.h Main-Controller/src/provisioning.cpp \n        Main-Controller/src/idf_component.yml Main-Controller/sdkconfig.defaults \n        Main-Controller/sdkconfig.main-controller Main-Controller/dependencies.lock
```

---

### Task 6: The `onboarding` driver

**Files:**
- Create: `Main-Controller/src/onboarding.h`, `Main-Controller/src/onboarding.cpp`

**Interfaces:**
- Consumes: `vmaas::OnboardingFlow` (Task 3), `wifi_sta::scan()` (Task 4), `provisioning::begin()`/`pin()`/`stop()` (Task 5), `wifi_sta::set_credentials()`, `wifi_sta::is_connected()`, `wifi_sta::forget()`
- Produces: `void onboarding::run(const vmaas::DeviceConfig& cfg, vmaas::GroveLcdRgb& lcd, bool backlight_ok)`

- [ ] **Step 1: Write the header**

```c++
#pragma once
/**
 * @file onboarding.h
 * @brief Blocking Wi-Fi onboarding: BLE by default, keypad as the fallback.
 *
 * Runs before the sales loop and owns the keypad and the display while it does.
 * Returns only once the device has an IP address, so a mistyped password can
 * never leave the machine holding credentials that do not work.
 */
#include "device_config.h"
#include "grove_lcd_rgb.h"

/// Wi-Fi onboarding for the Main-Controller.
namespace onboarding
{
    /**
     * @brief Run the onboarding flow to completion.
     * @param cfg Device configuration; only name is used.
     * @param lcd Display. Must already be begun.
     * @param backlight_ok false when the RGB probe failed; colour calls are skipped.
     */
    void run(const vmaas::DeviceConfig& cfg, vmaas::GroveLcdRgb& lcd, bool backlight_ok);
}
```

- [ ] **Step 2: Write the implementation**

The loop mirrors the sales loop in `main.cpp`: drain the keypad queue, tick, draw
only what changed.

```c++
#include "onboarding.h"

#include <cstdio>
#include <cstring>
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "keypad_task.h"
#include "onboarding_flow.h"
#include "provisioning.h"
#include "wifi_sta.h"

namespace
{
    constexpr const char* TAG = "Onboarding";
    constexpr TickType_t POLL_INTERVAL = pdMS_TO_TICKS(50);
    constexpr uint32_t CONNECT_TIMEOUT_MS = 15000;

    uint32_t now_ms()
    {
        return static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS);
    }
}

namespace onboarding
{
    void run(const vmaas::DeviceConfig& cfg, vmaas::GroveLcdRgb& lcd, bool backlight_ok)
    {
        char name[17];
        if (cfg.name[0] != '\0')
            std::snprintf(name, sizeof(name), "%s", cfg.name);
        else
            std::snprintf(name, sizeof(name), "VMaaS");

        if (provisioning::begin(name) != ESP_OK)
            ESP_LOGE(TAG, "BLE provisioning unavailable, keypad only");

        static char nets[vmaas::ONBOARDING_MAX_NETWORKS][wifi_sta::MAX_SSID_LEN];
        const int found = wifi_sta::scan(nets, vmaas::ONBOARDING_MAX_NETWORKS);
        ESP_LOGI(TAG, "scan found %d network(s)", found);

        const char* ptrs[vmaas::ONBOARDING_MAX_NETWORKS];
        const size_t count = (found > 0) ? static_cast<size_t>(found) : 0;
        for (size_t i = 0; i < count; ++i)
            ptrs[i] = nets[i];

        vmaas::OnboardingFlow flow(name, provisioning::pin());
        flow.set_networks(ptrs, count);

        char last0[17] = {}, last1[17] = {};
        uint8_t last_r = 0xFF, last_g = 0xFF, last_b = 0xFF;
        uint32_t connect_started = 0;
        bool waiting_for_ip = false;

        while (true)
        {
            vmaas::KeyEvent ev{};
            vmaas::FlowState st = flow.tick(now_ms());
            while (keypad_task_next(ev))
                st = flow.handle(ev);

            if (st.connect_requested)
            {
                ESP_LOGI(TAG, "connecting to '%s'", st.ssid);
                if (wifi_sta::set_credentials(st.ssid, st.password) == ESP_OK)
                {
                    waiting_for_ip = true;
                    connect_started = now_ms();
                }
                else
                {
                    flow.on_connect_result(false);
                }
            }

            if (waiting_for_ip)
            {
                if (wifi_sta::is_connected())
                {
                    waiting_for_ip = false;
                    flow.on_connect_result(true);
                }
                else if (now_ms() - connect_started > CONNECT_TIMEOUT_MS)
                {
                    waiting_for_ip = false;
                    // The credentials are already in NVS. Erase them, or the
                    // machine would boot "provisioned" and never offer
                    // onboarding again.
                    wifi_sta::forget();
                    flow.on_connect_result(false);
                }
            }

            if (std::strcmp(st.row0, last0) != 0 || std::strcmp(st.row1, last1) != 0)
            {
                lcd.clear();
                lcd.print_at(0, 0, st.row0);
                lcd.print_at(0, 1, st.row1);
                std::snprintf(last0, sizeof(last0), "%s", st.row0);
                std::snprintf(last1, sizeof(last1), "%s", st.row1);
            }
            if (backlight_ok && (st.r != last_r || st.g != last_g || st.b != last_b))
            {
                lcd.set_rgb(st.r, st.g, st.b);
                last_r = st.r; last_g = st.g; last_b = st.b;
            }

            if (st.done)
                break;

            vTaskDelay(POLL_INTERVAL);
        }

        provisioning::stop();
        if (backlight_ok)
            lcd.set_rgb(255, 255, 255); // Do not leave the sales screen green.
        ESP_LOGI(TAG, "onboarding complete");
    }
}
```

Only redrawing when a row changed matters: the loop runs twenty times a second,
and clearing and rewriting both rows every pass would make the display flicker
and keep the 100 kHz I2C bus busy for no reason.

- [ ] **Step 3: Build**

```bash
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Main-Controller 2>&1 | tail -6
```

Expected: `[SUCCESS]`.

- [ ] **Step 4: Stage**

```bash
git add Main-Controller/src/onboarding.h Main-Controller/src/onboarding.cpp
```

---

### Task 7: Wire it into `app_main` and verify on hardware

**Files:**
- Modify: `Main-Controller/src/main.cpp`

**Interfaces:**
- Consumes: `onboarding::run()` (Task 6)
- Produces: nothing

- [ ] **Step 1: Shorten and translate the sales prompt**

`PROMPT_ROW0` is 18 characters on a 16-column display, so the sales screen has
been showing `VMaaS - vaelg sl`. Change line 24 of `Main-Controller/src/main.cpp`:

```c++
    constexpr const char *PROMPT_ROW0 = "VMaaS: pick slot";   // exactly 16
```

- [ ] **Step 2: Call onboarding after the display is up**

Add the include:

```c++
#include "onboarding.h"
```

In `app_main()`, after the display and keypad have been initialised and the
keypad task started — onboarding needs both — and before `show_prompt()`:

```c++
    if (!wifi_sta::has_credentials())
    {
        if (!display_ok)
        {
            // Without a screen there is no way to show the PIN and no way to
            // run the keypad flow. Log it and let BLE carry the session.
            ESP_LOGE(TAG, "no display: onboarding is BLE-only, pin follows");
        }
        onboarding::run(cfg, lcd, backlight_ok);
    }
```

`wifi_sta::init()` has already run earlier in `app_main`, so the driver is ready
to scan and to store credentials.

- [ ] **Step 3: Build, erase and flash**

Erasing is what makes the board unprovisioned, which is the only way to reach the
onboarding screen. It also wipes LittleFS, so the filesystem goes back too.

```bash
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Main-Controller 2>&1 | tail -6
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Main-Controller -t erase 2>&1 | tail -3
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Main-Controller -t uploadfs 2>&1 | tail -3
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Main-Controller -t upload 2>&1 | tail -3
```

- [ ] **Step 4: Hardware check 1 — the BLE screen**

Read the boot log with the pyserial snippet from **Global Constraints**.

Expected: `provisioning as 'VMaaS-0042', pin NNNNNNNN`, and `scan found N
network(s)`. On the display: the device name on row 0, and row 1 alternating
between `PIN 1234 5678` and `* = manual setup`. Time it: the PIN should hold
noticeably longer. The backlight is blue.

- [ ] **Step 5: Hardware check 2 — the phone app**

Install **ESP BLE Provisioning** ([Android](https://play.google.com/store/apps/details?id=com.espressif.provble),
[iOS](https://apps.apple.com/us/app/esp-ble-provisioning/id1473590141)). The
device appears under the name on row 0. Enter the PIN from the display as the
Proof of Possession, pick the network, enter its password.

Expected: green backlight, `WiFi connected`, then the sales prompt about two
seconds later. The serial log shows `WifiSta: connected, ip ...`.

- [ ] **Step 6: Hardware check 3 — the keypad path**

Erase, uploadfs and upload again. Press `*`.

Expected: `Select network` with real networks from the scan. `3` walks down the
list, `[Enter manually]` is the last row, and `1` walks back. Press `*` to
confirm it returns to the BLE screen.

- [ ] **Step 7: Hardware check 4 — typing a password**

Press `*`, pick your network with `5`, and type its password. Confirm as you go:

- `2` cycles `abc` → `ABC` → `123` → `!@#`
- `9` jumps five characters, `3` one
- `4` moves back into the text and `5` inserts there
- `8` reveals the whole password and it re-masks by itself after about two seconds
- `*` deletes; on an empty field it returns to the list

Press `#`. Expected: yellow, `Connecting...`, then green and the sales prompt.

- [ ] **Step 8: Hardware check 5 — a wrong password**

Erase and reflash. Type a deliberately wrong password.

Expected: red, `Wrong password` / `5=retry  *=back`. Press `5` and confirm the
password screen comes back empty. Then power-cycle the board **without**
completing onboarding: it must come back to the BLE screen, which proves
`forget()` ran and the machine is not stuck.

- [ ] **Step 9: Hardware check 6 — a hidden network**

Erase and reflash. Press `*`, walk to `[Enter manually]`, press `5`, type a
hidden SSID and its password.

Expected: it connects. This is the case a scan can never cover.

- [ ] **Step 10: Stage**

```bash
git add Main-Controller/src/main.cpp
```

---

## Done when

- [ ] `pio test -e native -d shared/vmaas-entry` passes all seven suites
- [ ] `pio run -d Main-Controller` succeeds and fits the 2 MB `factory` partition
- [ ] The BLE screen alternates 5 s PIN, 3 s hint, on a blue backlight
- [ ] Espressif's app provisions the device using the PIN from the screen
- [ ] The keypad path connects to a scanned network and to a hidden one
- [ ] A wrong password shows the error screen, and a reboot returns to onboarding
- [ ] `grep -rn 'vaelg' Main-Controller/src` is empty — the UI is English
- [ ] Everything is staged; **nothing is committed**
