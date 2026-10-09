# Main-Controller Config Filesystem — Design

**Date:** 2026-09-16
**Status:** SUPERSEDED 2026-09-16 by `2026-09-16-motorcontrol-slot-config-filesystem-design.md`. Implemented, then withdrawn: configurable wiring belongs on Motorcontrol; Main-Controller pins stay in firmware.
**Scope:** Main-Controller firmware (ESP-IDF, ESP32-WROVER), new shared library `vmaas-config`

## 1. Goal

Give the Main-Controller a filesystem with a human-readable configuration file. The first
content is the GPIO pin assignment; the file is the single place for non-secret runtime
configuration going forward and must be updatable from the backend in a later iteration.

Motivations, in priority order:

1. One readable, versioned place for device configuration (pins first, more later).
2. Developer convenience during hardware testing: change pins without rebuilding firmware.
3. Future remote provisioning from the backend (out of scope here, but must not be blocked).

## 2. Non-goals (v1)

- Secrets (WiFi credentials, MQTT credentials, device tokens). These will live in NVS in a
  later iteration. The design reserves an NVS partition but implements nothing for it.
- Writing the config from firmware (serial console commands, MQTT push, self-repair of a
  missing file). v1 is read-only at runtime; the file is flashed by the developer.
- Auto-formatting a corrupt filesystem partition.
- Config for Motorcontrol. The parsing library is shared so it can be reused later, but only
  Main-Controller integrates it now.

## 3. Partition table and filesystem

### 3.1 Partitions

New file `Main-Controller/partitions.csv` for the 4 MB flash:

| Name     | Type | Subtype  | Size     | Purpose                                         |
|----------|------|----------|----------|-------------------------------------------------|
| nvs      | data | nvs      | 24 KB    | Reserved for secrets (later); required by ESP-IDF |
| phy_init | data | phy      | 4 KB     | ESP-IDF standard                                |
| factory  | app  | factory  | 2 MB     | Firmware                                        |
| storage  | data | littlefs | remainder (~1.9 MB) | Config filesystem, mounted at `/storage` |

Exact offsets follow ESP-IDF conventions (table at 0x8000, first partition at 0x9000, app
aligned to 0x10000).

### 3.2 Filesystem

LittleFS, via the `joltwallet/littlefs` ESP-IDF managed component declared in
`Main-Controller/src/idf_component.yml`. Chosen over SPIFFS because SPIFFS is deprecated by
Espressif, has no directories, and mounts slowly when damaged. LittleFS has wear-leveling
and is power-loss safe.

### 3.3 PlatformIO configuration

`Main-Controller/platformio.ini` gains:

```ini
board_build.partitions = partitions.csv
board_build.filesystem = littlefs
```

`sdkconfig` must select the custom partition table (`CONFIG_PARTITION_TABLE_CUSTOM=y`,
`CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="partitions.csv"`). This is recorded in
`sdkconfig.defaults` so it survives regeneration of `sdkconfig.main-controller`.

### 3.4 Developer workflow

1. Edit `Main-Controller/data/config.json` (version-controlled).
2. `pio run -t uploadfs` builds a LittleFS image from `data/` and flashes it to `storage`.
3. `pio run -t upload` flashes firmware as usual. The two are independent.

Verifying that `uploadfs` with LittleFS works under the ESP-IDF framework in PlatformIO is
the first task of the implementation plan (a spike), before any other work depends on it.

## 4. Config file format

Path on device: `/storage/config.json`. Contains only non-secret values.

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

Rules:

- Every field is optional. A field that is absent takes its default from the firmware
  (`pins.h` / `config.h`). The file therefore only needs to contain what differs.
- `version` is the schema version, currently 1. A file with a higher version than the
  firmware knows is parsed anyway with a warning; this leaves room for migrations when
  backend provisioning arrives.
- Unknown keys at any level are ignored, so the file can grow without a firmware update.
- Validation, per field:
  - Pin numbers must be integers in 0–39.
  - Pins used as outputs (`uart_tx`, `i2c_sda`, `i2c_scl`) must not be input-only GPIOs
    (34–39). `uart_rx` may be any valid GPIO.
  - No two pins may have the same number (checked on the merged result, so a file that sets
    only `uart_rx` to a value that collides with the default `i2c_sda` is rejected for that
    field).
  - `baud_rate` and `clock_hz` must be positive integers.
- An invalid field is rejected individually: the default is used for that field and one
  issue is reported. The rest of the file is still applied.

## 5. Code structure

### 5.1 Shared library `shared/vmaas-config/`

Platform-independent, follows the `vmaas-display` layout (`library.json`, `platformio.ini`
with a `native` env, `src/`, `test/`). No filesystem or ESP-IDF code.

Public API (namespace `vmaas`):

```cpp
struct Config {
    struct { int uart_rx; int uart_tx; int i2c_sda; int i2c_scl; } pins;
    struct { int baud_rate; } uart;
    struct { uint32_t clock_hz; } i2c;
};

enum class ConfigIssueKind { InvalidJson, WrongType, OutOfRange, InputOnlyPin,
                             DuplicatePin, NewerVersion };

struct ConfigIssue {
    ConfigIssueKind kind;
    const char* field;   // e.g. "pins.uart_tx", or "" for file-level issues
};

struct ParseResult {
    Config config;                 // defaults merged with accepted fields
    static constexpr size_t MAX_ISSUES = 8;   // one per field plus file-level issues
    ConfigIssue issues[MAX_ISSUES]; // fixed-capacity, no heap in the result; excess dropped
    size_t issue_count;
    bool json_valid;               // false => config == defaults
};

ParseResult parse_config(const char* json_text, const Config& defaults);
const char* to_string(ConfigIssueKind kind);
```

Files:

- `src/config.h` — `Config`, `ConfigIssue`, `ParseResult`.
- `src/config_parser.h/.cpp` — `parse_config`, validation, `to_string`.

JSON is parsed with cJSON. On ESP-IDF it is the built-in `json` component; for the native
test env it is pulled as a PlatformIO library dependency in the lib's `platformio.ini`.

### 5.2 Main-Controller

- `src/defaults.h` — `constexpr vmaas::Config DEFAULTS` built from the existing constants in
  `pins.h` and `config.h`. Those two headers remain the source of the factory values.
- `src/config_store.h/.cpp`:
  - `bool mount_storage()` — registers and mounts LittleFS at `/storage`. Returns false on
    failure; never formats.
  - `vmaas::Config load_config(const vmaas::Config& defaults)` — reads
    `/storage/config.json` into a bounded buffer, calls `parse_config`, logs each issue with
    `ESP_LOGW`, and logs the effective config at `ESP_LOGI` so the serial log shows what the
    device actually uses.
- `src/main.cpp` — `bus`, `motor`, `i2c` and `lcd` move from static globals into `app_main`,
  constructed after `load_config`. The callbacks capture nothing and are unchanged.
- `src/idf_component.yml` — declares `joltwallet/littlefs`.
- `data/config.json` — the checked-in default file, matching the table in §4.

### 5.3 Boot sequence

```
app_main
  ├─ mount_storage()          (false → ESP_LOGE, continue)
  ├─ cfg = load_config(DEFAULTS)
  ├─ construct UartBus(cfg.pins.uart_tx, cfg.pins.uart_rx, cfg.uart.baud_rate)
  ├─ construct EspI2cPort(cfg.pins.i2c_sda, cfg.pins.i2c_scl, cfg.i2c.clock_hz)
  └─ existing smoke-test loop
```

## 6. Error handling

The device always boots. `load_config` is the single point that decides the effective
configuration.

| Situation                              | Behaviour                                              |
|----------------------------------------|--------------------------------------------------------|
| Mount fails                            | `ESP_LOGE`, continue with defaults. No auto-format.    |
| File missing                           | `ESP_LOGW`, defaults.                                  |
| File larger than the read buffer       | `ESP_LOGW`, defaults.                                  |
| Invalid JSON                           | `ESP_LOGW` with cJSON's error position, defaults.      |
| Field wrong type / out of range / input-only / duplicate | Field rejected, default for that field, one `ESP_LOGW` per field. |
| `version` higher than known            | `ESP_LOGW`, parsing continues.                         |

## 7. Testing

### 7.1 Native unit tests (`shared/vmaas-config/test/`, Unity)

- Empty object `{}` → result equals defaults, no issues.
- Partial file (only `pins.uart_rx`) → that field overridden, everything else default.
- Full file → all fields applied.
- Invalid JSON → `json_valid == false`, config equals defaults, one `InvalidJson` issue.
- Wrong type (`"uart_rx": "32"`) → `WrongType`, default used for that field.
- Pin out of range (40, -1) → `OutOfRange`.
- Input-only pin as `uart_tx` / `i2c_sda` / `i2c_scl` → `InputOnlyPin`; as `uart_rx` → accepted.
- Duplicate pins, including collision between an overridden pin and a default → `DuplicatePin`.
- Unknown keys at top level and nested → ignored, no issues.
- `version: 2` → `NewerVersion` issue, fields still applied.
- Non-positive `baud_rate` / `clock_hz` → `OutOfRange`.

### 7.2 Hardware verification (WROVER on COM6)

1. Spike (first plan task): flash a LittleFS image containing a marker file, mount, read it
   back, log it. Confirms the toolchain path end to end.
2. Flash the default `data/config.json`; boot log must show the effective config equal to
   `pins.h` / `config.h` and the UART link to Motorcontrol must still work.
3. Flash a `config.json` with `uart_rx`/`uart_tx` swapped; boot log must show the swapped
   values and the UART smoke test must stop receiving replies. Restore and confirm recovery.
4. Delete the file (flash an empty `data/`) and confirm the missing-file warning and a normal
   boot on defaults.

## 8. Future work (explicitly deferred)

- Secrets in NVS (WiFi, MQTT, device identity), separate from `config.json`.
- Writing `config.json` from firmware: backend push over MQTT, serial console commands.
- Schema migration when `version` increments.
- Reusing `vmaas-config` on Motorcontrol.
