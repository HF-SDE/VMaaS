# vmaas-config

Slot configuration schema and JSON parser for the VMaaS Motorcontrol. Pure
C/C++ core (vendored cJSON 1.7.18, MIT), no ESP-IDF dependency, host tests on
PlatformIO `native`. Motorcontrol reads `/storage/config.json` from its
LittleFS partition at boot and drives motors only if this library says the
file is valid.

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

## API

```cpp
#include "slot_config.h"
#include "slot_config_parser.h"

vmaas::SlotParseResult r = vmaas::parse_slot_config(json_text);
for (size_t i = 0; i < r.issue_count; ++i)
    log("%s %s", r.issues[i].field, vmaas::to_string(r.issues[i].kind));
if (r.ok)
    use(r.config.steps_per_vend, r.config.slots, r.config.slot_count);   // else: no wiring, do not drive motors
```

`ok` is true only when the text is a JSON object and no issue other than
`NewerVersion` was found; otherwise `slot_count` is 0. `json_valid` is false
for invalid JSON, a non-object root or too deep nesting, with
`json_error_offset` pointing into the text. The library never logs and never
allocates in its result; cJSON allocates while parsing and frees before
`parse_slot_config` returns. The issue list holds at most `MAX_ISSUES` (8) entries.

## On the device (Motorcontrol)

- Partition `storage` (LittleFS, ~1.9 MB) mounted at `/storage`, see
  `Motorcontrol/partitions.csv`.
- Edit `Motorcontrol/data/config.json`, then from `Motorcontrol/`:
  `pio run -t uploadfs`. Firmware upload is separate (`-t upload`).
- Boot log (`ConfigStore` tag) prints one warning per issue, or the slot table
  on success. `Motorcontrol` tag prints the restart budget in the error state.

## Tests

Run from this directory: `pio test -e native`

| Folder              | Covers                                                                  |
|---------------------|-------------------------------------------------------------------------|
| `test_config_issue` | `to_string`, `None == 0`, `ParseResult` zero-init, field buffer size    |
| `test_parse`        | valid files, missing `slots`, invalid JSON + offset, nesting limit, unknown keys, version |
| `test_validate`     | ranges, input-only pins, duplicates, `MAX_SLOTS`, issue saturation, whole-file rejection |
