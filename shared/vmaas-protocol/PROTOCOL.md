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

| CMD    | Name          | Payload                        |
|--------|---------------|--------------------------------|
| `0x10` | RUN           | `slot` u8                      |
| `0x11` | STOP          | none                           |
| `0x12` | STATUS        | none                           |
| `0x13` | CONFIG        | `param` u8, `value` u16 LE. Reserved: no params are defined, always `NAK BAD_PARAM`. |
| `0x14` | WIRING_BEGIN  | none                           |
| `0x15` | WIRING_SLOT   | `slot` u8, `pin_count` u8, `pins` u8[pin_count] (≤6) |
| `0x16` | WIRING_COMMIT | `count` u8, `steps_per_vend` u16 LE |

## Replies (Motorcontrol -> Main-Controller)

ACK (acknowledge) means the request was accepted. NAK (negative
acknowledge) means it was rejected; the first payload byte names the
rejected request and the second gives the reason from the error-code
table below. DONE and STATUS_REPLY are the two replies that carry data.

| CMD    | Name         | Payload                                  |
|--------|--------------|------------------------------------------|
| `0x80` | ACK          | `cmd` u8, the request being acknowledged |
| `0x81` | NAK          | `cmd` u8, `error` u8                     |
| `0x82` | DONE         | `slot` u8. Sent once every STEP pulse of the vend has been emitted. |
| `0x83` | STATUS_REPLY | `state` u8, `current_slot` u8            |

## Enumerations

State: `0` IDLE, `1` BUSY, `2` ERROR.

`current_slot` in STATUS_REPLY is 0 when the state is IDLE or ERROR. ERROR means
Motorcontrol has no valid slot configuration (`/storage/config.json` missing or
invalid, see `shared/vmaas-config/README.md`); it answers STATUS normally but
refuses every RUN, STOP and CONFIG with `NAK CONFIG_ERROR` (WIRING_* is accepted, see Wiring transfer), and restarts every
30 s (at most 100 times per power-on) to pick up a corrected file.

NAK error codes:

| Code | Name         | When |
|------|--------------|------|
| 1    | UNKNOWN_CMD  | CMD is not in the table above |
| 2    | BAD_PAYLOAD  | LEN does not match the CMD |
| 3    | BUSY         | RUN while a vend is in progress, or WIRING_COMMIT during a vend |
| 4    | UNKNOWN_SLOT | slot not present in Motorcontrol's slot map |
| 5    | BAD_PARAM    | CONFIG param id not recognised |
| 6    | CONFIG_ERROR | Motorcontrol has no valid slot configuration; RUN/STOP/CONFIG refused |
| 7    | WIRING_STATE | WIRING_SLOT or WIRING_COMMIT without a preceding WIRING_BEGIN, or after the 10 s staging timeout |
| 8    | WIRING_FULL  | More than 32 slots staged |
| 9    | WRITE_FAILED | The staged table did not validate, uses a reserved pin, or config.json could not be written |

CONFIG params: none. `RUN_TIME_MS` (id 1) was removed when the motors became
steppers; the pulse count per vend is `motor.stepsPerVend` in Motorcontrol's
`config.json` (see `shared/vmaas-config/README.md`) and the pulse interval is
a firmware constant on Motorcontrol.

## Flows

Normal vend:

```
Main  -> Motor : RUN 3
Motor -> Main  : ACK RUN
                 (slot 3's drivers are enabled, one tick later stepsPerVend
                  STEP pulses are emitted on the shared line, then the
                  drivers are disabled - about 2 s at the defaults)
Motor -> Main  : DONE 3
```

Rejected vend:

```
Main  -> Motor : RUN 9
Motor -> Main  : NAK RUN UNKNOWN_SLOT
```

STOP while a vend is in progress: `ACK STOP`, the step generator stops, the slot's drivers are disabled, no DONE for the interrupted slot. STOP is also ACKed when nothing is running, so Main-Controller can send it blindly on its dispense timeout.

Motorcontrol without a valid slot configuration:

```
Main  -> Motor : RUN 3
Motor -> Main  : NAK RUN CONFIG_ERROR
Main  -> Motor : STATUS
Motor -> Main  : STATUS_REPLY ERROR 0
```

Main-Controller shows `MOTOR CONFIG ERR` on its display while it sees either reply.

STATUS: `STATUS_REPLY` is sent immediately. No ACK.

CONFIG:

```
Main  -> Motor : CONFIG 1 200
Motor -> Main  : NAK CONFIG BAD_PARAM     (no params are defined)
```

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
the previous wiring frame, is `NAK WIRING_STATE`. More than 32 slots is
`NAK WIRING_FULL`. A `WIRING_SLOT` whose LEN is not `2 + pin_count` (which
includes any pin_count above 6, since 7 pins cannot fit a frame) is
`NAK BAD_PAYLOAD`, and so is a `COMMIT` with `steps_per_vend == 0`.

**Retry rule for the sender:** after any NAK other than `BUSY`, abort and
start again from `WIRING_BEGIN` (the staging may or may not have been kept;
do not rely on it). After `NAK BUSY` on `COMMIT` the staging is kept and
`COMMIT` may be retried, as long as it is within 10 s of the last wiring
frame. Send one frame at a time and wait for its reply; ACKs do not echo the
slot number. `count` is the number of slots in the table, each sent once.

After `ACK WIRING_COMMIT` from a board that reported `State::ERROR`, the
board restarts about 50 ms later and is unreachable for roughly a second;
poll `STATUS` until it answers `IDLE`. It does not restart for the 30 s
config-error retry while a transfer is in progress.

A board in the config-error state accepts the transfer too; after a
successful `COMMIT` it restarts into the new table instead of applying it
live.

## Receiver behaviour

- Bad CRC or LEN > 8: frame dropped, logged, parser returns to waiting for START. No reply.
- Unknown CMD: `NAK UNKNOWN_CMD`.
- Reply-type CMD (>= 0x80) received by Motorcontrol: ESP_LOGW, ignored. No NAK, so a mis-wired loopback cannot create a NAK storm.
- A `0xAA` inside a payload is data, not a new START. Resync relies on the CRC.
- RUN is checked in this order: payload length, then BUSY, then slot validity. A RUN for an unknown slot while busy therefore answers NAK BUSY.

## Wiring

Motorcontrol uses TX = GPIO17 and RX = GPIO16; Main-Controller uses TX = GPIO33 and RX = GPIO32 (see each project's `pins.h`), so the link is crossed:

    Main-Controller GPIO33 (TX)  ->  Motorcontrol GPIO16 (RX)
    Main-Controller GPIO32 (RX)  <-  Motorcontrol GPIO17 (TX)
    Main-Controller GND          --  Motorcontrol GND

## Timeouts

Motorcontrol has none. Main-Controller fails a paid sale and sends STOP when
no DONE or NAK has arrived `timings.dispense_timeout_ms` (default 30 s,
Main-Controller `config.json`) after RUN. No retries or sequence numbers; at
most one request is in flight.
