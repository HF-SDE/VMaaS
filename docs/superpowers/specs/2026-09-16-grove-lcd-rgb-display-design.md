# Grove-LCD RGB Backlight Display Driver for Main-Controller

**Date:** 2026-09-16
**Status:** Implemented 2026-09-16 (58 host tests, firmware built and flashed; hardware check pending until the display is wired). See section 11 for deviations.
**Scope:** Firmware only. New shared library `shared/vmaas-display/`, small
changes in `Main-Controller/`.

## 1. Goal

Give Main-Controller a reusable driver for the Seeed Grove-LCD RGB Backlight
v4.0 (16x2 character LCD with an RGB backlight, both on I2C). The first
consumer is a smoke test in `Main-Controller/src/main.cpp` that proves the
wiring and the driver work. The end goal is a customer-facing UI (product
selection, price, payment flow), so the API is designed for that even though
the UI itself is out of scope here.

Main-Controller runs ESP-IDF 6.1, not Arduino, so Seeed's Arduino library
cannot be used. The driver is written from the datasheets and Seeed's library
as reference.

## 2. Non-goals (v1)

- Any UI state machine, product selection or payment flow.
- Input devices (buttons, keypad).
- Custom characters (CGRAM). The API leaves room for it; nothing is built.
- Coupling to MotorClient events. The smoke test shows static and scrolling
  text and cycles the backlight only.
- Non-blocking init. `begin()` blocks for roughly 60 ms during the LCD
  power-up sequence. That is acceptable at boot.

## 3. Hardware

### 3.1 Wiring (Main-Controller, ESP32-WROVER on COM6)

| Grove pin | ESP32 pin | Note |
|-----------|-----------|------|
| SDA       | GPIO21    | ESP32 default I2C SDA. Free on WROVER. |
| SCL       | GPIO22    | ESP32 default I2C SCL. Free on WROVER. |
| VCC       | 5V (VIN)  | Must be 5 V. At 3.3 V the backlight works but the text is invisible. |
| GND       | GND       | |

I2C runs at 100 kHz (standard mode). ESP32 internal pull-ups are enabled; the
module has no pull-ups of its own, and ESP32 3.3 V logic drives it reliably in
practice.

GPIO16/17 remain reserved for PSRAM on the WROVER and GPIO32/33 for the UART
link to Motorcontrol (see `Main-Controller/src/pins.h`).

### 3.2 I2C devices on the module

| Device | Address | Role |
|--------|---------|------|
| AiP31068L | `0x3E` | HD44780-compatible LCD controller, I2C front end |
| PCA9633   | `0x62` | RGB backlight PWM driver on v4.0 |
| SGM31323  | `0x30` | RGB backlight PWM driver on v5.0 (auto-detected, see 6.3) |

### 3.3 LCD controller protocol (AiP31068L)

Every transfer to `0x3E` starts with a control byte:

| Control byte | Meaning |
|--------------|---------|
| `0x80` | Next byte is a command (RS=0) |
| `0x40` | Following bytes are display data (RS=1); several may follow |

Commands used:

| Command | Byte | Notes |
|---------|------|-------|
| Function Set | `0x28` | 4-bit-style flag irrelevant over I2C; 2 lines, 5x8 font. Sent twice during init. |
| Display Control | `0x0C` | Display on, cursor off, blink off |
| Display Control | `0x08` | Display off (backlight unaffected) |
| Clear Display | `0x01` | Needs ~2 ms afterwards |
| Entry Mode Set | `0x06` | Increment cursor, no shift |
| Set DDRAM Address | `0x80 \| addr` | Row 0: `addr = col`; row 1: `addr = 0x40 + col` |

Init sequence (from the datasheet and Seeed's library):

1. wait 50 ms after power-up
2. Function Set `0x28`, wait 5 ms
3. Function Set `0x28`, wait 1 ms
4. Display Control `0x0C`
5. Clear Display `0x01`, wait 2 ms
6. Entry Mode Set `0x06`

### 3.4 RGB backlight registers

PCA9633 (`0x62`, v4.0):

| Register | Value | Meaning |
|----------|-------|---------|
| `0x00` MODE1  | `0x00` | Normal mode |
| `0x08` LEDOUT | `0xFF` | All outputs PWM-controlled |
| `0x01` MODE2  | `0x20` | Output change on ACK |
| `0x04` PWM2   | red    | |
| `0x03` PWM1   | green  | |
| `0x02` PWM0   | blue   | |

SGM31323 (`0x30`, v5.0):

| Register | Value | Meaning |
|----------|-------|---------|
| `0x00` | `0x07` | Enable outputs |
| `0x04` | `0x15` | PWM mode |
| `0x06` | red    | |
| `0x07` | green  | |
| `0x08` | blue   | |

Each register write is a two-byte transfer `{register, value}`.

## 4. Library layout

```
shared/vmaas-display/
  library.json                     name "vmaas-display"
  platformio.ini                   [env:native] Unity host tests
  README.md                        wiring, addresses, command reference, usage
  src/lcd_port.h                   LcdPort interface
  src/lcd_error.h                  LcdError enum + to_string()
  src/grove_lcd_rgb.h / .cpp       driver, pure C++17, no ESP calls
  src/esp_i2c_port.h / .cpp        LcdPort on ESP-IDF i2c_master, #ifdef ESP_PLATFORM
  test/test_grove_lcd_rgb/test_main.cpp
```

It mirrors `shared/vmaas-protocol`: `library.json` with `frameworks: "*"`
and `platforms: "*"`, a `native` test environment with
`build_flags = -std=c++17 -Wall -Wextra`, `.pio` ignored. Main-Controller
already has `lib_extra_dirs = ../shared`, so the library is picked up by
`#include`. The root `Doxyfile` gets `shared/vmaas-display/src` added to
`INPUT`.

All public headers carry Doxygen comments in the same style as the protocol
library (Javadoc blocks, `@brief`, `@param`, `@return`, `@warning`).

## 5. Public API

Everything lives in `namespace vmaas`.

### 5.1 LcdPort

The driver never touches I2C directly. It writes through this interface,
which also provides the delays the init sequence needs:

```cpp
class LcdPort
{
public:
    virtual ~LcdPort() = default;
    /// Write len bytes to the 7-bit I2C address. Return false on NAK/timeout.
    virtual bool write(uint8_t addr, const uint8_t* data, size_t len) = 0;
    /// Block for ms milliseconds.
    virtual void delay_ms(uint32_t ms) = 0;
};
```

`EspI2cPort` implements it on ESP-IDF (section 7). Tests use a `FakePort`
that records every `(addr, bytes)` and every delay, and can be told to fail
the next write.

### 5.2 LcdError

```cpp
enum class LcdError : uint8_t
{
    None = 0,
    NotInitialized,   ///< begin() not called, or it failed
    InvalidArgument,  ///< col/row outside 16x2, nullptr text, text too long for the scroll buffer
    I2cWrite,         ///< the port reported a failed write (NAK, timeout, display unplugged)
    RgbChipNotFound,  ///< neither 0x62 (v4.0) nor 0x30 (v5.0) answered during begin()
};

const char* to_string(LcdError e);
```

`None` means success. The library never logs; the caller logs using
`to_string()`.

### 5.3 Overflow

```cpp
enum class Overflow : uint8_t
{
    Truncate,  ///< cut at the last column of the row
    Wrap,      ///< continue on the next row from column 0; cut at the end of row 1
    Scroll     ///< marquee inside the window from the cursor column to column 15
};
```

### 5.4 GroveLcdRgb

```cpp
class GroveLcdRgb
{
public:
    static constexpr uint8_t COLS = 16;
    static constexpr uint8_t ROWS = 2;
    static constexpr size_t  SCROLL_BUFFER = 64;   ///< max text length for Scroll, excluding padding

    explicit GroveLcdRgb(LcdPort& port);

    LcdError begin();                                  ///< init LCD and RGB chip, backlight white
    LcdError clear();                                  ///< clear display, home cursor, stop all scrolling
    LcdError clear_row(uint8_t row);                   ///< write 16 spaces, stop scrolling on that row
    LcdError set_cursor(uint8_t col, uint8_t row);
    LcdError print(const char* text, Overflow mode = Overflow::Truncate);
    LcdError print_at(uint8_t col, uint8_t row, const char* text,
                      Overflow mode = Overflow::Truncate);   ///< set_cursor + print
    LcdError stop_scroll(uint8_t row);                 ///< leave the currently shown slice in place
    void     tick(uint32_t now_ms);                    ///< advance scrolling rows; call from the main loop
    void     set_scroll_interval(uint32_t ms);         ///< default 300 ms per character
    LcdError set_rgb(uint8_t r, uint8_t g, uint8_t b);
    LcdError display(bool on);                         ///< text on/off; backlight unchanged
};
```

The driver tracks the cursor position itself (`col_`, `row_`) so `print()`
knows how many columns remain. It is not a general HD44780 driver: 16x2 is
fixed.

## 6. Behaviour

### 6.1 print() and the three overflow modes

Let `remaining = COLS - col` on the current row.

- **Truncate:** write at most `remaining` characters. The cursor ends after
  the last written character (or stays at column 15 if the row was filled).
- **Wrap:** write up to `remaining` characters on the current row. If text is
  left and the current row is 0, set the cursor to (0, 1) and write up to 16
  more. Anything left after that is dropped. On row 1, Wrap behaves like
  Truncate. Wrap is software wrap: the controller's own DDRAM wrap happens
  after 40 characters and is never relied upon.
- **Scroll:** if the text fits in the window (`strlen(text) <= remaining`)
  it is written once and the row does not scroll. Otherwise the driver
  stores the text plus three spaces of padding in the row's scroll buffer,
  records `window_col = col` and `window_width = remaining`, draws offset 0
  immediately, and marks the row as scrolling. Every `scroll_interval` ms,
  `tick()` advances the offset by one character with wrap-around and redraws
  the window. Row 0 and row 1 scroll independently. Text longer than
  `SCROLL_BUFFER` is rejected with `InvalidArgument` before anything is
  written.

Only the cells the text covers are written. Other cells on the same row and
the other row are untouched, so callers can update a price field without
redrawing the label.

### 6.2 Printing onto a scrolling row replaces the marquee

Changed 2026-09-16 (owner decision; the original design rejected such prints
with a `RowScrolling` error, which no longer exists).

- Any `print()` or `print_at()` that lands on a scrolling row first stops the
  marquee and blanks the window it occupied (cursor to the window start, then
  `window_width` spaces), then repositions and writes the new text. No tail
  of the old text stays visible.
- For Wrap that spills onto row 1, a marquee on row 1 is released too. All
  releases happen before the first byte of new text, so the display is never
  half updated.
- `print(…, Scroll)` on a scrolling row follows the same rule: old window
  blanked, new marquee drawn from offset 0.
- Argument validation still precedes every write, so a rejected print leaves
  a running marquee untouched.
- `stop_scroll(row)` stops the marquee and leaves the visible slice as is.
- `clear()` stops scrolling on both rows. `clear_row(row)` stops it on that
  row.
- `tick()` is `void`. A failed I2C write during a tick is ignored; the next
  tick tries again.

### 6.3 begin()

1. LCD init sequence from section 3.3. Any failed write returns `I2cWrite`
   and leaves the driver uninitialised (every later call returns
   `NotInitialized`).
2. RGB chip detection: write the v5.0 init (`0x30`). If that is acknowledged,
   remember v5.0 registers. Otherwise write the v4.0 init (`0x62`). If neither
   is acknowledged, the driver is still marked initialised (text works) but
   `begin()` returns `RgbChipNotFound`, and every later `set_rgb()` returns
   the same error.
3. On success set the backlight to white and return `None`.

### 6.4 Argument validation

`set_cursor`, `clear_row`, `stop_scroll` and `print_at` return
`InvalidArgument` for `col >= 16` or `row >= 2`. `print` returns
`InvalidArgument` for a `nullptr` text. Validation happens before any I2C
write.

## 7. EspI2cPort

```cpp
class EspI2cPort : public LcdPort
{
public:
    EspI2cPort(i2c_port_num_t port, int sda_pin, int scl_pin, uint32_t clock_hz = 100000);
    void begin();   ///< create the master bus; ESP_ERROR_CHECK, aborts on misconfiguration
    bool write(uint8_t addr, const uint8_t* data, size_t len) override;
    void delay_ms(uint32_t ms) override;
};
```

- Uses ESP-IDF 6.1's `driver/i2c_master.h` (the legacy `driver/i2c.h` is
  deprecated).
- `begin()` calls `i2c_new_master_bus()` with internal pull-ups enabled.
  Misconfiguration is a programming error and aborts, like `UartBus::begin()`.
- `write()` lazily creates one `i2c_master_dev_handle_t` per distinct address
  (at most three are ever used) and calls `i2c_master_transmit()` with a
  50 ms timeout. It returns `false` on any error so an unplugged display
  never resets the board.
- `delay_ms()` uses `vTaskDelay(pdMS_TO_TICKS(ms))`, rounding up to at least
  one tick.

Compiled only under `#ifdef ESP_PLATFORM`, like `uart_bus.cpp`.

## 8. Main-Controller integration (smoke test)

- `pins.h`: add `I2C_SDA = 21`, `I2C_SCL = 22` with the same doc style.
- `config.h`: add `i2c_clock_hz = 100000`.
- `main.cpp` keeps the UART smoke test and adds the display beside it:
  - `EspI2cPort i2c(I2C_NUM_0, Pins::I2C_SDA, Pins::I2C_SCL, Config::i2c_clock_hz);`
    and `GroveLcdRgb lcd(i2c);` in the anonymous namespace, next to `bus`
    and `motor`.
  - After `i2c.begin()` and `lcd.begin()`: row 0 shows `VMaaS` (Truncate),
    row 1 shows `Display smoke test - UART link to Motorcontrol` (Scroll).
  - The backlight cycles red, green, blue, white every 2 s in step with the
    RUN command. `lcd.tick(now_ms)` runs every loop iteration, with `now_ms`
    derived from `xTaskGetTickCount()`.
  - If `lcd.begin()` returns anything but `None`, log it once with
    `to_string()` and keep running. The display must never take the UART
    test down. `RgbChipNotFound` still counts as usable: text is shown and
    the colour cycle is skipped. Any other error disables all later display
    calls (`display_ok = false`).

Manual verification on COM6: text readable on both rows, row 1 scrolling
smoothly, backlight cycling, UART smoke test unchanged in the log.

## 9. Testing

Host tests in `shared/vmaas-display/test/test_grove_lcd_rgb/`, run with
`pio test -e native` from the library directory. `FakePort` records writes and
delays and can fail the next N writes.

Covered:

- **Init sequence** byte for byte: `0x3E` receives `{0x80,0x28}`,
  `{0x80,0x28}`, `{0x80,0x0C}`, `{0x80,0x01}`, `{0x80,0x06}` with delays 50,
  5, 1, 2 ms at the right places; RGB detection tries `0x30` first, then
  `0x62`, then writes white.
- **Cursor addresses:** (0,0) gives `{0x80,0x80}`, (5,1) gives `{0x80,0xC5}`;
  (16,0) and (0,2) return `InvalidArgument` with no writes.
- **Truncate:** 20 chars at (0,0) write exactly 16 data bytes.
- **Wrap:** 20 chars at (0,0) write 16 on row 0, a cursor set to (0,1), then
  4 more; 20 chars at (0,1) write 16 and drop the rest.
- **Scroll:** text that fits is written once and `tick()` never writes;
  longer text draws offset 0, `tick()` before the interval writes nothing,
  after it redraws the window shifted by one, and the offset wraps to 0 after
  `len + 3` steps. Two rows scroll independently. Text over 64 chars returns
  `InvalidArgument`.
- **Replace rules:** Truncate on a scrolling row emits window-blank, cursor,
  text and stops the marquee; only the marquee window is blanked; Wrap that
  spills releases row 1 before writing row 0; a non-spilling Wrap leaves row
  1 scrolling; `stop_scroll`, `clear_row` and `clear` stop marquees without
  printing; a rejected `print_at` on a scrolling row writes nothing and keeps
  it running.
- **Error paths:** methods before `begin()` return `NotInitialized`; a failing
  port makes `begin()` return `I2cWrite`; a port that NAKs both RGB addresses
  makes `begin()` return `RgbChipNotFound` while `print` still works and
  `set_rgb` returns `RgbChipNotFound`; a failing write mid-`print` returns
  `I2cWrite` and stops writing.
- **to_string:** every enumerator maps to a distinct non-empty string.

No automated hardware test. Firmware build for `main-controller` must
succeed, and the manual check in section 8 is the acceptance test.

## 10. Open items for later phases

- Custom characters (CGRAM) for icons such as a coin or arrow.
- A UI layer (screens, state machine, input handling) for the end goal.
- Non-blocking `begin()` if boot time ever matters.

## 11. Implementation deviations (2026-09-16)

Recorded after implementation and review; the code is authoritative for these.

- **Filled row tracking.** Section 6.1 says the cursor "stays at column 15" when a
  row is filled. The driver tracks `col_ == 16` meaning "row full", so a
  following Truncate print writes nothing instead of overwriting column 15.
  Visible behaviour is otherwise identical.
- **Backlight configuration failure.** Section 6.3 only names `RgbChipNotFound`.
  If a backlight chip acknowledges its probe but a follow-up configuration write
  fails, `begin()` returns `I2cWrite` while the LCD part stays initialised and
  the detected chip stays selected, so `set_rgb()` can retry.
- **`ready()` accessor.** `bool GroveLcdRgb::ready() const` was added so a
  caller can tell "LCD dead" from "backlight problem" after `begin()`.
  Main-Controller gates text on `ready()` and the colour cycle on
  `begin() == None`.
- **Scroll on a full row.** `print(text, Scroll)` with no columns left on the
  row writes nothing, does not start a marquee and does not protect the row.
- **`tick()` moves the cursor.** Redrawing a marquee repositions the cursor;
  callers must use `print_at()` or `set_cursor()` after a tick. A failed redraw
  is skipped and the next step draws the following offset.
- **`print_at()` validation.** All argument checks run before the cursor
  command is written, so a rejected `print_at()` performs no I2C write.
- **Replace instead of reject (owner decision, later on 2026-09-16).**
  `RowScrolling` was removed. Printing onto a scrolling row stops the marquee,
  blanks its window and writes the new text; see section 6.2.
- **`EspI2cPort::delay_ms()`** waits `pdMS_TO_TICKS(ms) + 1` ticks so the LCD
  timing guards are guaranteed with a 10 ms FreeRTOS tick.


## 12. Bus priming fix (2026-09-17)

**Symptom.** `GroveLcdRgb::begin()` returned `LcdError::I2cWrite` on every
boot, failing on its opening `CMD_FUNCTION_SET` to 0x3E. The display never came
up. This was assumed for two days to be a wiring or power fault.

**It was neither.** `tools/i2c-scan` established, in this order:

1. SDA and SCL idle high - the bus is electrically free.
2. Both chips answer: 0x3E (AiP31068L) and 0x62 (PCA9633, so this is a v4.0
   module). Wiring and power are fine.
3. The exact failing write succeeds in isolation.
4. The same write **as the bus's first transaction** returns
   `ESP_ERR_INVALID_RESPONSE`, and the identical write immediately after
   returns `ESP_OK`.

**Root cause.** Creating the bus switches SDA and SCL from high-impedance
inputs into open-drain I2C mode. The slave reads that transition's first START
as a glitch and does not acknowledge. Every transaction after the first
succeeds. This is a property of the bus, not of the display: any I2C device
that happened to be initialised first would hit it.

**Why it hid for so long.** The first version of the scan tool probed 112
addresses before attempting a write, so the probe had already absorbed the
glitch and the write succeeded. The fault was invisible precisely because the
diagnostic was thorough. Only reordering the tool - write first, scan second -
exposed it.

**Fix.** `EspI2cPort::begin()` now issues one throwaway
`i2c_master_probe(bus, 0x7F, 10)` immediately after `i2c_new_master_bus`.
0x7F is in the reserved range, so nothing answers and the result is discarded
by design; the point is that a START has been on the wire before any driver's
first real call.

The fix is in the transport, not in `GroveLcdRgb`, because that is where the
defect is. The 58 host tests are unaffected: `esp_i2c_port.cpp` is guarded by
`ESP_PLATFORM` and compiles to nothing on the host.

**Verified on COM6, 2026-09-17:** no `display init failed` line at boot, the
prompt and the live entry echo both render, and the two-second result hold
behaves as designed.
