# Stepper Dispense, Firmware: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Motorcontrol drives DRV8825 stepper drivers over one shared STEP line and one nENABLE line per motor, dispensing a fixed number of pulses per `RUN`, while Main-Controller fails a paid sale whose `DONE` never arrives.

**Architecture:** A hardware-free `VendSequencer` in `shared/vmaas-motor` owns the dispense sequence (enable, settle one tick, pulse, disable, DONE) and is host-tested. A `StepGenerator` on Motorcontrol emits the pulses from a `gptimer` ISR so the UART stays alive during a vend. `config.json` moves to schema v2 with a required `motor.stepsPerVend` and a `pins[]` array per slot. `ConfigParam::RUN_TIME_MS` leaves the protocol. Main-Controller's `Purchase` gains a dispense timeout read from `timings.dispense_timeout_ms`.

**Tech Stack:** C++17, ESP-IDF 6.1 via PlatformIO 6.2 (`framework = espidf`), Unity host tests on `platform = native`, vendored cJSON.

**Spec:** `docs/superpowers/specs/2026-09-23-stepper-dispense-design.md`, which amends `docs/superpowers/specs/2026-09-22-slot-pin-wiring-design.md`. Read both.

## Global Constraints

- **Never commit.** The project owner forbids `git commit` entirely; a deny rule enforces it in `.claude/settings.json`. Every task ends with a **Verify** step, not a commit. Leave changes in the working tree.
- **nENABLE is active LOW.** Idle and boot state of every motor pin is HIGH. Any code that drives a motor pin LOW while nothing is vending is a bug.
- **One shared STEP line:** `Pins::STEP = 4` on Motorcontrol. Only `StepGenerator` touches it.
- **Step interval is a firmware constant:** `Config::STEP_INTERVAL_US = 312` in `Motorcontrol/src/config.h`. It is not read from any file and not sent over UART.
- **`stepsPerVend` has no firmware default.** It comes from `config.json` (`motor.stepsPerVend`, 1–65535, required). A file without it is a config error, like a file without `slots`.
- **`config.json` is v2 only.** The v1 `"pin"` scalar is rejected. No fallback branch.
- **Shared libraries stay hardware-free.** No `driver/*`, `esp_*`, `freertos/*` or `soc/*` includes in `shared/vmaas-motor`, `shared/vmaas-purchase`, `shared/vmaas-config` or `shared/vmaas-protocol`. They must compile and pass under `platform = native`.
- **`protocol.h` and `PROTOCOL.md` change in the same task.** That file requires it.
- **Slot numbers are 1-based** on the wire and in every file.
- **Code, comments and docs in English.** Doxygen `///<` for trailing member comments, `/** @brief */` for functions.
- **`docs/superpowers/**` is gitignored**, so this plan and its spec are intentionally untracked.
- **Plan A (`2026-09-22-slot-pin-wiring-a-backend-ui.md`) is being executed in another session.** Do not touch `backend/`, `admin-frontend/` or `shared/schemas`, `shared/types` from this plan. The backend/UI half of the spec gets its own plan once Plan A lands (see the end of this file).

---

## Toolchain notes (Windows host)

`pio` is not on the tool shell's PATH. Use the full path. WinLibs GCC is on the user PATH but Git Bash in this tool needs the prefix.

Git Bash:

```bash
export PATH="/c/Users/temp/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
PIO=/c/Users/temp/.platformio/penv/Scripts/pio.exe
PY=/c/Users/temp/.platformio/penv/Scripts/python.exe
```

PowerShell:

```powershell
$PIO = "C:\Users\temp\.platformio\penv\Scripts\pio.exe"
$PY  = "C:\Users\temp\.platformio\penv\Scripts\python.exe"
```

- Host tests: run from the library directory, e.g. `shared/vmaas-motor`: `$PIO test -e native` (all) or `$PIO test -e native -f test_sequencer` (one folder).
- Motorcontrol build: from `Motorcontrol`: `$PIO run -e controller-motor`. Upload: `-t upload` (COM7). Filesystem: `-t uploadfs`.
- Main-Controller build: from `Main-Controller`: `$PIO run -e main-controller`. Upload: `-t upload` (COM6). Filesystem: `-t uploadfs`.
- Serial capture from the tool shell: `$PY tools/capture_serial.py COM7 8` from the repo root (8 seconds). It fails with "Access is denied" while a monitor holds the port.
- `CONFIG_FREERTOS_HZ=100` on both boards: one tick is 10 ms.

## File Structure

```
shared/vmaas-motor/                       NEW library, mirrors vmaas-purchase
  library.json
  platformio.ini
  .gitignore
  src/vend_sequencer.h                    VendState, VendActions, VendSequencer
  src/vend_sequencer.cpp
  test/test_sequencer/test_main.cpp

shared/vmaas-config/
  src/slot_config.h                       v2: SlotEntry{slot,pin_count,pins[6]}, SlotConfig.steps_per_vend
  src/slot_config_parser.h                doc update
  src/slot_config_parser.cpp              "motor" block, "pins" array
  src/device_config.h                     + dispense_timeout_ms
  src/device_config_parser.cpp            + timings.dispense_timeout_ms (0 allowed)
  test/test_parse/test_main.cpp           rewritten for v2
  test/test_validate/test_main.cpp        rewritten for v2
  test/test_device_parse/test_main.cpp    + dispense timeout tests
  README.md                               schema section rewritten

shared/vmaas-protocol/
  src/protocol.h                          ConfigParam emptied, frames::config removed
  PROTOCOL.md                             RUN/STOP semantics, CONFIG table, timeouts
  test/test_protocol/test_main.cpp        config builder test removed
  test/test_frame_codec/test_main.cpp     hand-built CONFIG frame

shared/vmaas-purchase/
  src/purchase.h                          PurchaseConfig.dispense_timeout_ms, PurchaseOutput.stop_motor
  src/purchase.cpp                        Dispensing timeout in tick()
  test/test_dispense_timeout/test_main.cpp NEW

Motorcontrol/
  src/pins.h                              + STEP
  src/config.h                            NEW: STEP_INTERVAL_US
  src/step_generator.h / .cpp             NEW: IStepGenerator, StepGenerator (gptimer)
  src/command_handler.h / .cpp            on VendSequencer + SlotConfig, RUN_TIME_MS gone
  src/config_store.h / .cpp               reserved-pin check, v2 logging
  src/main.cpp                            early enable-high, generator, new handler ctor
  data/config.json                        v2

Main-Controller/
  src/motor_client.h / .cpp               config() removed
  src/purchase_task.h / .cpp              dispense_timeout_ms in, stop_motor out, late-DONE log
  src/main.cpp                            passes cfg.dispense_timeout_ms
  data/config.json                        + timings.dispense_timeout_ms
```

---

### Task 1: `VendSequencer` in `shared/vmaas-motor`

The pure dispense state machine. Everything Motorcontrol does to a motor is decided here and tested here.

**Files:**
- Create: `shared/vmaas-motor/library.json`
- Create: `shared/vmaas-motor/platformio.ini`
- Create: `shared/vmaas-motor/.gitignore`
- Create: `shared/vmaas-motor/src/vend_sequencer.h`
- Create: `shared/vmaas-motor/src/vend_sequencer.cpp`
- Test: `shared/vmaas-motor/test/test_sequencer/test_main.cpp`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `enum class vmaas::VendState : uint8_t { Idle, Enabling, Stepping }`
  - `struct vmaas::VendActions { bool enable_pins, disable_pins, start_steps, stop_steps, send_done; uint8_t slot; uint32_t steps; }`
  - `class vmaas::VendSequencer { VendState state() const; uint8_t current_slot() const; VendActions run(uint8_t slot, uint32_t steps, uint32_t now_tick); VendActions stop(); VendActions tick(uint32_t now_tick, bool step_done); static constexpr uint32_t ENABLE_SETTLE_TICKS = 1; }`

- [ ] **Step 1: Create the library scaffold**

`shared/vmaas-motor/library.json`:

```json
{
  "name": "vmaas-motor",
  "version": "0.1.0",
  "description": "Hardware-free stepper dispense sequencer for VMaaS Motorcontrol",
  "keywords": ["stepper", "motor", "vending", "vmaas"],
  "frameworks": "*",
  "platforms": "*",
  "headers": ["vend_sequencer.h"]
}
```

`shared/vmaas-motor/platformio.ini`:

```ini
; Host-side unit tests for the shared dispense sequencer.
; Run from this directory: pio test -e native
; The sequencer emits actions (enable pins, start pulses, send DONE) and never
; touches hardware, so Motorcontrol's CommandHandler only has to execute them.
[env:native]
platform = native
test_framework = unity
test_build_src = yes
build_flags = -std=c++17 -Wall -Wextra
```

`shared/vmaas-motor/.gitignore`:

```
.pio/
```

- [ ] **Step 2: Write the header**

`shared/vmaas-motor/src/vend_sequencer.h`:

```cpp
#pragma once
/**
 * @file vend_sequencer.h
 * @brief The dispense state machine for Motorcontrol: one RUN in, a fixed
 *        sequence of pin and pulse actions out.
 *
 * Hardware-free. It knows nothing about GPIO, timers or the UART. Same cut as
 * vmaas-purchase: events in, actions out, so the whole sequence is host-tested
 * and Motorcontrol's CommandHandler only has to execute the actions.
 *
 * The motors are steppers on DRV8825 drivers sharing one STEP line, with one
 * nENABLE line per driver. A vend is: enable the slot's drivers, wait one
 * tick so they are awake, emit a fixed number of STEP pulses, disable, DONE.
 */
#include <cstdint>

namespace vmaas
{
    enum class VendState : uint8_t
    {
        Idle,     ///< Nothing running. Every nENABLE is high (disabled).
        Enabling, ///< The slot's drivers are enabled; waiting one tick before the first pulse.
        Stepping, ///< Pulses are being emitted; waiting for the generator to finish.
    };

    /**
     * @brief What the caller must do after handing the sequencer an event.
     *
     * Several fields can be set at once: finishing a vend both stops the
     * generator, disables the drivers and sends DONE.
     */
    struct VendActions
    {
        bool enable_pins = false;  ///< Drive every nENABLE pin of `slot` LOW.
        bool disable_pins = false; ///< Drive every nENABLE pin of `slot` HIGH.
        bool start_steps = false;  ///< Start the step generator for `steps` pulses.
        bool stop_steps = false;   ///< Stop the step generator, whatever it is doing.
        bool send_done = false;    ///< Send DONE for `slot`. Exactly once per run().
        uint8_t slot = 0;          ///< The slot the pin actions refer to.
        uint32_t steps = 0;        ///< Pulses to emit when start_steps is set.
    };

    class VendSequencer
    {
    public:
        /// Ticks the drivers get between enable and the first pulse. One
        /// FreeRTOS tick (10 ms at CONFIG_FREERTOS_HZ=100) is the smallest
        /// delay the caller's loop can express; DRV8825 needs microseconds.
        static constexpr uint32_t ENABLE_SETTLE_TICKS = 1;

        VendState state() const { return state_; }

        /// The slot being vended, or 0 when Idle.
        uint8_t current_slot() const { return state_ == VendState::Idle ? 0 : slot_; }

        /**
         * @brief Begin a vend.
         *
         * The caller has already answered BUSY and UNKNOWN_SLOT, so this is
         * only meaningful in Idle. In any other state it does nothing and
         * returns no actions.
         *
         * @param slot Slot number as sent in RUN.
         * @param steps Pulses to emit (config.json motor.stepsPerVend).
         * @param now_tick Current tick count; the settle delay counts from here.
         */
        VendActions run(uint8_t slot, uint32_t steps, uint32_t now_tick);

        /// STOP from Main-Controller. Idle: no actions. Otherwise: everything off, no DONE.
        VendActions stop();

        /**
         * @brief Call every loop pass.
         * @param now_tick Current tick count. Wrap-around is handled.
         * @param step_done Whether the generator has emitted every pulse since
         *        its last start. Ignored outside Stepping, so a stale flag
         *        from the previous vend cannot finish this one early.
         */
        VendActions tick(uint32_t now_tick, bool step_done);

    private:
        VendActions finish(bool with_done);

        VendState state_ = VendState::Idle;
        uint8_t slot_ = 0;
        uint32_t steps_ = 0;
        uint32_t enabled_at_tick_ = 0;
    };
}
```

- [ ] **Step 3: Write the failing tests**

`shared/vmaas-motor/test/test_sequencer/test_main.cpp`:

```cpp
/**
 * @file test_main.cpp
 * @brief Host tests for VendSequencer: every transition, STOP in every state,
 *        exactly one DONE per vend, and no action when idle.
 */
#include <unity.h>
#include "vend_sequencer.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

namespace
{
    void assert_no_actions(const VendActions& a)
    {
        TEST_ASSERT_FALSE(a.enable_pins);
        TEST_ASSERT_FALSE(a.disable_pins);
        TEST_ASSERT_FALSE(a.start_steps);
        TEST_ASSERT_FALSE(a.stop_steps);
        TEST_ASSERT_FALSE(a.send_done);
    }

    // Drives a fresh sequencer to Stepping: run at tick 100, settle at tick 101.
    VendSequencer stepping(uint8_t slot = 3, uint32_t steps = 6400)
    {
        VendSequencer s;
        s.run(slot, steps, 100);
        s.tick(101, false);
        return s;
    }
}

void test_idle_tick_does_nothing()
{
    VendSequencer s;
    assert_no_actions(s.tick(5, false));
    assert_no_actions(s.tick(6, true));
    TEST_ASSERT_EQUAL(VendState::Idle, s.state());
    TEST_ASSERT_EQUAL_UINT8(0, s.current_slot());
}

void test_run_enables_pins_and_enters_enabling()
{
    VendSequencer s;
    const VendActions a = s.run(3, 6400, 100);
    TEST_ASSERT_TRUE(a.enable_pins);
    TEST_ASSERT_FALSE(a.disable_pins);
    TEST_ASSERT_FALSE(a.start_steps);
    TEST_ASSERT_FALSE(a.send_done);
    TEST_ASSERT_EQUAL_UINT8(3, a.slot);
    TEST_ASSERT_EQUAL(VendState::Enabling, s.state());
    TEST_ASSERT_EQUAL_UINT8(3, s.current_slot());
}

// The drivers need a moment after nENABLE goes low. Same tick: nothing yet.
void test_tick_before_settle_does_nothing()
{
    VendSequencer s;
    s.run(3, 6400, 100);
    assert_no_actions(s.tick(100, false));
    TEST_ASSERT_EQUAL(VendState::Enabling, s.state());
}

void test_tick_after_settle_starts_steps_with_slot_and_count()
{
    VendSequencer s;
    s.run(3, 6400, 100);
    const VendActions a = s.tick(101, false);
    TEST_ASSERT_TRUE(a.start_steps);
    TEST_ASSERT_FALSE(a.enable_pins);
    TEST_ASSERT_FALSE(a.disable_pins);
    TEST_ASSERT_FALSE(a.send_done);
    TEST_ASSERT_EQUAL_UINT8(3, a.slot);
    TEST_ASSERT_EQUAL_UINT32(6400, a.steps);
    TEST_ASSERT_EQUAL(VendState::Stepping, s.state());
}

// The generator's done flag is still true from the previous vend until
// start() clears it. During Enabling it must be ignored.
void test_stale_step_done_during_enabling_is_ignored()
{
    VendSequencer s;
    s.run(3, 6400, 100);
    const VendActions a = s.tick(100, true);
    assert_no_actions(a);
    TEST_ASSERT_EQUAL(VendState::Enabling, s.state());
}

void test_step_done_finishes_with_disable_stop_and_one_done()
{
    VendSequencer s = stepping(3);
    assert_no_actions(s.tick(150, false));
    TEST_ASSERT_EQUAL(VendState::Stepping, s.state());

    const VendActions a = s.tick(300, true);
    TEST_ASSERT_TRUE(a.stop_steps);
    TEST_ASSERT_TRUE(a.disable_pins);
    TEST_ASSERT_TRUE(a.send_done);
    TEST_ASSERT_FALSE(a.enable_pins);
    TEST_ASSERT_FALSE(a.start_steps);
    TEST_ASSERT_EQUAL_UINT8(3, a.slot);
    TEST_ASSERT_EQUAL(VendState::Idle, s.state());
    TEST_ASSERT_EQUAL_UINT8(0, s.current_slot());

    // The flag stays true on the generator; the next tick must not send a second DONE.
    assert_no_actions(s.tick(301, true));
}

void test_stop_in_idle_does_nothing()
{
    VendSequencer s;
    assert_no_actions(s.stop());
    TEST_ASSERT_EQUAL(VendState::Idle, s.state());
}

void test_stop_in_enabling_disables_without_done()
{
    VendSequencer s;
    s.run(7, 6400, 100);
    const VendActions a = s.stop();
    TEST_ASSERT_TRUE(a.disable_pins);
    TEST_ASSERT_TRUE(a.stop_steps);
    TEST_ASSERT_FALSE(a.send_done);
    TEST_ASSERT_FALSE(a.enable_pins);
    TEST_ASSERT_FALSE(a.start_steps);
    TEST_ASSERT_EQUAL_UINT8(7, a.slot);
    TEST_ASSERT_EQUAL(VendState::Idle, s.state());
}

void test_stop_in_stepping_stops_and_disables_without_done()
{
    VendSequencer s = stepping(7);
    const VendActions a = s.stop();
    TEST_ASSERT_TRUE(a.stop_steps);
    TEST_ASSERT_TRUE(a.disable_pins);
    TEST_ASSERT_FALSE(a.send_done);
    TEST_ASSERT_EQUAL_UINT8(7, a.slot);
    TEST_ASSERT_EQUAL(VendState::Idle, s.state());

    // A late done flag after STOP must not produce a DONE either.
    assert_no_actions(s.tick(999, true));
}

void test_run_while_busy_is_ignored()
{
    VendSequencer s = stepping(3);
    const VendActions a = s.run(4, 100, 200);
    assert_no_actions(a);
    TEST_ASSERT_EQUAL(VendState::Stepping, s.state());
    TEST_ASSERT_EQUAL_UINT8(3, s.current_slot());
}

void test_tick_wrap_around_still_settles()
{
    VendSequencer s;
    s.run(3, 6400, 0xFFFFFFFFu);
    assert_no_actions(s.tick(0xFFFFFFFFu, false));
    const VendActions a = s.tick(0, false);
    TEST_ASSERT_TRUE(a.start_steps);
    TEST_ASSERT_EQUAL(VendState::Stepping, s.state());
}

void test_sequencer_is_reusable_after_a_vend()
{
    VendSequencer s = stepping(3);
    s.tick(300, true);
    const VendActions a = s.run(5, 3200, 400);
    TEST_ASSERT_TRUE(a.enable_pins);
    TEST_ASSERT_EQUAL_UINT8(5, a.slot);
    const VendActions b = s.tick(401, true); // stale flag again
    TEST_ASSERT_TRUE(b.start_steps);
    TEST_ASSERT_EQUAL_UINT32(3200, b.steps);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_idle_tick_does_nothing);
    RUN_TEST(test_run_enables_pins_and_enters_enabling);
    RUN_TEST(test_tick_before_settle_does_nothing);
    RUN_TEST(test_tick_after_settle_starts_steps_with_slot_and_count);
    RUN_TEST(test_stale_step_done_during_enabling_is_ignored);
    RUN_TEST(test_step_done_finishes_with_disable_stop_and_one_done);
    RUN_TEST(test_stop_in_idle_does_nothing);
    RUN_TEST(test_stop_in_enabling_disables_without_done);
    RUN_TEST(test_stop_in_stepping_stops_and_disables_without_done);
    RUN_TEST(test_run_while_busy_is_ignored);
    RUN_TEST(test_tick_wrap_around_still_settles);
    RUN_TEST(test_sequencer_is_reusable_after_a_vend);
    return UNITY_END();
}
```

- [ ] **Step 4: Run the tests to verify they fail**

From `shared/vmaas-motor`: `$PIO test -e native`
Expected: build error, `vend_sequencer.cpp` missing so `VendSequencer::run` etc. are undefined references.

- [ ] **Step 5: Write the implementation**

`shared/vmaas-motor/src/vend_sequencer.cpp`:

```cpp
/**
 * @file vend_sequencer.cpp
 * @brief The state machine. See vend_sequencer.h for the contract.
 */
#include "vend_sequencer.h"

namespace vmaas
{
    VendActions VendSequencer::run(uint8_t slot, uint32_t steps, uint32_t now_tick)
    {
        VendActions a;
        if (state_ != VendState::Idle) return a;

        state_ = VendState::Enabling;
        slot_ = slot;
        steps_ = steps;
        enabled_at_tick_ = now_tick;

        a.enable_pins = true;
        a.slot = slot;
        a.steps = steps;
        return a;
    }

    VendActions VendSequencer::stop()
    {
        if (state_ == VendState::Idle) return VendActions{};
        return finish(false);
    }

    VendActions VendSequencer::tick(uint32_t now_tick, bool step_done)
    {
        switch (state_)
        {
        case VendState::Idle:
            return VendActions{};

        case VendState::Enabling:
        {
            // Unsigned subtraction, so a tick counter that wrapped still measures correctly.
            if (now_tick - enabled_at_tick_ < ENABLE_SETTLE_TICKS) return VendActions{};
            state_ = VendState::Stepping;
            VendActions a;
            a.start_steps = true;
            a.slot = slot_;
            a.steps = steps_;
            return a;
        }

        case VendState::Stepping:
            if (!step_done) return VendActions{};
            return finish(true);
        }
        return VendActions{};
    }

    // Shared tail of a completed and an interrupted vend: the generator is
    // stopped (harmless if it never started), the drivers are disabled, and
    // only a completed vend earns a DONE.
    VendActions VendSequencer::finish(bool with_done)
    {
        VendActions a;
        a.stop_steps = true;
        a.disable_pins = true;
        a.send_done = with_done;
        a.slot = slot_;
        a.steps = steps_;

        state_ = VendState::Idle;
        slot_ = 0;
        steps_ = 0;
        return a;
    }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

From `shared/vmaas-motor`: `$PIO test -e native`
Expected: `12 Tests 0 Failures 0 Ignored`.

- [ ] **Step 7: Verify**

`git status --short shared/vmaas-motor` shows the new directory untracked. Do not commit.

---

### Task 2: `config.json` schema v2 in `shared/vmaas-config`

`motor.stepsPerVend` becomes required; each slot carries a `pins` array. Both test suites are rewritten because every JSON literal changes shape.

**Files:**
- Modify: `shared/vmaas-config/src/slot_config.h`
- Modify: `shared/vmaas-config/src/slot_config_parser.h` (doc comment)
- Modify: `shared/vmaas-config/src/slot_config_parser.cpp`
- Modify: `shared/vmaas-config/README.md` (schema section)
- Test: `shared/vmaas-config/test/test_parse/test_main.cpp` (rewrite)
- Test: `shared/vmaas-config/test/test_validate/test_main.cpp` (rewrite)

**Interfaces:**
- Consumes: `ConfigIssueKind` from `config_issue.h` (unchanged).
- Produces:
  - `constexpr int vmaas::SLOT_SCHEMA_VERSION = 2;`
  - `constexpr size_t vmaas::MAX_PINS_PER_SLOT = 6;`
  - `constexpr uint16_t vmaas::STEPS_PER_VEND_MIN = 1; constexpr uint16_t vmaas::STEPS_PER_VEND_MAX = 65535;`
  - `struct vmaas::SlotEntry { uint8_t slot; uint8_t pin_count; uint8_t pins[MAX_PINS_PER_SLOT]; }`
  - `struct vmaas::SlotConfig { uint16_t steps_per_vend; size_t slot_count; SlotEntry slots[MAX_SLOTS]; }`
  - `vmaas::SlotParseResult vmaas::parse_slot_config(const char*)` (same signature).

- [ ] **Step 1: Update the schema header**

Replace the whole of `shared/vmaas-config/src/slot_config.h` with:

```cpp
#pragma once
/**
 * @file slot_config.h
 * @brief Slot configuration schema for the VMaaS Motorcontrol.
 *
 * The cabinet wiring (protocol slot number -> motor nENABLE GPIOs) and the
 * pulse count per vend live in /storage/config.json on Motorcontrol. There is
 * no default in firmware: parse_slot_config() (slot_config_parser.h) either
 * yields a complete, validated table (ok == true) or a list of issues that
 * make the file unusable. The library never logs; the caller decides what to
 * print.
 *
 * Contrast device_config.h, whose every field has a safe default: a wrong
 * motor pin or pulse count dispenses wrongly to someone who has already paid,
 * a wrong MQTT host costs telemetry.
 *
 * The motors are steppers on DRV8825 drivers. One STEP line is shared by every
 * driver (a firmware constant on Motorcontrol); each driver has its own
 * nENABLE GPIO, and that GPIO is the "pin" recorded here. A slot has several
 * pins when two spirals are merged into one wide slot.
 *
 * Schema version 2 (config.json):
 * @code
 * {
 *   "version": 2,
 *   "motor": { "stepsPerVend": 6400 },
 *   "slots": [
 *     { "slot": 1, "pins": [18] },
 *     { "slot": 3, "pins": [21, 22] }
 *   ]
 * }
 * @endcode
 */
#include <cstddef>
#include <cstdint>
#include "config_issue.h"

namespace vmaas
{
    /// Schema version this library understands. Files with a higher version parse with a NewerVersion issue.
    constexpr int SLOT_SCHEMA_VERSION = 2;

    /// Largest slot table accepted. Bounds the fixed arrays below; no heap is used.
    constexpr size_t MAX_SLOTS = 32;

    /// Most nENABLE pins one slot may drive. Six is what a WIRING_SLOT frame
    /// can carry once slot and pin_count have taken two of its eight bytes.
    constexpr size_t MAX_PINS_PER_SLOT = 6;

    /// Bounds on motor.stepsPerVend. 6400 is one revolution of a 200-step motor at 1/32 microstepping.
    constexpr uint16_t STEPS_PER_VEND_MIN = 1;
    constexpr uint16_t STEPS_PER_VEND_MAX = 65535;

    /// One row of the wiring table.
    struct SlotEntry
    {
        uint8_t slot;                    ///< Slot number as sent by Main-Controller in RUN. 1-255.
        uint8_t pin_count;               ///< Valid entries in pins, 1..MAX_PINS_PER_SLOT.
        uint8_t pins[MAX_PINS_PER_SLOT]; ///< nENABLE GPIOs, 0-33 (output-capable), unique across the file.
    };

    /// Validated table. slot_count is 0 unless SlotParseResult::ok is true.
    struct SlotConfig
    {
        uint16_t steps_per_vend;     ///< STEP pulses per RUN, from motor.stepsPerVend.
        size_t slot_count;           ///< Number of valid entries in slots.
        SlotEntry slots[MAX_SLOTS];  ///< Entries in file order.
    };

    /// Output of parse_slot_config(). Fixed size, no heap.
    struct SlotParseResult
    {
        static constexpr size_t MAX_ISSUES = 8; ///< Issues kept; further ones are dropped (count saturates).

        SlotConfig config;         ///< Table. Empty (slot_count 0, steps_per_vend 0) unless ok.
        bool ok;                   ///< json_valid and no issue other than NewerVersion: the table may be used.
        bool json_valid;           ///< false means the text was not a JSON object (or too deep).
        size_t json_error_offset;  ///< Byte offset of the JSON error when json_valid is false; 0 otherwise.
        size_t issue_count;        ///< Number of valid entries in issues, at most MAX_ISSUES.
        ConfigIssue issues[MAX_ISSUES]; ///< The first issue_count entries are valid.
    };
}
```

- [ ] **Step 2: Update the parser doc comment**

In `shared/vmaas-config/src/slot_config_parser.h`, replace the bullet list inside the `parse_slot_config` doc comment with:

```cpp
     * - "motor" is required: an object with integer "stepsPerVend"
     *   (1-65535). Absent gives MissingField "motor" / "motor.stepsPerVend".
     * - "slots" is required: an array of objects, each with integer "slot"
     *   (1-255) and "pins", a non-empty array of at most MAX_PINS_PER_SLOT
     *   integers (0-33). Absent, empty or not an array gives MissingField.
     * - Slot numbers must be unique across the table (DuplicateSlot on the
     *   later entry). Pins must be unique across the whole file, within one
     *   slot as well as between slots (DuplicatePin on the later pin).
     * - At most MAX_SLOTS entries (TooManySlots). The first MAX_SLOTS are
     *   still validated so the log can name every problem it can see.
     * - Unknown keys are ignored. "version" higher than
     *   SLOT_SCHEMA_VERSION gives NewerVersion and parsing continues.
     * - Invalid JSON, a nullptr, a non-object root, or nesting deeper than 8
     *   levels (checked before the recursive parser runs, so a hostile file
     *   cannot exhaust the stack) gives json_valid == false and one
     *   InvalidJson issue with json_error_offset set.
```

- [ ] **Step 3: Rewrite the parse tests for v2**

Replace the whole of `shared/vmaas-config/test/test_parse/test_main.cpp` with:

```cpp
/**
 * @file test_main.cpp
 * @brief Host tests for parse_slot_config() structure handling.
 *
 * The contract under test: a well-formed v2 file yields the step count and
 * the slot table in file order with ok == true; anything that is not a JSON
 * object with a "motor" block and a "slots" array yields ok == false and
 * names the problem; unknown keys and a newer schema version are tolerated.
 */
#include <unity.h>
#include <cstring>
#include <string>
#include "slot_config.h"
#include "slot_config_parser.h"

using namespace vmaas;

namespace
{
    constexpr const char* MOTOR = R"("motor": {"stepsPerVend": 6400},)";

    constexpr const char* FOUR_SLOTS = R"({
        "version": 2,
        "motor": { "stepsPerVend": 6400 },
        "slots": [
            { "slot": 1, "pins": [18] },
            { "slot": 2, "pins": [19] },
            { "slot": 3, "pins": [21, 22] },
            { "slot": 4, "pins": [23] }
        ]
    })";

    // Wraps a slots-array body in a complete v2 file with the default motor block.
    std::string file(const char* slots_body)
    {
        return std::string("{") + MOTOR + "\"slots\": " + slots_body + "}";
    }

    bool has_issue(const SlotParseResult& r, ConfigIssueKind kind, const char* field)
    {
        for (size_t i = 0; i < r.issue_count; ++i)
            if (r.issues[i].kind == kind && std::strcmp(r.issues[i].field, field) == 0)
                return true;
        return false;
    }
}

void setUp() {}
void tearDown() {}

void test_valid_file_gives_steps_and_slots_in_file_order()
{
    const SlotParseResult r = parse_slot_config(FOUR_SLOTS);
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
    TEST_ASSERT_EQUAL_UINT16(6400, r.config.steps_per_vend);
    TEST_ASSERT_EQUAL_UINT32(4, r.config.slot_count);
    TEST_ASSERT_EQUAL_UINT8(1, r.config.slots[0].slot);
    TEST_ASSERT_EQUAL_UINT8(1, r.config.slots[0].pin_count);
    TEST_ASSERT_EQUAL_UINT8(18, r.config.slots[0].pins[0]);
    TEST_ASSERT_EQUAL_UINT8(3, r.config.slots[2].slot);
    TEST_ASSERT_EQUAL_UINT8(2, r.config.slots[2].pin_count);
    TEST_ASSERT_EQUAL_UINT8(21, r.config.slots[2].pins[0]);
    TEST_ASSERT_EQUAL_UINT8(22, r.config.slots[2].pins[1]);
    TEST_ASSERT_EQUAL_UINT8(4, r.config.slots[3].slot);
    TEST_ASSERT_EQUAL_UINT8(23, r.config.slots[3].pins[0]);
}

void test_single_slot_file_is_ok()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 7, "pins": [5]}])").c_str());
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(1, r.config.slot_count);
    TEST_ASSERT_EQUAL_UINT8(7, r.config.slots[0].slot);
    TEST_ASSERT_EQUAL_UINT8(5, r.config.slots[0].pins[0]);
}

// There is no default wiring and no default step count: an empty object is unusable on both counts.
void test_empty_object_is_missing_motor_and_slots()
{
    const SlotParseResult r = parse_slot_config("{}");
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(0, r.config.slot_count);
    TEST_ASSERT_EQUAL_UINT16(0, r.config.steps_per_vend);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "motor"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "slots"));
}

void test_missing_motor_block_is_missing_field()
{
    const SlotParseResult r = parse_slot_config(R"({"slots": [{"slot": 1, "pins": [18]}]})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(0, r.config.slot_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "motor"));
}

void test_missing_steps_per_vend_is_missing_field()
{
    const SlotParseResult r = parse_slot_config(R"({"motor": {}, "slots": [{"slot": 1, "pins": [18]}]})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "motor.stepsPerVend"));
}

void test_motor_not_an_object_is_wrong_type()
{
    const SlotParseResult r = parse_slot_config(R"({"motor": 6400, "slots": [{"slot": 1, "pins": [18]}]})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "motor"));
}

void test_nullptr_is_invalid_json()
{
    const SlotParseResult r = parse_slot_config(nullptr);
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InvalidJson, ""));
}

void test_invalid_json_gives_offset()
{
    const char* json = R"({"motor": {"stepsPerVend": 6400}, "slots": [{"slot": 1,)";
    const SlotParseResult r = parse_slot_config(json);
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InvalidJson, ""));
    TEST_ASSERT_TRUE(r.json_error_offset > 0);
    TEST_ASSERT_TRUE(r.json_error_offset <= std::strlen(json));
}

void test_non_object_root_is_invalid_json()
{
    const SlotParseResult r = parse_slot_config(R"([{"slot": 1, "pins": [18]}])");
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InvalidJson, ""));
}

// Deep nesting is rejected before cJSON recurses, so a hostile file cannot exhaust the stack.
void test_deeply_nested_json_is_rejected_before_parsing()
{
    std::string json = "{\"x\":";
    for (int i = 0; i < 20; ++i) json += "[";
    json += "1";
    for (int i = 0; i < 20; ++i) json += "]";
    json += "}";
    const SlotParseResult r = parse_slot_config(json.c_str());
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_EQUAL(ConfigIssueKind::InvalidJson, r.issues[0].kind);
    TEST_ASSERT_TRUE(r.json_error_offset > 0);
    TEST_ASSERT_TRUE(r.json_error_offset < json.size());
}

// The schema itself is depth 4 (object > array > object > array) and must stay well inside the limit.
void test_schema_depth_is_within_limit()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1, "pins": [18], "meta": {"a": [1]}}])").c_str());
    TEST_ASSERT_TRUE(r.ok);
}

void test_unknown_keys_are_ignored_everywhere()
{
    const char* json = R"({
        "version": 2,
        "wifi": {"ssid": "x"},
        "motor": {"stepsPerVend": 6400, "stepIntervalUs": 312},
        "slots": [{"slot": 1, "pins": [18], "label": "cola"}],
        "notes": [1, 2, 3]
    })";
    const SlotParseResult r = parse_slot_config(json);
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
    TEST_ASSERT_EQUAL_UINT32(1, r.config.slot_count);
}

// A file from a newer firmware still applies; the caller gets a hint.
void test_newer_version_is_flagged_but_ok()
{
    const SlotParseResult r = parse_slot_config(R"({"version": 3, "motor": {"stepsPerVend": 6400}, "slots": [{"slot": 1, "pins": [18]}]})");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::NewerVersion, "version"));
    TEST_ASSERT_EQUAL_UINT32(1, r.config.slot_count);
}

void test_current_version_gives_no_issue()
{
    TEST_ASSERT_EQUAL_UINT32(0, parse_slot_config(R"({"version": 2, "motor": {"stepsPerVend": 6400}, "slots": [{"slot": 1, "pins": [18]}]})").issue_count);
}

// A v1 file is not silently accepted with an older version number: it lacks
// "motor" and uses the removed "pin" scalar, and both are reported.
void test_v1_file_is_unusable()
{
    const SlotParseResult r = parse_slot_config(R"({"version": 1, "slots": [{"slot": 1, "pin": 18}]})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "motor"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "slots[0].pins"));
}

void test_non_numeric_version_is_wrong_type_and_not_ok()
{
    const SlotParseResult r = parse_slot_config(R"({"version": "2", "motor": {"stepsPerVend": 6400}, "slots": [{"slot": 1, "pins": [18]}]})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "version"));
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_valid_file_gives_steps_and_slots_in_file_order);
    RUN_TEST(test_single_slot_file_is_ok);
    RUN_TEST(test_empty_object_is_missing_motor_and_slots);
    RUN_TEST(test_missing_motor_block_is_missing_field);
    RUN_TEST(test_missing_steps_per_vend_is_missing_field);
    RUN_TEST(test_motor_not_an_object_is_wrong_type);
    RUN_TEST(test_nullptr_is_invalid_json);
    RUN_TEST(test_invalid_json_gives_offset);
    RUN_TEST(test_non_object_root_is_invalid_json);
    RUN_TEST(test_deeply_nested_json_is_rejected_before_parsing);
    RUN_TEST(test_schema_depth_is_within_limit);
    RUN_TEST(test_unknown_keys_are_ignored_everywhere);
    RUN_TEST(test_newer_version_is_flagged_but_ok);
    RUN_TEST(test_current_version_gives_no_issue);
    RUN_TEST(test_v1_file_is_unusable);
    RUN_TEST(test_non_numeric_version_is_wrong_type_and_not_ok);
    return UNITY_END();
}
```

- [ ] **Step 4: Rewrite the validation tests for v2**

Replace the whole of `shared/vmaas-config/test/test_validate/test_main.cpp` with:

```cpp
/**
 * @file test_main.cpp
 * @brief Host tests for parse_slot_config() validation of the motor block and
 *        the slot entries.
 *
 * Every rule that can make the cabinet wiring physically wrong is checked:
 * step count range, slot and pin ranges, input-only GPIOs used as motor
 * outputs, one GPIO used twice anywhere in the file, one slot number used
 * twice, too many pins on one slot, and the table size limit. Any such
 * problem makes the whole file unusable (ok == false, slot_count == 0).
 */
#include <unity.h>
#include <cstring>
#include <string>
#include "slot_config.h"
#include "slot_config_parser.h"

using namespace vmaas;

namespace
{
    constexpr const char* MOTOR = R"("motor": {"stepsPerVend": 6400},)";

    bool has_issue(const SlotParseResult& r, ConfigIssueKind kind, const char* field)
    {
        for (size_t i = 0; i < r.issue_count; ++i)
            if (r.issues[i].kind == kind && std::strcmp(r.issues[i].field, field) == 0)
                return true;
        return false;
    }

    // Wraps a slots-array body in a complete v2 file with the default motor block.
    std::string file(const char* slots_body)
    {
        return std::string("{") + MOTOR + "\"slots\": " + slots_body + "}";
    }

    // Builds a v2 file with n single-pin slots: slot i+1 on pin first_pin+i.
    std::string slots_file(int n, int first_pin = 0)
    {
        std::string s = std::string("{") + MOTOR + "\"slots\": [";
        for (int i = 0; i < n; ++i)
        {
            if (i) s += ",";
            s += "{\"slot\": " + std::to_string(i + 1) + ", \"pins\": [" + std::to_string(first_pin + i) + "]}";
        }
        return s + "]}";
    }

    void assert_unusable(const SlotParseResult& r)
    {
        TEST_ASSERT_FALSE(r.ok);
        TEST_ASSERT_EQUAL_UINT32(0, r.config.slot_count);
        TEST_ASSERT_EQUAL_UINT16(0, r.config.steps_per_vend);
    }
}

void setUp() {}
void tearDown() {}

// ---------- motor block ----------

void test_steps_per_vend_boundaries_are_accepted()
{
    const SlotParseResult lo = parse_slot_config(R"({"motor": {"stepsPerVend": 1}, "slots": [{"slot": 1, "pins": [18]}]})");
    TEST_ASSERT_TRUE(lo.ok);
    TEST_ASSERT_EQUAL_UINT16(1, lo.config.steps_per_vend);
    const SlotParseResult hi = parse_slot_config(R"({"motor": {"stepsPerVend": 65535}, "slots": [{"slot": 1, "pins": [18]}]})");
    TEST_ASSERT_TRUE(hi.ok);
    TEST_ASSERT_EQUAL_UINT16(65535, hi.config.steps_per_vend);
}

void test_steps_per_vend_out_of_range()
{
    const SlotParseResult zero = parse_slot_config(R"({"motor": {"stepsPerVend": 0}, "slots": [{"slot": 1, "pins": [18]}]})");
    assert_unusable(zero);
    TEST_ASSERT_TRUE(has_issue(zero, ConfigIssueKind::OutOfRange, "motor.stepsPerVend"));
    const SlotParseResult big = parse_slot_config(R"({"motor": {"stepsPerVend": 65536}, "slots": [{"slot": 1, "pins": [18]}]})");
    assert_unusable(big);
    TEST_ASSERT_TRUE(has_issue(big, ConfigIssueKind::OutOfRange, "motor.stepsPerVend"));
}

void test_steps_per_vend_string_or_fraction_is_wrong_type()
{
    const SlotParseResult s = parse_slot_config(R"({"motor": {"stepsPerVend": "6400"}, "slots": [{"slot": 1, "pins": [18]}]})");
    assert_unusable(s);
    TEST_ASSERT_TRUE(has_issue(s, ConfigIssueKind::WrongType, "motor.stepsPerVend"));
    const SlotParseResult f = parse_slot_config(R"({"motor": {"stepsPerVend": 6400.5}, "slots": [{"slot": 1, "pins": [18]}]})");
    assert_unusable(f);
    TEST_ASSERT_TRUE(has_issue(f, ConfigIssueKind::WrongType, "motor.stepsPerVend"));
}

// ---------- slots array ----------

void test_slots_not_an_array_is_missing_field()
{
    const SlotParseResult r = parse_slot_config(file(R"({"slot": 1, "pins": [18]})").c_str());
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "slots"));
}

void test_empty_slots_array_is_missing_field()
{
    const SlotParseResult r = parse_slot_config(file("[]").c_str());
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "slots"));
}

void test_entry_not_an_object_is_wrong_type()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1, "pins": [18]}, 5])").c_str());
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "slots[1]"));
}

void test_entry_missing_pins_or_slot_is_missing_field()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1}, {"pins": [19]}])").c_str());
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "slots[0].pins"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "slots[1].slot"));
}

// The v1 scalar is not an alias for a one-element array.
void test_v1_pin_scalar_is_rejected()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1, "pin": 18}])").c_str());
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "slots[0].pins"));
}

void test_pins_not_an_array_or_empty_is_missing_field()
{
    const SlotParseResult a = parse_slot_config(file(R"([{"slot": 1, "pins": 18}])").c_str());
    assert_unusable(a);
    TEST_ASSERT_TRUE(has_issue(a, ConfigIssueKind::MissingField, "slots[0].pins"));
    const SlotParseResult b = parse_slot_config(file(R"([{"slot": 1, "pins": []}])").c_str());
    assert_unusable(b);
    TEST_ASSERT_TRUE(has_issue(b, ConfigIssueKind::MissingField, "slots[0].pins"));
}

void test_string_and_fractional_values_are_wrong_type()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": "1", "pins": [18.5]}])").c_str());
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "slots[0].slot"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "slots[0].pins[0]"));
}

void test_slot_out_of_range()
{
    const SlotParseResult a = parse_slot_config(file(R"([{"slot": 0, "pins": [18]}])").c_str());
    assert_unusable(a);
    TEST_ASSERT_TRUE(has_issue(a, ConfigIssueKind::OutOfRange, "slots[0].slot"));
    const SlotParseResult b = parse_slot_config(file(R"([{"slot": 256, "pins": [18]}])").c_str());
    assert_unusable(b);
    TEST_ASSERT_TRUE(has_issue(b, ConfigIssueKind::OutOfRange, "slots[0].slot"));
}

void test_pin_out_of_range()
{
    const SlotParseResult a = parse_slot_config(file(R"([{"slot": 1, "pins": [-1]}])").c_str());
    assert_unusable(a);
    TEST_ASSERT_TRUE(has_issue(a, ConfigIssueKind::OutOfRange, "slots[0].pins[0]"));
    const SlotParseResult b = parse_slot_config(file(R"([{"slot": 1, "pins": [18, 40]}])").c_str());
    assert_unusable(b);
    TEST_ASSERT_TRUE(has_issue(b, ConfigIssueKind::OutOfRange, "slots[0].pins[1]"));
}

// GPIO 34-39 have no output driver on the ESP32, so they cannot drive nENABLE.
void test_input_only_pin_is_rejected()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1, "pins": [34]}])").c_str());
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InputOnlyPin, "slots[0].pins[0]"));
}

void test_boundary_values_are_accepted()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1, "pins": [0]}, {"slot": 255, "pins": [33]}])").c_str());
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(2, r.config.slot_count);
    TEST_ASSERT_EQUAL_UINT8(255, r.config.slots[1].slot);
    TEST_ASSERT_EQUAL_UINT8(33, r.config.slots[1].pins[0]);
}

void test_six_pins_accepted_seven_rejected()
{
    const SlotParseResult six = parse_slot_config(file(R"([{"slot": 1, "pins": [0, 1, 2, 3, 4, 5]}])").c_str());
    TEST_ASSERT_TRUE(six.ok);
    TEST_ASSERT_EQUAL_UINT8(6, six.config.slots[0].pin_count);
    TEST_ASSERT_EQUAL_UINT8(5, six.config.slots[0].pins[5]);

    const SlotParseResult seven = parse_slot_config(file(R"([{"slot": 1, "pins": [0, 1, 2, 3, 4, 5, 12]}])").c_str());
    assert_unusable(seven);
    TEST_ASSERT_TRUE(has_issue(seven, ConfigIssueKind::OutOfRange, "slots[0].pins"));
}

void test_duplicate_slot_number_flags_the_later_entry()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1, "pins": [18]}, {"slot": 2, "pins": [19]}, {"slot": 1, "pins": [21]}])").c_str());
    assert_unusable(r);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::DuplicateSlot, "slots[2].slot"));
}

void test_duplicate_pin_across_slots_flags_the_later_pin()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1, "pins": [18]}, {"slot": 2, "pins": [19, 18]}])").c_str());
    assert_unusable(r);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::DuplicatePin, "slots[1].pins[1]"));
}

// Two spirals on one slot still need two different drivers.
void test_duplicate_pin_within_one_slot_flags_the_later_pin()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1, "pins": [21, 21]}])").c_str());
    assert_unusable(r);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::DuplicatePin, "slots[0].pins[1]"));
}

void test_max_slots_accepted_one_more_rejected()
{
    const SlotParseResult ok = parse_slot_config(slots_file(32).c_str());
    TEST_ASSERT_TRUE(ok.ok);
    TEST_ASSERT_EQUAL_UINT32(32, ok.config.slot_count);

    const SlotParseResult bad = parse_slot_config(slots_file(33).c_str());
    assert_unusable(bad);
    TEST_ASSERT_TRUE(has_issue(bad, ConfigIssueKind::TooManySlots, "slots"));
}

// Too many entries must not stop the parser from naming the other problems it can see.
void test_too_many_slots_still_reports_entry_issues()
{
    std::string s = slots_file(33);
    s.replace(s.find("\"pins\": [0]"), 11, "\"pins\": [40]"); // first entry gets an invalid pin
    const SlotParseResult r = parse_slot_config(s.c_str());
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::TooManySlots, "slots"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "slots[0].pins[0]"));
}

// Many bad entries: the issue list fills up to MAX_ISSUES and stops, never overflows.
void test_issue_list_saturates_at_max()
{
    std::string s = std::string("{") + MOTOR + "\"slots\": [";
    for (int i = 0; i < 12; ++i)
    {
        if (i) s += ",";
        s += "{\"slot\": " + std::to_string(i + 1) + ", \"pins\": [99]}";
    }
    s += "]}";
    const SlotParseResult r = parse_slot_config(s.c_str());
    assert_unusable(r);
    TEST_ASSERT_EQUAL_UINT32(SlotParseResult::MAX_ISSUES, r.issue_count);
    for (size_t i = 0; i < r.issue_count; ++i)
        TEST_ASSERT_EQUAL(ConfigIssueKind::OutOfRange, r.issues[i].kind);
}

// One bad entry among good ones still makes the whole file unusable: no partial wiring.
void test_one_bad_entry_makes_whole_file_unusable()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1, "pins": [18]}, {"slot": 2, "pins": [40]}, {"slot": 3, "pins": [21]}])").c_str());
    assert_unusable(r);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
}

// A double far outside long long cannot be cast to one: that conversion is
// undefined behaviour, not a wrap-around. The range test has to run first.
void test_astronomical_number_is_rejected_before_any_cast()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1e300, "pins": [18]}])").c_str());
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "slots[0].slot"));
    TEST_ASSERT_EQUAL_UINT(0, r.config.slot_count);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_steps_per_vend_boundaries_are_accepted);
    RUN_TEST(test_steps_per_vend_out_of_range);
    RUN_TEST(test_steps_per_vend_string_or_fraction_is_wrong_type);
    RUN_TEST(test_slots_not_an_array_is_missing_field);
    RUN_TEST(test_empty_slots_array_is_missing_field);
    RUN_TEST(test_entry_not_an_object_is_wrong_type);
    RUN_TEST(test_entry_missing_pins_or_slot_is_missing_field);
    RUN_TEST(test_v1_pin_scalar_is_rejected);
    RUN_TEST(test_pins_not_an_array_or_empty_is_missing_field);
    RUN_TEST(test_string_and_fractional_values_are_wrong_type);
    RUN_TEST(test_slot_out_of_range);
    RUN_TEST(test_pin_out_of_range);
    RUN_TEST(test_input_only_pin_is_rejected);
    RUN_TEST(test_boundary_values_are_accepted);
    RUN_TEST(test_six_pins_accepted_seven_rejected);
    RUN_TEST(test_duplicate_slot_number_flags_the_later_entry);
    RUN_TEST(test_duplicate_pin_across_slots_flags_the_later_pin);
    RUN_TEST(test_duplicate_pin_within_one_slot_flags_the_later_pin);
    RUN_TEST(test_max_slots_accepted_one_more_rejected);
    RUN_TEST(test_too_many_slots_still_reports_entry_issues);
    RUN_TEST(test_issue_list_saturates_at_max);
    RUN_TEST(test_one_bad_entry_makes_whole_file_unusable);
    RUN_TEST(test_astronomical_number_is_rejected_before_any_cast);
    return UNITY_END();
}
```

- [ ] **Step 5: Run the two suites to verify they fail**

From `shared/vmaas-config`: `$PIO test -e native -f test_parse` and `$PIO test -e native -f test_validate`
Expected: compile errors (`steps_per_vend`, `pin_count`, `pins` do not exist yet) once the header from Step 1 is in place the tests compile but fail on `has_issue(..., "motor")` and friends.

- [ ] **Step 6: Rewrite the parser**

Replace the whole of `shared/vmaas-config/src/slot_config_parser.cpp` with:

```cpp
#include "slot_config_parser.h"

#include <cstdio>
#include <cstring>
#include "cJSON.h"
#include "json_depth.h"

namespace vmaas
{
    namespace
    {
        constexpr long long SLOT_MIN = 1;
        constexpr long long SLOT_MAX = 255;
        constexpr long long GPIO_MIN = 0;
        constexpr long long GPIO_MAX = 39;
        constexpr long long INPUT_ONLY_MIN = 34; // GPIO 34-39 have no output driver on the ESP32.

        /// Longest field path: "slots[31].pins[5]" is 17 chars; leave headroom.
        constexpr size_t FIELD_CAP = 24;

        void add_issue(SlotParseResult& r, ConfigIssueKind kind, const char* field)
        {
            if (r.issue_count >= SlotParseResult::MAX_ISSUES) return;
            ConfigIssue& issue = r.issues[r.issue_count++];
            issue.kind = kind;
            std::snprintf(issue.field, sizeof(issue.field), "%s", field);
        }

        // Builds "slots[i]" or "slots[i].key" into buf.
        const char* entry_field(char* buf, size_t cap, size_t index, const char* key)
        {
            if (key == nullptr) {
                std::snprintf(buf, cap, "slots[%u]", static_cast<unsigned>(index));
            }
            else {
                std::snprintf(buf, cap, "slots[%u].%s", static_cast<unsigned>(index), key);
            }
            return buf;
        }

        // Builds "slots[i].pins[j]" into buf.
        const char* pin_field(char* buf, size_t cap, size_t index, size_t j)
        {
            std::snprintf(buf, cap, "slots[%u].pins[%u]", static_cast<unsigned>(index), static_cast<unsigned>(j));
            return buf;
        }

        // Validates one JSON value as a whole number in [lo, hi]. Reports the
        // problem under `field` and returns false; true when out holds the value.
        // The range test runs before any cast: converting a double outside long
        // long's range is undefined behaviour, not a wrap-around. Written negated
        // so NaN and infinity fail it too - every comparison against NaN is false.
        bool read_number(const cJSON* item, const char* field, long long lo, long long hi, long long& out, SlotParseResult& r)
        {
            if (!cJSON_IsNumber(item))
            {
                add_issue(r, ConfigIssueKind::WrongType, field);
                return false;
            }
            const double d = cJSON_GetNumberValue(item);
            if (!(d >= static_cast<double>(lo) && d <= static_cast<double>(hi)))
            {
                add_issue(r, ConfigIssueKind::OutOfRange, field);
                return false;
            }
            // Provably in range now, so the round trip is safe.
            if (d != static_cast<double>(static_cast<long long>(d)))
            {
                add_issue(r, ConfigIssueKind::WrongType, field);
                return false;
            }
            out = static_cast<long long>(d);
            return true;
        }

        // Reads parent[key] as a whole number in [lo, hi]. Absent and required gives
        // MissingField; absent and optional returns false with no issue.
        bool read_int(const cJSON* parent, const char* key, const char* field, bool required,
                      long long lo, long long hi, long long& out, SlotParseResult& r)
        {
            const cJSON* item = cJSON_GetObjectItemCaseSensitive(parent, key);
            if (item == nullptr)
            {
                if (required) {
                    add_issue(r, ConfigIssueKind::MissingField, field);
                }
                return false;
            }
            return read_number(item, field, lo, hi, out, r);
        }

        SlotParseResult invalid(size_t error_offset)
        {
            SlotParseResult r{};
            r.json_valid = false;
            r.json_error_offset = error_offset;
            add_issue(r, ConfigIssueKind::InvalidJson, "");
            return r;
        }

        // True when `pin` is already used by an accepted entry, or by an earlier
        // pin of the entry being built (candidate[0..count)).
        bool pin_in_use(const SlotParseResult& r, const uint8_t* candidate, size_t count, uint8_t pin)
        {
            for (size_t j = 0; j < r.config.slot_count; ++j)
                for (size_t k = 0; k < r.config.slots[j].pin_count; ++k)
                    if (r.config.slots[j].pins[k] == pin) return true;
            for (size_t k = 0; k < count; ++k)
                if (candidate[k] == pin) return true;
            return false;
        }

        // Validates one entry and appends it to r.config when it is well formed on its own
        // and its pins collide with nothing accepted so far.
        void read_entry(const cJSON* item, size_t index, SlotParseResult& r)
        {
            char field[FIELD_CAP];
            if (!cJSON_IsObject(item))
            {
                add_issue(r, ConfigIssueKind::WrongType, entry_field(field, sizeof(field), index, nullptr));
                return;
            }

            long long slot = 0;
            bool valid = read_int(item, "slot", entry_field(field, sizeof(field), index, "slot"),
                                  true, SLOT_MIN, SLOT_MAX, slot, r);

            const cJSON* pins = cJSON_GetObjectItemCaseSensitive(item, "pins");
            if (pins == nullptr || !cJSON_IsArray(pins) || cJSON_GetArraySize(pins) == 0)
            {
                add_issue(r, ConfigIssueKind::MissingField, entry_field(field, sizeof(field), index, "pins"));
                return;
            }
            if (static_cast<size_t>(cJSON_GetArraySize(pins)) > MAX_PINS_PER_SLOT)
            {
                add_issue(r, ConfigIssueKind::OutOfRange, entry_field(field, sizeof(field), index, "pins"));
                return;
            }

            uint8_t candidate[MAX_PINS_PER_SLOT] = {};
            size_t count = 0;
            size_t j = 0;
            const cJSON* pin_item = nullptr;
            cJSON_ArrayForEach(pin_item, pins)
            {
                long long pin = 0;
                const char* pf = pin_field(field, sizeof(field), index, j);
                if (!read_number(pin_item, pf, GPIO_MIN, GPIO_MAX, pin, r))
                {
                    valid = false;
                }
                else if (pin >= INPUT_ONLY_MIN)
                {
                    // In range but no output driver.
                    add_issue(r, ConfigIssueKind::InputOnlyPin, pf);
                    valid = false;
                }
                else if (pin_in_use(r, candidate, count, static_cast<uint8_t>(pin)))
                {
                    add_issue(r, ConfigIssueKind::DuplicatePin, pf);
                    valid = false;
                }
                else
                {
                    candidate[count++] = static_cast<uint8_t>(pin);
                }
                ++j;
            }

            if (!valid || r.config.slot_count >= MAX_SLOTS)
                return;

            // Duplicate slot numbers are checked against the entries accepted so far, so the later one is named.
            for (size_t k = 0; k < r.config.slot_count; ++k)
            {
                if (r.config.slots[k].slot == static_cast<uint8_t>(slot))
                {
                    add_issue(r, ConfigIssueKind::DuplicateSlot, entry_field(field, sizeof(field), index, "slot"));
                    return;
                }
            }

            SlotEntry& e = r.config.slots[r.config.slot_count++];
            e.slot = static_cast<uint8_t>(slot);
            e.pin_count = static_cast<uint8_t>(count);
            std::memcpy(e.pins, candidate, sizeof(e.pins));
        }

        void read_motor(const cJSON* root, SlotParseResult& r)
        {
            const cJSON* motor = cJSON_GetObjectItemCaseSensitive(root, "motor");
            if (motor == nullptr)
            {
                add_issue(r, ConfigIssueKind::MissingField, "motor");
                return;
            }
            if (!cJSON_IsObject(motor))
            {
                add_issue(r, ConfigIssueKind::WrongType, "motor");
                return;
            }
            long long steps = 0;
            if (read_int(motor, "stepsPerVend", "motor.stepsPerVend", true, STEPS_PER_VEND_MIN, STEPS_PER_VEND_MAX, steps, r)) {
                r.config.steps_per_vend = static_cast<uint16_t>(steps);
            }
        }

        bool only_newer_version_issues(const SlotParseResult& r)
        {
            for (size_t i = 0; i < r.issue_count; ++i)
                if (r.issues[i].kind != ConfigIssueKind::NewerVersion)
                    return false;
            return true;
        }
    }

    SlotParseResult parse_slot_config(const char* json_text)
    {
        if (json_text == nullptr) return invalid(0);

        size_t deep_offset = 0;
        if (nesting_too_deep(json_text, deep_offset)) return invalid(deep_offset);

        cJSON* root = cJSON_Parse(json_text);
        if (root == nullptr)
        {
            const char* err = cJSON_GetErrorPtr();
            const size_t offset = (err != nullptr && err >= json_text) ? static_cast<size_t>(err - json_text) : 0;
            return invalid(offset);
        }
        if (!cJSON_IsObject(root)) {
            cJSON_Delete(root);
            return invalid(0);
        }

        SlotParseResult r{};
        r.json_valid = true;

        long long version = SLOT_SCHEMA_VERSION;
        if (read_int(root, "version", "version", false, 0, 1000000, version, r) && version > SLOT_SCHEMA_VERSION) {
            add_issue(r, ConfigIssueKind::NewerVersion, "version");
        }

        read_motor(root, r);

        const cJSON* slots = cJSON_GetObjectItemCaseSensitive(root, "slots");
        if (slots == nullptr || !cJSON_IsArray(slots) || cJSON_GetArraySize(slots) == 0)
        {
            add_issue(r, ConfigIssueKind::MissingField, "slots");
        }
        else
        {
            const int count = cJSON_GetArraySize(slots);
            if (static_cast<size_t>(count) > MAX_SLOTS) {
                add_issue(r, ConfigIssueKind::TooManySlots, "slots");
            }

            size_t index = 0;
            const cJSON* item = nullptr;
            cJSON_ArrayForEach(item, slots)
            {
                if (index >= MAX_SLOTS) break;
                read_entry(item, index, r);
                ++index;
            }
        }
        cJSON_Delete(root);

        r.ok = only_newer_version_issues(r);
        if (!r.ok)
        {
            r.config.steps_per_vend = 0;
            r.config.slot_count = 0;
            std::memset(r.config.slots, 0, sizeof(r.config.slots));
        }
        return r;
    }
}
```

- [ ] **Step 7: Run all vmaas-config suites**

From `shared/vmaas-config`: `$PIO test -e native`
Expected: every suite passes. `test_parse` 16 tests, `test_validate` 23 tests, the device and issue suites unchanged.

- [ ] **Step 8: Rewrite the README schema section**

In `shared/vmaas-config/README.md`, replace the section from `## Rules` through the end of the schema table (just before `## API`) with:

```markdown
## Rules

- There is **no default wiring and no default step count** in firmware. Without
  a valid file Motorcontrol refuses every RUN/STOP/CONFIG with `NAK CONFIG_ERROR`,
  reports `State::ERROR` in STATUS_REPLY, and restarts every 30 s (at most 100
  times per power-on). Main-Controller shows `MOTOR CONFIG ERR` on its display
  meanwhile.
- `motor.stepsPerVend` is required: STEP pulses emitted per RUN. 6400 is one
  revolution of a 200-step motor at 1/32 microstepping.
- `slots` is required and must be a non-empty array of `{ "slot", "pins" }`
  objects. `pins` are the nENABLE GPIOs of the slot's DRV8825 drivers (the STEP
  line is shared and is a firmware constant). Any problem in any entry makes
  the whole file unusable: no partial wiring is ever applied.
- Unknown keys are ignored, so the file can grow before the firmware does.
- Nesting deeper than 8 levels is rejected before parsing (the schema is depth 4).
- Secrets (WiFi, MQTT, tokens) do **not** belong here.

## Schema, version 2

```json
{
  "version": 2,
  "motor": { "stepsPerVend": 6400 },
  "slots": [
    { "slot": 1, "pins": [18] },
    { "slot": 2, "pins": [19] },
    { "slot": 3, "pins": [21, 22] }
  ]
}
```

| Field                | Type    | Rule                                                          |
|----------------------|---------|---------------------------------------------------------------|
| `version`            | integer | Optional. Higher than 2 gives `NewerVersion`, file still usable |
| `motor`              | object  | Required (`MissingField`)                                     |
| `motor.stepsPerVend` | integer | Required, 1–65535 (`MissingField` / `OutOfRange`)             |
| `slots`              | array   | Required, 1–32 entries (`MissingField` / `TooManySlots`)      |
| `slots[i].slot`      | integer | 1–255, unique across the table (`DuplicateSlot` on the later entry) |
| `slots[i].pins`      | array   | Required, 1–6 integers (`MissingField` / `OutOfRange` on the array) |
| `slots[i].pins[j]`   | integer | 0–33, unique across the whole file (`DuplicatePin` on the later pin). 34–39 are input-only (`InputOnlyPin`) |

The v1 `"pin"` scalar is not accepted. Issue field names use the zero-based
index, e.g. `slots[2].pins[1]`.
```

Also in the `## API` example further down, change `use(r.config.slots, r.config.slot_count);` to `use(r.config.steps_per_vend, r.config.slots, r.config.slot_count);`.

- [ ] **Step 9: Verify**

`$PIO test -e native` from `shared/vmaas-config` is green. `git diff --stat shared/vmaas-config` lists the six files. Do not commit.

---

### Task 3: `RUN_TIME_MS` leaves the protocol

`ConfigParam` is emptied, `frames::config()` goes, and `PROTOCOL.md` describes the stepper semantics. `WIRING_*` frames are Plan B's; this task only touches what exists.

**Files:**
- Modify: `shared/vmaas-protocol/src/protocol.h`
- Modify: `shared/vmaas-protocol/PROTOCOL.md`
- Test: `shared/vmaas-protocol/test/test_protocol/test_main.cpp`
- Test: `shared/vmaas-protocol/test/test_frame_codec/test_main.cpp`

**Interfaces:**
- Consumes: nothing.
- Produces: `enum class vmaas::ConfigParam : uint8_t {}` (no values); `frames::config` no longer exists. `Cmd::CONFIG`, `ErrorCode::BAD_PARAM` unchanged.

- [ ] **Step 1: Update the two tests first**

In `shared/vmaas-protocol/test/test_protocol/test_main.cpp`, replace `test_builder_config_is_little_endian` (the whole function) with:

```cpp
// CONFIG has no parameters since stepsPerVend moved into config.json, but the
// opcode and its wire layout (param u8, value u16) are kept so a stale
// Main-Controller gets a well-formed NAK BAD_PARAM rather than UNKNOWN_CMD.
void test_config_opcode_is_reserved_with_no_params()
{
    TEST_ASSERT_EQUAL_HEX8(0x13, static_cast<uint8_t>(Cmd::CONFIG));
    TEST_ASSERT_EQUAL_UINT8(5, static_cast<uint8_t>(ErrorCode::BAD_PARAM));
}
```

and in `main()` replace `RUN_TEST(test_builder_config_is_little_endian);` with `RUN_TEST(test_config_opcode_is_reserved_with_no_params);`.

In `shared/vmaas-protocol/test/test_frame_codec/test_main.cpp`, add this helper directly after the `using namespace vmaas;` line (line 5; the file has no anonymous namespace yet):

```cpp
namespace
{
    // A CONFIG frame built by hand: the builder was removed with RUN_TIME_MS,
    // but the codec must still round-trip the 3-byte layout.
    Frame raw_config(uint8_t param, uint16_t value)
    {
        Frame f;
        f.cmd = Cmd::CONFIG;
        f.len = 3;
        f.payload[0] = param;
        f.payload[1] = static_cast<uint8_t>(value & 0xFF);
        f.payload[2] = static_cast<uint8_t>(value >> 8);
        return f;
    }
}
```

Then replace `frames::config(ConfigParam::RUN_TIME_MS, 500)` with `raw_config(1, 500)` and `frames::config(ConfigParam::RUN_TIME_MS, 1234)` with `raw_config(1, 1234)`.

- [ ] **Step 2: Run the protocol suites to verify they fail**

From `shared/vmaas-protocol`: `$PIO test -e native`
Expected: the codec suite still compiles and passes (nothing removed yet); `test_protocol` compiles. This step confirms the tests no longer reference `frames::config`, so Step 3 can remove it without breaking them.

- [ ] **Step 3: Edit `protocol.h`**

Replace the `ConfigParam` enum:

```cpp
    /**
     * @brief Parameter id in the first payload byte of a CONFIG request.
     *
     * Empty since the stepper redesign: the only parameter, RUN_TIME_MS, was
     * replaced by motor.stepsPerVend in Motorcontrol's config.json, which the
     * backend publishes. The CONFIG opcode and its 3-byte layout (param u8,
     * value u16 LE) are kept reserved; Motorcontrol answers every param with
     * NAK BAD_PARAM.
     */
    enum class ConfigParam : uint8_t
    {
    };
```

Delete the whole `frames::config(...)` function (the `/** @brief Build a CONFIG request ... */` block and its body).

Update the `ErrorCode::BUSY` comment to `///< RUN received while a vend is already in progress.` and `ErrorCode::BAD_PARAM` to `///< CONFIG param id is not recognised (no params are defined).`. Update `State::BUSY` to `///< A vend is in progress; current_slot names it.`.

- [ ] **Step 4: Run the protocol suites to verify they pass**

From `shared/vmaas-protocol`: `$PIO test -e native`
Expected: all three suites green (`test_crc8`, `test_frame_codec`, `test_protocol`).

- [ ] **Step 5: Update `PROTOCOL.md`**

Apply these edits to `shared/vmaas-protocol/PROTOCOL.md`:

1. In the Requests table, change the CONFIG row to:
   ```
   | `0x13` | CONFIG | `param` u8, `value` u16 LE. Reserved: no params are defined, always `NAK BAD_PARAM`. |
   ```
2. In the Replies table, change the DONE row to:
   ```
   | `0x82` | DONE         | `slot` u8. Sent once every STEP pulse of the vend has been emitted. |
   ```
3. Replace the `CONFIG params:` table (heading line and its two-row table) with:
   ```
   CONFIG params: none. `RUN_TIME_MS` (id 1) was removed when the motors became
   steppers; the pulse count per vend is `motor.stepsPerVend` in Motorcontrol's
   `config.json` (see `shared/vmaas-config/README.md`) and the pulse interval is
   a firmware constant on Motorcontrol.
   ```
4. Replace the "Normal vend" flow block with:
   ```
   Main  -> Motor : RUN 3
   Motor -> Main  : ACK RUN
                    (slot 3's drivers are enabled, one tick later stepsPerVend
                     STEP pulses are emitted on the shared line, then the
                     drivers are disabled - about 2 s at the defaults)
   Motor -> Main  : DONE 3
   ```
5. Replace the STOP sentence with: `STOP while a vend is in progress: `ACK STOP`, the step generator stops, the slot's drivers are disabled, no DONE for the interrupted slot.`
6. Replace the CONFIG flow block with:
   ```
   Main  -> Motor : CONFIG 1 200
   Motor -> Main  : NAK CONFIG BAD_PARAM     (no params are defined)
   ```
7. Replace the `## Not in v1` section with:
   ```
   ## Timeouts

   Motorcontrol has none. Main-Controller fails a paid sale and sends STOP when
   no DONE or NAK has arrived `timings.dispense_timeout_ms` (default 30 s,
   Main-Controller `config.json`) after RUN. No retries or sequence numbers; at
   most one request is in flight.
   ```
8. In the "Wiring" section's first line, the GPIO claims about both boards are stale for Main-Controller (it uses GPIO32/33). Change the sentence to: `Motorcontrol uses TX = GPIO17 and RX = GPIO16; Main-Controller uses TX = GPIO33 and RX = GPIO32 (see each project's `pins.h`), so the link is crossed:` and the diagram to:
   ```
       Main-Controller GPIO33 (TX)  ->  Motorcontrol GPIO16 (RX)
       Main-Controller GPIO32 (RX)  <-  Motorcontrol GPIO17 (TX)
       Main-Controller GND          --  Motorcontrol GND
   ```

- [ ] **Step 6: Verify**

`grep -n "RUN_TIME_MS" shared/vmaas-protocol/src/protocol.h` prints nothing. `grep -n "RUN_TIME_MS" shared/vmaas-protocol/PROTOCOL.md` prints only the one historical sentence under "CONFIG params". `$PIO test -e native` from `shared/vmaas-protocol` is green. Do not commit.

---

### Task 4: Dispense timeout in `shared/vmaas-purchase`

A paid sale in `Dispensing` fails after `dispense_timeout_ms` and asks the caller to send STOP.

**Files:**
- Modify: `shared/vmaas-purchase/src/purchase.h`
- Modify: `shared/vmaas-purchase/src/purchase.cpp`
- Test: `shared/vmaas-purchase/test/test_dispense_timeout/test_main.cpp` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `PurchaseConfig::dispense_timeout_ms` (`uint32_t`, default 30000, 0 disables)
  - `PurchaseOutput::stop_motor` (`bool`, one-shot)

- [ ] **Step 1: Write the failing tests**

`shared/vmaas-purchase/test/test_dispense_timeout/test_main.cpp`:

```cpp
/**
 * @file test_main.cpp
 * @brief Host tests for the DONE timeout: a paid vend whose DONE never comes
 *        must fail exactly once, ask for STOP, and not be resurrected by a
 *        late DONE.
 *
 * Money outcome in every case: the customer paid, the sale is booked Failed.
 */
#include <unity.h>
#include "purchase.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

namespace
{
    PurchaseConfig cfg(uint32_t dispense_timeout_ms)
    {
        PurchaseConfig c;
        c.payment_timeout_ms = 60000;
        c.has_inhibit = true;
        c.dispense_timeout_ms = dispense_timeout_ms;
        return c;
    }

    // Slot 3 at 15 kr, paid with 20 kr at t=2000. RUN is issued at t=2000.
    Purchase paid(uint32_t dispense_timeout_ms)
    {
        Purchase p(cfg(dispense_timeout_ms));
        p.slot_chosen(3, 1500, 1000);
        const PurchaseOutput o = p.coin(2000, 2000);
        TEST_ASSERT_TRUE(o.run_slot);
        TEST_ASSERT_EQUAL(PurchaseState::Dispensing, o.state);
        return p;
    }
}

void test_default_dispense_timeout_is_thirty_seconds()
{
    PurchaseConfig c;
    TEST_ASSERT_EQUAL_UINT32(30000, c.dispense_timeout_ms);
}

void test_no_done_before_the_deadline_keeps_dispensing()
{
    Purchase p = paid(30000);
    const PurchaseOutput o = p.tick(2000 + 29999);
    TEST_ASSERT_EQUAL(PurchaseState::Dispensing, o.state);
    TEST_ASSERT_FALSE(o.settle_sale);
    TEST_ASSERT_FALSE(o.stop_motor);
}

void test_timeout_fails_the_sale_once_and_asks_for_stop()
{
    Purchase p = paid(30000);
    const PurchaseOutput o = p.tick(2000 + 30000);
    TEST_ASSERT_EQUAL(PurchaseState::Settled, o.state);
    TEST_ASSERT_TRUE(o.settle_sale);
    TEST_ASSERT_EQUAL(SaleStatus::Failed, o.sale_status);
    TEST_ASSERT_TRUE(o.stop_motor);
    TEST_ASSERT_EQUAL_UINT32(2000, o.credit_minor); // what was received, for the sale line

    // One-shots are consumed: the next pass books nothing and stops nothing.
    const PurchaseOutput again = p.tick(2000 + 30001);
    TEST_ASSERT_EQUAL(PurchaseState::Settled, again.state);
    TEST_ASSERT_FALSE(again.settle_sale);
    TEST_ASSERT_FALSE(again.stop_motor);
}

void test_done_just_before_the_deadline_completes_the_sale()
{
    Purchase p = paid(30000);
    p.tick(2000 + 29999);
    const PurchaseOutput o = p.dispense_done(2000 + 29999);
    TEST_ASSERT_EQUAL(PurchaseState::Settled, o.state);
    TEST_ASSERT_EQUAL(SaleStatus::Completed, o.sale_status);
    TEST_ASSERT_TRUE(o.settle_sale);
    TEST_ASSERT_FALSE(o.stop_motor);

    // The deadline passing afterwards changes nothing.
    const PurchaseOutput later = p.tick(2000 + 30000);
    TEST_ASSERT_EQUAL(PurchaseState::Settled, later.state);
    TEST_ASSERT_FALSE(later.settle_sale);
    TEST_ASSERT_FALSE(later.stop_motor);
}

void test_late_done_after_timeout_is_ignored()
{
    Purchase p = paid(30000);
    p.tick(2000 + 30000);
    const PurchaseOutput o = p.dispense_done(2000 + 30500);
    TEST_ASSERT_EQUAL(PurchaseState::Settled, o.state);
    TEST_ASSERT_EQUAL(SaleStatus::Failed, o.sale_status);
    TEST_ASSERT_FALSE(o.settle_sale);
    TEST_ASSERT_FALSE(o.stop_motor);
}

void test_zero_disables_the_dispense_timeout()
{
    Purchase p = paid(0);
    const PurchaseOutput o = p.tick(2000 + 600000);
    TEST_ASSERT_EQUAL(PurchaseState::Dispensing, o.state);
    TEST_ASSERT_FALSE(o.settle_sale);
    TEST_ASSERT_FALSE(o.stop_motor);
}

void test_dispense_timeout_does_not_tick_in_other_states()
{
    Purchase idle(cfg(30000));
    TEST_ASSERT_EQUAL(PurchaseState::Idle, idle.tick(100000).state);
    TEST_ASSERT_FALSE(idle.tick(100001).stop_motor);

    Purchase awaiting(cfg(30000));
    awaiting.slot_chosen(3, 1500, 1000);
    const PurchaseOutput a = awaiting.tick(1000 + 30000); // under the 60 s payment timeout
    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, a.state);
    TEST_ASSERT_FALSE(a.stop_motor);
}

// The deadline counts from the moment RUN is issued, whichever event issued it.
void test_deadline_counts_from_the_run_not_the_slot_choice()
{
    Purchase p(cfg(30000));
    p.slot_chosen(3, 1500, 1000);
    p.coin(1000, 5000);
    p.coin(1000, 9000); // paid here, RUN at t=9000
    TEST_ASSERT_EQUAL(PurchaseState::Dispensing, p.tick(9000 + 29999).state);
    const PurchaseOutput o = p.tick(9000 + 30000);
    TEST_ASSERT_EQUAL(PurchaseState::Settled, o.state);
    TEST_ASSERT_TRUE(o.stop_motor);
}

void test_reset_clears_a_pending_stop_motor()
{
    Purchase p = paid(30000);
    p.tick(2000 + 30000); // consumes stop_motor via out()
    const PurchaseOutput r = p.reset();
    TEST_ASSERT_EQUAL(PurchaseState::Idle, r.state);
    TEST_ASSERT_FALSE(r.stop_motor);
    TEST_ASSERT_FALSE(r.settle_sale);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_default_dispense_timeout_is_thirty_seconds);
    RUN_TEST(test_no_done_before_the_deadline_keeps_dispensing);
    RUN_TEST(test_timeout_fails_the_sale_once_and_asks_for_stop);
    RUN_TEST(test_done_just_before_the_deadline_completes_the_sale);
    RUN_TEST(test_late_done_after_timeout_is_ignored);
    RUN_TEST(test_zero_disables_the_dispense_timeout);
    RUN_TEST(test_dispense_timeout_does_not_tick_in_other_states);
    RUN_TEST(test_deadline_counts_from_the_run_not_the_slot_choice);
    RUN_TEST(test_reset_clears_a_pending_stop_motor);
    return UNITY_END();
}
```

- [ ] **Step 2: Run it to verify it fails**

From `shared/vmaas-purchase`: `$PIO test -e native -f test_dispense_timeout`
Expected: compile error, `dispense_timeout_ms` and `stop_motor` are not members.

- [ ] **Step 3: Extend the header**

In `shared/vmaas-purchase/src/purchase.h`:

Add to `PurchaseOutput`, after `sale_status`:

```cpp
        /// Send STOP to Motorcontrol now. Set once, on the dispense timeout,
        /// so a motor that is genuinely stuck is switched off; harmless when
        /// the DONE was merely lost, because STOP is idempotent.
        bool       stop_motor = false;
```

Add to `PurchaseConfig`, after `payment_timeout_ms`:

```cpp
        /// How long Dispensing waits for DONE or NAK before the sale is booked
        /// Failed and STOP is requested. 0 disables the timeout. Must exceed
        /// the longest vend Motorcontrol can be configured for: 65535 steps at
        /// STEP_INTERVAL_US = 312 is 20.4 s, so 30 s leaves margin. A false
        /// timeout is worse than a slow failure - it books a successful vend as
        /// Failed while the customer holds the item.
        uint32_t dispense_timeout_ms = 30000;
```

Add to the private section of `Purchase`, after `last_activity_ms_`:

```cpp
        uint32_t   dispense_started_ms_ = 0; ///< When RUN was issued; the dispense deadline counts from here.
        bool       stop_motor_ = false;
```

Update the doc comment on `tick()` to: `/// Call every loop pass. This is what enforces payment_timeout_ms and dispense_timeout_ms.`

- [ ] **Step 4: Extend the implementation**

In `shared/vmaas-purchase/src/purchase.cpp`:

In `out()`, after `o.sale_status = sale_status_;` add `o.stop_motor = stop_motor_;` and after `settle_sale_ = false;` add `stop_motor_ = false;`. Extend the one-shot comment to mention `stop_motor`.

In `slot_chosen()` and in `coin()`, at both places that do `run_slot_ = true; state_ = PurchaseState::Dispensing;`, add `dispense_started_ms_ = now_ms;` after the state assignment.

Replace `tick()` with:

```cpp
    PurchaseOutput Purchase::tick(uint32_t now_ms)
    {
        if (state_ == PurchaseState::AwaitingPayment &&
            cfg_.payment_timeout_ms > 0 &&
            now_ms - last_activity_ms_ >= cfg_.payment_timeout_ms)
        {
            state_ = PurchaseState::Settled;
            sale_status_ = SaleStatus::None;
        }

        // A paid vend with no DONE and no NAK: the customer is waiting and the
        // motor may still be turning. Book the sale Failed - that is the honest
        // record when nothing confirmed delivery - and ask for STOP.
        if (state_ == PurchaseState::Dispensing &&
            cfg_.dispense_timeout_ms > 0 &&
            now_ms - dispense_started_ms_ >= cfg_.dispense_timeout_ms)
        {
            state_ = PurchaseState::Settled;
            sale_status_ = SaleStatus::Failed;
            settle_sale_ = true;
            stop_motor_ = true;
            last_activity_ms_ = now_ms;
        }

        return out();
    }
```

In `reset()`, add `stop_motor_ = false;` after `settle_sale_ = false;`.

- [ ] **Step 5: Run the whole purchase suite**

From `shared/vmaas-purchase`: `$PIO test -e native`
Expected: `test_dispense_timeout` 9 tests green, and the three existing suites unchanged and green (they set `payment_timeout_ms` explicitly and never wait 30 s in `Dispensing`).

- [ ] **Step 6: Verify**

`git diff --stat shared/vmaas-purchase` shows the two source files; the new test folder is untracked. Do not commit.

---

### Task 5: `timings.dispense_timeout_ms` in the device config

The Main-Controller `config.json` timing that feeds Task 4. Unlike the other timings, 0 is legal here (it disables the timeout).

**Files:**
- Modify: `shared/vmaas-config/src/device_config.h`
- Modify: `shared/vmaas-config/src/device_config_parser.cpp`
- Modify: `Main-Controller/data/config.json`
- Test: `shared/vmaas-config/test/test_device_parse/test_main.cpp`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DeviceConfig::dispense_timeout_ms` (`uint32_t`, default 30000).

- [ ] **Step 1: Write the failing tests**

Append to `shared/vmaas-config/test/test_device_parse/test_main.cpp`, before `int main`:

```cpp
void test_dispense_timeout_is_read()
{
    const DeviceParseResult r = parse_device_config(R"({"version":4,"timings":{"dispense_timeout_ms":45000}})");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(45000, r.config.dispense_timeout_ms);
}

void test_absent_dispense_timeout_defaults_to_thirty_seconds()
{
    const DeviceParseResult r = parse_device_config(R"({"version":4,"timings":{"keypad_debounce_ms":20}})");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(30000, r.config.dispense_timeout_ms);
    TEST_ASSERT_EQUAL_UINT32(30000, device_config_defaults().dispense_timeout_ms);
}

// Zero means "no timeout", so it is a value here, not an error like the other timings.
void test_zero_dispense_timeout_is_accepted()
{
    const DeviceParseResult r = parse_device_config(R"({"version":4,"timings":{"dispense_timeout_ms":0}})");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT(0, r.issue_count);
    TEST_ASSERT_EQUAL_UINT32(0, r.config.dispense_timeout_ms);
}

void test_over_long_dispense_timeout_is_refused_and_defaulted()
{
    const DeviceParseResult r = parse_device_config(R"({"version":4,"timings":{"dispense_timeout_ms":600001}})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL(ConfigIssueKind::OutOfRange, r.issues[0].kind);
    TEST_ASSERT_EQUAL_STRING("timings.dispense_timeout_ms", r.issues[0].field);
    TEST_ASSERT_EQUAL_UINT32(30000, r.config.dispense_timeout_ms);
}
```

and add to `main()` before `return UNITY_END();`:

```cpp
    RUN_TEST(test_dispense_timeout_is_read);
    RUN_TEST(test_absent_dispense_timeout_defaults_to_thirty_seconds);
    RUN_TEST(test_zero_dispense_timeout_is_accepted);
    RUN_TEST(test_over_long_dispense_timeout_is_refused_and_defaulted);
```

- [ ] **Step 2: Run it to verify it fails**

From `shared/vmaas-config`: `$PIO test -e native -f test_device_parse`
Expected: compile error, `dispense_timeout_ms` is not a member of `DeviceConfig`.

- [ ] **Step 3: Add the field**

In `shared/vmaas-config/src/device_config.h`:

In the schema example in the file comment, extend the `"timings"` line to end with `"door_unlock_ms": 500, "dispense_timeout_ms": 30000 }`.

Add to `DeviceConfig`, after `door_unlock_ms`:

```cpp
        /// How long a paid sale waits for Motorcontrol's DONE (or NAK) before
        /// it is booked Failed and STOP is sent. 0 disables the timeout. Must
        /// stay above the longest vend Motorcontrol can be configured for
        /// (stepsPerVend x STEP_INTERVAL_US): 65535 x 312 us is 20.4 s, so 30 s
        /// leaves margin. Raise it if STEP_INTERVAL_US is raised on Motorcontrol.
        uint32_t dispense_timeout_ms;
```

In `shared/vmaas-config/src/device_config_parser.cpp`:

In `device_config_defaults()`, after `c.door_unlock_ms = 500;` add `c.dispense_timeout_ms = 30000;`.

In `parse_device_config()`, inside the `timings` block after the `door_unlock_ms` braces, add:

```cpp
            {
                // 0 is a value here (timeout off), so the floor is 0, not TIMING_MIN.
                long long v = r.config.dispense_timeout_ms;
                read_int(r, timings, "dispense_timeout_ms", 0, TIMING_MAX, "timings.dispense_timeout_ms", v);
                r.config.dispense_timeout_ms = static_cast<uint32_t>(v);
            }
```

- [ ] **Step 4: Run the suites**

From `shared/vmaas-config`: `$PIO test -e native`
Expected: all green, `test_device_parse` now 4 tests longer.

- [ ] **Step 5: Add the key to the flashed file**

In `Main-Controller/data/config.json`, inside `"timings"`, add after `"door_unlock_ms": 500`:

```json
    "door_unlock_ms": 500,
    "dispense_timeout_ms": 30000
```

(Keep the file valid JSON: a comma after `500`, none after `30000`.)

- [ ] **Step 6: Verify**

`$PY -c "import json;json.load(open('Main-Controller/data/config.json'))"` from the repo root prints nothing (valid JSON). `$PIO test -e native` from `shared/vmaas-config` is green. Do not commit.

---

### Task 6: `StepGenerator` and the Motorcontrol constants

The hardware pulse source. Compiles into the firmware but is not yet called; Task 7 wires it in.

**Files:**
- Modify: `Motorcontrol/src/pins.h`
- Create: `Motorcontrol/src/config.h`
- Create: `Motorcontrol/src/step_generator.h`
- Create: `Motorcontrol/src/step_generator.cpp`

**Interfaces:**
- Consumes: `Pins::STEP`, `Config::STEP_INTERVAL_US`.
- Produces:
  - `class IStepGenerator { virtual void start(uint32_t steps) = 0; virtual void stop() = 0; virtual bool done() const = 0; }`
  - `class StepGenerator : public IStepGenerator { StepGenerator(gpio_num_t step_pin, uint32_t interval_us); esp_err_t begin(); }`

- [ ] **Step 1: Add the constants**

Replace `Motorcontrol/src/pins.h` with:

```cpp
#pragma once
/**
 * @file pins.h
 * @brief GPIO assignments for the Motorcontrol board.
 *
 * The motor nENABLE pins are NOT here: they come from /storage/config.json
 * (one per driver, published by the backend). Only the fixed board wiring is.
 */

/// Motorcontrol pin numbers.
namespace Pins
{
    constexpr int UART_TX = 17; ///< Transmits to Main-Controller's RX (GPIO32).
    constexpr int UART_RX = 16; ///< Receives from Main-Controller's TX (GPIO33).

    /// Shared STEP line, wired in parallel to every DRV8825's STEP input. The
    /// devkit's blue LED sits on GPIO4, so it flickers while a motor turns.
    /// Must be below 32: StepGenerator writes GPIO.out_w1ts/out_w1tc directly.
    constexpr int STEP = 4;
}
```

Create `Motorcontrol/src/config.h`:

```cpp
#pragma once
/**
 * @file config.h
 * @brief Compile-time settings for the Motorcontrol firmware.
 */
#include <cstdint>

/// Motorcontrol configuration.
namespace Config
{
    /// Full STEP period in microseconds; half of it is the gptimer alarm.
    /// 312 us x 6400 steps = 2.0 s per revolution of a 200-step motor at 1/32
    /// microstepping. DRV8825 needs at least 1.9 us high and low; we give 156.
    ///
    /// Raising this slows every vend on this board. Main-Controller's
    /// `timings.dispense_timeout_ms` (default 30 s) must stay above
    /// stepsPerVend x STEP_INTERVAL_US for the largest stepsPerVend the admin
    /// UI allows (65535), so raise that too.
    constexpr uint32_t STEP_INTERVAL_US = 312;
}
```

- [ ] **Step 2: Write the generator header**

`Motorcontrol/src/step_generator.h`:

```cpp
#pragma once
/**
 * @file step_generator.h
 * @brief Emits a fixed number of STEP pulses on the shared line from a
 *        hardware timer, so the main loop and the UART stay free during a vend.
 */
#include <cstdint>
#include "driver/gpio.h"
#include "driver/gptimer.h"
#include "esp_err.h"

/**
 * @brief What CommandHandler needs from a pulse source. Split out so the
 *        handler can be exercised with a fake on the host later.
 */
class IStepGenerator
{
public:
    virtual ~IStepGenerator() = default;
    /// Begin emitting @p steps pulses. STEP is low on entry and after the last pulse.
    virtual void start(uint32_t steps) = 0;
    /// Stop now and drive STEP low. Safe in any state, including never started.
    virtual void stop() = 0;
    /// True once every pulse of the last start() has been emitted. Stays true until the next start().
    virtual bool done() const = 0;
};

/**
 * @brief gptimer-driven implementation of IStepGenerator.
 *
 * One general-purpose timer at 1 MHz fires an alarm every half period. The
 * ISR toggles STEP and counts edges down. When the count reaches zero STEP is
 * low (an even number of edges always ends low) and `done` is set; the ISR
 * then does nothing until stop() is called from task context, which is the
 * only place the timer is stopped. That keeps the ISR free of driver calls:
 * it writes two GPIO registers and three fields, nothing else.
 */
class StepGenerator : public IStepGenerator
{
public:
    /**
     * @param step_pin GPIO of the shared STEP line. Must be 0-31.
     * @param interval_us Full STEP period; the alarm fires every interval_us / 2.
     */
    StepGenerator(gpio_num_t step_pin, uint32_t interval_us);

    /**
     * @brief Configure the GPIO as output low and create, arm and enable the timer.
     * Call once. The timer is enabled but not running until start().
     */
    esp_err_t begin();

    void start(uint32_t steps) override;
    void stop() override;
    bool done() const override { return done_; }

private:
    static bool on_alarm(gptimer_handle_t timer, const gptimer_alarm_event_data_t* edata, void* ctx);

    gpio_num_t pin_;
    uint32_t pin_mask_;
    uint32_t half_period_us_;
    gptimer_handle_t timer_ = nullptr;
    bool running_ = false; ///< Task-side mirror of the timer state; gptimer_stop() on a stopped timer is an error.

    // Written by the ISR while the timer runs; written by start()/stop() only with it stopped.
    volatile uint32_t remaining_edges_ = 0;
    volatile bool level_ = false;
    volatile bool done_ = false;
};
```

- [ ] **Step 3: Write the generator implementation**

`Motorcontrol/src/step_generator.cpp`:

```cpp
/**
 * @file step_generator.cpp
 * @brief gptimer ISR pulse source. See step_generator.h.
 */
#include "step_generator.h"

#include "esp_attr.h"
#include "esp_log.h"
#include "soc/gpio_struct.h"

namespace
{
    constexpr const char* TAG = "StepGen";
    constexpr uint32_t TIMER_RESOLUTION_HZ = 1000000; // 1 us per count
}

StepGenerator::StepGenerator(gpio_num_t step_pin, uint32_t interval_us)
    : pin_(step_pin), pin_mask_(1u << static_cast<uint32_t>(step_pin)), half_period_us_(interval_us / 2)
{
}

esp_err_t StepGenerator::begin()
{
    if (static_cast<int>(pin_) < 0 || static_cast<int>(pin_) > 31)
    {
        ESP_LOGE(TAG, "STEP pin %d must be 0-31 for direct register writes", static_cast<int>(pin_));
        return ESP_ERR_INVALID_ARG;
    }
    if (half_period_us_ < 2)
    {
        ESP_LOGE(TAG, "interval too short: DRV8825 needs >= 1.9 us per level");
        return ESP_ERR_INVALID_ARG;
    }

    gpio_reset_pin(pin_);
    gpio_set_level(pin_, 0);
    gpio_set_direction(pin_, GPIO_MODE_OUTPUT);
    gpio_set_level(pin_, 0);

    gptimer_config_t cfg = {};
    cfg.clk_src = GPTIMER_CLK_SRC_DEFAULT;
    cfg.direction = GPTIMER_COUNT_UP;
    cfg.resolution_hz = TIMER_RESOLUTION_HZ;
    cfg.intr_priority = 0;
    esp_err_t err = gptimer_new_timer(&cfg, &timer_);
    if (err != ESP_OK) return err;

    gptimer_event_callbacks_t cbs = {};
    cbs.on_alarm = &StepGenerator::on_alarm;
    err = gptimer_register_event_callbacks(timer_, &cbs, this);
    if (err != ESP_OK) return err;

    gptimer_alarm_config_t alarm = {};
    alarm.alarm_count = half_period_us_;
    alarm.reload_count = 0;
    alarm.flags.auto_reload_on_alarm = true;
    err = gptimer_set_alarm_action(timer_, &alarm);
    if (err != ESP_OK) return err;

    err = gptimer_enable(timer_);
    if (err != ESP_OK) return err;

    ESP_LOGI(TAG, "STEP on GPIO %d, %lu us period (%lu us alarm)", static_cast<int>(pin_),
             static_cast<unsigned long>(half_period_us_ * 2), static_cast<unsigned long>(half_period_us_));
    return ESP_OK;
}

void StepGenerator::start(uint32_t steps)
{
    stop(); // idempotent; guarantees the ISR is not running while we write the counters
    remaining_edges_ = steps * 2;
    level_ = false;
    done_ = (steps == 0);
    if (steps == 0) return;

    gptimer_set_raw_count(timer_, 0);
    if (gptimer_start(timer_) == ESP_OK) {
        running_ = true;
    }
    else {
        ESP_LOGE(TAG, "timer did not start");
        done_ = true; // let the sequencer finish rather than hang in Stepping
    }
}

void StepGenerator::stop()
{
    if (running_)
    {
        gptimer_stop(timer_);
        running_ = false;
    }
    remaining_edges_ = 0;
    level_ = false;
    GPIO.out_w1tc = pin_mask_;
}

// ISR context. No driver calls, no logging, no allocation.
bool IRAM_ATTR StepGenerator::on_alarm(gptimer_handle_t, const gptimer_alarm_event_data_t*, void* ctx)
{
    StepGenerator* self = static_cast<StepGenerator*>(ctx);
    if (self->remaining_edges_ == 0) return false;

    self->level_ = !self->level_;
    if (self->level_) {
        GPIO.out_w1ts = self->pin_mask_;
    }
    else {
        GPIO.out_w1tc = self->pin_mask_;
    }

    if (--self->remaining_edges_ == 0) {
        self->done_ = true; // STEP is low here: an even edge count always ends low
    }
    return false; // no high-priority task was woken
}
```

- [ ] **Step 4: Build the firmware**

From `Motorcontrol`: `$PIO run -e controller-motor`
Expected: SUCCESS. If the build fails with `driver/gptimer.h: No such file or directory`, the app component's implicit requirements do not include the timer driver on this toolchain. Then replace `Motorcontrol/src/CMakeLists.txt` with:

```cmake
# PlatformIO generates this file when it is absent. It is committed, and edited
# by hand, because naming any REQUIRES replaces the implicit set: everything
# the app includes has to be listed here or the build fails with "No such file
# or directory", not with a link error.

FILE(GLOB_RECURSE app_sources ${CMAKE_SOURCE_DIR}/src/*.*)

idf_component_register(
    SRCS ${app_sources}
    REQUIRES
        driver              # gpio, gptimer, uart
        esp_timer
        esp_partition
        spi_flash
        joltwallet__littlefs
)
```

and build again. (`gptimer_set_raw_count` is declared in `driver/gptimer.h` in ESP-IDF 6.1; if it is reported missing, remove that line; the counter restarts from the reload value on the first alarm anyway.)

- [ ] **Step 5: Verify**

Build is green. Flash size in the build summary is noted for the record (the generator adds under 2 KB). Do not commit.

---

### Task 7: Motorcontrol runs the sequencer

`CommandHandler` takes the `SlotConfig` and the generator, delegates to `VendSequencer`, and drives nENABLE pins with the right polarity. `main.cpp` raises the pins before anything else and rejects reserved pins. The dev `config.json` becomes v2.

**Files:**
- Modify: `Motorcontrol/src/command_handler.h`
- Modify: `Motorcontrol/src/command_handler.cpp`
- Modify: `Motorcontrol/src/config_store.h`
- Modify: `Motorcontrol/src/config_store.cpp`
- Modify: `Motorcontrol/src/main.cpp`
- Modify: `Motorcontrol/data/config.json`

**Interfaces:**
- Consumes: `vmaas::SlotConfig` (Task 2), `vmaas::VendSequencer` / `VendActions` (Task 1), `IStepGenerator` / `StepGenerator` (Task 6), `Pins::STEP`, `Config::STEP_INTERVAL_US`.
- Produces:
  - `CommandHandler(vmaas::UartBus& bus, const vmaas::SlotConfig& cfg, IStepGenerator& gen)`
  - `bool config_store::uses_reserved_pin(const vmaas::SlotConfig&, char* reason, size_t cap)`
  - `void config_store::disable_all_motors(const vmaas::SlotConfig&)`

- [ ] **Step 1: Rewrite `command_handler.h`**

Replace the whole file with:

```cpp
#pragma once
/**
 * @file command_handler.h
 * @brief Motorcontrol's request handler: receives protocol requests from
 *        Main-Controller, runs the dispense sequence, and sends replies.
 */
#include <cstddef>
#include <cstdint>
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "protocol.h"
#include "slot_config.h"
#include "step_generator.h"
#include "uart_bus.h"
#include "vend_sequencer.h"

/**
 * @brief Executes RUN/STOP/STATUS/CONFIG requests against the slot table.
 *
 * The motors are DRV8825 steppers on one shared STEP line with one nENABLE
 * GPIO per driver (active LOW). One vend runs at a time. A RUN replies ACK
 * and hands the slot to a VendSequencer, which decides when to enable the
 * slot's drivers, start the pulse generator, disable them again and send
 * DONE; this class only executes those actions. Every request is answered
 * with ACK, NAK or STATUS_REPLY as specified in PROTOCOL.md.
 */
class CommandHandler
{
public:
    /**
     * @brief Bind the handler to a bus, a validated slot table and a pulse source. All must outlive the handler.
     * @param bus Transport shared with Main-Controller.
     * @param cfg Slot table and pulse count from config.json.
     * @param gen The STEP pulse source.
     */
    CommandHandler(vmaas::UartBus& bus, const vmaas::SlotConfig& cfg, IStepGenerator& gen);

    /**
     * @brief Configure every nENABLE pin as an output driven HIGH (disabled)
     *        and register the frame handler on the bus.
     *
     * Call once after bus.begin().
     */
    void begin();

    /**
     * @brief Advance the vend.
     *
     * Call regularly from the main loop. Moves the sequencer through its
     * settle delay, starts the pulses, and when the generator reports done
     * disables the drivers and sends DONE. Does nothing while idle.
     */
    void tick();

private:
    void handle(const vmaas::Frame& f);
    void handle_run(const vmaas::Frame& f);
    void handle_stop(const vmaas::Frame& f);
    void handle_status(const vmaas::Frame& f);
    void handle_config(const vmaas::Frame& f);

    /** @brief Find a slot's table entry, or nullptr if the slot is unknown. */
    const vmaas::SlotEntry* entry_for(uint8_t slot) const;
    /** @brief Drive every nENABLE pin of a slot. enabled == true means LOW. */
    void set_enabled(const vmaas::SlotEntry& e, bool enabled);
    /** @brief Execute what the sequencer asked for. */
    void act(const vmaas::VendActions& a);
    vmaas::State state() const;

    vmaas::UartBus& bus_;
    const vmaas::SlotConfig& cfg_;
    IStepGenerator& gen_;
    vmaas::VendSequencer seq_;
};
```

- [ ] **Step 2: Rewrite `command_handler.cpp`**

Replace the whole file with:

```cpp
/**
 * @file command_handler.cpp
 * @brief CommandHandler request execution. See command_handler.h.
 */
#include "command_handler.h"
#include "esp_log.h"
#include "freertos/task.h"

using namespace vmaas;

namespace
{
    constexpr const char* TAG = "CmdHandler";
}

CommandHandler::CommandHandler(UartBus& bus, const SlotConfig& cfg, IStepGenerator& gen)
    : bus_(bus), cfg_(cfg), gen_(gen)
{
}

void CommandHandler::begin()
{
    for (size_t i = 0; i < cfg_.slot_count; ++i)
    {
        const SlotEntry& e = cfg_.slots[i];
        for (size_t k = 0; k < e.pin_count; ++k)
        {
            const gpio_num_t pin = static_cast<gpio_num_t>(e.pins[k]);
            gpio_reset_pin(pin);
            gpio_set_level(pin, 1); // nENABLE high = driver disabled
            gpio_set_direction(pin, GPIO_MODE_OUTPUT);
            gpio_set_level(pin, 1);
        }
    }
    bus_.on_frame([this](const Frame& f) { handle(f); });
    ESP_LOGI(TAG, "ready, %u slots, %u steps per vend", (unsigned)cfg_.slot_count, (unsigned)cfg_.steps_per_vend);
}

void CommandHandler::tick()
{
    if (seq_.state() == VendState::Idle) return;
    act(seq_.tick(xTaskGetTickCount(), gen_.done()));
}

State CommandHandler::state() const
{
    return seq_.state() == VendState::Idle ? State::IDLE : State::BUSY;
}

void CommandHandler::handle(const Frame& f)
{
    if (is_reply(f.cmd))
    {
        ESP_LOGW(TAG, "ignoring reply-type frame 0x%02X", (unsigned)f.cmd);
        return;
    }

    switch (f.cmd)
    {
    case Cmd::RUN:    handle_run(f);    break;
    case Cmd::STOP:   handle_stop(f);   break;
    case Cmd::STATUS: handle_status(f); break;
    case Cmd::CONFIG: handle_config(f); break;
    default:
        ESP_LOGW(TAG, "unknown cmd 0x%02X", (unsigned)f.cmd);
        bus_.send(frames::nak(f.cmd, ErrorCode::UNKNOWN_CMD));
        break;
    }
}

void CommandHandler::handle_run(const Frame& f)
{
    if (f.len != 1)
    {
        ESP_LOGW(TAG, "RUN with bad len=%u", f.len);
        bus_.send(frames::nak(Cmd::RUN, ErrorCode::BAD_PAYLOAD));
        return;
    }
    // Policy when a RUN arrives while another is active: reject. The motors
    // share one STEP line, so two vends at once is not even physically possible.
    if (seq_.state() != VendState::Idle)
    {
        ESP_LOGW(TAG, "RUN %u rejected: busy with slot %u", f.payload[0], seq_.current_slot());
        bus_.send(frames::nak(Cmd::RUN, ErrorCode::BUSY));
        return;
    }
    const uint8_t slot = f.payload[0];
    const SlotEntry* e = entry_for(slot);
    if (e == nullptr)
    {
        ESP_LOGW(TAG, "RUN %u rejected: unknown slot", slot);
        bus_.send(frames::nak(Cmd::RUN, ErrorCode::UNKNOWN_SLOT));
        return;
    }

    bus_.send(frames::ack(Cmd::RUN));
    act(seq_.run(slot, cfg_.steps_per_vend, xTaskGetTickCount()));
    ESP_LOGI(TAG, "slot %u: %u driver(s) enabled, %u steps to follow", slot, (unsigned)e->pin_count, (unsigned)cfg_.steps_per_vend);
}

void CommandHandler::handle_stop(const Frame& f)
{
    if (f.len != 0)
    {
        ESP_LOGW(TAG, "STOP with bad len=%u", f.len);
        bus_.send(frames::nak(Cmd::STOP, ErrorCode::BAD_PAYLOAD));
        return;
    }
    if (seq_.state() != VendState::Idle) {
        ESP_LOGI(TAG, "slot %u stopped by request", seq_.current_slot());
    }
    act(seq_.stop());
    bus_.send(frames::ack(Cmd::STOP));
}

void CommandHandler::handle_status(const Frame& f)
{
    if (f.len != 0)
    {
        ESP_LOGW(TAG, "STATUS with bad len=%u", f.len);
        bus_.send(frames::nak(Cmd::STATUS, ErrorCode::BAD_PAYLOAD));
        return;
    }
    bus_.send(frames::status_reply(state(), seq_.current_slot()));
}

void CommandHandler::handle_config(const Frame& f)
{
    if (f.len != 3)
    {
        ESP_LOGW(TAG, "CONFIG with bad len=%u", f.len);
        bus_.send(frames::nak(Cmd::CONFIG, ErrorCode::BAD_PAYLOAD));
        return;
    }
    // No parameters are defined: the pulse count lives in config.json and the
    // pulse interval is a firmware constant. See PROTOCOL.md.
    ESP_LOGW(TAG, "CONFIG with unknown param %u", f.payload[0]);
    bus_.send(frames::nak(Cmd::CONFIG, ErrorCode::BAD_PARAM));
}

const SlotEntry* CommandHandler::entry_for(uint8_t slot) const
{
    for (size_t i = 0; i < cfg_.slot_count; ++i)
        if (cfg_.slots[i].slot == slot)
            return &cfg_.slots[i];
    return nullptr;
}

void CommandHandler::set_enabled(const SlotEntry& e, bool enabled)
{
    for (size_t k = 0; k < e.pin_count; ++k)
        gpio_set_level(static_cast<gpio_num_t>(e.pins[k]), enabled ? 0 : 1);
}

void CommandHandler::act(const VendActions& a)
{
    const SlotEntry* e = (a.enable_pins || a.disable_pins) ? entry_for(a.slot) : nullptr;

    // Order matters on the way down: pulses stop before the drivers are
    // released, so a driver never sees a STEP edge while being disabled.
    if (a.stop_steps) gen_.stop();
    if (a.enable_pins && e != nullptr) set_enabled(*e, true);
    if (a.start_steps) gen_.start(a.steps);
    if (a.disable_pins && e != nullptr) set_enabled(*e, false);
    if (a.send_done)
    {
        bus_.send(frames::done(a.slot));
        ESP_LOGI(TAG, "slot %u done", a.slot);
    }
}
```

- [ ] **Step 3: Extend `config_store` with the reserved-pin check and the disable helper**

In `Motorcontrol/src/config_store.h`, add after `load_config()`:

```cpp
    /**
     * @brief Check the table against the board's fixed wiring.
     *
     * The parser is pure and does not know which GPIOs this board already
     * uses. A slot pin equal to Pins::STEP or the UART pins would drive the
     * shared STEP line or the link as a motor enable.
     *
     * @param cfg A table with ok == true.
     * @param reason Receives e.g. "slots[2].pins[0] reserved" when true is returned.
     * @param cap Size of @p reason.
     * @return true if any pin is reserved; the table must not drive motors.
     */
    bool uses_reserved_pin(const vmaas::SlotConfig& cfg, char* reason, size_t cap);

    /**
     * @brief Drive every nENABLE pin in the table HIGH (disabled) as an output.
     *
     * Called from app_main as early as the table is known, before the UART
     * is up: DRV8825 pulls nENABLE down internally, so every driver is on
     * from power-on until this runs. CommandHandler::begin() repeats it when
     * it takes ownership of the pins.
     */
    void disable_all_motors(const vmaas::SlotConfig& cfg);
```

In `Motorcontrol/src/config_store.cpp`, add `#include "driver/gpio.h"` and `#include "pins.h"` to the includes, then add inside `namespace config_store` after `load_config()`:

```cpp
    bool uses_reserved_pin(const vmaas::SlotConfig& cfg, char* reason, size_t cap)
    {
        for (size_t i = 0; i < cfg.slot_count; ++i)
        {
            for (size_t k = 0; k < cfg.slots[i].pin_count; ++k)
            {
                const int pin = cfg.slots[i].pins[k];
                if (pin == Pins::STEP || pin == Pins::UART_TX || pin == Pins::UART_RX)
                {
                    std::snprintf(reason, cap, "slots[%u].pins[%u] reserved", (unsigned)i, (unsigned)k);
                    ESP_LOGW(TAG, "%s: slot %u uses GPIO %d, which is %s on this board",
                             CONFIG_PATH, cfg.slots[i].slot, pin,
                             pin == Pins::STEP ? "the shared STEP line" : "a UART pin");
                    return true;
                }
            }
        }
        return false;
    }

    void disable_all_motors(const vmaas::SlotConfig& cfg)
    {
        for (size_t i = 0; i < cfg.slot_count; ++i)
        {
            for (size_t k = 0; k < cfg.slots[i].pin_count; ++k)
            {
                const gpio_num_t pin = static_cast<gpio_num_t>(cfg.slots[i].pins[k]);
                gpio_reset_pin(pin);
                gpio_set_level(pin, 1);
                gpio_set_direction(pin, GPIO_MODE_OUTPUT);
                gpio_set_level(pin, 1);
            }
        }
    }
```

Also in `load_config()`, replace the success log loop at the end with:

```cpp
        ESP_LOGI(TAG, "%s: %d bytes, %u slot(s), %u steps per vend", CONFIG_PATH, n, (unsigned)out.config.slot_count, (unsigned)out.config.steps_per_vend);
        for (size_t i = 0; i < out.config.slot_count; ++i)
        {
            const vmaas::SlotEntry& e = out.config.slots[i];
            char pins[MAX_PINS_LOG];
            size_t used = 0;
            for (size_t k = 0; k < e.pin_count && used < sizeof(pins); ++k) {
                used += std::snprintf(pins + used, sizeof(pins) - used, "%s%u", k ? "," : "", e.pins[k]);
            }
            ESP_LOGI(TAG, "  slot %u -> nENABLE GPIO %s", e.slot, pins);
        }
        return out;
```

and add to the anonymous namespace at the top of the file: `constexpr size_t MAX_PINS_LOG = 24; // "18,19,21,22,23,25" fits`.

- [ ] **Step 4: Rewrite `main.cpp`**

Replace the whole of `Motorcontrol/src/main.cpp` with:

```cpp
// Motorcontrol: receives RUN/STOP/STATUS/CONFIG from Main-Controller over
// UART1 and drives the slot motors: DRV8825 steppers on one shared STEP line
// (Pins::STEP) with one nENABLE GPIO per driver. The nENABLE wiring and the
// pulse count per vend come from /storage/config.json (schema v2, see
// shared/vmaas-config/README.md); there is no default in firmware. Without a
// valid file the board answers every request with NAK CONFIG_ERROR /
// STATUS_REPLY(ERROR) and restarts every 30 s (at most 100 times per
// power-on) to pick up a corrected file. See shared/vmaas-protocol/PROTOCOL.md.
//
// Boot order is deliberate: DRV8825 pulls nENABLE low internally, so every
// driver is ON from power-on until firmware drives its pin high. The config
// is therefore read and the pins raised BEFORE the UART is started or
// anything is logged that could wait on it.
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_attr.h"
#include "esp_log.h"
#include "esp_system.h"
#include "pins.h"
#include "config.h"
#include "config_store.h"
#include "storage.h"
#include "config_error_responder.h"
#include "command_handler.h"
#include "step_generator.h"
#include "uart_bus.h"

namespace
{
    constexpr const char* TAG = "Motorcontrol";
    constexpr TickType_t ERROR_RESTART_DELAY = pdMS_TO_TICKS(30000);
    constexpr uint32_t MAX_ERROR_RESTARTS = 100;

    // Survives esp_restart() but not a power cycle, so the restart budget is per power-on.
    RTC_NOINIT_ATTR uint32_t s_error_boots;

    vmaas::UartBus bus(UART_NUM_1, Pins::UART_TX, Pins::UART_RX);
    StepGenerator generator(static_cast<gpio_num_t>(Pins::STEP), Config::STEP_INTERVAL_US);

    [[noreturn]] void run_with_slots(const vmaas::SlotConfig& cfg)
    {
        const esp_err_t gen_err = generator.begin();
        if (gen_err != ESP_OK) {
            ESP_LOGE(TAG, "step generator failed: %s; motors cannot turn", esp_err_to_name(gen_err));
        }

        CommandHandler handler(bus, cfg, generator);
        handler.begin();
        ESP_LOGI(TAG, "waiting for commands");

        while (true)
        {
            bus.poll(pdMS_TO_TICKS(10));
            handler.tick();
        }
    }

    [[noreturn]] void run_config_error(const char* reason)
    {
        ++s_error_boots;
        const bool restart_armed = s_error_boots < MAX_ERROR_RESTARTS;
        ESP_LOGE(TAG, "config error: %s (error boot %lu of %lu%s)", reason, (unsigned long)s_error_boots, (unsigned long)MAX_ERROR_RESTARTS, restart_armed ? ", restarting in 30 s" : ", restart budget spent, staying up");

        ConfigErrorResponder responder(bus);
        responder.begin();

        const TickType_t started = xTaskGetTickCount();
        while (true)
        {
            bus.poll(pdMS_TO_TICKS(10));
            if (restart_armed && static_cast<TickType_t>(xTaskGetTickCount() - started) >= ERROR_RESTART_DELAY)
            {
                ESP_LOGW(TAG, "restarting to retry config.json");
                esp_restart();
            }
        }
    }
}

extern "C" void app_main()
{
    if (esp_reset_reason() == ESP_RST_POWERON) {
        s_error_boots = 0; // Empty the RTC memory after power-on
    }

    // Config first, UART second: see the file comment.
    vmaas::fs::mount(config_store::PARTITION_LABEL, config_store::MOUNT_POINT);
    config_store::LoadResult cfg = config_store::load_config();
    if (cfg.ok)
    {
        config_store::disable_all_motors(cfg.config);
        if (config_store::uses_reserved_pin(cfg.config, cfg.reason, sizeof(cfg.reason))) {
            cfg.ok = false;
        }
    }

    bus.begin();

    if (cfg.ok)
    {
        s_error_boots = 0;
        run_with_slots(cfg.config);
    }
    run_config_error(cfg.reason);
}
```

- [ ] **Step 5: Convert the dev `config.json` to v2**

Replace `Motorcontrol/data/config.json` with:

```json
{
  "version": 2,
  "motor": { "stepsPerVend": 6400 },
  "slots": [
    { "slot": 1, "pins": [18] },
    { "slot": 2, "pins": [19] },
    { "slot": 3, "pins": [21] },
    { "slot": 4, "pins": [22] }
  ]
}
```

- [ ] **Step 6: Build**

From `Motorcontrol`: `$PIO run -e controller-motor`
Expected: SUCCESS. If `vend_sequencer.h` is not found, the LDF did not pick up the new library: check that `shared/vmaas-motor/library.json` exists and `lib_extra_dirs = ../shared` is in `Motorcontrol/platformio.ini`, then build again.

- [ ] **Step 7: Flash firmware and filesystem, then check the boot log**

Close any serial monitor on COM7. From `Motorcontrol`:

```
$PIO run -e controller-motor -t uploadfs
$PIO run -e controller-motor -t upload
```

Then from the repo root: `$PY tools/capture_serial.py COM7 8`

Expected in the capture, in this order:
- `ConfigStore: /storage/config.json: N bytes, 4 slot(s), 6400 steps per vend`
- four `slot X -> nENABLE GPIO ...` lines
- `StepGen: STEP on GPIO 4, 312 us period (156 us alarm)`
- `CmdHandler: ready, 4 slots, 6400 steps per vend`
- `Motorcontrol: waiting for commands`

- [ ] **Step 8: Bench check with one motor**

With one DRV8825 wired (STEP to GPIO4, nENABLE to GPIO18, DIR/nRESET/nSLEEP tied, M0–M2 high, motor and supply connected) and Main-Controller connected over UART:

1. At idle, a multimeter on GPIO18 reads high (3.3 V); the motor is free to turn by hand.
2. Choose slot 1 on Main-Controller's keypad and pay (or trigger `RUN 1` however the current Main-Controller build does). GPIO18 goes low, the LED on GPIO4 flickers, the motor turns one revolution in about 2 s, GPIO18 returns high.
3. Motorcontrol's log shows `slot 1: 1 driver(s) enabled, 6400 steps to follow` then `slot 1 done`; Main-Controller's log shows `slot 1 dispensed`.
4. During a vend, Main-Controller's periodic `STATUS` is answered `BUSY 1` (visible as `status: state=1 current_slot=1` in its log), not dropped.
5. If a logic analyser is available: 6400 pulses on GPIO4, 312 µs period, nENABLE low from about 10 ms before the first pulse to just after the last.

If the motor buzzes without turning, raise `Config::STEP_INTERVAL_US` (try 500) and repeat; if it turns the wrong way, swap one motor coil pair. Record the value that works in the spec's Risks section.

- [ ] **Step 9: Verify**

`git status --short Motorcontrol shared/vmaas-motor` lists the changes. Boot log and bench observations are recorded in the task report. Do not commit.

---

### Task 8: Main-Controller: DONE timeout and `config()` removal

Main-Controller reads `timings.dispense_timeout_ms`, feeds it to `Purchase`, sends STOP on `stop_motor`, books the failure as `done_timeout`, and warns on a late DONE. `MotorClient::config()` goes with `frames::config`.

**Files:**
- Modify: `Main-Controller/src/motor_client.h`
- Modify: `Main-Controller/src/motor_client.cpp`
- Modify: `Main-Controller/src/purchase_task.h`
- Modify: `Main-Controller/src/purchase_task.cpp`
- Modify: `Main-Controller/src/main.cpp`

**Interfaces:**
- Consumes: `PurchaseOutput::stop_motor`, `PurchaseConfig::dispense_timeout_ms` (Task 4), `DeviceConfig::dispense_timeout_ms` (Task 5).
- Produces: `bool purchase_task::begin(vmaas::GroveLcdRgb&, bool display_ok, MotorClient&, uint32_t dispense_timeout_ms)`.

- [ ] **Step 1: Remove `MotorClient::config()`**

In `Main-Controller/src/motor_client.h`, delete the `config()` declaration and its doc comment (the block beginning `/** @brief Set a runtime parameter on Motorcontrol.`).

In `Main-Controller/src/motor_client.cpp`, delete the `MotorClient::config` function.

- [ ] **Step 2: Build to confirm nothing else called it**

From `Main-Controller`: `$PIO run -e main-controller`
Expected: SUCCESS. (If anything referenced `frames::config` or `ConfigParam::RUN_TIME_MS`, the build names it; remove the call.)

- [ ] **Step 3: Extend `purchase_task::begin`**

In `Main-Controller/src/purchase_task.h`, change the declaration and its comment to:

```cpp
    /// Load the price table, install the ISR, start the drain task.
    /// @param dispense_timeout_ms From config.json timings.dispense_timeout_ms;
    ///        how long a paid vend waits for DONE before it is booked Failed. 0 disables.
    /// @return False when there are no prices, in which case cash is disabled
    ///         and the firmware behaves as it did before this feature.
    bool begin(vmaas::GroveLcdRgb &lcd, bool display_ok, MotorClient &motor, uint32_t dispense_timeout_ms);
```

In `Main-Controller/src/purchase_task.cpp`, change the definition to match and, right after the `prices::load(...)` block succeeds (after its closing brace), add:

```cpp
        // A device timing, not part of the backend's cash block: prices::load
        // never touches it, so set it after the load.
        purchase_cfg.dispense_timeout_ms = dispense_timeout_ms;
```

Extend the `cash enabled` log line to include it:

```cpp
        ESP_LOGI(TAG, "cash enabled: COIN on GPIO%d, inhibit %s, dispense timeout %lu ms", Pins::COIN_IN, inhibit >= 0 ? "wired" : "absent", static_cast<unsigned long>(purchase_cfg.dispense_timeout_ms));
```

- [ ] **Step 4: Act on `stop_motor` and name the reason**

In `apply()` in `purchase_task.cpp`, after the `port.set_inhibit(o.inhibit_coins);` line and before the `settle_sale` block, add:

```cpp
        // Dispense timeout: whatever the motor is doing, switch it off. STOP is
        // idempotent, so a lost DONE costs nothing and a stuck motor stops.
        if (o.stop_motor && motor_ != nullptr)
        {
            ESP_LOGW(TAG, "no DONE for slot %u within the dispense timeout; sending STOP", static_cast<unsigned>(o.slot));
            if (!motor_->stop()) {
                ESP_LOGE(TAG, "STOP was not sent");
            }
        }
```

In `tick()`, replace

```cpp
        const vmaas::PurchaseOutput tick_out = machine->tick(now_ms);
        apply(tick_out, nullptr);
```

with

```cpp
        const vmaas::PurchaseOutput tick_out = machine->tick(now_ms);
        apply(tick_out, tick_out.stop_motor ? "done_timeout" : nullptr);
```

- [ ] **Step 5: Warn on a late DONE**

Replace `on_dispense_done()` in `purchase_task.cpp` with:

```cpp
    void on_dispense_done()
    {
        if (!cash_enabled) return;
        const uint32_t now = static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS);
        const vmaas::PurchaseOutput o = machine->dispense_done(now);
        if (!(o.state == vmaas::PurchaseState::Settled && o.sale_status == vmaas::SaleStatus::Completed))
        {
            // Nothing was Dispensing. Most likely a DONE that arrived after the
            // dispense timeout already booked the sale Failed: the item may have
            // dropped, but the record stands.
            ESP_LOGW(TAG, "DONE with no vend in progress (late after timeout?); sale record unchanged");
        }
        apply(o, nullptr);
    }
```

- [ ] **Step 6: Pass the timing from `main.cpp`**

In `Main-Controller/src/main.cpp`, change

```cpp
    const bool cash_ok = purchase_task::begin(lcd, display_ok, motor);
```

to

```cpp
    const bool cash_ok = purchase_task::begin(lcd, display_ok, motor, cfg.dispense_timeout_ms);
```

- [ ] **Step 7: Build and flash**

From `Main-Controller`: `$PIO run -e main-controller`
Expected: SUCCESS.

Close any monitor on COM6, then:

```
$PIO run -e main-controller -t uploadfs
$PIO run -e main-controller -t upload
```

`$PY tools/capture_serial.py COM6 10` from the repo root. Expected: the `cash enabled` line ends with `dispense timeout 30000 ms`.

- [ ] **Step 8: Bench check the timeout**

With both boards up and one motor wired as in Task 7:

1. **Normal vend.** Pay for slot 1. The motor turns, the LCD shows the "take your item" state, Main-Controller logs `slot 1 dispensed`. No `STOP` is sent.
2. **Lost DONE.** Pull only the Motorcontrol-to-Main wire (Motor GPIO17 TX to Main GPIO32 RX); leave the Main-to-Motor wire and GND in place. Pay for slot 1. The motor still turns (RUN arrives), but ACK and DONE cannot come back. After 30 s Main-Controller shows its failure notice and logs `no DONE for slot 1 within the dispense timeout; sending STOP`. Motorcontrol's log shows `slot 1 stopped by request` or, since the vend finished after 2 s, simply an `ACK STOP` being sent to an idle handler. The outbox line for the sale has status `failed` and reason `done_timeout`.
3. **Late DONE.** Reconnect the wire. Nothing further happens on Main-Controller for that sale (the DONE was lost, not delayed). To see the late-DONE warning instead, repeat step 2 but reconnect the wire at about 20 s, before the timeout: DONE arrives and completes the sale normally. The warning path only fires if a DONE arrives after 30 s, which needs a Motorcontrol test build with a delayed DONE and is not part of this plan.

- [ ] **Step 9: Verify**

`grep -rn "config(" Main-Controller/src/motor_client.h` prints nothing. Builds for both boards are green. Bench observations recorded. Do not commit.

---

## What the backend/UI plan covers

Written once Plan A (`2026-09-22-slot-pin-wiring-a-backend-ui.md`) has landed, against the spec's "Backend and admin UI" section:

1. `Machine.stepsPerVend Int @default(6400)` and its migration; `stepsPerVend` on `saveSlotLayoutSchema` (Zod 1–65535) and on the machine type.
2. `saveSlotLayout` writes the column in its transaction; `buildConfigurationPayload(slots, cash, motor)` emits `wiring.motor.stepsPerVend`; `publishConfigurationService` selects it.
3. The "Motor" card in the layout editor, in the same TanStack form as the layout.

Plan B (Main-Controller command handling, `WIRING_*` frames with the 3-byte `WIRING_COMMIT`, Motorcontrol `save_config()`) follows both.

## Manual verification of this plan

- [ ] Every shared library is green: `$PIO test -e native` in `shared/vmaas-motor`, `shared/vmaas-config`, `shared/vmaas-protocol`, `shared/vmaas-purchase`.
- [ ] Both firmwares build: `$PIO run -e controller-motor` in `Motorcontrol`, `$PIO run -e main-controller` in `Main-Controller`.
- [ ] Motorcontrol boot log names the step count and the nENABLE pins; every nENABLE pin reads high at idle.
- [ ] One paid vend turns one motor one revolution and produces exactly one `DONE`; `STATUS` during the vend answers `BUSY`.
- [ ] A vend with the Motor-to-Main wire pulled fails on Main-Controller after 30 s with `done_timeout` and a `STOP` reaches Motorcontrol.
- [ ] `grep -rn RUN_TIME_MS Main-Controller/src Motorcontrol/src shared/vmaas-protocol/src` prints nothing.
