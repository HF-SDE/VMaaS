# vmaas-display

Driver for the Seeed **Grove-LCD RGB Backlight** (16x2 character LCD with an
RGB backlight, both over I2C). Used by Main-Controller. Pure C++17 core with
host tests.

## Wiring (Main-Controller, ESP32-WROVER)

| Grove | ESP32  | Note |
|-------|--------|------|
| SDA   | GPIO21 | ESP32 default I2C SDA |
| SCL   | GPIO22 | ESP32 default I2C SCL |
| VCC   | 5V     | Must be 5 V on v4.0. V5.0 can take both 5V and 3.3V. |
| GND   | GND    | |

## Devices on the module

| Device    | Address | Role |
|-----------|---------|------|
| AiP31068L | `0x3E`  | HD44780-compatible LCD controller |
| PCA9633   | `0x62`  | RGB backlight, v4.0 |
| SGM31323  | `0x30`  | RGB backlight, v5.0 (auto-detected) |

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
    lcd.tick(now_ms());   // advances scrolling rows; e.g. xTaskGetTickCount() * portTICK_PERIOD_MS
    // ...
}
```

### Overflow modes

- `Truncate` (default): cut at column 15 of the current row.
- `Wrap`: continue on row 1 from column 0; cut at the end of row 1.
- `Scroll`: marquee in the window from the cursor column to column 15, one
  character per `set_scroll_interval()` (default 300 ms). Text up to 64 chars.

### Rules

- Only the cell's a text covers are written. Update a field with
  `print_at(col, row, text)`; use `clear_row(row)` to blank a row without
  flicker on the other one.
- Printing onto a scrolling row replaces the marquee: the marquee is stopped,
  the window it occupied is blanked, and the new text is written. For `Wrap`
  this also applies to the row it spills onto, and every release happens
  before the first byte of new text. To stop a marquee without writing, use
  `stop_scroll(row)`, `clear_row(row)` or `clear()`.
- The library never logs. Check the returned `LcdError` and use `to_string()`.
- After `begin()` and `ready()` tells whether text works even when the return value reports a backlight problem (`RgbChipNotFound` or `I2cWrite`).

## Tests

```
pio test -e native
```

Runs the Unity suites in `test/` on the PC (PlatformIO `native`). No hardware
is involved: the driver writes through `FakePort` (`test/fake_port.h`), which
records every I2C write and delay so the tests assert the exact bytes the
display would receive. Each test function carries a one-line comment saying
what it proves.

| Suite | What it covers | Tests |
|-------|----------------|-------|
| `test_lcd_error`  | `LcdError` values and `to_string()` names | 3 |
| `test_begin`      | Power-up sequence bytes and delays, backlight chip detection (v5.0 probed before v4.0), degraded modes, `ready()`, calls before `begin()` | 8 |
| `test_cursor_rgb` | DDRAM addressing, `clear()`, `clear_row()`, `display()`, colour registers per chip, validation and I2C errors | 11 |
| `test_print`      | Truncate and Wrap column math, cursor tracking, `print_at()`, validation before any write | 15 |
| `test_scroll`     | Marquee window, padding and wrap-around, `tick()` timing and uint32 wrap, independent rows, printing onto a scrolling row (release + blank), `stop_scroll()` | 21 |

Run one suite with `pio test -e native -f test_scroll`.
