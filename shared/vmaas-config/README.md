# vmaas-config

Device configuration schema and JSON parser for VMaaS controllers. host tests on
PlatformIO `native`.
Used by Main-Controller to read `/storage/config.json` from its LittleFS partition at boot.

## Rules

- Every field is optional. What the file does not set keeps the firmware
  default (`Main-Controller/src/pins.h`, `settings.h`).
- Unknown keys are ignored, so the file can grow before the firmware does.
- Invalid JSON, a non-object root or a missing file give the defaults.
- Nesting deeper than 8 levels counts as invalid JSON: a pre-scan rejects such
  a file before the parser recurses, so it cannot exhaust the caller's stack.
  Schema v1 nests two levels.
- Secrets (WiFi, MQTT, tokens) do **not** belong here. They go to NVS later.

## Schema, version 1

```json
{
  "version": 1,
  "pins": {
    "uart_rx": 32,
    "uart_tx": 33,
    "i2c_sda": 21,
    "i2c_scl": 22
  },
  "uart": { "baud_rate": 115200 },
  "i2c":  { "clock_hz": 100000 }
}
```

| Field            | Type    | Rule                                                  |
|------------------|---------|-------------------------------------------------------|
| `version`        | integer |                                                       |
| `pins.uart_rx`   | integer | GPIO 0–39                                             |
| `pins.uart_tx`   | integer | GPIO 0–33 (34–39 are input-only)                      |
| `pins.i2c_sda`   | integer | GPIO 0–33                                             |
| `pins.i2c_scl`   | integer | GPIO 0–33                                             |
| `uart.baud_rate` | integer | > 0, fits in int                                      |
| `i2c.clock_hz`   | integer | > 0, fits in 32 bits                                  |

No two pins may share a GPIO on the merged result. On a collision the later
field in the order `uart_rx, uart_tx, i2c_sda, i2c_scl` that came from the
file is rejected; a firmware default never loses to a file value.

## API

```cpp
#include "config.h"
#include "config_parser.h"

constexpr vmaas::Config DEFAULTS = {{32, 33, 21, 22}, {115200}, {100000}};
vmaas::ParseResult r = vmaas::parse_config(json_text, DEFAULTS);
if (!r.json_valid) /* r.config == DEFAULTS, r.json_error_offset set */;
for (size_t i = 0; i < r.issue_count; ++i)
    log("%s: %s", r.issues[i].field, vmaas::to_string(r.issues[i].kind));
use(r.config);
```

The library never logs and never allocates in its result. cJSON allocates
while parsing and frees before `parse_config` returns.

## On the device (Main-Controller)

- Partition `storage` (LittleFS, ~1.9 MB) mounted at `/storage`, see
  `Main-Controller/partitions.csv`.
- Edit `Main-Controller/data/config.json`, then `pio run -t uploadfs`.
  Firmware upload is separate (`-t upload`).
- Boot log (`ConfigStore` tag) prints one warning per rejected field and the
  effective configuration.

## Tests

Run from this directory: `pio test -e native`

| Folder              | Covers                                                        |
|---------------------|---------------------------------------------------------------|
| `test_config_issue` | `to_string`, `None == 0`, `ParseResult` zero-init             |
| `test_parse`        | defaults, partial/full merge, invalid JSON + offset, wrong type, nesting depth limit |
| `test_validate`     | GPIO range, input-only, duplicates, positive speeds, version, unknown keys, issue count stays below MAX_ISSUES |
