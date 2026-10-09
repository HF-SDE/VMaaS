# Slot Pin Wiring: Design

Date: 2026-09-22
Status: Approved for planning

## Summary

Superadmins can assign motor GPIOs ("pins") to slots in the admin UI, and that
wiring reaches the motor. Today the slot-to-GPIO map exists only in
Motorcontrol's `/storage/config.json`, flashed by hand; the backend has no idea
which pin drives which slot.

This design carries the wiring the whole way: a `Pin` row under each `Slot`, an
explicit publish step that writes a versioned `MachineConfiguration`, an MQTT
command that tells the machine to fetch it, an HTTPS fetch over mTLS, and a
three-command UART transfer that lands the table in Motorcontrol's filesystem.

A slot may have several pins, because two spirals are sometimes merged into one
wide slot. All of a slot's motors run simultaneously on `RUN`.

## Goals

- Superadmin sets and changes a slot's pins in the slot layout editor.
- The wiring reaches Motorcontrol without a reflash.
- A published wiring is versioned, attributable and reversible.
- A machine cannot sell while its wiring is being replaced.

## Non-goals

- Backwards compatibility with the v1 `config.json` schema. There are no
  machines in production; the two bench boards get a new file anyway.
- Tenant-facing pin editing. Wiring is superadmin-only.
- Changing how prices or cash calibration are authored. They ride along in the
  same payload because they already share `MachineConfiguration`, but their
  content is out of scope.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Pin storage | `Pin` rows owned by one `Slot`, with a denormalised `machineId` | A pin physically drives one motor, so it belongs to one slot. `machineId` is what makes `@@unique([machineId, number])` possible; Postgres cannot enforce uniqueness across a join. |
| Pins per slot | Many | Merged slots have one motor per spiral. |
| RUN semantics | All of a slot's pins driven high simultaneously | Keeps a vend at `RUN_TIME_MS`. **Assumes the supply tolerates n x motor current** - see Risks. |
| Publish trigger | Explicit "Publish to machine" action, separate from "Save layout" | Wrong wiring dispenses the wrong product to someone who already paid. A review step is worth one click, and the version history stays meaningful. |
| Delivery | MQTT command carries `{version}`; payload fetched over HTTPS | Already the established split in `backend/src/mqtt/topics.ts`. |
| Slot numbering | 1-based in backend, frontend, device | Removes an existing off-by-one (see below) rather than papering over it. |
| Schema version | `config.json` v2 only, no v1 fallback | A never-exercised parser branch is where bugs hide. |
| During update | Full service hold: keypad ignored, INHIBIT asserted, LCD notice | A screen message is a request; the INHIBIT pin is a barrier. |

## The slot numbering bug this fixes

`shared/schemas/machines.ts` accepts `slotNumber` from 0, while the device is
1-based: `Main-Controller/src/prices.h` states "Slots are 1-based", and
`prices.cpp` discards `slot == 0`.

`backend/src/api/services/device.service.ts` looks a cash sale up with
`slotNumber: cash.slot`, comparing the device's 1-based number against the
0-based column. A sale from physical slot 1 is therefore recorded against the
layout's *second* slot today.

The consequence is currently a misattributed sale. Once wiring travels the same
path the consequence becomes the wrong motor running. Both are fixed by making
slots 1-based everywhere.

## Data model

```prisma
model Pin {
  id          String  @id @default(uuid()) @db.Uuid
  machineId   String  @db.Uuid
  slotId      String  @db.Uuid
  slot        Slot    @relation(fields: [slotId], references: [id], onDelete: Cascade)
  number      Int     // GPIO 0-33, output-capable
  description String?

  @@unique([machineId, number])
  @@index([slotId])
  @@map("pin")
  @@schema("public")
}

model Slot {
  // ...
  pins Pin[]
}
```

`machineId` is set by the service from the slot's own machine, never from the
request body.

### Migration

Two migrations, in order:

1. **Slots to 1-based.** A single `UPDATE slots SET slot_number = slot_number + 1`
   collides with `@@unique([machineId, slotNumber])`, which Postgres checks per
   row. Go via negatives, the same dance `saveSlotLayoutService` already performs:
   `SET slot_number = -(slot_number + 1)`, then `SET slot_number = -slot_number`.
2. **`Pin` gains `machineId`, `slotId`, the relation and the constraints.** The
   table is empty in every environment, so no data step is needed.

## Shared schema

`slotLayoutSlotSchema` gains:

```ts
pins: z.array(
  z.object({
    number: z.number().int().min(0).max(33),
    description: z.string().trim().max(60).optional(),
  })
).max(6),
```

- Upper bound 33: GPIO 34-39 are input-only and cannot drive a motor
  (`shared/vmaas-config/src/slot_config.h`).
- `.max(6)`: one `WIRING_SLOT` frame holds at most six pins. The wire format is
  the real constraint, so it is stated where the rest of the rules are.

`slotNumber` becomes `.min(1)`.

`saveSlotLayoutSchema.superRefine` gains a fourth rule beside the three it has:
pin numbers must be unique across the whole layout, not merely within one slot.

## Backend

### Saving the layout

`saveSlotLayoutService` already runs one transaction. Pins are replaced wholesale
inside it: `deleteMany({ where: { machineId } })` then `createMany`. The wiring is
at most 32 rows and carries no identity worth preserving across a save, and
delete-then-create sidesteps the same mid-sweep constraint collision the negative
`slotNumber` dance exists for.

### Publishing

`POST /api/machines/:id/publish-configuration`, guarded by a new
`CONFIGURATION_PUBLISH` permission (superadmin). In one transaction:

1. Build the payload from `Slot`, `Pin` and product prices.
2. Reject when any slot has no pins. This is the one rule Zod cannot hold,
   because it is about rows in the database rather than the shape of a body. A
   half-finished wiring must not reach hardware.
3. Insert `MachineConfiguration` with `version = max + 1` and `createdById`.
4. Insert `MachineCommand { type: "apply_configuration", payload: { version },
   expiresAt: now + 24h }`.
5. Publish on `v1/{tenantId}/{siteId}/{machineId}/commands/{commandId}` through
   `createPublish` in `backend/src/mqtt/client.ts` - exported today with no
   caller.

Rollback is republishing an earlier version's payload as a new version. The
`@@unique([machineId, version])` history makes that safe and auditable.

### Re-delivery after downtime

The publish is QoS 1, `retain: false`. A machine that was offline never sees it.
The command row stays open, and `/api/internal/mqtt/connection` already fires
when the broker sees a machine connect. That hook republishes the machine's open,
unexpired commands. No timer in firmware, no polling.

### Payload

The shape is fixed by `Main-Controller/src/prices.cpp`, which already parses
`/storage/prices.json` and is documented as "a cache of
MachineConfiguration.payload". `wiring` is a new sibling block:

```jsonc
{
  "cash":   { "activeLow": true, "minPulseMs": 20,
              "valueByPulses": { "1": 500, "2": 1000, "3": 2000 },
              "currency": "DKK" },
  "prices": [ { "slot": 1, "priceMinor": 1500 } ],
  "wiring": {
    "version": 2,
    "slots": [ { "slot": 1, "pins": [18] },
               { "slot": 3, "pins": [21, 22] } ]
  }
}
```

`wiring` is shaped as Motorcontrol's own `config.json`, not as a backend
structure, so Main-Controller forwards it without translating between two
schemas and `slot_config_parser` knows one format regardless of origin.

`slot` in both `prices` and `wiring` is `Slot.slotNumber` verbatim. There is no
conversion anywhere in the chain - that is the whole point of making the column
1-based, and any `+ 1` appearing in the payload builder is a bug.

Size: Main-Controller's `MAX_FILE` is 4096 bytes and Motorcontrol's
`MAX_CONFIG_BYTES` is 2048. Thirty-two slots with two pins each is roughly 1.2 KB
of `wiring`. It fits, with no room to be wasteful with field names.

## Delivery to the device

```
backend                          Main-Controller              Motorcontrol
   |  MQTT commands/{cmdId}           |                            |
   |  {"type":"apply_configuration",  |                            |
   |   "version":4}                   |                            |
   |--------------------------------->|                            |
   |                                  | queued, not handled in the |
   |                                  | MQTT event callback        |
   |                                  |                            |
   |  GET /device/configuration (mTLS)|                            |
   |<---------------------------------|                            |
   |  200 {"version":4,"payload":{}}  |                            |
   |--------------------------------->|                            |
   |                                  |  begin_service_hold()      |
   |                                  |  WIRING_BEGIN              |
   |                                  |--------------------------->|
   |                                  |  WIRING_SLOT x n           |
   |                                  |--------------------------->|
   |                                  |  WIRING_COMMIT count=n     |
   |                                  |--------------------------->|
   |                                  |<---- ACK ------------------| config.json
   |                                  |                            | .tmp -> rename
   |                                  |  write prices.json         |
   |                                  |  end_service_hold()        |
   |  MQTT command-results/{cmdId}    |                            |
   |  {"status":"completed"}          |                            |
   |<---------------------------------|                            |
```

The command carries only `{version}`, never the payload. The device always
fetches the *latest* configuration, so a repeated or delayed QoS-1 delivery can
never write an older wiring over a newer one. The whole apply is idempotent.

Ordering is deliberate: the wiring is committed on Motorcontrol *before*
`prices.json` is written. `WIRING_COMMIT` is the only thing that touches
Motorcontrol's filesystem, so a failure anywhere earlier leaves the machine
wholly on its old wiring and old prices, which is consistent. The command is then
reported `failed` and redelivered on the next connect.

## Main-Controller

### `device_api` gains a GET

`device_api.cpp` hardcodes `cfg.method = HTTP_METHOD_POST`. There is no GET,
although `device_api.h` describes "configuration fetch" as going through this
client. `post_impl` is parameterised into `request_impl(method, ...)` so
`get_mtls()` reuses the TLS setup, the mutex and the certificate loading rather
than becoming a fourth copy.

Truncation must become explicit. `esp_http_client_read_response(client, resp,
resp_len - 1)` fills the buffer and NUL-terminates; an oversized payload would
present as invalid JSON rather than as too large. The GET path compares
`esp_http_client_get_content_length()` against the buffer and fails with a
distinct error.

The ~4 KB response buffer is `static`, not on the stack - it sits beside the
8 KB the TLS handshake already wants on the same task.

### Command handling

`broker_client` subscribes to nothing today. It subscribes to
`v1/{t}/{s}/{m}/commands/#` and hands messages to a queue.

Work must not happen in the esp-mqtt event callback: it runs on the MQTT task
with a limited stack, and `device_api` holds its lock across the whole TLS
handshake, which takes seconds. Blocking there stalls keepalive and the broker
drops the connection mid-fetch. A dedicated task consumes the queue, exactly as
Task 10 gave outbox draining its own task for the same reason.

### Service hold

```c
/// @return false if a sale is in progress; the caller must retry rather than
///         interrupt it - a coin cannot be rolled back.
bool begin_service_hold();
void end_service_hold();
```

This is distinct from `set_motor_fault`, whose contract explicitly keeps state
changes and settlement running and only defers the display write. Motor faults
stop sales because Motorcontrol NAKs every `RUN` with `CONFIG_ERROR`; during an
update Motorcontrol answers normally right up to `WIRING_COMMIT`, so the hold has
to be real.

They also have different lifecycles and must not share a flag: a motor fault is
operator-facing and persists until someone fixes something; an update hold is
customer-facing, brief, and guaranteed to end.

While held:

- Slot entry is refused.
- The INHIBIT pin is asserted so the coin acceptor physically refuses coins
  (`purchase.has_inhibit`; the pin is bench-tested).
- The LCD shows, at 16 columns:

  ```
  UPDATING...
  please wait
  ```

`begin_service_hold()` fails while a sale is in progress. The updater waits for
idle, bounded by `paymentTimeoutMs` plus a margin; if the machine is still busy
the command is reported `failed` and redelivered later.

The hold is released on every path, including failure. A machine stuck showing
UPDATING because a fetch timed out is worse than one running on old wiring.

## UART protocol

`PROTOCOL.md` allows a 0-8 byte payload, so the table is sent row by row inside a
frame that makes it all-or-nothing.

| CMD | Name | Payload |
|---|---|---|
| `0x14` | `WIRING_BEGIN` | none - clears the staging buffer |
| `0x15` | `WIRING_SLOT` | `slot` u8, `pin_count` u8, `pins` u8[0..6] |
| `0x16` | `WIRING_COMMIT` | `count` u8 - expected number of slots |

Six pins is what fits once `slot` and `pin_count` have taken two of the eight
bytes.

`COMMIT` carries the expected count because that is the one failure each frame's
CRC-8 cannot catch: a *dropped* frame. A mismatch rejects the whole transfer
rather than writing a wiring with a hole in it.

New NAK codes beside the existing six:

| Code | Name | When |
|---|---|---|
| 7 | `WIRING_STATE` | `WIRING_SLOT` or `WIRING_COMMIT` without a preceding `WIRING_BEGIN` |
| 8 | `WIRING_FULL` | more than `MAX_SLOTS` entries, or `pin_count > 6` |
| 9 | `WRITE_FAILED` | `config.json` could not be written |

`COMMIT` is refused with `NAK BUSY` while a motor is running: wiring must not
change under a paid vend.

The staging buffer is discarded after 10 s without a frame, so a Main-Controller
that dies mid-transfer leaves no partial state.

`PROTOCOL.md` is updated in the same commit as `protocol.h`, as that file
requires.

## Motorcontrol

### Writing the config

`config_store.h` has only `load_config()`. It gains `save_config()`: write
`/storage/config.json.tmp`, fsync, rename - the atomic pattern Main-Controller
already uses. After a successful `COMMIT` the table is reloaded into RAM so the
change takes effect without a reboot.

### Schema v2

```c
constexpr size_t MAX_PINS_PER_SLOT = 6;

struct SlotEntry {
    uint8_t slot;       // 1-255, as sent by Main-Controller in RUN
    uint8_t pin_count;
    uint8_t pins[MAX_PINS_PER_SLOT];  // GPIO 0-33; u8, not int
};
```

`uint8_t pins[6]` rather than `int pins[6]` saves 576 bytes of RAM across 32
slots, which is not free space on a board at 67.8% flash.

`parse_slot_config` reads v2 only. The v1 `"pin"` scalar is removed outright.

### Multi-pin RUN

`command_handler` goes from one `current_pin_` to a small array. `RUN` drives all
of the slot's pins high at once; `tick()` drives them all low after
`RUN_TIME_MS`; exactly one `DONE` is still sent. `STOP` drives them all low.

## Admin UI

The slot layout editor (`create-machine/[id]`) has no properties panel at all
today - `slotNumber` and `capacity` are assigned automatically. A panel appears
beside the grid when a slot is selected:

```
create-machine/[id]
+- grid -----------+  +- Slot #3 ------+
| [1][2][   #3   ] |  | Capacity   12  |
| [4][5][6][7]     |  | Pins           |
+------------------+  |  GPIO 18   [x] |
                      |  GPIO 19   [x] |
                      |  + Add pin     |
                      +----------------+
```

Adding a pin takes a GPIO number and an optional description; the description is
a label for whoever traces the cabinet later ("row 2, left bank") and is stored
but never sent to the device - it is absent from the `wiring` payload, where
every byte counts against `MAX_CONFIG_BYTES`.

Pins are saved with the layout in the same `saveSlotLayout` call. The publish
action is separate, and shows the version history with the publisher and time,
and a rollback control.

`nextSlotNumber` in `layout-math.ts` returns `1` for an empty layout instead of
`0`.

Validation surfaced in the editor, from the same shared schema the endpoint uses:
a GPIO outside 0-33, a GPIO used twice in the machine, and a slot with no pins
(blocking publish, not saving).

## Error handling

| Failure | Behaviour |
|---|---|
| Publish with a slot that has no pins | 422, named slots in the message. Nothing written. |
| MQTT broker down at publish | Configuration and command rows are still written; delivery happens on the machine's next connect. |
| Machine offline at publish | Same. |
| `GET /device/configuration` returns 404 | Command reported `failed`. Machine keeps running on its cached configuration. |
| Response larger than the buffer | Distinct error, reported `failed`. Not presented as invalid JSON. |
| Sale in progress when the command arrives | Wait for idle up to `paymentTimeoutMs` + margin, then report `failed`. Never interrupt. |
| Any `WIRING_*` NAK | Abort. Motorcontrol keeps its old file, `prices.json` is not written, command reported `failed`. |
| `WIRING_COMMIT` write fails | `NAK WRITE_FAILED`. Old wiring intact. |
| Main-Controller dies mid-transfer | Staging buffer expires after 10 s. Old wiring intact. |
| Anything at all | `end_service_hold()` runs. |

## Testing

- **Shared schema**: pin range, per-layout uniqueness, max 6 per slot,
  `slotNumber` >= 1. Extends `backend/src/api/__tests__/slots-schemas.test.ts`.
- **Service**: publish refuses a slot without pins; version increments; pin
  replacement inside the layout transaction; `machineId` is taken from the slot
  and not from the body.
- **Migration**: a machine whose slots are 0..n comes out 1..n+1 with the unique
  constraint intact throughout.
- **`slot_config_parser`** (native, as today): v2 parsing, `pin_count` bounds,
  GPIO range, duplicate pins, oversized file.
- **Protocol** (native): `WIRING_*` framing, CRC, `count` mismatch rejected,
  `WIRING_SLOT` without `BEGIN` rejected, staging timeout.
- **`command_handler`**: multi-pin RUN drives every pin, one DONE, STOP clears
  all, COMMIT refused while busy.
- **Hardware**: a merged two-motor slot vends; a published wiring change takes
  effect without a reflash; the LCD shows the hold and coins are refused during
  it.

## Risks and assumptions

- **Simultaneous motors draw n x current.** This design assumes the supply
  tolerates it. If a two-motor slot browns the board out mid-vend, the fallback
  is sequential firing, which changes `RUN` duration and therefore
  Main-Controller's `DONE` timeout. Worth measuring on the bench before the
  multi-pin RUN task is called done.
- **The whole chain is built at once**, against the recommendation to ship the
  database and UI first. The risk is that assumptions made here about the UART
  layer are found wrong only at the end. Mitigated by building bottom-up per the
  order below, so the protocol is exercised on hardware early.
- **`prices.json` and `config.json` are two storage domains** and cannot be
  committed atomically together. Convergence relies on the apply being
  idempotent and the command being redelivered until it succeeds.

## Build order

1. Slot numbering migration to 1-based, backend and frontend, with the cash-sale
   lookup fixed.
2. `Pin` model, migration, shared schema, `saveSlotLayout` persistence.
3. Editor properties panel.
4. Payload builder and `POST /publish-configuration`, with the MQTT publish and
   the reconnect redelivery hook.
5. UART `WIRING_*` in `shared/vmaas-protocol` plus native tests.
6. Motorcontrol: schema v2, `save_config()`, multi-pin `RUN`.
7. Main-Controller: `device_api::get_mtls`, command subscription and queue,
   service hold, the forwarding to Motorcontrol.
8. Hardware verification on the bench boards.
