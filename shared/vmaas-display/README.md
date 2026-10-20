# vmaas-display

Driver for the 16x2 I2C character displays Main-Controller can carry, picked
at boot by `detect_lcd()`:

- Seeed **Grove-LCD RGB Backlight** (`GroveLcdRgb`): LCD + RGB backlight.
- **1602A behind a PCF8574 I2C backpack** (`Pcf8574Lcd`): backlight on/off only.
  Any HD44780-compatible 16x2 module works; tested on the bench with a
  generic blue 1602A and a Tinsharp TC1602A-21T(R)(3) (ST7066U controller).

Both share `CharLcd`, which owns the cursor, overflow and marquee logic, so
text looks the same on either. Pure C++17 core with host tests.

## Wiring (Main-Controller, ESP32-WROVER)

| Display | ESP32  | Note |
|---------|--------|------|
| SDA     | GPIO21 | ESP32 default I2C SDA |
| SCL     | GPIO22 | ESP32 default I2C SCL |
| VCC     | 5V     | Grove v4.0 and the 1602A need 5 V. Grove v5.0 can take both 5V and 3.3V. |
| GND     | GND    | |

## Detection

`detect_lcd(port)` probes (address only, no data) in this order and the first
that answers wins:

| Address | Display |
|---------|---------|
| `0x3E`  | Grove-LCD RGB |
| `0x27`  | PCF8574 backpack (A0-A2 open) |
| `0x3F`  | PCF8574A backpack (A0-A2 open) |

## Grove-LCD RGB

### Devices on the module

| Device    | Address | Role |
|-----------|---------|------|
| AiP31068L | `0x3E`  | HD44780-compatible LCD controller |
| PCA9633   | `0x62`  | RGB backlight, v4.0 |
| SGM31323  | `0x30`  | RGB backlight, v5.0 (auto-detected) |

### LCD command reference

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

### RGB registers

PCA9633 (`0x62`): MODE1 `0x00`=`0x00`, LEDOUT `0x08`=`0xFF`, MODE2 `0x01`=`0x20`;
red `0x04`, green `0x03`, blue `0x02`.

SGM31323 (`0x30`): `0x00`=`0x07`, `0x04`=`0x15`; red `0x06`, green `0x07`, blue `0x08`.

## 1602A + PCF8574 backpack

The backpack is an 8-bit port expander. Every byte written to it sets its
eight pins at once:

| Pin | P7-P4 | P3        | P2 | P1 | P0 |
|-----|-------|-----------|----|----|----|
| LCD | D7-D4 | backlight | EN | RW | RS |

So the HD44780 runs in 4-bit mode. Each nibble is clocked in by three
expander bytes, `data`, `data|EN`, `data`; one HD44780 byte is six. RW stays
low (the busy flag is never read); the ~90 us an I2C byte takes at 100 kHz
covers every command except clear, which gets its own 2 ms. A run of text
goes out as one I2C transfer.

Init: wait 50 ms, nibble `0x3`, wait 5 ms, nibble `0x3`, wait 1 ms, nibble
`0x3`, wait 1 ms, nibble `0x2` (now 4-bit), then `0x28`, `0x0C`, `0x01`,
wait 2 ms, `0x06`. The backlight bit is set throughout.

`set_rgb(0, 0, 0)` turns the backlight off; any other colour turns it on.
Contrast is the pot on the backpack; with it wrong the display shows nothing
or a row of boxes even though every write succeeds.

On the bench: the 2-pin header on the backpack is the backlight jumper (no
cap, no light), and most backpacks carry 4.7 kOhm pull-ups (`472`) from
SDA/SCL to their 5 V VCC, which puts 5 V on the ESP32's pins.

## Usage

```cpp
#include "esp_i2c_port.h"
#include "grove_lcd_rgb.h"
#include "pcf8574_lcd.h"
#include "lcd_detect.h"

vmaas::EspI2cPort i2c(I2C_NUM_0, 21, 22, 100000);
vmaas::GroveLcdRgb grove(i2c);
vmaas::Pcf8574Lcd pcf(i2c);
vmaas::CharLcd* lcd = &grove;

i2c.begin();
const vmaas::DetectedLcd found = vmaas::detect_lcd(i2c);
vmaas::LcdError err = vmaas::LcdError::NotInitialized;
if (found.kind == vmaas::LcdKind::Grove) err = grove.begin();
if (found.kind == vmaas::LcdKind::Pcf8574) { lcd = &pcf; err = pcf.begin(found.addr); }
if (err != vmaas::LcdError::None)
    ESP_LOGW(TAG, "display %s: %s", vmaas::to_string(found.kind), vmaas::to_string(err));

lcd->print_at(0, 0, "VMaaS");
lcd->print_at(0, 1, "A long marquee that scrolls", vmaas::Overflow::Scroll);
lcd->set_rgb(0, 128, 255);   // colour on Grove, "on" on the PCF8574

while (true) {
    lcd->tick(now_ms());   // advances scrolling rows; e.g. xTaskGetTickCount() * portTICK_PERIOD_MS
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
- `begin()` is per backend (`Pcf8574Lcd::begin()` takes the address); everything else is on `CharLcd`.

## Tests

```
pio test -e native
```

Runs the Unity suites in `test/` on the PC (PlatformIO `native`). No hardware
is involved: the driver writes through `FakePort` (`test/fake_port.h`), which
records every I2C write, probe and delay so the tests assert the exact bytes
the display would receive. Each test function carries a one-line comment
saying what it proves. The Grove suites below predate `CharLcd` and run
unchanged against it.

| Suite | What it covers | Tests |
|-------|----------------|-------|
| `test_detect`     | Probe order 0x3E, 0x27, 0x3F; first answer wins; no writes; `to_string(LcdKind)` | 5 |
| `test_pcf8574`    | 4-bit init nibbles and delays, address, nibble/EN/RS bytes, backlight bit in every byte and `set_rgb()` on/off, shared Truncate and scroll through this backend, errors | 11 |
| `test_lcd_error`  | `LcdError` values and `to_string()` names | 3 |
| `test_begin`      | Power-up sequence bytes and delays, backlight chip detection (v5.0 probed before v4.0), degraded modes, `ready()`, calls before `begin()` | 8 |
| `test_cursor_rgb` | DDRAM addressing, `clear()`, `clear_row()`, `display()`, colour registers per chip, validation and I2C errors | 11 |
| `test_print`      | Truncate and Wrap column math, cursor tracking, `print_at()`, validation before any write | 15 |
| `test_scroll`     | Marquee window, padding and wrap-around, `tick()` timing and uint32 wrap, independent rows, printing onto a scrolling row (release + blank), `stop_scroll()` | 21 |

Run one suite with `pio test -e native -f test_scroll`.
