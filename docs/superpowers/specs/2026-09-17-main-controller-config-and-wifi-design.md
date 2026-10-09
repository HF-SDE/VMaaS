# Main-Controller Config Filesystem and Wi-Fi Layer — Design

**Date:** 2026-09-17
**Status:** Proposed
**Scope:** Main-Controller firmware (ESP-IDF 6.1, ESP32-WROVER), shared library `vmaas-config`, new shared library `vmaas-fs`
**Supersedes:** `2026-09-16-main-controller-config-filesystem-design.md` (implemented, then withdrawn)

## 1. Goal

Give the Main-Controller a filesystem with a human-readable configuration file, and
replace the Arduino Wi-Fi code that currently prevents the firmware from building.

After this work the Main-Controller:

1. Mounts a LittleFS partition and reads `/storage/config.json` at boot.
2. Takes its device name, backend endpoint and operator-tunable timings from that file.
3. Connects to Wi-Fi through `esp_wifi`, using credentials already stored in NVS.
4. Builds again on branch `dev`.

## 2. Non-goals

This design deliberately stops short of the following. They belong to the next document,
`main-controller-wifi-onboarding`:

- Any way to **enter** Wi-Fi credentials: no BLE provisioning, no keypad text entry, no
  onboarding screens.
- Secrets other than Wi-Fi credentials. MQTT credentials and device tokens are out of scope.
- An MQTT client. `config.json` carries the broker settings so the schema does not have to
  change later, but nothing reads them yet.
- Writing `config.json` from firmware or from the backend. v1 is read-only at runtime; the
  file is flashed by a developer.
- Auto-formatting a corrupt filesystem partition.

**Consequence, stated plainly:** when this work is done the Main-Controller can connect to
Wi-Fi only if credentials are already in NVS, and there is no supported way to put them
there. That is acceptable because nothing in the firmware uses the network yet — the
existing `startWifi()` connects, prints a line, and is never called by anything.

## 3. What exists today

| | State |
|---|---|
| `Main-Controller/src/main.cpp:16` | `#include <WiFi.h>` — Arduino header, absent under `framework = espidf`. **Branch `dev` does not build.** |
| `Main-Controller/src/main.cpp:152` | `startWifi()` — defined, never called. Blocks forever in `while (WiFi.status() != WL_CONNECTED)`. |
| `Main-Controller/src/config.h` | All settings are `constexpr`, including `wifi_ssid` and `wifi_password` in plain text. |
| `Main-Controller/platformio.ini` | No partition table, no filesystem. |
| `shared/vmaas-config` | Slot-table parser for Motorcontrol: cJSON, a JSON nesting-depth guard, `ConfigIssue` reporting, 3 native test suites. |
| `Motorcontrol/src/config_store.{h,cpp}` | LittleFS mount + file read + parse. The pattern this design mirrors. |

## 4. Partition table

New file `Main-Controller/partitions.csv`, identical in shape to Motorcontrol's so the two
boards stay comparable. 4 MB flash:

```
# Name,   Type, SubType,  Offset,   Size,     Flags
# 4 MB flash. storage = LittleFS, mounted at /storage by config_store.
nvs,      data, nvs,      0x9000,   0x6000,
phy_init, data, phy,      0xF000,   0x1000,
factory,  app,  factory,  0x10000,  0x200000,
storage,  data, littlefs, 0x210000, 0x1F0000,
```

2 MB for the application is generous on purpose. The `network_provisioning` BLE example
alone measured 1,111,685 bytes on this toolchain (2026-09-17); the onboarding work adds
that on top of the display, keypad, UART and a future MQTT client. Partitions cannot be
resized without erasing flash, so the headroom is taken now.

`platformio.ini` gains:

```ini
board_build.partitions = partitions.csv
board_build.filesystem = littlefs
```

and `sdkconfig.defaults` records `CONFIG_PARTITION_TABLE_CUSTOM=y` plus
`CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="partitions.csv"` so the setting survives
regeneration of `sdkconfig.main-controller`.

## 5. `config.json`

`Main-Controller/data/config.json`, **committed to git**. It holds no secrets, by design:
Wi-Fi credentials live in NVS (§9), and nothing else in the file is sensitive.

```json
{
  "version": 1,
  "device": {
    "name": "VMaaS-0042",
    "machine_id": "5f2c1a90-6b3e-4d21-9f77-1c0a8e4b2d55"
  },
  "backend": {
    "mqtt_host": "mqtt.vmaas.dk",
    "mqtt_port": 8883,
    "client_id": "vmaas-0042"
  },
  "timings": {
    "keypad_debounce_ms": 20,
    "slot_entry_timeout_ms": 10000,
    "slot_entry_result_hold_ms": 2000
  }
}
```

### 5.1 Field notes

- `device.name` is what the provisioning app shows and what the LCD prints during
  onboarding. Capped at 16 characters so it fits one display row.
- `device.machine_id` identifies the machine to the backend. Free-form, capped at 36
  characters (a UUID fits).
- `backend.*` is carried but unread until the MQTT client exists.
- `timings.*` covers only values an operator might reasonably tune.

### 5.2 What stays compile-time

These remain `constexpr` in `Main-Controller/src/config.h` and are **not** moved into the file:

| Setting | Why it stays |
|---|---|
| `keypad_scan_interval_ms` | Must be a whole number of FreeRTOS ticks. With `CONFIG_FREERTOS_HZ=100` a tick is 10 ms; a smaller value rounds to zero in `pdMS_TO_TICKS` and `xTaskDelayUntil` asserts. Not safe to expose. |
| `keypad_queue_depth`, `keypad_task_stack`, `keypad_task_priority` | Task construction parameters, read once before the scheduler is useful. Not operationally meaningful. |
| `baud_rate`, `i2c_clock_hz` | Must match the hardware on the other end of the wire. A wrong value here is a build-time mistake, not a deployment choice. |

`wifi_ssid` and `wifi_password` are **deleted** from `config.h`. Pin assignments stay in
`pins.h`: the decision of 2026-09-16 that Main-Controller wiring is not configurable stands.

## 6. Parser: extending `shared/vmaas-config`

The library already owns the parts worth reusing — cJSON, the nesting-depth guard, the
`ConfigIssue` reporting machinery, and a working native test setup. It has however taken
the generic names in namespace `vmaas` for Motorcontrol's schema.

There is also a concrete collision: the library exports `config.h`, and Main-Controller has
its own `src/config.h`. Both on one include path is a trap. The rename fixes that too.

### 6.1 File layout after the change

```
shared/vmaas-config/src/
  cJSON.{c,h}                    unchanged
  json_depth.{h,cpp}             NEW  — nesting_too_deep(), lifted out of config_parser.cpp
  config_issue.h                 NEW header — ConfigIssueKind, ConfigIssue, to_string, split out of config.h
  config_issue.cpp               unchanged — already holds to_string()
  slot_config.h                  WAS config.h        — SlotEntry, SlotConfig, SlotParseResult
  slot_config_parser.{h,cpp}     WAS config_parser.* — parse_slot_config()
  device_config.h                NEW  — DeviceConfig, DeviceParseResult
  device_config_parser.{h,cpp}   NEW  — parse_device_config()
```

### 6.2 Renames

| Before | After |
|---|---|
| `vmaas::Config` | `vmaas::SlotConfig` |
| `vmaas::ParseResult` | `vmaas::SlotParseResult` |
| `vmaas::parse_config()` | `vmaas::parse_slot_config()` |
| `vmaas::CONFIG_SCHEMA_VERSION` | `vmaas::SLOT_SCHEMA_VERSION` |
| `#include "config.h"` | `#include "slot_config.h"` |

`ConfigIssueKind`, `ConfigIssue` and `to_string()` keep their names — they are genuinely
shared. `MAX_SLOTS` keeps its name.

Call sites to update: `Motorcontrol/src/config_store.h:25`, `config_store.cpp:86,98,99`,
`Motorcontrol/src/main.cpp:30`, and the two native test files. Mechanical, and covered by
the tests that already exist.

### 6.3 New device schema

```c++
namespace vmaas
{
    constexpr int DEVICE_SCHEMA_VERSION = 1;

    constexpr size_t MAX_DEVICE_NAME = 17;   ///< 16 chars + NUL: one LCD row.
    constexpr size_t MAX_MACHINE_ID  = 37;   ///< 36 chars + NUL: a UUID fits.
    constexpr size_t MAX_MQTT_HOST   = 64;
    constexpr size_t MAX_CLIENT_ID   = 33;

    struct DeviceConfig
    {
        char     name[MAX_DEVICE_NAME];
        char     machine_id[MAX_MACHINE_ID];
        char     mqtt_host[MAX_MQTT_HOST];
        uint16_t mqtt_port;
        char     mqtt_client_id[MAX_CLIENT_ID];
        uint32_t keypad_debounce_ms;
        uint32_t slot_entry_timeout_ms;
        uint32_t slot_entry_result_hold_ms;
    };

    /// Values used for any field the file does not supply or supplies badly.
    DeviceConfig device_config_defaults();

    struct DeviceParseResult
    {
        static constexpr size_t MAX_ISSUES = 8;

        DeviceConfig config;       ///< ALWAYS usable. See note below.
        bool ok;                   ///< true when no issue other than NewerVersion was found.
        bool json_valid;
        size_t json_error_offset;
        size_t issue_count;
        ConfigIssue issues[MAX_ISSUES];
    };

    DeviceParseResult parse_device_config(const char* json_text);
}
```

**The important difference from the slot parser.** `parse_slot_config()` yields an empty
table when anything is wrong, because there is no safe default wiring for a motor.
`parse_device_config()` is the opposite: `config` starts from `device_config_defaults()`
and each field the file supplies cleanly overwrites its default. A malformed field is
reported as an issue and leaves the default in place. **`config` is always usable, even
when `ok` is false and even when `json_valid` is false.**

This is deliberate and is the decision recorded in §10.

### 6.4 Defaults

| Field | Default | Source |
|---|---|---|
| `name` | `""` | Empty means "derive from MAC", as the provisioning example does |
| `machine_id` | `""` | Empty means unidentified; the backend will reject it when that matters |
| `mqtt_host` | `""` | Empty means no backend configured |
| `mqtt_port` | `8883` | MQTT over TLS |
| `mqtt_client_id` | `""` | Empty means derive from `machine_id` |
| `keypad_debounce_ms` | `20` | Today's `Config::keypad_debounce_ms` |
| `slot_entry_timeout_ms` | `10000` | Today's `Config::slot_entry_timeout_ms` |
| `slot_entry_result_hold_ms` | `2000` | Today's `Config::slot_entry_result_hold_ms` |

### 6.5 Validation rules

- Unknown keys are ignored. Missing sections are not an error; their fields take defaults.
- `version` above `DEVICE_SCHEMA_VERSION` gives `NewerVersion` and parsing continues.
- A string longer than its buffer gives `OutOfRange` and keeps the default. Values are
  never silently truncated.
- `mqtt_port` must be 1–65535; anything else gives `OutOfRange`.
- Timings must be 1–600000 ms. Zero is rejected: a zero debounce or zero timeout would
  make the keypad unusable, and a caller has no way to notice.
- Invalid JSON, a `nullptr`, a non-object root, or nesting deeper than 8 levels gives
  `json_valid == false` with one `InvalidJson` issue and `json_error_offset` set. The
  depth check runs **before** cJSON recurses, so a hostile or corrupt file cannot exhaust
  the task stack.

## 7. `shared/vmaas-fs`

`Motorcontrol/src/config_store.cpp` already contains a LittleFS mount and a
read-whole-text-file helper. Main-Controller needs byte-identical versions. Rather than
copy them, they move to a new small ESP-IDF-only library:

```c++
namespace vmaas::fs
{
    /// Mount a LittleFS partition. Never formats. Logs and returns false on failure.
    bool mount(const char* partition_label, const char* mount_point);

    /// Read a whole text file and NUL-terminate it.
    /// @return bytes read (>= 0); -1 cannot open; -2 does not fit or bad arguments.
    int read_text_file(const char* path, char* buf, size_t capacity);
}
```

This library has no native tests: both functions are thin wrappers over `esp_littlefs` and
stdio, and a mock of them would test the mock. They are covered by the hardware checks in §11.

**Blast radius:** this changes Motorcontrol, which is working today. Motorcontrol therefore
needs a hardware smoke test after the change. This is scheduled as the last task in the
implementation plan so it can be dropped without blocking anything else.

## 8. `Main-Controller/src/config_store`

Mirrors Motorcontrol's, minus the parts now in `vmaas-fs`:

```c++
namespace config_store
{
    constexpr const char* MOUNT_POINT     = "/storage";
    constexpr const char* PARTITION_LABEL = "storage";
    constexpr const char* CONFIG_PATH     = "/storage/config.json";
    constexpr size_t MAX_CONFIG_BYTES     = 2048;

    /// Mount storage, read CONFIG_PATH, parse it, log every issue at WARN and
    /// the resulting settings at INFO. Always returns a usable config: when the
    /// partition will not mount or the file is missing, the built-in defaults
    /// are returned and one warning is logged.
    vmaas::DeviceConfig load();
}
```

`load()` returns the config by value, not a verdict. There is no failure path for the
caller to handle, because §10 decided there is no failure the Main-Controller should
refuse to start on.

## 9. Wi-Fi: one source of truth

`esp_wifi` already persists the station configuration to NVS itself, under its own
namespace, whenever `WIFI_STORAGE_FLASH` is in effect — which is the default. This was
confirmed on hardware on 2026-09-17: a board previously flashed with Arduino
`WiFi.begin()` made the provisioning example report *"Already provisioned"*, because
`network_prov_mgr_is_wifi_provisioned()` reads exactly that stored configuration.

A separate credentials store next to it would create two answers to one question. The
Wi-Fi module is therefore a thin layer over `esp_wifi`, not a store:

`Main-Controller/src/wifi_sta.{h,cpp}`

```c++
namespace wifi_sta
{
    /// Bring up netif, the event loop and the Wi-Fi driver in STA mode.
    /// Does not connect. Leaves storage at WIFI_STORAGE_FLASH.
    esp_err_t init();

    /// True when esp_wifi_get_config(WIFI_IF_STA) yields a non-empty SSID.
    bool has_credentials();

    /// Start the driver and begin connecting. Returns immediately; progress is
    /// reported through is_connected(). Safe to call with no credentials: it
    /// logs and does nothing.
    esp_err_t connect();

    bool is_connected();

    /// Store credentials and connect. The driver persists them to NVS.
    /// This is the single entry point the onboarding work will call.
    esp_err_t set_credentials(const char* ssid, const char* password);

    /// esp_wifi_restore(): erase the stored station configuration.
    esp_err_t forget();
}
```

### 9.1 Reconnection

Handlers on `WIFI_EVENT_STA_DISCONNECTED` and `IP_EVENT_STA_GOT_IP`. Retry with
exponential backoff starting at 2 s and capped at 60 s, so a wrong password does not keep
the radio busy indefinitely — the provisioning example's fixed 2.4 s retry was visible in
the 2026-09-17 bench log and is not a good model for a machine that runs for months.

Connection state is advisory. **Nothing blocks on it.** The blocking
`while (WiFi.status() != WL_CONNECTED)` loop in today's `startWifi()` is deleted, not ported:
a machine that cannot sell because the café changed its Wi-Fi password is a worse failure
than one that sells without telemetry.

## 10. Behaviour when `config.json` is missing or invalid

**Decision: run on built-in defaults and log a warning.**

This differs from Motorcontrol, on purpose. Motorcontrol refuses to start without a valid
slot table because that file decides which motor turns; a guess there dispenses the wrong
product or drives a pin wired to something else. The Main-Controller's file holds identity
and timings. A wrong `mqtt_host` costs telemetry, not safety, and a vending machine that
will not sell is worse than one that sells while unreachable.

Every issue is logged once at WARN with its dotted field path, so a mistake is visible in
the boot log without hunting.

The display shows nothing about it. A permanent warning banner on a 16x2 screen would be
learned and ignored within a week, and it would compete with the slot prompt for the only
two rows there are.

## 11. Testing

### 11.1 Native (`platform = native`, run on the host)

| Suite | Covers |
|---|---|
| `test_parse` | Existing slot-parser tests, updated for the renames |
| `test_validate` | Existing slot-validation tests, updated for the renames |
| `test_config_issue` | Existing, unchanged |
| `test_device_parse` | NEW — every field parsed, absent sections, unknown keys, `version` handling |
| `test_device_validate` | NEW — over-long strings, out-of-range port and timings, zero timings, malformed JSON, nesting beyond 8 levels, and that `config` is usable in every one of those cases |

### 11.2 Hardware (WROVER on COM6)

1. `pio run -t uploadfs` then `-t upload`; boot log shows the values from `config.json`.
2. Delete `config.json` from `data/`, re-upload the filesystem; boot log warns once and
   shows the defaults; the slot prompt still appears and a slot can still be entered.
3. Write malformed JSON into `config.json`; boot log names the byte offset; defaults used.
4. Set `slot_entry_timeout_ms` to 3000; confirm a partial entry is discarded after 3 s.
5. Erase flash; confirm `wifi_sta::has_credentials()` is false, one line is logged, and
   the machine reaches the slot prompt without delay.

**Gap, stated openly:** the actual Wi-Fi *connection* path cannot be verified in this work,
because nothing can write credentials until the onboarding work exists. It is verified with
a temporary, uncommitted build flag that calls `wifi_sta::set_credentials()` once at boot;
the flag is removed before the task is considered done. Full verification belongs to the
onboarding document.

## 12. Developer workflow

1. Edit `Main-Controller/data/config.json` (version-controlled).
2. `pio run -t uploadfs` builds a LittleFS image from `data/` and writes it to `storage`.
3. `pio run -t upload` flashes firmware. The two are independent.

## 13. What the onboarding work builds on this

The next document, `main-controller-wifi-onboarding`, needs exactly three things from here,
and this design provides all of them:

- `wifi_sta::set_credentials()` and `forget()` — the single write path shared by BLE
  provisioning and keypad entry.
- `DeviceConfig::name` — the name shown in the provisioning app and on the LCD.
- 2 MB of application partition — room for the BLE stack.

## 14. Decisions recorded

| Decision | Choice | Date |
|---|---|---|
| Pins in `config.json`? | No. Firmware, as decided 2026-09-16. | 2026-09-17 |
| Where do secrets live? | NVS, not the LittleFS file. | 2026-09-17 |
| Parser location | Extend `vmaas-config`, rename Motorcontrol's types. | 2026-09-17 |
| Missing or invalid `config.json` | Run on defaults, log a warning. | 2026-09-17 |
| Credentials store | `esp_wifi`'s own NVS storage. No second store. | 2026-09-17 |
