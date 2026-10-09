# Motorcontrol Slot Config Filesystem — Design

**Date:** 2026-09-16
**Status:** Approved for planning
**Supersedes:** `2026-09-16-main-controller-config-filesystem-design.md` (the Main-Controller
variant was implemented and then withdrawn on the owner's decision: cabinet wiring lives on
Motorcontrol, Main-Controller's pins stay in firmware).
**Scope:** Motorcontrol firmware (ESP-IDF, ESP32-WROOM on COM7), shared library
`vmaas-config`, shared protocol `vmaas-protocol`, a small display change on Main-Controller,
and the rollback of the Main-Controller config filesystem.

## 1. Goal

The slot-to-GPIO wiring of the vending cabinet is described in a file on Motorcontrol's
flash, not compiled into the firmware. Motorcontrol has no default wiring: without a valid
file it refuses to drive any motor, tells Main-Controller so over the existing UART
protocol, and Main-Controller shows the error on its LCD.

Motivations, in priority order:

1. The cabinet wiring is the one thing that differs between machines; it must be editable
   without a firmware build (`slot_map.h` is marked "PROVISIONAL WIRING" today).
2. A machine with no or wrong wiring data must fail loudly and visibly, never run a motor
   on a guessed pin.
3. Future remote provisioning from the backend must not be blocked (out of scope here).

## 2. Non-goals (v1)

- Configurable pins on Main-Controller. Its `pins.h` and `config.h` stay as they were before
  the superseded spec; every artefact of that spec is removed again (§9).
- Motorcontrol's UART pins in the file. They stay in `Motorcontrol/src/pins.h` (TX 17, RX 16)
  so the error can always be reported.
- Writing the file from firmware (serial console, MQTT push), secrets, per-slot run time,
  schema migration. Deferred.
- Auto-formatting a corrupt filesystem partition.

## 3. Partition table and filesystem (Motorcontrol)

Identical to the superseded spec, moved to `Motorcontrol/`:

| Name     | Type | Subtype  | Offset   | Size     | Purpose                                  |
|----------|------|----------|----------|----------|------------------------------------------|
| nvs      | data | nvs      | 0x9000   | 0x6000   | Reserved (secrets later); ESP-IDF needs it |
| phy_init | data | phy      | 0xF000   | 0x1000   | ESP-IDF standard                          |
| factory  | app  | factory  | 0x10000  | 0x200000 | Firmware                                  |
| storage  | data | littlefs | 0x210000 | 0x1F0000 | Config filesystem, mounted at `/storage`  |

- LittleFS via the `joltwallet/littlefs` managed component (`Motorcontrol/src/idf_component.yml`).
- `Motorcontrol/platformio.ini`: `board_build.partitions = partitions.csv`,
  `board_build.filesystem = littlefs`.
- `Motorcontrol/sdkconfig.defaults` and the generated `sdkconfig.controller-motor` select the
  custom table and set `CONFIG_ESP_MAIN_TASK_STACK_SIZE=8192` (JSON parsing and LittleFS run
  on the main task).
- `Motorcontrol/managed_components/` is gitignored; `Motorcontrol/dependencies.lock` is tracked.
- Developer workflow: edit `Motorcontrol/data/config.json`, `pio run -t uploadfs`. Firmware
  upload is separate.

## 4. Config file format

Path on device: `/storage/config.json`.

```json
{
  "version": 1,
  "slots": [
    { "slot": 1, "pin": 18 },
    { "slot": 2, "pin": 19 },
    { "slot": 3, "pin": 21 },
    { "slot": 4, "pin": 22 }
  ]
}
```

Rules:

- `version` (integer, optional, default 1). Higher than the firmware's schema version gives a
  `NewerVersion` warning; parsing continues. Non-integer is `WrongType`.
- `slots` (array of objects, **required**). Absent, not an array, or empty: `MissingField`.
  More than `MAX_SLOTS = 32` entries: `TooManySlots` (the first 32 are still validated, so
  the log names every problem it can).
- Each entry: `slot` integer 1–255, `pin` integer 0–33. Missing key: `MissingField`; wrong
  type: `WrongType`; out of range: `OutOfRange`; pin 34–39: `InputOnlyPin` (motors are
  outputs). Issue field names are `slots[i].slot` / `slots[i].pin` with the zero-based index.
- Two entries with the same `slot`: `DuplicateSlot` on the later one. Two entries with the
  same `pin`: `DuplicatePin` on the later one. Nothing is "resolved": the file is simply
  invalid.
- Unknown keys at any level are ignored.
- Nesting deeper than 8 levels is rejected before parsing (`InvalidJson`), so a hostile file
  cannot exhaust the stack through cJSON's recursion.
- The file is **valid** only if it parsed as a JSON object and produced no issue other than
  `NewerVersion`. Any other issue makes the whole configuration unusable.

## 5. Protocol change (`shared/vmaas-protocol`)

`protocol.h` and `PROTOCOL.md` change together:

- New `ErrorCode::CONFIG_ERROR = 6`: "Motorcontrol has no valid slot configuration and
  refuses the request." Returned for RUN, STOP and CONFIG while in the error state.
- `State::ERROR = 2` is no longer "reserved": Motorcontrol emits `STATUS_REPLY(ERROR, 0)`
  in the error state. STATUS itself is still answered, never NAKed, so Main-Controller can
  always ask.
- Unknown commands and bad payloads keep their existing NAK codes, also in the error state.
- Frame layout, CRC and all other commands are unchanged.

## 6. Code structure

### 6.1 Shared library `shared/vmaas-config/` (re-targeted)

Platform independent, host-tested, no ESP-IDF headers, never logs, no heap in results
(cJSON allocates only while parsing). Vendored cJSON 1.7.18 stays.

```cpp
namespace vmaas {
    constexpr int CONFIG_SCHEMA_VERSION = 1;
    constexpr size_t MAX_SLOTS = 32;

    struct SlotEntry { uint8_t slot; int pin; };

    struct Config {
        size_t slot_count;              // 0 when the file is invalid
        SlotEntry slots[MAX_SLOTS];
    };

    enum class ConfigIssueKind : uint8_t {
        None = 0, InvalidJson, MissingField, WrongType, OutOfRange,
        InputOnlyPin, DuplicateSlot, DuplicatePin, TooManySlots, NewerVersion,
    };

    struct ConfigIssue { ConfigIssueKind kind; char field[20]; };  // e.g. "slots[31].pin"

    struct ParseResult {
        static constexpr size_t MAX_ISSUES = 8;
        Config config;             // fully populated only when ok
        bool ok;                   // json_valid && no issue other than NewerVersion
        bool json_valid;
        size_t json_error_offset;
        size_t issue_count;        // saturates at MAX_ISSUES; excess dropped
        ConfigIssue issues[MAX_ISSUES];
    };

    ParseResult parse_config(const char* json_text);
    const char* to_string(ConfigIssueKind kind);
}
```

`ConfigIssue::field` becomes a small inline buffer because the field name now carries an
index. Files: `src/config.h`, `src/config_issue.cpp`, `src/config_parser.h/.cpp`,
`src/cJSON.c/.h`. The old pins/uart/i2c schema, the defaults parameter and the duplicate
"loser" rule are removed.

### 6.2 Motorcontrol

- `src/config_store.h/.cpp` (moved from Main-Controller, extended):
  `mount_storage()`, `read_text_file()`, and
  `LoadResult load_config()` where
  `struct LoadResult { vmaas::Config config; bool ok; char reason[40]; }`.
  `reason` is a short human string for logs and for Main-Controller's display later
  (v1 Main-Controller shows a fixed text; `reason` is logged only). `load_config` logs every
  issue with `ESP_LOGW`, and on success logs the slot table at `ESP_LOGI`.
- `src/slot_map.h` is deleted. `SlotPin { uint8_t slot; gpio_num_t pin; }` moves into
  `command_handler.h`, which is its only consumer. `main.cpp` converts `vmaas::SlotEntry`
  to `SlotPin` (int → `gpio_num_t`) into a fixed array before constructing the handler.
- `src/config_error_responder.h/.cpp`: `class ConfigErrorResponder { ConfigErrorResponder(vmaas::UartBus&); void begin(); }`.
  Registers on the bus and answers: RUN/STOP/CONFIG → `NAK(cmd, CONFIG_ERROR)`;
  STATUS → `STATUS_REPLY(ERROR, 0)`; bad payload length → `NAK BAD_PAYLOAD` as today;
  unknown → `NAK UNKNOWN_CMD`; reply-type frames ignored with a warning.
- `src/main.cpp` boot sequence:

```
app_main
  ├─ bus.begin()
  ├─ mount_storage()                        (false → logged, load_config reports "not found")
  ├─ r = load_config()
  ├─ if r.ok:
  │     build SlotPin table from r.config
  │     CommandHandler handler(bus, table, count); handler.begin()
  │     loop: bus.poll(10 ms); handler.tick()
  └─ else:
        ConfigErrorResponder err(bus); err.begin()
        ESP_LOGE("config error: %s", r.reason)
        boot_count = ++RTC_NOINIT counter   (survives esp_restart, reset on power-on)
        loop: bus.poll(10 ms);
              after 30 s, if boot_count < 100: esp_restart()
              else keep looping (answering) forever
```

Motor pins are never configured as outputs in the error branch.

### 6.3 Main-Controller (display only)

`main.cpp` keeps its smoke test and gets two reactions:

- `on_nak` with `ErrorCode::CONFIG_ERROR`, or `on_status` with `State::ERROR` →
  row 0 `MOTOR CONFIG ERR`, row 1 scrolling `check slot config on Motorcontrol`,
  backlight red, and the smoke test stops cycling the backlight while the error is shown.
- Any later ACK or `STATUS_REPLY(IDLE/BUSY)` → restore the normal rows and resume.

No filesystem, no config, no `settings.h`: see §9.

## 7. Error handling (Motorcontrol)

| Situation                                   | Behaviour                                                             |
|---------------------------------------------|-----------------------------------------------------------------------|
| Mount fails                                 | `ESP_LOGE`, error state, reason "storage mount failed"                |
| File missing / too large (> 2047 bytes)     | `ESP_LOGW`, error state, reason "config.json missing" / "config.json too large" |
| Invalid JSON / too deep                     | `ESP_LOGW` with byte offset, error state, reason "config.json invalid JSON" |
| Validation issue (any kind but NewerVersion)| one `ESP_LOGW` per issue, error state, reason = first issue, e.g. "slots[2].pin OutOfRange" |
| `version` newer than known                  | `ESP_LOGW`, continue; file still usable                               |
| Error state                                 | NAK CONFIG_ERROR / STATUS_REPLY(ERROR); restart after 30 s, at most 100 times per power-on |

The device always boots far enough to answer UART. It never drives a motor pin without a
valid file.

## 8. Testing

### 8.1 Native tests (`shared/vmaas-config/test/`, Unity)

- `test_config_issue`: `None == 0`, distinct `to_string` for every kind, `Unknown` fallback,
  zero-initialised `ParseResult` is clean, `MAX_ISSUES >= 1`.
- `test_parse`: valid four-slot file → `ok`, `slot_count 4`, entries in file order; single
  slot; `{}` → `MissingField slots`, not ok; `nullptr`, invalid JSON (with offset), non-object
  root, 20-deep nesting → `InvalidJson`, not ok; depth-3 valid file still parses; unknown keys
  ignored; `version 2` → `NewerVersion` but ok; `version "1"` → `WrongType`, not ok.
- `test_validate`: `slots` not an array, empty array → `MissingField`; entry not an object →
  `WrongType slots[i]`; missing `pin` / missing `slot`; `slot 0`, `slot 256`, `pin -1`,
  `pin 40` → `OutOfRange`; `pin 34` → `InputOnlyPin`; boundary `slot 1`/`255`, `pin 0`/`33`
  accepted; duplicate slot → `DuplicateSlot` on the later index; duplicate pin →
  `DuplicatePin` on the later index; 33 entries → `TooManySlots`, not ok; 9 bad entries →
  `issue_count == MAX_ISSUES` (saturation is now reachable); `ok` is false whenever any
  non-`NewerVersion` issue exists, `slot_count == 0` then.

### 8.2 Hardware (WROOM on COM7, WROVER on COM6, UART both ways working)

1. Spike: flash the LittleFS image with the default file; Motorcontrol log shows the mount
   line and the four slots; Main-Controller's smoke test gets `ACK RUN` / `DONE 1` again.
2. Missing file (empty `data/`): Motorcontrol logs "config.json missing", answers
   `NAK RUN CONFIG_ERROR`; Main-Controller LCD shows `MOTOR CONFIG ERR` with red backlight;
   Motorcontrol restarts after 30 s and the RTC counter increments.
3. Duplicate pin in the file: Motorcontrol log names `slots[1].pin DuplicatePin`, same
   error behaviour on the LCD.
4. Restore the default file: ACK/DONE resume and the LCD returns to the normal rows.

## 9. Rollback of the Main-Controller filesystem

Every staged artefact of the superseded spec is removed from `Main-Controller/`:
`partitions.csv`, `sdkconfig.defaults`, `data/`, `dependencies.lock`, `src/idf_component.yml`,
`src/config_store.*`, `src/defaults.h`; `settings.h` is renamed back to `config.h`;
`platformio.ini`, `.gitignore`, `sdkconfig.main-controller` and `main.cpp` return to their
committed state (then `main.cpp` receives only the §6.3 display change). `Doxyfile` keeps
`shared/vmaas-config/src` and the cJSON exclude. `Main-Controller/tools/capture_serial.py`
moves to the repository root `tools/capture_serial.py` because it serves both boards.

## 10. Future work (explicitly deferred)

- Per-slot run time and other slot attributes in the same `slots` entries.
- Motorcontrol reporting the reason string to Main-Controller (a new reply or a longer
  STATUS_REPLY) so the LCD can show *which* field is wrong.
- Writing `config.json` from the backend; secrets in NVS; schema migration.
