# Keypad Matrix Driver and Slot Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Main-Controller a host-tested keypad driver for the SparkFun COM-14662 (passive 4x3 matrix) and a hardware-free slot-entry state machine, wired together so typing `1`, `2`, `#` shows `Slot 12 valgt` on the Grove-LCD.

**Architecture:** Two new shared PlatformIO libraries. `shared/vmaas-keypad` scans the matrix through a three-method seam (`KeypadPort`: `configure`, `drive_row`, `read_col`), debounces in the time domain against an injected `now_ms`, and emits `KeyEvent`s from a ring buffer. `shared/vmaas-entry` consumes those events and produces an edit buffer plus a decision; it includes no hardware header at all. On the board a dedicated FreeRTOS task calls `Keypad::tick()` every 5 ms and posts events to a queue the main loop drains, so the 50 ms block in `bus.poll()` cannot drop keypresses.

**Tech Stack:** ESP-IDF 6.1 via PlatformIO (`framework = espidf`, `board = esp32dev`), C++17, Unity on PlatformIO `native`, pyserial for the bench tool.

**Spec:** `docs/superpowers/specs/2026-09-17-keypad-slot-entry-design.md`

## Global Constraints

- Keypad wiring (Main-Controller, ESP32-WROVER on COM6), header pin 1-7 left to right: GPIO14, 25, 26, 27, 18, 19, 23.
- Rows are outputs driven low one at a time; columns are inputs with the ESP32 internal pull-up. Unpressed column reads **high**.
- Which header pins are rows and which are columns is **unknown** until Task 7 runs on the bench. The provisional split is rows = 14, 25, 26, 27 and cols = 18, 19, 23. Only `pins.h` changes when the real answer arrives.
- Key map is the telephone layout `{{'1','2','3'},{'4','5','6'},{'7','8','9'},{'*','0','#'}}`.
- Debounce 20 ms, scan interval 5 ms, slot-entry timeout 10000 ms.
- The driver reports **at most one key at a time**. A second key pressed while another is held is ignored until the first is released. This also suppresses matrix ghosting.
- Library code (`keypad.*`, `keypad_port.h`, `keypad_error.*`, `key_event.h`, `slot_entry.*`, `entry_state.*`) must not include any ESP-IDF or FreeRTOS header. Only `esp_keypad_port.*` may, guarded by `#ifdef ESP_PLATFORM`.
- The libraries never log. Every fallible call returns `vmaas::KeypadError`; `None` is success and must be 0.
- C++ exceptions and RTTI are disabled on the boards. No `throw`, `dynamic_cast`, `typeid`, no `std::string`/`std::vector` in library code (tests may use them).
- Code, comments and docs in English. Doxygen comments on all public headers, same style as `shared/vmaas-protocol` and `shared/vmaas-display`.
- **Do not commit.** The repository owner forbids `git commit` from this tool (see `.claude/settings.json`). Every task ends with a verification step instead of a commit step. The owner commits.
- All work on branch `dev`.

## Toolchain notes (Windows host)

`pio` is not on the tool shell's PATH. Use the full path.

Git Bash:

```bash
export PATH="/c/Users/temp/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
PIO=/c/Users/temp/.platformio/penv/Scripts/pio.exe
```

PowerShell:

```powershell
$PIO = "C:\Users\temp\.platformio\penv\Scripts\pio.exe"
```

Host tests: run from `shared/vmaas-keypad` or `shared/vmaas-entry`: `$PIO test -e native` (all) or `$PIO test -e native -f test_debounce` (one folder).
Firmware build: from `Main-Controller`: `$PIO run -e main-controller`.
Discovery build: from `Main-Controller`: `$PIO run -e keypad-discover -t upload`.
Upload: `$PIO run -e main-controller -t upload` (close any serial monitor on COM6 first; a held port makes the upload fail).
Serial capture without a TTY: `python tools/capture_serial.py COM6 8`.

## Learning checkpoints

Two spots carry decisions the project owner wants to make personally. The executor must **stop and ask**, not pick a default and move on:

- **Task 6, `SlotEntry::handle()` OWNER DECISION** — the three entry rules (third digit, `#` on an empty buffer, leading zeros). The task prepares the file, the signature, the surrounding tests and a clearly marked TODO block of roughly 8 lines. The owner writes that block; the executor then writes the tests that match what the owner chose.
- **Task 7, bench discovery** — the real row/column mapping. The executor runs the tool with the owner at the keypad and does not guess the answer.

## Deviation from the spec

Spec section 5.2 lists `slot_number()` as a member of `SlotEntry`. It is implemented here as a free function `bool slot_number(const EntryState&, uint8_t&)` instead, because `handle()` returns a transient `EntryState` by value (the object resets itself immediately after `Confirmed`), so a member would parse the wrong buffer. Update the spec when this lands.

---

## File Structure

```
shared/vmaas-keypad/
  library.json                          PlatformIO library manifest
  platformio.ini                        [env:native] host tests
  .gitignore                            .pio
  README.md                             wiring, scan model, debounce, usage, test table
  src/key_event.h                       KeyEventType + KeyEvent (header-only, shared with vmaas-entry)
  src/keypad_error.h                    KeypadError enum + to_string() declaration
  src/keypad_error.cpp                  to_string() implementation
  src/keypad_port.h                     KeypadPort interface (configure, drive_row, read_col)
  src/keypad.h                          Keypad class, key map, sizes
  src/keypad.cpp                        scan, debounce, single-key gate, ring buffer
  src/esp_keypad_port.h                 EspKeypadPort (ESP_PLATFORM only)
  src/esp_keypad_port.cpp
  test/fake_keypad_port.h               FakeKeypadPort shared by all test folders
  test/test_keypad_error/test_main.cpp  enum + to_string
  test/test_begin/test_main.cpp         pin validation, ready(), tick() before begin()
  test/test_scan/test_main.cpp          key map coverage, scan pass shape
  test/test_debounce/test_main.cpp      bounce, hold, release, timing
  test/test_multikey/test_main.cpp      single-key gate, ghosting, queue overflow

shared/vmaas-entry/
  library.json
  platformio.ini                        [env:native], -I../vmaas-keypad/src
  .gitignore
  README.md
  src/entry_state.h                     EntryStatus + EntryState + to_string + slot_number
  src/entry_state.cpp
  src/slot_entry.h                      SlotEntry class
  src/slot_entry.cpp                    buffer, */#, timeout
  test/test_entry_state/test_main.cpp   enum, to_string, slot_number parsing
  test/test_editing/test_main.cpp       digits, backspace, cancel, confirm
  test/test_timeout/test_main.cpp       timeout fires, restarts, ignores empty buffer
  test/test_rules/test_main.cpp         the three OWNER DECISION rules

tools/
  keypad_discover.py                    bench tool: 12 prompts -> pins.h block

Main-Controller/
  platformio.ini                        + build_src_filter, + [env:keypad-discover]
  src/pins.h                            + KEYPAD_ROWS[4], KEYPAD_COLS[3]
  src/config.h                          + scan interval, debounce, entry timeout, queue depth
  src/keypad_task.h                     task + queue wiring
  src/keypad_task.cpp
  src/keypad_discover_main.cpp          discovery firmware, own app_main()
  src/main.cpp                          entry flow replaces the RUN 1 smoke test
```

---

## Task 1: Library scaffold, KeyEvent and KeypadError

**Files:**
- Create: `shared/vmaas-keypad/library.json`, `shared/vmaas-keypad/platformio.ini`, `shared/vmaas-keypad/.gitignore`
- Create: `shared/vmaas-keypad/src/key_event.h`, `shared/vmaas-keypad/src/keypad_error.h`, `shared/vmaas-keypad/src/keypad_error.cpp`
- Test: `shared/vmaas-keypad/test/test_keypad_error/test_main.cpp`

**Interfaces:**
- Consumes: nothing.
- Produces: `vmaas::KeyEventType{Pressed, Released}`, `vmaas::KeyEvent{char key; KeyEventType type; uint32_t at_ms;}`, `vmaas::KeypadError{None=0, BadPinConfig, GpioInitFailed, PortUnavailable}`, `const char* vmaas::to_string(KeypadError)`.

- [ ] **Step 1: Create the manifest, test environment and gitignore**

`shared/vmaas-keypad/library.json`:

```json
{
  "name": "vmaas-keypad",
  "version": "0.1.0",
  "description": "Passive 4x3 matrix keypad driver (SparkFun COM-14662) for VMaaS Main-Controller",
  "keywords": ["keypad", "matrix", "gpio", "vmaas"],
  "frameworks": "*",
  "platforms": "*",
  "headers": ["keypad.h", "keypad_port.h", "keypad_error.h", "key_event.h", "esp_keypad_port.h"]
}
```

`shared/vmaas-keypad/platformio.ini`:

```ini
; Host-side unit tests for the shared keypad library.
; Run from this directory: pio test -e native
[env:native]
platform = native
test_framework = unity
test_build_src = yes
build_flags = -std=c++17 -Wall -Wextra
```

`shared/vmaas-keypad/.gitignore`:

```
.pio
```

- [ ] **Step 2: Write the failing test**

`shared/vmaas-keypad/test/test_keypad_error/test_main.cpp`:

```cpp
/**
 * @file test_main.cpp
 * @brief Host tests for KeypadError and to_string().
 *
 * Pure enum/string checks, no fake port needed. Guards two things callers
 * rely on: KeypadError::None is 0, and every code has its own log-friendly
 * name so a log line always says which failure happened.
 */
#include <unity.h>
#include <cstring>
#include "keypad_error.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

// None must be 0 so it is the natural "no error" value and enum ordering stays stable.
void test_none_is_zero()
{
    TEST_ASSERT_EQUAL_UINT8(0, static_cast<uint8_t>(KeypadError::None));
}

// Every code needs its own name; a shared or empty string would make log lines ambiguous.
void test_every_enumerator_has_a_distinct_non_empty_string()
{
    const KeypadError all[] = {
        KeypadError::None, KeypadError::BadPinConfig,
        KeypadError::GpioInitFailed, KeypadError::PortUnavailable,
    };
    const size_t n = sizeof(all) / sizeof(all[0]);
    for (size_t i = 0; i < n; ++i)
    {
        const char* s = to_string(all[i]);
        TEST_ASSERT_NOT_NULL(s);
        TEST_ASSERT_TRUE(std::strlen(s) > 0);
        for (size_t j = 0; j < i; ++j)
            TEST_ASSERT_TRUE(std::strcmp(s, to_string(all[j])) != 0);
    }
}

// A value outside the enum must not walk off the end of a lookup table.
void test_unknown_value_is_named_not_crashed()
{
    const char* s = to_string(static_cast<KeypadError>(99));
    TEST_ASSERT_NOT_NULL(s);
    TEST_ASSERT_EQUAL_STRING("Unknown", s);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_none_is_zero);
    RUN_TEST(test_every_enumerator_has_a_distinct_non_empty_string);
    RUN_TEST(test_unknown_value_is_named_not_crashed);
    return UNITY_END();
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run from `shared/vmaas-keypad`: `$PIO test -e native -f test_keypad_error`
Expected: FAIL to compile with `keypad_error.h: No such file or directory`.

- [ ] **Step 4: Write the headers and implementation**

`shared/vmaas-keypad/src/key_event.h`:

```cpp
#pragma once
/**
 * @file key_event.h
 * @brief What the keypad driver emits, and what vmaas-entry consumes.
 *
 * Header-only and dependency-free on purpose: vmaas-entry includes this one
 * header and nothing else from vmaas-keypad, so the entry logic stays
 * buildable on a PC with no notion of GPIO.
 */
#include <cstdint>

namespace vmaas
{
    /// Whether a key went down or came up.
    enum class KeyEventType : uint8_t
    {
        Pressed = 0, /// Key went down and survived debounce.
        Released,    /// Key came up and survived debounce.
    };

    /// One debounced key transition.
    struct KeyEvent
    {
        char key;           /// '0'-'9', '*' or '#'.
        KeyEventType type;  /// Down or up.
        uint32_t at_ms;     /// Caller's clock when the transition was accepted.
    };
}
```

`shared/vmaas-keypad/src/keypad_error.h`:

```cpp
#pragma once
/**
 * @file keypad_error.h
 * @brief Result codes returned by the vmaas-keypad driver.
 *
 * The library never logs. Every fallible call returns one of these and the
 * caller decides what to do; to_string() gives a log-friendly name.
 */
#include <cstdint>

namespace vmaas
{
    /// Result of a Keypad call. None means success.
    enum class KeypadError : uint8_t
    {
        None = 0,        /// Success.
        BadPinConfig,    /// Negative pin, duplicate pin, or wrong row/column count.
        GpioInitFailed,  /// The port could not configure the pins.
        PortUnavailable, /// begin() has not been called, or it failed.
    };

    /**
     * @brief Human-readable name of an error code.
     * @param e Code to name.
     * @return Static string such as "BadPinConfig"; "Unknown" for values outside the enum.
     */
    const char* to_string(KeypadError e);
}
```

`shared/vmaas-keypad/src/keypad_error.cpp`:

```cpp
/**
 * @file keypad_error.cpp
 * @brief Names for KeypadError.
 */
#include "keypad_error.h"

namespace vmaas
{
    const char* to_string(KeypadError e)
    {
        switch (e)
        {
        case KeypadError::None:            return "None";
        case KeypadError::BadPinConfig:    return "BadPinConfig";
        case KeypadError::GpioInitFailed:  return "GpioInitFailed";
        case KeypadError::PortUnavailable: return "PortUnavailable";
        }
        return "Unknown";
    }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run from `shared/vmaas-keypad`: `$PIO test -e native -f test_keypad_error`
Expected: PASS, 3 tests.

- [ ] **Step 6: Verify (no commit)**

```bash
git add shared/vmaas-keypad
git status --short shared/vmaas-keypad
```

Expected: the six files staged. Do not commit; the owner commits.

---

## Task 2: KeypadPort, FakeKeypadPort and begin() validation

**Files:**
- Create: `shared/vmaas-keypad/src/keypad_port.h`, `shared/vmaas-keypad/src/keypad.h`, `shared/vmaas-keypad/src/keypad.cpp`
- Create: `shared/vmaas-keypad/test/fake_keypad_port.h`, `shared/vmaas-keypad/test/test_begin/test_main.cpp`

**Interfaces:**
- Consumes: `KeypadError`, `KeyEvent` from Task 1.
- Produces: `vmaas::KeypadPort` (pure virtual `configure`/`drive_row`/`read_col`), `vmaas::Keypad` with `begin()`, `tick()`, `next_event()`, `ready()`, `dropped_events()`, and the constants `KEYPAD_ROW_COUNT = 4`, `KEYPAD_COL_COUNT = 3`, `KEYPAD_KEY_COUNT = 12`, `KEYPAD_KEY_MAP[4][3]`, `KEYPAD_DEFAULT_DEBOUNCE_MS = 20`.

- [ ] **Step 1: Write the port interface**

`shared/vmaas-keypad/src/keypad_port.h`:

```cpp
#pragma once
/**
 * @file keypad_port.h
 * @brief Hardware seam between Keypad and the GPIO pins.
 *
 * The driver never touches GPIO directly. It selects a row and samples the
 * columns through this interface. EspKeypadPort implements it on ESP-IDF;
 * tests use a fake that models the matrix as a graph, so ghosting behaves
 * the way real hardware does.
 */
#include <cstddef>
#include "keypad_error.h"

namespace vmaas
{
    /// Minimal row-drive + column-read abstraction used by Keypad.
    class KeypadPort
    {
    public:
        virtual ~KeypadPort() = default;

        /**
         * @brief Claim the pins: rows as outputs (idle high), columns as inputs with pull-up.
         * @param rows Row GPIO numbers.
         * @param row_count Number of entries in @p rows.
         * @param cols Column GPIO numbers.
         * @param col_count Number of entries in @p cols.
         * @return KeypadError::None on success, GpioInitFailed if the pins could not be claimed.
         */
        virtual KeypadError configure(const int* rows, size_t row_count,
                                      const int* cols, size_t col_count) = 0;

        /**
         * @brief Drive one row.
         * @param row Index into the row array passed to configure().
         * @param level true drives high (row not selected), false drives low (selected).
         */
        virtual void drive_row(size_t row, bool level) = 0;

        /**
         * @brief Sample one column.
         * @param col Index into the column array passed to configure().
         * @return true when the line reads high, which with the pull-up means "not pressed".
         */
        virtual bool read_col(size_t col) = 0;
    };
}
```

- [ ] **Step 2: Write the FakeKeypadPort test helper**

The fake models the matrix as a bipartite graph so ghosting emerges from the
simulation rather than being special-cased. A column reads low when it is
reachable from any row currently driven low, walking through pressed keys.

`shared/vmaas-keypad/test/fake_keypad_port.h`:

```cpp
#pragma once
/**
 * @file fake_keypad_port.h
 * @brief Matrix-simulating KeypadPort for the host tests. Included as "../fake_keypad_port.h".
 *
 * press(r, c) / release(r, c) set which switches are closed. read_col() then
 * answers the way real hardware would: a column reads low when a closed-switch
 * path connects it to any row that is currently driven low. Because the path
 * may run through other pressed keys, three-key ghosting appears on its own
 * and the driver's suppression can be tested honestly.
 *
 * configure() records the pins it was handed and can be made to fail with
 * fail_configure so GpioInitFailed can be exercised.
 */
#include <cstddef>
#include <vector>
#include "keypad_port.h"

class FakeKeypadPort : public vmaas::KeypadPort
{
public:
    static constexpr size_t ROWS = 4;
    static constexpr size_t COLS = 3;

    std::vector<int> configured_rows;
    std::vector<int> configured_cols;
    bool fail_configure = false;
    int configure_calls = 0;
    int read_col_calls = 0;

    vmaas::KeypadError configure(const int* rows, size_t row_count,
                                 const int* cols, size_t col_count) override
    {
        ++configure_calls;
        if (fail_configure)
            return vmaas::KeypadError::GpioInitFailed;
        configured_rows.assign(rows, rows + row_count);
        configured_cols.assign(cols, cols + col_count);
        return vmaas::KeypadError::None;
    }

    void drive_row(size_t row, bool level) override
    {
        if (row < ROWS)
            row_low_[row] = !level;
    }

    bool read_col(size_t col) override
    {
        ++read_col_calls;
        if (col >= COLS)
            return true;
        return !col_is_pulled_low(col);
    }

    void press(size_t row, size_t col)
    {
        if (row < ROWS && col < COLS)
            closed_[row][col] = true;
    }

    void release(size_t row, size_t col)
    {
        if (row < ROWS && col < COLS)
            closed_[row][col] = false;
    }

    void release_all()
    {
        for (size_t r = 0; r < ROWS; ++r)
            for (size_t c = 0; c < COLS; ++c)
                closed_[r][c] = false;
    }

private:
    bool closed_[ROWS][COLS] = {};
    bool row_low_[ROWS] = {};

    // Flood the bipartite graph of closed switches from every low row and
    // report whether `col` ends up in the reachable set. This is what makes a
    // phantom key appear when three switches form an L.
    bool col_is_pulled_low(size_t col) const
    {
        bool row_seen[ROWS] = {};
        bool col_seen[COLS] = {};
        for (size_t r = 0; r < ROWS; ++r)
            row_seen[r] = row_low_[r];

        bool grew = true;
        while (grew)
        {
            grew = false;
            for (size_t r = 0; r < ROWS; ++r)
                for (size_t c = 0; c < COLS; ++c)
                {
                    if (!closed_[r][c])
                        continue;
                    if (row_seen[r] && !col_seen[c]) { col_seen[c] = true; grew = true; }
                    if (col_seen[c] && !row_seen[r]) { row_seen[r] = true; grew = true; }
                }
        }
        return col_seen[col];
    }
};
```

- [ ] **Step 3: Write the failing tests for begin()**

`shared/vmaas-keypad/test/test_begin/test_main.cpp`:

```cpp
/**
 * @file test_main.cpp
 * @brief Host tests for Keypad::begin() pin validation and the not-ready guard.
 *
 * begin() is the only place bad wiring can be caught before it turns into
 * silent nonsense at runtime: a duplicated pin would make two rows conduct as
 * one, and a negative pin would be handed straight to the GPIO driver. These
 * tests also pin down that tick() and next_event() are safe to call on an
 * unconfigured object, because main.cpp calls them from a task that starts
 * regardless of whether begin() succeeded.
 */
#include <unity.h>
#include "keypad.h"
#include "../fake_keypad_port.h"

using namespace vmaas;

static const int ROWS[4] = {14, 25, 26, 27};
static const int COLS[3] = {18, 19, 23};

void setUp() {}
void tearDown() {}

// The happy path must claim exactly the pins it was given, in order.
void test_begin_configures_the_given_pins()
{
    FakeKeypadPort port;
    Keypad kp(port);
    TEST_ASSERT_EQUAL(KeypadError::None, kp.begin(ROWS, 4, COLS, 3));
    TEST_ASSERT_TRUE(kp.ready());
    TEST_ASSERT_EQUAL_INT(4, (int)port.configured_rows.size());
    TEST_ASSERT_EQUAL_INT(3, (int)port.configured_cols.size());
    TEST_ASSERT_EQUAL_INT(14, port.configured_rows[0]);
    TEST_ASSERT_EQUAL_INT(23, port.configured_cols[2]);
}

// A count that does not match the 4x3 key map would index the map out of bounds.
void test_begin_rejects_wrong_counts()
{
    FakeKeypadPort port;
    Keypad kp(port);
    TEST_ASSERT_EQUAL(KeypadError::BadPinConfig, kp.begin(ROWS, 3, COLS, 3));
    TEST_ASSERT_EQUAL(KeypadError::BadPinConfig, kp.begin(ROWS, 4, COLS, 2));
    TEST_ASSERT_FALSE(kp.ready());
}

// A pin repeated anywhere means two lines are physically shorted; refuse it.
void test_begin_rejects_duplicate_pins()
{
    FakeKeypadPort port;
    Keypad kp(port);
    const int dup_rows[4] = {14, 25, 14, 27};
    TEST_ASSERT_EQUAL(KeypadError::BadPinConfig, kp.begin(dup_rows, 4, COLS, 3));

    const int clash_cols[3] = {18, 19, 27};   // 27 is also a row
    TEST_ASSERT_EQUAL(KeypadError::BadPinConfig, kp.begin(ROWS, 4, clash_cols, 3));
    TEST_ASSERT_FALSE(kp.ready());
}

// A negative pin is never a valid GPIO and must not reach the port.
void test_begin_rejects_negative_pins()
{
    FakeKeypadPort port;
    Keypad kp(port);
    const int bad_rows[4] = {14, -1, 26, 27};
    TEST_ASSERT_EQUAL(KeypadError::BadPinConfig, kp.begin(bad_rows, 4, COLS, 3));
    TEST_ASSERT_EQUAL_INT(0, port.configure_calls);
}

// A nullptr array is a caller bug, not a crash.
void test_begin_rejects_null_arrays()
{
    FakeKeypadPort port;
    Keypad kp(port);
    TEST_ASSERT_EQUAL(KeypadError::BadPinConfig, kp.begin(nullptr, 4, COLS, 3));
    TEST_ASSERT_EQUAL(KeypadError::BadPinConfig, kp.begin(ROWS, 4, nullptr, 3));
}

// When the port cannot claim the pins the driver must stay unready.
void test_begin_propagates_port_failure()
{
    FakeKeypadPort port;
    port.fail_configure = true;
    Keypad kp(port);
    TEST_ASSERT_EQUAL(KeypadError::GpioInitFailed, kp.begin(ROWS, 4, COLS, 3));
    TEST_ASSERT_FALSE(kp.ready());
}

// The scan task starts unconditionally, so these must be no-ops before begin().
void test_tick_and_next_event_are_safe_before_begin()
{
    FakeKeypadPort port;
    Keypad kp(port);
    port.press(0, 0);
    kp.tick(0);
    kp.tick(100);
    KeyEvent ev{};
    TEST_ASSERT_FALSE(kp.next_event(ev));
    TEST_ASSERT_EQUAL_INT(0, port.read_col_calls);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_begin_configures_the_given_pins);
    RUN_TEST(test_begin_rejects_wrong_counts);
    RUN_TEST(test_begin_rejects_duplicate_pins);
    RUN_TEST(test_begin_rejects_negative_pins);
    RUN_TEST(test_begin_rejects_null_arrays);
    RUN_TEST(test_begin_propagates_port_failure);
    RUN_TEST(test_tick_and_next_event_are_safe_before_begin);
    return UNITY_END();
}
```

- [ ] **Step 4: Run the tests to verify they fail**

Run from `shared/vmaas-keypad`: `$PIO test -e native -f test_begin`
Expected: FAIL to compile with `keypad.h: No such file or directory`.

- [ ] **Step 5: Write the class declaration**

`shared/vmaas-keypad/src/keypad.h`:

```cpp
#pragma once
/**
 * @file keypad.h
 * @brief Debounced scanner for a passive 4x3 matrix keypad (SparkFun COM-14662).
 *
 * The keypad has no driver chip: 12 switches share 7 lines, each switch
 * joining one row to one column. tick() drives each row low in turn and
 * samples the columns, then debounces in the time domain against the caller's
 * clock. Because now_ms is a parameter rather than a call into FreeRTOS, the
 * whole driver runs on a PC under test.
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
    /// Recommended gap between tick() calls, in milliseconds.
    inline constexpr uint32_t KEYPAD_DEFAULT_SCAN_MS = 5;

    /// Standard telephone layout, indexed [row][col].
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

        bool raw_[KEYPAD_KEY_COUNT] = {};        // last sampled state per key
        bool stable_[KEYPAD_KEY_COUNT] = {};     // accepted state per key
        uint32_t changed_at_[KEYPAD_KEY_COUNT] = {}; // when raw_ last moved
        int active_ = -1;                        // key index currently reported, or -1

        KeyEvent queue_[QUEUE_SIZE] = {};
        size_t head_ = 0;
        size_t tail_ = 0;
        size_t count_ = 0;
        uint32_t dropped_ = 0;
    };
}
```

- [ ] **Step 6: Write begin() and stub the rest**

`shared/vmaas-keypad/src/keypad.cpp`:

```cpp
/**
 * @file keypad.cpp
 * @brief Matrix scan, debounce and event queue.
 */
#include "keypad.h"

namespace vmaas
{
    Keypad::Keypad(KeypadPort& port, uint32_t debounce_ms)
        : port_(port), debounce_ms_(debounce_ms)
    {
    }

    char Keypad::key_of(size_t index)
    {
        return KEYPAD_KEY_MAP[index / KEYPAD_COL_COUNT][index % KEYPAD_COL_COUNT];
    }

    KeypadError Keypad::begin(const int* rows, size_t row_count,
                              const int* cols, size_t col_count)
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
        (void)now_ms;   // replaced in Task 3
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
        (void)raw; (void)now_ms;   // replaced in Task 3
    }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run from `shared/vmaas-keypad`: `$PIO test -e native`
Expected: PASS, 10 tests (3 from Task 1, 7 here).

- [ ] **Step 8: Verify (no commit)**

```bash
git add shared/vmaas-keypad
git status --short shared/vmaas-keypad
```

---

## Task 3: Scan pass, key map coverage and debounce

**Files:**
- Modify: `shared/vmaas-keypad/src/keypad.cpp` (replace the `tick()` and `debounce()` stubs)
- Create: `shared/vmaas-keypad/test/test_scan/test_main.cpp`, `shared/vmaas-keypad/test/test_debounce/test_main.cpp`

**Interfaces:**
- Consumes: `Keypad`, `FakeKeypadPort` from Task 2.
- Produces: working `tick()` and `debounce()`; no signature changes.

- [ ] **Step 1: Write the failing scan tests**

`shared/vmaas-keypad/test/test_scan/test_main.cpp`:

```cpp
/**
 * @file test_main.cpp
 * @brief Host tests for the scan pass and the key map.
 *
 * Every one of the 12 switches must produce its own character, because a
 * transposed key map is the kind of bug that survives a casual bench check
 * ("the 5 works!") and then bites on slot 12. The scan-shape test pins down
 * that exactly one row is low at a time, which is what keeps a single press
 * from lighting up several columns.
 */
#include <unity.h>
#include "keypad.h"
#include "../fake_keypad_port.h"

using namespace vmaas;

static const int ROWS[4] = {14, 25, 26, 27};
static const int COLS[3] = {18, 19, 23};

void setUp() {}
void tearDown() {}

// Hold a key long enough to clear debounce and return the character it produced.
static char press_and_read(FakeKeypadPort& port, Keypad& kp, size_t r, size_t c)
{
    port.release_all();
    kp.tick(0);
    port.press(r, c);
    kp.tick(100);          // first sight of the new raw state
    kp.tick(100 + KEYPAD_DEFAULT_DEBOUNCE_MS);  // accepted here
    KeyEvent ev{};
    if (!kp.next_event(ev))
        return '\0';
    return (ev.type == KeyEventType::Pressed) ? ev.key : '\0';
}

// All 12 switches, in layout order. A transposition shows up immediately.
void test_every_switch_maps_to_its_character()
{
    const char expected[4][3] = {
        {'1', '2', '3'},
        {'4', '5', '6'},
        {'7', '8', '9'},
        {'*', '0', '#'},
    };
    for (size_t r = 0; r < 4; ++r)
        for (size_t c = 0; c < 3; ++c)
        {
            // Fresh driver per key so a leftover active_ cannot mask a mapping bug.
            FakeKeypadPort p;
            Keypad k(p);
            k.begin(ROWS, 4, COLS, 3);
            TEST_ASSERT_EQUAL_CHAR(expected[r][c], press_and_read(p, k, r, c));
        }
}

// One scan pass must sample every column once per row: 4 rows x 3 columns.
void test_one_tick_samples_the_whole_matrix()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);
    port.read_col_calls = 0;
    kp.tick(0);
    TEST_ASSERT_EQUAL_INT(12, port.read_col_calls);
}

// With nothing pressed the driver must stay silent forever.
void test_idle_matrix_produces_no_events()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);
    for (uint32_t t = 0; t < 500; t += 5)
        kp.tick(t);
    KeyEvent ev{};
    TEST_ASSERT_FALSE(kp.next_event(ev));
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_every_switch_maps_to_its_character);
    RUN_TEST(test_one_tick_samples_the_whole_matrix);
    RUN_TEST(test_idle_matrix_produces_no_events);
    return UNITY_END();
}
```

- [ ] **Step 2: Write the failing debounce tests**

`shared/vmaas-keypad/test/test_debounce/test_main.cpp`:

```cpp
/**
 * @file test_main.cpp
 * @brief Host tests for the time-domain debounce.
 *
 * The COM-14662 is a mechanical switch with 10-150 ohm contacts: one press
 * produces a burst of edges over roughly 10-20 ms. Without debounce a single
 * tap would enter four digits. These tests drive that burst explicitly rather
 * than trusting a delay, which is only possible because now_ms is injected.
 */
#include <unity.h>
#include "keypad.h"
#include "../fake_keypad_port.h"

using namespace vmaas;

static const int ROWS[4] = {14, 25, 26, 27};
static const int COLS[3] = {18, 19, 23};

void setUp() {}
void tearDown() {}

static int drain(Keypad& kp, KeyEvent* out, int max)
{
    int n = 0;
    KeyEvent ev{};
    while (n < max && kp.next_event(ev))
        out[n++] = ev;
    return n;
}

// A 15 ms chatter burst is one press, not eight.
void test_bounce_burst_produces_exactly_one_pressed()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);

    uint32_t t = 0;
    kp.tick(t);
    for (int i = 0; i < 8; ++i)     // 8 edges over 16 ms, never settling
    {
        if (i % 2 == 0) port.press(0, 0); else port.release(0, 0);
        t += 2;
        kp.tick(t);
    }
    port.press(0, 0);               // settles closed at t = 16
    t = 16;
    kp.tick(t);
    KeyEvent evs[8];
    TEST_ASSERT_EQUAL_INT(0, drain(kp, evs, 8));   // nothing accepted yet

    kp.tick(16 + KEYPAD_DEFAULT_DEBOUNCE_MS);
    TEST_ASSERT_EQUAL_INT(1, drain(kp, evs, 8));
    TEST_ASSERT_EQUAL_CHAR('1', evs[0].key);
    TEST_ASSERT_EQUAL(KeyEventType::Pressed, evs[0].type);
}

// Nothing may be emitted before the state has held for the full debounce window.
void test_press_is_not_accepted_one_millisecond_early()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);

    kp.tick(0);
    port.press(1, 1);
    kp.tick(100);
    kp.tick(100 + KEYPAD_DEFAULT_DEBOUNCE_MS - 1);
    KeyEvent ev{};
    TEST_ASSERT_FALSE(kp.next_event(ev));

    kp.tick(100 + KEYPAD_DEFAULT_DEBOUNCE_MS);
    TEST_ASSERT_TRUE(kp.next_event(ev));
    TEST_ASSERT_EQUAL_CHAR('5', ev.key);
}

// Holding a key must not auto-repeat; the entry buffer would fill with one digit.
void test_hold_produces_no_repeat()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);

    kp.tick(0);
    port.press(2, 2);
    for (uint32_t t = 5; t <= 2000; t += 5)
        kp.tick(t);

    KeyEvent evs[8];
    TEST_ASSERT_EQUAL_INT(1, drain(kp, evs, 8));
    TEST_ASSERT_EQUAL_CHAR('9', evs[0].key);
}

// Release is an event too: the entry layer uses it to know the key is free again.
void test_release_produces_exactly_one_released_with_the_same_key()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);

    kp.tick(0);
    port.press(3, 0);
    kp.tick(10);
    kp.tick(10 + KEYPAD_DEFAULT_DEBOUNCE_MS);
    KeyEvent evs[8];
    TEST_ASSERT_EQUAL_INT(1, drain(kp, evs, 8));
    TEST_ASSERT_EQUAL_CHAR('*', evs[0].key);

    port.release(3, 0);
    kp.tick(200);
    kp.tick(200 + KEYPAD_DEFAULT_DEBOUNCE_MS);
    TEST_ASSERT_EQUAL_INT(1, drain(kp, evs, 8));
    TEST_ASSERT_EQUAL_CHAR('*', evs[0].key);
    TEST_ASSERT_EQUAL(KeyEventType::Released, evs[0].type);
}

// at_ms must be the moment the state was accepted, so the entry timeout is honest.
void test_event_timestamp_is_the_acceptance_time()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);

    kp.tick(0);
    port.press(0, 2);
    kp.tick(1000);
    kp.tick(1000 + KEYPAD_DEFAULT_DEBOUNCE_MS);
    KeyEvent ev{};
    TEST_ASSERT_TRUE(kp.next_event(ev));
    TEST_ASSERT_EQUAL_UINT32(1000 + KEYPAD_DEFAULT_DEBOUNCE_MS, ev.at_ms);
}

// A shorter window is a constructor argument, not a rebuild.
void test_debounce_window_is_configurable()
{
    FakeKeypadPort port;
    Keypad kp(port, 4);
    kp.begin(ROWS, 4, COLS, 3);

    kp.tick(0);
    port.press(0, 0);
    kp.tick(10);
    kp.tick(14);
    KeyEvent ev{};
    TEST_ASSERT_TRUE(kp.next_event(ev));
    TEST_ASSERT_EQUAL_CHAR('1', ev.key);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_bounce_burst_produces_exactly_one_pressed);
    RUN_TEST(test_press_is_not_accepted_one_millisecond_early);
    RUN_TEST(test_hold_produces_no_repeat);
    RUN_TEST(test_release_produces_exactly_one_released_with_the_same_key);
    RUN_TEST(test_event_timestamp_is_the_acceptance_time);
    RUN_TEST(test_debounce_window_is_configurable);
    return UNITY_END();
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run from `shared/vmaas-keypad`: `$PIO test -e native -f test_scan -f test_debounce`
Expected: FAIL. `tick()` is a stub, so no events are ever queued; the scan test reports 0 `read_col` calls and the debounce tests report 0 events.

- [ ] **Step 4: Replace the tick() and debounce() stubs**

In `shared/vmaas-keypad/src/keypad.cpp`, replace both stub bodies:

```cpp
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run from `shared/vmaas-keypad`: `$PIO test -e native`
Expected: PASS, 19 tests.

- [ ] **Step 6: Verify (no commit)**

```bash
git add shared/vmaas-keypad
git status --short shared/vmaas-keypad
```

---

## Task 4: Single-key gate, ghosting and queue overflow

**Files:**
- Create: `shared/vmaas-keypad/test/test_multikey/test_main.cpp`
- Modify: none expected. The behaviour was implemented in Task 3; this task proves it and fixes whatever the tests catch.

**Interfaces:**
- Consumes: `Keypad`, `FakeKeypadPort`.
- Produces: no new API. Confirms `dropped_events()` semantics.

- [ ] **Step 1: Write the failing tests**

`shared/vmaas-keypad/test/test_multikey/test_main.cpp`:

```cpp
/**
 * @file test_main.cpp
 * @brief Host tests for the one-key-at-a-time rule, ghosting and queue overflow.
 *
 * The COM-14662 has no diodes. With three switches closed in an L shape,
 * current reaches a fourth intersection and the scan reads a key nobody
 * touched. FakeKeypadPort reproduces that by flooding the switch graph, so
 * the phantom is real here rather than assumed away. The driver's answer is
 * to report at most one key, which these tests hold it to.
 */
#include <unity.h>
#include "keypad.h"
#include "../fake_keypad_port.h"

using namespace vmaas;

static const int ROWS[4] = {14, 25, 26, 27};
static const int COLS[3] = {18, 19, 23};

void setUp() {}
void tearDown() {}

static int drain(Keypad& kp, KeyEvent* out, int max)
{
    int n = 0;
    KeyEvent ev{};
    while (n < max && kp.next_event(ev))
        out[n++] = ev;
    return n;
}

// Settle a changed matrix state through the debounce window.
static void settle(Keypad& kp, uint32_t& t)
{
    t += 5;
    kp.tick(t);
    t += KEYPAD_DEFAULT_DEBOUNCE_MS;
    kp.tick(t);
}

// The second key is ignored while the first is held.
void test_second_key_is_ignored_until_the_first_is_released()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);
    uint32_t t = 0;
    kp.tick(t);

    port.press(0, 0);                 // '1'
    settle(kp, t);
    KeyEvent evs[8];
    TEST_ASSERT_EQUAL_INT(1, drain(kp, evs, 8));
    TEST_ASSERT_EQUAL_CHAR('1', evs[0].key);

    port.press(1, 1);                 // '5' while '1' is still down
    settle(kp, t);
    TEST_ASSERT_EQUAL_INT(0, drain(kp, evs, 8));
}

// An ignored key must not emit a Released when it comes back up.
void test_ignored_key_emits_nothing_on_release()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);
    uint32_t t = 0;
    kp.tick(t);

    port.press(0, 0);
    settle(kp, t);
    KeyEvent evs[8];
    drain(kp, evs, 8);

    port.press(1, 1);
    settle(kp, t);
    port.release(1, 1);
    settle(kp, t);
    TEST_ASSERT_EQUAL_INT(0, drain(kp, evs, 8));

    port.release(0, 0);
    settle(kp, t);
    TEST_ASSERT_EQUAL_INT(1, drain(kp, evs, 8));
    TEST_ASSERT_EQUAL_CHAR('1', evs[0].key);
    TEST_ASSERT_EQUAL(KeyEventType::Released, evs[0].type);
}

// After the first key is released the keypad accepts the next one normally.
void test_next_key_works_after_release()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);
    uint32_t t = 0;
    kp.tick(t);
    KeyEvent evs[8];

    port.press(0, 0);
    settle(kp, t);
    drain(kp, evs, 8);
    port.release(0, 0);
    settle(kp, t);
    drain(kp, evs, 8);

    port.press(3, 2);                 // '#'
    settle(kp, t);
    TEST_ASSERT_EQUAL_INT(1, drain(kp, evs, 8));
    TEST_ASSERT_EQUAL_CHAR('#', evs[0].key);
}

// The classic L: (0,0), (0,1) and (1,0) closed make (1,1) read as pressed.
// The fake really produces that phantom; the driver must never report it.
void test_three_keys_never_report_a_phantom_fourth()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);
    uint32_t t = 0;
    kp.tick(t);
    KeyEvent evs[8];

    port.press(0, 0);
    port.press(0, 1);
    port.press(1, 0);
    settle(kp, t);

    const int n = drain(kp, evs, 8);
    TEST_ASSERT_TRUE(n <= 1);
    for (int i = 0; i < n; ++i)
        TEST_ASSERT_TRUE(evs[i].key != '5');   // '5' is (1,1), the phantom
}

// Confirm the fake models ghosting, so the test above is not passing by luck.
void test_fake_port_really_ghosts()
{
    FakeKeypadPort port;
    port.press(0, 0);
    port.press(0, 1);
    port.press(1, 0);
    port.drive_row(0, true);
    port.drive_row(1, false);          // select row 1 only
    port.drive_row(2, true);
    port.drive_row(3, true);
    TEST_ASSERT_FALSE(port.read_col(1));   // (1,1) reads low although it is open
}

// A main loop that stalls must lose the newest events, not corrupt the queue,
// and must be able to say how many it lost.
void test_queue_overflow_drops_and_counts()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);
    uint32_t t = 0;
    kp.tick(t);

    // 20 press/release pairs = 40 events into a 16-slot queue, never drained.
    for (int i = 0; i < 20; ++i)
    {
        port.press(0, 0);
        settle(kp, t);
        port.release(0, 0);
        settle(kp, t);
    }

    TEST_ASSERT_TRUE(kp.dropped_events() > 0);

    KeyEvent evs[32];
    const int n = drain(kp, evs, 32);
    TEST_ASSERT_EQUAL_INT(16, n);
    TEST_ASSERT_EQUAL_CHAR('1', evs[0].key);          // oldest kept
    TEST_ASSERT_EQUAL(KeyEventType::Pressed, evs[0].type);
    TEST_ASSERT_EQUAL_UINT32(40u - 16u, kp.dropped_events());
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_second_key_is_ignored_until_the_first_is_released);
    RUN_TEST(test_ignored_key_emits_nothing_on_release);
    RUN_TEST(test_next_key_works_after_release);
    RUN_TEST(test_three_keys_never_report_a_phantom_fourth);
    RUN_TEST(test_fake_port_really_ghosts);
    RUN_TEST(test_queue_overflow_drops_and_counts);
    return UNITY_END();
}
```

- [ ] **Step 2: Run the tests**

Run from `shared/vmaas-keypad`: `$PIO test -e native -f test_multikey`
Expected: PASS, 6 tests, because Task 3 already implemented the gate. If any fail, fix `Keypad::debounce()` — do not weaken the test.

- [ ] **Step 3: Run the whole suite**

Run from `shared/vmaas-keypad`: `$PIO test -e native`
Expected: PASS, 25 tests.

- [ ] **Step 4: Verify (no commit)**

```bash
git add shared/vmaas-keypad
git status --short shared/vmaas-keypad
```

---

## Task 5: EspKeypadPort

**Files:**
- Create: `shared/vmaas-keypad/src/esp_keypad_port.h`, `shared/vmaas-keypad/src/esp_keypad_port.cpp`
- Create: `shared/vmaas-keypad/README.md`

**Interfaces:**
- Consumes: `KeypadPort`, `KeypadError`.
- Produces: `vmaas::EspKeypadPort` with a default constructor, implementing `KeypadPort`.

This task has no host tests: it is the one file that exists to touch ESP-IDF, and the compiler plus Task 9's bench run are its verification. Its correctness claim is "it builds for the board and the pins behave"; nothing a fake could assert would add to that.

- [ ] **Step 1: Write the header**

`shared/vmaas-keypad/src/esp_keypad_port.h`:

```cpp
#pragma once
/**
 * @file esp_keypad_port.h
 * @brief ESP-IDF implementation of KeypadPort.
 *
 * The only file in vmaas-keypad that includes an ESP-IDF header, and the only
 * one that cannot run on the host. Rows become outputs idling high, columns
 * become inputs with the internal pull-up, which is what makes an unpressed
 * column read high.
 */
#ifdef ESP_PLATFORM

#include "keypad_port.h"
#include "keypad.h"

namespace vmaas
{
    /// Drives the keypad matrix with the ESP-IDF gpio driver.
    class EspKeypadPort : public KeypadPort
    {
    public:
        KeypadError configure(const int* rows, size_t row_count,
                              const int* cols, size_t col_count) override;
        void drive_row(size_t row, bool level) override;
        bool read_col(size_t col) override;

    private:
        int rows_[KEYPAD_ROW_COUNT] = {};
        int cols_[KEYPAD_COL_COUNT] = {};
        bool configured_ = false;
    };
}

#endif // ESP_PLATFORM
```

- [ ] **Step 2: Write the implementation**

`shared/vmaas-keypad/src/esp_keypad_port.cpp`:

```cpp
/**
 * @file esp_keypad_port.cpp
 * @brief ESP-IDF GPIO wiring for the keypad matrix.
 */
#ifdef ESP_PLATFORM

#include "esp_keypad_port.h"
#include "driver/gpio.h"

namespace vmaas
{
    KeypadError EspKeypadPort::configure(const int* rows, size_t row_count,
                                         const int* cols, size_t col_count)
    {
        configured_ = false;
        if (row_count != KEYPAD_ROW_COUNT || col_count != KEYPAD_COL_COUNT)
            return KeypadError::BadPinConfig;

        uint64_t row_mask = 0;
        uint64_t col_mask = 0;
        for (size_t i = 0; i < row_count; ++i)
        {
            rows_[i] = rows[i];
            row_mask |= (1ULL << rows[i]);
        }
        for (size_t i = 0; i < col_count; ++i)
        {
            cols_[i] = cols[i];
            col_mask |= (1ULL << cols[i]);
        }

        gpio_config_t row_cfg = {};
        row_cfg.pin_bit_mask = row_mask;
        row_cfg.mode = GPIO_MODE_OUTPUT;
        row_cfg.pull_up_en = GPIO_PULLUP_DISABLE;
        row_cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
        row_cfg.intr_type = GPIO_INTR_DISABLE;
        if (gpio_config(&row_cfg) != ESP_OK)
            return KeypadError::GpioInitFailed;

        // Columns float without this pull-up, and a floating input reads as
        // noise: every scan would invent keypresses.
        gpio_config_t col_cfg = {};
        col_cfg.pin_bit_mask = col_mask;
        col_cfg.mode = GPIO_MODE_INPUT;
        col_cfg.pull_up_en = GPIO_PULLUP_ENABLE;
        col_cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
        col_cfg.intr_type = GPIO_INTR_DISABLE;
        if (gpio_config(&col_cfg) != ESP_OK)
            return KeypadError::GpioInitFailed;

        for (size_t i = 0; i < row_count; ++i)
            gpio_set_level(static_cast<gpio_num_t>(rows_[i]), 1);   // idle high

        configured_ = true;
        return KeypadError::None;
    }

    void EspKeypadPort::drive_row(size_t row, bool level)
    {
        if (!configured_ || row >= KEYPAD_ROW_COUNT)
            return;
        gpio_set_level(static_cast<gpio_num_t>(rows_[row]), level ? 1 : 0);
    }

    bool EspKeypadPort::read_col(size_t col)
    {
        if (!configured_ || col >= KEYPAD_COL_COUNT)
            return true;   // "not pressed" is the safe answer
        return gpio_get_level(static_cast<gpio_num_t>(cols_[col])) != 0;
    }
}

#endif // ESP_PLATFORM
```

- [ ] **Step 3: Write the README**

`shared/vmaas-keypad/README.md` must contain, in this order:

1. One paragraph: what the library is (SparkFun COM-14662, passive 4x3 matrix, no driver chip, no supply pins) and that it is host-testable.
2. A wiring table with header pins 1-7 against GPIO 14, 25, 26, 27, 18, 19, 23, and a sentence saying the row/column split is provisional until `tools/keypad_discover.py` has run.
3. A "How the scan works" section: one row low at a time, columns read against the internal pull-up, 12-bit raw bitmap, debounce in the time domain against an injected clock.
4. A "One key at a time" section explaining ghosting and the gate.
5. A usage snippet:

```cpp
vmaas::EspKeypadPort port;
vmaas::Keypad keypad(port);
const vmaas::KeypadError err = keypad.begin(Pins::KEYPAD_ROWS, 4, Pins::KEYPAD_COLS, 3);
if (err != vmaas::KeypadError::None)
    ESP_LOGE(TAG, "keypad init failed: %s", vmaas::to_string(err));

// in the scan task, every 5 ms:
keypad.tick(now_ms());

// wherever events are consumed:
vmaas::KeyEvent ev;
while (keypad.next_event(ev))
    entry.handle(ev);
```

6. A Tests table with one row per test folder and what it covers, matching the `vmaas-display` README style.

- [ ] **Step 4: Verify the host suite still builds and passes**

Run from `shared/vmaas-keypad`: `$PIO test -e native`
Expected: PASS, 25 tests. `esp_keypad_port.cpp` compiles to nothing on the host because of the `ESP_PLATFORM` guard.

- [ ] **Step 5: Verify (no commit)**

```bash
git add shared/vmaas-keypad
git status --short shared/vmaas-keypad
```

---

## Task 6: vmaas-entry and the SlotEntry state machine

**Files:**
- Create: `shared/vmaas-entry/library.json`, `platformio.ini`, `.gitignore`, `README.md`
- Create: `shared/vmaas-entry/src/entry_state.h`, `entry_state.cpp`, `slot_entry.h`, `slot_entry.cpp`
- Create: `shared/vmaas-entry/test/test_entry_state/test_main.cpp`, `test_editing/test_main.cpp`, `test_timeout/test_main.cpp`, `test_rules/test_main.cpp`

**Interfaces:**
- Consumes: `vmaas::KeyEvent`, `vmaas::KeyEventType` from `key_event.h` only.
- Produces: `vmaas::EntryStatus{Editing, Confirmed, Cancelled, TimedOut}`, `vmaas::EntryState{char buffer[3]; EntryStatus status;}`, `const char* vmaas::to_string(EntryStatus)`, `bool vmaas::slot_number(const EntryState&, uint8_t&)`, `vmaas::SlotEntry` with `handle`, `tick`, `state`, `reset`.

- [ ] **Step 1: Create the scaffold**

`shared/vmaas-entry/library.json`:

```json
{
  "name": "vmaas-entry",
  "version": "0.1.0",
  "description": "Hardware-free slot-number entry state machine for VMaaS",
  "keywords": ["entry", "keypad", "ui", "vmaas"],
  "frameworks": "*",
  "platforms": "*",
  "headers": ["slot_entry.h", "entry_state.h"]
}
```

`shared/vmaas-entry/platformio.ini`:

```ini
; Host-side unit tests for the shared entry library.
; Run from this directory: pio test -e native
; key_event.h is the only thing borrowed from vmaas-keypad, and it is
; header-only, so an include path is enough - no library dependency.
[env:native]
platform = native
test_framework = unity
test_build_src = yes
build_flags = -std=c++17 -Wall -Wextra -I../vmaas-keypad/src
```

`shared/vmaas-entry/.gitignore`:

```
.pio
```

- [ ] **Step 2: Write the headers**

`shared/vmaas-entry/src/entry_state.h`:

```cpp
#pragma once
/**
 * @file entry_state.h
 * @brief What a slot entry looks like from the outside.
 *
 * EntryState is a value, not a handle: handle() and tick() return one by
 * copy. Confirmed, Cancelled and TimedOut are transient - they are reported
 * once, and the SlotEntry that produced them is already back to an empty
 * Editing state by the time the caller sees them. That is why slot_number()
 * is a free function over the returned value rather than a member.
 */
#include <cstdint>

namespace vmaas
{
    /// Where an entry stands.
    enum class EntryStatus : uint8_t
    {
        Editing = 0, /// Buffer may be empty or partial; nothing decided.
        Confirmed,   /// User pressed '#' on a non-empty buffer.
        Cancelled,   /// User backed out of an empty buffer.
        TimedOut,    /// No key for the timeout window; buffer was discarded.
    };

    /// Maximum digits an entry can hold.
    inline constexpr uint8_t SLOT_ENTRY_MAX_DIGITS = 2;
    /// Milliseconds of inactivity before a partial entry is discarded.
    inline constexpr uint32_t SLOT_ENTRY_TIMEOUT_MS = 10000;

    /// A snapshot of an entry: what is typed, and what just happened.
    struct EntryState
    {
        char buffer[SLOT_ENTRY_MAX_DIGITS + 1]; /// NUL-terminated digits.
        EntryStatus status;                      /// What just happened.
    };

    /**
     * @brief Human-readable name of a status.
     * @param s Status to name.
     * @return Static string such as "Confirmed"; "Unknown" outside the enum.
     */
    const char* to_string(EntryStatus s);

    /**
     * @brief Parse the buffer of a state into a slot number.
     * @param st State to read.
     * @param out Receives the parsed number when the call succeeds.
     * @return false when the buffer is empty or holds a non-digit.
     */
    bool slot_number(const EntryState& st, uint8_t& out);
}
```

`shared/vmaas-entry/src/slot_entry.h`:

```cpp
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
```

- [ ] **Step 3: Write entry_state.cpp**

`shared/vmaas-entry/src/entry_state.cpp`:

```cpp
/**
 * @file entry_state.cpp
 * @brief Names and parsing for EntryState.
 */
#include "entry_state.h"

namespace vmaas
{
    const char* to_string(EntryStatus s)
    {
        switch (s)
        {
        case EntryStatus::Editing:   return "Editing";
        case EntryStatus::Confirmed: return "Confirmed";
        case EntryStatus::Cancelled: return "Cancelled";
        case EntryStatus::TimedOut:  return "TimedOut";
        }
        return "Unknown";
    }

    bool slot_number(const EntryState& st, uint8_t& out)
    {
        if (st.buffer[0] == '\0')
            return false;

        uint16_t value = 0;
        for (const char* p = st.buffer; *p != '\0'; ++p)
        {
            if (*p < '0' || *p > '9')
                return false;
            value = static_cast<uint16_t>(value * 10 + (*p - '0'));
        }
        out = static_cast<uint8_t>(value);
        return true;
    }
}
```

- [ ] **Step 4: Write slot_entry.cpp with the OWNER DECISION block**

Write the file exactly as below, including the marked block. **Do not fill the
block in.** Stop after this step and hand it to the owner.

`shared/vmaas-entry/src/slot_entry.cpp`:

```cpp
/**
 * @file slot_entry.cpp
 * @brief Buffer, '*', '#' and the inactivity timeout.
 */
#include "slot_entry.h"

namespace vmaas
{
    SlotEntry::SlotEntry(uint8_t max_digits, uint32_t timeout_ms)
        : max_digits_(max_digits), timeout_ms_(timeout_ms)
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
        // An empty buffer has nothing to discard, so the timeout only runs
        // once the user has actually started typing.
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

        // ---------------------------------------------------------------
        // OWNER DECISION - do not fill in without the project owner.
        //
        // Three rules, each with more than one defensible answer:
        //
        //   1. A digit arrives while the buffer already holds max_digits_.
        //      Ignore it, or drop the oldest digit and append (shift left)?
        //      Ignoring is predictable; shifting lets a user correct a
        //      mistyped first digit without reaching for '*'.
        //
        //   2. '#' on an empty buffer. Confirm nothing (return Editing and
        //      do nothing), or treat it as Cancelled?
        //
        //   3. '*' on a non-empty buffer deletes the last digit; on an empty
        //      buffer it returns Cancelled. That part is settled. What is not:
        //      does a leading zero survive, so "07" confirms as slot 7, or is
        //      a leading zero refused at entry time?
        //
        // Write roughly eight lines here handling: '0'-'9', '*' and '#'.
        // Everything else (there is nothing else on this keypad) falls
        // through to the Editing return below.
        //
        // Available state: buffer_, length_, max_digits_, and the helpers
        // snapshot(EntryStatus) and reset(). Return snapshot(...) for a
        // transient result, calling reset() first where the entry is over.
        // ---------------------------------------------------------------

        return state();
    }
}
```

- [ ] **Step 5: Ask the owner to write the block**

Report to the owner, quoting the three questions above, and wait. Do not
choose defaults. Once they answer, write their code into the marked block,
replacing the comment.

- [ ] **Step 6: Write the tests that are independent of the owner's rules**

`shared/vmaas-entry/test/test_entry_state/test_main.cpp`:

```cpp
/**
 * @file test_main.cpp
 * @brief Host tests for EntryStatus naming and slot_number() parsing.
 *
 * slot_number() is what turns typed characters into a number the protocol can
 * carry, so it is the last place a stray character can be caught before a
 * DISPENSE goes out with a nonsense slot.
 */
#include <unity.h>
#include <cstring>
#include "entry_state.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

void test_editing_is_zero()
{
    TEST_ASSERT_EQUAL_UINT8(0, static_cast<uint8_t>(EntryStatus::Editing));
}

void test_every_status_has_a_distinct_non_empty_string()
{
    const EntryStatus all[] = {
        EntryStatus::Editing, EntryStatus::Confirmed,
        EntryStatus::Cancelled, EntryStatus::TimedOut,
    };
    const size_t n = sizeof(all) / sizeof(all[0]);
    for (size_t i = 0; i < n; ++i)
    {
        const char* s = to_string(all[i]);
        TEST_ASSERT_NOT_NULL(s);
        TEST_ASSERT_TRUE(std::strlen(s) > 0);
        for (size_t j = 0; j < i; ++j)
            TEST_ASSERT_TRUE(std::strcmp(s, to_string(all[j])) != 0);
    }
}

void test_unknown_status_is_named_not_crashed()
{
    TEST_ASSERT_EQUAL_STRING("Unknown", to_string(static_cast<EntryStatus>(99)));
}

void test_slot_number_parses_one_and_two_digits()
{
    EntryState a{{'7', '\0', '\0'}, EntryStatus::Confirmed};
    uint8_t out = 0;
    TEST_ASSERT_TRUE(slot_number(a, out));
    TEST_ASSERT_EQUAL_UINT8(7, out);

    EntryState b{{'1', '2', '\0'}, EntryStatus::Confirmed};
    TEST_ASSERT_TRUE(slot_number(b, out));
    TEST_ASSERT_EQUAL_UINT8(12, out);
}

void test_slot_number_rejects_an_empty_buffer()
{
    EntryState st{{'\0', '\0', '\0'}, EntryStatus::Editing};
    uint8_t out = 42;
    TEST_ASSERT_FALSE(slot_number(st, out));
    TEST_ASSERT_EQUAL_UINT8(42, out);   // untouched on failure
}

void test_slot_number_rejects_a_non_digit()
{
    EntryState st{{'1', '#', '\0'}, EntryStatus::Confirmed};
    uint8_t out = 0;
    TEST_ASSERT_FALSE(slot_number(st, out));
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_editing_is_zero);
    RUN_TEST(test_every_status_has_a_distinct_non_empty_string);
    RUN_TEST(test_unknown_status_is_named_not_crashed);
    RUN_TEST(test_slot_number_parses_one_and_two_digits);
    RUN_TEST(test_slot_number_rejects_an_empty_buffer);
    RUN_TEST(test_slot_number_rejects_a_non_digit);
    return UNITY_END();
}
```

`shared/vmaas-entry/test/test_timeout/test_main.cpp`:

```cpp
/**
 * @file test_main.cpp
 * @brief Host tests for the inactivity timeout.
 *
 * A vending machine left with "1" on the display is a machine the next
 * customer mis-uses. The timeout is what clears it, and because now_ms is
 * injected these tests run instantly instead of waiting ten seconds.
 */
#include <unity.h>
#include "slot_entry.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

static KeyEvent press(char k, uint32_t at_ms)
{
    return KeyEvent{k, KeyEventType::Pressed, at_ms};
}

// Nothing typed means nothing to discard: the timeout must stay quiet.
void test_empty_buffer_never_times_out()
{
    SlotEntry e;
    for (uint32_t t = 0; t < 60000; t += 1000)
        TEST_ASSERT_EQUAL(EntryStatus::Editing, e.tick(t).status);
}

// A partial entry is discarded after the window, and reported once.
void test_partial_entry_times_out_and_clears()
{
    SlotEntry e;
    e.handle(press('1', 1000));
    TEST_ASSERT_EQUAL(EntryStatus::Editing, e.tick(1000 + SLOT_ENTRY_TIMEOUT_MS - 1).status);

    const EntryState out = e.tick(1000 + SLOT_ENTRY_TIMEOUT_MS);
    TEST_ASSERT_EQUAL(EntryStatus::TimedOut, out.status);
    TEST_ASSERT_EQUAL_STRING("1", out.buffer);

    // Reported once; the object is already empty.
    TEST_ASSERT_EQUAL(EntryStatus::Editing, e.tick(1000 + SLOT_ENTRY_TIMEOUT_MS + 1).status);
    TEST_ASSERT_EQUAL_STRING("", e.state().buffer);
}

// Every keypress buys another full window.
void test_each_keypress_restarts_the_window()
{
    SlotEntry e;
    e.handle(press('1', 0));
    e.handle(press('2', 9000));
    TEST_ASSERT_EQUAL(EntryStatus::Editing, e.tick(10000).status);
    TEST_ASSERT_EQUAL(EntryStatus::TimedOut, e.tick(19000).status);
}

// A zero timeout disables the feature outright.
void test_zero_timeout_disables_it()
{
    SlotEntry e(2, 0);
    e.handle(press('1', 0));
    TEST_ASSERT_EQUAL(EntryStatus::Editing, e.tick(1000000).status);
}

// Released events must not act as activity or the timeout would never fire
// while a finger rests on a key.
void test_released_events_are_ignored()
{
    SlotEntry e;
    e.handle(press('1', 0));
    e.handle(KeyEvent{'1', KeyEventType::Released, 5000});
    TEST_ASSERT_EQUAL(EntryStatus::TimedOut, e.tick(SLOT_ENTRY_TIMEOUT_MS).status);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_empty_buffer_never_times_out);
    RUN_TEST(test_partial_entry_times_out_and_clears);
    RUN_TEST(test_each_keypress_restarts_the_window);
    RUN_TEST(test_zero_timeout_disables_it);
    RUN_TEST(test_released_events_are_ignored);
    return UNITY_END();
}
```

`shared/vmaas-entry/test/test_editing/test_main.cpp`:

```cpp
/**
 * @file test_main.cpp
 * @brief Host tests for the settled parts of the entry flow.
 *
 * These cover only behaviour fixed by the spec regardless of how the three
 * OWNER DECISION rules land: digits accumulate and echo, '*' deletes, '*' on
 * an empty buffer cancels, and '#' on a non-empty buffer confirms.
 */
#include <unity.h>
#include "slot_entry.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

static KeyEvent press(char k, uint32_t at_ms = 0)
{
    return KeyEvent{k, KeyEventType::Pressed, at_ms};
}

void test_digits_accumulate_in_order()
{
    SlotEntry e;
    TEST_ASSERT_EQUAL_STRING("1", e.handle(press('1')).buffer);
    TEST_ASSERT_EQUAL_STRING("12", e.handle(press('2')).buffer);
    TEST_ASSERT_EQUAL(EntryStatus::Editing, e.state().status);
}

void test_star_deletes_the_last_digit()
{
    SlotEntry e;
    e.handle(press('1'));
    e.handle(press('2'));
    TEST_ASSERT_EQUAL_STRING("1", e.handle(press('*')).buffer);
    TEST_ASSERT_EQUAL(EntryStatus::Editing, e.state().status);
}

void test_star_on_empty_buffer_cancels()
{
    SlotEntry e;
    TEST_ASSERT_EQUAL(EntryStatus::Cancelled, e.handle(press('*')).status);
}

void test_star_back_to_empty_then_star_cancels()
{
    SlotEntry e;
    e.handle(press('9'));
    TEST_ASSERT_EQUAL(EntryStatus::Editing, e.handle(press('*')).status);
    TEST_ASSERT_EQUAL(EntryStatus::Cancelled, e.handle(press('*')).status);
}

void test_hash_confirms_and_the_result_parses()
{
    SlotEntry e;
    e.handle(press('1'));
    e.handle(press('2'));
    const EntryState out = e.handle(press('#'));
    TEST_ASSERT_EQUAL(EntryStatus::Confirmed, out.status);
    TEST_ASSERT_EQUAL_STRING("12", out.buffer);
    uint8_t slot = 0;
    TEST_ASSERT_TRUE(slot_number(out, slot));
    TEST_ASSERT_EQUAL_UINT8(12, slot);
}

// After a decision the object must be ready for the next customer.
void test_confirm_leaves_the_entry_empty()
{
    SlotEntry e;
    e.handle(press('7'));
    e.handle(press('#'));
    TEST_ASSERT_EQUAL_STRING("", e.state().buffer);
    TEST_ASSERT_EQUAL(EntryStatus::Editing, e.state().status);
}

void test_cancel_leaves_the_entry_empty()
{
    SlotEntry e;
    e.handle(press('*'));
    TEST_ASSERT_EQUAL_STRING("", e.state().buffer);
}

void test_reset_clears_a_partial_entry()
{
    SlotEntry e;
    e.handle(press('4'));
    e.reset();
    TEST_ASSERT_EQUAL_STRING("", e.state().buffer);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_digits_accumulate_in_order);
    RUN_TEST(test_star_deletes_the_last_digit);
    RUN_TEST(test_star_on_empty_buffer_cancels);
    RUN_TEST(test_star_back_to_empty_then_star_cancels);
    RUN_TEST(test_hash_confirms_and_the_result_parses);
    RUN_TEST(test_confirm_leaves_the_entry_empty);
    RUN_TEST(test_cancel_leaves_the_entry_empty);
    RUN_TEST(test_reset_clears_a_partial_entry);
    return UNITY_END();
}
```

- [ ] **Step 7: Run the tests to verify they fail**

Run from `shared/vmaas-entry`: `$PIO test -e native`
Expected: `test_entry_state` PASSES (6 tests, independent of `handle()`).
`test_editing` and `test_timeout` FAIL, because the OWNER DECISION block is
still empty so `handle()` never touches the buffer.

- [ ] **Step 8: Write test_rules once the owner has decided**

After the owner's code is in, create
`shared/vmaas-entry/test/test_rules/test_main.cpp` with one test per rule,
asserting exactly what they chose. Write the file header the same way as the
others: say why the rule exists, not what the code does. Cover:

- a third digit against a full buffer,
- `#` against an empty buffer,
- a leading zero (`0`, `7`, `#`) and what `slot_number()` returns for it.

- [ ] **Step 9: Run the whole suite**

Run from `shared/vmaas-entry`: `$PIO test -e native`
Expected: PASS, 19 tests plus however many `test_rules` holds.

- [ ] **Step 10: Write the README**

`shared/vmaas-entry/README.md`: what the library is and why it has no
hardware dependency, the status lifecycle (including that transient statuses
are reported once), the three rules as the owner settled them, a usage
snippet, and a Tests table.

- [ ] **Step 11: Verify (no commit)**

```bash
git add shared/vmaas-entry
git status --short shared/vmaas-entry
```

---

## Task 7: Bench discovery of the row/column mapping

**Files:**
- Create: `Main-Controller/src/keypad_discover_main.cpp`
- Create: `tools/keypad_discover.py`
- Modify: `Main-Controller/platformio.ini`

**Interfaces:**
- Consumes: nothing from the libraries; the discovery firmware talks to GPIO directly, because its whole job is to work before the row/column split is known.
- Produces: the real `KEYPAD_ROWS`/`KEYPAD_COLS` values used by Task 8.

- [ ] **Step 1: Add the build environments**

In `Main-Controller/platformio.ini`, add a source filter to the existing
environment and a new one. The filter is what keeps two `app_main()`
definitions from colliding.

```ini
[env:main-controller]
platform = espressif32
board = esp32dev
framework = espidf
lib_extra_dirs = ../shared
monitor_speed = 115200
upload_port = COM6
monitor_port = COM6
upload_speed = 115200
build_src_filter = +<*> -<keypad_discover_main.cpp>

[env:keypad-discover]
; Bench-only firmware that finds which header pins are rows and which are
; columns. Flash it, run tools/keypad_discover.py, then flash main-controller
; again.
platform = espressif32
board = esp32dev
framework = espidf
lib_extra_dirs = ../shared
monitor_speed = 115200
upload_port = COM6
monitor_port = COM6
upload_speed = 115200
build_src_filter = +<keypad_discover_main.cpp>
```

- [ ] **Step 2: Write the discovery firmware**

`Main-Controller/src/keypad_discover_main.cpp`:

```cpp
/**
 * @file keypad_discover_main.cpp
 * @brief Bench firmware that finds the keypad's row/column mapping.
 *
 * SparkFun changed the COM-14662 pinout between revisions, so which of the
 * seven header pins are rows and which are columns is not known from the
 * datasheet. This firmware does not need to know: it treats all seven pins
 * alike, drives each one low in turn and reads the other six. A closed switch
 * is the only thing that can pull one pin down from another, so a held key
 * reveals exactly one conducting pair.
 *
 * Output is one line per state change, read by tools/keypad_discover.py:
 *
 *     READY
 *     PAIR <low_pin> <sensed_pin>
 *     NONE
 *
 * Not part of the shipped firmware. Build with: pio run -e keypad-discover
 */
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <cstdio>
#include "driver/gpio.h"

namespace
{
    // Every pin the keypad is wired to, header pin 1 to 7, left to right.
    constexpr int PINS[] = {14, 25, 26, 27, 18, 19, 23};
    constexpr size_t PIN_COUNT = sizeof(PINS) / sizeof(PINS[0]);

    // All pins idle as pulled-up inputs so nothing is driven until we probe.
    void idle_all()
    {
        for (size_t i = 0; i < PIN_COUNT; ++i)
        {
            gpio_config_t cfg = {};
            cfg.pin_bit_mask = (1ULL << PINS[i]);
            cfg.mode = GPIO_MODE_INPUT;
            cfg.pull_up_en = GPIO_PULLUP_ENABLE;
            cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
            cfg.intr_type = GPIO_INTR_DISABLE;
            gpio_config(&cfg);
        }
    }

    // Drive one pin low, sample the rest, restore. Returns the index of the
    // single pin pulled low with it, or -1 for none/ambiguous.
    int sense_from(size_t driver)
    {
        gpio_set_direction(static_cast<gpio_num_t>(PINS[driver]), GPIO_MODE_OUTPUT);
        gpio_set_level(static_cast<gpio_num_t>(PINS[driver]), 0);
        // Let the pull-ups settle; these are 45 kOhm against stray capacitance.
        esp_rom_delay_us(50);

        int found = -1;
        int count = 0;
        for (size_t i = 0; i < PIN_COUNT; ++i)
        {
            if (i == driver)
                continue;
            if (gpio_get_level(static_cast<gpio_num_t>(PINS[i])) == 0)
            {
                found = static_cast<int>(i);
                ++count;
            }
        }

        gpio_set_direction(static_cast<gpio_num_t>(PINS[driver]), GPIO_MODE_INPUT);
        return (count == 1) ? found : -1;
    }
}

extern "C" void app_main()
{
    idle_all();
    // The tool waits for this line before prompting, so a half-booted board
    // cannot swallow the first keypress.
    printf("READY\n");
    fflush(stdout);

    int last_a = -1;
    int last_b = -1;

    while (true)
    {
        int a = -1;
        int b = -1;
        for (size_t d = 0; d < PIN_COUNT; ++d)
        {
            const int s = sense_from(d);
            if (s >= 0)
            {
                a = static_cast<int>(d);
                b = s;
                break;
            }
        }

        if (a != last_a || b != last_b)
        {
            if (a >= 0)
                printf("PAIR %d %d\n", PINS[a], PINS[b]);
            else
                printf("NONE\n");
            fflush(stdout);
            last_a = a;
            last_b = b;
        }

        vTaskDelay(pdMS_TO_TICKS(20));
    }
}
```

- [ ] **Step 3: Write the bench tool**

`tools/keypad_discover.py`:

```python
"""Find which keypad header pins are rows and which are columns.

Usage: python tools/keypad_discover.py COM6

Flash the discovery firmware first:
    pio run -e keypad-discover -t upload

The SparkFun COM-14662 pinout changed between revisions, so rather than trust
a datasheet this asks you to press all twelve keys in order and watches which
pin pair each one closes. A pin that appears in four pairs is a row; one that
appears in three is a column. Uses pyserial, which ships with PlatformIO's
penv python.
"""
import sys
import time

import serial

sys.stdout.reconfigure(errors="backslashreplace")

# Telephone layout, in the order the user is asked to press them.
KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"]
ROWS_OF = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["*", "0", "#"],
]


def read_line(ser, deadline):
    """Read one newline-terminated line, or None once deadline passes."""
    buf = bytearray()
    while time.monotonic() < deadline:
        ch = ser.read(1)
        if not ch:
            continue
        if ch == b"\n":
            return buf.decode("utf-8", "replace").strip()
        if ch != b"\r":
            buf += ch
    return None


def wait_for(ser, want, timeout=60.0):
    """Wait for a line starting with `want`; return its whitespace split."""
    deadline = time.monotonic() + timeout
    while True:
        line = read_line(ser, deadline)
        if line is None:
            return None
        if line.startswith(want):
            return line.split()


def collect(ser):
    """Prompt for each key and record the pin pair it closes."""
    pairs = {}
    for key in KEYS:
        # Insist on a clean release first, so a held key is not read twice.
        print(f"Release everything, then press and hold: {key}")
        wait_for(ser, "NONE", timeout=30.0)
        got = wait_for(ser, "PAIR", timeout=60.0)
        if got is None:
            print(f"  timed out waiting for {key}", file=sys.stderr)
            return None
        a, b = int(got[1]), int(got[2])
        pairs[key] = (a, b)
        print(f"  {key}: pins {a} and {b}")
    return pairs


def classify(pairs):
    """Split the pins into rows and columns by how often each appears."""
    counts = {}
    for a, b in pairs.values():
        counts[a] = counts.get(a, 0) + 1
        counts[b] = counts.get(b, 0) + 1

    rows = sorted(p for p, n in counts.items() if n == 4)
    cols = sorted(p for p, n in counts.items() if n == 3)

    if len(rows) != 4 or len(cols) != 3:
        print("Could not classify the pins. Counts per pin:", file=sys.stderr)
        for pin in sorted(counts):
            print(f"  GPIO{pin}: {counts[pin]} keys", file=sys.stderr)
        print(
            "Expected four pins at 4 keys (rows) and three at 3 (columns). "
            "A missing or shorted wire looks exactly like this.",
            file=sys.stderr,
        )
        return None, None
    return rows, cols


def order(pairs, rows, cols):
    """Put rows and columns in key-map order using the keys themselves."""
    ordered_rows = []
    for row_keys in ROWS_OF:
        pins = [p for p in pairs[row_keys[0]] if p in rows]
        ordered_rows.append(pins[0])

    ordered_cols = []
    for idx in range(3):
        key = ROWS_OF[0][idx]
        pins = [p for p in pairs[key] if p in cols]
        ordered_cols.append(pins[0])
    return ordered_rows, ordered_cols


def main() -> int:
    port = sys.argv[1] if len(sys.argv) > 1 else "COM6"
    with serial.Serial(port, 115200, timeout=0.2) as ser:
        ser.setDTR(False)
        ser.setRTS(True)
        time.sleep(0.1)
        ser.setRTS(False)
        if wait_for(ser, "READY", timeout=15.0) is None:
            print("No READY from the board. Is the discovery build flashed?",
                  file=sys.stderr)
            return 1

        pairs = collect(ser)
        if pairs is None:
            return 1

    if len(set(pairs.values())) != 12:
        print("Two keys reported the same pin pair. Check for a stuck key.",
              file=sys.stderr)
        return 1

    rows, cols = classify(pairs)
    if rows is None:
        return 1

    ordered_rows, ordered_cols = order(pairs, rows, cols)

    print("\nPaste into Main-Controller/src/pins.h:\n")
    print("    /// Keypad matrix rows, driven low one at a time.")
    print("    constexpr int KEYPAD_ROWS[4] = {%s};"
          % ", ".join(str(p) for p in ordered_rows))
    print("    /// Keypad matrix columns, inputs with internal pull-ups.")
    print("    constexpr int KEYPAD_COLS[3] = {%s};"
          % ", ".join(str(p) for p in ordered_cols))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Build and flash the discovery firmware**

Run from `Main-Controller`: `$PIO run -e keypad-discover -t upload`
Expected: build succeeds, upload completes. Close any serial monitor on COM6 first.

- [ ] **Step 5: Run the discovery with the owner at the keypad**

Run from the repository root: `python tools/keypad_discover.py COM6`
Expected: twelve prompts, each answered with a pin pair, then a `pins.h` block.

If the tool reports that it cannot classify the pins, the wiring is wrong, not
the tool. A pin appearing in 0 keys is unconnected; one appearing in 12 is
shorted to ground or to 3V3.

- [ ] **Step 6: Record the result**

Write the discovered mapping into the spec's section 3.2 table, replacing the
provisional split, and note the date. Do not proceed to Task 8 with a guess.

- [ ] **Step 7: Verify (no commit)**

```bash
git add tools/keypad_discover.py Main-Controller/src/keypad_discover_main.cpp Main-Controller/platformio.ini docs/superpowers/specs/2026-09-17-keypad-slot-entry-design.md
git status --short
```

---

## Task 8: Main-Controller integration

**Files:**
- Modify: `Main-Controller/src/pins.h`, `Main-Controller/src/config.h`, `Main-Controller/src/main.cpp`
- Create: `Main-Controller/src/keypad_task.h`, `Main-Controller/src/keypad_task.cpp`

**Interfaces:**
- Consumes: `vmaas::Keypad`, `vmaas::EspKeypadPort`, `vmaas::SlotEntry`, `vmaas::EntryState`, `vmaas::slot_number`, and the existing `MotorClient::request_status()` / `on_status()`.
- Produces: `keypad_task_start(vmaas::Keypad&)` and `keypad_task_next(vmaas::KeyEvent&)`.

- [ ] **Step 1: Add the pins**

In `Main-Controller/src/pins.h`, inside `namespace Pins`, append (using the
values Task 7 discovered, not the provisional ones):

```cpp
    /// Keypad matrix rows, driven low one at a time.
    constexpr int KEYPAD_ROWS[4] = {14, 25, 26, 27};
    /// Keypad matrix columns, inputs with internal pull-ups.
    constexpr int KEYPAD_COLS[3] = {18, 19, 23};
```

- [ ] **Step 2: Add the settings**

In `Main-Controller/src/config.h`, inside `namespace Config`, append:

```cpp
    /// Gap between keypad scans in milliseconds. Must be well under the debounce window.
    constexpr uint32_t keypad_scan_interval_ms = 5;

    /// How long a raw key state must hold before it is believed, in milliseconds.
    constexpr uint32_t keypad_debounce_ms = 20;

    /// Inactivity before a partial slot entry is discarded, in milliseconds.
    constexpr uint32_t slot_entry_timeout_ms = 10000;

    /// How long a result line ("Slot 12 valgt", "Annulleret") stays on screen
    /// before the prompt returns, in milliseconds. Without this the next loop
    /// iteration would overwrite the result within 50 ms.
    constexpr uint32_t slot_entry_result_hold_ms = 2000;

    /// Depth of the queue between the keypad task and the main loop.
    constexpr int keypad_queue_depth = 16;

    /// Stack for the keypad scan task in bytes. It only touches GPIO and a ring buffer.
    constexpr int keypad_task_stack = 2560;

    /// Priority of the keypad scan task. Above the idle work, below the UART.
    constexpr int keypad_task_priority = 5;
```

- [ ] **Step 3: Write the scan task**

`Main-Controller/src/keypad_task.h`:

```cpp
#pragma once
/**
 * @file keypad_task.h
 * @brief Runs the keypad scan on its own task and hands events to the main loop.
 *
 * The main loop blocks up to 50 ms inside bus.poll(), which is long enough to
 * miss a fast tap and to make debounce timing coarse. Scanning therefore lives
 * on its own task at a steady 5 ms, and the two sides meet at a queue.
 */
#include "key_event.h"
#include "keypad.h"

/**
 * @brief Start the scan task.
 * @param keypad Driver to scan with. Must already be begun and must outlive the task.
 * @return false if the queue or the task could not be created.
 */
bool keypad_task_start(vmaas::Keypad& keypad);

/**
 * @brief Take one event from the queue without blocking.
 * @param out Filled in when an event was waiting.
 * @return false when the queue is empty.
 */
bool keypad_task_next(vmaas::KeyEvent& out);
```

`Main-Controller/src/keypad_task.cpp`:

```cpp
/**
 * @file keypad_task.cpp
 * @brief Scan task and the queue between it and the main loop.
 */
#include "keypad_task.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "esp_log.h"
#include "config.h"

namespace
{
    constexpr const char* TAG = "KeypadTask";

    QueueHandle_t queue = nullptr;
    vmaas::Keypad* driver = nullptr;

    uint32_t now_ms()
    {
        return static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS);
    }

    void keypad_task(void*)
    {
        // vTaskDelayUntil rather than vTaskDelay: the scan period stays even
        // when a pass takes longer than usual, which keeps debounce honest.
        TickType_t last_wake = xTaskGetTickCount();
        const TickType_t period = pdMS_TO_TICKS(Config::keypad_scan_interval_ms);

        while (true)
        {
            driver->tick(now_ms());

            vmaas::KeyEvent ev{};
            while (driver->next_event(ev))
            {
                if (xQueueSend(queue, &ev, 0) != pdTRUE)
                    ESP_LOGW(TAG, "queue full, dropped key '%c'", ev.key);
            }

            vTaskDelayUntil(&last_wake, period);
        }
    }
}

bool keypad_task_start(vmaas::Keypad& keypad)
{
    driver = &keypad;
    queue = xQueueCreate(Config::keypad_queue_depth, sizeof(vmaas::KeyEvent));
    if (queue == nullptr)
    {
        ESP_LOGE(TAG, "could not create the key queue");
        return false;
    }

    const BaseType_t ok = xTaskCreate(keypad_task, "keypad",
                                      Config::keypad_task_stack, nullptr,
                                      Config::keypad_task_priority, nullptr);
    if (ok != pdPASS)
    {
        ESP_LOGE(TAG, "could not start the keypad task");
        vQueueDelete(queue);
        queue = nullptr;
        return false;
    }
    return true;
}

bool keypad_task_next(vmaas::KeyEvent& out)
{
    if (queue == nullptr)
        return false;
    return xQueueReceive(queue, &out, 0) == pdTRUE;
}
```

- [ ] **Step 4: Rewrite main.cpp**

`Main-Controller/src/main.cpp`:

```cpp
// Main-Controller: slot entry on the keypad, shown on the Grove-LCD.
// A dedicated task scans the COM-14662 matrix every 5 ms; the main loop drains
// its queue, feeds SlotEntry and redraws only when the entry state changes.
// A STATUS frame every 2 seconds keeps the link to Motorcontrol observed: when
// it reports no valid slot configuration the display switches to a red
// "MOTOR CONFIG ERR" screen until a normal reply arrives again.
// See shared/vmaas-keypad/README.md, shared/vmaas-entry/README.md,
// shared/vmaas-protocol/PROTOCOL.md and shared/vmaas-display/README.md.
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include <cstdio>
#include <cstring>
#include "pins.h"
#include "config.h"
#include "motor_client.h"
#include "uart_bus.h"
#include "esp_i2c_port.h"
#include "grove_lcd_rgb.h"
#include "esp_keypad_port.h"
#include "keypad.h"
#include "keypad_task.h"
#include "slot_entry.h"

namespace
{
    constexpr const char* TAG = "MainController";
    constexpr TickType_t STATUS_INTERVAL = pdMS_TO_TICKS(2000);

    constexpr const char* PROMPT_ROW0 = "VMaaS - vaelg slot";
    constexpr const char* ERROR_ROW0 = "MOTOR CONFIG ERR";
    constexpr const char* ERROR_ROW1 = "check slot config on Motorcontrol";

    vmaas::UartBus bus(UART_NUM_1, Pins::UART_TX, Pins::UART_RX, Config::baud_rate);
    MotorClient motor(bus);

    vmaas::EspI2cPort i2c(I2C_NUM_0, Pins::I2C_SDA, Pins::I2C_SCL, Config::i2c_clock_hz);
    vmaas::GroveLcdRgb lcd(i2c);

    vmaas::EspKeypadPort keypad_port;
    vmaas::Keypad keypad(keypad_port, Config::keypad_debounce_ms);
    vmaas::SlotEntry entry(vmaas::SLOT_ENTRY_MAX_DIGITS, Config::slot_entry_timeout_ms);

    bool display_ok = false;
    bool backlight_ok = false;
    bool motor_error_shown = false;
    char last_row1[17] = {};
    uint32_t result_hold_until_ms = 0;   // see render()

    uint32_t now_ms()
    {
        return static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS);
    }

    void log_lcd(const char* what, vmaas::LcdError err)
    {
        if (err != vmaas::LcdError::None)
            ESP_LOGW(TAG, "display %s: %s", what, vmaas::to_string(err));
    }

    void show_rows(const char* row0, const char* row1)
    {
        if (!display_ok)
            return;
        log_lcd("clear", lcd.clear());
        log_lcd("row 0", lcd.print_at(0, 0, row0));
        log_lcd("row 1", lcd.print_at(0, 1, row1, vmaas::Overflow::Scroll));
    }

    // Row 1 only, so the prompt on row 0 does not flicker on every digit.
    void show_row1(const char* text)
    {
        if (!display_ok)
            return;
        if (std::strncmp(text, last_row1, sizeof(last_row1)) == 0)
            return;
        std::snprintf(last_row1, sizeof(last_row1), "%s", text);
        log_lcd("clear row 1", lcd.clear_row(1));
        log_lcd("row 1", lcd.print_at(0, 1, text));
    }

    void show_prompt()
    {
        last_row1[0] = '\0';
        show_rows(PROMPT_ROW0, "");
        show_row1("> _");
    }

    void show_motor_error()
    {
        if (motor_error_shown)
            return;
        motor_error_shown = true;
        ESP_LOGE(TAG, "Motorcontrol has no valid slot configuration, showing error screen");
        show_rows(ERROR_ROW0, ERROR_ROW1);
        if (backlight_ok)
            log_lcd("set_rgb", lcd.set_rgb(255, 0, 0));
    }

    void clear_motor_error()
    {
        if (!motor_error_shown)
            return;
        motor_error_shown = false;
        ESP_LOGI(TAG, "Motorcontrol back to normal, restoring display");
        if (backlight_ok)
            log_lcd("set_rgb", lcd.set_rgb(255, 255, 255));
        show_prompt();
    }

    // One place that turns an EntryState into what the screen says.
    //
    // A result line has to survive being immediately contradicted: SlotEntry
    // resets itself the moment it reports Confirmed, so the very next loop
    // iteration hands render() an empty Editing state roughly 50 ms later.
    // Without the hold below, "Slot 12 valgt" would be overwritten by "> _"
    // long before anyone could read it. Typing during the hold cancels it,
    // so a waiting customer is never made to sit through it.
    void render(const vmaas::EntryState& st)
    {
        if (motor_error_shown)
            return;   // the error screen owns the display until it clears

        char line[17];
        switch (st.status)
        {
        case vmaas::EntryStatus::Confirmed:
        {
            uint8_t slot = 0;
            if (vmaas::slot_number(st, slot))
            {
                std::snprintf(line, sizeof(line), "Slot %u valgt", (unsigned)slot);
                ESP_LOGI(TAG, "slot %u selected", (unsigned)slot);
            }
            else
            {
                std::snprintf(line, sizeof(line), "Ugyldigt slot");
            }
            show_row1(line);
            result_hold_until_ms = now_ms() + Config::slot_entry_result_hold_ms;
            break;
        }
        case vmaas::EntryStatus::Cancelled:
            show_row1("Annulleret");
            result_hold_until_ms = now_ms() + Config::slot_entry_result_hold_ms;
            break;
        case vmaas::EntryStatus::TimedOut:
            ESP_LOGI(TAG, "entry timed out, clearing");
            result_hold_until_ms = 0;
            show_row1("> _");
            break;
        case vmaas::EntryStatus::Editing:
            // An empty buffer during the hold is the reset that follows a
            // result, not something the user did. A non-empty one means they
            // started typing again, which ends the hold at once.
            if (st.buffer[0] == '\0' && now_ms() < result_hold_until_ms)
                return;
            result_hold_until_ms = 0;
            std::snprintf(line, sizeof(line), "> %s_", st.buffer);
            show_row1(line);
            break;
        }
    }
}

extern "C" void app_main()
{
    bus.begin();
    motor.begin();

    i2c.begin();
    const vmaas::LcdError lcd_err = lcd.begin();
    display_ok = lcd.ready();
    backlight_ok = (lcd_err == vmaas::LcdError::None);
    if (!display_ok)
        ESP_LOGE(TAG, "display init failed: %s, continuing without display",
                 vmaas::to_string(lcd_err));
    else if (!backlight_ok)
        ESP_LOGW(TAG, "display: backlight unavailable (%s), text only",
                 vmaas::to_string(lcd_err));

    const vmaas::KeypadError kp_err =
        keypad.begin(Pins::KEYPAD_ROWS, 4, Pins::KEYPAD_COLS, 3);
    if (kp_err != vmaas::KeypadError::None)
        ESP_LOGE(TAG, "keypad init failed: %s, continuing without keypad",
                 vmaas::to_string(kp_err));
    else if (!keypad_task_start(keypad))
        ESP_LOGE(TAG, "keypad scan task did not start, continuing without keypad");

    show_prompt();

    motor.on_ack([](vmaas::Cmd cmd) {
        ESP_LOGI(TAG, "ACK for cmd 0x%02X", (unsigned)cmd);
        clear_motor_error();
    });
    motor.on_nak([](vmaas::Cmd cmd, vmaas::ErrorCode err) {
        ESP_LOGW(TAG, "NAK for cmd 0x%02X, error %u", (unsigned)cmd, (unsigned)err);
        if (err == vmaas::ErrorCode::CONFIG_ERROR)
            show_motor_error();
    });
    motor.on_done([](uint8_t slot) {
        ESP_LOGI(TAG, "slot %u dispensed", slot);
    });
    motor.on_status([](vmaas::State state, uint8_t slot) {
        ESP_LOGI(TAG, "status: state=%u current_slot=%u", (unsigned)state, slot);
        if (state == vmaas::State::ERROR)
            show_motor_error();
        else
            clear_motor_error();
    });

    TickType_t last_status = xTaskGetTickCount();
    while (true)
    {
        bus.poll(pdMS_TO_TICKS(50));

        // Drain whatever the scan task queued while poll() was blocked.
        vmaas::KeyEvent ev{};
        while (keypad_task_next(ev))
            render(entry.handle(ev));

        render(entry.tick(now_ms()));

        if (display_ok)
            lcd.tick(now_ms());

        const TickType_t now = xTaskGetTickCount();
        if (static_cast<TickType_t>(now - last_status) >= STATUS_INTERVAL)
        {
            last_status = now;
            if (bus.dropped_frames() > 0)
                ESP_LOGW(TAG, "dropped frames so far: %lu", (unsigned long)bus.dropped_frames());
            if (keypad.dropped_events() > 0)
                ESP_LOGW(TAG, "dropped key events so far: %lu",
                         (unsigned long)keypad.dropped_events());
            // STATUS, not RUN: it starts no motor, and unlike RUN/STOP/CONFIG
            // it is answered rather than refused when the slot config is bad,
            // which is what keeps the error screen reachable.
            motor.request_status();
        }
    }
}
```

- [ ] **Step 5: Build the firmware**

Run from `Main-Controller`: `$PIO run -e main-controller`
Expected: build succeeds with no warnings from the new files. Note the flash and RAM percentages in the report.

- [ ] **Step 6: Confirm the host suites still pass**

Run from `shared/vmaas-keypad`: `$PIO test -e native`
Run from `shared/vmaas-entry`: `$PIO test -e native`
Expected: both PASS. Integration must not have required a library change; if it did, say which and why.

- [ ] **Step 7: Verify (no commit)**

```bash
git add Main-Controller shared
git status --short
```

---

## Task 9: Hardware verification on COM6

**Files:**
- Modify: `docs/superpowers/specs/2026-09-17-keypad-slot-entry-design.md` (status line and any deviations)

**Interfaces:**
- Consumes: everything above.
- Produces: a verified bench result, or a defect report.

- [ ] **Step 1: Flash**

Run from `Main-Controller`: `$PIO run -e main-controller -t upload`
Close any serial monitor on COM6 first.

- [ ] **Step 2: Capture the boot log**

Run from the repository root: `python tools/capture_serial.py COM6 8`
Expected: no `keypad init failed`, no `keypad scan task did not start`. If the
LCD is unwired, `display init failed` is acceptable and the rest of this task
runs on the log alone.

- [ ] **Step 3: Type 1, 2, #**

Watch the LCD and the log.
Expected on the display: `> 1_`, then `> 12_`, then `Slot 12 valgt`.
Expected in the log: `slot 12 selected`.

- [ ] **Step 4: Check backspace and cancel**

Press `7`, then `*`. Expected: `> 7_` then `> _`.
Press `*` once more on the empty buffer. Expected: `Annulleret`.

- [ ] **Step 4b: Check that a result stays readable**

After the `Slot 12 valgt` from step 3, time how long it stays up.
Expected: roughly 2 seconds, then row 1 returns to `> _`. Then repeat and
press a digit during those 2 seconds: the result must give way to `> 5_`
immediately rather than making the user wait out the hold.

- [ ] **Step 5: Check the timeout**

Press `4` and wait 10 seconds without touching anything.
Expected: row 1 returns to `> _` and the log shows `entry timed out, clearing`.

- [ ] **Step 6: Check debounce honestly**

Press each of the twelve keys once, deliberately and quickly.
Expected: exactly twelve digits entered across the run, no doubles. A repeated
digit means `keypad_debounce_ms` is too low for this unit; raise it to 30 and
re-flash rather than adding a delay anywhere.

- [ ] **Step 7: Check that a blocked main loop does not lose keys**

Press keys steadily for 10 seconds.
Expected: no `dropped key events so far` warning, and every press appears.
This is the behaviour the dedicated task exists for.

- [ ] **Step 8: Record the result**

Update the spec's status line to `Implemented 2026-09-17` with the test count
and the hardware result, and add a section 11 listing any deviations, the way
the display spec does.

- [ ] **Step 9: Verify (no commit)**

```bash
git add -A
git status --short
```

Report the full result to the owner: test counts per library, firmware flash
and RAM percentages, and what the bench showed for each step above. The owner
commits.
