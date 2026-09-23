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
| `0x13` | CONFIG | `param` u8, `value` u16 LE. Reserved: no params are defined, always `NAK BAD_PARAM`. |

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
refuses every RUN, STOP and CONFIG with `NAK CONFIG_ERROR`, and restarts every
30 s (at most 100 times per power-on) to pick up a corrected file.

NAK error codes:

| Code | Name         | When |
|------|--------------|------|
| 1    | UNKNOWN_CMD  | CMD is not in the table above |
| 2    | BAD_PAYLOAD  | LEN does not match the CMD |
| 3    | BUSY         | RUN while a motor is already running |
| 4    | UNKNOWN_SLOT | slot not present in Motorcontrol's slot map |
| 5    | BAD_PARAM    | CONFIG param id not recognised |
| 6    | CONFIG_ERROR | Motorcontrol has no valid slot configuration; RUN/STOP/CONFIG refused |

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
