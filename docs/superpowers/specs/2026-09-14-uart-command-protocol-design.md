# UART Command Protocol between Main-Controller and Motorcontrol

**Date:** 2026-09-14
**Status:** Approved design, not yet implemented
**Scope:** Firmware only (`Main-Controller/`, `Motorcontrol/`, new `shared/`)

## 1. Goal

Give Main-Controller a simple, typed way to send commands to Motorcontrol
over the existing UART link, and to learn whether each command was accepted
and completed. Replace the current PING/PONG test loop in
`Main-Controller/src/main.cpp`.

Motorcontrol owns the mapping from slot number to output pin. Main-Controller
only ever refers to slots by number.

## 2. Non-goals (v1)

- Timeouts and retries on the Main-Controller side. If Motorcontrol never
  answers, Main-Controller is not told. This is a known gap; see section 9.
- Sequence numbers. At most one command is expected to be in flight at a time.
- Multi-drop or more than two boards on the link.
- Any change to the backend or MQTT side.

## 3. Wire format

One message equals one frame. Frames are sent over UART at 115200 8N1
(unchanged from the current `Config::uart_config`).

```
[START][LEN][CMD][PAYLOAD ...][CRC]
 0xAA   1B   1B   0-8 bytes    1B
```

| Field   | Size    | Meaning |
|---------|---------|---------|
| START   | 1 byte  | Always `0xAA`. The receiver discards bytes until it sees one. |
| LEN     | 1 byte  | Number of payload bytes. Maximum 8. Larger values invalidate the frame. |
| CMD     | 1 byte  | Command id from the shared enum. Request ids are `< 0x80`, reply ids are `>= 0x80`. |
| PAYLOAD | 0-8 B   | Command-specific bytes. Multi-byte values are little-endian. |
| CRC     | 1 byte  | CRC-8 over LEN, CMD and PAYLOAD (not over START). |

CRC-8 parameters: polynomial `0x07`, init `0x00`, no reflection, no final
XOR (the plain CRC-8 used in many small protocols). The library is the
single source of truth; PROTOCOL.md must state the same parameters.

Example: `RUN slot 3` is five bytes on the wire: `AA 01 10 03 <crc>`.

### 3.1 Requests, Main-Controller to Motorcontrol

| CMD    | Name   | Payload                              |
|--------|--------|--------------------------------------|
| `0x10` | RUN    | `slot` (u8)                          |
| `0x11` | STOP   | none                                 |
| `0x12` | STATUS | none                                 |
| `0x13` | CONFIG | `param` (u8), `value` (u16 LE)       |

### 3.2 Replies, Motorcontrol to Main-Controller

| CMD    | Name         | Payload                                   |
|--------|--------------|-------------------------------------------|
| `0x80` | ACK          | `cmd` (u8) that is being acknowledged     |
| `0x81` | NAK          | `cmd` (u8) that is rejected, `error` (u8) |
| `0x82` | DONE         | `slot` (u8)                               |
| `0x83` | STATUS_REPLY | `state` (u8), `current_slot` (u8)         |

### 3.3 Enumerations

State: `0 = IDLE`, `1 = BUSY`, `2 = ERROR`.

Error codes for NAK:

| Code | Name          | When |
|------|---------------|------|
| 1    | UNKNOWN_CMD   | CMD not in the enum |
| 2    | BAD_PAYLOAD   | LEN does not match what the CMD expects |
| 3    | BUSY          | RUN received while a motor is already running |
| 4    | UNKNOWN_SLOT  | slot has no pin in the slot map |
| 5    | BAD_PARAM     | CONFIG param id not recognised |

CONFIG param ids are defined in the shared enum as they are needed. v1 ships
with `1 = RUN_TIME_MS` (u16, how long the motor runs for a RUN).

### 3.4 Interaction flow

Normal vend:

```
Main  ->  Motor : RUN 3
Motor ->  Main  : ACK RUN
        (motor runs for RUN_TIME_MS)
Motor ->  Main  : DONE 3
```

Rejected vend:

```
Main  ->  Motor : RUN 9
Motor ->  Main  : NAK RUN UNKNOWN_SLOT
```

STOP while running: Motor replies ACK STOP, switches the pin off, and does
**not** send DONE for the interrupted slot.

STATUS: Motor replies STATUS_REPLY immediately. No ACK is sent for STATUS.

## 4. Code structure

```
shared/
  vmaas-protocol/
    PROTOCOL.md               # living documentation of section 3
    library.json              # PlatformIO library metadata
    platformio.ini            # [env:native] for unit tests
    src/
      protocol.h              # Cmd, ErrorCode, State, ConfigParam enums; Frame struct; constants
      crc8.h / crc8.cpp       # crc8(const uint8_t*, size_t)
      frame_codec.h / .cpp    # encode(Frame, out) and FrameParser (byte-at-a-time state machine)
      uart_bus.h / .cpp       # UartBus: binds codec to ESP-IDF UART driver
    test/
      test_crc8/              # PlatformIO native unit tests
      test_frame_codec/
Main-Controller/
  src/motor_client.h / .cpp   # MotorClient: run(), stop(), request_status(), config(); on_done(), on_nak(), on_status()
Motorcontrol/
  src/command_handler.h / .cpp  # receives requests, drives pins, sends replies
  src/slot_map.h                # constexpr table: slot number -> GPIO
```

Both board `platformio.ini` files add:

```ini
lib_extra_dirs = ../shared
```

### 4.1 Layers

1. **crc8** knows only bytes. No ESP-IDF includes.
2. **frame_codec** knows the frame layout. `FrameParser::feed(uint8_t)`
   returns `true` and fills a `Frame` when a valid frame has been assembled.
   No ESP-IDF includes.
3. **uart_bus** knows UART. `UartBus::poll(TickType_t timeout)` reads
   available bytes, feeds the parser and invokes `on_frame`.
   `UartBus::send(const Frame&)` encodes and writes.
4. **motor_client** (Main-Controller) and **command_handler** (Motorcontrol)
   translate between frames and board behaviour.

Layers 1 and 2 are testable on a PC because they have no hardware
dependency. This is a design constraint, not a convenience.

### 4.2 Main-Controller usage

```cpp
UartBus bus(UART_NUM_1, Pins::UART_TX, Pins::UART_RX);
MotorClient motor(bus);

motor.on_done([](uint8_t slot) { ESP_LOGI("VEND", "Slot %d dispensed", slot); });
motor.on_nak([](Cmd cmd, ErrorCode err) { ESP_LOGW("VEND", "Rejected: %d", (int)err); });

motor.run(3);

while (true) bus.poll(pdMS_TO_TICKS(100));
```

### 4.3 Motorcontrol usage

```cpp
UartBus bus(UART_NUM_1, Pins::UART_TX, Pins::UART_RX);
CommandHandler handler(bus, SlotMap::pins);

while (true) {
    bus.poll(pdMS_TO_TICKS(100));
    handler.tick();   // turns the pin off and sends DONE when RUN_TIME_MS has elapsed
}
```

## 5. Parser state machine

```
WAIT_START --0xAA--> READ_LEN --byte<=8--> READ_CMD --byte--> READ_PAYLOAD (LEN bytes) --> READ_CRC
     ^                   |                                                                    |
     |               byte>8: reset                                          crc ok: emit frame, reset
     +-------------------+------------------------------------------------ crc bad: log, reset
```

Any invalid byte returns the parser to WAIT_START. A `0xAA` seen inside a
payload is treated as data, not as a new START; resynchronisation relies on
the CRC rejecting a corrupted frame and the next real START being found.

## 6. Error handling

| Situation | Behaviour |
|-----------|-----------|
| Bad CRC | Frame dropped, `ESP_LOGW`, parser reset. No reply sent. |
| LEN > 8 | Frame dropped, `ESP_LOGW`, parser reset. |
| Unknown CMD (Motorcontrol) | `NAK UNKNOWN_CMD` |
| Payload length wrong for CMD | `NAK BAD_PAYLOAD` |
| RUN while BUSY | `NAK BUSY`; running motor is unaffected |
| Unknown slot | `NAK UNKNOWN_SLOT` |
| Unexpected reply (Main-Controller) | `ESP_LOGW`, ignored |
| UART driver error on send | `ESP_LOGE`; caller is not informed in v1 |

## 7. Testing

**Unit tests, PC (`pio test -e native` in `shared/vmaas-protocol`):**

- crc8 against known vectors (e.g. `"123456789"` -> `0xF4` for poly 0x07).
- encode then parse gives back the same Frame for every CMD.
- Parser discards leading garbage and still finds the frame.
- Parser rejects a frame with a flipped CRC and then accepts the next good one.
- Parser rejects LEN 9 and recovers.
- Two frames delivered in a single byte stream both come out.

**Smoke test, hardware:**

Main-Controller sends `RUN 1` every 2 s. Motorcontrol replies ACK, drives
the slot 1 pin for `RUN_TIME_MS` (default 500 ms), then sends DONE. Both
boards log every frame with `ESP_LOGI`. This replaces PING/PONG.

## 8. Implementation order

1. `shared/vmaas-protocol` with crc8 and frame_codec, plus native tests. Green before touching hardware.
2. `uart_bus` on top.
3. Motorcontrol side: `slot_map`, `command_handler`, new `main.cpp`. Motorcontrol has no existing code to break.
4. Main-Controller side: `motor_client`, replace PING/PONG loop.
5. Remove `IS_BOARD_A`; the role is now fixed by which project is built.
6. Write `PROTOCOL.md` alongside step 1 and keep it in sync with `protocol.h`.

**Prerequisite:** PlatformIO CLI is not installed on the development
machine (observed 2026-09-07). It is required for both native tests and
board builds.

## 9. Known limitations and future work

- **No timeout on replies.** If Motorcontrol resets mid-RUN, Main-Controller
  waits forever for DONE. A future version should add a timer in
  `MotorClient` that fires `on_timeout` after a configurable delay.
- **One command in flight.** Sending a second RUN before DONE returns
  `NAK BUSY`. Sequence numbers can be added later without changing the
  frame layout by using one payload byte.
- **CONFIG is volatile.** Values set via CONFIG live in RAM on Motorcontrol
  and are lost on reset. Persisting them (NVS) is out of scope.
