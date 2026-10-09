# Keypad Matrix Driver and Slot Entry for Main-Controller

**Date:** 2026-09-17
**Status:** Implemented 2026-09-17. 53 host tests (25 `vmaas-keypad`,
28 `vmaas-entry`), firmware built and flashed (RAM 4.6%, Flash 19.3%).
Hardware verified on COM6 except the LCD, which is unrelated hardware that is
currently failing. See section 11 for deviations.
**Scope:** Firmware only. Two new shared libraries `shared/vmaas-keypad/` and
`shared/vmaas-entry/`, a bench tool `tools/keypad_discover.py`, and changes in
`Main-Controller/`.

## 1. Goal

Give Main-Controller a keypad so an operator can type a slot number and see it
on the Grove-LCD. The hardware is a SparkFun COM-14662, a passive 4x3 matrix
keypad (keys `1`-`9`, `0`, `*`, `#`) exposed on a 7-pin header with no driver
chip and no supply pins.

Two libraries come out of this, split by what they depend on:

- `shared/vmaas-keypad` turns GPIO into a stream of debounced `KeyEvent`s.
- `shared/vmaas-entry` turns `KeyEvent`s into an edit buffer and a decision
  (`Confirmed`, `Cancelled`, `TimedOut`). It touches no hardware at all.

`vmaas-entry` is deliberately hardware-free so the eventual purchase flow and
the simulator can reuse it unchanged.

## 2. Non-goals (v1)

- Sending the confirmed slot to Motorcontrol. `#` shows "Slot NN valgt" on the
  LCD and stops there. Wiring it to `DISPENSE` is the next piece of work.
- Payment, pricing, or any multi-screen UI.
- Key repeat on hold, long-press, or chords.
- Interrupt-driven wake. Rejected in section 4.2; a mains-powered vending
  machine with a lit LCD never sleeps.
- Reading pins from the LittleFS config. Main-Controller uses compile-time
  `pins.h`; only Motorcontrol got the config filesystem.

## 3. Hardware

### 3.1 The keypad

A passive 4x3 matrix: 12 switches across 7 lines, 4 rows and 3 columns. Each
switch connects exactly one row to one column. Contact resistance is 10-150
ohm, which is fine for digital reads but means mechanical bounce, so debounce
is mandatory.

**There is no VCC and no GND.** All 7 header pins are signal. Every ESP32 pin
used here is a normal GPIO.

### 3.2 Wiring (Main-Controller, ESP32-WROVER on COM6)

Header pins 1 through 7, left to right, are wired to:

| Header pin | ESP32 GPIO | Role (discovered 2026-09-17) |
|-----------|------------|------------------------------|
| 1 | GPIO14 | row 2 (`7 8 9`) |
| 2 | GPIO25 | column 1 |
| 3 | GPIO26 | row 0 (`1 2 3`) |
| 4 | GPIO27 | row 3 (`* 0 #`) |
| 5 | GPIO18 | column 2 |
| 6 | GPIO19 | row 1 (`4 5 6`) |
| 7 | GPIO23 | column 0 |

In key-map order: `KEYPAD_ROWS = {26, 19, 14, 27}`, `KEYPAD_COLS = {23, 25, 18}`.

The header order bears no relation to the matrix order, which is why the
provisional guess in this section's first draft (rows 14/25/26/27, columns
18/19/23) was wrong: GPIO25 is a column and GPIO19 is a row.

Excluded and why: 6-11 (flash), 16/17 (PSRAM on WROVER), 21/22 (Grove-LCD
I2C), 32/33 (UART to Motorcontrol), 0/2/5/15 (strapping pins), 34-39 (no
internal pull-ups).

Rows are driven as outputs, one low at a time. Columns are inputs with the
ESP32 internal pull-up enabled, so an unpressed column reads high and a
pressed one reads low.

### 3.3 The row/column split was discovered, not guessed

SparkFun states the pinout changed from the previous revision of this part,
and the datasheet PDF could not be read. Rather than guess, the mapping was
discovered on the bench with `tools/keypad_discover.py` on 2026-09-17; see
section 8. The result is in the table above.

This cost nothing, because a matrix is electrically symmetric: "row" and
"column" is a convention, not a property of the hardware. It also turned out
to be necessary rather than merely careful: two of the seven pins in the
provisional guess had the wrong role.

## 4. Architecture

```
GPIO
  |
  v
shared/vmaas-keypad        KeypadPort <- EspKeypadPort (real GPIO)
  Keypad::tick(now_ms)                <- FakeKeypadPort (tests)
  | KeyEvent{ key, type, at_ms }
  v
shared/vmaas-entry         no hardware dependency whatsoever
  SlotEntry::handle(ev), SlotEntry::tick(now_ms)
  | EntryState{ buffer, status }
  v
Main-Controller/src/main.cpp   draws buffer on LCD row 1, result on row 0
```

### 4.1 Port abstraction

`KeypadPort` is the seam between the driver and ESP-IDF, mirroring `LcdPort`
in `vmaas-display`:

```cpp
class KeypadPort {
public:
    virtual ~KeypadPort() = default;
    virtual KeypadError configure(const int* rows, size_t row_count,
                                  const int* cols, size_t col_count) = 0;
    virtual void drive_row(size_t row, bool level) = 0;
    virtual bool read_col(size_t col) = 0;   // true = high = not pressed
};
```

Everything that knows about ESP-IDF lives in `EspKeypadPort`. Everything that
knows about keypads lives in `Keypad` and runs on a PC under `FakeKeypadPort`.

### 4.2 Scanning strategy: dedicated FreeRTOS task

`Keypad::tick(now_ms)` performs exactly one scan pass and returns; it never
blocks and never sleeps. A dedicated task calls it every 10 ms (see deviation
3) and pushes finished events into a FreeRTOS queue that the main loop drains
when it can.

A task is used rather than calling `tick()` from the main loop because
`Main-Controller/src/main.cpp` blocks up to 50 ms per iteration in
`bus.poll(pdMS_TO_TICKS(50))`. A keypress lasts 80-200 ms, so polling from
that loop would mostly work but would drop fast taps and make debounce timing
coarse.

Interrupt-driven scanning was considered and rejected. On a passive matrix an
ISR can only report that *something* was pressed: identifying the key still
requires a full scan, bounce produces 10-50 interrupts per press so the
interrupt must be masked and debounced in time anyway, and an ESP-IDF ISR must
live in IRAM and defer all real work to a task. The result is the task-based
design plus an ISR on top, and the only payoff is power saved during sleep.

`now_ms` is a parameter rather than a call to `xTaskGetTickCount()` inside the
library, so the whole driver is testable against a fake clock.

### 4.3 Scan pass

For each row: drive that row low, leave the others high, read all 3 columns,
restore. A raw 12-bit key bitmap comes out. The bitmap is then debounced: a
key's reported state changes only after the raw state has held for
`DEBOUNCE_MS` (20 ms). Transitions produce `KeyEvent`s.

### 4.4 Multiple keys and ghosting

The matrix has no diodes, so three simultaneous presses can make a fourth key
read as pressed. The driver reports **at most one key at a time**: if more
than one key is down, the first one debounced stays reported and the others
are ignored until it is released. This sidesteps ghosting entirely and matches
how the keypad is actually used.

## 5. Public API

### 5.1 vmaas-keypad

```cpp
enum class KeyEventType { Pressed, Released };

struct KeyEvent {
    char key;               // '0'-'9', '*', '#'
    KeyEventType type;
    uint32_t at_ms;
};

enum class KeypadError { None, BadPinConfig, GpioInitFailed, PortUnavailable };
const char* to_string(KeypadError);

class Keypad {
public:
    explicit Keypad(KeypadPort& port);
    KeypadError begin(const int* rows, size_t row_count,
                      const int* cols, size_t col_count);
    void tick(uint32_t now_ms);
    bool next_event(KeyEvent& out);   // false when the internal queue is empty
};
```

Errors are returned, not thrown, matching `LcdError` in `vmaas-display`.
`begin()` rejects duplicate pins, negative pins, and row/column counts that do
not match the key map.

The key map is the standard telephone layout:

```
{ {'1','2','3'},
  {'4','5','6'},
  {'7','8','9'},
  {'*','0','#'} }
```

### 5.2 vmaas-entry

```cpp
enum class EntryStatus { Editing, Confirmed, Cancelled, TimedOut };

struct EntryState {
    char buffer[3];      // up to 2 digits, NUL-terminated
    EntryStatus status;
};

class SlotEntry {
public:
    explicit SlotEntry(uint8_t max_digits = 2, uint32_t timeout_ms = 10000);
    EntryState handle(const KeyEvent& ev);
    EntryState tick(uint32_t now_ms);   // drives the timeout
    EntryState state() const;
    void reset();
    bool slot_number(uint8_t& out) const;  // parses the buffer
};
```

`SlotEntry` reacts to `Pressed` events only and ignores `Released`.

## 6. Behaviour

### 6.1 Entry flow on the LCD

```
Row0: VMaaS - vaelg slot
Row1: > 1_

[2] -> Row1: > 12_
[*] -> Row1: > 1_
[#] -> Row0: Slot 12 valgt
```

- Digits append to the buffer and are echoed live on row 1.
- `*` deletes the last digit. On an empty buffer it yields `Cancelled`.
- `#` confirms and yields `Confirmed`.
- No key for `timeout_ms` (10 s) yields `TimedOut` and clears the buffer.
- Every keypress restarts the timeout.

### 6.2 Decision rules left open for the implementer

These have several defensible answers and are settled during implementation by
the project owner, not chosen for convenience:

- A third digit when the buffer already holds two: ignored, or shift left?
- `#` on an empty buffer: `Cancelled`, or no effect?
- Does `"07"` parse as slot 7, or is a leading zero rejected?

The scaffolding, signatures, and surrounding tests are written first; these
rules are filled in afterwards and their tests are then written to match.

## 7. Main-Controller integration

- `pins.h` gains `KEYPAD_ROWS[4]` and `KEYPAD_COLS[3]`.
- `config.h` gains `keypad_scan_interval_ms = 5`, `keypad_debounce_ms = 20`,
  `slot_entry_timeout_ms = 10000`.
- A new `keypad_task` scans at 5 ms and posts `KeyEvent`s to a queue of 16.
- The main loop drains the queue non-blockingly, feeds `SlotEntry`, calls
  `SlotEntry::tick()`, and redraws only when `EntryState` changes.
- The existing `MOTOR CONFIG ERR` screen keeps priority over the entry display.
- The 2-second `RUN 1` smoke test and the backlight cycle are removed; the
  display is now driven by the entry flow.
- The 2-second heartbeat itself stays, but sends `STATUS` (`0x12`) instead of
  `RUN 1`. Spinning a motor every two seconds was a smoke test, not intended
  behaviour, yet the link-health check has to survive: `MOTOR CONFIG ERR` is
  raised by the replies to that heartbeat, so removing it outright would leave
  the error screen permanently unreachable. `STATUS` takes no payload, starts
  no motor, and unlike RUN/STOP/CONFIG it is not refused under `CONFIG_ERROR`
  -- it answers `STATUS_REPLY` with state `ERROR`, which is the path
  `main.cpp` already handles.

## 8. Bench discovery of the pinout

`tools/keypad_discover.py` plus a discovery firmware build resolve section 3.3.

The firmware sets all 7 pins to input with pull-up, then repeatedly drives each
of the 7 low in turn and reads the other 6. When a key is held, exactly one
pin pair conducts. The tool prompts for `1, 2, 3, ..., 0, #` in order, records
the conducting pair per key, and then:

- classifies each pin as a row (appears in 4 pairs) or a column (3 pairs),
- derives the full header-pin to row/column mapping,
- prints a ready-to-paste `pins.h` block.

This mirrors `capture_serial.py` from the config work. If a wire is missing or
shorted, a pin appears in the wrong number of pairs and the tool reports that
instead of emitting a bad mapping.

## 9. Testing

Both libraries run as native host tests, as `vmaas-display` does.

**vmaas-keypad** (`FakeKeypadPort` with a scripted matrix and a fake clock):

- all 12 keys map to the right character,
- a 15 ms bounce burst produces exactly one `Pressed`,
- holding a key produces no repeat events,
- release produces exactly one `Released`,
- two keys down: only the first is reported; the second is ignored until the
  first is released,
- three keys down: no phantom fourth key is ever reported,
- `begin()` returns `BadPinConfig` for duplicate pins, negative pins, and
  wrong row/column counts,
- events arrive in press order and carry the correct `at_ms`.

**vmaas-entry** (pure logic, no fakes needed):

- digits accumulate and echo,
- `*` deletes the last digit,
- `*` on an empty buffer yields `Cancelled`,
- `#` with digits yields `Confirmed` and `slot_number()` parses it,
- the timeout fires and clears the buffer,
- each keypress restarts the timeout,
- `Released` events are ignored,
- the three rules from section 6.2, once decided.

**Hardware verification on COM6:** run the discovery build, confirm the
mapping, flash the real build, then type `1`, `2`, `#` and confirm the LCD
shows `> 1_`, `> 12_`, then `Slot 12 valgt`. Check that `*` deletes and that
the buffer clears after 10 s of inactivity.

## 10. Open items for later phases

- Send the confirmed slot to Motorcontrol as `DISPENSE`, and show its
  `STATUS_REPLY` or `NAK` on the LCD.
- Decide whether `#` should dispense directly or require a second press
  ("Slot 12 - tryk # igen"). Today `#` only draws text, so the question is
  moot; it becomes real the moment `#` makes a product fall. The shift-left
  rule means row 1 always shows exactly what will be confirmed, which argues
  that one press is enough — but a fumbled entry commits instantly.
- Validate the slot against Motorcontrol's slot config before dispensing.
- Reuse `vmaas-entry` in the simulator.

## 11. Implementation deviations (2026-09-17)

1. **`slot_number()` is a free function**, `bool slot_number(const EntryState&,
   uint8_t&)`, not a `SlotEntry` member as section 5.2 says. `handle()` returns
   a transient `EntryState` and the object resets itself immediately, so a
   member would parse a buffer that is already gone.

2. **The discovery firmware lives in its own project**, `tools/keypad-discover/`,
   not as a second environment in `Main-Controller`. Under `framework = espidf`
   PlatformIO builds `src/` as a CMake component and ignores
   `build_src_filter`, so two `app_main()` definitions in one `src/` tree
   cannot be separated. Section 8 assumed the filter would work.

3. **Scan interval is 10 ms, not 5 ms.** With `CONFIG_FREERTOS_HZ=100` a tick
   is 10 ms, so `pdMS_TO_TICKS(5)` truncates to 0 and `xTaskDelayUntil`
   asserts. This crashed on the first flash. The task now floors the period at
   one tick and logs if the configured value was unrepresentable. 10 ms is
   still five times faster than the 50 ms `bus.poll()` the task exists to
   outrun, and half the debounce window.

4. **The discovery tool's row/column test was inverted in section 8.** A row
   carries one key per column, so a row pin appears in 3 of the 12 pairs, not
   4; a column pin appears in 4. The captured hardware data was correct and
   the classification was fixed without re-running the bench.

5. **A two-second result hold was added** (`Config::slot_entry_result_hold_ms`).
   `SlotEntry` resets itself on `Confirmed`, so the next loop iteration hands
   `render()` an empty `Editing` state about 50 ms later and would overwrite
   "Slot 12 valgt" before it could be read. Typing during the hold ends it.

6. **Keypresses, cancellations and a boot self-check are logged.** The Grove-LCD
   is currently failing (`display init failed: I2cWrite`), and without these
   lines there is no way to tell a keypad fault from an untouched keypad. The
   self-check drives each row and logs the three column levels once at boot.

## 12. Hardware verification result (2026-09-17, COM6)

Verified from the serial log; the LCD could not be used.

| Check | Result |
|-------|--------|
| Boot self-check, nothing pressed | all columns high for all four rows |
| `7` `*` `*` | `entry cancelled` |
| `1` `2` `3` `#` | `slot 23 selected` - the shift-left rule, on hardware |
| `0` `7` `#` | `slot 7 selected` - the leading-zero rule, on hardware |
| `4` then idle | `key '4'` at 5444 ms, `entry timed out, clearing` at 15444 ms |
| Debounce | 14 presses, each logged exactly once, no doubles |
| Dropped events | none, with the main loop blocking 50 ms per iteration |

The display was failing when the table above was recorded. It was fixed the
same day (see `docs/superpowers/specs/2026-09-16-grove-lcd-rgb-display-design.md`
section 12) and the visual flow was then verified too:

| Check | Result |
|-------|--------|
| At rest | `VMaaS - vaelg slot` / `> _`, white backlight |
| `1` `2` `#` | row 1 echoes `> 1_`, `> 12_`, then `Slot 12 valgt` |
| Result hold | the confirmation stays up about 2 s before the prompt returns |

**Still not verified:** the `MOTOR CONFIG ERR` screen, which needs Motorcontrol
to report a bad slot configuration. It answers `state=0` (IDLE) on the bench.
