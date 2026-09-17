# vmaas-keypad

Driver for the SparkFun COM-14662, a passive 4x3 matrix keypad (`1`-`9`, `0`,
`*`, `#`). The part has no driver chip and no supply pins: 12 switches share 7
signal lines, and each switch simply joins one row to one column. Everything
except `EspKeypadPort` is plain C++17 with no ESP-IDF dependency, so the scan
logic, the debounce and the ghosting rule all run as host tests on a PC.

## Wiring (Main-Controller, ESP32-WROVER on COM6)

| Header pin | ESP32 GPIO | Role |
|-----------|------------|------|
| 1 | GPIO14 | row 2 (`7 8 9`) |
| 2 | GPIO25 | column 1 |
| 3 | GPIO26 | row 0 (`1 2 3`) |
| 4 | GPIO27 | row 3 (`* 0 #`) |
| 5 | GPIO18 | column 2 |
| 6 | GPIO19 | row 1 (`4 5 6`) |
| 7 | GPIO23 | column 0 |

In key-map order: `KEYPAD_ROWS = {26, 19, 14, 27}`, `KEYPAD_COLS = {23, 25, 18}`.

SparkFun changed this part's pinout between revisions, so use the tool  `tools/keypad_discover.py` to measure what pins are what.

There is no VCC and no GND on the header. Every one of the seven wires is
signal.

## How the scan works

`tick()` drives one row low at a time and reads all three columns against the
ESP32's internal pull-ups, so an unpressed column reads high and a pressed one
reads low. One pass produces a 12-bit raw bitmap. Leaving a second row low
would let another switch pull the same column down and blur two keys into one,
which is why rows are restored high immediately.

Debounce happens in the time domain, not in hardware: a key's reported state
changes only once its raw state has held for `KEYPAD_DEFAULT_DEBOUNCE_MS`
(20 ms). The COM-14662's contacts are mechanical (10-150 ohm), and one press
produces a burst of edges over roughly 10-20 ms; without this, a single tap
would enter four digits.

`now_ms` is a parameter rather than a call into FreeRTOS. That one choice is
what lets the entire driver be tested against a fake clock, with no board and
no waiting.

`tick()` never blocks and never sleeps. On the board a dedicated task calls it
every 10 ms, because Main-Controller's main loop blocks up to 50 ms inside
`bus.poll()` and would otherwise drop fast taps.

Ten rather than five: with `CONFIG_FREERTOS_HZ=100` one tick is 10 ms, and
`pdMS_TO_TICKS(5)` truncates to zero, which makes `xTaskDelayUntil` assert.
One tick is the floor a task can run at without raising the system tick rate,
and it is still five times faster than the `bus.poll()` it exists to outrun.

## One key at a time

The matrix has no diodes. With three switches closed in an L shape, current
reaches a fourth intersection and the scan reads a key nobody touched. This is
called ghosting.

Rather than detect phantoms, the driver reports **at most one key**: while a
key is held, later presses are ignored until it is released. A ghost can only
appear once three keys are down, so it can never be the first, and the rule
removes the problem entirely. It also matches how a vending keypad is used.

## Usage

```cpp
vmaas::EspKeypadPort port;
vmaas::Keypad keypad(port);
const vmaas::KeypadError err = keypad.begin(Pins::KEYPAD_ROWS, 4, Pins::KEYPAD_COLS, 3);
if (err != vmaas::KeypadError::None)
    ESP_LOGE(TAG, "keypad init failed: %s", vmaas::to_string(err));

// in the scan task, every 10 ms:
keypad.tick(now_ms());

// wherever events are consumed:
vmaas::KeyEvent ev;
while (keypad.next_event(ev))
    entry.handle(ev);
```

`begin()` refuses a null array, a negative pin, a duplicate pin (which means
two lines are shorted on the board) and a count that does not match the 4x3
key map. Nothing is logged.

## Tests

Run from this directory: `pio test -e native`

| Folder | Covers |
|--------|--------|
| `test_keypad_error` | `KeypadError::None` is 0, every code has a distinct name, out-of-enum values are named not crashed |
| `test_begin` | Pin validation (counts, duplicates, negatives, nulls), port failure, `tick()`/`next_event()` safe before `begin()` |
| `test_scan` | All 12 switches map to the right character, one pass samples the whole matrix, an idle matrix stays silent |
| `test_debounce` | A 15 ms chatter burst is one press, nothing accepted a millisecond early, holds do not repeat, release fires once, timestamps are acceptance times, the window is configurable |
| `test_multikey` | Second key ignored while the first is held, ignored keys emit nothing on release, the phantom fourth key is never reported, the fake really ghosts, queue overflow drops and counts |

`test_multikey` asserts that `FakeKeypadPort` genuinely produces a phantom
key. Without that check, the ghosting test could pass because the fake was too
simple to reproduce the problem in the first place.
