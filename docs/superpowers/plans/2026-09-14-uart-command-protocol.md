# UART Command Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Main-Controller send typed commands (RUN, STOP, STATUS, CONFIG) to Motorcontrol over UART and receive ACK/NAK/DONE/STATUS_REPLY, replacing the PING/PONG test loop.

**Architecture:** A shared PlatformIO library `shared/vmaas-protocol` holds the binary frame format (START/LEN/CMD/PAYLOAD/CRC-8), a byte-at-a-time parser, and a thin ESP-IDF UART wrapper. Layers 1-2 (crc8, frame codec) have no hardware dependency and are unit-tested on the PC with PlatformIO's `native` platform. Each board adds one board-specific class on top: `MotorClient` (Main-Controller) and `CommandHandler` (Motorcontrol).

**Tech Stack:** ESP-IDF via PlatformIO (`framework = espidf`, `board = esp32dev`), C++17, Unity test framework, PlatformIO `native` platform for host tests.

**Spec:** `docs/superpowers/specs/2026-09-14-uart-command-protocol-design.md`

## Global Constraints

- Frame: `[0xAA][LEN][CMD][PAYLOAD 0-8][CRC]`. `LEN` max 8. CRC-8 poly `0x07`, init `0x00`, no reflection, no final XOR, computed over LEN+CMD+PAYLOAD.
- Request CMD ids `< 0x80`, reply ids `>= 0x80`. Exact ids in spec section 3.
- Multi-byte payload values are little-endian.
- UART 115200 8N1 on `UART_NUM_1`, TX=17, RX=16 on both boards (crossed wiring: A.17 -> B.16, B.17 -> A.16).
- Code, comments, commit messages and docs in English. Log strings in English.
- Layers 1-2 (`crc8`, `frame_codec`, `protocol.h`) must not include any ESP-IDF or FreeRTOS header.
- C++ exceptions and RTTI are disabled in sdkconfig. Do not use `throw`, `dynamic_cast`, or `typeid`.
- No timeouts, retries or sequence numbers in v1 (spec section 2).
- All commits on branch `dev`.

## Prerequisites (one-time, on the developer machine)

PlatformIO CLI and a host C++ compiler were not installed as of 2026-09-07. Before Task 1:

```powershell
pip install --user platformio
pio --version
```

For the `native` platform on Windows a GCC is needed. If `gcc --version` fails, install MSYS2 (https://www.msys2.org), then in the MSYS2 UCRT64 shell run `pacman -S mingw-w64-ucrt-x86_64-gcc`, and add `C:\msys64\ucrt64\bin` to PATH. Verify with `gcc --version` in a fresh PowerShell.

The first `pio run` for an espidf environment downloads the ESP-IDF toolchain (several GB, 10-20 minutes). Expect that in Task 5.

## Learning checkpoints

Two places in this plan carry a design decision the project owner should make rather than the executor. They are marked **OWNER DECISION** inside the task. The executor implements the default given, then flags the spot for the owner to change if they want:

- Task 6, `slot_map.h`: which GPIO drives which slot. Defaults are provisional.
- Task 6, `CommandHandler::handle_run`: what happens when RUN arrives while BUSY. Default is `NAK BUSY` per spec; an alternative is queueing.

---

## File Structure

```
shared/vmaas-protocol/
  platformio.ini                 # [env:native] for host tests
  library.json                   # makes the folder a PlatformIO library
  PROTOCOL.md                    # wire format documentation (living)
  src/protocol.h                 # constants, enums, Frame, frame builders
  src/crc8.h, src/crc8.cpp       # CRC-8
  src/frame_codec.h, .cpp        # encode() + FrameParser
  src/uart_bus.h, .cpp           # UartBus (guarded by #ifdef ESP_PLATFORM)
  test/test_protocol/test_main.cpp
  test/test_crc8/test_main.cpp
  test/test_frame_codec/test_main.cpp
Main-Controller/
  platformio.ini                 # + lib_extra_dirs
  src/motor_client.h, .cpp       # MotorClient
  src/main.cpp                   # rewritten: MotorClient smoke loop
  src/config.h                   # unchanged
  src/pins.h                     # unchanged
Motorcontrol/
  platformio.ini                 # + lib_extra_dirs
  src/slot_map.h                 # slot -> GPIO table
  src/command_handler.h, .cpp    # CommandHandler
  src/main.cpp                   # rewritten: CommandHandler loop
  src/pins.h                     # unchanged
```

---

### Task 1: Library scaffold, `protocol.h`, native test environment, PROTOCOL.md

**Files:**
- Create: `shared/vmaas-protocol/platformio.ini`
- Create: `shared/vmaas-protocol/library.json`
- Create: `shared/vmaas-protocol/src/protocol.h`
- Create: `shared/vmaas-protocol/test/test_protocol/test_main.cpp`
- Create: `shared/vmaas-protocol/PROTOCOL.md`
- Create: `shared/vmaas-protocol/.gitignore`

**Interfaces:**
- Produces: namespace `vmaas` with `FRAME_START`, `MAX_PAYLOAD`, `MAX_FRAME_SIZE`, `enum class Cmd`, `enum class ErrorCode`, `enum class State`, `enum class ConfigParam`, `struct Frame { Cmd cmd; uint8_t len; uint8_t payload[MAX_PAYLOAD]; }`, `constexpr bool is_reply(Cmd)`, and builders in `vmaas::frames`: `run(uint8_t slot)`, `stop()`, `status()`, `config(ConfigParam, uint16_t)`, `ack(Cmd)`, `nak(Cmd, ErrorCode)`, `done(uint8_t slot)`, `status_reply(State, uint8_t current_slot)`.

- [ ] **Step 1: Create the PlatformIO project files**

`shared/vmaas-protocol/platformio.ini`:

```ini
; Host-side unit tests for the shared protocol library.
; Run from this directory: pio test -e native
[env:native]
platform = native
test_framework = unity
test_build_src = yes
build_flags = -std=c++17 -Wall -Wextra
```

`shared/vmaas-protocol/library.json`:

```json
{
  "name": "vmaas-protocol",
  "version": "0.1.0",
  "description": "Binary UART command protocol shared by Main-Controller and Motorcontrol",
  "keywords": ["uart", "protocol", "vmaas"],
  "frameworks": "*",
  "platforms": "*",
  "headers": ["protocol.h", "frame_codec.h", "uart_bus.h"]
}
```

`shared/vmaas-protocol/.gitignore`:

```
.pio
```

- [ ] **Step 2: Write the failing test**

`shared/vmaas-protocol/test/test_protocol/test_main.cpp`:

```cpp
#include <unity.h>
#include "protocol.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

void test_constants()
{
    TEST_ASSERT_EQUAL_HEX8(0xAA, FRAME_START);
    TEST_ASSERT_EQUAL_UINT8(8, MAX_PAYLOAD);
    TEST_ASSERT_EQUAL_UINT32(12, MAX_FRAME_SIZE);
}

void test_command_ids_match_spec()
{
    TEST_ASSERT_EQUAL_HEX8(0x10, static_cast<uint8_t>(Cmd::RUN));
    TEST_ASSERT_EQUAL_HEX8(0x11, static_cast<uint8_t>(Cmd::STOP));
    TEST_ASSERT_EQUAL_HEX8(0x12, static_cast<uint8_t>(Cmd::STATUS));
    TEST_ASSERT_EQUAL_HEX8(0x13, static_cast<uint8_t>(Cmd::CONFIG));
    TEST_ASSERT_EQUAL_HEX8(0x80, static_cast<uint8_t>(Cmd::ACK));
    TEST_ASSERT_EQUAL_HEX8(0x81, static_cast<uint8_t>(Cmd::NAK));
    TEST_ASSERT_EQUAL_HEX8(0x82, static_cast<uint8_t>(Cmd::DONE));
    TEST_ASSERT_EQUAL_HEX8(0x83, static_cast<uint8_t>(Cmd::STATUS_REPLY));
}

void test_is_reply()
{
    TEST_ASSERT_FALSE(is_reply(Cmd::RUN));
    TEST_ASSERT_FALSE(is_reply(Cmd::CONFIG));
    TEST_ASSERT_TRUE(is_reply(Cmd::ACK));
    TEST_ASSERT_TRUE(is_reply(Cmd::STATUS_REPLY));
}

void test_builder_run()
{
    Frame f = frames::run(3);
    TEST_ASSERT_EQUAL(Cmd::RUN, f.cmd);
    TEST_ASSERT_EQUAL_UINT8(1, f.len);
    TEST_ASSERT_EQUAL_UINT8(3, f.payload[0]);
}

void test_builder_stop_and_status_have_no_payload()
{
    TEST_ASSERT_EQUAL_UINT8(0, frames::stop().len);
    TEST_ASSERT_EQUAL_UINT8(0, frames::status().len);
}

void test_builder_config_is_little_endian()
{
    Frame f = frames::config(ConfigParam::RUN_TIME_MS, 0x01F4); // 500 ms
    TEST_ASSERT_EQUAL(Cmd::CONFIG, f.cmd);
    TEST_ASSERT_EQUAL_UINT8(3, f.len);
    TEST_ASSERT_EQUAL_UINT8(1, f.payload[0]);
    TEST_ASSERT_EQUAL_HEX8(0xF4, f.payload[1]);
    TEST_ASSERT_EQUAL_HEX8(0x01, f.payload[2]);
}

void test_builder_replies()
{
    Frame a = frames::ack(Cmd::RUN);
    TEST_ASSERT_EQUAL(Cmd::ACK, a.cmd);
    TEST_ASSERT_EQUAL_UINT8(1, a.len);
    TEST_ASSERT_EQUAL_HEX8(0x10, a.payload[0]);

    Frame n = frames::nak(Cmd::RUN, ErrorCode::UNKNOWN_SLOT);
    TEST_ASSERT_EQUAL(Cmd::NAK, n.cmd);
    TEST_ASSERT_EQUAL_UINT8(2, n.len);
    TEST_ASSERT_EQUAL_HEX8(0x10, n.payload[0]);
    TEST_ASSERT_EQUAL_UINT8(4, n.payload[1]);

    Frame d = frames::done(7);
    TEST_ASSERT_EQUAL(Cmd::DONE, d.cmd);
    TEST_ASSERT_EQUAL_UINT8(1, d.len);
    TEST_ASSERT_EQUAL_UINT8(7, d.payload[0]);

    Frame s = frames::status_reply(State::BUSY, 2);
    TEST_ASSERT_EQUAL(Cmd::STATUS_REPLY, s.cmd);
    TEST_ASSERT_EQUAL_UINT8(2, s.len);
    TEST_ASSERT_EQUAL_UINT8(1, s.payload[0]);
    TEST_ASSERT_EQUAL_UINT8(2, s.payload[1]);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_constants);
    RUN_TEST(test_command_ids_match_spec);
    RUN_TEST(test_is_reply);
    RUN_TEST(test_builder_run);
    RUN_TEST(test_builder_stop_and_status_have_no_payload);
    RUN_TEST(test_builder_config_is_little_endian);
    RUN_TEST(test_builder_replies);
    return UNITY_END();
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run (from `shared/vmaas-protocol`): `pio test -e native -f test_protocol`
Expected: build error, `protocol.h: No such file or directory`.

- [ ] **Step 4: Write `protocol.h`**

`shared/vmaas-protocol/src/protocol.h`:

```cpp
#pragma once
// Wire-level definitions for the VMaaS UART command protocol.
// See PROTOCOL.md in this folder. This header must stay free of any
// ESP-IDF or FreeRTOS include so it can be unit-tested on the host.

#include <cstddef>
#include <cstdint>

namespace vmaas
{
    constexpr uint8_t FRAME_START = 0xAA;
    constexpr uint8_t MAX_PAYLOAD = 8;
    // START + LEN + CMD + CRC = 4 fixed bytes, plus the payload.
    constexpr size_t MAX_FRAME_SIZE = 4 + MAX_PAYLOAD;

    enum class Cmd : uint8_t
    {
        // Requests, Main-Controller -> Motorcontrol
        RUN = 0x10,
        STOP = 0x11,
        STATUS = 0x12,
        CONFIG = 0x13,
        // Replies, Motorcontrol -> Main-Controller
        ACK = 0x80,
        NAK = 0x81,
        DONE = 0x82,
        STATUS_REPLY = 0x83,
    };

    enum class ErrorCode : uint8_t
    {
        UNKNOWN_CMD = 1,
        BAD_PAYLOAD = 2,
        BUSY = 3,
        UNKNOWN_SLOT = 4,
        BAD_PARAM = 5,
    };

    enum class State : uint8_t
    {
        IDLE = 0,
        BUSY = 1,
        ERROR = 2,
    };

    enum class ConfigParam : uint8_t
    {
        RUN_TIME_MS = 1,
    };

    struct Frame
    {
        Cmd cmd = Cmd::STATUS;
        uint8_t len = 0;
        uint8_t payload[MAX_PAYLOAD] = {};
    };

    constexpr bool is_reply(Cmd c)
    {
        return static_cast<uint8_t>(c) >= 0x80;
    }

    // Convenience constructors for every frame in the protocol.
    namespace frames
    {
        inline Frame run(uint8_t slot)
        {
            Frame f;
            f.cmd = Cmd::RUN;
            f.len = 1;
            f.payload[0] = slot;
            return f;
        }

        inline Frame stop()
        {
            Frame f;
            f.cmd = Cmd::STOP;
            return f;
        }

        inline Frame status()
        {
            Frame f;
            f.cmd = Cmd::STATUS;
            return f;
        }

        inline Frame config(ConfigParam param, uint16_t value)
        {
            Frame f;
            f.cmd = Cmd::CONFIG;
            f.len = 3;
            f.payload[0] = static_cast<uint8_t>(param);
            f.payload[1] = static_cast<uint8_t>(value & 0xFF);
            f.payload[2] = static_cast<uint8_t>(value >> 8);
            return f;
        }

        inline Frame ack(Cmd acknowledged)
        {
            Frame f;
            f.cmd = Cmd::ACK;
            f.len = 1;
            f.payload[0] = static_cast<uint8_t>(acknowledged);
            return f;
        }

        inline Frame nak(Cmd rejected, ErrorCode error)
        {
            Frame f;
            f.cmd = Cmd::NAK;
            f.len = 2;
            f.payload[0] = static_cast<uint8_t>(rejected);
            f.payload[1] = static_cast<uint8_t>(error);
            return f;
        }

        inline Frame done(uint8_t slot)
        {
            Frame f;
            f.cmd = Cmd::DONE;
            f.len = 1;
            f.payload[0] = slot;
            return f;
        }

        inline Frame status_reply(State state, uint8_t current_slot)
        {
            Frame f;
            f.cmd = Cmd::STATUS_REPLY;
            f.len = 2;
            f.payload[0] = static_cast<uint8_t>(state);
            f.payload[1] = current_slot;
            return f;
        }
    } // namespace frames
} // namespace vmaas
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pio test -e native -f test_protocol`
Expected: `7 Tests 0 Failures 0 Ignored`, `[PASSED]`.

- [ ] **Step 6: Write PROTOCOL.md**

`shared/vmaas-protocol/PROTOCOL.md`:

```markdown
# VMaaS UART Command Protocol

Binary protocol between Main-Controller (master) and Motorcontrol (slave)
over UART, 115200 baud, 8 data bits, no parity, 1 stop bit.

This file documents the wire format. `src/protocol.h` is the code that
implements it. When one changes, change the other in the same commit.

## Frame

```
[START][LEN][CMD][PAYLOAD ...][CRC]
 0xAA   1B   1B   0-8 bytes    1B
```

| Field   | Size   | Meaning |
|---------|--------|---------|
| START   | 1 byte | Always `0xAA`. Receiver discards bytes until it sees one. |
| LEN     | 1 byte | Payload length, 0-8. Greater than 8 invalidates the frame. |
| CMD     | 1 byte | Command id. Requests `< 0x80`, replies `>= 0x80`. |
| PAYLOAD | 0-8 B  | Command-specific. Multi-byte values are little-endian. |
| CRC     | 1 byte | CRC-8 over LEN, CMD and PAYLOAD. START is not included. |

CRC-8: polynomial `0x07`, initial value `0x00`, no input or output
reflection, no final XOR. Check value: CRC-8 of ASCII `"123456789"` is `0xF4`.

Example, `RUN slot 3`: `AA 01 10 03 35`.

## Requests (Main-Controller -> Motorcontrol)

| CMD    | Name   | Payload                        |
|--------|--------|--------------------------------|
| `0x10` | RUN    | `slot` u8                      |
| `0x11` | STOP   | none                           |
| `0x12` | STATUS | none                           |
| `0x13` | CONFIG | `param` u8, `value` u16 LE     |

## Replies (Motorcontrol -> Main-Controller)

| CMD    | Name         | Payload                                  |
|--------|--------------|------------------------------------------|
| `0x80` | ACK          | `cmd` u8, the request being acknowledged |
| `0x81` | NAK          | `cmd` u8, `error` u8                     |
| `0x82` | DONE         | `slot` u8                                |
| `0x83` | STATUS_REPLY | `state` u8, `current_slot` u8            |

## Enumerations

State: `0` IDLE, `1` BUSY, `2` ERROR.

NAK error codes:

| Code | Name         | When |
|------|--------------|------|
| 1    | UNKNOWN_CMD  | CMD is not in the table above |
| 2    | BAD_PAYLOAD  | LEN does not match the CMD |
| 3    | BUSY         | RUN while a motor is already running |
| 4    | UNKNOWN_SLOT | slot not present in Motorcontrol's slot map |
| 5    | BAD_PARAM    | CONFIG param id not recognised |

CONFIG params:

| Id | Name        | Value                                     |
|----|-------------|-------------------------------------------|
| 1  | RUN_TIME_MS | u16, how long the motor runs on RUN. Default 500. Volatile (lost on reset). |

## Flows

Normal vend:

```
Main  -> Motor : RUN 3
Motor -> Main  : ACK RUN
                 (motor runs RUN_TIME_MS)
Motor -> Main  : DONE 3
```

Rejected vend:

```
Main  -> Motor : RUN 9
Motor -> Main  : NAK RUN UNKNOWN_SLOT
```

STOP while running: `ACK STOP`, pin goes low, no DONE for the interrupted slot.

STATUS: `STATUS_REPLY` is sent immediately. No ACK.

## Receiver behaviour

- Bad CRC or LEN > 8: frame dropped, logged, parser returns to waiting for START. No reply.
- Unknown CMD: `NAK UNKNOWN_CMD`.
- A `0xAA` inside a payload is data, not a new START. Resync relies on the CRC.

## Not in v1

No timeouts, retries or sequence numbers. At most one request is in flight.
```

- [ ] **Step 7: Commit**

```bash
git add shared/vmaas-protocol
git commit -m "feat(protocol): scaffold shared vmaas-protocol library with frame definitions and PROTOCOL.md"
```

---

### Task 2: CRC-8

**Files:**
- Create: `shared/vmaas-protocol/src/crc8.h`
- Create: `shared/vmaas-protocol/src/crc8.cpp`
- Create: `shared/vmaas-protocol/test/test_crc8/test_main.cpp`

**Interfaces:**
- Produces: `uint8_t vmaas::crc8(const uint8_t* data, size_t len);`

- [ ] **Step 1: Write the failing test**

`shared/vmaas-protocol/test/test_crc8/test_main.cpp`:

```cpp
#include <unity.h>
#include <cstring>
#include "crc8.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

void test_empty_input_is_zero()
{
    TEST_ASSERT_EQUAL_HEX8(0x00, crc8(nullptr, 0));
}

void test_single_zero_byte_is_zero()
{
    const uint8_t d[] = {0x00};
    TEST_ASSERT_EQUAL_HEX8(0x00, crc8(d, 1));
}

void test_single_one_byte_is_poly()
{
    // 0x01 shifted through 8 rounds of poly 0x07 gives 0x07.
    const uint8_t d[] = {0x01};
    TEST_ASSERT_EQUAL_HEX8(0x07, crc8(d, 1));
}

void test_standard_check_value()
{
    // Standard CRC-8 (poly 0x07, init 0, no reflection) check string.
    const char* s = "123456789";
    TEST_ASSERT_EQUAL_HEX8(0xF4, crc8(reinterpret_cast<const uint8_t*>(s), std::strlen(s)));
}

void test_run_slot_3_header()
{
    // LEN=1, CMD=RUN(0x10), payload=3. This is the CRC byte in the
    // PROTOCOL.md example frame AA 01 10 03 35.
    const uint8_t d[] = {0x01, 0x10, 0x03};
    TEST_ASSERT_EQUAL_HEX8(0x35, crc8(d, 3));
}

void test_flipping_a_bit_changes_crc()
{
    const uint8_t a[] = {0x01, 0x10, 0x03};
    const uint8_t b[] = {0x01, 0x10, 0x02};
    TEST_ASSERT_NOT_EQUAL(crc8(a, 3), crc8(b, 3));
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_empty_input_is_zero);
    RUN_TEST(test_single_zero_byte_is_zero);
    RUN_TEST(test_single_one_byte_is_poly);
    RUN_TEST(test_standard_check_value);
    RUN_TEST(test_run_slot_3_header);
    RUN_TEST(test_flipping_a_bit_changes_crc);
    return UNITY_END();
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pio test -e native -f test_crc8`
Expected: build error, `crc8.h: No such file or directory`.

- [ ] **Step 3: Implement crc8**

`shared/vmaas-protocol/src/crc8.h`:

```cpp
#pragma once
#include <cstddef>
#include <cstdint>

namespace vmaas
{
    // CRC-8, polynomial 0x07, init 0x00, no reflection, no final XOR.
    // Passing len == 0 returns 0x00 and never dereferences data.
    uint8_t crc8(const uint8_t* data, size_t len);
}
```

`shared/vmaas-protocol/src/crc8.cpp`:

```cpp
#include "crc8.h"

namespace vmaas
{
    uint8_t crc8(const uint8_t* data, size_t len)
    {
        uint8_t crc = 0x00;
        for (size_t i = 0; i < len; ++i)
        {
            crc ^= data[i];
            for (int bit = 0; bit < 8; ++bit)
            {
                if (crc & 0x80)
                    crc = static_cast<uint8_t>((crc << 1) ^ 0x07);
                else
                    crc = static_cast<uint8_t>(crc << 1);
            }
        }
        return crc;
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pio test -e native -f test_crc8`
Expected: `6 Tests 0 Failures 0 Ignored`.

If `test_run_slot_3_header` alone fails, the hand-computed `0x35` is wrong, not the implementation: `test_standard_check_value` is the authoritative check. Recompute the expected byte with any CRC-8 calculator set to poly 0x07 over bytes `01 10 03` and update the test and PROTOCOL.md example.

- [ ] **Step 5: Commit**

```bash
git add shared/vmaas-protocol/src/crc8.h shared/vmaas-protocol/src/crc8.cpp shared/vmaas-protocol/test/test_crc8
git commit -m "feat(protocol): add CRC-8 with unit tests"
```

---

### Task 3: Frame encoder

**Files:**
- Create: `shared/vmaas-protocol/src/frame_codec.h`
- Create: `shared/vmaas-protocol/src/frame_codec.cpp`
- Create: `shared/vmaas-protocol/test/test_frame_codec/test_main.cpp`

**Interfaces:**
- Consumes: `vmaas::Frame`, `vmaas::frames::*`, `vmaas::crc8`.
- Produces: `size_t vmaas::encode(const Frame& f, uint8_t* out, size_t out_size);` returns bytes written (`4 + f.len`), or `0` if `f.len > MAX_PAYLOAD` or `out_size` is too small. The `FrameParser` class is declared in the same header but implemented in Task 4.

- [ ] **Step 1: Write the failing test**

`shared/vmaas-protocol/test/test_frame_codec/test_main.cpp`:

```cpp
#include <unity.h>
#include "frame_codec.h"
#include "crc8.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

// ---------- encode ----------

void test_encode_run_slot_3_matches_protocol_md()
{
    uint8_t out[MAX_FRAME_SIZE] = {};
    size_t n = encode(frames::run(3), out, sizeof(out));
    const uint8_t expected[] = {0xAA, 0x01, 0x10, 0x03, 0x35};
    TEST_ASSERT_EQUAL_UINT32(5, n);
    TEST_ASSERT_EQUAL_HEX8_ARRAY(expected, out, 5);
}

void test_encode_zero_payload_is_four_bytes()
{
    uint8_t out[MAX_FRAME_SIZE] = {};
    size_t n = encode(frames::stop(), out, sizeof(out));
    TEST_ASSERT_EQUAL_UINT32(4, n);
    TEST_ASSERT_EQUAL_HEX8(0xAA, out[0]);
    TEST_ASSERT_EQUAL_HEX8(0x00, out[1]);
    TEST_ASSERT_EQUAL_HEX8(0x11, out[2]);
    const uint8_t header[] = {0x00, 0x11};
    TEST_ASSERT_EQUAL_HEX8(crc8(header, 2), out[3]);
}

void test_encode_crc_covers_len_cmd_payload_not_start()
{
    Frame f = frames::config(ConfigParam::RUN_TIME_MS, 500);
    uint8_t out[MAX_FRAME_SIZE] = {};
    size_t n = encode(f, out, sizeof(out));
    TEST_ASSERT_EQUAL_UINT32(7, n);
    // CRC over bytes 1..5 (LEN, CMD, 3 payload bytes)
    TEST_ASSERT_EQUAL_HEX8(crc8(&out[1], 5), out[6]);
}

void test_encode_rejects_oversized_payload()
{
    Frame f;
    f.cmd = Cmd::RUN;
    f.len = MAX_PAYLOAD + 1;
    uint8_t out[MAX_FRAME_SIZE] = {};
    TEST_ASSERT_EQUAL_UINT32(0, encode(f, out, sizeof(out)));
}

void test_encode_rejects_small_buffer()
{
    uint8_t out[4] = {};
    TEST_ASSERT_EQUAL_UINT32(0, encode(frames::run(1), out, sizeof(out)));
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_encode_run_slot_3_matches_protocol_md);
    RUN_TEST(test_encode_zero_payload_is_four_bytes);
    RUN_TEST(test_encode_crc_covers_len_cmd_payload_not_start);
    RUN_TEST(test_encode_rejects_oversized_payload);
    RUN_TEST(test_encode_rejects_small_buffer);
    return UNITY_END();
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pio test -e native -f test_frame_codec`
Expected: build error, `frame_codec.h: No such file or directory`.

- [ ] **Step 3: Write the header (encode + FrameParser declaration)**

`shared/vmaas-protocol/src/frame_codec.h`:

```cpp
#pragma once
// Frame <-> bytes. No hardware dependency; unit-tested on the host.
#include <cstddef>
#include <cstdint>
#include "protocol.h"

namespace vmaas
{
    // Serialises f into out. Returns the number of bytes written
    // (4 + f.len), or 0 if f.len > MAX_PAYLOAD or out_size is too small.
    size_t encode(const Frame& f, uint8_t* out, size_t out_size);

    // Byte-at-a-time parser. Feed every received byte; when a complete,
    // CRC-valid frame has been assembled, feed() returns true and fills out.
    // Invalid input (LEN > MAX_PAYLOAD, bad CRC) silently resets the parser
    // and increments dropped_frames().
    class FrameParser
    {
    public:
        bool feed(uint8_t byte, Frame& out);
        void reset();
        uint32_t dropped_frames() const { return dropped_; }

    private:
        enum class Stage : uint8_t
        {
            WAIT_START,
            READ_LEN,
            READ_CMD,
            READ_PAYLOAD,
            READ_CRC,
        };

        Stage stage_ = Stage::WAIT_START;
        Frame current_{};
        uint8_t payload_index_ = 0;
        uint32_t dropped_ = 0;
    };
}
```

- [ ] **Step 4: Implement encode (and stub the parser so the file links)**

`shared/vmaas-protocol/src/frame_codec.cpp`:

```cpp
#include "frame_codec.h"
#include "crc8.h"

namespace vmaas
{
    size_t encode(const Frame& f, uint8_t* out, size_t out_size)
    {
        if (f.len > MAX_PAYLOAD)
            return 0;
        const size_t total = 4 + f.len;
        if (out_size < total)
            return 0;

        out[0] = FRAME_START;
        out[1] = f.len;
        out[2] = static_cast<uint8_t>(f.cmd);
        for (uint8_t i = 0; i < f.len; ++i)
            out[3 + i] = f.payload[i];
        // CRC covers LEN, CMD and PAYLOAD: bytes 1 .. 2+len
        out[3 + f.len] = crc8(&out[1], 2 + f.len);
        return total;
    }

    // FrameParser is implemented in the next task.
    bool FrameParser::feed(uint8_t, Frame&)
    {
        return false;
    }

    void FrameParser::reset()
    {
        stage_ = Stage::WAIT_START;
        payload_index_ = 0;
    }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pio test -e native -f test_frame_codec`
Expected: `5 Tests 0 Failures 0 Ignored`.

- [ ] **Step 6: Commit**

```bash
git add shared/vmaas-protocol/src/frame_codec.h shared/vmaas-protocol/src/frame_codec.cpp shared/vmaas-protocol/test/test_frame_codec
git commit -m "feat(protocol): add frame encoder with unit tests"
```

---

### Task 4: Frame parser

**Files:**
- Modify: `shared/vmaas-protocol/src/frame_codec.cpp` (replace the `FrameParser` stub)
- Modify: `shared/vmaas-protocol/test/test_frame_codec/test_main.cpp` (add parser tests)

**Interfaces:**
- Consumes: `FrameParser` declaration from Task 3, `encode`, `crc8`.
- Produces: working `FrameParser::feed`, `FrameParser::reset`, `FrameParser::dropped_frames`.

- [ ] **Step 1: Add the failing parser tests**

Append to `shared/vmaas-protocol/test/test_frame_codec/test_main.cpp`, above `main()`:

```cpp
// ---------- parser helpers ----------

// Feeds every byte of buf into parser; returns how many frames came out,
// and stores the last one in last.
static int feed_all(FrameParser& parser, const uint8_t* buf, size_t n, Frame& last)
{
    int frames = 0;
    for (size_t i = 0; i < n; ++i)
    {
        Frame f;
        if (parser.feed(buf[i], f))
        {
            last = f;
            ++frames;
        }
    }
    return frames;
}

static void assert_frames_equal(const Frame& a, const Frame& b)
{
    TEST_ASSERT_EQUAL(a.cmd, b.cmd);
    TEST_ASSERT_EQUAL_UINT8(a.len, b.len);
    if (a.len > 0)
        TEST_ASSERT_EQUAL_UINT8_ARRAY(a.payload, b.payload, a.len);
}

// ---------- parser ----------

void test_parse_round_trip_every_command()
{
    const Frame inputs[] = {
        frames::run(3),
        frames::stop(),
        frames::status(),
        frames::config(ConfigParam::RUN_TIME_MS, 1234),
        frames::ack(Cmd::RUN),
        frames::nak(Cmd::CONFIG, ErrorCode::BAD_PARAM),
        frames::done(3),
        frames::status_reply(State::BUSY, 3),
    };
    for (const Frame& in : inputs)
    {
        FrameParser parser;
        uint8_t buf[MAX_FRAME_SIZE] = {};
        size_t n = encode(in, buf, sizeof(buf));
        Frame out;
        TEST_ASSERT_EQUAL_INT(1, feed_all(parser, buf, n, out));
        assert_frames_equal(in, out);
    }
}

void test_parse_skips_leading_garbage()
{
    FrameParser parser;
    uint8_t buf[MAX_FRAME_SIZE + 3] = {0x00, 0xFF, 0x42};
    size_t n = encode(frames::run(5), &buf[3], MAX_FRAME_SIZE);
    Frame out;
    TEST_ASSERT_EQUAL_INT(1, feed_all(parser, buf, 3 + n, out));
    TEST_ASSERT_EQUAL(Cmd::RUN, out.cmd);
    TEST_ASSERT_EQUAL_UINT8(5, out.payload[0]);
    TEST_ASSERT_EQUAL_UINT32(0, parser.dropped_frames());
}

void test_parse_rejects_bad_crc_then_accepts_next()
{
    FrameParser parser;
    uint8_t bad[MAX_FRAME_SIZE] = {};
    size_t nb = encode(frames::run(1), bad, sizeof(bad));
    bad[nb - 1] ^= 0xFF; // corrupt CRC

    uint8_t good[MAX_FRAME_SIZE] = {};
    size_t ng = encode(frames::run(2), good, sizeof(good));

    Frame out;
    TEST_ASSERT_EQUAL_INT(0, feed_all(parser, bad, nb, out));
    TEST_ASSERT_EQUAL_UINT32(1, parser.dropped_frames());
    TEST_ASSERT_EQUAL_INT(1, feed_all(parser, good, ng, out));
    TEST_ASSERT_EQUAL_UINT8(2, out.payload[0]);
}

void test_parse_rejects_len_over_max_and_recovers()
{
    FrameParser parser;
    const uint8_t bad[] = {0xAA, 0x09, 0x10}; // LEN 9 is invalid
    Frame out;
    TEST_ASSERT_EQUAL_INT(0, feed_all(parser, bad, sizeof(bad), out));
    TEST_ASSERT_EQUAL_UINT32(1, parser.dropped_frames());

    uint8_t good[MAX_FRAME_SIZE] = {};
    size_t ng = encode(frames::stop(), good, sizeof(good));
    TEST_ASSERT_EQUAL_INT(1, feed_all(parser, good, ng, out));
    TEST_ASSERT_EQUAL(Cmd::STOP, out.cmd);
}

void test_parse_two_frames_back_to_back()
{
    FrameParser parser;
    uint8_t buf[2 * MAX_FRAME_SIZE] = {};
    size_t n1 = encode(frames::run(7), buf, sizeof(buf));
    size_t n2 = encode(frames::done(7), &buf[n1], sizeof(buf) - n1);
    Frame out;
    TEST_ASSERT_EQUAL_INT(2, feed_all(parser, buf, n1 + n2, out));
    TEST_ASSERT_EQUAL(Cmd::DONE, out.cmd);
}

void test_parse_start_byte_inside_payload_is_data()
{
    FrameParser parser;
    Frame in = frames::run(FRAME_START); // slot 0xAA, legal as data
    uint8_t buf[MAX_FRAME_SIZE] = {};
    size_t n = encode(in, buf, sizeof(buf));
    Frame out;
    TEST_ASSERT_EQUAL_INT(1, feed_all(parser, buf, n, out));
    TEST_ASSERT_EQUAL_HEX8(0xAA, out.payload[0]);
}

void test_parse_max_payload_frame()
{
    FrameParser parser;
    Frame in;
    in.cmd = Cmd::CONFIG;
    in.len = MAX_PAYLOAD;
    for (uint8_t i = 0; i < MAX_PAYLOAD; ++i)
        in.payload[i] = static_cast<uint8_t>(0xF0 + i);
    uint8_t buf[MAX_FRAME_SIZE] = {};
    size_t n = encode(in, buf, sizeof(buf));
    TEST_ASSERT_EQUAL_UINT32(MAX_FRAME_SIZE, n);
    Frame out;
    TEST_ASSERT_EQUAL_INT(1, feed_all(parser, buf, n, out));
    assert_frames_equal(in, out);
}
```

And register them in `main()` after the encode tests:

```cpp
    RUN_TEST(test_parse_round_trip_every_command);
    RUN_TEST(test_parse_skips_leading_garbage);
    RUN_TEST(test_parse_rejects_bad_crc_then_accepts_next);
    RUN_TEST(test_parse_rejects_len_over_max_and_recovers);
    RUN_TEST(test_parse_two_frames_back_to_back);
    RUN_TEST(test_parse_start_byte_inside_payload_is_data);
    RUN_TEST(test_parse_max_payload_frame);
```

- [ ] **Step 2: Run the tests to verify the parser tests fail**

Run: `pio test -e native -f test_frame_codec`
Expected: 5 encode tests pass, 7 parser tests fail (the stub always returns false, so `feed_all` returns 0).

- [ ] **Step 3: Implement the parser**

Replace the two stub methods at the bottom of `shared/vmaas-protocol/src/frame_codec.cpp` with:

```cpp
    bool FrameParser::feed(uint8_t byte, Frame& out)
    {
        switch (stage_)
        {
        case Stage::WAIT_START:
            if (byte == FRAME_START)
                stage_ = Stage::READ_LEN;
            return false;

        case Stage::READ_LEN:
            if (byte > MAX_PAYLOAD)
            {
                ++dropped_;
                reset();
                return false;
            }
            current_.len = byte;
            stage_ = Stage::READ_CMD;
            return false;

        case Stage::READ_CMD:
            current_.cmd = static_cast<Cmd>(byte);
            payload_index_ = 0;
            stage_ = (current_.len == 0) ? Stage::READ_CRC : Stage::READ_PAYLOAD;
            return false;

        case Stage::READ_PAYLOAD:
            current_.payload[payload_index_++] = byte;
            if (payload_index_ == current_.len)
                stage_ = Stage::READ_CRC;
            return false;

        case Stage::READ_CRC:
        {
            // Rebuild the CRC input: LEN, CMD, PAYLOAD.
            uint8_t header[2 + MAX_PAYLOAD];
            header[0] = current_.len;
            header[1] = static_cast<uint8_t>(current_.cmd);
            for (uint8_t i = 0; i < current_.len; ++i)
                header[2 + i] = current_.payload[i];
            const bool ok = (crc8(header, 2 + current_.len) == byte);
            if (ok)
                out = current_;
            else
                ++dropped_;
            reset();
            return ok;
        }
        }
        return false;
    }

    void FrameParser::reset()
    {
        stage_ = Stage::WAIT_START;
        payload_index_ = 0;
        current_ = Frame{};
    }
```

Also remove the comment line `// FrameParser is implemented in the next task.`

- [ ] **Step 4: Run all native tests to verify they pass**

Run: `pio test -e native`
Expected: three test suites, `test_protocol` 7 pass, `test_crc8` 6 pass, `test_frame_codec` 12 pass. Zero failures.

- [ ] **Step 5: Commit**

```bash
git add shared/vmaas-protocol/src/frame_codec.cpp shared/vmaas-protocol/test/test_frame_codec/test_main.cpp
git commit -m "feat(protocol): add byte-at-a-time frame parser with resync and CRC checks"
```

---

### Task 5: UartBus and linking the library into both boards

**Files:**
- Create: `shared/vmaas-protocol/src/uart_bus.h`
- Create: `shared/vmaas-protocol/src/uart_bus.cpp`
- Modify: `Main-Controller/platformio.ini`
- Modify: `Motorcontrol/platformio.ini`
- Modify: `Main-Controller/src/main.cpp` (temporary include to prove the link works; rewritten fully in Task 7)

**Interfaces:**
- Consumes: `encode`, `FrameParser`, `Frame`.
- Produces:
  ```cpp
  class vmaas::UartBus {
  public:
      using FrameHandler = std::function<void(const Frame&)>;
      UartBus(uart_port_t port, int tx_pin, int rx_pin, int baud_rate = 115200);
      void begin();                         // installs driver, configures pins. Aborts on failure.
      void on_frame(FrameHandler handler);  // called from poll() for every valid frame
      bool send(const Frame& f);            // encodes and writes. false if encode fails or write is short.
      void poll(TickType_t timeout);        // reads available bytes (waits at most timeout for the first), dispatches frames
      uint32_t dropped_frames() const;
  };
  ```

- [ ] **Step 1: Write the header**

`shared/vmaas-protocol/src/uart_bus.h`:

```cpp
#pragma once
// ESP-IDF UART transport for the VMaaS protocol. Only compiled on ESP
// targets; the host test build never sees the contents.
#ifdef ESP_PLATFORM

#include <functional>
#include "driver/uart.h"
#include "freertos/FreeRTOS.h"
#include "frame_codec.h"
#include "protocol.h"

namespace vmaas
{
    class UartBus
    {
    public:
        using FrameHandler = std::function<void(const Frame&)>;

        UartBus(uart_port_t port, int tx_pin, int rx_pin, int baud_rate = 115200);

        // Installs the UART driver and configures pins. Calls ESP_ERROR_CHECK,
        // so a failure aborts the board. Call once from app_main.
        void begin();

        void on_frame(FrameHandler handler) { handler_ = std::move(handler); }

        // Encodes and writes f. Returns false if the frame is invalid or the
        // driver accepted fewer bytes than expected. Logs on failure.
        bool send(const Frame& f);

        // Reads whatever is available (blocking up to timeout for the first
        // byte), feeds the parser, and invokes the handler for each frame.
        void poll(TickType_t timeout);

        uint32_t dropped_frames() const { return parser_.dropped_frames(); }

    private:
        uart_port_t port_;
        int tx_pin_;
        int rx_pin_;
        int baud_rate_;
        FrameParser parser_;
        FrameHandler handler_;
    };
}

#endif // ESP_PLATFORM
```

- [ ] **Step 2: Write the implementation**

`shared/vmaas-protocol/src/uart_bus.cpp`:

```cpp
#ifdef ESP_PLATFORM

#include "uart_bus.h"
#include "esp_err.h"
#include "esp_log.h"

namespace
{
    constexpr const char* TAG = "UartBus";
    constexpr int RX_BUFFER_BYTES = 1024;
}

namespace vmaas
{
    UartBus::UartBus(uart_port_t port, int tx_pin, int rx_pin, int baud_rate)
        : port_(port), tx_pin_(tx_pin), rx_pin_(rx_pin), baud_rate_(baud_rate)
    {
    }

    void UartBus::begin()
    {
        uart_config_t config = {};
        config.baud_rate = baud_rate_;
        config.data_bits = UART_DATA_8_BITS;
        config.parity = UART_PARITY_DISABLE;
        config.stop_bits = UART_STOP_BITS_1;
        config.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
        config.source_clk = UART_SCLK_DEFAULT;

        ESP_ERROR_CHECK(uart_driver_install(port_, RX_BUFFER_BYTES, 0, 0, nullptr, 0));
        ESP_ERROR_CHECK(uart_param_config(port_, &config));
        ESP_ERROR_CHECK(uart_set_pin(port_, tx_pin_, rx_pin_,
                                     UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));
        ESP_LOGI(TAG, "UART%d ready, TX=%d RX=%d, %d baud", (int)port_, tx_pin_, rx_pin_, baud_rate_);
    }

    bool UartBus::send(const Frame& f)
    {
        uint8_t buf[MAX_FRAME_SIZE];
        const size_t n = encode(f, buf, sizeof(buf));
        if (n == 0)
        {
            ESP_LOGE(TAG, "send: invalid frame (cmd=0x%02X len=%u)", (unsigned)f.cmd, f.len);
            return false;
        }
        const int written = uart_write_bytes(port_, buf, n);
        if (written != static_cast<int>(n))
        {
            ESP_LOGE(TAG, "send: wrote %d of %u bytes", written, (unsigned)n);
            return false;
        }
        ESP_LOGD(TAG, "TX cmd=0x%02X len=%u", (unsigned)f.cmd, f.len);
        return true;
    }

    void UartBus::poll(TickType_t timeout)
    {
        uint8_t byte;
        // First read may block up to timeout; subsequent reads drain what is there.
        int got = uart_read_bytes(port_, &byte, 1, timeout);
        while (got == 1)
        {
            Frame f;
            const uint32_t dropped_before = parser_.dropped_frames();
            if (parser_.feed(byte, f))
            {
                ESP_LOGD(TAG, "RX cmd=0x%02X len=%u", (unsigned)f.cmd, f.len);
                if (handler_)
                    handler_(f);
            }
            else if (parser_.dropped_frames() != dropped_before)
            {
                ESP_LOGW(TAG, "dropped invalid frame (total %lu)", (unsigned long)parser_.dropped_frames());
            }
            got = uart_read_bytes(port_, &byte, 1, 0);
        }
    }
}

#endif // ESP_PLATFORM
```

- [ ] **Step 3: Verify the native tests still pass (guard works)**

Run (from `shared/vmaas-protocol`): `pio test -e native`
Expected: all 25 tests pass; `uart_bus.cpp` compiles to an empty translation unit.

- [ ] **Step 4: Add `lib_extra_dirs` to both boards**

`Main-Controller/platformio.ini`, replace the `[env:main-controller]` block with:

```ini
[env:main-controller]
platform = espressif32
board = esp32dev
framework = espidf
lib_extra_dirs = ../shared
monitor_speed = 115200
```

`Motorcontrol/platformio.ini`, replace the `[env:controller-motor]` block with:

```ini
[env:controller-motor]
platform = espressif32
board = esp32dev
framework = espidf
lib_extra_dirs = ../shared
monitor_speed = 115200
```

(The empty `platform_packages =` line in Motorcontrol is removed.)

- [ ] **Step 5: Prove the library links on a real target**

Temporarily add to the top of `Main-Controller/src/main.cpp`, after the existing includes:

```cpp
#include "uart_bus.h"
static vmaas::UartBus g_link_check(UART_NUM_1, Pins::UART_TX, Pins::UART_RX);
```

Run (from `Main-Controller`): `pio run -e main-controller`
Expected: build succeeds. First run downloads the ESP-IDF toolchain; allow 10-20 minutes. Look for `Found 1 compatible libraries` and `vmaas-protocol` in the Library Dependency Finder output.

If the build fails with `uart_bus.h: No such file or directory`, the LDF did not find the library. Check that `shared/vmaas-protocol/library.json` exists and that `lib_extra_dirs` is `../shared`, not `../shared/vmaas-protocol`.

Then remove the two temporary lines again.

Run (from `Motorcontrol`): `pio run -e controller-motor`
Expected: build succeeds (nothing from the library is used yet, so this checks only the ini change).

- [ ] **Step 6: Commit**

```bash
git add shared/vmaas-protocol/src/uart_bus.h shared/vmaas-protocol/src/uart_bus.cpp Main-Controller/platformio.ini Motorcontrol/platformio.ini
git commit -m "feat(protocol): add UartBus ESP-IDF transport and link shared library into both boards"
```

---

### Task 6: Motorcontrol: slot map, CommandHandler, main loop

**Files:**
- Create: `Motorcontrol/src/slot_map.h`
- Create: `Motorcontrol/src/command_handler.h`
- Create: `Motorcontrol/src/command_handler.cpp`
- Modify: `Motorcontrol/src/main.cpp` (currently an empty `app_main`)

**Interfaces:**
- Consumes: `vmaas::UartBus`, `vmaas::Frame`, `vmaas::frames::*`, `Pins::UART_TX`, `Pins::UART_RX`.
- Produces:
  ```cpp
  struct SlotPin { uint8_t slot; gpio_num_t pin; };
  namespace SlotMap { constexpr SlotPin pins[]; constexpr size_t count; }

  class CommandHandler {
  public:
      CommandHandler(vmaas::UartBus& bus, const SlotPin* slots, size_t count);
      void begin();   // configures all slot pins as outputs, low; registers on_frame
      void tick();    // call every loop iteration; ends a RUN when run_time elapses
  };
  ```

**OWNER DECISION 1 (slot_map.h):** the GPIO numbers below are provisional. The project owner will supply the real slot-to-pin wiring. GPIO 18, 19, 21, 22 are chosen because they are free general-purpose pins on esp32dev that are not used by UART1 (16/17), flash (6-11), or strapping (0, 2, 5, 12, 15).

**OWNER DECISION 2 (handle_run when BUSY):** the spec says `NAK BUSY`. The alternative, queueing the request and running it after DONE, gives a smoother vend flow but hides latency from Main-Controller. Implement `NAK BUSY` as written and flag the spot.

- [ ] **Step 1: Write slot_map.h**

`Motorcontrol/src/slot_map.h`:

```cpp
#pragma once
// Slot number (as sent by Main-Controller in RUN) -> GPIO that drives
// that slot's motor. Main-Controller never sees GPIO numbers.
//
// PROVISIONAL WIRING. Replace with the real mapping when the cabinet is wired.
#include <cstddef>
#include <cstdint>
#include "driver/gpio.h"

struct SlotPin
{
    uint8_t slot;
    gpio_num_t pin;
};

namespace SlotMap
{
    constexpr SlotPin pins[] = {
        {1, GPIO_NUM_18},
        {2, GPIO_NUM_19},
        {3, GPIO_NUM_21},
        {4, GPIO_NUM_22},
    };
    constexpr size_t count = sizeof(pins) / sizeof(pins[0]);
}
```

- [ ] **Step 2: Write command_handler.h**

`Motorcontrol/src/command_handler.h`:

```cpp
#pragma once
// Receives protocol requests from Main-Controller, drives the motor pins,
// and sends replies. One motor may run at a time.
#include <cstddef>
#include <cstdint>
#include "freertos/FreeRTOS.h"
#include "protocol.h"
#include "uart_bus.h"
#include "slot_map.h"

class CommandHandler
{
public:
    CommandHandler(vmaas::UartBus& bus, const SlotPin* slots, size_t count);

    // Configures every slot pin as an output driven low and registers the
    // frame handler on the bus. Call once after bus.begin().
    void begin();

    // Call every loop iteration. When a RUN has been active for run_time_ms_,
    // drives the pin low, returns to IDLE and sends DONE.
    void tick();

private:
    void handle(const vmaas::Frame& f);
    void handle_run(const vmaas::Frame& f);
    void handle_stop(const vmaas::Frame& f);
    void handle_status(const vmaas::Frame& f);
    void handle_config(const vmaas::Frame& f);

    // Returns the GPIO for slot, or GPIO_NUM_NC if the slot is unknown.
    gpio_num_t pin_for(uint8_t slot) const;
    void set_motor(gpio_num_t pin, bool on);

    vmaas::UartBus& bus_;
    const SlotPin* slots_;
    size_t slot_count_;

    vmaas::State state_ = vmaas::State::IDLE;
    uint8_t current_slot_ = 0;
    gpio_num_t current_pin_ = GPIO_NUM_NC;
    TickType_t run_started_ = 0;
    uint16_t run_time_ms_ = 500;
};
```

- [ ] **Step 3: Write command_handler.cpp**

`Motorcontrol/src/command_handler.cpp`:

```cpp
#include "command_handler.h"
#include "esp_log.h"
#include "freertos/task.h"

using namespace vmaas;

namespace
{
    constexpr const char* TAG = "CmdHandler";
}

CommandHandler::CommandHandler(UartBus& bus, const SlotPin* slots, size_t count)
    : bus_(bus), slots_(slots), slot_count_(count)
{
}

void CommandHandler::begin()
{
    for (size_t i = 0; i < slot_count_; ++i)
    {
        gpio_reset_pin(slots_[i].pin);
        gpio_set_direction(slots_[i].pin, GPIO_MODE_OUTPUT);
        gpio_set_level(slots_[i].pin, 0);
    }
    bus_.on_frame([this](const Frame& f) { handle(f); });
    ESP_LOGI(TAG, "ready, %u slots, run_time=%u ms", (unsigned)slot_count_, run_time_ms_);
}

void CommandHandler::tick()
{
    if (state_ != State::BUSY)
        return;
    const TickType_t elapsed = xTaskGetTickCount() - run_started_;
    if (elapsed < pdMS_TO_TICKS(run_time_ms_))
        return;

    set_motor(current_pin_, false);
    const uint8_t finished = current_slot_;
    state_ = State::IDLE;
    current_slot_ = 0;
    current_pin_ = GPIO_NUM_NC;
    bus_.send(frames::done(finished));
    ESP_LOGI(TAG, "slot %u done", finished);
}

void CommandHandler::handle(const Frame& f)
{
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
        bus_.send(frames::nak(Cmd::RUN, ErrorCode::BAD_PAYLOAD));
        return;
    }
    // OWNER DECISION 2: policy when a RUN arrives while another is active.
    // Current policy: reject. Alternative: queue it and start after DONE.
    if (state_ == State::BUSY)
    {
        ESP_LOGW(TAG, "RUN %u rejected: busy with slot %u", f.payload[0], current_slot_);
        bus_.send(frames::nak(Cmd::RUN, ErrorCode::BUSY));
        return;
    }
    const uint8_t slot = f.payload[0];
    const gpio_num_t pin = pin_for(slot);
    if (pin == GPIO_NUM_NC)
    {
        ESP_LOGW(TAG, "RUN %u rejected: unknown slot", slot);
        bus_.send(frames::nak(Cmd::RUN, ErrorCode::UNKNOWN_SLOT));
        return;
    }

    bus_.send(frames::ack(Cmd::RUN));
    state_ = State::BUSY;
    current_slot_ = slot;
    current_pin_ = pin;
    run_started_ = xTaskGetTickCount();
    set_motor(pin, true);
    ESP_LOGI(TAG, "slot %u running on GPIO %d for %u ms", slot, (int)pin, run_time_ms_);
}

void CommandHandler::handle_stop(const Frame& f)
{
    if (f.len != 0)
    {
        bus_.send(frames::nak(Cmd::STOP, ErrorCode::BAD_PAYLOAD));
        return;
    }
    if (state_ == State::BUSY)
    {
        set_motor(current_pin_, false);
        ESP_LOGI(TAG, "slot %u stopped by request", current_slot_);
        state_ = State::IDLE;
        current_slot_ = 0;
        current_pin_ = GPIO_NUM_NC;
    }
    bus_.send(frames::ack(Cmd::STOP));
}

void CommandHandler::handle_status(const Frame& f)
{
    if (f.len != 0)
    {
        bus_.send(frames::nak(Cmd::STATUS, ErrorCode::BAD_PAYLOAD));
        return;
    }
    bus_.send(frames::status_reply(state_, current_slot_));
}

void CommandHandler::handle_config(const Frame& f)
{
    if (f.len != 3)
    {
        bus_.send(frames::nak(Cmd::CONFIG, ErrorCode::BAD_PAYLOAD));
        return;
    }
    const uint16_t value = static_cast<uint16_t>(f.payload[1] | (f.payload[2] << 8));
    switch (static_cast<ConfigParam>(f.payload[0]))
    {
    case ConfigParam::RUN_TIME_MS:
        run_time_ms_ = value;
        ESP_LOGI(TAG, "run_time set to %u ms", run_time_ms_);
        bus_.send(frames::ack(Cmd::CONFIG));
        break;
    default:
        bus_.send(frames::nak(Cmd::CONFIG, ErrorCode::BAD_PARAM));
        break;
    }
}

gpio_num_t CommandHandler::pin_for(uint8_t slot) const
{
    for (size_t i = 0; i < slot_count_; ++i)
        if (slots_[i].slot == slot)
            return slots_[i].pin;
    return GPIO_NUM_NC;
}

void CommandHandler::set_motor(gpio_num_t pin, bool on)
{
    if (pin != GPIO_NUM_NC)
        gpio_set_level(pin, on ? 1 : 0);
}
```

- [ ] **Step 4: Write main.cpp**

Replace `Motorcontrol/src/main.cpp` entirely:

```cpp
// Motorcontrol: receives RUN/STOP/STATUS/CONFIG from Main-Controller over
// UART1 and drives the slot motors. See shared/vmaas-protocol/PROTOCOL.md.
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "pins.h"
#include "slot_map.h"
#include "command_handler.h"
#include "uart_bus.h"

namespace
{
    vmaas::UartBus bus(UART_NUM_1, Pins::UART_TX, Pins::UART_RX);
    CommandHandler handler(bus, SlotMap::pins, SlotMap::count);
}

extern "C" void app_main()
{
    bus.begin();
    handler.begin();
    ESP_LOGI("Motorcontrol", "waiting for commands");

    while (true)
    {
        bus.poll(pdMS_TO_TICKS(50));
        handler.tick();
    }
}
```

- [ ] **Step 5: Build**

Run (from `Motorcontrol`): `pio run -e controller-motor`
Expected: build succeeds with no warnings from `command_handler.cpp` or `main.cpp`.

If the linker complains about `app_main` being undefined, the `extern "C"` is missing; ESP-IDF looks for a C symbol.

- [ ] **Step 6: Commit**

```bash
git add Motorcontrol/src
git commit -m "feat(motorcontrol): handle RUN/STOP/STATUS/CONFIG over UART and drive slot pins"
```

---

### Task 7: Main-Controller: MotorClient and smoke-test main loop

**Files:**
- Create: `Main-Controller/src/motor_client.h`
- Create: `Main-Controller/src/motor_client.cpp`
- Modify: `Main-Controller/src/main.cpp` (full rewrite, removes PING/PONG and `IS_BOARD_A`)
- Modify: `Main-Controller/src/config.h` (remove the now-unused `uart_config`; keep `baud_rate`)

**Interfaces:**
- Consumes: `vmaas::UartBus`, `vmaas::Frame`, `vmaas::frames::*`.
- Produces:
  ```cpp
  class MotorClient {
  public:
      using DoneHandler   = std::function<void(uint8_t slot)>;
      using NakHandler    = std::function<void(vmaas::Cmd rejected, vmaas::ErrorCode error)>;
      using AckHandler    = std::function<void(vmaas::Cmd acknowledged)>;
      using StatusHandler = std::function<void(vmaas::State state, uint8_t current_slot)>;
      explicit MotorClient(vmaas::UartBus& bus);
      void begin();                                   // registers on_frame
      bool run(uint8_t slot);
      bool stop();
      bool request_status();
      bool config(vmaas::ConfigParam param, uint16_t value);
      void on_done(DoneHandler); void on_nak(NakHandler); void on_ack(AckHandler); void on_status(StatusHandler);
  };
  ```

- [ ] **Step 1: Write motor_client.h**

`Main-Controller/src/motor_client.h`:

```cpp
#pragma once
// Typed client for talking to Motorcontrol. Wraps frame building and reply
// dispatch so the rest of Main-Controller never touches raw frames.
#include <cstdint>
#include <functional>
#include "protocol.h"
#include "uart_bus.h"

class MotorClient
{
public:
    using DoneHandler = std::function<void(uint8_t slot)>;
    using NakHandler = std::function<void(vmaas::Cmd rejected, vmaas::ErrorCode error)>;
    using AckHandler = std::function<void(vmaas::Cmd acknowledged)>;
    using StatusHandler = std::function<void(vmaas::State state, uint8_t current_slot)>;

    explicit MotorClient(vmaas::UartBus& bus);

    // Registers the reply handler on the bus. Call once after bus.begin().
    void begin();

    // Each returns false if the frame could not be written to the UART.
    // Replies arrive later through the handlers during bus.poll().
    bool run(uint8_t slot);
    bool stop();
    bool request_status();
    bool config(vmaas::ConfigParam param, uint16_t value);

    void on_done(DoneHandler h) { on_done_ = std::move(h); }
    void on_nak(NakHandler h) { on_nak_ = std::move(h); }
    void on_ack(AckHandler h) { on_ack_ = std::move(h); }
    void on_status(StatusHandler h) { on_status_ = std::move(h); }

private:
    void handle(const vmaas::Frame& f);

    vmaas::UartBus& bus_;
    DoneHandler on_done_;
    NakHandler on_nak_;
    AckHandler on_ack_;
    StatusHandler on_status_;
};
```

- [ ] **Step 2: Write motor_client.cpp**

`Main-Controller/src/motor_client.cpp`:

```cpp
#include "motor_client.h"
#include "esp_log.h"

using namespace vmaas;

namespace
{
    constexpr const char* TAG = "MotorClient";
}

MotorClient::MotorClient(UartBus& bus) : bus_(bus) {}

void MotorClient::begin()
{
    bus_.on_frame([this](const Frame& f) { handle(f); });
}

bool MotorClient::run(uint8_t slot)
{
    return bus_.send(frames::run(slot));
}

bool MotorClient::stop()
{
    return bus_.send(frames::stop());
}

bool MotorClient::request_status()
{
    return bus_.send(frames::status());
}

bool MotorClient::config(ConfigParam param, uint16_t value)
{
    return bus_.send(frames::config(param, value));
}

void MotorClient::handle(const Frame& f)
{
    if (!is_reply(f.cmd))
    {
        ESP_LOGW(TAG, "ignoring request-type frame 0x%02X from Motorcontrol", (unsigned)f.cmd);
        return;
    }
    switch (f.cmd)
    {
    case Cmd::ACK:
        if (f.len == 1 && on_ack_)
            on_ack_(static_cast<Cmd>(f.payload[0]));
        break;
    case Cmd::NAK:
        if (f.len == 2 && on_nak_)
            on_nak_(static_cast<Cmd>(f.payload[0]), static_cast<ErrorCode>(f.payload[1]));
        break;
    case Cmd::DONE:
        if (f.len == 1 && on_done_)
            on_done_(f.payload[0]);
        break;
    case Cmd::STATUS_REPLY:
        if (f.len == 2 && on_status_)
            on_status_(static_cast<State>(f.payload[0]), f.payload[1]);
        break;
    default:
        ESP_LOGW(TAG, "unexpected reply 0x%02X len=%u", (unsigned)f.cmd, f.len);
        break;
    }
}
```

- [ ] **Step 3: Rewrite main.cpp**

Replace `Main-Controller/src/main.cpp` entirely:

```cpp
// Main-Controller: smoke test for the UART command protocol.
// Sends RUN 1 every 2 seconds and logs every reply from Motorcontrol.
// See shared/vmaas-protocol/PROTOCOL.md.
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "pins.h"
#include "config.h"
#include "motor_client.h"
#include "uart_bus.h"

namespace
{
    constexpr const char* TAG = "MainController";
    constexpr uint8_t SMOKE_TEST_SLOT = 1;
    constexpr TickType_t SMOKE_TEST_INTERVAL = pdMS_TO_TICKS(2000);

    vmaas::UartBus bus(UART_NUM_1, Pins::UART_TX, Pins::UART_RX, Config::baud_rate);
    MotorClient motor(bus);
}

extern "C" void app_main()
{
    bus.begin();
    motor.begin();

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
    while (true)
    {
        bus.poll(pdMS_TO_TICKS(50));

        const TickType_t now = xTaskGetTickCount();
        if (static_cast<TickType_t>(now - last_send) >= SMOKE_TEST_INTERVAL)
        {
            last_send = now;
            if (motor.run(SMOKE_TEST_SLOT))
                ESP_LOGI(TAG, "sent RUN %u", SMOKE_TEST_SLOT);
        }
    }
}
```

- [ ] **Step 4: Trim config.h**

Replace `Main-Controller/src/config.h` entirely (the `uart_config_t` now lives inside `UartBus::begin`):

```cpp
#pragma once

namespace Config
{
    constexpr int baud_rate = 115200;
}
```

- [ ] **Step 5: Build**

Run (from `Main-Controller`): `pio run -e main-controller`
Expected: build succeeds. Confirm with `grep -n IS_BOARD_A Main-Controller/src/*` that the flag is gone (no output).

- [ ] **Step 6: Commit**

```bash
git add Main-Controller/src
git commit -m "feat(main-controller): add MotorClient and replace PING/PONG with RUN smoke test"
```

---

### Task 8: Hardware smoke test

**Files:** none changed unless a bug is found.

This task needs both ESP32 boards, two USB cables, and three jumper wires.

- [ ] **Step 1: Wire the boards**

```
Main-Controller GPIO17 (TX)  ->  Motorcontrol GPIO16 (RX)
Main-Controller GPIO16 (RX)  <-  Motorcontrol GPIO17 (TX)
Main-Controller GND          --  Motorcontrol GND
```

Optionally put an LED with a 220 ohm resistor from Motorcontrol GPIO18 to GND. It should light for 500 ms on each RUN.

- [ ] **Step 2: Flash and monitor Motorcontrol**

Run (from `Motorcontrol`): `pio run -e controller-motor -t upload -t monitor`
Expected in the monitor, once Main-Controller is also running:

```
I (xxx) UartBus: UART1 ready, TX=17 RX=16, 115200 baud
I (xxx) CmdHandler: ready, 4 slots, run_time=500 ms
I (xxx) Motorcontrol: waiting for commands
I (xxx) CmdHandler: slot 1 running on GPIO 18 for 500 ms
I (xxx) CmdHandler: slot 1 done
```

repeating every 2 seconds.

- [ ] **Step 3: Flash and monitor Main-Controller (second terminal)**

Run (from `Main-Controller`): `pio run -e main-controller -t upload -t monitor`
Expected every 2 seconds:

```
I (xxx) MainController: sent RUN 1
I (xxx) MainController: ACK for cmd 0x10
I (xxx) MainController: slot 1 dispensed
```

- [ ] **Step 4: Negative checks**

Pull the TX->RX jumper for a few seconds. Main-Controller keeps logging `sent RUN 1` with no ACK, and neither board crashes. Reconnect; replies resume within one interval.

Change `SMOKE_TEST_SLOT` to `9` in `Main-Controller/src/main.cpp`, rebuild, upload. Expected on Main-Controller: `NAK for cmd 0x10, error 4` (UNKNOWN_SLOT). Change it back to `1` and rebuild; do not commit the 9.

- [ ] **Step 5: Record the result**

If everything above matches, append to the spec under a new heading `## 10. Verification log`:

```markdown
## 10. Verification log

- 2026-MM-DD: hardware smoke test passed on two esp32dev boards. RUN 1 -> ACK -> DONE every 2 s; unknown slot returns NAK UNKNOWN_SLOT; link recovers after a pulled jumper.
```

(Fill in the actual date.)

```bash
git add docs/superpowers/specs/2026-09-14-uart-command-protocol-design.md
git commit -m "docs: record UART protocol hardware smoke test result"
```

If something fails, stop, and use superpowers:systematic-debugging before changing code.

---

## Self-review notes

Spec coverage: section 3 (wire format) is Tasks 1-4; 3.4 flows are exercised by Task 6 handlers and Task 8; section 4 structure matches the File Structure above; section 5 parser state machine is Task 4; section 6 error table is Task 4 (CRC/LEN) and Task 6 (NAKs) and Task 7 (unexpected reply); section 7 tests are Tasks 1-4 (unit) and Task 8 (smoke); section 8 order is followed, including removing `IS_BOARD_A` in Task 7 and PROTOCOL.md in Task 1. Section 9 limitations need no task.

Deviation from the spec: `UartBus` gains a `begin()` method rather than installing the driver in its constructor, so a driver failure cannot abort during static initialisation. `MotorClient` and `CommandHandler` follow the same pattern. `MotorClient` also gains `on_ack`, which the spec's usage example did not show but which the smoke test needs to observe the ACK step.
