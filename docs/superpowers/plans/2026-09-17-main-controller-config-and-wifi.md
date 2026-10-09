# Main-Controller Config Filesystem and Wi-Fi Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Main-Controller a LittleFS partition with a readable `config.json`, and replace the Arduino Wi-Fi code that currently stops branch `dev` from building.

**Architecture:** A shared, host-tested parser (`vmaas-config`) turns JSON text into a `DeviceConfig` struct and never touches I/O. A shared ESP-IDF-only library (`vmaas-fs`) mounts LittleFS and reads files. A per-board `config_store` glues the two together. Wi-Fi becomes a thin non-blocking layer over `esp_wifi`, which stores credentials in NVS itself — there is no second credentials store.

**Tech Stack:** ESP-IDF 6.1 (`framework = espidf`), PlatformIO Core 6.2, C++17, cJSON (vendored), `joltwallet/littlefs` managed component, Unity for host tests.

**Spec:** `docs/superpowers/specs/2026-09-17-main-controller-config-and-wifi-design.md`

## Global Constraints

- **Never run `git commit`.** It is denied in this project. Tasks end by **staging** with `git add`; the user commits.
- `framework = espidf` only. **No Arduino headers** (`WiFi.h`, `Arduino.h`) anywhere.
- C++17. Exceptions and RTTI are disabled on both boards.
- `CONFIG_FREERTOS_HZ=100`, so one FreeRTOS tick is 10 ms. Any delay below 10 ms rounds to zero in `pdMS_TO_TICKS` and makes `xTaskDelayUntil` assert.
- Parsers allocate nothing except inside cJSON. No heap in the result structs.
- `device.name` is capped at 16 characters plus NUL: one row of a 16x2 display.
- `MAX_CONFIG_BYTES = 2048`.
- Every public header gets Doxygen comments (`@file`, `@brief`, `@param`, `@return`) — repo convention, checked by the root `Doxyfile`.
- Display strings use ASCII only. The HD44780 has no `æ ø å`; existing code writes `"VMaaS - vaelg slot"`.

**Toolchain paths.** Neither tool is on this shell's PATH:

```bash
# PlatformIO
"C:/Users/temp/.platformio/penv/Scripts/pio.exe"

# Host GCC, needed for `platform = native` test runs — prefix the command with this
export PATH="/c/Users/temp/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
```

**Hardware.** The WROVER is on **COM6**. It currently holds a throwaway BLE-provisioning spike and its flash was erased, so LittleFS and NVS are empty. `pio device monitor` needs a TTY and will not run from a tool shell — read the port with pyserial from PlatformIO's Python instead:

```bash
"C:/Users/temp/.platformio/penv/Scripts/python.exe" -c "
import serial,time,sys
s=serial.Serial('COM6',115200,timeout=0.2)
s.setDTR(False); s.setRTS(True); time.sleep(0.15); s.setRTS(False); time.sleep(0.05); s.setDTR(True)
end=time.time()+20
while time.time()<end:
    d=s.read(4096)
    if d: sys.stdout.write(d.decode('utf-8','replace')); sys.stdout.flush()
s.close()"
```

Make sure nothing else holds COM6 before any `-t upload`.

## File Structure

| File | Responsibility |
|---|---|
| `shared/vmaas-config/src/config_issue.h` | NEW. `ConfigIssueKind`, `ConfigIssue`, `to_string()`. Shared by both schemas. |
| `shared/vmaas-config/src/json_depth.{h,cpp}` | NEW. `nesting_too_deep()` — the stack-overflow guard, lifted out of the slot parser so both schemas use one copy. |
| `shared/vmaas-config/src/slot_config.h` | WAS `config.h`. `SlotEntry`, `SlotConfig`, `SlotParseResult`. |
| `shared/vmaas-config/src/slot_config_parser.{h,cpp}` | WAS `config_parser.{h,cpp}`. `parse_slot_config()`. |
| `shared/vmaas-config/src/device_config.h` | NEW. `DeviceConfig`, `DeviceParseResult`, `device_config_defaults()`. |
| `shared/vmaas-config/src/device_config_parser.{h,cpp}` | NEW. `parse_device_config()`. |
| `shared/vmaas-fs/src/storage.{h,cpp}` | NEW library. `vmaas::fs::mount()`, `read_text_file()`. ESP-IDF only. |
| `Main-Controller/partitions.csv` | NEW. 4 MB layout with a LittleFS `storage` partition. |
| `Main-Controller/data/config.json` | NEW. The configuration file, committed. |
| `Main-Controller/src/config_store.{h,cpp}` | NEW. Mount, read, parse, log. Returns a `DeviceConfig` that is always usable. |
| `Main-Controller/src/wifi_sta.{h,cpp}` | NEW. Non-blocking STA layer over `esp_wifi`. |
| `Main-Controller/src/main.cpp` | MODIFY. Drop Arduino Wi-Fi; take timings and name from the loaded config. |
| `Main-Controller/src/config.h` | MODIFY. Delete the Wi-Fi constants and the timings that moved into the file. |
| `Motorcontrol/src/config_store.{h,cpp}` | MODIFY (last task, droppable). Use `vmaas-fs` instead of its own copies. |

---

### Task 1: Make branch `dev` build again

Branch `dev` does not compile: `main.cpp` includes the Arduino header `WiFi.h`, which does not exist under `framework = espidf`. The function that uses it, `startWifi()`, is **never called** by anything — it is dead code that breaks the build through its include alone. Task 2 adds a real Wi-Fi layer; this task just gets the branch green.

**Files:**
- Modify: `Main-Controller/src/main.cpp:16` (the include) and `Main-Controller/src/main.cpp:152-168` (`startWifi()`)
- Modify: `Main-Controller/src/config.h:46-49` (the Wi-Fi constants)

**Interfaces:**
- Consumes: nothing
- Produces: a Main-Controller that builds. No new symbols.

- [ ] **Step 1: Confirm the failure first, so you know the fix did something**

```bash
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Main-Controller 2>&1 | tail -20
```

Expected: `src/main.cpp:16:10: fatal error: WiFi.h: No such file or directory` and `[FAILED]`.

- [ ] **Step 2: Delete the include**

Remove line 16 of `Main-Controller/src/main.cpp`:

```c++
#include <WiFi.h>
```

- [ ] **Step 3: Delete the dead function**

Remove the whole of `startWifi()` from `Main-Controller/src/main.cpp` — it currently reads:

```c++
    void startWifi()
    {
        WiFi.mode(WIFI_STA);
        WiFi.begin(Config::wifi_ssid, Config::wifi_password);
        show_row1("Connecting to WiFi...");
        set_rgb(255, 255, 0); // Yellow backlight for WiFi connection
        ESP_LOGI(TAG, "Connecting to WiFi SSID '%s'...", Config::wifi_ssid);
        while (WiFi.status() != WL_CONNECTED)
        {
            vTaskDelay(pdMS_TO_TICKS(500));
            set_rgb(255, 0, 0); // Red backlight while waiting for WiFi
            ESP_LOGI(TAG, "Waiting for WiFi connection...");
        }
        show_row1("Connected to WiFi");
        set_rgb(0, 255, 0); // Green backlight when connected
        ESP_LOGI(TAG, "WiFi connected");
    }
```

Grep to confirm nothing called it — it should print only the definition you are deleting:

```bash
grep -n 'startWifi' Main-Controller/src/main.cpp
```

- [ ] **Step 4: Delete the Wi-Fi constants**

Remove these lines from `Main-Controller/src/config.h`:

```c++
    /// @brief WiFi SSID
    constexpr const char* wifi_ssid = "VMaaS";
    /// @brief WiFi password
    constexpr const char* wifi_password = "VMaaS123";
```

Credentials live in NVS from now on. A password in a version-controlled header is exactly what this work removes.

- [ ] **Step 5: Build and confirm it passes**

```bash
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Main-Controller 2>&1 | tail -8
```

Expected: `[SUCCESS]` and a RAM/Flash usage summary.

- [ ] **Step 6: Stage**

```bash
git add Main-Controller/src/main.cpp Main-Controller/src/config.h
```

---

### Task 2: `wifi_sta` — a non-blocking STA layer

`esp_wifi` persists the station configuration to NVS itself when storage is `WIFI_STORAGE_FLASH` (the default). This was confirmed on hardware on 2026-09-17: a board previously flashed with Arduino `WiFi.begin()` made the provisioning example report *"Already provisioned"*. So this module is a **layer**, not a store — it must not keep its own copy of the credentials anywhere.

**Files:**
- Create: `Main-Controller/src/wifi_sta.h`
- Create: `Main-Controller/src/wifi_sta.cpp`
- Modify: `Main-Controller/src/main.cpp` (call `init()` and `connect()` in `app_main`)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `esp_err_t wifi_sta::init()`
  - `bool wifi_sta::has_credentials()`
  - `esp_err_t wifi_sta::connect()`
  - `bool wifi_sta::is_connected()`
  - `esp_err_t wifi_sta::set_credentials(const char* ssid, const char* password)`
  - `esp_err_t wifi_sta::forget()`

  The onboarding work (next plan) calls `set_credentials()` and `forget()`. Do not change those two signatures without updating that plan.

- [ ] **Step 1: Write the header**

Create `Main-Controller/src/wifi_sta.h`:

```c++
#pragma once
/**
 * @file wifi_sta.h
 * @brief Non-blocking Wi-Fi station layer over esp_wifi.
 *
 * esp_wifi stores the station configuration in NVS itself. This module
 * deliberately keeps no copy: has_credentials() asks the driver, and
 * set_credentials() lets the driver persist. A second store would give two
 * answers to one question, which is the bug that made a previously flashed
 * board report "Already provisioned" to the provisioning manager.
 *
 * Nothing here blocks. Connection state is advisory: a machine that cannot
 * sell because the cafe changed its Wi-Fi password is a worse failure than
 * one that sells without telemetry.
 */
#include "esp_err.h"

namespace wifi_sta
{
    /**
     * @brief Bring up NVS, netif, the default event loop and the Wi-Fi driver in STA mode.
     *
     * Does not connect. Leaves storage at WIFI_STORAGE_FLASH so the driver
     * persists credentials. Safe to call once, from app_main.
     * @return ESP_OK, or the first failing esp_err_t.
     */
    esp_err_t init();

    /**
     * @brief Whether the driver already holds a station configuration.
     * @return true when esp_wifi_get_config(WIFI_IF_STA) yields a non-empty SSID.
     */
    bool has_credentials();

    /**
     * @brief Start the driver and begin connecting.
     *
     * Returns immediately. With no stored credentials it logs once and does
     * nothing. Retries on disconnect with exponential backoff, 2 s doubling
     * to a 60 s ceiling.
     * @return ESP_OK once the driver is started.
     */
    esp_err_t connect();

    /// @return true between IP_EVENT_STA_GOT_IP and the next disconnect.
    bool is_connected();

    /**
     * @brief Store credentials and connect. The driver writes them to NVS.
     * @param ssid NUL-terminated SSID, 1-32 bytes.
     * @param password NUL-terminated passphrase, 0-63 bytes. Empty means an open network.
     * @return ESP_ERR_INVALID_ARG on a null or over-long argument, else ESP_OK.
     */
    esp_err_t set_credentials(const char* ssid, const char* password);

    /// @brief esp_wifi_restore(): erase the stored station configuration.
    esp_err_t forget();
}
```

- [ ] **Step 2: Write the implementation**

Create `Main-Controller/src/wifi_sta.cpp`. Note the retry: it uses a one-shot `esp_timer`, **not** a delay inside the event handler. Blocking the event task stalls every other ESP-IDF event on the system.

```c++
#include "wifi_sta.h"

#include <cstring>
#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "nvs_flash.h"

namespace
{
    constexpr const char* TAG = "WifiSta";
    constexpr uint32_t BACKOFF_MIN_MS = 2000;
    constexpr uint32_t BACKOFF_MAX_MS = 60000;

    bool s_connected = false;
    uint32_t s_backoff_ms = BACKOFF_MIN_MS;
    esp_timer_handle_t s_retry_timer = nullptr;

    void retry_cb(void*)
    {
        esp_wifi_connect();
    }

    void on_event(void*, esp_event_base_t base, int32_t id, void* data)
    {
        if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START)
        {
            esp_wifi_connect();
        }
        else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED)
        {
            s_connected = false;
            ESP_LOGW(TAG, "disconnected, retrying in %u ms", (unsigned)s_backoff_ms);
            esp_timer_stop(s_retry_timer);
            esp_timer_start_once(s_retry_timer, (uint64_t)s_backoff_ms * 1000);
            s_backoff_ms = (s_backoff_ms * 2 > BACKOFF_MAX_MS) ? BACKOFF_MAX_MS : s_backoff_ms * 2;
        }
        else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP)
        {
            const ip_event_got_ip_t* e = static_cast<const ip_event_got_ip_t*>(data);
            s_connected = true;
            s_backoff_ms = BACKOFF_MIN_MS;
            ESP_LOGI(TAG, "connected, ip " IPSTR, IP2STR(&e->ip_info.ip));
        }
    }
}

namespace wifi_sta
{
    esp_err_t init()
    {
        esp_err_t err = nvs_flash_init();
        if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND)
        {
            ESP_ERROR_CHECK(nvs_flash_erase());
            err = nvs_flash_init();
        }
        if (err != ESP_OK)
            return err;

        if ((err = esp_netif_init()) != ESP_OK)
            return err;
        if ((err = esp_event_loop_create_default()) != ESP_OK)
            return err;
        esp_netif_create_default_wifi_sta();

        wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
        if ((err = esp_wifi_init(&cfg)) != ESP_OK)
            return err;
        if ((err = esp_wifi_set_storage(WIFI_STORAGE_FLASH)) != ESP_OK)
            return err;
        if ((err = esp_wifi_set_mode(WIFI_MODE_STA)) != ESP_OK)
            return err;

        if ((err = esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &on_event, nullptr)) != ESP_OK)
            return err;
        if ((err = esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &on_event, nullptr)) != ESP_OK)
            return err;

        const esp_timer_create_args_t targs = {
            .callback = &retry_cb,
            .arg = nullptr,
            .dispatch_method = ESP_TIMER_TASK,
            .name = "wifi_retry",
            .skip_unhandled_events = true,
        };
        return esp_timer_create(&targs, &s_retry_timer);
    }

    bool has_credentials()
    {
        wifi_config_t cfg = {};
        if (esp_wifi_get_config(WIFI_IF_STA, &cfg) != ESP_OK)
            return false;
        return cfg.sta.ssid[0] != '\0';
    }

    esp_err_t connect()
    {
        if (!has_credentials())
        {
            ESP_LOGI(TAG, "no stored credentials, staying offline");
            return ESP_OK;
        }
        return esp_wifi_start();
    }

    bool is_connected()
    {
        return s_connected;
    }

    esp_err_t set_credentials(const char* ssid, const char* password)
    {
        if (ssid == nullptr || password == nullptr)
            return ESP_ERR_INVALID_ARG;

        wifi_config_t cfg = {};
        if (std::strlen(ssid) == 0 || std::strlen(ssid) >= sizeof(cfg.sta.ssid))
            return ESP_ERR_INVALID_ARG;
        if (std::strlen(password) >= sizeof(cfg.sta.password))
            return ESP_ERR_INVALID_ARG;

        std::snprintf(reinterpret_cast<char*>(cfg.sta.ssid), sizeof(cfg.sta.ssid), "%s", ssid);
        std::snprintf(reinterpret_cast<char*>(cfg.sta.password), sizeof(cfg.sta.password), "%s", password);

        esp_err_t err = esp_wifi_set_config(WIFI_IF_STA, &cfg);
        if (err != ESP_OK)
            return err;

        s_backoff_ms = BACKOFF_MIN_MS;
        err = esp_wifi_start();
        if (err == ESP_ERR_WIFI_CONN || err == ESP_OK)
            esp_wifi_connect();
        return err;
    }

    esp_err_t forget()
    {
        s_connected = false;
        return esp_wifi_restore();
    }
}
```

Add `#include <cstdio>` for `std::snprintf` if the build complains.

- [ ] **Step 3: Call it from `app_main`**

In `Main-Controller/src/main.cpp`, add the include next to the others:

```c++
#include "wifi_sta.h"
```

and near the top of `app_main()`, before the display and keypad setup:

```c++
    const esp_err_t wifi_err = wifi_sta::init();
    if (wifi_err != ESP_OK)
        ESP_LOGE(TAG, "wifi init failed: %s, continuing offline", esp_err_to_name(wifi_err));
    else
        wifi_sta::connect();
```

This matches the pattern the file already uses for the display and keypad: log the failure, keep going.

- [ ] **Step 4: Build**

```bash
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Main-Controller 2>&1 | tail -8
```

Expected: `[SUCCESS]`.

- [ ] **Step 5: Flash and confirm it stays offline without credentials**

```bash
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Main-Controller -t upload 2>&1 | tail -4
```

Then read the boot log with the pyserial snippet from **Global Constraints**.

Expected: a line `no stored credentials, staying offline`, then the slot prompt appears on the LCD **without any delay**. There must be no repeated "Waiting for WiFi" and no stall.

- [ ] **Step 6: Verify the connect path once, with a temporary flag**

The spec records this as an open gap: nothing can write credentials until the onboarding work exists, so the connect path is proven once by hand and the scaffolding is then removed.

Temporarily add to `Main-Controller/platformio.ini`:

```ini
build_flags = -DVMAAS_DEV_WIFI_SSID='"YourNetwork"' -DVMAAS_DEV_WIFI_PASS='"YourPassword"'
```

and temporarily, in `app_main()` right after `wifi_sta::init()`:

```c++
#ifdef VMAAS_DEV_WIFI_SSID
    wifi_sta::set_credentials(VMAAS_DEV_WIFI_SSID, VMAAS_DEV_WIFI_PASS);
#endif
```

Build, flash, read the log. Expected: `connected, ip 192.168.x.y`.

- [ ] **Step 7: Remove the temporary flag and both lines, rebuild, reflash**

Confirm the log is back to `no stored credentials, staying offline`. **Do not stage the temporary flag.** A real SSID and password in `platformio.ini` is the same mistake this work exists to undo.

- [ ] **Step 8: Stage**

```bash
git add Main-Controller/src/wifi_sta.h Main-Controller/src/wifi_sta.cpp Main-Controller/src/main.cpp
git status --short   # confirm platformio.ini is NOT staged
```

---

### Task 3: Split and rename `vmaas-config`

Pure refactor, no behaviour change: the existing tests must pass unchanged apart from the renamed symbols. The library currently exports `config.h`, and Main-Controller has its own `src/config.h` — with both on one include path that is a trap waiting to spring, which is the second reason for this rename.

**Files:**
- Create: `shared/vmaas-config/src/config_issue.h`
- Create: `shared/vmaas-config/src/json_depth.h`, `shared/vmaas-config/src/json_depth.cpp`
- Rename: `src/config.h` → `src/slot_config.h`; `src/config_parser.{h,cpp}` → `src/slot_config_parser.{h,cpp}`
- Modify: `shared/vmaas-config/library.json`
- Modify: `shared/vmaas-config/test/test_parse/test_main.cpp`, `test/test_validate/test_main.cpp`, `test/test_config_issue/test_main.cpp`
- Modify: `Motorcontrol/src/config_store.h:25`, `Motorcontrol/src/config_store.cpp:86,98,99`, `Motorcontrol/src/main.cpp:30`

**Interfaces:**
- Consumes: nothing
- Produces: `vmaas::SlotConfig`, `vmaas::SlotParseResult`, `vmaas::parse_slot_config()`, `vmaas::SLOT_SCHEMA_VERSION`, `vmaas::ConfigIssue`, `vmaas::ConfigIssueKind`, `vmaas::to_string()`, and `vmaas::nesting_too_deep(const char* text, size_t& offset)`.

- [ ] **Step 1: Record the baseline — all tests green before you touch anything**

```bash
export PATH="/c/Users/temp/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" test -e native -d shared/vmaas-config 2>&1 | tail -20
```

Write down the passing test count. It must be identical at the end of this task.

- [ ] **Step 2: Extract `config_issue.h`**

Create `shared/vmaas-config/src/config_issue.h` holding `ConfigIssueKind`, `ConfigIssue` and the `to_string()` declaration, moved verbatim out of `config.h`. Keep the existing Doxygen comments on every enumerator — they document what each kind means and are the only such documentation.

`config_issue.cpp` already contains `to_string()`; change only its include to `#include "config_issue.h"`.

- [ ] **Step 3: Extract `json_depth.{h,cpp}`**

`nesting_too_deep()` is currently a static helper in the anonymous namespace of `config_parser.cpp`. Move it out so the device parser uses the same copy rather than growing a second one.

`json_depth.h`:

```c++
#pragma once
/**
 * @file json_depth.h
 * @brief Bracket-nesting guard, run before cJSON sees a file.
 */
#include <cstddef>

namespace vmaas
{
    /// Deepest bracket nesting accepted. Slot schema v1 is depth 3, device schema v1 is depth 2.
    constexpr int MAX_NESTING_DEPTH = 8;

    /**
     * @brief Scan bracket depth outside string literals.
     *
     * cJSON parses recursively: one stack frame per nesting level. A file of
     * several thousand opening brackets exhausts a FreeRTOS task stack, which
     * on an ESP32 means a panic or silent memory corruption rather than an
     * error. This flat scan runs first so cJSON is never handed such a file.
     *
     * @param text NUL-terminated JSON text.
     * @param offset Set to the byte offset of the offending bracket when the limit is passed.
     * @return true when the text nests deeper than MAX_NESTING_DEPTH.
     */
    bool nesting_too_deep(const char* text, size_t& offset);
}
```

Move the body into `json_depth.cpp` unchanged — including the `in_string` and `escaped` handling. Without those, a perfectly ordinary file like `{"name":"{{{{{{{{{{"}` would be counted as depth 11 and rejected.

- [ ] **Step 4: Rename the slot files and symbols**

```bash
cd shared/vmaas-config/src
git mv config.h slot_config.h
git mv config_parser.h slot_config_parser.h
git mv config_parser.cpp slot_config_parser.cpp
```

Then apply the renames from the spec: `Config` → `SlotConfig`, `ParseResult` → `SlotParseResult`, `parse_config` → `parse_slot_config`, `CONFIG_SCHEMA_VERSION` → `SLOT_SCHEMA_VERSION`. `ConfigIssueKind`, `ConfigIssue`, `to_string` and `MAX_SLOTS` keep their names.

`slot_config.h` now includes `config_issue.h` instead of declaring those types itself.

- [ ] **Step 5: Update `library.json`**

```json
  "headers": ["slot_config.h", "slot_config_parser.h", "device_config.h", "device_config_parser.h", "config_issue.h"]
```

`device_config*.h` do not exist yet; they arrive in Task 4. Listing them now avoids a second edit, and `headers` is metadata that PlatformIO does not verify.

- [ ] **Step 6: Update the three test files**

Change includes from `"config.h"` / `"config_parser.h"` to `"slot_config.h"` / `"slot_config_parser.h"`, and rename the symbols. Do not change a single assertion — the point of this task is that behaviour is untouched.

- [ ] **Step 7: Update Motorcontrol's four call sites**

| File:line | Change |
|---|---|
| `Motorcontrol/src/config_store.h:25` | `vmaas::Config config;` → `vmaas::SlotConfig config;` |
| `Motorcontrol/src/config_store.h` (include) | `#include "config.h"` → `#include "slot_config.h"` |
| `Motorcontrol/src/config_store.cpp:86` | `vmaas::ParseResult r = vmaas::parse_config(text)` → `vmaas::SlotParseResult r = vmaas::parse_slot_config(text)` |
| `Motorcontrol/src/config_store.cpp` (include) | `#include "config_parser.h"` → `#include "slot_config_parser.h"` |
| `Motorcontrol/src/main.cpp:30` | `const vmaas::Config& cfg` → `const vmaas::SlotConfig& cfg` |

Lines 98 and 99 of `config_store.cpp` use `vmaas::ConfigIssue` and `vmaas::ConfigIssueKind`, which are unchanged. Leave them.

- [ ] **Step 8: Run the tests — the count must match Step 1 exactly**

```bash
export PATH="/c/Users/temp/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" test -e native -d shared/vmaas-config 2>&1 | tail -20
```

Expected: the same number of tests, all passing. A different count means something was dropped in the rename.

- [ ] **Step 9: Build Motorcontrol**

```bash
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Motorcontrol 2>&1 | tail -8
```

Expected: `[SUCCESS]`.

- [ ] **Step 10: Stage**

```bash
git add shared/vmaas-config Motorcontrol/src
```

---

### Task 4: `DeviceConfig` and the happy path of `parse_device_config()`

**Files:**
- Create: `shared/vmaas-config/src/device_config.h`
- Create: `shared/vmaas-config/src/device_config_parser.h`, `device_config_parser.cpp`
- Test: `shared/vmaas-config/test/test_device_parse/test_main.cpp`

**Interfaces:**
- Consumes: `vmaas::ConfigIssue`, `vmaas::ConfigIssueKind`, `vmaas::nesting_too_deep()` from Task 3
- Produces: `vmaas::DeviceConfig`, `vmaas::DeviceParseResult`, `vmaas::device_config_defaults()`, `vmaas::parse_device_config(const char*)`, `vmaas::DEVICE_SCHEMA_VERSION`

- [ ] **Step 1: Write the header**

Create `shared/vmaas-config/src/device_config.h`:

```c++
#pragma once
/**
 * @file device_config.h
 * @brief Device configuration schema for the VMaaS Main-Controller.
 *
 * /storage/config.json on Main-Controller holds identity, backend endpoint and
 * operator-tunable timings. Unlike the slot table in slot_config.h, this
 * schema has safe defaults for every field: a vending machine that will not
 * sell is worse than one that sells while unreachable. parse_device_config()
 * therefore always yields a usable struct.
 *
 * Secrets are NOT in this file. Wi-Fi credentials live in NVS, written by
 * esp_wifi itself.
 *
 * Schema version 1 (config.json):
 * @code
 * {
 *   "version": 1,
 *   "device":   { "name": "VMaaS-0042", "machine_id": "5f2c1a90-..." },
 *   "backend":  { "mqtt_host": "mqtt.vmaas.dk", "mqtt_port": 8883, "client_id": "vmaas-0042" },
 *   "timings":  { "keypad_debounce_ms": 20, "slot_entry_timeout_ms": 10000,
 *                 "slot_entry_result_hold_ms": 2000 }
 * }
 * @endcode
 */
#include <cstddef>
#include <cstdint>
#include "config_issue.h"

namespace vmaas
{
    /// Schema version this library understands. Higher versions parse with a NewerVersion issue.
    constexpr int DEVICE_SCHEMA_VERSION = 1;

    constexpr size_t MAX_DEVICE_NAME = 17; ///< 16 chars + NUL: one row of the 16x2 display.
    constexpr size_t MAX_MACHINE_ID  = 37; ///< 36 chars + NUL: a UUID fits.
    constexpr size_t MAX_MQTT_HOST   = 64; ///< Hostname + NUL.
    constexpr size_t MAX_CLIENT_ID   = 33; ///< MQTT client id + NUL.

    /// Validated device settings. Every field always holds either a file value or its default.
    struct DeviceConfig
    {
        char     name[MAX_DEVICE_NAME];        ///< Shown by the provisioning app and on the LCD. "" means derive from MAC.
        char     machine_id[MAX_MACHINE_ID];   ///< Identity towards the backend. "" means unidentified.
        char     mqtt_host[MAX_MQTT_HOST];     ///< Broker hostname. "" means no backend configured.
        uint16_t mqtt_port;                    ///< Broker port. 1-65535.
        char     mqtt_client_id[MAX_CLIENT_ID];///< MQTT client id. "" means derive from machine_id.
        uint32_t keypad_debounce_ms;           ///< How long a key state must hold before it is believed.
        uint32_t slot_entry_timeout_ms;        ///< Inactivity before a partial slot entry is discarded.
        uint32_t slot_entry_result_hold_ms;    ///< How long a result line stays on screen.
    };

    /// The value of every field when config.json does not supply it, or supplies it badly.
    DeviceConfig device_config_defaults();

    /// Output of parse_device_config(). Fixed size, no heap.
    struct DeviceParseResult
    {
        static constexpr size_t MAX_ISSUES = 8; ///< Issues kept; further ones are dropped.

        DeviceConfig config;            ///< ALWAYS usable, whatever ok and json_valid say.
        bool ok;                        ///< No issue other than NewerVersion was found.
        bool json_valid;                ///< false means the text was not a JSON object (or too deep).
        size_t json_error_offset;       ///< Byte offset of the JSON error when json_valid is false.
        size_t issue_count;             ///< Number of valid entries in issues, at most MAX_ISSUES.
        ConfigIssue issues[MAX_ISSUES]; ///< The first issue_count entries are valid.
    };
}
```

Create `shared/vmaas-config/src/device_config_parser.h`:

```c++
#pragma once
/**
 * @file device_config_parser.h
 * @brief Parse and validate a Main-Controller config.json text.
 */
#include "device_config.h"

namespace vmaas
{
    /**
     * @brief Parse @p json_text into device settings.
     *
     * Starts from device_config_defaults() and overwrites each field the file
     * supplies cleanly. A malformed field is reported as an issue and leaves
     * its default in place, so result.config is usable even when ok is false
     * and even when json_valid is false. This is the opposite of
     * parse_slot_config(), which yields nothing when anything is wrong,
     * because there is no safe default wiring for a motor.
     *
     * - Missing sections are not an error; their fields take defaults.
     * - Unknown keys are ignored. "version" above DEVICE_SCHEMA_VERSION gives
     *   NewerVersion and parsing continues.
     * - A string longer than its buffer gives OutOfRange and keeps the
     *   default. Values are never silently truncated.
     * - mqtt_port must be 1-65535; timings must be 1-600000 ms.
     * - Invalid JSON, a nullptr, a non-object root, or nesting deeper than
     *   MAX_NESTING_DEPTH gives json_valid == false, one InvalidJson issue and
     *   json_error_offset set. The depth check runs before cJSON recurses.
     *
     * @param json_text NUL-terminated JSON text, or nullptr.
     * @return Settings plus issues. Never fails.
     */
    DeviceParseResult parse_device_config(const char* json_text);
}
```

- [ ] **Step 2: Write the failing happy-path test**

Create `shared/vmaas-config/test/test_device_parse/test_main.cpp`:

```c++
/**
 * @file test_main.cpp
 * @brief Host tests for parse_device_config() structure handling.
 *
 * The contract under test: a well-formed file yields every field; absent
 * sections fall back to defaults without being an error; unknown keys and a
 * newer schema version are tolerated; config is usable in every case.
 */
#include <unity.h>
#include <cstring>
#include "device_config.h"
#include "device_config_parser.h"

using namespace vmaas;

namespace
{
    constexpr const char* FULL = R"({
        "version": 1,
        "device":  { "name": "VMaaS-0042", "machine_id": "5f2c1a90-6b3e-4d21-9f77-1c0a8e4b2d55" },
        "backend": { "mqtt_host": "mqtt.vmaas.dk", "mqtt_port": 8883, "client_id": "vmaas-0042" },
        "timings": { "keypad_debounce_ms": 25, "slot_entry_timeout_ms": 8000,
                     "slot_entry_result_hold_ms": 1500 }
    })";
}

void setUp() {}
void tearDown() {}

void test_full_file_yields_every_field()
{
    const DeviceParseResult r = parse_device_config(FULL);
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_EQUAL_UINT(0, r.issue_count);
    TEST_ASSERT_EQUAL_STRING("VMaaS-0042", r.config.name);
    TEST_ASSERT_EQUAL_STRING("5f2c1a90-6b3e-4d21-9f77-1c0a8e4b2d55", r.config.machine_id);
    TEST_ASSERT_EQUAL_STRING("mqtt.vmaas.dk", r.config.mqtt_host);
    TEST_ASSERT_EQUAL_UINT16(8883, r.config.mqtt_port);
    TEST_ASSERT_EQUAL_STRING("vmaas-0042", r.config.mqtt_client_id);
    TEST_ASSERT_EQUAL_UINT32(25, r.config.keypad_debounce_ms);
    TEST_ASSERT_EQUAL_UINT32(8000, r.config.slot_entry_timeout_ms);
    TEST_ASSERT_EQUAL_UINT32(1500, r.config.slot_entry_result_hold_ms);
}

void test_absent_sections_take_defaults_and_are_not_an_error()
{
    const DeviceParseResult r = parse_device_config(R"({"version": 1})");
    const DeviceConfig d = device_config_defaults();
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_STRING("", r.config.name);
    TEST_ASSERT_EQUAL_UINT16(d.mqtt_port, r.config.mqtt_port);
    TEST_ASSERT_EQUAL_UINT32(d.keypad_debounce_ms, r.config.keypad_debounce_ms);
    TEST_ASSERT_EQUAL_UINT32(d.slot_entry_timeout_ms, r.config.slot_entry_timeout_ms);
    TEST_ASSERT_EQUAL_UINT32(d.slot_entry_result_hold_ms, r.config.slot_entry_result_hold_ms);
}

void test_partial_section_keeps_defaults_for_the_rest()
{
    const DeviceParseResult r = parse_device_config(R"({"timings": {"keypad_debounce_ms": 30}})");
    const DeviceConfig d = device_config_defaults();
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(30, r.config.keypad_debounce_ms);
    TEST_ASSERT_EQUAL_UINT32(d.slot_entry_timeout_ms, r.config.slot_entry_timeout_ms);
}

void test_unknown_keys_are_ignored()
{
    const DeviceParseResult r = parse_device_config(R"({"device": {"name": "A", "colour": "red"}, "zzz": 1})");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_STRING("A", r.config.name);
}

void test_newer_version_is_tolerated()
{
    const DeviceParseResult r = parse_device_config(R"({"version": 99, "device": {"name": "A"}})");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT(1, r.issue_count);
    TEST_ASSERT_EQUAL(ConfigIssueKind::NewerVersion, r.issues[0].kind);
    TEST_ASSERT_EQUAL_STRING("A", r.config.name);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_full_file_yields_every_field);
    RUN_TEST(test_absent_sections_take_defaults_and_are_not_an_error);
    RUN_TEST(test_partial_section_keeps_defaults_for_the_rest);
    RUN_TEST(test_unknown_keys_are_ignored);
    RUN_TEST(test_newer_version_is_tolerated);
    return UNITY_END();
}
```

- [ ] **Step 3: Run it and watch it fail to build**

```bash
export PATH="/c/Users/temp/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" test -e native -d shared/vmaas-config -f test_device_parse 2>&1 | tail -20
```

Expected: a link error on `parse_device_config` and `device_config_defaults`. `device_config_parser.cpp` does not exist yet.

- [ ] **Step 4: Write the implementation**

Create `shared/vmaas-config/src/device_config_parser.cpp`. Structure it as `parse_slot_config` already does: depth guard first, then cJSON, then field by field.

```c++
#include "device_config_parser.h"

#include <cstdio>
#include <cstring>
#include "cJSON.h"
#include "json_depth.h"

namespace
{
    constexpr long long PORT_MIN = 1;
    constexpr long long PORT_MAX = 65535;
    constexpr long long TIMING_MIN = 1;
    constexpr long long TIMING_MAX = 600000;

    void add_issue(vmaas::DeviceParseResult& r, vmaas::ConfigIssueKind kind, const char* field)
    {
        if (r.issue_count >= vmaas::DeviceParseResult::MAX_ISSUES)
            return;
        vmaas::ConfigIssue& issue = r.issues[r.issue_count++];
        issue.kind = kind;
        std::snprintf(issue.field, sizeof(issue.field), "%s", field);
    }

    // Copies parent[key] into dst when it is a string that fits. Leaves dst untouched
    // otherwise, so the default survives. Never truncates: an over-long value is an
    // issue, because a silently shortened hostname or machine id is worse than none.
    void read_string(vmaas::DeviceParseResult& r, const cJSON* parent, const char* key,
                     char* dst, size_t cap, const char* field)
    {
        const cJSON* item = cJSON_GetObjectItemCaseSensitive(parent, key);
        if (item == nullptr)
            return;
        if (!cJSON_IsString(item) || item->valuestring == nullptr)
        {
            add_issue(r, vmaas::ConfigIssueKind::WrongType, field);
            return;
        }
        if (std::strlen(item->valuestring) >= cap)
        {
            add_issue(r, vmaas::ConfigIssueKind::OutOfRange, field);
            return;
        }
        std::snprintf(dst, cap, "%s", item->valuestring);
    }

    // Reads parent[key] as an integer in [lo, hi]. Leaves out untouched otherwise.
    void read_int(vmaas::DeviceParseResult& r, const cJSON* parent, const char* key,
                  long long lo, long long hi, const char* field, long long& out)
    {
        const cJSON* item = cJSON_GetObjectItemCaseSensitive(parent, key);
        if (item == nullptr)
            return;
        if (!cJSON_IsNumber(item))
        {
            add_issue(r, vmaas::ConfigIssueKind::WrongType, field);
            return;
        }
        const double d = item->valuedouble;
        if (d != static_cast<double>(static_cast<long long>(d)))
        {
            add_issue(r, vmaas::ConfigIssueKind::WrongType, field);
            return;
        }
        const long long v = static_cast<long long>(d);
        if (v < lo || v > hi)
        {
            add_issue(r, vmaas::ConfigIssueKind::OutOfRange, field);
            return;
        }
        out = v;
    }
}

namespace vmaas
{
    DeviceConfig device_config_defaults()
    {
        DeviceConfig c{};
        c.name[0] = '\0';
        c.machine_id[0] = '\0';
        c.mqtt_host[0] = '\0';
        c.mqtt_port = 8883;
        c.mqtt_client_id[0] = '\0';
        c.keypad_debounce_ms = 20;
        c.slot_entry_timeout_ms = 10000;
        c.slot_entry_result_hold_ms = 2000;
        return c;
    }

    DeviceParseResult parse_device_config(const char* json_text)
    {
        DeviceParseResult r{};
        r.config = device_config_defaults();
        r.json_valid = false;
        r.ok = false;

        if (json_text == nullptr)
        {
            add_issue(r, ConfigIssueKind::InvalidJson, "");
            return r;
        }

        size_t offset = 0;
        if (nesting_too_deep(json_text, offset))
        {
            r.json_error_offset = offset;
            add_issue(r, ConfigIssueKind::InvalidJson, "");
            return r;
        }

        cJSON* root = cJSON_Parse(json_text);
        if (root == nullptr || !cJSON_IsObject(root))
        {
            const char* end = cJSON_GetErrorPtr();
            r.json_error_offset = (end != nullptr && end >= json_text)
                                      ? static_cast<size_t>(end - json_text)
                                      : 0;
            add_issue(r, ConfigIssueKind::InvalidJson, "");
            cJSON_Delete(root);
            return r;
        }
        r.json_valid = true;

        long long version = DEVICE_SCHEMA_VERSION;
        read_int(r, root, "version", 0, 1000000, "version", version);
        if (version > DEVICE_SCHEMA_VERSION)
            add_issue(r, ConfigIssueKind::NewerVersion, "version");

        const cJSON* device = cJSON_GetObjectItemCaseSensitive(root, "device");
        if (device != nullptr && cJSON_IsObject(device))
        {
            read_string(r, device, "name", r.config.name, MAX_DEVICE_NAME, "device.name");
            read_string(r, device, "machine_id", r.config.machine_id, MAX_MACHINE_ID, "device.machine_id");
        }
        else if (device != nullptr)
        {
            add_issue(r, ConfigIssueKind::WrongType, "device");
        }

        const cJSON* backend = cJSON_GetObjectItemCaseSensitive(root, "backend");
        if (backend != nullptr && cJSON_IsObject(backend))
        {
            read_string(r, backend, "mqtt_host", r.config.mqtt_host, MAX_MQTT_HOST, "backend.mqtt_host");
            read_string(r, backend, "client_id", r.config.mqtt_client_id, MAX_CLIENT_ID, "backend.client_id");
            long long port = r.config.mqtt_port;
            read_int(r, backend, "mqtt_port", PORT_MIN, PORT_MAX, "backend.mqtt_port", port);
            r.config.mqtt_port = static_cast<uint16_t>(port);
        }
        else if (backend != nullptr)
        {
            add_issue(r, ConfigIssueKind::WrongType, "backend");
        }

        const cJSON* timings = cJSON_GetObjectItemCaseSensitive(root, "timings");
        if (timings != nullptr && cJSON_IsObject(timings))
        {
            long long v = 0;
            v = r.config.keypad_debounce_ms;
            read_int(r, timings, "keypad_debounce_ms", TIMING_MIN, TIMING_MAX,
                     "timings.keypad_debounce_ms", v);
            r.config.keypad_debounce_ms = static_cast<uint32_t>(v);

            v = r.config.slot_entry_timeout_ms;
            read_int(r, timings, "slot_entry_timeout_ms", TIMING_MIN, TIMING_MAX,
                     "timings.slot_entry_timeout_ms", v);
            r.config.slot_entry_timeout_ms = static_cast<uint32_t>(v);

            v = r.config.slot_entry_result_hold_ms;
            read_int(r, timings, "slot_entry_result_hold_ms", TIMING_MIN, TIMING_MAX,
                     "timings.slot_entry_result_hold_ms", v);
            r.config.slot_entry_result_hold_ms = static_cast<uint32_t>(v);
        }
        else if (timings != nullptr)
        {
            add_issue(r, ConfigIssueKind::WrongType, "timings");
        }

        cJSON_Delete(root);

        r.ok = true;
        for (size_t i = 0; i < r.issue_count; ++i)
            if (r.issues[i].kind != ConfigIssueKind::NewerVersion)
                r.ok = false;
        return r;
    }
}
```

Note `ConfigIssue::field` is 20 bytes. `"timings.slot_entry_result_hold_ms"` is longer and `snprintf` truncates it. That is acceptable for a log line, but confirm the truncated text is still recognisable when you read the log in Task 8; if it is not, widen `field` in `config_issue.h` and re-run every test suite.

- [ ] **Step 5: Run the tests**

```bash
export PATH="/c/Users/temp/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" test -e native -d shared/vmaas-config -f test_device_parse 2>&1 | tail -20
```

Expected: 5 tests, all passing.

- [ ] **Step 6: Stage**

```bash
git add shared/vmaas-config/src/device_config.h shared/vmaas-config/src/device_config_parser.h shared/vmaas-config/src/device_config_parser.cpp shared/vmaas-config/test/test_device_parse
```

---

### Task 5: Validation and hostile input

Task 4 proved the parser reads a good file. This one proves it survives a bad one — including the case the depth guard exists for.

**Files:**
- Test: `shared/vmaas-config/test/test_device_validate/test_main.cpp`
- Modify: `shared/vmaas-config/src/device_config_parser.cpp` (only if a test exposes a gap)

**Interfaces:**
- Consumes: everything Task 4 produced
- Produces: nothing new

- [ ] **Step 1: Write the failing tests**

Create `shared/vmaas-config/test/test_device_validate/test_main.cpp`:

```c++
/**
 * @file test_main.cpp
 * @brief Host tests for parse_device_config() validation and hostile input.
 *
 * The contract under test: every rejection names its field, leaves the
 * default in place, and still returns a usable config. Nothing crashes and
 * nothing is silently truncated.
 */
#include <unity.h>
#include <cstring>
#include <string>
#include "device_config.h"
#include "device_config_parser.h"

using namespace vmaas;

namespace
{
    bool has_issue(const DeviceParseResult& r, ConfigIssueKind kind, const char* field)
    {
        for (size_t i = 0; i < r.issue_count; ++i)
            if (r.issues[i].kind == kind && std::strncmp(r.issues[i].field, field, 19) == 0)
                return true;
        return false;
    }
}

void setUp() {}
void tearDown() {}

void test_over_long_name_is_rejected_and_default_kept()
{
    // 17 characters: one too many for MAX_DEVICE_NAME.
    const DeviceParseResult r = parse_device_config(R"({"device": {"name": "ABCDEFGHIJKLMNOPQ"}})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "device.name"));
    TEST_ASSERT_EQUAL_STRING("", r.config.name);   // NOT truncated to 16 chars
}

void test_name_of_exactly_sixteen_chars_is_accepted()
{
    const DeviceParseResult r = parse_device_config(R"({"device": {"name": "ABCDEFGHIJKLMNOP"}})");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_STRING("ABCDEFGHIJKLMNOP", r.config.name);
}

void test_port_out_of_range_is_rejected_and_default_kept()
{
    const DeviceParseResult r = parse_device_config(R"({"backend": {"mqtt_port": 70000}})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "backend.mqtt_port"));
    TEST_ASSERT_EQUAL_UINT16(8883, r.config.mqtt_port);
}

void test_zero_timing_is_rejected_and_default_kept()
{
    const DeviceParseResult r = parse_device_config(R"({"timings": {"keypad_debounce_ms": 0}})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(20, r.config.keypad_debounce_ms);
}

void test_wrong_type_is_rejected_and_default_kept()
{
    const DeviceParseResult r = parse_device_config(R"({"backend": {"mqtt_port": "8883"}})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "backend.mqtt_port"));
    TEST_ASSERT_EQUAL_UINT16(8883, r.config.mqtt_port);
}

void test_malformed_json_still_yields_defaults()
{
    const DeviceParseResult r = parse_device_config(R"({"device": )");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_EQUAL_UINT32(20, r.config.keypad_debounce_ms);
    TEST_ASSERT_EQUAL_UINT16(8883, r.config.mqtt_port);
}

void test_nullptr_is_safe()
{
    const DeviceParseResult r = parse_device_config(nullptr);
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_EQUAL_UINT32(20, r.config.keypad_debounce_ms);
}

void test_non_object_root_is_rejected()
{
    const DeviceParseResult r = parse_device_config(R"([1, 2, 3])");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_FALSE(r.json_valid);
}

void test_deep_nesting_is_rejected_before_cjson_recurses()
{
    // 5000 opening brackets. Without the depth guard this recurses 5000 frames
    // deep inside cJSON and blows a FreeRTOS task stack on the device.
    std::string bomb(5000, '[');
    bomb.append(5000, ']');
    const DeviceParseResult r = parse_device_config(bomb.c_str());
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_TRUE(r.json_error_offset > 0);
    TEST_ASSERT_EQUAL_UINT32(20, r.config.keypad_debounce_ms);
}

void test_braces_inside_a_string_do_not_count_as_nesting()
{
    const DeviceParseResult r = parse_device_config(R"({"device": {"name": "{{{{{{{{{{"}})");
    TEST_ASSERT_TRUE(r.json_valid);   // depth is 2, not 12
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_over_long_name_is_rejected_and_default_kept);
    RUN_TEST(test_name_of_exactly_sixteen_chars_is_accepted);
    RUN_TEST(test_port_out_of_range_is_rejected_and_default_kept);
    RUN_TEST(test_zero_timing_is_rejected_and_default_kept);
    RUN_TEST(test_wrong_type_is_rejected_and_default_kept);
    RUN_TEST(test_malformed_json_still_yields_defaults);
    RUN_TEST(test_nullptr_is_safe);
    RUN_TEST(test_non_object_root_is_rejected);
    RUN_TEST(test_deep_nesting_is_rejected_before_cjson_recurses);
    RUN_TEST(test_braces_inside_a_string_do_not_count_as_nesting);
    return UNITY_END();
}
```

- [ ] **Step 2: Run them**

```bash
export PATH="/c/Users/temp/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" test -e native -d shared/vmaas-config -f test_device_validate 2>&1 | tail -25
```

Expected: 10 tests. Some may already pass from Task 4's implementation — that is fine and expected. Any that fail point at a real gap.

- [ ] **Step 3: Fix whatever failed**

Change `device_config_parser.cpp` only. Do not weaken a test to make it pass — in particular, `test_over_long_name_is_rejected_and_default_kept` asserts the value is *not* truncated, and that is the intended behaviour.

- [ ] **Step 4: Run the whole suite**

```bash
export PATH="/c/Users/temp/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" test -e native -d shared/vmaas-config 2>&1 | tail -25
```

Expected: all five suites pass — the three from before the rename plus `test_device_parse` and `test_device_validate`.

- [ ] **Step 5: Stage**

```bash
git add shared/vmaas-config
```

---

### Task 6: `shared/vmaas-fs`

Two functions that Main-Controller and Motorcontrol both need, in one place instead of two.

**Files:**
- Create: `shared/vmaas-fs/library.json`
- Create: `shared/vmaas-fs/src/storage.h`, `shared/vmaas-fs/src/storage.cpp`
- Create: `shared/vmaas-fs/README.md`

**Interfaces:**
- Consumes: nothing
- Produces: `bool vmaas::fs::mount(const char* partition_label, const char* mount_point)` and `int vmaas::fs::read_text_file(const char* path, char* buf, size_t capacity)`

No native tests. Both functions are thin wrappers over `esp_littlefs` and stdio; a mock of them would test the mock. They are covered by the hardware checks in Task 8.

- [ ] **Step 1: Write `library.json`**

```json
{
  "name": "vmaas-fs",
  "version": "0.1.0",
  "description": "LittleFS mount and whole-file text reading for VMaaS controllers",
  "keywords": ["littlefs", "filesystem", "vmaas"],
  "frameworks": "espidf",
  "platforms": "espressif32",
  "headers": ["storage.h"]
}
```

- [ ] **Step 2: Write `storage.h`**

```c++
#pragma once
/**
 * @file storage.h
 * @brief LittleFS mounting and whole-file reading, shared by both controllers.
 */
#include <cstddef>

namespace vmaas::fs
{
    /**
     * @brief Mount a LittleFS partition.
     *
     * Never formats: a partition that will not mount is a fault to report,
     * not damage to paper over. Logs the failure, or the usage on success.
     *
     * @param partition_label Name in partitions.csv, e.g. "storage".
     * @param mount_point VFS path, e.g. "/storage".
     * @return true if the filesystem is mounted.
     */
    bool mount(const char* partition_label, const char* mount_point);

    /**
     * @brief Read a whole text file into a buffer and NUL-terminate it.
     * @param path Absolute VFS path.
     * @param buf Destination buffer.
     * @param capacity Size of @p buf in bytes, including room for the NUL.
     * @return Bytes read (>= 0); -1 if the file cannot be opened or read;
     *         -2 if it does not fit or the arguments are invalid.
     */
    int read_text_file(const char* path, char* buf, size_t capacity);
}
```

- [ ] **Step 3: Write `storage.cpp`**

Move the bodies from `Motorcontrol/src/config_store.cpp` (currently lines 24-67), parameterising the mount:

```c++
#include "storage.h"

#include <cstdio>
#include "esp_littlefs.h"
#include "esp_log.h"

namespace
{
    constexpr const char* TAG = "VmaasFs";
}

namespace vmaas::fs
{
    bool mount(const char* partition_label, const char* mount_point)
    {
        esp_vfs_littlefs_conf_t conf = {};
        conf.base_path = mount_point;
        conf.partition_label = partition_label;
        conf.format_if_mount_failed = false;
        conf.dont_mount = false;

        const esp_err_t err = esp_vfs_littlefs_register(&conf);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "mount %s failed: %s", mount_point, esp_err_to_name(err));
            return false;
        }

        size_t total = 0, used = 0;
        if (esp_littlefs_info(partition_label, &total, &used) == ESP_OK)
            ESP_LOGI(TAG, "mounted %s: %u of %u bytes used", mount_point, (unsigned)used, (unsigned)total);
        else
            ESP_LOGW(TAG, "mounted %s, but usage query failed", mount_point);
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
        const bool failed_read = std::ferror(f) != 0;
        std::fclose(f);

        if (more || failed_read)
        {
            buf[0] = '\0';
            return failed_read ? -1 : -2;
        }
        buf[n] = '\0';
        return static_cast<int>(n);
    }
}
```

The `more` check matters: without it a file larger than the buffer would be read as a valid, silently shortened config.

- [ ] **Step 4: Write `README.md`**

One paragraph on what the library is for, that it is ESP-IDF only, why it has no host tests, and that both controllers depend on it.

- [ ] **Step 5: Stage**

```bash
git add shared/vmaas-fs
```

Nothing builds against it yet; Task 8 is where it is first compiled.

---

### Task 7: Partition table, filesystem and `config.json`

**Files:**
- Create: `Main-Controller/partitions.csv`
- Create: `Main-Controller/data/config.json`
- Create: `Main-Controller/sdkconfig.defaults`
- Create: `Main-Controller/src/idf_component.yml`
- Modify: `Main-Controller/platformio.ini`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces: a mounted `storage` partition holding `/storage/config.json`

- [ ] **Step 1: Write `partitions.csv`**

```
# Name,   Type, SubType,  Offset,   Size,     Flags
# 4 MB flash. storage = LittleFS, mounted at /storage by config_store.
nvs,      data, nvs,      0x9000,   0x6000,
phy_init, data, phy,      0xF000,   0x1000,
factory,  app,  factory,  0x10000,  0x200000,
storage,  data, littlefs, 0x210000, 0x1F0000,
```

2 MB for the application is deliberate headroom: the BLE provisioning example alone measured 1,111,685 bytes on this toolchain, and the onboarding work adds that on top of everything already here. Partitions cannot be resized without erasing flash.

- [ ] **Step 2: Write `sdkconfig.defaults`**

```
CONFIG_PARTITION_TABLE_CUSTOM=y
CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="partitions.csv"
CONFIG_PARTITION_TABLE_FILENAME="partitions.csv"
```

This survives regeneration of `sdkconfig.main-controller`, which the plain sdkconfig does not.

- [ ] **Step 3: Write `src/idf_component.yml`**

```yaml
dependencies:
  joltwallet/littlefs:
    version: "^1.14.0"
```

The IDF component manager runs during the PlatformIO build, so this is all that is needed. Output lands in `Main-Controller/managed_components/` and `dependencies.lock`.

- [ ] **Step 4: Add the two `platformio.ini` lines**

Under `[env:main-controller]`:

```ini
board_build.partitions = partitions.csv
board_build.filesystem = littlefs
```

- [ ] **Step 5: Write `data/config.json`**

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

This file is committed. It holds no secrets — that is the whole reason the Wi-Fi credentials went to NVS.

- [ ] **Step 6: Ignore `managed_components`**

Add to `.gitignore`, next to the existing Motorcontrol entry:

```
Main-Controller/managed_components/
```

- [ ] **Step 7: Build, then write the filesystem and the firmware**

```bash
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Main-Controller 2>&1 | tail -8
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Main-Controller -t uploadfs 2>&1 | tail -4
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Main-Controller -t upload 2>&1 | tail -4
```

All three must end in `[SUCCESS]`. Nothing reads the file yet; this proves the partition table and the LittleFS image are right before any code depends on them.

- [ ] **Step 8: Stage**

```bash
git add Main-Controller/partitions.csv Main-Controller/data Main-Controller/sdkconfig.defaults Main-Controller/src/idf_component.yml Main-Controller/platformio.ini Main-Controller/dependencies.lock .gitignore
```

---

### Task 8: `config_store` and wiring the config into `main.cpp`

**Files:**
- Create: `Main-Controller/src/config_store.h`, `Main-Controller/src/config_store.cpp`
- Modify: `Main-Controller/src/main.cpp`
- Modify: `Main-Controller/src/config.h`
- Modify: `shared/vmaas-keypad/src/keypad.h` (add `set_debounce_ms()`)
- Modify: `shared/vmaas-entry/src/slot_entry.h` (add `set_timeout_ms()`)
- Test: the existing native suites of `shared/vmaas-keypad` and `shared/vmaas-entry`, one new test each

**Interfaces:**
- Consumes: `vmaas::fs::mount()`, `vmaas::fs::read_text_file()` (Task 6); `vmaas::parse_device_config()`, `vmaas::DeviceConfig` (Tasks 4-5)
- Produces: `vmaas::DeviceConfig config_store::load()`

- [ ] **Step 1: Write `config_store.h`**

```c++
#pragma once
/**
 * @file config_store.h
 * @brief LittleFS mount and device-config loading for Main-Controller.
 *
 * The only firmware module that touches the filesystem. Parsing lives in the
 * shared vmaas-config library; mounting and reading live in vmaas-fs. This
 * module reads bytes, logs, and hands app_main a struct.
 *
 * There is no failure path. Unlike Motorcontrol, whose config decides which
 * motor turns, this file holds identity and timings: a vending machine that
 * will not sell is worse than one that sells while unreachable. A missing or
 * broken file yields the built-in defaults and one warning.
 */
#include "device_config.h"

namespace config_store
{
    constexpr const char* MOUNT_POINT     = "/storage";            ///< VFS mount point.
    constexpr const char* PARTITION_LABEL = "storage";             ///< Name in partitions.csv.
    constexpr const char* CONFIG_PATH     = "/storage/config.json";///< Device configuration file.

    /// Largest config.json accepted, in bytes including the NUL. Bigger files are rejected.
    constexpr size_t MAX_CONFIG_BYTES = 2048;

    /**
     * @brief Mount storage, read CONFIG_PATH, parse it and log the outcome.
     *
     * Logs one warning per issue at WARN and the resulting settings at INFO.
     * @return Settings that are always usable, defaults included.
     */
    vmaas::DeviceConfig load();
}
```

- [ ] **Step 2: Write `config_store.cpp`**

```c++
#include "config_store.h"

#include "esp_log.h"
#include "storage.h"
#include "device_config_parser.h"

namespace
{
    constexpr const char* TAG = "ConfigStore";
}

namespace config_store
{
    vmaas::DeviceConfig load()
    {
        if (!vmaas::fs::mount(PARTITION_LABEL, MOUNT_POINT))
        {
            ESP_LOGW(TAG, "storage not mounted, using built-in defaults");
            return vmaas::device_config_defaults();
        }

        // Boot-time only, called once from app_main; .bss rather than the task stack.
        static char text[MAX_CONFIG_BYTES];
        const int n = vmaas::fs::read_text_file(CONFIG_PATH, text, sizeof(text));
        if (n == -1)
        {
            ESP_LOGW(TAG, "%s missing or unreadable, using built-in defaults", CONFIG_PATH);
            return vmaas::device_config_defaults();
        }
        if (n == -2)
        {
            ESP_LOGW(TAG, "%s larger than %u bytes, using built-in defaults",
                     CONFIG_PATH, (unsigned)MAX_CONFIG_BYTES);
            return vmaas::device_config_defaults();
        }

        const vmaas::DeviceParseResult r = vmaas::parse_device_config(text);
        if (!r.json_valid)
            ESP_LOGW(TAG, "%s is not valid JSON at byte %u", CONFIG_PATH, (unsigned)r.json_error_offset);
        for (size_t i = 0; i < r.issue_count; ++i)
            ESP_LOGW(TAG, "config %s: %s",
                     r.issues[i].field[0] ? r.issues[i].field : "(file)",
                     vmaas::to_string(r.issues[i].kind));

        ESP_LOGI(TAG, "name '%s' machine_id '%s'", r.config.name, r.config.machine_id);
        ESP_LOGI(TAG, "mqtt %s:%u client '%s'",
                 r.config.mqtt_host, (unsigned)r.config.mqtt_port, r.config.mqtt_client_id);
        ESP_LOGI(TAG, "timings debounce %u entry %u hold %u ms",
                 (unsigned)r.config.keypad_debounce_ms,
                 (unsigned)r.config.slot_entry_timeout_ms,
                 (unsigned)r.config.slot_entry_result_hold_ms);
        return r.config;
    }
}
```

- [ ] **Step 3: Give `Keypad` and `SlotEntry` setters for their timings**

`keypad` and `entry` are constructed at file scope in `main.cpp`'s anonymous namespace, before `app_main` runs:

```c++
    vmaas::Keypad keypad(keypad_port, Config::keypad_debounce_ms);
    vmaas::SlotEntry entry(vmaas::SLOT_ENTRY_MAX_DIGITS, Config::slot_entry_timeout_ms);
```

The config is not known that early. Both classes take their timing as a constructor argument with a default and keep it in a private member (`debounce_ms_`, `timeout_ms_`), and neither has a setter. Adding one is far less churn than restructuring `main.cpp` around late construction.

In `shared/vmaas-keypad/src/keypad.h`, in the public section of `Keypad`:

```c++
        /**
         * @brief Change the debounce window after construction.
         *
         * The Main-Controller reads this from config.json, which is not
         * available when the object is constructed at file scope.
         * @param debounce_ms How long a raw state must hold before it is accepted.
         */
        void set_debounce_ms(uint32_t debounce_ms) { debounce_ms_ = debounce_ms; }
```

In `shared/vmaas-entry/src/slot_entry.h`, in the public section of `SlotEntry`:

```c++
        /**
         * @brief Change the inactivity timeout after construction.
         * @param timeout_ms Inactivity before a partial entry is discarded. 0 disables the timeout.
         */
        void set_timeout_ms(uint32_t timeout_ms) { timeout_ms_ = timeout_ms; }
```

Add a test for each to the existing native suites — a setter with no test is a setter nobody notices breaking. Append to the relevant `test_main.cpp` and add the matching `RUN_TEST(...)` line to its `main()`:

```c++
void test_set_timeout_ms_changes_when_entry_expires()
{
    SlotEntry e(SLOT_ENTRY_MAX_DIGITS, 10000);
    e.set_timeout_ms(3000);
    e.press('1', 0);
    const EntryState before = e.poll(2999);
    TEST_ASSERT_EQUAL(EntryStatus::Editing, before.status);
    const EntryState after = e.poll(3001);
    TEST_ASSERT_EQUAL(EntryStatus::Idle, after.status);
}
```

Adjust the method and enumerator names to match what `slot_entry.h` actually exposes — read the header before writing the test rather than assuming. The behaviour being pinned is: after `set_timeout_ms(3000)`, a partial entry expires just after 3000 ms and not before.

Run both suites:

```bash
export PATH="/c/Users/temp/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin:$PATH"
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" test -e native -d shared/vmaas-entry 2>&1 | tail -10
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" test -e native -d shared/vmaas-keypad 2>&1 | tail -10
```

Expected: the previous counts plus one each, all passing.

- [ ] **Step 4: Use the loaded values in `main.cpp`**

Add the include:

```c++
#include "config_store.h"
```

Change the file-scope construction to use the library defaults, since the real values arrive in `app_main`:

```c++
    vmaas::Keypad keypad(keypad_port);
    vmaas::SlotEntry entry(vmaas::SLOT_ENTRY_MAX_DIGITS);
```

Add a file-scope variable for the result-hold time, replacing the `Config::` constant that `render()` reads:

```c++
    uint32_t result_hold_ms = 2000; // overwritten from config.json in app_main
```

and change `render()` to use `result_hold_ms` wherever it currently uses `Config::slot_entry_result_hold_ms`.

At the very top of `app_main()`, before the UART, display and keypad setup:

```c++
    const vmaas::DeviceConfig cfg = config_store::load();
    keypad.set_debounce_ms(cfg.keypad_debounce_ms);
    entry.set_timeout_ms(cfg.slot_entry_timeout_ms);
    result_hold_ms = cfg.slot_entry_result_hold_ms;
```

`config_store::load()` mounts LittleFS, so it must run before anything else that touches storage. It does not depend on the display, so a mount failure is logged and the machine carries on.

- [ ] **Step 5: Remove the moved constants from `config.h`**

Delete `keypad_debounce_ms`, `slot_entry_timeout_ms` and `slot_entry_result_hold_ms`. **Keep** `baud_rate`, `i2c_clock_hz`, `keypad_scan_interval_ms`, `keypad_queue_depth`, `keypad_task_stack` and `keypad_task_priority` — the spec's §5.2 explains why each of those stays compile-time. `keypad_scan_interval_ms` in particular must remain a whole number of 10 ms ticks or `xTaskDelayUntil` asserts.

- [ ] **Step 6: Build**

```bash
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Main-Controller 2>&1 | tail -8
```

Expected: `[SUCCESS]`.

- [ ] **Step 7: Hardware check 1 — the good file**

```bash
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Main-Controller -t uploadfs 2>&1 | tail -3
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Main-Controller -t upload 2>&1 | tail -3
```

Read the boot log. Expected: `mounted /storage: ... bytes used`, then `name 'VMaaS-0042' machine_id '5f2c1a90-...'`, then the mqtt and timings lines. The slot prompt appears on the LCD.

- [ ] **Step 8: Hardware check 2 — the missing file**

Move `data/config.json` aside, `-t uploadfs`, reboot, read the log.

Expected: exactly one warning `.../config.json missing or unreadable, using built-in defaults`, then the defaults logged, then the slot prompt. **Enter a slot on the keypad and confirm it still works.** That is the behaviour §10 of the spec was chosen for. Put the file back afterwards.

- [ ] **Step 9: Hardware check 3 — the broken file**

Put `{"device": ` (deliberately truncated) in `data/config.json`, `-t uploadfs`, reboot, read the log.

Expected: `is not valid JSON at byte N`, the defaults logged, the slot prompt appears. Restore the good file and `-t uploadfs` again.

- [ ] **Step 10: Hardware check 4 — a value that actually takes effect**

Set `slot_entry_timeout_ms` to `3000` in `data/config.json`, `-t uploadfs`, reboot. Type one digit on the keypad and wait. Expected: the partial entry is discarded after roughly 3 seconds, not 10. Restore `10000` and `-t uploadfs`.

This is the check that proves the file is actually driving behaviour rather than just being logged.

- [ ] **Step 11: Stage**

```bash
git add Main-Controller/src shared/vmaas-keypad shared/vmaas-entry
```

---

### Task 9: Move Motorcontrol onto `vmaas-fs` (droppable)

Removes the last duplicate of `mount_storage()` and `read_text_file()`. This is the only task that changes a board which works today, which is why it is last: dropping it costs one duplicated pair of functions and nothing else.

**Files:**
- Modify: `Motorcontrol/src/config_store.h`, `Motorcontrol/src/config_store.cpp`

**Interfaces:**
- Consumes: `vmaas::fs::mount()`, `vmaas::fs::read_text_file()` (Task 6)
- Produces: nothing new. `config_store::load_config()` keeps its exact signature and behaviour.

- [ ] **Step 1: Delete the two function bodies**

Remove `mount_storage()` and `read_text_file()` from `Motorcontrol/src/config_store.cpp` (currently lines 24-67) and their declarations from `config_store.h`.

- [ ] **Step 2: Call the shared ones instead**

In `config_store.cpp`, replace `#include "esp_littlefs.h"` with `#include "storage.h"`, and inside `load_config()`:

```c++
        const int n = vmaas::fs::read_text_file(CONFIG_PATH, text, sizeof(text));
```

- [ ] **Step 3: Update the caller of `mount_storage()`**

Find it and point it at the shared function:

```bash
grep -rn 'mount_storage' Motorcontrol/src
```

Replace with:

```c++
    vmaas::fs::mount(config_store::PARTITION_LABEL, config_store::MOUNT_POINT)
```

- [ ] **Step 4: Build**

```bash
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Motorcontrol 2>&1 | tail -8
```

Expected: `[SUCCESS]`.

- [ ] **Step 5: Hardware smoke test on the Motorcontrol board (COM7)**

This board works today and this task is the only thing in the plan that could break it. Flash it, read the boot log, and confirm the slot table is still parsed and logged exactly as before:

```bash
"C:/Users/temp/.platformio/penv/Scripts/pio.exe" run -d Motorcontrol -t upload 2>&1 | tail -3
```

Expected: the same `mounted /storage` and slot-table lines as before the change. Then dispense one slot end to end from the Main-Controller to prove the UART path still works.

- [ ] **Step 6: Stage**

```bash
git add Motorcontrol/src
```

---

## Done when

- [ ] `pio run -d Main-Controller` succeeds — branch `dev` builds again
- [ ] `pio test -e native -d shared/vmaas-config` passes all five suites
- [ ] The boot log shows the values from `config.json`
- [ ] Deleting `config.json` leaves the machine able to sell, with one warning
- [ ] A changed `slot_entry_timeout_ms` visibly changes behaviour
- [ ] No Arduino header remains: `grep -rn 'WiFi.h\|Arduino.h' Main-Controller/src` is empty
- [ ] No credential remains in version control: `grep -rn 'VMaaS123' Main-Controller` is empty
- [ ] Everything is staged; **nothing is committed**
