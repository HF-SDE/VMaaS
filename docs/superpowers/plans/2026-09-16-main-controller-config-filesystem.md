# Main-Controller Config Filesystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Main-Controller a LittleFS partition holding a human-readable `config.json` (pins first), parsed by a host-tested shared library, with the firmware always booting on `pins.h`/`config.h` defaults when the file is missing or wrong.

**Architecture:** A custom partition table adds a `storage` LittleFS partition. A new shared PlatformIO library `shared/vmaas-config` holds a pure C/C++ parser (`parse_config`) that merges JSON text over a `Config` of defaults and reports per-field issues; it is unit-tested on the PC. Main-Controller gets a small `config_store` (mount + read + log) and `main.cpp` constructs the UART and I2C ports from the loaded config instead of compile-time constants.

**Tech Stack:** ESP-IDF 6.1 via PlatformIO 6.2 (`framework = espidf`, `board = esp32dev`), `joltwallet/littlefs` managed component, vendored cJSON 1.7.18 (ESP-IDF 6 no longer ships a `json` component), C++17, Unity on PlatformIO `native`.

**Spec:** `docs/superpowers/specs/2026-09-16-main-controller-config-filesystem-design.md`

## Global Constraints

- Flash is 4 MB. Partition table: `nvs` 0x9000/0x6000, `phy_init` 0xF000/0x1000, `factory` 0x10000/0x200000, `storage` (littlefs) 0x210000/0x1F0000.
- Filesystem mounted at `/storage`, partition label `storage`, config file `/storage/config.json`. Never format on mount failure.
- Config schema version is `1`. All fields optional. Unknown keys ignored. Invalid fields rejected one at a time, default used for that field.
- Validation: pins are integers 0–39; `uart_tx`, `i2c_sda`, `i2c_scl` must not be 34–39 (input-only); `uart_rx` may be any of 0–39; no two pins equal on the merged result; `baud_rate` and `clock_hz` are positive integers.
- Library code in `shared/vmaas-config/src` must not include any ESP-IDF or FreeRTOS header. It never logs and never allocates in its result type (cJSON allocates internally during parsing; that is fine).
- C++ exceptions and RTTI are disabled on the boards. No `throw`, `dynamic_cast`, `typeid`, no `std::string`/`std::vector` in library or firmware code (tests may use them).
- Defaults stay in `Main-Controller/src/pins.h` and `config.h`. Those files are not renamed.
- Code, comments and docs in English. Doxygen comments on all public headers, same style as `shared/vmaas-display`.
- **Do not commit.** The repository owner forbids `git commit` from this tool (see `.claude/settings.json`). Every task ends with a verification step instead of a commit step. The owner commits.
- All work on branch `dev`. `docs/superpowers/**` is gitignored on purpose; the spec and this plan stay untracked.

## Toolchain notes (Windows host)

`pio` is not on the tool shell's PATH. Use the full path. The host compiler (WinLibs GCC) is on the user PATH but Git Bash in this tool may need the prefix.

Git Bash:

```bash
export PATH="/c/Users/temp/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
PIO=/c/Users/temp/.platformio/penv/Scripts/pio.exe
PY=/c/Users/temp/.platformio/penv/Scripts/python.exe
```

PowerShell:

```powershell
$PIO = "C:\Users\temp\.platformio\penv\Scripts\pio.exe"
$PY  = "C:\Users\temp\.platformio\penv\Scripts\python.exe"
```

- Host tests: run from `shared/vmaas-config`: `$PIO test -e native` (all) or `$PIO test -e native -f test_parse` (one folder).
- Firmware build: run from `Main-Controller`: `$PIO run -e main-controller`.
- Filesystem image: `$PIO run -e main-controller -t buildfs` (build only) / `-t uploadfs` (build + flash the `data/` folder to the `storage` partition).
- Firmware upload: `$PIO run -e main-controller -t upload`. Close any serial monitor on COM6 first; a held port makes the upload fail.
- Serial capture: `pio device monitor` needs a TTY and does not work from the tool shell. Use `Main-Controller/tools/capture_serial.py` (created in Task 1): `$PY tools/capture_serial.py COM6 8` resets the board and prints 8 seconds of log.
- The WROVER board is on COM6. Motorcontrol (WROOM) is on COM7 and must be running for the UART smoke test to receive replies.
- First firmware build after Task 1 downloads `joltwallet/littlefs` from the Espressif component registry (needs network). It lands in `Main-Controller/managed_components/` (gitignored) and pins the version in `Main-Controller/dependencies.lock` (tracked).

## Learning checkpoints

One spot carries a design decision the project owner may want to make. It is marked **OWNER DECISION** in Task 4. The executor implements the default given and flags it:

- Task 4, duplicate pins: which field is rejected when two pins collide. Default: the later field in the order `uart_rx, uart_tx, i2c_sda, i2c_scl` that came from the file. Alternative: reject both file-provided fields.

---

## File Structure

```
shared/vmaas-config/                     NEW shared library (host-tested)
  library.json
  platformio.ini                         native test env
  .gitignore                             .pio
  README.md                              schema, API, test table
  src/
    cJSON.h, cJSON.c                     vendored cJSON 1.7.18 (MIT), unmodified
    config.h                             Config, ConfigIssueKind, ConfigIssue, ParseResult, to_string
    config_issue.cpp                     to_string(ConfigIssueKind)
    config_parser.h                      parse_config()
    config_parser.cpp                    cJSON walk, merge, validation
  test/
    test_config_issue/test_main.cpp      to_string
    test_parse/test_main.cpp             merge behaviour, invalid JSON, wrong type
    test_validate/test_main.cpp          ranges, input-only, duplicates, version, unknown keys

Main-Controller/
  partitions.csv                         NEW custom partition table
  sdkconfig.defaults                     NEW: custom partition table selection
  sdkconfig.main-controller              MODIFY: same three lines
  platformio.ini                         MODIFY: partitions + filesystem
  .gitignore                             MODIFY: managed_components/
  data/config.json                       NEW default config, flashed with uploadfs
  tools/capture_serial.py                NEW serial capture helper
  src/idf_component.yml                  NEW: joltwallet/littlefs
  src/config_store.h / .cpp              NEW: mount, read file, load_config, log
  src/defaults.h                         NEW: constexpr DEFAULTS from pins.h/config.h
  src/main.cpp                           MODIFY: construct ports from loaded config

Doxyfile                                 MODIFY: add vmaas-config, exclude cJSON
```

Responsibilities: `config_parser.cpp` is the only file that knows JSON. `config_store.cpp` is the only file that knows the filesystem and ESP logging. `defaults.h` is the only place that turns `pins.h`/`config.h` constants into a `Config`. `main.cpp` only consumes a `Config`.

---

### Task 1: Partition table, LittleFS mount and `uploadfs` end to end (spike, kept)

This is the risky toolchain path. Everything else depends on it, so it is verified on hardware before any parsing code is written. The code written here is real and stays; only the temporary log line in `main.cpp` is replaced in Task 5.

**Files:**
- Create: `Main-Controller/partitions.csv`
- Create: `Main-Controller/sdkconfig.defaults`
- Modify: `Main-Controller/sdkconfig.main-controller` (partition table lines)
- Modify: `Main-Controller/platformio.ini`
- Modify: `Main-Controller/.gitignore`
- Create: `Main-Controller/src/idf_component.yml`
- Create: `Main-Controller/data/config.json`
- Create: `Main-Controller/tools/capture_serial.py`
- Create: `Main-Controller/src/config_store.h`, `Main-Controller/src/config_store.cpp`
- Modify: `Main-Controller/src/main.cpp` (temporary log of file contents)

**Interfaces:**
- Produces: `namespace config_store { constexpr const char* MOUNT_POINT = "/storage"; constexpr const char* PARTITION_LABEL = "storage"; constexpr const char* CONFIG_PATH = "/storage/config.json"; bool mount_storage(); int read_text_file(const char* path, char* buf, size_t capacity); }`. `read_text_file` returns bytes read (>= 0) and NUL-terminates, `-1` if the file cannot be opened, `-2` if it does not fit in `capacity - 1`.

- [ ] **Step 1: Write the partition table**

Create `Main-Controller/partitions.csv`:

```csv
# Name,   Type, SubType,  Offset,   Size,     Flags
# 4 MB flash. storage = LittleFS, mounted at /storage by config_store.
nvs,      data, nvs,      0x9000,   0x6000,
phy_init, data, phy,      0xF000,   0x1000,
factory,  app,  factory,  0x10000,  0x200000,
storage,  data, littlefs, 0x210000, 0x1F0000,
```

- [ ] **Step 2: Select the custom table in sdkconfig**

Create `Main-Controller/sdkconfig.defaults`:

```
# Applied when sdkconfig.<env> is regenerated. Keep in sync with sdkconfig.main-controller.
CONFIG_PARTITION_TABLE_CUSTOM=y
CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="partitions.csv"
CONFIG_PARTITION_TABLE_FILENAME="partitions.csv"
```

Edit the existing `Main-Controller/sdkconfig.main-controller` (it is already generated, so `sdkconfig.defaults` alone does not change it). Replace these lines:

| Before | After |
|---|---|
| `CONFIG_PARTITION_TABLE_SINGLE_APP=y` | `# CONFIG_PARTITION_TABLE_SINGLE_APP is not set` |
| `# CONFIG_PARTITION_TABLE_CUSTOM is not set` | `CONFIG_PARTITION_TABLE_CUSTOM=y` |
| `CONFIG_PARTITION_TABLE_FILENAME="partitions_singleapp.csv"` | `CONFIG_PARTITION_TABLE_FILENAME="partitions.csv"` |

`CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="partitions.csv"` is already present; leave it.

- [ ] **Step 3: Tell PlatformIO about the table and filesystem**

Add to `[env:main-controller]` in `Main-Controller/platformio.ini`, after `lib_extra_dirs`:

```ini
board_build.partitions = partitions.csv
board_build.filesystem = littlefs
```

Append to `Main-Controller/.gitignore`:

```
managed_components/
```

- [ ] **Step 4: Declare the LittleFS component**

Create `Main-Controller/src/idf_component.yml` (the `src` folder is the IDF `main` component, so the component manager reads the manifest from here):

```yaml
## ESP-IDF component manager manifest for the Main-Controller app component.
dependencies:
  idf: ">=5.0"
  joltwallet/littlefs: "^1.16.0"
```

- [ ] **Step 5: Write the default config file**

Create `Main-Controller/data/config.json` (values equal to `pins.h` / `config.h`, so flashing it changes nothing):

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
  "i2c": { "clock_hz": 100000 }
}
```

- [ ] **Step 6: Write the serial capture helper**

Create `Main-Controller/tools/capture_serial.py`:

```python
"""Reset the ESP32 on a COM port and print its serial output for N seconds.

Usage: python tools/capture_serial.py COM6 8
`pio device monitor` needs a TTY; this works from any shell. Uses pyserial,
which ships with PlatformIO's penv python.
"""
import sys
import time

import serial


def main() -> int:
    port = sys.argv[1] if len(sys.argv) > 1 else "COM6"
    seconds = float(sys.argv[2]) if len(sys.argv) > 2 else 8.0
    with serial.Serial(port, 115200, timeout=0.2) as s:
        # Pulse EN via RTS with IO0 (DTR) released: normal reset, not bootloader.
        s.setDTR(False)
        s.setRTS(True)
        time.sleep(0.1)
        s.setRTS(False)
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            chunk = s.read(4096)
            if chunk:
                sys.stdout.write(chunk.decode("utf-8", errors="replace"))
                sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 7: Write `config_store` (mount + read)**

Create `Main-Controller/src/config_store.h`:

```cpp
#pragma once
/**
 * @file config_store.h
 * @brief LittleFS mount and config file access for the Main-Controller.
 *
 * The only firmware module that touches the filesystem. Parsing lives in
 * the shared vmaas-config library; this module reads bytes and logs.
 */
#include <cstddef>

namespace config_store
{
    constexpr const char* MOUNT_POINT = "/storage";               ///< VFS mount point.
    constexpr const char* PARTITION_LABEL = "storage";            ///< Name in partitions.csv.
    constexpr const char* CONFIG_PATH = "/storage/config.json";   ///< Device config file.

    /**
     * @brief Mount the LittleFS partition at MOUNT_POINT.
     *
     * Never formats. On failure the error is logged and false returned; the
     * caller continues on defaults.
     * @return true if the filesystem is mounted.
     */
    bool mount_storage();

    /**
     * @brief Read a whole text file into a buffer and NUL-terminate it.
     * @param path Absolute VFS path.
     * @param buf Destination buffer.
     * @param capacity Size of @p buf in bytes, including room for the NUL.
     * @return Bytes read (>= 0); -1 if the file cannot be opened; -2 if it does not fit.
     */
    int read_text_file(const char* path, char* buf, size_t capacity);
}
```

Create `Main-Controller/src/config_store.cpp`:

```cpp
#include "config_store.h"

#include <cstdio>
#include "esp_littlefs.h"
#include "esp_log.h"

namespace
{
    constexpr const char* TAG = "ConfigStore";
}

namespace config_store
{
    bool mount_storage()
    {
        esp_vfs_littlefs_conf_t conf = {};
        conf.base_path = MOUNT_POINT;
        conf.partition_label = PARTITION_LABEL;
        conf.format_if_mount_failed = false;
        conf.dont_mount = false;

        const esp_err_t err = esp_vfs_littlefs_register(&conf);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "mount %s failed: %s", MOUNT_POINT, esp_err_to_name(err));
            return false;
        }

        size_t total = 0, used = 0;
        if (esp_littlefs_info(PARTITION_LABEL, &total, &used) == ESP_OK)
            ESP_LOGI(TAG, "mounted %s: %u of %u bytes used", MOUNT_POINT, (unsigned)used, (unsigned)total);
        return true;
    }

    int read_text_file(const char* path, char* buf, size_t capacity)
    {
        if (buf == nullptr || capacity == 0)
            return -2;

        FILE* f = std::fopen(path, "rb");
        if (f == nullptr)
            return -1;

        const size_t n = std::fread(buf, 1, capacity - 1, f);
        const bool more = (std::fgetc(f) != EOF);
        std::fclose(f);

        if (more)
        {
            buf[0] = '\0';
            return -2;
        }
        buf[n] = '\0';
        return static_cast<int>(n);
    }
}
```

- [ ] **Step 8: Temporarily log the file from `main.cpp`**

In `Main-Controller/src/main.cpp`, add `#include "config_store.h"` after `#include "config.h"`, and insert at the very top of `app_main()` (before `bus.begin();`):

```cpp
    // Task 1 spike: prove mount + read. Replaced by load_config() in Task 5.
    if (config_store::mount_storage())
    {
        static char file_buf[1024];
        const int n = config_store::read_text_file(config_store::CONFIG_PATH, file_buf, sizeof(file_buf));
        if (n >= 0)
            ESP_LOGI(TAG, "config.json (%d bytes):\n%s", n, file_buf);
        else
            ESP_LOGW(TAG, "config.json not readable (%d)", n);
    }
```

- [ ] **Step 9: Build firmware**

Run from `Main-Controller`: `$PIO run -e main-controller`

Expected: the component manager downloads `joltwallet/littlefs` (log line mentioning `littlefs`), a `dependencies.lock` appears, and the build ends with `SUCCESS`. The size report must show the partition table from `partitions.csv` (`factory` at 0x10000, 2 MB). If the build complains that `esp_littlefs.h` is missing, the manifest was not picked up: confirm it is at `src/idf_component.yml` and delete `.pio/build/main-controller` to force a CMake reconfigure.

- [ ] **Step 10: Build and flash the filesystem image**

Run from `Main-Controller`: `$PIO run -e main-controller -t uploadfs`

Expected: `Building FS image from 'data' directory` using `mklittlefs`, then esptool writes at `0x210000`. If it reports "Could not find the any filesystem section in the partitions table", the `storage` line in `partitions.csv` is wrong.

- [ ] **Step 11: Flash firmware and capture the log**

Run from `Main-Controller`:

```bash
$PIO run -e main-controller -t upload
$PY tools/capture_serial.py COM6 8
```

Expected in the log, in this order:

```
I (...) ConfigStore: mounted /storage: <used> of <total> bytes used
I (...) MainController: config.json (<n> bytes):
{
  "version": 1,
  ...
```

followed by the existing UART/display smoke test lines. If the mount fails with `ESP_ERR_NOT_FOUND`, the partition label does not match. If it fails with a corrupt-superblock style error, the image block/page size does not match the component (default 4096/256): report it, do not enable `format_if_mount_failed`.

- [ ] **Step 12: Verify**

Confirm all of: firmware builds, `uploadfs` writes at 0x210000, the log shows the mounted line and the file contents. Report the exact three log lines. Do not commit.

---

### Task 2: `vmaas-config` scaffold, vendored cJSON, `Config` types and `to_string`

**Files:**
- Create: `shared/vmaas-config/library.json`
- Create: `shared/vmaas-config/platformio.ini`
- Create: `shared/vmaas-config/.gitignore`
- Create: `shared/vmaas-config/src/cJSON.h`, `shared/vmaas-config/src/cJSON.c` (downloaded)
- Create: `shared/vmaas-config/src/config.h`
- Create: `shared/vmaas-config/src/config_issue.cpp`
- Test: `shared/vmaas-config/test/test_config_issue/test_main.cpp`

**Interfaces:**
- Produces (namespace `vmaas`): `struct Config`, `enum class ConfigIssueKind : uint8_t { None = 0, InvalidJson, WrongType, OutOfRange, InputOnlyPin, DuplicatePin, NewerVersion }`, `struct ConfigIssue { ConfigIssueKind kind; const char* field; }`, `struct ParseResult { Config config; bool json_valid; size_t json_error_offset; size_t issue_count; ConfigIssue issues[MAX_ISSUES]; }` with `static constexpr size_t MAX_ISSUES = 8`, and `const char* to_string(ConfigIssueKind)`.

- [ ] **Step 1: Scaffold the library**

Create `shared/vmaas-config/library.json`:

```json
{
  "name": "vmaas-config",
  "version": "0.1.0",
  "description": "Device configuration schema and JSON parser for VMaaS controllers (config.json on LittleFS)",
  "keywords": ["config", "json", "vmaas"],
  "frameworks": "*",
  "platforms": "*",
  "headers": ["config.h", "config_parser.h"]
}
```

Create `shared/vmaas-config/platformio.ini`:

```ini
; Host-side unit tests for the shared config library.
; Run from this directory: pio test -e native
[env:native]
platform = native
test_framework = unity
test_build_src = yes
build_flags = -std=c++17 -Wall -Wextra
```

PlatformIO routes `-std=c++17` to C++ compilations only, so the vendored `cJSON.c` compiles as C without a flag warning. If the test build prints `command-line option '-std=c++17' is valid for C++ but not for C`, it is a warning only; leave it.

Create `shared/vmaas-config/.gitignore`:

```
.pio
```

- [ ] **Step 2: Vendor cJSON**

Run from `shared/vmaas-config/src`:

```bash
curl -fL -o cJSON.c https://raw.githubusercontent.com/DaveGamble/cJSON/v1.7.18/cJSON.c
curl -fL -o cJSON.h https://raw.githubusercontent.com/DaveGamble/cJSON/v1.7.18/cJSON.h
head -3 cJSON.h
```

Expected: both files download (cJSON.c is roughly 3000 lines) and the header starts with the MIT copyright notice. Do not edit them. ESP-IDF 6 no longer bundles a `json` component, so this single copy serves both the native tests and the firmware build.

- [ ] **Step 3: Write the failing test for `to_string`**

Create `shared/vmaas-config/test/test_config_issue/test_main.cpp`:

```cpp
/**
 * @file test_main.cpp
 * @brief Host tests for ConfigIssueKind and to_string().
 *
 * Guards that every issue kind has its own log-friendly name so a boot log
 * line always tells which validation failed, and that None is 0.
 */
#include <unity.h>
#include <cstring>
#include "config.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

void test_none_is_zero()
{
    TEST_ASSERT_EQUAL_UINT8(0, static_cast<uint8_t>(ConfigIssueKind::None));
}

void test_every_kind_has_a_distinct_non_empty_string()
{
    const ConfigIssueKind all[] = {
        ConfigIssueKind::None, ConfigIssueKind::InvalidJson, ConfigIssueKind::WrongType,
        ConfigIssueKind::OutOfRange, ConfigIssueKind::InputOnlyPin,
        ConfigIssueKind::DuplicatePin, ConfigIssueKind::NewerVersion,
    };
    const size_t n = sizeof(all) / sizeof(all[0]);
    for (size_t i = 0; i < n; ++i)
    {
        const char* s = to_string(all[i]);
        TEST_ASSERT_NOT_NULL(s);
        TEST_ASSERT_TRUE(std::strlen(s) > 0);
        for (size_t j = 0; j < i; ++j)
            TEST_ASSERT_TRUE(std::strcmp(s, to_string(all[j])) != 0);
    }
}

void test_unknown_value_maps_to_unknown()
{
    TEST_ASSERT_EQUAL_STRING("Unknown", to_string(static_cast<ConfigIssueKind>(0xFF)));
}

// A fresh ParseResult must be "no issues, valid" so callers can rely on zero-init.
void test_parse_result_default_is_clean()
{
    ParseResult r{};
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
    TEST_ASSERT_EQUAL_UINT32(8, ParseResult::MAX_ISSUES);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_none_is_zero);
    RUN_TEST(test_every_kind_has_a_distinct_non_empty_string);
    RUN_TEST(test_unknown_value_maps_to_unknown);
    RUN_TEST(test_parse_result_default_is_clean);
    return UNITY_END();
}
```

- [ ] **Step 4: Run the test to verify it fails**

Run from `shared/vmaas-config`: `$PIO test -e native -f test_config_issue`

Expected: compile error, `config.h: No such file or directory`.

- [ ] **Step 5: Write `config.h`**

Create `shared/vmaas-config/src/config.h`:

```cpp
#pragma once
/**
 * @file config.h
 * @brief Device configuration schema for VMaaS controllers.
 *
 * A Config is plain data. The firmware builds one from its compile-time
 * defaults, and parse_config() (config_parser.h) merges /storage/config.json
 * over it. The library never logs; every problem is reported as a
 * ConfigIssue and the caller decides what to print.
 *
 * Schema version 1 (config.json):
 * @code
 * {
 *   "version": 1,
 *   "pins": { "uart_rx": 32, "uart_tx": 33, "i2c_sda": 21, "i2c_scl": 22 },
 *   "uart": { "baud_rate": 115200 },
 *   "i2c":  { "clock_hz": 100000 }
 * }
 * @endcode
 */
#include <cstddef>
#include <cstdint>

namespace vmaas
{
    /// Schema version this library understands. Files with a higher version parse with a NewerVersion issue.
    constexpr int CONFIG_SCHEMA_VERSION = 1;

    /// Effective device configuration. Every field has a firmware default.
    struct Config
    {
        struct Pins
        {
            int uart_rx; ///< GPIO receiving from Motorcontrol. Any GPIO 0-39.
            int uart_tx; ///< GPIO transmitting to Motorcontrol. Output-capable GPIO (0-33).
            int i2c_sda; ///< Grove-LCD SDA. Output-capable GPIO (0-33).
            int i2c_scl; ///< Grove-LCD SCL. Output-capable GPIO (0-33).
        } pins;

        struct Uart
        {
            int baud_rate; ///< bit/s towards Motorcontrol. Positive.
        } uart;

        struct I2c
        {
            uint32_t clock_hz; ///< SCL frequency for the Grove-LCD. Positive.
        } i2c;
    };

    /// What went wrong with one field, or with the file as a whole.
    enum class ConfigIssueKind : uint8_t
    {
        None = 0,     /// No issue (never stored; keeps 0 meaningful).
        InvalidJson,  /// The text is not valid JSON. Whole file ignored.
        WrongType,    /// Field present but not an integer number (or object where one is expected).
        OutOfRange,   /// Integer outside the allowed range (pin 0-39, positive baud/clock).
        InputOnlyPin, /// GPIO 34-39 used for an output role (uart_tx, i2c_sda, i2c_scl).
        DuplicatePin, /// Two pins resolve to the same GPIO on the merged result.
        NewerVersion, /// "version" is higher than CONFIG_SCHEMA_VERSION. Parsing continued.
    };

    /// One rejected field or file-level problem.
    struct ConfigIssue
    {
        ConfigIssueKind kind; ///< What went wrong.
        const char* field;    ///< Dotted path such as "pins.uart_tx"; "" for file-level issues. Static storage.
    };

    /// Output of parse_config(). Fixed size, no heap.
    struct ParseResult
    {
        static constexpr size_t MAX_ISSUES = 8; ///< One per field plus file-level. Excess issues are dropped.

        Config config;             ///< Defaults merged with every accepted field.
        bool json_valid;           ///< false means the text was not JSON and config equals the defaults.
        size_t json_error_offset;  ///< Byte offset cJSON reported when json_valid is false; 0 otherwise.
        size_t issue_count;        ///< Number of valid entries in issues.
        ConfigIssue issues[MAX_ISSUES];
    };

    /**
     * @brief Human-readable name of an issue kind.
     * @param kind Kind to name.
     * @return Static string such as "OutOfRange"; "Unknown" for values outside the enum.
     */
    const char* to_string(ConfigIssueKind kind);
}
```

- [ ] **Step 6: Write `config_issue.cpp`**

Create `shared/vmaas-config/src/config_issue.cpp`:

```cpp
#include "config.h"

namespace vmaas
{
    const char* to_string(ConfigIssueKind kind)
    {
        switch (kind)
        {
        case ConfigIssueKind::None:         return "None";
        case ConfigIssueKind::InvalidJson:  return "InvalidJson";
        case ConfigIssueKind::WrongType:    return "WrongType";
        case ConfigIssueKind::OutOfRange:   return "OutOfRange";
        case ConfigIssueKind::InputOnlyPin: return "InputOnlyPin";
        case ConfigIssueKind::DuplicatePin: return "DuplicatePin";
        case ConfigIssueKind::NewerVersion: return "NewerVersion";
        }
        return "Unknown";
    }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run from `shared/vmaas-config`: `$PIO test -e native -f test_config_issue`

Expected: `4 Tests 0 Failures 0 Ignored`. cJSON.c compiles as part of `test_build_src` even though nothing uses it yet; that proves the vendored file builds on the host.

- [ ] **Step 8: Verify**

Report the test summary line. Confirm `git status` shows `shared/vmaas-config/` as new, with `cJSON.c`/`cJSON.h` unmodified downloads. Do not commit.

---

### Task 3: `parse_config` merge behaviour

Merging only. Every accepted integer is taken as-is; range and pin rules come in Task 4. Keep the internal structure ready for Task 4: values are read into a `Candidate` table with a `from_file` flag, then copied into the result.

**Files:**
- Create: `shared/vmaas-config/src/config_parser.h`
- Create: `shared/vmaas-config/src/config_parser.cpp`
- Test: `shared/vmaas-config/test/test_parse/test_main.cpp`

**Interfaces:**
- Consumes: `Config`, `ParseResult`, `ConfigIssue`, `ConfigIssueKind`, `CONFIG_SCHEMA_VERSION` from Task 2.
- Produces: `vmaas::ParseResult parse_config(const char* json_text, const Config& defaults);` and the field name constants used in issues: `"version"`, `"pins"`, `"pins.uart_rx"`, `"pins.uart_tx"`, `"pins.i2c_sda"`, `"pins.i2c_scl"`, `"uart"`, `"uart.baud_rate"`, `"i2c"`, `"i2c.clock_hz"`.

- [ ] **Step 1: Write the failing tests**

Create `shared/vmaas-config/test/test_parse/test_main.cpp`:

```cpp
/**
 * @file test_main.cpp
 * @brief Host tests for parse_config() merge behaviour.
 *
 * The contract under test: the file only has to mention what differs from
 * the firmware defaults, a broken file never changes anything, and a field of
 * the wrong type is rejected on its own without dragging the rest down.
 */
#include <unity.h>
#include <cstring>
#include "config.h"
#include "config_parser.h"

using namespace vmaas;

namespace
{
    constexpr Config DEFAULTS = {
        {32, 33, 21, 22}, // pins: uart_rx, uart_tx, i2c_sda, i2c_scl
        {115200},         // uart.baud_rate
        {100000},         // i2c.clock_hz
    };

    bool same(const Config& a, const Config& b)
    {
        return a.pins.uart_rx == b.pins.uart_rx && a.pins.uart_tx == b.pins.uart_tx &&
               a.pins.i2c_sda == b.pins.i2c_sda && a.pins.i2c_scl == b.pins.i2c_scl &&
               a.uart.baud_rate == b.uart.baud_rate && a.i2c.clock_hz == b.i2c.clock_hz;
    }

    bool has_issue(const ParseResult& r, ConfigIssueKind kind, const char* field)
    {
        for (size_t i = 0; i < r.issue_count; ++i)
            if (r.issues[i].kind == kind && std::strcmp(r.issues[i].field, field) == 0)
                return true;
        return false;
    }
}

void setUp() {}
void tearDown() {}

// The minimal valid file changes nothing.
void test_empty_object_gives_defaults_and_no_issues()
{
    const ParseResult r = parse_config("{}", DEFAULTS);
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_TRUE(same(r.config, DEFAULTS));
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
}

// nullptr is treated like an unreadable file: defaults, one InvalidJson issue.
void test_nullptr_gives_defaults_with_invalid_json()
{
    const ParseResult r = parse_config(nullptr, DEFAULTS);
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_TRUE(same(r.config, DEFAULTS));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InvalidJson, ""));
}

// Only the mentioned field changes; siblings keep their defaults.
void test_partial_file_overrides_only_named_field()
{
    const ParseResult r = parse_config(R"({"pins": {"uart_rx": 16}})", DEFAULTS);
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_EQUAL_INT(16, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_INT(33, r.config.pins.uart_tx);
    TEST_ASSERT_EQUAL_INT(21, r.config.pins.i2c_sda);
    TEST_ASSERT_EQUAL_INT(22, r.config.pins.i2c_scl);
    TEST_ASSERT_EQUAL_INT(115200, r.config.uart.baud_rate);
    TEST_ASSERT_EQUAL_UINT32(100000, r.config.i2c.clock_hz);
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
}

// Every field can be set from the file.
void test_full_file_applies_all_fields()
{
    const char* json = R"({
        "version": 1,
        "pins": {"uart_rx": 16, "uart_tx": 17, "i2c_sda": 25, "i2c_scl": 26},
        "uart": {"baud_rate": 57600},
        "i2c": {"clock_hz": 400000}
    })";
    const ParseResult r = parse_config(json, DEFAULTS);
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_EQUAL_INT(16, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_INT(17, r.config.pins.uart_tx);
    TEST_ASSERT_EQUAL_INT(25, r.config.pins.i2c_sda);
    TEST_ASSERT_EQUAL_INT(26, r.config.pins.i2c_scl);
    TEST_ASSERT_EQUAL_INT(57600, r.config.uart.baud_rate);
    TEST_ASSERT_EQUAL_UINT32(400000, r.config.i2c.clock_hz);
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
}

// Broken JSON: nothing applied, the error offset points into the text.
void test_invalid_json_gives_defaults_and_offset()
{
    const char* json = R"({"pins": {"uart_rx": 16,)";
    const ParseResult r = parse_config(json, DEFAULTS);
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_TRUE(same(r.config, DEFAULTS));
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InvalidJson, ""));
    TEST_ASSERT_TRUE(r.json_error_offset > 0);
    TEST_ASSERT_TRUE(r.json_error_offset <= std::strlen(json));
}

// A top-level array is valid JSON but not a config object.
void test_non_object_root_is_invalid_json()
{
    const ParseResult r = parse_config("[1, 2, 3]", DEFAULTS);
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_TRUE(same(r.config, DEFAULTS));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InvalidJson, ""));
}

// A string where a number belongs: that field is rejected, the neighbour is applied.
void test_wrong_type_rejects_only_that_field()
{
    const ParseResult r = parse_config(R"({"pins": {"uart_rx": "32", "uart_tx": 17}})", DEFAULTS);
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_EQUAL_INT(32, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_INT(17, r.config.pins.uart_tx);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "pins.uart_rx"));
}

// A non-integer number is not a pin.
void test_fractional_number_is_wrong_type()
{
    const ParseResult r = parse_config(R"({"pins": {"uart_rx": 16.5}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(32, r.config.pins.uart_rx);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "pins.uart_rx"));
}

// A section that is not an object is rejected as one issue; its fields keep defaults.
void test_section_of_wrong_type_is_one_issue()
{
    const ParseResult r = parse_config(R"({"pins": 5, "uart": {"baud_rate": 9600}})", DEFAULTS);
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_TRUE(same(r.config, Config{{32, 33, 21, 22}, {9600}, {100000}}));
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "pins"));
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_empty_object_gives_defaults_and_no_issues);
    RUN_TEST(test_nullptr_gives_defaults_with_invalid_json);
    RUN_TEST(test_partial_file_overrides_only_named_field);
    RUN_TEST(test_full_file_applies_all_fields);
    RUN_TEST(test_invalid_json_gives_defaults_and_offset);
    RUN_TEST(test_non_object_root_is_invalid_json);
    RUN_TEST(test_wrong_type_rejects_only_that_field);
    RUN_TEST(test_fractional_number_is_wrong_type);
    RUN_TEST(test_section_of_wrong_type_is_one_issue);
    return UNITY_END();
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `shared/vmaas-config`: `$PIO test -e native -f test_parse`

Expected: compile error, `config_parser.h: No such file or directory`.

- [ ] **Step 3: Write `config_parser.h`**

Create `shared/vmaas-config/src/config_parser.h`:

```cpp
#pragma once
/**
 * @file config_parser.h
 * @brief Merge a config.json text over firmware defaults.
 */
#include "config.h"

namespace vmaas
{
    /**
     * @brief Parse @p json_text and merge accepted fields over @p defaults.
     *
     * - Every field is optional; absent fields keep their default.
     * - Unknown keys are ignored.
     * - A field that is not an integer, out of range, an input-only GPIO in an
     *   output role, or a duplicate of another pin is rejected on its own: the
     *   default is used for that field and one ConfigIssue is recorded.
     * - Invalid JSON (or a nullptr, or a non-object root) yields the defaults
     *   unchanged, json_valid == false and one InvalidJson issue.
     *
     * Allocation happens only inside cJSON while parsing; the result is plain data.
     *
     * @param json_text NUL-terminated JSON text, or nullptr.
     * @param defaults Firmware defaults, normally built from pins.h/config.h.
     * @return Effective config plus issues. Never fails.
     */
    ParseResult parse_config(const char* json_text, const Config& defaults);
}
```

- [ ] **Step 4: Write `config_parser.cpp` (merge only)**

Create `shared/vmaas-config/src/config_parser.cpp`:

```cpp
#include "config_parser.h"

#include <climits>
#include <cstring>
#include "cJSON.h"

namespace vmaas
{
    namespace
    {
        // Field names used in issues. Static storage so ConfigIssue::field can point at them.
        constexpr const char* F_VERSION   = "version";
        constexpr const char* F_PINS      = "pins";
        constexpr const char* F_UART_RX   = "pins.uart_rx";
        constexpr const char* F_UART_TX   = "pins.uart_tx";
        constexpr const char* F_I2C_SDA   = "pins.i2c_sda";
        constexpr const char* F_I2C_SCL   = "pins.i2c_scl";
        constexpr const char* F_UART      = "uart";
        constexpr const char* F_BAUD      = "uart.baud_rate";
        constexpr const char* F_I2C       = "i2c";
        constexpr const char* F_CLOCK     = "i2c.clock_hz";

        void add_issue(ParseResult& r, ConfigIssueKind kind, const char* field)
        {
            if (r.issue_count < ParseResult::MAX_ISSUES)
                r.issues[r.issue_count++] = ConfigIssue{kind, field};
        }

        // One integer field read from the file. Holds a 64-bit value so range checks
        // (Task 4) can see values that do not fit the destination type.
        struct Candidate
        {
            long long value;
            bool from_file;
        };

        // Reads parent[key] as an integer. Absent: candidate untouched. Present but not an
        // integer number: WrongType issue, candidate untouched.
        void read_int(const cJSON* parent, const char* key, const char* field,
                      Candidate& out, ParseResult& r)
        {
            if (parent == nullptr)
                return;
            const cJSON* item = cJSON_GetObjectItemCaseSensitive(parent, key);
            if (item == nullptr)
                return;
            if (!cJSON_IsNumber(item))
            {
                add_issue(r, ConfigIssueKind::WrongType, field);
                return;
            }
            const double d = cJSON_GetNumberValue(item);
            // Range check before the cast: converting an out-of-range double to
            // long long is undefined behaviour. 2^62 keeps the cast well inside.
            constexpr double LIMIT = 4611686018427387904.0; // 2^62
            if (d != d || d > LIMIT || d < -LIMIT ||
                d != static_cast<double>(static_cast<long long>(d)))
            {
                add_issue(r, ConfigIssueKind::WrongType, field);
                return;
            }
            out.value = static_cast<long long>(d);
            out.from_file = true;
        }

        // Returns root[key] if it is an object; nullptr if absent; nullptr plus a
        // WrongType issue if present with another type.
        const cJSON* read_section(const cJSON* root, const char* key, const char* field, ParseResult& r)
        {
            const cJSON* item = cJSON_GetObjectItemCaseSensitive(root, key);
            if (item == nullptr)
                return nullptr;
            if (!cJSON_IsObject(item))
            {
                add_issue(r, ConfigIssueKind::WrongType, field);
                return nullptr;
            }
            return item;
        }

        ParseResult invalid(const Config& defaults, size_t error_offset)
        {
            ParseResult r{};
            r.config = defaults;
            r.json_valid = false;
            r.json_error_offset = error_offset;
            add_issue(r, ConfigIssueKind::InvalidJson, "");
            return r;
        }
    }

    ParseResult parse_config(const char* json_text, const Config& defaults)
    {
        if (json_text == nullptr)
            return invalid(defaults, 0);

        cJSON* root = cJSON_Parse(json_text);
        if (root == nullptr)
        {
            const char* err = cJSON_GetErrorPtr();
            const size_t offset = (err != nullptr && err >= json_text) ? static_cast<size_t>(err - json_text) : 0;
            return invalid(defaults, offset);
        }
        if (!cJSON_IsObject(root))
        {
            cJSON_Delete(root);
            return invalid(defaults, 0);
        }

        ParseResult r{};
        r.config = defaults;
        r.json_valid = true;

        Candidate version  = {CONFIG_SCHEMA_VERSION, false};
        Candidate uart_rx  = {defaults.pins.uart_rx, false};
        Candidate uart_tx  = {defaults.pins.uart_tx, false};
        Candidate i2c_sda  = {defaults.pins.i2c_sda, false};
        Candidate i2c_scl  = {defaults.pins.i2c_scl, false};
        Candidate baud     = {defaults.uart.baud_rate, false};
        Candidate clock_hz = {static_cast<long long>(defaults.i2c.clock_hz), false};

        read_int(root, "version", F_VERSION, version, r);

        const cJSON* pins = read_section(root, "pins", F_PINS, r);
        read_int(pins, "uart_rx", F_UART_RX, uart_rx, r);
        read_int(pins, "uart_tx", F_UART_TX, uart_tx, r);
        read_int(pins, "i2c_sda", F_I2C_SDA, i2c_sda, r);
        read_int(pins, "i2c_scl", F_I2C_SCL, i2c_scl, r);

        const cJSON* uart = read_section(root, "uart", F_UART, r);
        read_int(uart, "baud_rate", F_BAUD, baud, r);

        const cJSON* i2c = read_section(root, "i2c", F_I2C, r);
        read_int(i2c, "clock_hz", F_CLOCK, clock_hz, r);

        cJSON_Delete(root);

        // Task 4 inserts validation here, between reading and applying.

        r.config.pins.uart_rx   = static_cast<int>(uart_rx.value);
        r.config.pins.uart_tx   = static_cast<int>(uart_tx.value);
        r.config.pins.i2c_sda   = static_cast<int>(i2c_sda.value);
        r.config.pins.i2c_scl   = static_cast<int>(i2c_scl.value);
        r.config.uart.baud_rate = static_cast<int>(baud.value);
        r.config.i2c.clock_hz   = static_cast<uint32_t>(clock_hz.value);
        return r;
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run from `shared/vmaas-config`: `$PIO test -e native -f test_parse`

Expected: `9 Tests 0 Failures 0 Ignored`.

- [ ] **Step 6: Run the whole suite**

Run from `shared/vmaas-config`: `$PIO test -e native`

Expected: both test folders pass, 13 tests total.

- [ ] **Step 7: Verify**

Report the two summary lines. Do not commit.

---

### Task 4: Validation: ranges, input-only pins, duplicates, version, unknown keys

**Files:**
- Modify: `shared/vmaas-config/src/config_parser.cpp` (the marked spot between reading and applying)
- Test: `shared/vmaas-config/test/test_validate/test_main.cpp`

**Interfaces:**
- Consumes: everything from Tasks 2 and 3. No new public names.

**OWNER DECISION (implement the default, flag it in the report):** when two pins collide, the default rejects the later field in the order `uart_rx, uart_tx, i2c_sda, i2c_scl` that came from the file, and keeps the earlier one. Alternative: reject both file-provided fields. The default keeps as much of the file as possible; the alternative is stricter and never lets one file field silently win over another.

- [ ] **Step 1: Write the failing tests**

Create `shared/vmaas-config/test/test_validate/test_main.cpp`:

```cpp
/**
 * @file test_main.cpp
 * @brief Host tests for parse_config() validation rules.
 *
 * Every rule that can make a pin assignment physically wrong on the ESP32 is
 * checked here: GPIO range, input-only pins in output roles, two roles on one
 * pin, and non-positive bus speeds. Also the forward-compatibility rules:
 * unknown keys and a newer schema version must not break parsing.
 */
#include <unity.h>
#include <cstring>
#include "config.h"
#include "config_parser.h"

using namespace vmaas;

namespace
{
    constexpr Config DEFAULTS = {{32, 33, 21, 22}, {115200}, {100000}};

    bool has_issue(const ParseResult& r, ConfigIssueKind kind, const char* field)
    {
        for (size_t i = 0; i < r.issue_count; ++i)
            if (r.issues[i].kind == kind && std::strcmp(r.issues[i].field, field) == 0)
                return true;
        return false;
    }
}

void setUp() {}
void tearDown() {}

void test_pin_above_39_is_out_of_range()
{
    const ParseResult r = parse_config(R"({"pins": {"uart_rx": 40}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(32, r.config.pins.uart_rx);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "pins.uart_rx"));
}

void test_negative_pin_is_out_of_range()
{
    const ParseResult r = parse_config(R"({"pins": {"i2c_scl": -1}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(22, r.config.pins.i2c_scl);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "pins.i2c_scl"));
}

void test_boundary_pins_0_and_39_are_accepted_for_rx()
{
    const ParseResult a = parse_config(R"({"pins": {"uart_rx": 0}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(0, a.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_UINT32(0, a.issue_count);
    const ParseResult b = parse_config(R"({"pins": {"uart_rx": 39}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(39, b.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_UINT32(0, b.issue_count);
}

// GPIO 34-39 have no output driver on the ESP32.
void test_input_only_pin_rejected_for_output_roles()
{
    const ParseResult r = parse_config(
        R"({"pins": {"uart_tx": 34, "i2c_sda": 36, "i2c_scl": 39}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(33, r.config.pins.uart_tx);
    TEST_ASSERT_EQUAL_INT(21, r.config.pins.i2c_sda);
    TEST_ASSERT_EQUAL_INT(22, r.config.pins.i2c_scl);
    TEST_ASSERT_EQUAL_UINT32(3, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InputOnlyPin, "pins.uart_tx"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InputOnlyPin, "pins.i2c_sda"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InputOnlyPin, "pins.i2c_scl"));
}

void test_pin_33_is_still_an_output_pin()
{
    const ParseResult r = parse_config(R"({"pins": {"i2c_sda": 33, "uart_tx": 25}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(33, r.config.pins.i2c_sda);
    TEST_ASSERT_EQUAL_INT(25, r.config.pins.uart_tx);
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
}

// Two file fields on one GPIO: the later one (in uart_rx, uart_tx, i2c_sda, i2c_scl order) loses.
void test_duplicate_between_two_file_fields_rejects_the_later_one()
{
    const ParseResult r = parse_config(R"({"pins": {"uart_rx": 16, "uart_tx": 16}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(16, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_INT(33, r.config.pins.uart_tx);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::DuplicatePin, "pins.uart_tx"));
}

// A file field colliding with a default: the file field loses, whatever its order.
void test_duplicate_with_a_default_rejects_the_file_field()
{
    const ParseResult r = parse_config(R"({"pins": {"uart_rx": 21}})", DEFAULTS); // 21 is default i2c_sda
    TEST_ASSERT_EQUAL_INT(32, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_INT(21, r.config.pins.i2c_sda);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::DuplicatePin, "pins.uart_rx"));
}

// Moving a default out of the way in the same file is fine.
void test_swapping_two_pins_in_one_file_is_accepted()
{
    const ParseResult r = parse_config(R"({"pins": {"uart_rx": 33, "uart_tx": 32}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(33, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_INT(32, r.config.pins.uart_tx);
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
}

// A rejected pin falls back to its default, and that default takes part in the duplicate check.
void test_rejected_pin_reverts_before_duplicate_check()
{
    // uart_tx 40 is out of range -> reverts to 33. uart_rx 33 then collides with it and loses.
    const ParseResult r = parse_config(R"({"pins": {"uart_rx": 33, "uart_tx": 40}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(32, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_INT(33, r.config.pins.uart_tx);
    TEST_ASSERT_EQUAL_UINT32(2, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "pins.uart_tx"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::DuplicatePin, "pins.uart_rx"));
}

// A revert can create a new collision with a pair already checked; the scan must catch it.
void test_duplicate_cascade_after_revert()
{
    // uart_tx 21 collides with default i2c_sda 21 -> uart_tx reverts to 33.
    // Now uart_rx 33 (file) collides with uart_tx 33 (default) -> uart_rx reverts to 32.
    const ParseResult r = parse_config(R"({"pins": {"uart_rx": 33, "uart_tx": 21}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(32, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_INT(33, r.config.pins.uart_tx);
    TEST_ASSERT_EQUAL_INT(21, r.config.pins.i2c_sda);
    TEST_ASSERT_EQUAL_UINT32(2, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::DuplicatePin, "pins.uart_tx"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::DuplicatePin, "pins.uart_rx"));
}

void test_non_positive_baud_and_clock_are_out_of_range()
{
    const ParseResult r = parse_config(R"({"uart": {"baud_rate": 0}, "i2c": {"clock_hz": -5}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(115200, r.config.uart.baud_rate);
    TEST_ASSERT_EQUAL_UINT32(100000, r.config.i2c.clock_hz);
    TEST_ASSERT_EQUAL_UINT32(2, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "uart.baud_rate"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "i2c.clock_hz"));
}

void test_values_too_large_for_destination_are_out_of_range()
{
    const ParseResult r = parse_config(
        R"({"uart": {"baud_rate": 3000000000}, "i2c": {"clock_hz": 5000000000}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(115200, r.config.uart.baud_rate);
    TEST_ASSERT_EQUAL_UINT32(100000, r.config.i2c.clock_hz);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "uart.baud_rate"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "i2c.clock_hz"));
}

// Forward compatibility: keys we do not know are not errors.
void test_unknown_keys_are_ignored_everywhere()
{
    const char* json = R"({
        "version": 1,
        "wifi": {"ssid": "x"},
        "pins": {"uart_rx": 16, "spare": 5},
        "uart": {"baud_rate": 9600, "parity": "none"}
    })";
    const ParseResult r = parse_config(json, DEFAULTS);
    TEST_ASSERT_EQUAL_INT(16, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_INT(9600, r.config.uart.baud_rate);
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
}

// A file from a newer firmware still applies; the caller gets a hint.
void test_newer_version_is_flagged_but_applied()
{
    const ParseResult r = parse_config(R"({"version": 2, "pins": {"uart_rx": 16}})", DEFAULTS);
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_EQUAL_INT(16, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::NewerVersion, "version"));
}

void test_current_and_older_version_give_no_issue()
{
    TEST_ASSERT_EQUAL_UINT32(0, parse_config(R"({"version": 1})", DEFAULTS).issue_count);
    TEST_ASSERT_EQUAL_UINT32(0, parse_config(R"({"version": 0})", DEFAULTS).issue_count);
}

void test_non_numeric_version_is_wrong_type()
{
    const ParseResult r = parse_config(R"({"version": "1"})", DEFAULTS);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "version"));
}

// More problems than slots: the count saturates instead of overflowing.
void test_issue_list_saturates_at_max()
{
    const char* json = R"({
        "version": "x",
        "pins": {"uart_rx": "a", "uart_tx": "b", "i2c_sda": "c", "i2c_scl": "d"},
        "uart": {"baud_rate": "e"},
        "i2c": {"clock_hz": "f"}
    })";
    const ParseResult r = parse_config(json, DEFAULTS);
    TEST_ASSERT_TRUE(r.issue_count <= ParseResult::MAX_ISSUES);
    TEST_ASSERT_EQUAL_UINT32(7, r.issue_count);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_pin_above_39_is_out_of_range);
    RUN_TEST(test_negative_pin_is_out_of_range);
    RUN_TEST(test_boundary_pins_0_and_39_are_accepted_for_rx);
    RUN_TEST(test_input_only_pin_rejected_for_output_roles);
    RUN_TEST(test_pin_33_is_still_an_output_pin);
    RUN_TEST(test_duplicate_between_two_file_fields_rejects_the_later_one);
    RUN_TEST(test_duplicate_with_a_default_rejects_the_file_field);
    RUN_TEST(test_swapping_two_pins_in_one_file_is_accepted);
    RUN_TEST(test_rejected_pin_reverts_before_duplicate_check);
    RUN_TEST(test_duplicate_cascade_after_revert);
    RUN_TEST(test_non_positive_baud_and_clock_are_out_of_range);
    RUN_TEST(test_values_too_large_for_destination_are_out_of_range);
    RUN_TEST(test_unknown_keys_are_ignored_everywhere);
    RUN_TEST(test_newer_version_is_flagged_but_applied);
    RUN_TEST(test_current_and_older_version_give_no_issue);
    RUN_TEST(test_non_numeric_version_is_wrong_type);
    RUN_TEST(test_issue_list_saturates_at_max);
    return UNITY_END();
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `shared/vmaas-config`: `$PIO test -e native -f test_validate`

Expected: compiles, several failures (out-of-range values are currently applied as-is, no DuplicatePin/NewerVersion issues).

- [ ] **Step 3: Add validation to `config_parser.cpp`**

In the anonymous namespace, after `read_section`, add:

```cpp
        constexpr long long GPIO_MIN = 0;
        constexpr long long GPIO_MAX = 39;
        constexpr long long INPUT_ONLY_MIN = 34; // GPIO 34-39 have no output driver on the ESP32.

        // Rejects a pin candidate that is outside 0-39, or input-only in an output role.
        // A rejected candidate reverts to its default so it still takes part in the duplicate check.
        void validate_pin(Candidate& c, long long default_value, bool output_role,
                          const char* field, ParseResult& r)
        {
            if (!c.from_file)
                return;
            if (c.value < GPIO_MIN || c.value > GPIO_MAX)
                add_issue(r, ConfigIssueKind::OutOfRange, field);
            else if (output_role && c.value >= INPUT_ONLY_MIN)
                add_issue(r, ConfigIssueKind::InputOnlyPin, field);
            else
                return;
            c.value = default_value;
            c.from_file = false;
        }

        // Rejects a positive-integer candidate outside 1..max.
        void validate_positive(Candidate& c, long long default_value, long long max,
                               const char* field, ParseResult& r)
        {
            if (!c.from_file)
                return;
            if (c.value < 1 || c.value > max)
            {
                add_issue(r, ConfigIssueKind::OutOfRange, field);
                c.value = default_value;
                c.from_file = false;
            }
        }

        // OWNER DECISION default: on a collision the later file-provided field loses.
        // Order is uart_rx, uart_tx, i2c_sda, i2c_scl. A default never loses to a file value.
        // A reverted pin gets its default back, which may collide with a pair already
        // checked, so the scan restarts after every revert. Each revert clears one
        // from_file flag, so it runs at most five passes.
        void reject_duplicates(Candidate* pins[4], const long long defaults[4],
                               const char* fields[4], ParseResult& r)
        {
            bool changed = true;
            while (changed)
            {
                changed = false;
                for (int j = 1; j < 4 && !changed; ++j)
                {
                    for (int i = 0; i < j && !changed; ++i)
                    {
                        if (pins[i]->value != pins[j]->value)
                            continue;
                        int loser = -1;
                        if (pins[j]->from_file)
                            loser = j;
                        else if (pins[i]->from_file)
                            loser = i;
                        if (loser < 0)
                            continue; // two defaults colliding is a firmware bug, not a file issue
                        add_issue(r, ConfigIssueKind::DuplicatePin, fields[loser]);
                        pins[loser]->value = defaults[loser];
                        pins[loser]->from_file = false;
                        changed = true;
                    }
                }
            }
        }
```

Then replace the comment line `// Task 4 inserts validation here, between reading and applying.` in `parse_config` with:

```cpp
        if (version.from_file && version.value > CONFIG_SCHEMA_VERSION)
            add_issue(r, ConfigIssueKind::NewerVersion, F_VERSION);

        validate_pin(uart_rx, defaults.pins.uart_rx, false, F_UART_RX, r);
        validate_pin(uart_tx, defaults.pins.uart_tx, true,  F_UART_TX, r);
        validate_pin(i2c_sda, defaults.pins.i2c_sda, true,  F_I2C_SDA, r);
        validate_pin(i2c_scl, defaults.pins.i2c_scl, true,  F_I2C_SCL, r);

        Candidate* pin_table[4] = {&uart_rx, &uart_tx, &i2c_sda, &i2c_scl};
        const long long pin_defaults[4] = {defaults.pins.uart_rx, defaults.pins.uart_tx,
                                           defaults.pins.i2c_sda, defaults.pins.i2c_scl};
        const char* pin_fields[4] = {F_UART_RX, F_UART_TX, F_I2C_SDA, F_I2C_SCL};
        reject_duplicates(pin_table, pin_defaults, pin_fields, r);

        validate_positive(baud, defaults.uart.baud_rate, INT_MAX, F_BAUD, r);
        validate_positive(clock_hz, static_cast<long long>(defaults.i2c.clock_hz), UINT32_MAX, F_CLOCK, r);
```

Note on `reject_duplicates` and the "rejected pin reverts" test: after `uart_tx` 40 reverts to default 33 with `from_file == false`, the pair (uart_rx=33 from file, uart_tx=33 default) makes `uart_rx` the loser because a default never loses. That is the intended behaviour.

- [ ] **Step 4: Run the tests to verify they pass**

Run from `shared/vmaas-config`: `$PIO test -e native -f test_validate`

Expected: `17 Tests 0 Failures 0 Ignored`.

- [ ] **Step 5: Run the whole suite**

Run from `shared/vmaas-config`: `$PIO test -e native`

Expected: three folders pass, 30 tests total, no compiler warnings from `-Wall -Wextra` in `config_parser.cpp`.

- [ ] **Step 6: Verify**

Report the summary lines and state that the OWNER DECISION default (later file field loses) was implemented. Do not commit.

---

### Task 5: Main-Controller integration: `defaults.h`, `load_config`, ports built from config

**Files:**
- Create: `Main-Controller/src/defaults.h`
- Modify: `Main-Controller/src/config_store.h`, `Main-Controller/src/config_store.cpp` (add `load_config`)
- Modify: `Main-Controller/src/main.cpp` (remove Task 1 spike block, move globals into `app_main`)

**Interfaces:**
- Consumes: `vmaas::Config`, `vmaas::ParseResult`, `vmaas::parse_config`, `vmaas::to_string(ConfigIssueKind)` from Tasks 2–4; `config_store::mount_storage`, `read_text_file`, `CONFIG_PATH` from Task 1; `vmaas::UartBus(uart_port_t, int tx, int rx, int baud)` from `shared/vmaas-protocol/src/uart_bus.h`; `vmaas::EspI2cPort(i2c_port_num_t, int sda, int scl, uint32_t hz)` from `shared/vmaas-display/src/esp_i2c_port.h`; `MotorClient(vmaas::UartBus&)`; `vmaas::GroveLcdRgb(LcdPort&)`.
- Produces: `constexpr vmaas::Config DEFAULTS` in `defaults.h`; `vmaas::Config config_store::load_config(const vmaas::Config& defaults)`.

- [ ] **Step 1: Rename the firmware `config.h` to `settings.h`**

The shared library's public header is also called `config.h`, and `Main-Controller/src` comes first in the include search order, so `#include "config.h"` from firmware would never reach the library. Rename the firmware file; its content and the `Config` namespace stay as they are.

Run from the repository root:

```bash
git mv Main-Controller/src/config.h Main-Controller/src/settings.h
```

Then in `Main-Controller/src/settings.h` change the Doxygen line `@file config.h` to `@file settings.h`. `main.cpp` stops including it directly in Step 4 (it comes in through `defaults.h`).

- [ ] **Step 2: Write `defaults.h`**

Create `Main-Controller/src/defaults.h`:

```cpp
#pragma once
/**
 * @file defaults.h
 * @brief Factory configuration of the Main-Controller as a vmaas::Config.
 *
 * The values come from pins.h and settings.h, which stay the single source of
 * the numbers. /storage/config.json overrides individual fields at boot.
 */
#include "config.h"    // vmaas::Config (shared/vmaas-config)
#include "pins.h"
#include "settings.h"  // Config::baud_rate, Config::i2c_clock_hz

/// Configuration used when config.json is missing, unreadable, or for every field it does not set.
constexpr vmaas::Config DEFAULTS = {
    {Pins::UART_RX, Pins::UART_TX, Pins::I2C_SDA, Pins::I2C_SCL},
    {Config::baud_rate},
    {Config::i2c_clock_hz},
};
```

- [ ] **Step 3: Add `load_config` to `config_store`**

Append to `Main-Controller/src/config_store.h` inside `namespace config_store`, after `read_text_file` (and add `#include "config.h"` at the top for `vmaas::Config`):

```cpp
    /// Largest config.json accepted, in bytes including the NUL. Bigger files are ignored with a warning.
    constexpr size_t MAX_CONFIG_BYTES = 2048;

    /**
     * @brief Read, parse and log the device configuration.
     *
     * Reads CONFIG_PATH, merges it over @p defaults with vmaas::parse_config(),
     * logs one warning per issue and the effective configuration at INFO level.
     * The device always gets a usable Config back: on any failure the defaults.
     *
     * @param defaults Factory values (see defaults.h).
     * @return Effective configuration.
     */
    vmaas::Config load_config(const vmaas::Config& defaults);
```

Append to `Main-Controller/src/config_store.cpp` inside `namespace config_store` (and add `#include "config_parser.h"` at the top):

```cpp
    namespace
    {
        void log_effective(const vmaas::Config& c)
        {
            ESP_LOGI(TAG, "effective config: uart rx=%d tx=%d baud=%d | i2c sda=%d scl=%d clock=%lu Hz",
                     c.pins.uart_rx, c.pins.uart_tx, c.uart.baud_rate,
                     c.pins.i2c_sda, c.pins.i2c_scl, (unsigned long)c.i2c.clock_hz);
        }
    }

    vmaas::Config load_config(const vmaas::Config& defaults)
    {
        static char text[MAX_CONFIG_BYTES];
        const int n = read_text_file(CONFIG_PATH, text, sizeof(text));
        if (n == -1)
        {
            ESP_LOGW(TAG, "%s not found, using defaults", CONFIG_PATH);
            log_effective(defaults);
            return defaults;
        }
        if (n == -2)
        {
            ESP_LOGW(TAG, "%s larger than %u bytes, using defaults", CONFIG_PATH, (unsigned)(MAX_CONFIG_BYTES - 1));
            log_effective(defaults);
            return defaults;
        }

        const vmaas::ParseResult r = vmaas::parse_config(text, defaults);
        if (!r.json_valid)
            ESP_LOGW(TAG, "%s: invalid JSON near byte %u, using defaults", CONFIG_PATH, (unsigned)r.json_error_offset);
        for (size_t i = 0; i < r.issue_count; ++i)
        {
            if (r.issues[i].kind == vmaas::ConfigIssueKind::InvalidJson)
                continue; // already logged with the offset
            ESP_LOGW(TAG, "%s: %s rejected (%s), using default", CONFIG_PATH,
                     r.issues[i].field, vmaas::to_string(r.issues[i].kind));
        }
        ESP_LOGI(TAG, "%s: %d bytes, %u issue(s)", CONFIG_PATH, n, (unsigned)r.issue_count);
        log_effective(r.config);
        return r.config;
    }
```

- [ ] **Step 4: Rewrite `main.cpp` to build ports from the loaded config**

Replace `Main-Controller/src/main.cpp` with:

```cpp
// Main-Controller: smoke test for the UART command protocol and the Grove-LCD.
// Loads /storage/config.json (pins, bus speeds) over the factory defaults,
// then sends RUN 1 every 2 seconds, logs every reply from Motorcontrol, shows
// a static and a scrolling line on the display and cycles the backlight.
// See shared/vmaas-protocol/PROTOCOL.md, shared/vmaas-display/README.md and
// shared/vmaas-config/README.md.
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "defaults.h"
#include "config_store.h"
#include "motor_client.h"
#include "uart_bus.h"
#include "esp_i2c_port.h"
#include "grove_lcd_rgb.h"

namespace
{
    constexpr const char* TAG = "MainController";
    constexpr uint8_t SMOKE_TEST_SLOT = 1;
    constexpr TickType_t SMOKE_TEST_INTERVAL = pdMS_TO_TICKS(2000);

    struct Rgb { uint8_t r, g, b; };
    constexpr Rgb BACKLIGHT_CYCLE[] = {
        {255, 0, 0}, {0, 255, 0}, {0, 0, 255}, {255, 255, 255},
    };
    constexpr size_t BACKLIGHT_COUNT = sizeof(BACKLIGHT_CYCLE) / sizeof(BACKLIGHT_CYCLE[0]);

    uint32_t now_ms()
    {
        return static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS);
    }

    void log_lcd(const char* what, vmaas::LcdError err)
    {
        if (err != vmaas::LcdError::None)
            ESP_LOGW(TAG, "display %s: %s", what, vmaas::to_string(err));
    }
}

extern "C" void app_main()
{
    // Config first: everything below is built from it.
    config_store::mount_storage(); // failure is logged; load_config then reports "not found"
    const vmaas::Config cfg = config_store::load_config(DEFAULTS);

    // These live for the whole run: app_main never returns (loop below), and
    // MotorClient/GroveLcdRgb hold references to bus/i2c.
    vmaas::UartBus bus(UART_NUM_1, cfg.pins.uart_tx, cfg.pins.uart_rx, cfg.uart.baud_rate);
    MotorClient motor(bus);
    vmaas::EspI2cPort i2c(I2C_NUM_0, cfg.pins.i2c_sda, cfg.pins.i2c_scl, cfg.i2c.clock_hz);
    vmaas::GroveLcdRgb lcd(i2c);

    bus.begin();
    motor.begin();

    i2c.begin();
    const vmaas::LcdError lcd_err = lcd.begin();
    const bool display_ok = lcd.ready();
    const bool backlight_ok = (lcd_err == vmaas::LcdError::None);
    if (!display_ok)
        ESP_LOGE(TAG, "display init failed: %s, continuing without display",
                 vmaas::to_string(lcd_err));
    else if (!backlight_ok)
        ESP_LOGW(TAG, "display: backlight unavailable (%s), text only",
                 vmaas::to_string(lcd_err));

    if (display_ok)
    {
        log_lcd("row 0", lcd.print_at(0, 0, "VMaaS"));
        log_lcd("row 1", lcd.print_at(0, 1, "Display smoke test - UART link to Motorcontrol",
                                      vmaas::Overflow::Scroll));
    }

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
    size_t colour_index = 0;
    while (true)
    {
        bus.poll(pdMS_TO_TICKS(50));

        if (display_ok)
            lcd.tick(now_ms());

        const TickType_t now = xTaskGetTickCount();
        if (static_cast<TickType_t>(now - last_send) >= SMOKE_TEST_INTERVAL)
        {
            last_send = now;
            if (bus.dropped_frames() > 0)
                ESP_LOGW(TAG, "dropped frames so far: %lu", (unsigned long)bus.dropped_frames());
            if (motor.run(SMOKE_TEST_SLOT))
                ESP_LOGI(TAG, "sent RUN %u", SMOKE_TEST_SLOT);

            if (backlight_ok)
            {
                const Rgb& c = BACKLIGHT_CYCLE[colour_index];
                log_lcd("set_rgb", lcd.set_rgb(c.r, c.g, c.b));
                colour_index = (colour_index + 1) % BACKLIGHT_COUNT;
            }
        }
    }
}
```

The only behavioural change from the previous `main.cpp` is where `bus`, `motor`, `i2c`, `lcd` are constructed and which numbers they get. The smoke test loop is unchanged.

- [ ] **Step 5: Build**

Run from `Main-Controller`: `$PIO run -e main-controller`

Expected: `SUCCESS`. The LDF picks up `vmaas-config` from `lib_extra_dirs = ../shared` (a `Dependency Graph` line lists `vmaas-config`). If `config.h` resolves to the wrong file, the `settings.h` rename in Step 1 was missed. If `cJSON.c` fails to compile inside ESP-IDF, report the exact error; do not patch the vendored file.

- [ ] **Step 6: Flash and check the boot log**

Run from `Main-Controller` (the `data/config.json` from Task 1 is still on the device):

```bash
$PIO run -e main-controller -t upload
$PY tools/capture_serial.py COM6 8
```

Expected lines, in order:

```
I (...) ConfigStore: mounted /storage: ...
I (...) ConfigStore: /storage/config.json: <n> bytes, 0 issue(s)
I (...) ConfigStore: effective config: uart rx=32 tx=33 baud=115200 | i2c sda=21 scl=22 clock=100000 Hz
```

then the normal `sent RUN 1` / `ACK` lines if Motorcontrol on COM7 is running, and the display lines if the LCD is wired.

- [ ] **Step 7: Verify**

Report the three ConfigStore lines and confirm the UART smoke test still exchanges frames (or state that Motorcontrol was not running). Confirm `git status` shows `config.h -> settings.h` as a rename. Do not commit.

---

### Task 6: Hardware verification of the fallback paths, docs and Doxygen

**Files:**
- Create: `shared/vmaas-config/README.md`
- Modify: `Doxyfile` (add `shared/vmaas-config/src`, exclude cJSON)
- Temporary edits to `Main-Controller/data/config.json` (restored at the end)

**Interfaces:**
- Consumes: everything. Produces nothing new.

- [ ] **Step 1: Swapped pins must show in the log and break the link**

Edit `Main-Controller/data/config.json`: set `"uart_rx": 33, "uart_tx": 32`. Run from `Main-Controller`:

```bash
$PIO run -e main-controller -t uploadfs
$PY tools/capture_serial.py COM6 10
```

Expected: `effective config: uart rx=33 tx=32 ...`, `0 issue(s)`, and no `ACK` lines for the `sent RUN 1` messages (Motorcontrol on COM7 must be running for this to be meaningful). If ACKs still arrive, the ports are not built from the config; go back to Task 5.

- [ ] **Step 2: Invalid field must be rejected individually**

Edit `data/config.json`: `"uart_rx": 32, "uart_tx": 40, "i2c_sda": "21"`. `uploadfs`, capture.

Expected:

```
W (...) ConfigStore: /storage/config.json: pins.uart_tx rejected (OutOfRange), using default
W (...) ConfigStore: /storage/config.json: pins.i2c_sda rejected (WrongType), using default
I (...) ConfigStore: /storage/config.json: <n> bytes, 2 issue(s)
I (...) ConfigStore: effective config: uart rx=32 tx=33 baud=115200 | i2c sda=21 scl=22 clock=100000 Hz
```

and the UART link works again (ACKs).

- [ ] **Step 3: Broken JSON must fall back to defaults**

Edit `data/config.json` to contain exactly `{"pins": {"uart_rx": 32,` (no closing braces). `uploadfs`, capture.

Expected: `invalid JSON near byte <k>, using defaults`, `1 issue(s)`, effective config equals defaults, UART link works.

- [ ] **Step 4: Missing file must fall back to defaults**

Temporarily move `data/config.json` out of the way (`git mv` is not needed; move it to the scratchpad or rename to `config.json.bak` outside `data/`), so `data/` is empty. `uploadfs`, capture.

Expected: `mounted /storage`, `/storage/config.json not found, using defaults`, effective config equals defaults, normal boot.

If `buildfs` refuses an empty directory, create `data/.keep` for this step and remove it afterwards.

- [ ] **Step 5: Restore the default file**

Put `data/config.json` back with the exact content from Task 1 Step 5. `uploadfs`, capture, confirm `0 issue(s)` and default values. `git status` must show `data/config.json` unmodified relative to Task 1.

- [ ] **Step 6: Write the library README**

Create `shared/vmaas-config/README.md`:

````markdown
# vmaas-config

Device configuration schema and JSON parser for VMaaS controllers. Pure C/C++
core (vendored cJSON 1.7.18, MIT), no ESP-IDF dependency, host tests on
PlatformIO `native`. Used by Main-Controller to read `/storage/config.json`
from its LittleFS partition at boot.

## Rules

- Every field is optional. What the file does not set keeps the firmware
  default (`Main-Controller/src/pins.h`, `settings.h`).
- Unknown keys are ignored, so the file can grow before the firmware does.
- An invalid field is rejected on its own with one issue; the rest applies.
- Invalid JSON, a non-object root or a missing file give the defaults.
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
| `version`        | integer | Higher than 1 gives a `NewerVersion` issue, still parsed |
| `pins.uart_rx`   | integer | GPIO 0–39                                             |
| `pins.uart_tx`   | integer | GPIO 0–33 (34–39 are input-only)                      |
| `pins.i2c_sda`   | integer | GPIO 0–33                                             |
| `pins.i2c_scl`   | integer | GPIO 0–33                                             |
| `uart.baud_rate` | integer | > 0                                                   |
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
| `test_parse`        | defaults, partial/full merge, invalid JSON + offset, wrong type |
| `test_validate`     | GPIO range, input-only, duplicates, positive speeds, version, unknown keys, issue saturation |
````

- [ ] **Step 7: Add the library to Doxygen**

In the root `Doxyfile`, the `INPUT` list (line 11 onward) has one directory per line ending in ` \`. Add `                         shared/vmaas-config/src \` as a new line in that list (same indentation as the existing continuation lines). Then find the `EXCLUDE_PATTERNS` line and set it to:

```
EXCLUDE_PATTERNS       = */cJSON.*
```

Run from the repository root (Doxygen ships in the WinLibs `mingw64/bin` dir): `doxygen Doxyfile 2>&1 | grep -iE 'warning|error' | grep -v cJSON | head`

Expected: no warnings about `config.h`, `config_parser.h`, `config_store.h` or `defaults.h`. Output in `docs/api` is gitignored.

- [ ] **Step 8: Verify**

Report the four hardware outcomes (swapped, rejected fields, invalid JSON, missing file) with the exact `ConfigStore` lines, confirm `data/config.json` is restored, and that Doxygen runs clean for the new headers. Do not commit.

---

## Self-review against the spec

| Spec section | Task |
|---|---|
| §3.1 partitions, §3.2 LittleFS, §3.3 PlatformIO/sdkconfig, §3.4 workflow | Task 1 |
| §3.4 "uploadfs spike first" | Task 1 (Steps 9–11) |
| §4 format, optional fields, version, unknown keys | Tasks 3, 4; file in Task 1 Step 5 |
| §4 validation rules | Task 4 |
| §5.1 library API (`Config`, `ConfigIssueKind`, `ConfigIssue`, `ParseResult`, `parse_config`, `to_string`) | Tasks 2, 3 |
| §5.2 `defaults.h`, `config_store`, `main.cpp`, `idf_component.yml`, `data/config.json` | Tasks 1, 5 |
| §5.3 boot sequence | Task 5 Step 4 |
| §6 error table (mount fail, missing, too large, invalid JSON, field issues, newer version) | Task 1 (mount), Task 5 (`load_config`), Task 4 (issues) |
| §7.1 native tests | Tasks 2, 3, 4 (30 tests) |
| §7.2 hardware verification 1–4 | Task 1 Step 11, Task 5 Step 6, Task 6 Steps 1–4 |
| §8 deferred items | not planned, by design |

Deviation from spec, recorded here: `Main-Controller/src/config.h` is renamed to `settings.h` (Task 5) because the shared library's header is also called `config.h`. The namespace `Config` and the values inside are unchanged, so the spec's "pins.h and config.h remain the source of the factory values" holds in substance.
