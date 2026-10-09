# Wiring Delivery, Protocol and Motorcontrol: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Motorcontrol accepts a new wiring table over UART (`WIRING_BEGIN`, `WIRING_SLOT`×n, `WIRING_COMMIT`), validates it with the same parser it boots from, writes `config.json` v2 atomically and applies it without a reboot; a board in config-error accepts the same frames and reboots into the new table.

**Architecture:** Three pure, host-tested pieces carry the logic: the frame builders in `shared/vmaas-protocol`, a `WiringStager` state machine and a `write_slot_config_json` serializer in `shared/vmaas-config`. Motorcontrol glues them: on `COMMIT` it serialises the staged table, re-parses it with `parse_slot_config` (one validator, no second rule set), runs the board's reserved-pin check, writes with the atomic `vmaas::fs::write_text_file`, and swaps the live `SlotConfig`. `CommandHandler` owns its `SlotConfig` by value so it can be replaced.

**Tech Stack:** C++17, ESP-IDF 6.1 via PlatformIO, Unity host tests on `platform = native`, vendored cJSON.

**Spec:** `docs/superpowers/specs/2026-09-22-slot-pin-wiring-design.md` (sections "UART protocol", "Motorcontrol", "Error handling") as amended by `docs/superpowers/specs/2026-09-23-stepper-dispense-design.md` (3-byte `WIRING_COMMIT`, reserved pins, config v2 with `motor`). **The Main-Controller half (MQTT command queue, `get_mtls`, `prices::store`, service hold, sending these frames) is being built by another session and is out of scope here.** This plan only exports the frame builders it will call.

## Global Constraints

- **Never commit.** The owner forbids `git commit`; every task ends with a Verify step. Leave changes in the working tree.
- **Do not touch `Main-Controller/`, `shared/vmaas-fs/`, `shared/vmaas-purchase/`, `backend/`, `admin-frontend/`.** Another session is editing them. `vmaas::fs::write_text_file(path, data, len)` (atomic tmp+rename, in `shared/vmaas-fs/src/storage.h`, working tree) is consumed as-is.
- **Wire format is fixed:** `WIRING_BEGIN 0x14` (no payload), `WIRING_SLOT 0x15` (`slot` u8, `pin_count` u8, `pins` u8[pin_count], `pin_count` ≤ 6), `WIRING_COMMIT 0x16` (`count` u8, `steps_per_vend` u16 LE; 3 bytes). NAK codes `WIRING_STATE = 7`, `WIRING_FULL = 8`, `WRITE_FAILED = 9`. `COMMIT` while a vend is in progress is `NAK BUSY`. Staging expires 10 s after the last `WIRING_*` frame.
- **One validator.** The staged table is validated by serialising it to config.json v2 text and running `parse_slot_config` on that text, then `config_store::uses_reserved_pin`. No duplicate rule set in the stager beyond what the frame layout forces (count bounds).
- **`config.json` written by the device is byte-compatible with what `uploadfs` and the backend produce**: `{"version":2,"motor":{"stepsPerVend":N},"slots":[{"slot":n,"pins":[..]},...]}`. Under `MAX_CONFIG_BYTES` (2048) for 32 slots × 6 pins.
- **nENABLE idle HIGH.** Applying a new table raises every new pin before the table becomes live and never drives a reserved pin.
- **`protocol.h` and `PROTOCOL.md` change in the same task.**
- Shared libs stay hardware-free and pass `pio test -e native` with `-Wall -Wextra`, pristine. Doxygen on declarations; sparse body comments (the owner strips them). English.
- `docs/superpowers/**` is gitignored.

## Toolchain (Windows host)

```bash
export PATH="/c/Users/temp/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
PIO=/c/Users/temp/.platformio/penv/Scripts/pio.exe
PY=/c/Users/temp/.platformio/penv/Scripts/python.exe
# host tests: cd shared/<lib> && $PIO test -e native [-f test_folder]
# firmware:   cd Motorcontrol && $PIO run -e controller-motor [-t upload | -t uploadfs]   (COM7)
# boot log:   $PY tools/capture_serial.py COM7 8   (from repo root)
```

## File Structure

```
shared/vmaas-protocol/src/protocol.h                 WIRING_* cmds, 3 error codes, frames::wiring_*
shared/vmaas-protocol/PROTOCOL.md                    tables + flow
shared/vmaas-protocol/test/test_protocol/test_main.cpp        + builders
shared/vmaas-protocol/test/test_frame_codec/test_main.cpp     + round trip
shared/vmaas-config/src/slot_config_writer.h/.cpp    NEW write_slot_config_json()
shared/vmaas-config/src/wiring_stager.h/.cpp         NEW WiringStager
shared/vmaas-config/test/test_writer/test_main.cpp   NEW
shared/vmaas-config/test/test_stager/test_main.cpp   NEW
shared/vmaas-config/library.json                     headers list
shared/vmaas-config/README.md                        "Written by the device" paragraph
Motorcontrol/src/wiring_commit.h/.cpp                NEW commit_wiring(): serialise, validate, write
Motorcontrol/src/command_handler.h/.cpp              owns SlotConfig; WIRING_* handling; apply
Motorcontrol/src/config_error_responder.h/.cpp       WIRING_* accepted; restart on success
Motorcontrol/src/main.cpp                            passes cfg by value; stager tick
```

---

### Task 1: `WIRING_*` in the protocol

**Files:** Modify `shared/vmaas-protocol/src/protocol.h`, `PROTOCOL.md`; Test `test/test_protocol/test_main.cpp`, `test/test_frame_codec/test_main.cpp`.

**Produces:** `Cmd::WIRING_BEGIN = 0x14, WIRING_SLOT = 0x15, WIRING_COMMIT = 0x16`; `ErrorCode::WIRING_STATE = 7, WIRING_FULL = 8, WRITE_FAILED = 9`; `constexpr uint8_t WIRING_MAX_PINS = 6;` `frames::wiring_begin()`, `frames::wiring_slot(uint8_t slot, const uint8_t* pins, uint8_t pin_count)` (pin_count clamped to 6), `frames::wiring_commit(uint8_t count, uint16_t steps_per_vend)`.

- [ ] **Step 1: Failing tests.** Append to `test_protocol/test_main.cpp` and register in `main()`:

```cpp
void test_wiring_command_ids_and_error_codes_match_spec()
{
    TEST_ASSERT_EQUAL_HEX8(0x14, static_cast<uint8_t>(Cmd::WIRING_BEGIN));
    TEST_ASSERT_EQUAL_HEX8(0x15, static_cast<uint8_t>(Cmd::WIRING_SLOT));
    TEST_ASSERT_EQUAL_HEX8(0x16, static_cast<uint8_t>(Cmd::WIRING_COMMIT));
    TEST_ASSERT_EQUAL_UINT8(7, static_cast<uint8_t>(ErrorCode::WIRING_STATE));
    TEST_ASSERT_EQUAL_UINT8(8, static_cast<uint8_t>(ErrorCode::WIRING_FULL));
    TEST_ASSERT_EQUAL_UINT8(9, static_cast<uint8_t>(ErrorCode::WRITE_FAILED));
    TEST_ASSERT_EQUAL_UINT8(6, WIRING_MAX_PINS);
}

void test_builder_wiring_begin_has_no_payload()
{
    const Frame f = frames::wiring_begin();
    TEST_ASSERT_EQUAL(Cmd::WIRING_BEGIN, f.cmd);
    TEST_ASSERT_EQUAL_UINT8(0, f.len);
}

void test_builder_wiring_slot_lays_out_slot_count_pins()
{
    const uint8_t pins[] = {21, 22};
    const Frame f = frames::wiring_slot(3, pins, 2);
    TEST_ASSERT_EQUAL(Cmd::WIRING_SLOT, f.cmd);
    TEST_ASSERT_EQUAL_UINT8(4, f.len);
    TEST_ASSERT_EQUAL_UINT8(3, f.payload[0]);
    TEST_ASSERT_EQUAL_UINT8(2, f.payload[1]);
    TEST_ASSERT_EQUAL_UINT8(21, f.payload[2]);
    TEST_ASSERT_EQUAL_UINT8(22, f.payload[3]);
}

// Six pins fill the frame exactly; a seventh cannot be sent and is dropped.
void test_builder_wiring_slot_clamps_to_six_pins()
{
    const uint8_t pins[] = {0, 2, 5, 12, 13, 14, 15};
    const Frame f = frames::wiring_slot(1, pins, 7);
    TEST_ASSERT_EQUAL_UINT8(8, f.len);
    TEST_ASSERT_EQUAL_UINT8(6, f.payload[1]);
    TEST_ASSERT_EQUAL_UINT8(14, f.payload[7]);
}

void test_builder_wiring_commit_is_count_then_u16_le_steps()
{
    const Frame f = frames::wiring_commit(4, 6400); // 0x1900
    TEST_ASSERT_EQUAL(Cmd::WIRING_COMMIT, f.cmd);
    TEST_ASSERT_EQUAL_UINT8(3, f.len);
    TEST_ASSERT_EQUAL_UINT8(4, f.payload[0]);
    TEST_ASSERT_EQUAL_HEX8(0x00, f.payload[1]);
    TEST_ASSERT_EQUAL_HEX8(0x19, f.payload[2]);
}
```

In `test_frame_codec/test_main.cpp`, add `frames::wiring_begin()`, `frames::wiring_slot(3, (const uint8_t[]){21, 22}, 2)` (declare a local `const uint8_t two[] = {21, 22};` above the array and use it) and `frames::wiring_commit(4, 6400)` to the `inputs[]` of `test_parse_round_trip_every_command`.

- [ ] **Step 2: Run** `$PIO test -e native` in `shared/vmaas-protocol` → compile errors (missing symbols).

- [ ] **Step 3: Header.** In `protocol.h`: add after `CONFIG = 0x13,`:

```cpp
        WIRING_BEGIN = 0x14,  ///< Start a wiring transfer; clears the staging buffer. No payload.
        WIRING_SLOT = 0x15,   ///< One slot: slot u8, pin_count u8, pins u8[pin_count] (pin_count <= WIRING_MAX_PINS).
        WIRING_COMMIT = 0x16, ///< Finish: count u8 (slots sent), steps_per_vend u16 LE. Validates, writes config.json, applies.
```

After `CONFIG_ERROR = 6,`:

```cpp
        WIRING_STATE = 7, ///< WIRING_SLOT or WIRING_COMMIT without a preceding WIRING_BEGIN, or after the 10 s staging timeout.
        WIRING_FULL = 8,  ///< More than MAX_SLOTS slots staged, or pin_count > WIRING_MAX_PINS.
        WRITE_FAILED = 9, ///< The staged table did not validate, uses a reserved pin, or config.json could not be written.
```

After `MAX_FRAME_SIZE`: `constexpr uint8_t WIRING_MAX_PINS = 6; ///< Pins per WIRING_SLOT: 8 payload bytes minus slot and pin_count.`

In `namespace frames`, after `status()`:

```cpp
        /// @brief Build a WIRING_BEGIN request. No payload.
        inline Frame wiring_begin()
        {
            Frame f;
            f.cmd = Cmd::WIRING_BEGIN;
            return f;
        }

        /**
         * @brief Build a WIRING_SLOT request.
         * @param slot Slot number, 1-255.
         * @param pins nENABLE GPIOs of the slot's drivers.
         * @param pin_count Entries in @p pins; more than WIRING_MAX_PINS are dropped.
         */
        inline Frame wiring_slot(uint8_t slot, const uint8_t* pins, uint8_t pin_count)
        {
            Frame f;
            f.cmd = Cmd::WIRING_SLOT;
            const uint8_t n = pin_count > WIRING_MAX_PINS ? WIRING_MAX_PINS : pin_count;
            f.len = static_cast<uint8_t>(2 + n);
            f.payload[0] = slot;
            f.payload[1] = n;
            for (uint8_t i = 0; i < n; ++i) f.payload[2 + i] = pins[i];
            return f;
        }

        /**
         * @brief Build a WIRING_COMMIT request.
         * @param count Number of WIRING_SLOT frames sent since WIRING_BEGIN.
         * @param steps_per_vend STEP pulses per vend, 1-65535 (config.json motor.stepsPerVend).
         */
        inline Frame wiring_commit(uint8_t count, uint16_t steps_per_vend)
        {
            Frame f;
            f.cmd = Cmd::WIRING_COMMIT;
            f.len = 3;
            f.payload[0] = count;
            f.payload[1] = static_cast<uint8_t>(steps_per_vend & 0xFF);
            f.payload[2] = static_cast<uint8_t>(steps_per_vend >> 8);
            return f;
        }
```

Update `State::ERROR`'s comment to end: `Every RUN/STOP/CONFIG is answered NAK CONFIG_ERROR; WIRING_* is accepted so the table can be repaired without a reflash.`

- [ ] **Step 4: Run** the suites → all green.

- [ ] **Step 5: PROTOCOL.md.** Requests table: add the three rows (`0x14 WIRING_BEGIN none`, `0x15 WIRING_SLOT slot u8, pin_count u8, pins u8[pin_count] (≤6)`, `0x16 WIRING_COMMIT count u8, steps_per_vend u16 LE`). NAK table: add rows 7, 8, 9 with the header's wording. Add a section before "## Receiver behaviour":

```markdown
## Wiring transfer

The slot table is sent row by row and applied all at once:

```
Main  -> Motor : WIRING_BEGIN
Motor -> Main  : ACK WIRING_BEGIN
Main  -> Motor : WIRING_SLOT 1 [18]
Motor -> Main  : ACK WIRING_SLOT
Main  -> Motor : WIRING_SLOT 3 [21,22]
Motor -> Main  : ACK WIRING_SLOT
Main  -> Motor : WIRING_COMMIT count=2 steps=6400
Motor -> Main  : ACK WIRING_COMMIT          (config.json rewritten and applied)
```

`COMMIT` carries `count` so a dropped `WIRING_SLOT` (which CRC cannot catch) is
detected: a mismatch is `NAK WRITE_FAILED` and nothing is written. On `COMMIT`
Motorcontrol serialises the staged table to config.json v2, validates it with
the same parser it boots from, refuses reserved GPIOs (STEP, UART, console,
flash), writes the file atomically and applies it without a reboot. Any
failure leaves the old file and the running table untouched.

`WIRING_SLOT`/`WIRING_COMMIT` without `WIRING_BEGIN`, or more than 10 s after
the previous wiring frame, is `NAK WIRING_STATE`. More than 32 slots or more
than 6 pins is `NAK WIRING_FULL`. `COMMIT` while a vend is in progress is
`NAK BUSY`; the staging buffer is kept, so the sender may retry `COMMIT`.

A board in the config-error state accepts the transfer too; after a
successful `COMMIT` it restarts into the new table instead of applying it
live.
```

In the "Motorcontrol without a valid slot configuration" paragraph, change "refuses every RUN, STOP and CONFIG" to "refuses every RUN, STOP and CONFIG (WIRING_* is accepted, see Wiring transfer)".

- [ ] **Step 6: Verify.** Suites green; `grep -c WIRING PROTOCOL.md` ≥ 10. No commit.

---

### Task 2: Serializer and stager in `shared/vmaas-config`

**Files:** Create `src/slot_config_writer.h/.cpp`, `src/wiring_stager.h/.cpp`, `test/test_writer/test_main.cpp`, `test/test_stager/test_main.cpp`; Modify `library.json` (headers), `README.md`.

**Produces:**
- `int vmaas::write_slot_config_json(const SlotConfig& cfg, char* out, size_t cap)` → bytes written (excl. NUL) or -1 if it does not fit.
- `class vmaas::WiringStager` with `enum class Result { Ok, NotBegun, Full, CountMismatch, BadSteps }`, `void begin(uint32_t now_ms)`, `Result add_slot(uint8_t slot, const uint8_t* pins, uint8_t pin_count, uint32_t now_ms)`, `Result commit(uint8_t count, uint16_t steps_per_vend, uint32_t now_ms, SlotConfig& out)`, `void tick(uint32_t now_ms)` (expires after `TIMEOUT_MS = 10000`), `bool active() const`, `void reset()`.

- [ ] **Step 1: Failing tests.**

`test/test_writer/test_main.cpp`:

```cpp
#include <unity.h>
#include <cstring>
#include "slot_config.h"
#include "slot_config_parser.h"
#include "slot_config_writer.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

namespace
{
    SlotConfig two_slots()
    {
        SlotConfig c{};
        c.steps_per_vend = 6400;
        c.slot_count = 2;
        c.slots[0] = SlotEntry{1, 1, {18, 0, 0, 0, 0, 0}};
        c.slots[1] = SlotEntry{3, 2, {21, 22, 0, 0, 0, 0}};
        return c;
    }
}

void test_writes_exactly_the_v2_shape()
{
    char out[256];
    const int n = write_slot_config_json(two_slots(), out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING(R"({"version":2,"motor":{"stepsPerVend":6400},"slots":[{"slot":1,"pins":[18]},{"slot":3,"pins":[21,22]}]})", out);
    TEST_ASSERT_EQUAL_INT((int)std::strlen(out), n);
}

void test_round_trips_through_the_parser()
{
    char out[256];
    write_slot_config_json(two_slots(), out, sizeof(out));
    const SlotParseResult r = parse_slot_config(out);
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT16(6400, r.config.steps_per_vend);
    TEST_ASSERT_EQUAL_UINT32(2, r.config.slot_count);
    TEST_ASSERT_EQUAL_UINT8(3, r.config.slots[1].slot);
    TEST_ASSERT_EQUAL_UINT8(2, r.config.slots[1].pin_count);
    TEST_ASSERT_EQUAL_UINT8(22, r.config.slots[1].pins[1]);
}

// 32 slots x 6 pins is the biggest table; it must fit Motorcontrol's 2048-byte file bound.
void test_largest_table_fits_max_config_bytes()
{
    SlotConfig c{};
    c.steps_per_vend = 65535;
    c.slot_count = MAX_SLOTS;
    for (size_t i = 0; i < MAX_SLOTS; ++i)
    {
        c.slots[i].slot = static_cast<uint8_t>(i + 1);
        c.slots[i].pin_count = MAX_PINS_PER_SLOT;
        for (size_t k = 0; k < MAX_PINS_PER_SLOT; ++k) c.slots[i].pins[k] = 33;
    }
    char out[2048];
    const int n = write_slot_config_json(c, out, sizeof(out));
    TEST_ASSERT_TRUE(n > 0);
    TEST_ASSERT_TRUE(n < 2048);
}

void test_too_small_buffer_returns_minus_one_and_empty_string()
{
    char out[40];
    TEST_ASSERT_EQUAL_INT(-1, write_slot_config_json(two_slots(), out, sizeof(out)));
    TEST_ASSERT_EQUAL_STRING("", out);
}

void test_empty_table_still_writes_valid_json()
{
    SlotConfig c{};
    c.steps_per_vend = 1;
    char out[128];
    write_slot_config_json(c, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING(R"({"version":2,"motor":{"stepsPerVend":1},"slots":[]})", out);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_writes_exactly_the_v2_shape);
    RUN_TEST(test_round_trips_through_the_parser);
    RUN_TEST(test_largest_table_fits_max_config_bytes);
    RUN_TEST(test_too_small_buffer_returns_minus_one_and_empty_string);
    RUN_TEST(test_empty_table_still_writes_valid_json);
    return UNITY_END();
}
```

`test/test_stager/test_main.cpp`:

```cpp
#include <unity.h>
#include "wiring_stager.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

namespace
{
    const uint8_t P18[] = {18};
    const uint8_t P21_22[] = {21, 22};
}

void test_begin_add_commit_yields_the_table()
{
    WiringStager s;
    s.begin(1000);
    TEST_ASSERT_EQUAL(WiringStager::Result::Ok, s.add_slot(1, P18, 1, 1010));
    TEST_ASSERT_EQUAL(WiringStager::Result::Ok, s.add_slot(3, P21_22, 2, 1020));
    SlotConfig out{};
    TEST_ASSERT_EQUAL(WiringStager::Result::Ok, s.commit(2, 6400, 1030, out));
    TEST_ASSERT_EQUAL_UINT16(6400, out.steps_per_vend);
    TEST_ASSERT_EQUAL_UINT32(2, out.slot_count);
    TEST_ASSERT_EQUAL_UINT8(3, out.slots[1].slot);
    TEST_ASSERT_EQUAL_UINT8(22, out.slots[1].pins[1]);
    TEST_ASSERT_FALSE(s.active());
}

void test_slot_or_commit_without_begin_is_not_begun()
{
    WiringStager s;
    SlotConfig out{};
    TEST_ASSERT_EQUAL(WiringStager::Result::NotBegun, s.add_slot(1, P18, 1, 5));
    TEST_ASSERT_EQUAL(WiringStager::Result::NotBegun, s.commit(0, 6400, 5, out));
}

void test_begin_clears_a_previous_transfer()
{
    WiringStager s;
    s.begin(0);
    s.add_slot(1, P18, 1, 1);
    s.begin(2);
    SlotConfig out{};
    TEST_ASSERT_EQUAL(WiringStager::Result::Ok, s.commit(0, 6400, 3, out));
    TEST_ASSERT_EQUAL_UINT32(0, out.slot_count);
}

// count is the only defence against a dropped WIRING_SLOT frame.
void test_count_mismatch_refuses_and_keeps_staging()
{
    WiringStager s;
    s.begin(0);
    s.add_slot(1, P18, 1, 1);
    SlotConfig out{};
    TEST_ASSERT_EQUAL(WiringStager::Result::CountMismatch, s.commit(2, 6400, 2, out));
    TEST_ASSERT_TRUE(s.active());
    TEST_ASSERT_EQUAL(WiringStager::Result::Ok, s.commit(1, 6400, 3, out));
}

void test_too_many_pins_or_slots_is_full()
{
    WiringStager s;
    s.begin(0);
    const uint8_t seven[] = {0, 2, 5, 12, 13, 14, 15};
    TEST_ASSERT_EQUAL(WiringStager::Result::Full, s.add_slot(1, seven, 7, 1));
    for (uint8_t i = 1; i <= MAX_SLOTS; ++i) {
        TEST_ASSERT_EQUAL(WiringStager::Result::Ok, s.add_slot(i, P18, 1, 2));
    }
    TEST_ASSERT_EQUAL(WiringStager::Result::Full, s.add_slot(33, P18, 1, 3));
}

void test_zero_steps_is_bad_steps()
{
    WiringStager s;
    s.begin(0);
    SlotConfig out{};
    TEST_ASSERT_EQUAL(WiringStager::Result::BadSteps, s.commit(0, 0, 1, out));
}

// A Main-Controller that dies mid-transfer must leave no partial state behind.
void test_staging_expires_ten_seconds_after_the_last_frame()
{
    WiringStager s;
    s.begin(0);
    s.add_slot(1, P18, 1, 4000);
    s.tick(4000 + WiringStager::TIMEOUT_MS - 1);
    TEST_ASSERT_TRUE(s.active());
    s.tick(4000 + WiringStager::TIMEOUT_MS);
    TEST_ASSERT_FALSE(s.active());
    SlotConfig out{};
    TEST_ASSERT_EQUAL(WiringStager::Result::NotBegun, s.commit(1, 6400, 14001, out));
}

void test_tick_wraps_around()
{
    WiringStager s;
    s.begin(0xFFFFFF00u);
    s.tick(0xFFFFFF00u + 5000);
    TEST_ASSERT_TRUE(s.active());
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_begin_add_commit_yields_the_table);
    RUN_TEST(test_slot_or_commit_without_begin_is_not_begun);
    RUN_TEST(test_begin_clears_a_previous_transfer);
    RUN_TEST(test_count_mismatch_refuses_and_keeps_staging);
    RUN_TEST(test_too_many_pins_or_slots_is_full);
    RUN_TEST(test_zero_steps_is_bad_steps);
    RUN_TEST(test_staging_expires_ten_seconds_after_the_last_frame);
    RUN_TEST(test_tick_wraps_around);
    return UNITY_END();
}
```

- [ ] **Step 2: Run** `$PIO test -e native -f test_writer` and `-f test_stager` → compile errors.

- [ ] **Step 3: Implement.**

`src/slot_config_writer.h`:

```cpp
#pragma once
/**
 * @file slot_config_writer.h
 * @brief Serialise a SlotConfig as config.json schema v2, the exact shape
 *        parse_slot_config() reads and the backend publishes.
 */
#include <cstddef>
#include "slot_config.h"

namespace vmaas
{
    /**
     * @brief Write @p cfg to @p out as compact JSON, NUL-terminated.
     * @return Bytes written excluding the NUL, or -1 when @p cap is too small
     *         (then out[0] == '\0'). Never allocates.
     */
    int write_slot_config_json(const SlotConfig& cfg, char* out, size_t cap);
}
```

`src/slot_config_writer.cpp`:

```cpp
#include "slot_config_writer.h"
#include <cstdio>

namespace vmaas
{
    namespace
    {
        // Appends formatted text at *pos; returns false once the buffer is full.
        bool put(char* out, size_t cap, size_t& pos, const char* fmt, unsigned a = 0)
        {
            if (pos >= cap) return false;
            const int n = std::snprintf(out + pos, cap - pos, fmt, a);
            if (n < 0 || static_cast<size_t>(n) >= cap - pos) return false;
            pos += static_cast<size_t>(n);
            return true;
        }
    }

    int write_slot_config_json(const SlotConfig& cfg, char* out, size_t cap)
    {
        if (out == nullptr || cap == 0) return -1;
        size_t pos = 0;
        bool ok = put(out, cap, pos, "{\"version\":2,\"motor\":{\"stepsPerVend\":%u},\"slots\":[", cfg.steps_per_vend);
        for (size_t i = 0; ok && i < cfg.slot_count; ++i)
        {
            const SlotEntry& e = cfg.slots[i];
            ok = put(out, cap, pos, i ? ",{\"slot\":%u,\"pins\":[" : "{\"slot\":%u,\"pins\":[", e.slot);
            for (size_t k = 0; ok && k < e.pin_count; ++k) {
                ok = put(out, cap, pos, k ? ",%u" : "%u", e.pins[k]);
            }
            ok = ok && put(out, cap, pos, "]}");
        }
        ok = ok && put(out, cap, pos, "]}");
        if (!ok)
        {
            out[0] = '\0';
            return -1;
        }
        return static_cast<int>(pos);
    }
}
```

`src/wiring_stager.h`:

```cpp
#pragma once
/**
 * @file wiring_stager.h
 * @brief Collects a WIRING_BEGIN / WIRING_SLOT* / WIRING_COMMIT transfer into
 *        a SlotConfig. Hardware-free; the caller validates the result with
 *        parse_slot_config() after serialising it.
 */
#include <cstddef>
#include <cstdint>
#include "slot_config.h"

namespace vmaas
{
    class WiringStager
    {
    public:
        /// Staging is discarded this long after the last wiring frame.
        static constexpr uint32_t TIMEOUT_MS = 10000;

        enum class Result : uint8_t
        {
            Ok,
            NotBegun,      ///< No WIRING_BEGIN, or the staging expired.
            Full,          ///< More than MAX_SLOTS slots, or pin_count > MAX_PINS_PER_SLOT.
            CountMismatch, ///< COMMIT's count differs from the slots staged; staging is kept.
            BadSteps,      ///< steps_per_vend outside STEPS_PER_VEND_MIN..MAX; staging is kept.
        };

        void begin(uint32_t now_ms);
        Result add_slot(uint8_t slot, const uint8_t* pins, uint8_t pin_count, uint32_t now_ms);
        /// On Ok, @p out holds the table and staging is cleared.
        Result commit(uint8_t count, uint16_t steps_per_vend, uint32_t now_ms, SlotConfig& out);
        /// Call every loop pass; expires the staging after TIMEOUT_MS of silence.
        void tick(uint32_t now_ms);
        bool active() const { return active_; }
        void reset();

    private:
        bool active_ = false;
        uint32_t last_frame_ms_ = 0;
        SlotConfig staged_{};
    };
}
```

`src/wiring_stager.cpp`:

```cpp
#include "wiring_stager.h"

namespace vmaas
{
    void WiringStager::begin(uint32_t now_ms)
    {
        reset();
        active_ = true;
        last_frame_ms_ = now_ms;
    }

    WiringStager::Result WiringStager::add_slot(uint8_t slot, const uint8_t* pins, uint8_t pin_count, uint32_t now_ms)
    {
        if (!active_) return Result::NotBegun;
        last_frame_ms_ = now_ms;
        if (pin_count > MAX_PINS_PER_SLOT || staged_.slot_count >= MAX_SLOTS) return Result::Full;

        SlotEntry& e = staged_.slots[staged_.slot_count++];
        e.slot = slot;
        e.pin_count = pin_count;
        for (uint8_t i = 0; i < pin_count; ++i) e.pins[i] = pins[i];
        for (uint8_t i = pin_count; i < MAX_PINS_PER_SLOT; ++i) e.pins[i] = 0;
        return Result::Ok;
    }

    WiringStager::Result WiringStager::commit(uint8_t count, uint16_t steps_per_vend, uint32_t now_ms, SlotConfig& out)
    {
        if (!active_) return Result::NotBegun;
        last_frame_ms_ = now_ms;
        if (count != staged_.slot_count) return Result::CountMismatch;
        if (steps_per_vend < STEPS_PER_VEND_MIN || steps_per_vend > STEPS_PER_VEND_MAX) return Result::BadSteps;

        staged_.steps_per_vend = steps_per_vend;
        out = staged_;
        reset();
        return Result::Ok;
    }

    void WiringStager::tick(uint32_t now_ms)
    {
        if (active_ && now_ms - last_frame_ms_ >= TIMEOUT_MS) reset();
    }

    void WiringStager::reset()
    {
        active_ = false;
        staged_ = SlotConfig{};
    }
}
```

Add `"slot_config_writer.h", "wiring_stager.h"` to `library.json`'s `headers`. In `README.md`, after the schema table, add a paragraph "## Written by the device": Motorcontrol rebuilds this file from a `WIRING_*` transfer with `write_slot_config_json()`, re-parses it with `parse_slot_config()` before writing, so a device-written file is always one the parser accepts.

- [ ] **Step 4: Run** `$PIO test -e native` in `shared/vmaas-config` → all suites green (writer 5, stager 8, the rest unchanged).

- [ ] **Step 5: Verify.** Green; `git status --short shared/vmaas-config` lists the new files. No commit.

---

### Task 3: Motorcontrol applies a wiring transfer

**Files:** Create `Motorcontrol/src/wiring_commit.h/.cpp`; Modify `command_handler.h/.cpp`, `config_error_responder.h/.cpp`, `main.cpp`.

**Consumes:** Task 1 frames/codes, Task 2 `WiringStager`/`write_slot_config_json`, `vmaas::fs::write_text_file(path, data, len)` (other session's helper, working tree), `config_store::uses_reserved_pin`, `raise_enable_pin`, `MAX_CONFIG_BYTES`.

**Produces:** `bool wiring_commit::commit_wiring(const vmaas::SlotConfig& staged, vmaas::SlotConfig& applied, char* reason, size_t cap)`; `CommandHandler(bus, SlotConfig cfg /*by value*/, gen)`; `ConfigErrorResponder(bus)` handling `WIRING_*`.

- [ ] **Step 1: `wiring_commit.h/.cpp`.**

```cpp
#pragma once
/**
 * @file wiring_commit.h
 * @brief Turn a staged wiring table into the running one: serialise it as
 *        config.json v2, validate it with the boot parser and the board's
 *        reserved-pin check, write it atomically, hand back the parsed copy.
 */
#include <cstddef>
#include "slot_config.h"

namespace wiring_commit
{
    /**
     * @param staged Table collected by WiringStager.
     * @param applied Receives the table as re-parsed from the written text, on success.
     * @param reason Receives a short cause on failure (fits config_store::LoadResult::reason).
     * @return true once /storage/config.json holds the new table.
     */
    bool commit_wiring(const vmaas::SlotConfig& staged, vmaas::SlotConfig& applied, char* reason, size_t cap);
}
```

```cpp
#include "wiring_commit.h"
#include <cstdio>
#include "config_store.h"
#include "esp_log.h"
#include "slot_config_parser.h"
#include "slot_config_writer.h"
#include "storage.h"

namespace
{
    constexpr const char* TAG = "WiringCommit";
}

namespace wiring_commit
{
    bool commit_wiring(const vmaas::SlotConfig& staged, vmaas::SlotConfig& applied, char* reason, size_t cap)
    {
        static char text[config_store::MAX_CONFIG_BYTES];
        const int n = vmaas::write_slot_config_json(staged, text, sizeof(text));
        if (n < 0)
        {
            std::snprintf(reason, cap, "table too large");
            return false;
        }

        const vmaas::SlotParseResult r = vmaas::parse_slot_config(text);
        if (!r.ok)
        {
            const char* what = r.issue_count > 0 ? vmaas::to_string(r.issues[0].kind) : "invalid";
            const char* field = r.issue_count > 0 ? r.issues[0].field : "";
            std::snprintf(reason, cap, "%s %s", field, what);
            ESP_LOGW(TAG, "staged table rejected: %s", reason);
            return false;
        }
        if (config_store::uses_reserved_pin(r.config, reason, cap)) return false;

        if (!vmaas::fs::write_text_file(config_store::CONFIG_PATH, text, static_cast<size_t>(n)))
        {
            std::snprintf(reason, cap, "write failed");
            return false;
        }

        applied = r.config;
        ESP_LOGI(TAG, "%s rewritten: %d bytes, %u slot(s), %u steps per vend", config_store::CONFIG_PATH, n, (unsigned)applied.slot_count, (unsigned)applied.steps_per_vend);
        return true;
    }
}
```

- [ ] **Step 2: `CommandHandler` owns and replaces its table.** In `command_handler.h`: `#include "wiring_stager.h"`; constructor becomes `CommandHandler(vmaas::UartBus& bus, const vmaas::SlotConfig& cfg, IStepGenerator& gen)` but the member becomes `vmaas::SlotConfig cfg_;` (a copy). Add private `void handle_wiring_begin(const vmaas::Frame&)`, `handle_wiring_slot`, `handle_wiring_commit`, `void apply_table(const vmaas::SlotConfig& next)`, `uint32_t now_ms() const`, and members `vmaas::WiringStager stager_;`. Doc comment on the class gains: "A `WIRING_*` transfer replaces the table at runtime: `COMMIT` is refused with `NAK BUSY` during a vend, otherwise the staged table is validated, written and applied, and the new pins are raised before they become live."

In `command_handler.cpp`:

- `#include "wiring_commit.h"` and `#include "esp_timer.h"`; `uint32_t CommandHandler::now_ms() const { return static_cast<uint32_t>(esp_timer_get_time() / 1000); }`
- `tick()` gains `stager_.tick(now_ms());` as its first line (before the Idle early return).
- `handle()` switch gains `case Cmd::WIRING_BEGIN: handle_wiring_begin(f); break;` and the other two.
- Handlers:

```cpp
void CommandHandler::handle_wiring_begin(const Frame& f)
{
    if (f.len != 0) { bus_.send(frames::nak(Cmd::WIRING_BEGIN, ErrorCode::BAD_PAYLOAD)); return; }
    stager_.begin(now_ms());
    bus_.send(frames::ack(Cmd::WIRING_BEGIN));
}

void CommandHandler::handle_wiring_slot(const Frame& f)
{
    if (f.len < 2 || f.len != 2 + f.payload[1]) { bus_.send(frames::nak(Cmd::WIRING_SLOT, ErrorCode::BAD_PAYLOAD)); return; }
    switch (stager_.add_slot(f.payload[0], &f.payload[2], f.payload[1], now_ms()))
    {
    case WiringStager::Result::Ok:       bus_.send(frames::ack(Cmd::WIRING_SLOT)); break;
    case WiringStager::Result::NotBegun: bus_.send(frames::nak(Cmd::WIRING_SLOT, ErrorCode::WIRING_STATE)); break;
    default:                             bus_.send(frames::nak(Cmd::WIRING_SLOT, ErrorCode::WIRING_FULL)); break;
    }
}

void CommandHandler::handle_wiring_commit(const Frame& f)
{
    if (f.len != 3) { bus_.send(frames::nak(Cmd::WIRING_COMMIT, ErrorCode::BAD_PAYLOAD)); return; }
    if (seq_.state() != VendState::Idle)
    {
        ESP_LOGW(TAG, "WIRING_COMMIT refused: vend in progress on slot %u", seq_.current_slot());
        bus_.send(frames::nak(Cmd::WIRING_COMMIT, ErrorCode::BUSY));
        return;
    }
    const uint16_t steps = static_cast<uint16_t>(f.payload[1] | (f.payload[2] << 8));
    SlotConfig staged{};
    switch (stager_.commit(f.payload[0], steps, now_ms(), staged))
    {
    case WiringStager::Result::Ok: break;
    case WiringStager::Result::NotBegun:
        bus_.send(frames::nak(Cmd::WIRING_COMMIT, ErrorCode::WIRING_STATE)); return;
    case WiringStager::Result::Full:
        bus_.send(frames::nak(Cmd::WIRING_COMMIT, ErrorCode::WIRING_FULL)); return;
    default:
        ESP_LOGW(TAG, "WIRING_COMMIT refused: count or steps do not match the staged table");
        bus_.send(frames::nak(Cmd::WIRING_COMMIT, ErrorCode::WRITE_FAILED)); return;
    }

    SlotConfig applied{};
    char reason[40];
    if (!wiring_commit::commit_wiring(staged, applied, reason, sizeof(reason)))
    {
        ESP_LOGW(TAG, "WIRING_COMMIT failed: %s; keeping the running table", reason);
        bus_.send(frames::nak(Cmd::WIRING_COMMIT, ErrorCode::WRITE_FAILED));
        return;
    }
    apply_table(applied);
    bus_.send(frames::ack(Cmd::WIRING_COMMIT));
}

void CommandHandler::apply_table(const SlotConfig& next)
{
    for (size_t i = 0; i < next.slot_count; ++i)
        for (size_t k = 0; k < next.slots[i].pin_count; ++k)
            config_store::raise_enable_pin(static_cast<gpio_num_t>(next.slots[i].pins[k]));
    cfg_ = next;
    ESP_LOGI(TAG, "wiring applied: %u slots, %u steps per vend", (unsigned)cfg_.slot_count, (unsigned)cfg_.steps_per_vend);
}
```

(Old pins that are no longer in the table stay high as outputs; they were raised before and nothing drives them.)

- [ ] **Step 3: `ConfigErrorResponder` accepts the transfer.** Add members `vmaas::WiringStager stager_;` and `void tick();` (calls `stager_.tick(now_ms())`; `now_ms()` via `esp_timer_get_time`). `expected_len` returns true for `WIRING_BEGIN` (0), `WIRING_COMMIT` (3); `WIRING_SLOT` is length-checked as in the handler (`len >= 2 && len == 2 + payload[1]`). `handle()` routes the three wiring commands to the same logic as Steps 2 above, except the commit path: `NAK BUSY` never applies (no vend), and on `commit_wiring` success it logs `"new wiring written; restarting into it"`, sends `ACK WIRING_COMMIT`, waits `vTaskDelay(pdMS_TO_TICKS(50))` so the ACK leaves the UART, and calls `esp_restart()`. `main.cpp`'s `run_config_error` loop calls `responder.tick()` each pass. Update the header comment: WIRING_* is accepted; RUN/STOP/CONFIG are still refused.

- [ ] **Step 4: `main.cpp`.** `run_with_slots(const vmaas::SlotConfig& cfg)` is unchanged in signature; `CommandHandler handler(bus, cfg, generator);` now copies. Extend the file-header comment with one sentence: "A `WIRING_*` transfer from Main-Controller rewrites config.json and, in the normal state, applies it live; in the config-error state the board restarts into it."

- [ ] **Step 5: Build.** `cd Motorcontrol && $PIO run -e controller-motor` → SUCCESS. If `wiring_stager.h`/`slot_config_writer.h` are not found, the LDF did not pick them up: they live in `shared/vmaas-config/src`, which Motorcontrol already includes (`slot_config_parser.h`); check `library.json` lists them.

- [ ] **Step 6: Flash and verify boot.** `-t upload` (COM7; no `uploadfs`), then `$PY tools/capture_serial.py COM7 8`: the same five boot lines as before. Then the negative path that needs no Main-Controller: temporarily make `data/config.json` invalid (`"pins": [16]` on slot 4), `-t uploadfs`, capture: config-error state as before, and the log now says `refusing RUN/STOP/CONFIG, accepting WIRING_*`. Restore `data/config.json` (slots 1–4 on 18/19/21/22), `uploadfs`, capture normal boot.

- [ ] **Step 7: Verify.** Build green, both captures recorded, `git status --short Motorcontrol shared/vmaas-config shared/vmaas-protocol` lists the changes. No commit. **End-to-end (Main-Controller sends the frames) is verified when the other session's Main-Controller half lands**: publish from the admin UI, watch Motorcontrol log `config.json rewritten` and `wiring applied`, then `RUN` a slot from the new table.

---

## Manual verification of this plan

- [ ] `$PIO test -e native` green in `shared/vmaas-protocol` and `shared/vmaas-config`.
- [ ] Motorcontrol builds and boots as before; config-error boot announces `accepting WIRING_*`.
- [ ] After the other session lands: a published wiring reaches Motorcontrol without a reflash; a `COMMIT` with a wrong `count` is `NAK WRITE_FAILED` and the old file survives; a `COMMIT` during a vend is `NAK BUSY`.
