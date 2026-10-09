# Grove-LCD RGB Display Driver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Main-Controller a host-tested, reusable driver for the Grove-LCD RGB Backlight v4.0 (16x2 LCD + RGB backlight over I2C) and prove it with a smoke test on the WROVER board.

**Architecture:** A new shared PlatformIO library `shared/vmaas-display` holds a pure C++17 driver (`GroveLcdRgb`) that talks to the display through a two-method interface (`LcdPort`: `write` + `delay_ms`). The driver is unit-tested on the PC with a `FakePort` that records every I2C write and delay. One ESP-IDF implementation (`EspI2cPort`) plugs it into the board. Main-Controller's `main.cpp` gets the display next to the existing UART smoke test.

**Tech Stack:** ESP-IDF 6.1 via PlatformIO (`framework = espidf`, `board = esp32dev`), new `driver/i2c_master.h` API, C++17, Unity test framework on PlatformIO `native`.

**Spec:** `docs/superpowers/specs/2026-09-16-grove-lcd-rgb-display-design.md`

## Global Constraints

- I2C: SDA=GPIO21, SCL=GPIO22, 100 kHz, internal pull-ups on. Display powered from 5 V.
- Addresses: LCD controller `0x3E`; RGB chip `0x62` (PCA9633, v4.0) or `0x30` (SGM31323, v5.0), probed at `begin()`, v5.0 first.
- LCD transfers: command = `{0x80, cmd}`, data = `{0x40, byte...}`. Row 0 DDRAM address `0x80|col`, row 1 `0xC0|col`.
- Init sequence: delay 50 ms, `0x28`, delay 5 ms, `0x28`, delay 1 ms, `0x0C`, `0x01`, delay 2 ms, `0x06`.
- Display is fixed 16x2. Scroll buffer 64 chars + 3 spaces padding. Default scroll interval 300 ms.
- Library code (`grove_lcd_rgb.*`, `lcd_port.h`, `lcd_error.h`) must not include any ESP-IDF or FreeRTOS header. Only `esp_i2c_port.*` may, guarded by `#ifdef ESP_PLATFORM`.
- The library never logs. Every fallible method returns `vmaas::LcdError`; `None` is success.
- C++ exceptions and RTTI are disabled on the boards. No `throw`, `dynamic_cast`, `typeid`, no `std::string`/`std::vector` in library code (tests may use them).
- Code, comments and docs in English. Doxygen comments on all public headers, same style as `shared/vmaas-protocol`.
- **Do not commit.** The repository owner forbids `git commit` from this tool (see `.claude/settings.json`). Every task ends with a verification step instead of a commit step. The owner commits.
- All work on branch `dev`.

## Toolchain notes (Windows host)

`pio` is not on the tool shell's PATH. Use the full path. The host compiler (WinLibs GCC) is on the user PATH but Git Bash in this tool may need the prefix.

Git Bash:

```bash
export PATH="/c/Users/temp/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
PIO=/c/Users/temp/.platformio/penv/Scripts/pio.exe
```

PowerShell:

```powershell
$PIO = "C:\Users\temp\.platformio\penv\Scripts\pio.exe"
```

Host tests: run from `shared/vmaas-display`: `$PIO test -e native` (all) or `$PIO test -e native -f test_print` (one folder).
Firmware build: run from `Main-Controller`: `$PIO run -e main-controller`.
Upload: `$PIO run -e main-controller -t upload` (close any serial monitor on COM6 first; a held port makes the upload fail).
Monitor: `$PIO device monitor -p COM6 -b 115200`.

## Learning checkpoints

One spot carries a design decision the project owner may want to make. It is marked **OWNER DECISION** in Task 5. The executor implements the default given and flags it:

- Task 5, `GroveLcdRgb::tick()`: step timing. Default `last_step_ms = now_ms` (simple, drifts slightly under load). Alternative `last_step_ms += interval` (drift-free, but catches up in bursts after a stall).

---

## File Structure

```
shared/vmaas-display/
  library.json                        PlatformIO library manifest
  platformio.ini                      [env:native] host tests
  .gitignore                          .pio
  README.md                           wiring, addresses, command reference, usage
  src/lcd_error.h                     LcdError enum + to_string() declaration
  src/lcd_error.cpp                   to_string() implementation
  src/lcd_port.h                      LcdPort interface (write, delay_ms)
  src/grove_lcd_rgb.h                 GroveLcdRgb class, Overflow enum
  src/grove_lcd_rgb.cpp               driver implementation
  src/esp_i2c_port.h                  EspI2cPort (ESP_PLATFORM only)
  src/esp_i2c_port.cpp
  test/fake_port.h                    FakePort shared by all test folders
  test/test_lcd_error/test_main.cpp
  test/test_begin/test_main.cpp       init sequence, RGB detection, NotInitialized
  test/test_cursor_rgb/test_main.cpp  set_cursor, clear, clear_row, display, set_rgb
  test/test_print/test_main.cpp       Truncate, Wrap, print_at, I2cWrite mid-print
  test/test_scroll/test_main.cpp      Scroll, tick, stop_scroll, protection rules

Main-Controller/
  src/pins.h                          + I2C_SDA, I2C_SCL
  src/config.h                        + i2c_clock_hz
  src/main.cpp                        + display smoke test

Doxyfile                              + shared/vmaas-display/src in INPUT
```

Responsibilities: `grove_lcd_rgb.*` knows the display's command set and all text/scroll logic, nothing about I2C hardware. `lcd_port.h` is the seam. `esp_i2c_port.*` knows ESP-IDF and nothing about the display. Tests only ever see `FakePort`.

---

### Task 1: Library scaffold and LcdError

**Files:**
- Create: `shared/vmaas-display/library.json`
- Create: `shared/vmaas-display/platformio.ini`
- Create: `shared/vmaas-display/.gitignore`
- Create: `shared/vmaas-display/src/lcd_error.h`
- Create: `shared/vmaas-display/src/lcd_error.cpp`
- Test: `shared/vmaas-display/test/test_lcd_error/test_main.cpp`

**Interfaces:**
- Produces: `enum class vmaas::LcdError : uint8_t { None, NotInitialized, InvalidArgument, RowScrolling, I2cWrite, RgbChipNotFound }` and `const char* vmaas::to_string(LcdError)`.

- [ ] **Step 1: Create the library manifest, test environment and gitignore**

`shared/vmaas-display/library.json`:

```json
{
  "name": "vmaas-display",
  "version": "0.1.0",
  "description": "Grove-LCD RGB Backlight (16x2 I2C LCD + RGB backlight) driver for VMaaS Main-Controller",
  "keywords": ["lcd", "i2c", "grove", "vmaas"],
  "frameworks": "*",
  "platforms": "*",
  "headers": ["grove_lcd_rgb.h", "lcd_port.h", "lcd_error.h", "esp_i2c_port.h"]
}
```

`shared/vmaas-display/platformio.ini`:

```ini
; Host-side unit tests for the shared display library.
; Run from this directory: pio test -e native
[env:native]
platform = native
test_framework = unity
test_build_src = yes
build_flags = -std=c++17 -Wall -Wextra
```

`shared/vmaas-display/.gitignore`:

```
.pio
```

- [ ] **Step 2: Write the failing test**

`shared/vmaas-display/test/test_lcd_error/test_main.cpp`:

```cpp
#include <unity.h>
#include <cstring>
#include "lcd_error.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

void test_none_is_zero()
{
    TEST_ASSERT_EQUAL_UINT8(0, static_cast<uint8_t>(LcdError::None));
}

void test_every_enumerator_has_a_distinct_non_empty_string()
{
    const LcdError all[] = {
        LcdError::None, LcdError::NotInitialized, LcdError::InvalidArgument,
        LcdError::RowScrolling, LcdError::I2cWrite, LcdError::RgbChipNotFound,
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

void test_unknown_value_maps_to_unknown()
{
    TEST_ASSERT_EQUAL_STRING("Unknown", to_string(static_cast<LcdError>(0xFF)));
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_none_is_zero);
    RUN_TEST(test_every_enumerator_has_a_distinct_non_empty_string);
    RUN_TEST(test_unknown_value_maps_to_unknown);
    return UNITY_END();
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run from `shared/vmaas-display`: `$PIO test -e native -f test_lcd_error`
Expected: compile error, `lcd_error.h: No such file or directory`.

- [ ] **Step 4: Write the header and implementation**

`shared/vmaas-display/src/lcd_error.h`:

```cpp
#pragma once
/**
 * @file lcd_error.h
 * @brief Result codes returned by the vmaas-display driver.
 *
 * The library never logs. Every fallible call returns one of these and the
 * caller decides what to do; to_string() gives a log-friendly name.
 */
#include <cstdint>

namespace vmaas
{
    /// Result of a GroveLcdRgb call. None means success.
    enum class LcdError : uint8_t
    {
        None = 0,        ///< Success.
        NotInitialized,  ///< begin() has not been called, or it failed on the LCD part.
        InvalidArgument, ///< col/row outside 16x2, nullptr text, or text too long for the scroll buffer.
        RowScrolling,    ///< print() with Truncate/Wrap targeted a row that is scrolling.
        I2cWrite,        ///< The port reported a failed write (NAK, timeout, display unplugged).
        RgbChipNotFound, ///< Neither 0x62 (v4.0) nor 0x30 (v5.0) answered during begin().
    };

    /**
     * @brief Human-readable name of an error code.
     * @param e Code to name.
     * @return Static string such as "I2cWrite"; "Unknown" for values outside the enum.
     */
    const char* to_string(LcdError e);
}
```

`shared/vmaas-display/src/lcd_error.cpp`:

```cpp
/**
 * @file lcd_error.cpp
 * @brief Names for LcdError values. See lcd_error.h.
 */
#include "lcd_error.h"

namespace vmaas
{
    const char* to_string(LcdError e)
    {
        switch (e)
        {
        case LcdError::None:            return "None";
        case LcdError::NotInitialized:  return "NotInitialized";
        case LcdError::InvalidArgument: return "InvalidArgument";
        case LcdError::RowScrolling:    return "RowScrolling";
        case LcdError::I2cWrite:        return "I2cWrite";
        case LcdError::RgbChipNotFound: return "RgbChipNotFound";
        }
        return "Unknown";
    }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `$PIO test -e native -f test_lcd_error`
Expected: `3 Tests 0 Failures 0 Ignored`, PASSED.

- [ ] **Step 6: Verify (no commit)**

Run `git status` and confirm only `shared/vmaas-display/` files are new. Tell the owner Task 1 is ready to commit.

---

### Task 2: LcdPort, FakePort and `begin()`

**Files:**
- Create: `shared/vmaas-display/src/lcd_port.h`
- Create: `shared/vmaas-display/src/grove_lcd_rgb.h`
- Create: `shared/vmaas-display/src/grove_lcd_rgb.cpp`
- Create: `shared/vmaas-display/test/fake_port.h`
- Test: `shared/vmaas-display/test/test_begin/test_main.cpp`

**Interfaces:**
- Consumes: `vmaas::LcdError`, `vmaas::to_string` from Task 1.
- Produces: `class vmaas::LcdPort { virtual bool write(uint8_t addr, const uint8_t* data, size_t len) = 0; virtual void delay_ms(uint32_t ms) = 0; }`. `class vmaas::GroveLcdRgb` with `explicit GroveLcdRgb(LcdPort&)`, `LcdError begin()`, `LcdError set_rgb(uint8_t, uint8_t, uint8_t)`, `enum class vmaas::Overflow { Truncate, Wrap, Scroll }`. The full class declaration is written in this task; later tasks fill in method bodies. Test helper `FakePort` with `events`, `writes_to(addr)`, `fail_next(n)`, `nak(addr)`.

- [ ] **Step 1: Write the LcdPort interface**

`shared/vmaas-display/src/lcd_port.h`:

```cpp
#pragma once
/**
 * @file lcd_port.h
 * @brief Hardware seam between GroveLcdRgb and the I2C bus.
 *
 * The driver never touches I2C directly. It writes through this interface,
 * which also provides the blocking delays the LCD init sequence needs.
 * EspI2cPort implements it on ESP-IDF; tests use a recording fake.
 */
#include <cstddef>
#include <cstdint>

namespace vmaas
{
    /// Minimal I2C master + delay abstraction used by GroveLcdRgb.
    class LcdPort
    {
    public:
        virtual ~LcdPort() = default;

        /**
         * @brief Write bytes to one I2C device.
         * @param addr 7-bit device address.
         * @param data Bytes to send after the address byte.
         * @param len Number of bytes in @p data.
         * @return false if the device did not acknowledge or the transfer timed out.
         */
        virtual bool write(uint8_t addr, const uint8_t* data, size_t len) = 0;

        /**
         * @brief Block the caller for @p ms milliseconds.
         * @param ms Delay length. Implementations may round up to their tick.
         */
        virtual void delay_ms(uint32_t ms) = 0;
    };
}
```

- [ ] **Step 2: Write the FakePort test helper**

`shared/vmaas-display/test/fake_port.h`:

```cpp
#pragma once
// Recording LcdPort for host tests. Included from each test folder as "../fake_port.h".
#include <cstdint>
#include <set>
#include <vector>
#include "lcd_port.h"

struct Event
{
    enum Kind { Write, Delay } kind;
    uint8_t addr;               // valid for Write
    std::vector<uint8_t> bytes; // valid for Write
    uint32_t ms;                // valid for Delay
};

class FakePort : public vmaas::LcdPort
{
public:
    std::vector<Event> events;
    std::set<uint8_t> nak_addrs;   // addresses that never ACK
    int fail_next_count = 0;       // fail this many upcoming writes, then succeed

    bool write(uint8_t addr, const uint8_t* data, size_t len) override
    {
        if (nak_addrs.count(addr) != 0)
            return false;
        if (fail_next_count > 0)
        {
            --fail_next_count;
            return false;
        }
        events.push_back(Event{Event::Write, addr, std::vector<uint8_t>(data, data + len), 0});
        return true;
    }

    void delay_ms(uint32_t ms) override
    {
        events.push_back(Event{Event::Delay, 0, {}, ms});
    }

    void nak(uint8_t addr) { nak_addrs.insert(addr); }
    void fail_next(int n) { fail_next_count = n; }
    void clear() { events.clear(); }

    // All writes to one address, in order.
    std::vector<std::vector<uint8_t>> writes_to(uint8_t addr) const
    {
        std::vector<std::vector<uint8_t>> out;
        for (const Event& e : events)
            if (e.kind == Event::Write && e.addr == addr)
                out.push_back(e.bytes);
        return out;
    }

    size_t write_count() const
    {
        size_t n = 0;
        for (const Event& e : events)
            if (e.kind == Event::Write) ++n;
        return n;
    }
};

// Convenience for asserting one write.
inline bool bytes_equal(const std::vector<uint8_t>& v, std::initializer_list<uint8_t> expected)
{
    return v == std::vector<uint8_t>(expected);
}
```

- [ ] **Step 3: Write the failing tests for begin()**

`shared/vmaas-display/test/test_begin/test_main.cpp`:

```cpp
#include <unity.h>
#include "../fake_port.h"
#include "grove_lcd_rgb.h"

using namespace vmaas;

namespace
{
    constexpr uint8_t LCD = 0x3E;
    constexpr uint8_t RGB_V4 = 0x62;
    constexpr uint8_t RGB_V5 = 0x30;
}

void setUp() {}
void tearDown() {}

void test_init_sequence_bytes_and_delays_in_order()
{
    FakePort port;
    port.nak(RGB_V5); // plain v4.0 module
    GroveLcdRgb lcd(port);
    TEST_ASSERT_EQUAL(LcdError::None, lcd.begin());

    // Expected event stream on the LCD side (RGB events come after).
    const Event& e0 = port.events[0];
    TEST_ASSERT_EQUAL(Event::Delay, e0.kind); TEST_ASSERT_EQUAL_UINT32(50, e0.ms);
    TEST_ASSERT_TRUE(bytes_equal(port.events[1].bytes, {0x80, 0x28}));
    TEST_ASSERT_EQUAL(Event::Delay, port.events[2].kind); TEST_ASSERT_EQUAL_UINT32(5, port.events[2].ms);
    TEST_ASSERT_TRUE(bytes_equal(port.events[3].bytes, {0x80, 0x28}));
    TEST_ASSERT_EQUAL(Event::Delay, port.events[4].kind); TEST_ASSERT_EQUAL_UINT32(1, port.events[4].ms);
    TEST_ASSERT_TRUE(bytes_equal(port.events[5].bytes, {0x80, 0x0C}));
    TEST_ASSERT_TRUE(bytes_equal(port.events[6].bytes, {0x80, 0x01}));
    TEST_ASSERT_EQUAL(Event::Delay, port.events[7].kind); TEST_ASSERT_EQUAL_UINT32(2, port.events[7].ms);
    TEST_ASSERT_TRUE(bytes_equal(port.events[8].bytes, {0x80, 0x06}));
    for (int i = 1; i <= 8; ++i)
        if (port.events[i].kind == Event::Write)
            TEST_ASSERT_EQUAL_HEX8(LCD, port.events[i].addr);
}

void test_v4_rgb_init_and_white_after_v5_probe_fails()
{
    FakePort port;
    port.nak(RGB_V5);
    GroveLcdRgb lcd(port);
    TEST_ASSERT_EQUAL(LcdError::None, lcd.begin());

    TEST_ASSERT_EQUAL(0, port.writes_to(RGB_V5).size()); // NAKed writes are not recorded
    auto w = port.writes_to(RGB_V4);
    TEST_ASSERT_EQUAL(6, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x00, 0x00})); // MODE1
    TEST_ASSERT_TRUE(bytes_equal(w[1], {0x08, 0xFF})); // LEDOUT
    TEST_ASSERT_TRUE(bytes_equal(w[2], {0x01, 0x20})); // MODE2
    TEST_ASSERT_TRUE(bytes_equal(w[3], {0x04, 0xFF})); // red
    TEST_ASSERT_TRUE(bytes_equal(w[4], {0x03, 0xFF})); // green
    TEST_ASSERT_TRUE(bytes_equal(w[5], {0x02, 0xFF})); // blue
}

void test_v5_rgb_detected_first()
{
    FakePort port; // both addresses ACK; v5 must win
    GroveLcdRgb lcd(port);
    TEST_ASSERT_EQUAL(LcdError::None, lcd.begin());

    TEST_ASSERT_EQUAL(0, port.writes_to(RGB_V4).size());
    auto w = port.writes_to(RGB_V5);
    TEST_ASSERT_EQUAL(5, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x00, 0x07}));
    TEST_ASSERT_TRUE(bytes_equal(w[1], {0x04, 0x15}));
    TEST_ASSERT_TRUE(bytes_equal(w[2], {0x06, 0xFF})); // red
    TEST_ASSERT_TRUE(bytes_equal(w[3], {0x07, 0xFF})); // green
    TEST_ASSERT_TRUE(bytes_equal(w[4], {0x08, 0xFF})); // blue
}

void test_no_rgb_chip_reports_error_but_lcd_is_usable()
{
    FakePort port;
    port.nak(RGB_V5);
    port.nak(RGB_V4);
    GroveLcdRgb lcd(port);
    TEST_ASSERT_EQUAL(LcdError::RgbChipNotFound, lcd.begin());
    TEST_ASSERT_EQUAL(LcdError::RgbChipNotFound, lcd.set_rgb(1, 2, 3));

    port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, lcd.set_cursor(0, 0));
    TEST_ASSERT_EQUAL(1, port.write_count());
}

void test_lcd_write_failure_leaves_driver_uninitialised()
{
    FakePort port;
    port.nak(LCD);
    GroveLcdRgb lcd(port);
    TEST_ASSERT_EQUAL(LcdError::I2cWrite, lcd.begin());
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.set_cursor(0, 0));
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.set_rgb(1, 2, 3));
}

void test_methods_before_begin_return_not_initialized()
{
    FakePort port;
    GroveLcdRgb lcd(port);
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.clear());
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.clear_row(0));
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.set_cursor(0, 0));
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.print("x"));
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.print_at(0, 0, "x"));
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.stop_scroll(0));
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.set_rgb(0, 0, 0));
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.display(true));
    lcd.tick(1000); // must not write
    TEST_ASSERT_EQUAL(0, port.write_count());
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_init_sequence_bytes_and_delays_in_order);
    RUN_TEST(test_v4_rgb_init_and_white_after_v5_probe_fails);
    RUN_TEST(test_v5_rgb_detected_first);
    RUN_TEST(test_no_rgb_chip_reports_error_but_lcd_is_usable);
    RUN_TEST(test_lcd_write_failure_leaves_driver_uninitialised);
    RUN_TEST(test_methods_before_begin_return_not_initialized);
    return UNITY_END();
}
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `$PIO test -e native -f test_begin`
Expected: compile error, `grove_lcd_rgb.h: No such file or directory`.

- [ ] **Step 5: Write the full class declaration**

`shared/vmaas-display/src/grove_lcd_rgb.h` (complete; later tasks only touch the .cpp):

```cpp
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
        Truncate, ///< Cut at the last column of the row.
        Wrap,     ///< Continue on row 1 from column 0; cut at the end of row 1.
        Scroll    ///< Marquee inside the window from the cursor column to column 15.
    };

    /**
     * @brief 16x2 character LCD with RGB backlight, driven over an LcdPort.
     *
     * Call begin() once. Then position with set_cursor() and write with
     * print(), or use print_at(). Rows printed with Overflow::Scroll keep
     * moving as long as tick() is called from the main loop.
     *
     * @section lcd_scroll_rules Scrolling rows are protected
     *
     * print() with Truncate or Wrap that would touch a scrolling row returns
     * LcdError::RowScrolling and writes nothing. Stop the row first with
     * stop_scroll(), clear_row() or clear(). print(..., Scroll) on a row that
     * already scrolls replaces its text.
     */
    class GroveLcdRgb
    {
    public:
        static constexpr uint8_t COLS = 16;          ///< Characters per row.
        static constexpr uint8_t ROWS = 2;           ///< Number of rows.
        static constexpr size_t SCROLL_BUFFER = 64;  ///< Longest text accepted by Overflow::Scroll.
        static constexpr uint8_t LCD_ADDR = 0x3E;    ///< AiP31068L LCD controller.
        static constexpr uint8_t RGB_ADDR_V4 = 0x62; ///< PCA9633 backlight (v4.0).
        static constexpr uint8_t RGB_ADDR_V5 = 0x30; ///< SGM31323 backlight (v5.0).

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
         * @return LcdError::None on full success.
         */
        LcdError begin();

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
         * @param mode Overflow handling, see Overflow and @ref lcd_scroll_rules.
         * @return LcdError::RowScrolling if a Truncate/Wrap print would touch a
         *         scrolling row; LcdError::InvalidArgument if Scroll text is
         *         longer than SCROLL_BUFFER.
         */
        LcdError print(const char* text, Overflow mode = Overflow::Truncate);

        /// @brief set_cursor() followed by print().
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
         * moves one character every scroll interval after that. I2C failures
         * during a tick are ignored and retried on the next step.
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

        LcdPort& port_;
        bool initialised_ = false;
        RgbChip rgb_ = RgbChip::None;
        uint8_t col_ = 0; // next write column, may equal COLS when the row is full
        uint8_t row_ = 0;
        uint32_t scroll_interval_ms_ = 300;
        ScrollRow scroll_[ROWS];
    };
}
```

- [ ] **Step 6: Write the implementation for begin(), set_rgb() and the private helpers; stub the rest**

`shared/vmaas-display/src/grove_lcd_rgb.cpp`. The stubs marked `// Task N` are replaced in later tasks; they return `NotInitialized` when not initialised so `test_methods_before_begin_return_not_initialized` passes now.

```cpp
/**
 * @file grove_lcd_rgb.cpp
 * @brief GroveLcdRgb implementation. See grove_lcd_rgb.h.
 */
#include "grove_lcd_rgb.h"
#include <cstring>

namespace
{
    constexpr uint8_t CTRL_COMMAND = 0x80;
    constexpr uint8_t CTRL_DATA = 0x40;

    constexpr uint8_t CMD_CLEAR = 0x01;
    constexpr uint8_t CMD_ENTRY_MODE = 0x06;   // increment, no shift
    constexpr uint8_t CMD_DISPLAY_OFF = 0x08;
    constexpr uint8_t CMD_DISPLAY_ON = 0x0C;   // display on, cursor off, blink off
    constexpr uint8_t CMD_FUNCTION_SET = 0x28; // 2 lines, 5x8 font
    constexpr uint8_t CMD_SET_DDRAM = 0x80;

    constexpr uint8_t ROW_OFFSET[] = {0x00, 0x40};

    // PCA9633 (v4.0)
    constexpr uint8_t PCA_MODE1 = 0x00, PCA_MODE2 = 0x01, PCA_LEDOUT = 0x08;
    constexpr uint8_t PCA_BLUE = 0x02, PCA_GREEN = 0x03, PCA_RED = 0x04;
    // SGM31323 (v5.0)
    constexpr uint8_t SGM_ENABLE = 0x00, SGM_MODE = 0x04;
    constexpr uint8_t SGM_RED = 0x06, SGM_GREEN = 0x07, SGM_BLUE = 0x08;

    constexpr uint8_t SCROLL_PADDING = 3;
}

namespace vmaas
{
    GroveLcdRgb::GroveLcdRgb(LcdPort& port) : port_(port) {}

    // ---- private helpers -------------------------------------------------

    LcdError GroveLcdRgb::command(uint8_t cmd)
    {
        const uint8_t buf[2] = {CTRL_COMMAND, cmd};
        return port_.write(LCD_ADDR, buf, sizeof(buf)) ? LcdError::None : LcdError::I2cWrite;
    }

    LcdError GroveLcdRgb::data(const char* bytes, size_t n)
    {
        if (n == 0)
            return LcdError::None;
        uint8_t buf[1 + COLS];
        if (n > COLS)
            n = COLS;
        buf[0] = CTRL_DATA;
        std::memcpy(buf + 1, bytes, n);
        if (!port_.write(LCD_ADDR, buf, n + 1))
            return LcdError::I2cWrite;
        const unsigned next = col_ + n;
        col_ = next > COLS ? COLS : static_cast<uint8_t>(next);
        return LcdError::None;
    }

    LcdError GroveLcdRgb::write_cursor(uint8_t col, uint8_t row)
    {
        const LcdError err = command(static_cast<uint8_t>(CMD_SET_DDRAM | (ROW_OFFSET[row] + col)));
        if (err != LcdError::None)
            return err;
        col_ = col;
        row_ = row;
        return LcdError::None;
    }

    bool GroveLcdRgb::rgb_reg(uint8_t addr, uint8_t reg, uint8_t value)
    {
        const uint8_t buf[2] = {reg, value};
        return port_.write(addr, buf, sizeof(buf));
    }

    // ---- public API ------------------------------------------------------

    LcdError GroveLcdRgb::begin()
    {
        initialised_ = false;
        rgb_ = RgbChip::None;
        for (ScrollRow& s : scroll_)
            s.active = false;

        port_.delay_ms(50);
        if (command(CMD_FUNCTION_SET) != LcdError::None) return LcdError::I2cWrite;
        port_.delay_ms(5);
        if (command(CMD_FUNCTION_SET) != LcdError::None) return LcdError::I2cWrite;
        port_.delay_ms(1);
        if (command(CMD_DISPLAY_ON) != LcdError::None) return LcdError::I2cWrite;
        if (command(CMD_CLEAR) != LcdError::None) return LcdError::I2cWrite;
        port_.delay_ms(2);
        if (command(CMD_ENTRY_MODE) != LcdError::None) return LcdError::I2cWrite;

        initialised_ = true;
        col_ = 0;
        row_ = 0;

        if (rgb_reg(RGB_ADDR_V5, SGM_ENABLE, 0x07))
        {
            rgb_ = RgbChip::Sgm31323;
            rgb_reg(RGB_ADDR_V5, SGM_MODE, 0x15);
        }
        else if (rgb_reg(RGB_ADDR_V4, PCA_MODE1, 0x00))
        {
            rgb_ = RgbChip::Pca9633;
            rgb_reg(RGB_ADDR_V4, PCA_LEDOUT, 0xFF);
            rgb_reg(RGB_ADDR_V4, PCA_MODE2, 0x20);
        }
        else
        {
            return LcdError::RgbChipNotFound;
        }
        return set_rgb(255, 255, 255);
    }

    LcdError GroveLcdRgb::set_rgb(uint8_t r, uint8_t g, uint8_t b)
    {
        if (!initialised_)
            return LcdError::NotInitialized;
        bool ok = false;
        switch (rgb_)
        {
        case RgbChip::Pca9633:
            ok = rgb_reg(RGB_ADDR_V4, PCA_RED, r) && rgb_reg(RGB_ADDR_V4, PCA_GREEN, g) &&
                 rgb_reg(RGB_ADDR_V4, PCA_BLUE, b);
            break;
        case RgbChip::Sgm31323:
            ok = rgb_reg(RGB_ADDR_V5, SGM_RED, r) && rgb_reg(RGB_ADDR_V5, SGM_GREEN, g) &&
                 rgb_reg(RGB_ADDR_V5, SGM_BLUE, b);
            break;
        case RgbChip::None:
            return LcdError::RgbChipNotFound;
        }
        return ok ? LcdError::None : LcdError::I2cWrite;
    }

    LcdError GroveLcdRgb::set_cursor(uint8_t col, uint8_t row)
    {
        if (!initialised_) return LcdError::NotInitialized;
        if (col >= COLS || row >= ROWS) return LcdError::InvalidArgument;
        return write_cursor(col, row);
    }

    // Task 3
    LcdError GroveLcdRgb::clear() { return initialised_ ? LcdError::None : LcdError::NotInitialized; }
    LcdError GroveLcdRgb::clear_row(uint8_t) { return initialised_ ? LcdError::None : LcdError::NotInitialized; }
    LcdError GroveLcdRgb::display(bool) { return initialised_ ? LcdError::None : LcdError::NotInitialized; }

    // Task 4
    LcdError GroveLcdRgb::print(const char*, Overflow) { return initialised_ ? LcdError::None : LcdError::NotInitialized; }
    LcdError GroveLcdRgb::print_at(uint8_t, uint8_t, const char*, Overflow) { return initialised_ ? LcdError::None : LcdError::NotInitialized; }

    // Task 5
    LcdError GroveLcdRgb::stop_scroll(uint8_t) { return initialised_ ? LcdError::None : LcdError::NotInitialized; }
    void GroveLcdRgb::tick(uint32_t) {}
    LcdError GroveLcdRgb::draw_window(uint8_t) { return LcdError::None; }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `$PIO test -e native -f test_begin`
Expected: `6 Tests 0 Failures 0 Ignored`, PASSED. Also run `$PIO test -e native` to confirm `test_lcd_error` still passes. Expect a `-Wunused-parameter` warning-free build; the stubs use unnamed parameters for that reason.

- [ ] **Step 8: Verify (no commit)**

Confirm `git status` shows only files under `shared/vmaas-display/`. Tell the owner Task 2 is ready to commit.

---

### Task 3: Cursor, clear, clear_row, display

**Files:**
- Modify: `shared/vmaas-display/src/grove_lcd_rgb.cpp` (replace the `// Task 3` stubs)
- Test: `shared/vmaas-display/test/test_cursor_rgb/test_main.cpp`

**Interfaces:**
- Consumes: `GroveLcdRgb`, `FakePort` from Task 2.
- Produces: working `clear()`, `clear_row(row)`, `display(on)`, `set_cursor(col,row)`, `set_rgb(r,g,b)`. `clear()` and `clear_row()` also deactivate scroll state; Task 5 relies on that.

- [ ] **Step 1: Write the failing tests**

`shared/vmaas-display/test/test_cursor_rgb/test_main.cpp`:

```cpp
#include <unity.h>
#include "../fake_port.h"
#include "grove_lcd_rgb.h"

using namespace vmaas;

namespace
{
    constexpr uint8_t LCD = 0x3E;
    constexpr uint8_t RGB_V4 = 0x62;
    constexpr uint8_t RGB_V5 = 0x30;

    // A begun v4.0 display with the event log cleared.
    struct Fixture
    {
        FakePort port;
        GroveLcdRgb lcd{port};
        Fixture()
        {
            port.nak(RGB_V5);
            lcd.begin();
            port.clear();
        }
    };
}

void setUp() {}
void tearDown() {}

void test_set_cursor_row0_col0()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.set_cursor(0, 0));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(1, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0x80}));
}

void test_set_cursor_row1_col5()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.set_cursor(5, 1));
    TEST_ASSERT_TRUE(bytes_equal(f.port.writes_to(LCD)[0], {0x80, 0xC5}));
}

void test_set_cursor_out_of_range_writes_nothing()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::InvalidArgument, f.lcd.set_cursor(16, 0));
    TEST_ASSERT_EQUAL(LcdError::InvalidArgument, f.lcd.set_cursor(0, 2));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
}

void test_set_cursor_i2c_failure()
{
    Fixture f;
    f.port.fail_next(1);
    TEST_ASSERT_EQUAL(LcdError::I2cWrite, f.lcd.set_cursor(3, 0));
}

void test_clear_sends_clear_and_waits()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.clear());
    TEST_ASSERT_EQUAL(2, f.port.events.size());
    TEST_ASSERT_TRUE(bytes_equal(f.port.events[0].bytes, {0x80, 0x01}));
    TEST_ASSERT_EQUAL(Event::Delay, f.port.events[1].kind);
    TEST_ASSERT_EQUAL_UINT32(2, f.port.events[1].ms);
}

void test_clear_row_writes_16_spaces_at_row_start()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.clear_row(1));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(2, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0xC0}));
    TEST_ASSERT_EQUAL(17, w[1].size());
    TEST_ASSERT_EQUAL_HEX8(0x40, w[1][0]);
    for (size_t i = 1; i < 17; ++i)
        TEST_ASSERT_EQUAL_HEX8(' ', w[1][i]);
}

void test_clear_row_out_of_range()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::InvalidArgument, f.lcd.clear_row(2));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
}

void test_display_on_off()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.display(false));
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.display(true));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0x08}));
    TEST_ASSERT_TRUE(bytes_equal(w[1], {0x80, 0x0C}));
}

void test_set_rgb_v4_registers()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.set_rgb(10, 20, 30));
    auto w = f.port.writes_to(RGB_V4);
    TEST_ASSERT_EQUAL(3, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x04, 10}));
    TEST_ASSERT_TRUE(bytes_equal(w[1], {0x03, 20}));
    TEST_ASSERT_TRUE(bytes_equal(w[2], {0x02, 30}));
    TEST_ASSERT_EQUAL(0, f.port.writes_to(LCD).size());
}

void test_set_rgb_v5_registers()
{
    FakePort port;
    GroveLcdRgb lcd(port);
    lcd.begin();
    port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, lcd.set_rgb(10, 20, 30));
    auto w = port.writes_to(RGB_V5);
    TEST_ASSERT_EQUAL(3, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x06, 10}));
    TEST_ASSERT_TRUE(bytes_equal(w[1], {0x07, 20}));
    TEST_ASSERT_TRUE(bytes_equal(w[2], {0x08, 30}));
}

void test_set_rgb_i2c_failure()
{
    Fixture f;
    f.port.fail_next(1);
    TEST_ASSERT_EQUAL(LcdError::I2cWrite, f.lcd.set_rgb(1, 2, 3));
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_set_cursor_row0_col0);
    RUN_TEST(test_set_cursor_row1_col5);
    RUN_TEST(test_set_cursor_out_of_range_writes_nothing);
    RUN_TEST(test_set_cursor_i2c_failure);
    RUN_TEST(test_clear_sends_clear_and_waits);
    RUN_TEST(test_clear_row_writes_16_spaces_at_row_start);
    RUN_TEST(test_clear_row_out_of_range);
    RUN_TEST(test_display_on_off);
    RUN_TEST(test_set_rgb_v4_registers);
    RUN_TEST(test_set_rgb_v5_registers);
    RUN_TEST(test_set_rgb_i2c_failure);
    return UNITY_END();
}
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `$PIO test -e native -f test_cursor_rgb`
Expected: cursor and set_rgb tests pass already (implemented in Task 2); `test_clear_sends_clear_and_waits`, `test_clear_row_writes_16_spaces_at_row_start`, `test_clear_row_out_of_range` and `test_display_on_off` FAIL (stubs write nothing).

- [ ] **Step 3: Replace the Task 3 stubs**

In `grove_lcd_rgb.cpp`, delete the three lines under `// Task 3` and add:

```cpp
    LcdError GroveLcdRgb::clear()
    {
        if (!initialised_) return LcdError::NotInitialized;
        const LcdError err = command(CMD_CLEAR);
        if (err != LcdError::None) return err;
        port_.delay_ms(2);
        col_ = 0;
        row_ = 0;
        for (ScrollRow& s : scroll_)
            s.active = false;
        return LcdError::None;
    }

    LcdError GroveLcdRgb::clear_row(uint8_t row)
    {
        if (!initialised_) return LcdError::NotInitialized;
        if (row >= ROWS) return LcdError::InvalidArgument;
        scroll_[row].active = false;
        const LcdError err = write_cursor(0, row);
        if (err != LcdError::None) return err;
        char spaces[COLS];
        std::memset(spaces, ' ', COLS);
        return data(spaces, COLS);
    }

    LcdError GroveLcdRgb::display(bool on)
    {
        if (!initialised_) return LcdError::NotInitialized;
        return command(on ? CMD_DISPLAY_ON : CMD_DISPLAY_OFF);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PIO test -e native`
Expected: all three folders pass, `test_cursor_rgb` reports `11 Tests 0 Failures`.

- [ ] **Step 5: Verify (no commit)**

Confirm `git status` shows only `shared/vmaas-display/`. Tell the owner Task 3 is ready to commit.

---

### Task 4: print() with Truncate and Wrap, print_at()

**Files:**
- Modify: `shared/vmaas-display/src/grove_lcd_rgb.cpp` (replace the `// Task 4` stubs)
- Test: `shared/vmaas-display/test/test_print/test_main.cpp`

**Interfaces:**
- Consumes: `data()`, `write_cursor()`, `col_`, `row_`, `scroll_[]` from Task 2/3.
- Produces: `print(text, Overflow)` for Truncate and Wrap, `print_at(col,row,text,mode)`. The Scroll branch is added in Task 5; in this task it returns `LcdError::None` without writing so the switch is complete.

- [ ] **Step 1: Write the failing tests**

`shared/vmaas-display/test/test_print/test_main.cpp`:

```cpp
#include <unity.h>
#include <cstring>
#include <string>
#include "../fake_port.h"
#include "grove_lcd_rgb.h"

using namespace vmaas;

namespace
{
    constexpr uint8_t LCD = 0x3E;
    constexpr uint8_t RGB_V5 = 0x30;

    struct Fixture
    {
        FakePort port;
        GroveLcdRgb lcd{port};
        Fixture()
        {
            port.nak(RGB_V5);
            lcd.begin();
            port.clear();
        }
    };

    // Text carried by a data write (strips the 0x40 control byte).
    std::string payload(const std::vector<uint8_t>& w)
    {
        return std::string(w.begin() + 1, w.end());
    }
}

void setUp() {}
void tearDown() {}

void test_short_text_written_as_one_data_transfer()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("VMaaS"));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(1, w.size());
    TEST_ASSERT_EQUAL_HEX8(0x40, w[0][0]);
    TEST_ASSERT_EQUAL_STRING("VMaaS", payload(w[0]).c_str());
}

void test_nullptr_is_invalid_argument()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::InvalidArgument, f.lcd.print(nullptr));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
}

void test_empty_text_writes_nothing()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print(""));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
}

void test_truncate_cuts_at_column_16()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("ABCDEFGHIJKLMNOPQRST", Overflow::Truncate));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(1, w.size());
    TEST_ASSERT_EQUAL_STRING("ABCDEFGHIJKLMNOP", payload(w[0]).c_str());
}

void test_truncate_respects_cursor_column()
{
    Fixture f;
    f.lcd.set_cursor(11, 1);
    f.port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("25 kr,-", Overflow::Truncate));
    TEST_ASSERT_EQUAL_STRING("25 kr", payload(f.port.writes_to(LCD)[0]).c_str());
}

void test_truncate_on_full_row_writes_nothing()
{
    Fixture f;
    f.lcd.print("ABCDEFGHIJKLMNOP");
    f.port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("X", Overflow::Truncate));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
}

void test_consecutive_prints_advance_cursor()
{
    Fixture f;
    f.lcd.print("Slot: ");
    f.lcd.print("3");
    f.lcd.print("XXXXXXXXXXXXXXXX"); // 16 more, only 9 fit
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(3, w.size());
    TEST_ASSERT_EQUAL_STRING("XXXXXXXXX", payload(w[2]).c_str());
}

void test_wrap_from_row0_continues_on_row1()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("ABCDEFGHIJKLMNOPQRST", Overflow::Wrap));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(3, w.size());
    TEST_ASSERT_EQUAL_STRING("ABCDEFGHIJKLMNOP", payload(w[0]).c_str());
    TEST_ASSERT_TRUE(bytes_equal(w[1], {0x80, 0xC0})); // cursor to (0,1)
    TEST_ASSERT_EQUAL_STRING("QRST", payload(w[2]).c_str());
}

void test_wrap_drops_text_beyond_row1()
{
    Fixture f;
    std::string forty(40, 'z');
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print(forty.c_str(), Overflow::Wrap));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(3, w.size());
    TEST_ASSERT_EQUAL(16, payload(w[0]).size());
    TEST_ASSERT_EQUAL(16, payload(w[2]).size());
}

void test_wrap_on_row1_behaves_like_truncate()
{
    Fixture f;
    f.lcd.set_cursor(0, 1);
    f.port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("ABCDEFGHIJKLMNOPQRST", Overflow::Wrap));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(1, w.size());
    TEST_ASSERT_EQUAL_STRING("ABCDEFGHIJKLMNOP", payload(w[0]).c_str());
}

void test_wrap_that_fits_does_not_touch_row1()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("fits", Overflow::Wrap));
    TEST_ASSERT_EQUAL(1, f.port.write_count());
}

void test_print_at_sets_cursor_then_prints()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print_at(11, 1, "25 kr"));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(2, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0xCB}));
    TEST_ASSERT_EQUAL_STRING("25 kr", payload(w[1]).c_str());
}

void test_print_at_invalid_position()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::InvalidArgument, f.lcd.print_at(16, 0, "x"));
    TEST_ASSERT_EQUAL(LcdError::InvalidArgument, f.lcd.print_at(0, 2, "x"));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
}

void test_i2c_failure_during_wrap_stops_and_reports()
{
    Fixture f;
    f.port.fail_next(1); // the first data write fails
    TEST_ASSERT_EQUAL(LcdError::I2cWrite, f.lcd.print("ABCDEFGHIJKLMNOPQRST", Overflow::Wrap));
    TEST_ASSERT_EQUAL(0, f.port.write_count()); // nothing after the failure
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_short_text_written_as_one_data_transfer);
    RUN_TEST(test_nullptr_is_invalid_argument);
    RUN_TEST(test_empty_text_writes_nothing);
    RUN_TEST(test_truncate_cuts_at_column_16);
    RUN_TEST(test_truncate_respects_cursor_column);
    RUN_TEST(test_truncate_on_full_row_writes_nothing);
    RUN_TEST(test_consecutive_prints_advance_cursor);
    RUN_TEST(test_wrap_from_row0_continues_on_row1);
    RUN_TEST(test_wrap_drops_text_beyond_row1);
    RUN_TEST(test_wrap_on_row1_behaves_like_truncate);
    RUN_TEST(test_wrap_that_fits_does_not_touch_row1);
    RUN_TEST(test_print_at_sets_cursor_then_prints);
    RUN_TEST(test_print_at_invalid_position);
    RUN_TEST(test_i2c_failure_during_wrap_stops_and_reports);
    return UNITY_END();
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PIO test -e native -f test_print`
Expected: most tests FAIL (stubs write nothing); `test_empty_text_writes_nothing` may pass by accident.

- [ ] **Step 3: Replace the Task 4 stubs**

In `grove_lcd_rgb.cpp`, delete the two lines under `// Task 4` and add:

```cpp
    LcdError GroveLcdRgb::print(const char* text, Overflow mode)
    {
        if (!initialised_) return LcdError::NotInitialized;
        if (text == nullptr) return LcdError::InvalidArgument;

        const size_t n = std::strlen(text);
        const size_t remaining = COLS - col_;

        switch (mode)
        {
        case Overflow::Truncate:
        {
            if (scroll_[row_].active) return LcdError::RowScrolling;
            return data(text, n < remaining ? n : remaining);
        }
        case Overflow::Wrap:
        {
            if (scroll_[row_].active) return LcdError::RowScrolling;
            const size_t first = n < remaining ? n : remaining;
            const bool spill = n > first && row_ == 0;
            if (spill && scroll_[1].active) return LcdError::RowScrolling;

            LcdError err = data(text, first);
            if (err != LcdError::None) return err;
            if (!spill) return LcdError::None;

            err = write_cursor(0, 1);
            if (err != LcdError::None) return err;
            const size_t rest = n - first;
            return data(text + first, rest < COLS ? rest : COLS);
        }
        case Overflow::Scroll:
            return LcdError::None; // Task 5
        }
        return LcdError::InvalidArgument;
    }

    LcdError GroveLcdRgb::print_at(uint8_t col, uint8_t row, const char* text, Overflow mode)
    {
        const LcdError err = set_cursor(col, row);
        if (err != LcdError::None) return err;
        return print(text, mode);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PIO test -e native`
Expected: all four folders pass, `test_print` reports `14 Tests 0 Failures`.

- [ ] **Step 5: Verify (no commit)**

Confirm `git status`. Tell the owner Task 4 is ready to commit.

---

### Task 5: Scroll, tick(), stop_scroll() and the protection rules

**Files:**
- Modify: `shared/vmaas-display/src/grove_lcd_rgb.cpp` (Scroll branch in `print()`, replace the `// Task 5` stubs)
- Test: `shared/vmaas-display/test/test_scroll/test_main.cpp`

**Interfaces:**
- Consumes: `ScrollRow`, `scroll_[]`, `data()`, `write_cursor()` from Task 2, `print()` switch from Task 4.
- Produces: `print(text, Overflow::Scroll)`, `tick(now_ms)`, `stop_scroll(row)`, `set_scroll_interval(ms)`, private `draw_window(row)`.

- [ ] **Step 1: Write the failing tests**

`shared/vmaas-display/test/test_scroll/test_main.cpp`:

```cpp
#include <unity.h>
#include <cstring>
#include <string>
#include "../fake_port.h"
#include "grove_lcd_rgb.h"

using namespace vmaas;

namespace
{
    constexpr uint8_t LCD = 0x3E;
    constexpr uint8_t RGB_V5 = 0x30;
    const char* LONG_TEXT = "Display smoke test"; // 18 chars, > 16

    struct Fixture
    {
        FakePort port;
        GroveLcdRgb lcd{port};
        Fixture()
        {
            port.nak(RGB_V5);
            lcd.begin();
            port.clear();
        }
    };

    std::string payload(const std::vector<uint8_t>& w)
    {
        return std::string(w.begin() + 1, w.end());
    }
}

void setUp() {}
void tearDown() {}

void test_scroll_text_that_fits_is_written_once_and_never_scrolls()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("short", Overflow::Scroll));
    TEST_ASSERT_EQUAL(1, f.port.write_count());
    f.lcd.tick(0);
    f.lcd.tick(10000);
    TEST_ASSERT_EQUAL(1, f.port.write_count());
    // Row is not protected either.
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print_at(0, 0, "x", Overflow::Truncate));
}

void test_scroll_draws_offset_zero_immediately()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print(LONG_TEXT, Overflow::Scroll));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(2, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0x80}));
    TEST_ASSERT_EQUAL_STRING("Display smoke te", payload(w[1]).c_str());
}

void test_first_tick_primes_then_steps_after_interval()
{
    Fixture f;
    f.lcd.print(LONG_TEXT, Overflow::Scroll);
    f.port.clear();
    f.lcd.tick(1000);        // prime
    TEST_ASSERT_EQUAL(0, f.port.write_count());
    f.lcd.tick(1299);        // not yet
    TEST_ASSERT_EQUAL(0, f.port.write_count());
    f.lcd.tick(1300);        // step 1
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(2, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0x80}));
    TEST_ASSERT_EQUAL_STRING("isplay smoke tes", payload(w[1]).c_str());
}

void test_scroll_wraps_around_with_three_space_padding()
{
    Fixture f;
    f.lcd.print(LONG_TEXT, Overflow::Scroll); // len 18 + 3 = 21 steps per cycle
    f.lcd.tick(0);
    f.port.clear();
    uint32_t t = 0;
    for (int step = 1; step <= 20; ++step)
    {
        t += 300;
        f.lcd.tick(t);
    }
    // offset 20: last padding space, then text from the start.
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL_STRING(" Display smoke t", payload(w.back()).c_str());
    f.port.clear();
    f.lcd.tick(t + 300); // offset back to 0
    TEST_ASSERT_EQUAL_STRING("Display smoke te", payload(f.port.writes_to(LCD).back()).c_str());
}

void test_scroll_window_starts_at_cursor_column()
{
    Fixture f;
    f.lcd.set_cursor(6, 1);
    f.port.clear();
    f.lcd.print("0123456789ABCDEF", Overflow::Scroll); // 16 chars, window is 10 wide
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0xC6}));
    TEST_ASSERT_EQUAL_STRING("0123456789", payload(w[1]).c_str());
    f.lcd.tick(0);
    f.port.clear();
    f.lcd.tick(300);
    w = f.port.writes_to(LCD);
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0xC6}));
    TEST_ASSERT_EQUAL_STRING("123456789A", payload(w[1]).c_str());
}

void test_custom_scroll_interval()
{
    Fixture f;
    f.lcd.set_scroll_interval(100);
    f.lcd.print(LONG_TEXT, Overflow::Scroll);
    f.lcd.tick(0);
    f.port.clear();
    f.lcd.tick(99);
    TEST_ASSERT_EQUAL(0, f.port.write_count());
    f.lcd.tick(100);
    TEST_ASSERT_EQUAL(2, f.port.write_count());
}

void test_rows_scroll_independently()
{
    Fixture f;
    f.lcd.print_at(0, 0, "Row zero is a long line", Overflow::Scroll);
    f.lcd.print_at(0, 1, LONG_TEXT, Overflow::Scroll);
    f.lcd.tick(0);
    f.port.clear();
    f.lcd.tick(300);
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(4, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0x80}));
    TEST_ASSERT_EQUAL_STRING("ow zero is a lon", payload(w[1]).c_str());
    TEST_ASSERT_TRUE(bytes_equal(w[2], {0x80, 0xC0}));
    TEST_ASSERT_EQUAL_STRING("isplay smoke tes", payload(w[3]).c_str());
}

void test_scroll_text_over_buffer_is_rejected_before_writing()
{
    Fixture f;
    std::string tooLong(65, 'a');
    TEST_ASSERT_EQUAL(LcdError::InvalidArgument, f.lcd.print(tooLong.c_str(), Overflow::Scroll));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
    std::string maxLen(64, 'a');
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print(maxLen.c_str(), Overflow::Scroll));
}

void test_truncate_on_scrolling_row_is_rejected_without_writes()
{
    Fixture f;
    f.lcd.print_at(0, 1, LONG_TEXT, Overflow::Scroll);
    f.port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.set_cursor(3, 1));
    f.port.clear();
    TEST_ASSERT_EQUAL(LcdError::RowScrolling, f.lcd.print("x", Overflow::Truncate));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
}

void test_wrap_into_scrolling_row1_is_rejected_before_any_write()
{
    Fixture f;
    f.lcd.print_at(0, 1, LONG_TEXT, Overflow::Scroll);
    f.lcd.set_cursor(0, 0);
    f.port.clear();
    TEST_ASSERT_EQUAL(LcdError::RowScrolling, f.lcd.print("ABCDEFGHIJKLMNOPQRST", Overflow::Wrap));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
    // A Wrap print that fits on row 0 is fine.
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("fits", Overflow::Wrap));
}

void test_scroll_on_scrolling_row_replaces_text()
{
    Fixture f;
    f.lcd.print(LONG_TEXT, Overflow::Scroll);
    f.port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print_at(0, 0, "Another long text here", Overflow::Scroll));
    TEST_ASSERT_EQUAL_STRING("Another long tex", payload(f.port.writes_to(LCD).back()).c_str());
}

void test_stop_scroll_freezes_and_unprotects()
{
    Fixture f;
    f.lcd.print(LONG_TEXT, Overflow::Scroll);
    f.lcd.tick(0);
    f.port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.stop_scroll(0));
    TEST_ASSERT_EQUAL(0, f.port.write_count());   // slice left in place
    f.lcd.tick(300);
    TEST_ASSERT_EQUAL(0, f.port.write_count());   // no more steps
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print_at(0, 0, "x", Overflow::Truncate));
}

void test_stop_scroll_on_idle_row_is_ok_and_out_of_range_is_invalid()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.stop_scroll(1));
    TEST_ASSERT_EQUAL(LcdError::InvalidArgument, f.lcd.stop_scroll(2));
}

void test_clear_row_and_clear_stop_scrolling()
{
    Fixture f;
    f.lcd.print_at(0, 0, LONG_TEXT, Overflow::Scroll);
    f.lcd.print_at(0, 1, LONG_TEXT, Overflow::Scroll);
    f.lcd.clear_row(0);
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print_at(0, 0, "x"));
    TEST_ASSERT_EQUAL(LcdError::RowScrolling, f.lcd.print_at(0, 1, "x"));
    f.lcd.clear();
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print_at(0, 1, "x"));
}

void test_tick_ignores_i2c_failure_and_retries_next_step()
{
    Fixture f;
    f.lcd.print(LONG_TEXT, Overflow::Scroll);
    f.lcd.tick(0);
    f.port.clear();
    f.port.fail_next(1);      // cursor write of the step fails
    f.lcd.tick(300);
    TEST_ASSERT_EQUAL(0, f.port.write_count());
    f.lcd.tick(600);
    TEST_ASSERT_EQUAL(2, f.port.write_count());
}

void test_tick_handles_time_wraparound()
{
    Fixture f;
    f.lcd.print(LONG_TEXT, Overflow::Scroll);
    f.lcd.tick(0xFFFFFF00u);
    f.port.clear();
    f.lcd.tick(0x00000100u); // 512 ms later across the wrap
    TEST_ASSERT_EQUAL(2, f.port.write_count());
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_scroll_text_that_fits_is_written_once_and_never_scrolls);
    RUN_TEST(test_scroll_draws_offset_zero_immediately);
    RUN_TEST(test_first_tick_primes_then_steps_after_interval);
    RUN_TEST(test_scroll_wraps_around_with_three_space_padding);
    RUN_TEST(test_scroll_window_starts_at_cursor_column);
    RUN_TEST(test_custom_scroll_interval);
    RUN_TEST(test_rows_scroll_independently);
    RUN_TEST(test_scroll_text_over_buffer_is_rejected_before_writing);
    RUN_TEST(test_truncate_on_scrolling_row_is_rejected_without_writes);
    RUN_TEST(test_wrap_into_scrolling_row1_is_rejected_before_any_write);
    RUN_TEST(test_scroll_on_scrolling_row_replaces_text);
    RUN_TEST(test_stop_scroll_freezes_and_unprotects);
    RUN_TEST(test_stop_scroll_on_idle_row_is_ok_and_out_of_range_is_invalid);
    RUN_TEST(test_clear_row_and_clear_stop_scrolling);
    RUN_TEST(test_tick_ignores_i2c_failure_and_retries_next_step);
    RUN_TEST(test_tick_handles_time_wraparound);
    return UNITY_END();
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PIO test -e native -f test_scroll`
Expected: the scroll-specific tests FAIL (the Scroll branch writes nothing, `tick()` is empty). `test_scroll_text_over_buffer_is_rejected_before_writing` fails because the stub returns `None` for 65 chars.

- [ ] **Step 3: Implement the Scroll branch in print()**

In `grove_lcd_rgb.cpp`, replace

```cpp
        case Overflow::Scroll:
            return LcdError::None; // Task 5
```

with

```cpp
        case Overflow::Scroll:
        {
            if (n > SCROLL_BUFFER) return LcdError::InvalidArgument;
            ScrollRow& s = scroll_[row_];
            if (n <= remaining)
            {
                s.active = false;      // replaces any marquee on this row
                return data(text, n);
            }
            std::memcpy(s.text, text, n);
            std::memset(s.text + n, ' ', SCROLL_PADDING);
            s.len = static_cast<uint8_t>(n + SCROLL_PADDING);
            s.window_col = col_;
            s.window_width = static_cast<uint8_t>(remaining);
            s.offset = 0;
            s.primed = false;
            s.active = true;
            return draw_window(row_);
        }
```

- [ ] **Step 4: Replace the Task 5 stubs**

Delete the three lines under `// Task 5` and add:

```cpp
    LcdError GroveLcdRgb::stop_scroll(uint8_t row)
    {
        if (!initialised_) return LcdError::NotInitialized;
        if (row >= ROWS) return LcdError::InvalidArgument;
        scroll_[row].active = false;
        return LcdError::None;
    }

    LcdError GroveLcdRgb::draw_window(uint8_t row)
    {
        ScrollRow& s = scroll_[row];
        char slice[COLS];
        for (uint8_t i = 0; i < s.window_width; ++i)
            slice[i] = s.text[(s.offset + i) % s.len];
        const LcdError err = write_cursor(s.window_col, row);
        if (err != LcdError::None) return err;
        return data(slice, s.window_width);
    }

    void GroveLcdRgb::tick(uint32_t now_ms)
    {
        if (!initialised_) return;
        for (uint8_t row = 0; row < ROWS; ++row)
        {
            ScrollRow& s = scroll_[row];
            if (!s.active) continue;
            if (!s.primed)
            {
                s.primed = true;
                s.last_step_ms = now_ms;
                continue;
            }
            if (static_cast<uint32_t>(now_ms - s.last_step_ms) < scroll_interval_ms_) continue;

            // OWNER DECISION: step timing. Default resets the reference to now
            // (simple, drifts a little under load). Alternative:
            // s.last_step_ms += scroll_interval_ms_ (drift-free, but catches up
            // in a burst after a stall). Change here if the marquee should keep
            // exact cadence.
            s.last_step_ms = now_ms;
            s.offset = static_cast<uint8_t>((s.offset + 1) % s.len);
            draw_window(row); // failures are ignored; the next step redraws
        }
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `$PIO test -e native`
Expected: all five folders pass; `test_scroll` reports `16 Tests 0 Failures`. Build must be warning-free under `-Wall -Wextra`.

- [ ] **Step 6: Verify (no commit)**

Confirm `git status`. Tell the owner Task 5 is ready to commit and point out the **OWNER DECISION** comment in `tick()`.

---

### Task 6: EspI2cPort (ESP-IDF implementation) and README

**Files:**
- Create: `shared/vmaas-display/src/esp_i2c_port.h`
- Create: `shared/vmaas-display/src/esp_i2c_port.cpp`
- Create: `shared/vmaas-display/README.md`

**Interfaces:**
- Consumes: `vmaas::LcdPort` from Task 2.
- Produces: `class vmaas::EspI2cPort : public LcdPort` with `EspI2cPort(i2c_port_num_t port, int sda_pin, int scl_pin, uint32_t clock_hz = 100000)`, `void begin()`, `bool write(...)`, `void delay_ms(...)`. Task 7 constructs it as `EspI2cPort i2c(I2C_NUM_0, Pins::I2C_SDA, Pins::I2C_SCL, Config::i2c_clock_hz)`.

There is no host test for this file (it is ESP-only). It is compiled and exercised in Task 7. The host test build must still pass because the whole file is inside `#ifdef ESP_PLATFORM`.

- [ ] **Step 1: Write the header**

`shared/vmaas-display/src/esp_i2c_port.h`:

```cpp
#pragma once
/**
 * @file esp_i2c_port.h
 * @brief LcdPort implementation on ESP-IDF's i2c_master driver.
 *
 * Only compiled on ESP targets; the host test build never sees the contents.
 */
#ifdef ESP_PLATFORM

#include <cstddef>
#include <cstdint>
#include "driver/i2c_master.h"
#include "lcd_port.h"

namespace vmaas
{
    /**
     * @brief One I2C master bus with lazily created device handles.
     *
     * The Grove display uses at most three addresses (LCD, v4 RGB, v5 RGB),
     * so a small fixed table of device handles is enough. Failed transfers
     * return false instead of aborting, so an unplugged display never
     * resets the board.
     */
    class EspI2cPort : public LcdPort
    {
    public:
        /**
         * @brief Store the bus configuration. Nothing is touched until begin().
         * @param port I2C controller number, normally I2C_NUM_0.
         * @param sda_pin GPIO for SDA.
         * @param scl_pin GPIO for SCL.
         * @param clock_hz SCL frequency. 100000 (standard mode) for the Grove display.
         */
        EspI2cPort(i2c_port_num_t port, int sda_pin, int scl_pin, uint32_t clock_hz = 100000);

        /**
         * @brief Create the master bus with internal pull-ups enabled.
         *
         * Call once from app_main, before GroveLcdRgb::begin().
         * @warning Uses ESP_ERROR_CHECK, so a misconfigured bus aborts the board.
         */
        void begin();

        /// @copydoc LcdPort::write
        bool write(uint8_t addr, const uint8_t* data, size_t len) override;

        /// @copydoc LcdPort::delay_ms
        void delay_ms(uint32_t ms) override;

    private:
        static constexpr size_t MAX_DEVICES = 4;
        static constexpr int XFER_TIMEOUT_MS = 50;

        i2c_master_dev_handle_t device_for(uint8_t addr);

        i2c_port_num_t port_;
        int sda_pin_;
        int scl_pin_;
        uint32_t clock_hz_;
        i2c_master_bus_handle_t bus_ = nullptr;
        uint8_t addrs_[MAX_DEVICES] = {};
        i2c_master_dev_handle_t devices_[MAX_DEVICES] = {};
        size_t device_count_ = 0;
    };
}

#endif // ESP_PLATFORM
```

- [ ] **Step 2: Write the implementation**

`shared/vmaas-display/src/esp_i2c_port.cpp`:

```cpp
/**
 * @file esp_i2c_port.cpp
 * @brief ESP-IDF i2c_master transport implementation. See esp_i2c_port.h.
 */
#ifdef ESP_PLATFORM

#include "esp_i2c_port.h"
#include "esp_err.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

namespace
{
    constexpr const char* TAG = "EspI2cPort";
}

namespace vmaas
{
    EspI2cPort::EspI2cPort(i2c_port_num_t port, int sda_pin, int scl_pin, uint32_t clock_hz)
        : port_(port), sda_pin_(sda_pin), scl_pin_(scl_pin), clock_hz_(clock_hz)
    {
    }

    void EspI2cPort::begin()
    {
        i2c_master_bus_config_t config = {};
        config.i2c_port = port_;
        config.sda_io_num = static_cast<gpio_num_t>(sda_pin_);
        config.scl_io_num = static_cast<gpio_num_t>(scl_pin_);
        config.clk_source = I2C_CLK_SRC_DEFAULT;
        config.glitch_ignore_cnt = 7;
        config.flags.enable_internal_pullup = 1;

        ESP_ERROR_CHECK(i2c_new_master_bus(&config, &bus_));
        ESP_LOGI(TAG, "I2C%d ready, SDA=%d SCL=%d, %lu Hz", (int)port_, sda_pin_, scl_pin_,
                 (unsigned long)clock_hz_);
    }

    i2c_master_dev_handle_t EspI2cPort::device_for(uint8_t addr)
    {
        for (size_t i = 0; i < device_count_; ++i)
            if (addrs_[i] == addr)
                return devices_[i];
        if (device_count_ >= MAX_DEVICES)
        {
            ESP_LOGE(TAG, "device table full, cannot add 0x%02X", addr);
            return nullptr;
        }

        i2c_device_config_t dev = {};
        dev.dev_addr_length = I2C_ADDR_BIT_LEN_7;
        dev.device_address = addr;
        dev.scl_speed_hz = clock_hz_;

        i2c_master_dev_handle_t handle = nullptr;
        const esp_err_t err = i2c_master_bus_add_device(bus_, &dev, &handle);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "add device 0x%02X failed: %s", addr, esp_err_to_name(err));
            return nullptr;
        }
        addrs_[device_count_] = addr;
        devices_[device_count_] = handle;
        ++device_count_;
        return handle;
    }

    bool EspI2cPort::write(uint8_t addr, const uint8_t* data, size_t len)
    {
        if (bus_ == nullptr)
            return false;
        i2c_master_dev_handle_t dev = device_for(addr);
        if (dev == nullptr)
            return false;
        const esp_err_t err = i2c_master_transmit(dev, data, len, XFER_TIMEOUT_MS);
        if (err != ESP_OK)
        {
            ESP_LOGD(TAG, "write to 0x%02X (%u bytes) failed: %s", addr, (unsigned)len,
                     esp_err_to_name(err));
            return false;
        }
        return true;
    }

    void EspI2cPort::delay_ms(uint32_t ms)
    {
        TickType_t ticks = pdMS_TO_TICKS(ms);
        if (ticks == 0)
            ticks = 1;
        vTaskDelay(ticks);
    }
}

#endif // ESP_PLATFORM
```

Note: `ESP_LOGD` is used for per-write failures because a NAK during the RGB-chip probe in `begin()` is expected and must not spam the log. The bus-level errors use `ESP_LOGE`.

- [ ] **Step 3: Write the README**

`shared/vmaas-display/README.md`:

````markdown
# vmaas-display

Driver for the Seeed **Grove-LCD RGB Backlight** (16x2 character LCD with an
RGB backlight, both over I2C). Used by Main-Controller. Pure C++17 core with
host tests; one ESP-IDF port.

## Wiring (Main-Controller, ESP32-WROVER)

| Grove | ESP32  | Note |
|-------|--------|------|
| SDA   | GPIO21 | ESP32 default I2C SDA |
| SCL   | GPIO22 | ESP32 default I2C SCL |
| VCC   | 5V     | Must be 5 V. At 3.3 V the backlight works but the text is invisible. |
| GND   | GND    | |

I2C at 100 kHz with ESP32 internal pull-ups. The module has no pull-ups of
its own and 3.3 V logic drives it reliably.

## Devices on the module

| Device    | Address | Role |
|-----------|---------|------|
| AiP31068L | `0x3E`  | HD44780-compatible LCD controller |
| PCA9633   | `0x62`  | RGB backlight, v4.0 |
| SGM31323  | `0x30`  | RGB backlight, v5.0 (auto-detected, probed first) |

## LCD command reference

Every transfer to `0x3E` starts with a control byte: `0x80` = one command
follows, `0x40` = display data follows (several bytes allowed).

| Command          | Byte          | Note |
|------------------|---------------|------|
| Function Set     | `0x28`        | 2 lines, 5x8. Sent twice at init. |
| Display On       | `0x0C`        | cursor off, blink off |
| Display Off      | `0x08`        | backlight unaffected |
| Clear            | `0x01`        | wait 2 ms after |
| Entry Mode       | `0x06`        | increment, no shift |
| Set DDRAM addr   | `0x80 \| a`   | row 0: `a = col`, row 1: `a = 0x40 + col` |

Init: wait 50 ms, `0x28`, wait 5 ms, `0x28`, wait 1 ms, `0x0C`, `0x01`,
wait 2 ms, `0x06`.

## RGB registers

PCA9633 (`0x62`): MODE1 `0x00`=`0x00`, LEDOUT `0x08`=`0xFF`, MODE2 `0x01`=`0x20`;
red `0x04`, green `0x03`, blue `0x02`.

SGM31323 (`0x30`): `0x00`=`0x07`, `0x04`=`0x15`; red `0x06`, green `0x07`, blue `0x08`.

## Usage

```cpp
#include "esp_i2c_port.h"
#include "grove_lcd_rgb.h"

vmaas::EspI2cPort i2c(I2C_NUM_0, 21, 22, 100000);
vmaas::GroveLcdRgb lcd(i2c);

i2c.begin();
if (auto err = lcd.begin(); err != vmaas::LcdError::None)
    ESP_LOGW(TAG, "display: %s", vmaas::to_string(err));

lcd.print_at(0, 0, "VMaaS");
lcd.print_at(0, 1, "A long marquee that scrolls", vmaas::Overflow::Scroll);
lcd.set_rgb(0, 128, 255);

while (true) {
    lcd.tick(now_ms());   // advances scrolling rows
    // ...
}
```

### Overflow modes

- `Truncate` (default): cut at column 15 of the current row.
- `Wrap`: continue on row 1 from column 0; cut at the end of row 1.
- `Scroll`: marquee in the window from the cursor column to column 15, one
  character per `set_scroll_interval()` (default 300 ms). Text up to 64 chars.

### Rules

- Only the cells a text covers are written. Update a field with
  `print_at(col, row, text)`; use `clear_row(row)` to blank a row without
  flicker on the other one.
- `print()` with `Truncate`/`Wrap` on a scrolling row returns
  `LcdError::RowScrolling` and writes nothing. Stop the row first with
  `stop_scroll(row)`, `clear_row(row)` or `clear()`.
- The library never logs. Check the returned `LcdError` and use `to_string()`.

## Tests

```
pio test -e native
```

Runs the Unity suites in `test/` against a recording `FakePort`.
````

- [ ] **Step 4: Verify the host build still passes**

Run from `shared/vmaas-display`: `$PIO test -e native`
Expected: all five folders still pass (the new files compile to nothing on `native`).

- [ ] **Step 5: Verify (no commit)**

Confirm `git status`. Tell the owner Task 6 is ready to commit; hardware compile happens in Task 7.

---

### Task 7: Main-Controller integration, Doxygen input, build and flash

**Files:**
- Modify: `Main-Controller/src/pins.h`
- Modify: `Main-Controller/src/config.h`
- Modify: `Main-Controller/src/main.cpp`
- Modify: `Doxyfile` (INPUT line)

**Interfaces:**
- Consumes: `vmaas::EspI2cPort`, `vmaas::GroveLcdRgb`, `vmaas::Overflow`, `vmaas::LcdError`, `vmaas::to_string` from Tasks 1-6.
- Produces: a Main-Controller firmware that runs the UART smoke test and the display smoke test side by side.

- [ ] **Step 1: Add the I2C pins**

Replace `Main-Controller/src/pins.h` with:

```cpp
#pragma once
/**
 * @file pins.h
 * @brief GPIO assignments for the Main-Controller board.
 */

/// Main-Controller pin numbers.
namespace Pins
{
    constexpr int UART_RX = 32; ///Receives pin on Motorcontrol's RX.
    constexpr int UART_TX = 33; ///Transmits pin on Motorcontrol's TX.

    constexpr int I2C_SDA = 21; ///< Grove-LCD SDA. ESP32 default I2C SDA.
    constexpr int I2C_SCL = 22; ///< Grove-LCD SCL. ESP32 default I2C SCL.
}
```

- [ ] **Step 2: Add the I2C clock**

Replace `Main-Controller/src/config.h` with:

```cpp
#pragma once
/**
 * @file config.h
 * @brief Compile-time settings for the Main-Controller firmware.
 */
#include <cstdint>

/// Main-Controller configuration.
namespace Config
{
    /// UART speed towards Motorcontrol in bit/s. Must match Motorcontrol.
    constexpr int baud_rate = 115200;

    /// I2C SCL frequency for the Grove-LCD in Hz. Standard mode; the module is not rated for 400 kHz.
    constexpr uint32_t i2c_clock_hz = 100000;
}
```

- [ ] **Step 3: Add the display smoke test to main.cpp**

Replace `Main-Controller/src/main.cpp` with:

```cpp
// Main-Controller: smoke test for the UART command protocol and the Grove-LCD.
// Sends RUN 1 every 2 seconds, logs every reply from Motorcontrol, shows a
// static and a scrolling line on the display and cycles the backlight.
// See shared/vmaas-protocol/PROTOCOL.md and shared/vmaas-display/README.md.
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "pins.h"
#include "config.h"
#include "motor_client.h"
#include "uart_bus.h"
#include "esp_i2c_port.h"
#include "grove_lcd_rgb.h"

namespace
{
    constexpr const char* TAG = "MainController";
    constexpr uint8_t SMOKE_TEST_SLOT = 1;
    constexpr TickType_t SMOKE_TEST_INTERVAL = pdMS_TO_TICKS(2000);

    vmaas::UartBus bus(UART_NUM_1, Pins::UART_TX, Pins::UART_RX, Config::baud_rate);
    MotorClient motor(bus);

    vmaas::EspI2cPort i2c(I2C_NUM_0, Pins::I2C_SDA, Pins::I2C_SCL, Config::i2c_clock_hz);
    vmaas::GroveLcdRgb lcd(i2c);

    struct Rgb { uint8_t r, g, b; };
    constexpr Rgb BACKLIGHT_CYCLE[] = {
        {255, 0, 0}, {0, 255, 0}, {0, 0, 255}, {255, 255, 255},
    };
    constexpr size_t BACKLIGHT_COUNT = sizeof(BACKLIGHT_CYCLE) / sizeof(BACKLIGHT_CYCLE[0]);

    uint32_t now_ms()
    {
        return static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS);
    }

    void log_lcd(const char* what, vmaas::LcdError err)
    {
        if (err != vmaas::LcdError::None)
            ESP_LOGW(TAG, "display %s: %s", what, vmaas::to_string(err));
    }
}

extern "C" void app_main()
{
    bus.begin();
    motor.begin();

    i2c.begin();
    bool display_ok = true;
    bool backlight_ok = true;
    const vmaas::LcdError lcd_err = lcd.begin();
    if (lcd_err == vmaas::LcdError::RgbChipNotFound)
    {
        ESP_LOGW(TAG, "display: no RGB chip found, text only");
        backlight_ok = false;
    }
    else if (lcd_err != vmaas::LcdError::None)
    {
        ESP_LOGE(TAG, "display init failed: %s, continuing without display",
                 vmaas::to_string(lcd_err));
        display_ok = false;
        backlight_ok = false;
    }

    if (display_ok)
    {
        log_lcd("row 0", lcd.print_at(0, 0, "VMaaS"));
        log_lcd("row 1", lcd.print_at(0, 1, "Display smoke test - UART link to Motorcontrol",
                                      vmaas::Overflow::Scroll));
    }

    motor.on_ack([](vmaas::Cmd cmd) {
        ESP_LOGI(TAG, "ACK for cmd 0x%02X", (unsigned)cmd);
    });
    motor.on_nak([](vmaas::Cmd cmd, vmaas::ErrorCode err) {
        ESP_LOGW(TAG, "NAK for cmd 0x%02X, error %u", (unsigned)cmd, (unsigned)err);
    });
    motor.on_done([](uint8_t slot) {
        ESP_LOGI(TAG, "slot %u dispensed", slot);
    });
    motor.on_status([](vmaas::State state, uint8_t slot) {
        ESP_LOGI(TAG, "status: state=%u current_slot=%u", (unsigned)state, slot);
    });

    TickType_t last_send = xTaskGetTickCount();
    size_t colour_index = 0;
    while (true)
    {
        bus.poll(pdMS_TO_TICKS(50));

        if (display_ok)
            lcd.tick(now_ms());

        const TickType_t now = xTaskGetTickCount();
        if (static_cast<TickType_t>(now - last_send) >= SMOKE_TEST_INTERVAL)
        {
            last_send = now;
            if (bus.dropped_frames() > 0)
                ESP_LOGW(TAG, "dropped frames so far: %lu", (unsigned long)bus.dropped_frames());
            if (motor.run(SMOKE_TEST_SLOT))
                ESP_LOGI(TAG, "sent RUN %u", SMOKE_TEST_SLOT);

            if (backlight_ok)
            {
                const Rgb& c = BACKLIGHT_CYCLE[colour_index];
                log_lcd("set_rgb", lcd.set_rgb(c.r, c.g, c.b));
                colour_index = (colour_index + 1) % BACKLIGHT_COUNT;
            }
        }
    }
}
```

- [ ] **Step 4: Add the library to the Doxygen input**

In the root `Doxyfile`, find the `INPUT` setting (it starts with `INPUT = shared/vmaas-protocol/src \`). Add a line `shared/vmaas-display/src \` directly after the `shared/vmaas-protocol/src \` line, keeping the trailing backslash pattern the same as the other entries.

- [ ] **Step 5: Build the firmware**

Run from `Main-Controller`: `$PIO run -e main-controller`
Expected: `SUCCESS`. Flash usage a little above the previous 16.5%. Fix any compile error in the library before continuing; the host tests must still pass afterwards.

Common pitfalls if the build fails:
- `i2c_port_num_t` / `I2C_CLK_SRC_DEFAULT` unknown: `driver/i2c_master.h` was not found. Confirm `lib_extra_dirs = ../shared` is in `Main-Controller/platformio.ini` and that `esp_driver_i2c` is a default component (it is in ESP-IDF 6.1).
- `pdMS_TO_TICKS` type warning in `now_ms()`: cast to `uint32_t` as shown.

- [ ] **Step 6: Flash and verify on hardware**

1. Wire the display: SDA to GPIO21, SCL to GPIO22, VCC to 5V, GND to GND on the WROVER (COM6). Double-check the physical header position against the GPIO number; header positions are not GPIO numbers on this board.
2. Make sure no serial monitor holds COM6.
3. Run from `Main-Controller`: `$PIO run -e main-controller -t upload`
4. Run: `$PIO device monitor -p COM6 -b 115200`

Expected in the log:

```
I (...) EspI2cPort: I2C0 ready, SDA=21 SCL=22, 100000 Hz
I (...) MainController: sent RUN 1
```

and no `display ... :` warnings. Expected on the display: row 0 reads `VMaaS`; row 1 scrolls `Display smoke test - UART link to Motorcontrol` continuously at about 3 characters per second; the backlight steps red, green, blue, white every 2 s. The UART log lines (ACK/DONE from Motorcontrol on COM7) are unchanged.

If the backlight cycles but the text is blank, the module is on 3.3 V; move VCC to 5 V.
If the log shows `display init failed: I2cWrite`, check SDA/SCL wiring and that VCC is connected; the driver keeps running without the display as designed.

- [ ] **Step 7: Run the host tests one final time**

Run from `shared/vmaas-display`: `$PIO test -e native`
Expected: all five folders PASS.

- [ ] **Step 8: Verify (no commit)**

Run `git status`. Expected changes: new `shared/vmaas-display/`, modified `Main-Controller/src/pins.h`, `config.h`, `main.cpp`, `Doxyfile`. Tell the owner the feature is complete, hardware-verified, and ready to commit.

---

## Self-review notes

- Spec section 3 (hardware, addresses, init, registers): Task 2 (`begin`, constants), Task 6 (README), Task 7 (pins/config).
- Spec section 4 (layout): Task 1 scaffold, Task 6 README, Task 7 Doxyfile.
- Spec section 5 (API): declaration complete in Task 2; bodies in Tasks 2-5.
- Spec section 6.1 overflow modes: Task 4 (Truncate, Wrap), Task 5 (Scroll). One refinement: the spec says a filled row leaves the cursor "at column 15"; the implementation tracks `col_ == 16` meaning "row full", so a following Truncate print writes nothing. Visible behaviour is identical and it avoids overwriting column 15.
- Spec section 6.2 protection: Task 5 tests `test_truncate_on_scrolling_row_is_rejected_without_writes`, `test_wrap_into_scrolling_row1_is_rejected_before_any_write`, `test_scroll_on_scrolling_row_replaces_text`, `test_stop_scroll_freezes_and_unprotects`, `test_clear_row_and_clear_stop_scrolling`, `test_tick_ignores_i2c_failure_and_retries_next_step`.
- Spec section 6.3 begin: Task 2 tests cover v5-first probe, v4 fallback, neither found, LCD failure.
- Spec section 6.4 validation: Tasks 3-5.
- Spec section 7 EspI2cPort: Task 6.
- Spec section 8 integration: Task 7, including the `RgbChipNotFound` still-usable rule.
- Spec section 9 tests: all bullets map to named tests above.
