# HX-916 Coin Acceptor and Cash Purchase Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer pay for a vend with coins from an HX-916 acceptor: pick a slot on the keypad, watch the LCD count down what is still missing, and get the product the moment the credit covers the price — with the sale queued on flash and reported to the backend over the existing mTLS HTTPS path.

**Architecture:** Two new hardware-free PlatformIO libraries carry all the logic. `shared/vmaas-coin` turns timestamped GPIO edges into coin values; `shared/vmaas-purchase` turns a slot choice plus coin values into decisions (show this, inhibit the slot, run the motor, settle the sale). Main-Controller supplies the hardware: an ISR that only timestamps edges, a price table read from the cached device configuration, an append-only JSONL outbox on LittleFS, and a drain task that POSTs to `/device/events`. The backend gains one event-type handler that writes `Sale` and `InventoryMovement` in a single transaction, idempotent on `eventId`.

**Tech Stack:** ESP-IDF 6.1 via PlatformIO 6.2 (`framework = espidf`, `board = esp32dev`), C++17, Unity on PlatformIO `native` for host tests, `esp_http_client` + `esp_crt_bundle` for mTLS, `espressif__cjson` for JSON, LittleFS via `joltwallet/littlefs`. Backend: Express 5, Prisma 7.10.0, Zod 4, vitest.

**Spec:** `docs/superpowers/specs/2026-09-21-hx916-coin-payment-design.md`

## Global Constraints

- **Never commit.** The project owner forbids `git commit` entirely; a deny rule enforces it in `.claude/settings.json`. Every task therefore ends with a **Verify** step, not a commit. Leave changes in the working tree.
- **Money is integer minor units (øre) everywhere on the device.** No floating point touches a price, a credit or a coin value. `uint32_t`, named `*_minor`.
- **Coins accepted: 5 kr, 10 kr, 20 kr only** — pulse counts 1, 2, 3 mapping to 500, 1000, 2000. Programmed by hand on the acceptor.
- **Credit is never carried between customers.** Residual credit is forfeited on every terminal path.
- **The purchase path never calls the network synchronously.** A coin cannot be rolled back, so payment must work with the network down.
- **Both new libraries are hardware-free.** No `driver/gpio.h`, no `esp_*`, no `freertos/*` in `coin_acceptor.*` or `purchase.*`. They must compile and pass under `platform = native`.
- **`REQUIRES` in `Main-Controller/src/CMakeLists.txt` is exhaustive.** Naming any `REQUIRES` replaces the implicit set, so every component whose headers the app includes must be listed there or the build fails with "No such file or directory".
- **Code, comments and docs in English.** LCD strings stay ASCII English, 16 columns per row.
- **`docs/superpowers/**` is gitignored** (line 47 of `.gitignore`), so this plan and its spec are intentionally untracked.

---

## Toolchain notes (Windows host)

`pio` is not on the tool shell's PATH. Use the full path. WinLibs GCC is on the user PATH but Git Bash in this tool needs the prefix.

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

- Host tests: run from the library directory, e.g. `shared/vmaas-coin`: `$PIO test -e native` (all) or `$PIO test -e native -f test_decode` (one folder).
- Firmware build: from `Main-Controller`: `$PIO run -e main-controller`.
- Firmware upload: `$PIO run -e main-controller -t upload`. Close any serial monitor on COM6 first; a held port makes the upload fail.
- Filesystem image: `$PIO run -e main-controller -t uploadfs`.
- Serial capture: `pio device monitor` needs a TTY and will not run here. Use `$PY ../tools/capture_serial.py COM6 8` from `Main-Controller`.
- Backend tests: from `backend`: `npm run test` (vitest run) or `npx vitest run src/api/services/__tests__/device-cash-sale.test.ts`.
- **Device without hardware:** `backend/tools/fake-machine.ts` (`npm run fake-machine`) stands in for a machine — it activates over HTTPS mTLS, connects to EMQX, and fetches `GET /api/device/configuration` with its issued certificate. Task 11 extends it to POST a cash sale, so the whole backend path is provable before an HX-916 is on the bench.
- The device's stored `api_base_url` already ends in `/api` — `activation.cpp` builds `"%s/device/activate"` from it, and the fake machine's default is `https://localhost:8443/api/device/activate`. So `device_api::post_json_mtls("/device/events", ...)` resolves correctly; do not add `/api` a second time.
- The WROVER board is on COM6. Motorcontrol (WROOM) is on COM7 and must be running for any end-to-end vend.
- `CONFIG_FREERTOS_HZ=100`, so one FreeRTOS tick is 10 ms. This is why the coin input is interrupt-driven rather than polled: the acceptor's fastest pulse setting is 20 ms, only two ticks wide.

---

## Learning checkpoints

Two spots carry decisions the project owner wants to make personally. They are marked **OWNER DECISION** in the tasks below. The executor must **not** silently pick one: implement the stated default, leave the alternative in a comment, and flag it in the task report so the owner can change it.

- **Task 2, an unrecognised pulse train.** The acceptor took a coin whose pulse count is not in the value table. The money is in the box and its value is unknown. Crediting a guess cheats one party; crediting nothing cheats the other.
- **Task 5, a coin arriving during `Dispensing`.** The motor is running and the sale is already settled. Does that coin join the next purchase, count into the current one, or get discarded?

---

## File Structure

**New — `shared/vmaas-coin/`** (hardware-free decoder plus its ESP port)

| File | Responsibility |
|------|----------------|
| `platformio.ini` | `[env:native]`, Unity, `-std=c++17 -Wall -Wextra` |
| `library.json` | Manifest, so `lib_extra_dirs = ../shared` finds it |
| `src/coin_acceptor.h` | `CoinEvent`, `CoinConfig`, `CoinAcceptor`. No hardware includes. |
| `src/coin_acceptor.cpp` | Pulse-train decoding: debounce, train boundary, value lookup |
| `src/esp_coin_port.h` | `EspCoinPort`: GPIO ISR, edge queue, INHIBIT pin |
| `src/esp_coin_port.cpp` | ESP-IDF only. Excluded from the native build by `#ifdef ESP_PLATFORM`. |
| `test/test_decode/test_main.cpp` | One coin of each type, value lookup |
| `test/test_noise/test_main.cpp` | Short pulses rejected, train boundaries, polarity |

**New — `shared/vmaas-purchase/`** (hardware-free state machine)

| File | Responsibility |
|------|----------------|
| `platformio.ini` | `[env:native]`, Unity, includes `-I../vmaas-coin/src` |
| `library.json` | Manifest |
| `src/purchase.h` | `PurchaseState`, `SaleStatus`, `PurchaseOutput`, `PurchaseConfig`, `Purchase` |
| `src/purchase.cpp` | The state machine |
| `src/sale_line.h` | `SaleLine` plus `format_sale_line()` — the outbox line, hardware-free so it is host-testable |
| `src/sale_line.cpp` | JSON line formatting |
| `test/test_happy_path/test_main.cpp` | Exact payment end to end |
| `test/test_edges/test_main.cpp` | Overpayment, timeout, cancel, failed vend, coin in Idle |
| `test/test_sale_line/test_main.cpp` | The exact JSON text the backend must receive |

**New — `Main-Controller/src/`**

| File | Responsibility |
|------|----------------|
| `device_api.{h,cpp}` | The HTTPS client lifted out of `activation.cpp`, shared by activation, configuration fetch and outbox drain |
| `prices.{h,cpp}` | Parses the `cash` and `prices` blocks of the cached configuration blob |
| `outbox.{h,cpp}` | Append-only JSONL on LittleFS: append + fsync, read oldest, drop oldest, partial-line recovery, size cap |
| `purchase_task.{h,cpp}` | Owns `CoinAcceptor`, `Purchase` and the drain task; the only place that touches all of coin, entry, LCD, motor and outbox |

**Modified**

| File | Change |
|------|--------|
| `Main-Controller/src/pins.h` | Add `COIN_IN = 35`, `INHIBIT_OUT = 4` |
| `Main-Controller/src/CMakeLists.txt` | Nothing new is required; `esp_http_client`, `driver`, `esp_timer`, `espressif__cjson` are already listed. Confirm, do not edit blindly. |
| `Main-Controller/src/activation.cpp` | `activate()` calls `device_api::post_json` instead of building its own client |
| `Main-Controller/src/activation.h` | Note that `sync_time` is now also called on every Wi-Fi connect |
| `Main-Controller/src/main.cpp` | Route `SlotEntry::Confirmed` into `purchase_task` instead of straight to the LCD; route `on_done`/`on_nak` into it too |
| `Main-Controller/src/wifi_sta.cpp` | Call `activation::sync_time` on a successful connect |
| `backend/src/api/services/device.service.ts` | `recordDeviceEventService` handles `type: "cash_sale"`; `DeviceDb` gains `sale` and `inventoryMovement` |
| `shared/schemas/device.ts` | `cashSalePayloadSchema` for the payload of a `cash_sale` event |

---

## Task 1: `vmaas-coin` scaffold and decoding one coin

**Files:**
- Create: `shared/vmaas-coin/platformio.ini`
- Create: `shared/vmaas-coin/library.json`
- Create: `shared/vmaas-coin/.gitignore`
- Create: `shared/vmaas-coin/src/coin_acceptor.h`
- Create: `shared/vmaas-coin/src/coin_acceptor.cpp`
- Test: `shared/vmaas-coin/test/test_decode/test_main.cpp`

**Interfaces:**
- Consumes: nothing.
- Produces: `vmaas::CoinEvent{uint8_t pulses; uint32_t value_minor;}`, `vmaas::CoinConfig{bool active_low; uint16_t min_pulse_ms; uint16_t train_gap_ms; uint32_t value_by_pulses[9];}`, and `vmaas::CoinAcceptor` with `explicit CoinAcceptor(const CoinConfig&)`, `void on_edge(uint32_t at_ms, bool level)`, `bool tick(uint32_t now_ms, CoinEvent &out)`, `uint32_t rejected_pulses() const`, `uint32_t unknown_trains() const`.

- [ ] **Step 1: Create the library scaffold**

`shared/vmaas-coin/platformio.ini`:

```ini
; Host-side unit tests for the shared coin-acceptor library.
; Run from this directory: pio test -e native
; The decoder is hardware-free; esp_coin_port.cpp is guarded by ESP_PLATFORM
; so it is compiled out of this build entirely.
[env:native]
platform = native
test_framework = unity
test_build_src = yes
build_flags = -std=c++17 -Wall -Wextra
```

`shared/vmaas-coin/library.json`:

```json
{
  "name": "vmaas-coin",
  "version": "0.1.0",
  "description": "Pulse-train decoder for the HX-916 multi-coin acceptor",
  "keywords": ["coin", "payment", "hx-916", "vmaas"],
  "frameworks": "*",
  "platforms": "*",
  "headers": ["coin_acceptor.h", "esp_coin_port.h"]
}
```

`shared/vmaas-coin/.gitignore`:

```
.pio/
```

- [ ] **Step 2: Write the failing test**

`shared/vmaas-coin/test/test_decode/test_main.cpp`:

```cpp
/**
 * @file test_main.cpp
 * @brief Host tests for decoding one pulse train into one coin value.
 *
 * The acceptor is programmed so the pulse count identifies the coin: one
 * pulse is 5 kr, two is 10 kr, three is 20 kr. A train is only complete once
 * the line has been quiet for train_gap_ms, so every test drives tick() past
 * that boundary before expecting a value.
 */
#include <unity.h>
#include "coin_acceptor.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

// The bench calibration: pulses 1..3 are the three accepted Danish coins.
static CoinConfig danish_coins()
{
    CoinConfig cfg;
    cfg.active_low = true;
    cfg.min_pulse_ms = 15;
    cfg.train_gap_ms = 250;
    cfg.value_by_pulses[1] = 500;
    cfg.value_by_pulses[2] = 1000;
    cfg.value_by_pulses[3] = 2000;
    return cfg;
}

// Drive one active-low pulse of `width_ms` starting at `at_ms`.
static void pulse(CoinAcceptor &c, uint32_t at_ms, uint32_t width_ms)
{
    c.on_edge(at_ms, false);            // falling: the coin pulls the line low
    c.on_edge(at_ms + width_ms, true);  // rising: back to idle
}

void test_one_pulse_is_five_kroner()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    pulse(c, 1000, 100);

    // Still inside the gap: the train is not closed yet.
    TEST_ASSERT_FALSE(c.tick(1200, ev));
    // Past the gap, measured from the last edge at 1100.
    TEST_ASSERT_TRUE(c.tick(1350, ev));
    TEST_ASSERT_EQUAL_UINT8(1, ev.pulses);
    TEST_ASSERT_EQUAL_UINT32(500, ev.value_minor);
}

void test_two_pulses_are_ten_kroner()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    pulse(c, 1000, 100);
    pulse(c, 1200, 100);

    TEST_ASSERT_TRUE(c.tick(1600, ev));
    TEST_ASSERT_EQUAL_UINT8(2, ev.pulses);
    TEST_ASSERT_EQUAL_UINT32(1000, ev.value_minor);
}

void test_three_pulses_are_twenty_kroner()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    pulse(c, 1000, 100);
    pulse(c, 1200, 100);
    pulse(c, 1400, 100);

    TEST_ASSERT_TRUE(c.tick(1800, ev));
    TEST_ASSERT_EQUAL_UINT8(3, ev.pulses);
    TEST_ASSERT_EQUAL_UINT32(2000, ev.value_minor);
}

// One train yields exactly one event, however many times tick() is called.
void test_a_train_is_reported_once()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    pulse(c, 1000, 100);

    TEST_ASSERT_TRUE(c.tick(1400, ev));
    TEST_ASSERT_FALSE(c.tick(1500, ev));
    TEST_ASSERT_FALSE(c.tick(9000, ev));
}

// Two coins far apart are two coins, not one five-pulse train.
void test_two_coins_separated_by_more_than_the_gap()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    pulse(c, 1000, 100);
    TEST_ASSERT_TRUE(c.tick(1400, ev));
    TEST_ASSERT_EQUAL_UINT32(500, ev.value_minor);

    pulse(c, 5000, 100);
    pulse(c, 5200, 100);
    TEST_ASSERT_TRUE(c.tick(5600, ev));
    TEST_ASSERT_EQUAL_UINT32(1000, ev.value_minor);
}

// A fresh acceptor has nothing to report and no anomalies.
void test_idle_acceptor_reports_nothing()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    for (uint32_t t = 0; t < 10000; t += 500)
        TEST_ASSERT_FALSE(c.tick(t, ev));

    TEST_ASSERT_EQUAL_UINT32(0, c.rejected_pulses());
    TEST_ASSERT_EQUAL_UINT32(0, c.unknown_trains());
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_one_pulse_is_five_kroner);
    RUN_TEST(test_two_pulses_are_ten_kroner);
    RUN_TEST(test_three_pulses_are_twenty_kroner);
    RUN_TEST(test_a_train_is_reported_once);
    RUN_TEST(test_two_coins_separated_by_more_than_the_gap);
    RUN_TEST(test_idle_acceptor_reports_nothing);
    return UNITY_END();
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run from `shared/vmaas-coin`:

```bash
$PIO test -e native -f test_decode
```

Expected: FAIL at compile time — `coin_acceptor.h: No such file or directory`.

- [ ] **Step 4: Write the header**

`shared/vmaas-coin/src/coin_acceptor.h`:

```cpp
#pragma once
/**
 * @file coin_acceptor.h
 * @brief Decodes HX-916 pulse trains into coin values.
 *
 * Hardware-free on purpose: the decoder only ever sees timestamped edges, so
 * the whole of it runs under `platform = native`. The ISR that produces those
 * edges lives in esp_coin_port.h and does nothing but timestamp and queue.
 *
 * The acceptor emits one pulse train per accepted coin, and the number of
 * pulses identifies which coin it was. A train is complete when the line has
 * been quiet for CoinConfig::train_gap_ms.
 */
#include <cstdint>

namespace vmaas
{
    /// Largest pulse count the acceptor can be programmed to emit.
    constexpr uint8_t COIN_MAX_PULSES = 8;

    /// One accepted coin, decoded from a pulse train.
    struct CoinEvent
    {
        uint8_t  pulses = 0;      ///< Pulses counted in the train.
        uint32_t value_minor = 0; ///< Coin value in minor units. 0 = unrecognised.
    };

    /**
     * @brief Calibration for one acceptor, loaded from the device configuration.
     *
     * Every field is configuration rather than a constant because all of them
     * depend on switches on the acceptor itself, which a technician may change
     * in the field. See spec section 3.4.
     */
    struct CoinConfig
    {
        /// True when a coin pulls the line low. Which way round it is depends
        /// on the NO/NC switch and on how the optocoupler is wired, so it must
        /// be observed on the bench, never assumed.
        bool active_low = true;
        /// Pulses shorter than this are contact noise or a solenoid spike.
        uint16_t min_pulse_ms = 15;
        /// Silence this long ends a train. Must sit between the spacing of
        /// pulses within one coin and the spacing of two coins by hand.
        uint16_t train_gap_ms = 250;
        /// pulses -> value in minor units, index 1..COIN_MAX_PULSES.
        /// 0 means "this pulse count is not a coin".
        uint32_t value_by_pulses[COIN_MAX_PULSES + 1] = {};
    };

    /**
     * @brief Turns a stream of edges into CoinEvents.
     *
     * Usage: drain the ISR queue into on_edge(), then call tick() every loop
     * pass. tick() is what closes a train, so it must be called even when no
     * edges arrive.
     */
    class CoinAcceptor
    {
    public:
        explicit CoinAcceptor(const CoinConfig &cfg);

        /**
         * @brief Feed one edge. Never call this from an ISR.
         * @param at_ms  When the edge happened.
         * @param level  The new line level, raw, before active_low is applied.
         */
        void on_edge(uint32_t at_ms, bool level);

        /**
         * @brief Close a train whose gap has elapsed.
         * @return True when @p out has been filled with a completed coin.
         */
        bool tick(uint32_t now_ms, CoinEvent &out);

        uint32_t rejected_pulses() const { return rejected_pulses_; }
        uint32_t unknown_trains() const { return unknown_trains_; }

    private:
        /// True when @p level means "the acceptor is asserting a pulse".
        bool asserted(bool level) const { return cfg_.active_low ? !level : level; }
        uint32_t value_for(uint8_t pulses) const;

        CoinConfig cfg_;
        bool     in_pulse_ = false;    ///< A pulse is currently asserted.
        uint32_t pulse_start_ms_ = 0;  ///< When the current pulse began.
        uint8_t  pulses_ = 0;          ///< Pulses counted in the open train.
        uint32_t last_edge_ms_ = 0;    ///< When the train last saw an edge.
        uint32_t rejected_pulses_ = 0;
        uint32_t unknown_trains_ = 0;
    };
}
```

- [ ] **Step 5: Write the implementation**

`shared/vmaas-coin/src/coin_acceptor.cpp`:

```cpp
/**
 * @file coin_acceptor.cpp
 * @brief Pulse-train decoding. See coin_acceptor.h for the contract.
 */
#include "coin_acceptor.h"

namespace vmaas
{
    CoinAcceptor::CoinAcceptor(const CoinConfig &cfg) : cfg_(cfg) {}

    void CoinAcceptor::on_edge(uint32_t at_ms, bool level)
    {
        const bool now_asserted = asserted(level);

        if (now_asserted && !in_pulse_)
        {
            in_pulse_ = true;
            pulse_start_ms_ = at_ms;
            return;
        }

        if (!now_asserted && in_pulse_)
        {
            in_pulse_ = false;

            // A pulse too short to be mechanical is noise: count it and drop
            // it without touching the train, so a spike cannot turn a 5 kr
            // coin into a 10 kr one.
            if (at_ms - pulse_start_ms_ < cfg_.min_pulse_ms)
            {
                ++rejected_pulses_;
                return;
            }

            if (pulses_ < COIN_MAX_PULSES)
                ++pulses_;
            last_edge_ms_ = at_ms;
        }
    }

    bool CoinAcceptor::tick(uint32_t now_ms, CoinEvent &out)
    {
        if (pulses_ == 0) return false;          // nothing open
        if (in_pulse_) return false;             // still mid-pulse
        if (now_ms - last_edge_ms_ < cfg_.train_gap_ms) return false;

        out.pulses = pulses_;
        out.value_minor = value_for(pulses_);
        pulses_ = 0;

        return true;
    }

    uint32_t CoinAcceptor::value_for(uint8_t pulses) const
    {
        if (pulses == 0 || pulses > COIN_MAX_PULSES) return 0;
        return cfg_.value_by_pulses[pulses];
    }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
$PIO test -e native -f test_decode
```

Expected: PASS, 6 tests.

- [ ] **Step 7: Verify**

Run the whole library suite and confirm nothing else in `shared/` broke:

```bash
cd shared/vmaas-coin && $PIO test -e native
cd ../vmaas-entry && $PIO test -e native
```

Expected: `vmaas-coin` 6/6 pass; `vmaas-entry` unchanged (97 pass, measured 2026-09-21). Report both counts. **Do not commit.**

---

## Task 2: Noise rejection, polarity and the unrecognised train

**Files:**
- Modify: `shared/vmaas-coin/src/coin_acceptor.cpp` (the unknown-train branch)
- Test: `shared/vmaas-coin/test/test_noise/test_main.cpp`

**Interfaces:**
- Consumes: everything Task 1 produced.
- Produces: no new signatures. `unknown_trains()` becomes meaningful, and `CoinEvent::value_minor == 0` becomes a documented outcome the caller must handle.

> **OWNER DECISION — an unrecognised pulse train.** The acceptor has accepted a coin whose pulse count is not in `value_by_pulses`. The money is in the box and its value is unknown.
>
> **Implement this default:** report the event with `value_minor = 0` and increment `unknown_trains()`. The caller credits nothing, so the customer loses the coin.
>
> **The alternative:** credit the lowest configured coin value, so the customer is never out of pocket and the operator absorbs the difference.
>
> Leave both in a comment at the decision point, implement the default, and flag it in the task report. Do not pick the alternative without the owner saying so.

- [ ] **Step 1: Write the failing test**

`shared/vmaas-coin/test/test_noise/test_main.cpp`:

```cpp
/**
 * @file test_main.cpp
 * @brief Host tests for everything that is not a clean coin: contact noise,
 *        solenoid spikes, inverted polarity, and pulse counts the acceptor
 *        was never programmed to emit.
 */
#include <unity.h>
#include "coin_acceptor.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

static CoinConfig danish_coins()
{
    CoinConfig cfg;
    cfg.active_low = true;
    cfg.min_pulse_ms = 15;
    cfg.train_gap_ms = 250;
    cfg.value_by_pulses[1] = 500;
    cfg.value_by_pulses[2] = 1000;
    cfg.value_by_pulses[3] = 2000;
    return cfg;
}

static void pulse(CoinAcceptor &c, uint32_t at_ms, uint32_t width_ms, bool active_low = true)
{
    c.on_edge(at_ms, !active_low);
    c.on_edge(at_ms + width_ms, active_low);
}

// A 5 ms glitch is shorter than any real coin pulse. It must not become credit.
void test_short_pulse_is_rejected()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    pulse(c, 1000, 5);

    TEST_ASSERT_FALSE(c.tick(2000, ev));
    TEST_ASSERT_EQUAL_UINT32(1, c.rejected_pulses());
}

// The dangerous case: noise riding on a real coin would inflate its value.
void test_noise_does_not_inflate_a_real_coin()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    pulse(c, 1000, 100);  // the real coin: 5 kr
    pulse(c, 1150, 3);    // a spike inside the train window

    TEST_ASSERT_TRUE(c.tick(1500, ev));
    TEST_ASSERT_EQUAL_UINT8(1, ev.pulses);
    TEST_ASSERT_EQUAL_UINT32(500, ev.value_minor);
    TEST_ASSERT_EQUAL_UINT32(1, c.rejected_pulses());
}

// A pulse exactly at the threshold counts; the boundary is inclusive.
void test_pulse_at_the_threshold_counts()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    pulse(c, 1000, 15);

    TEST_ASSERT_TRUE(c.tick(1400, ev));
    TEST_ASSERT_EQUAL_UINT32(500, ev.value_minor);
    TEST_ASSERT_EQUAL_UINT32(0, c.rejected_pulses());
}

// Two pulses closer together than the gap are one coin, not two.
void test_pulses_inside_the_gap_are_one_train()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    pulse(c, 1000, 100);
    pulse(c, 1240, 100);   // last edge 1340, well inside 250 ms of 1100

    TEST_ASSERT_TRUE(c.tick(1600, ev));
    TEST_ASSERT_EQUAL_UINT8(2, ev.pulses);
}

// The whole suite must work with the polarity inverted, because which way
// round it is cannot be known before the bench says so.
void test_active_high_decodes_the_same_way()
{
    CoinConfig cfg = danish_coins();
    cfg.active_low = false;
    CoinAcceptor c(cfg);
    CoinEvent ev{};

    pulse(c, 1000, 100, false);
    pulse(c, 1200, 100, false);

    TEST_ASSERT_TRUE(c.tick(1600, ev));
    TEST_ASSERT_EQUAL_UINT8(2, ev.pulses);
    TEST_ASSERT_EQUAL_UINT32(1000, ev.value_minor);
}

// OWNER DECISION default: an unrecognised count is reported with value 0 and
// counted, so the caller can decide what to do with a coin it cannot name.
void test_unrecognised_pulse_count_reports_zero_value()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    pulse(c, 1000, 100);
    pulse(c, 1200, 100);
    pulse(c, 1400, 100);
    pulse(c, 1600, 100);   // four pulses: not in the table

    TEST_ASSERT_TRUE(c.tick(2000, ev));
    TEST_ASSERT_EQUAL_UINT8(4, ev.pulses);
    TEST_ASSERT_EQUAL_UINT32(0, ev.value_minor);
    TEST_ASSERT_EQUAL_UINT32(1, c.unknown_trains());
}

// The counter must not saturate the pulse count into a valid coin.
void test_more_pulses_than_the_maximum_stay_unrecognised()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    for (uint32_t i = 0; i < 12; ++i)
        pulse(c, 1000 + i * 200, 100);

    TEST_ASSERT_TRUE(c.tick(1000 + 12 * 200 + 400, ev));
    TEST_ASSERT_EQUAL_UINT8(COIN_MAX_PULSES, ev.pulses);
    TEST_ASSERT_EQUAL_UINT32(0, ev.value_minor);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_short_pulse_is_rejected);
    RUN_TEST(test_noise_does_not_inflate_a_real_coin);
    RUN_TEST(test_pulse_at_the_threshold_counts);
    RUN_TEST(test_pulses_inside_the_gap_are_one_train);
    RUN_TEST(test_active_high_decodes_the_same_way);
    RUN_TEST(test_unrecognised_pulse_count_reports_zero_value);
    RUN_TEST(test_more_pulses_than_the_maximum_stay_unrecognised);
    return UNITY_END();
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
$PIO test -e native -f test_noise
```

Expected: FAIL on `test_unrecognised_pulse_count_reports_zero_value` — `unknown_trains()` still returns 0, because Task 1 never increments it.

- [ ] **Step 3: Add the unknown-train branch**

In `shared/vmaas-coin/src/coin_acceptor.cpp`, replace the body of `tick()` with:

```cpp
    bool CoinAcceptor::tick(uint32_t now_ms, CoinEvent &out)
    {
        if (pulses_ == 0) return false;          // nothing open
        if (in_pulse_) return false;             // still mid-pulse
        if (now_ms - last_edge_ms_ < cfg_.train_gap_ms) return false;

        out.pulses = pulses_;
        out.value_minor = value_for(pulses_);
        pulses_ = 0;

        // OWNER DECISION (spec 6.5, item 1). The acceptor has taken a coin
        // whose pulse count is not in the table: the money is in the box and
        // its value is unknown. This reports value_minor = 0, so the caller
        // credits nothing and the customer loses the coin.
        //
        // The alternative, not taken: credit the lowest configured value, so
        // the customer is never out of pocket and the operator absorbs the
        // difference. Change here and in the caller in purchase_task.cpp.
        if (out.value_minor == 0)
            ++unknown_trains_;

        return true;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
$PIO test -e native -f test_noise
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Run the whole library suite**

```bash
$PIO test -e native
```

Expected: PASS, 13 tests (6 from `test_decode`, 7 from `test_noise`).

- [ ] **Step 6: Verify**

Report the test count, and **flag the OWNER DECISION explicitly in the report**: state which default was implemented and that the alternative is commented at the decision point. **Do not commit.**

---

## Task 3: `vmaas-purchase` scaffold and the happy path

**Files:**
- Create: `shared/vmaas-purchase/platformio.ini`
- Create: `shared/vmaas-purchase/library.json`
- Create: `shared/vmaas-purchase/.gitignore`
- Create: `shared/vmaas-purchase/src/purchase.h`
- Create: `shared/vmaas-purchase/src/purchase.cpp`
- Test: `shared/vmaas-purchase/test/test_happy_path/test_main.cpp`

**Interfaces:**
- Consumes: nothing from `vmaas-coin` at compile time. The machine takes plain `uint32_t` coin values, so the two libraries stay independent.
- Produces: `vmaas::PurchaseState{Idle, AwaitingPayment, Dispensing, Settled}`, `vmaas::SaleStatus{None, Completed, Failed}`, `vmaas::PurchaseOutput` (fields exactly as in the header below), `vmaas::PurchaseConfig{uint32_t payment_timeout_ms; bool has_inhibit;}`, and `vmaas::Purchase` with `explicit Purchase(const PurchaseConfig&)`, `slot_chosen(uint8_t, uint32_t, uint32_t)`, `coin(uint32_t, uint32_t)`, `dispense_done(uint32_t)`, `dispense_failed(uint32_t)`, `cancel(uint32_t)`, `tick(uint32_t)`, `reset()` — all returning `PurchaseOutput`.

- [ ] **Step 1: Create the library scaffold**

`shared/vmaas-purchase/platformio.ini`:

```ini
; Host-side unit tests for the shared purchase state machine.
; Run from this directory: pio test -e native
; The machine takes plain integers, not CoinEvents, so vmaas-coin is not a
; dependency: the two libraries can be tested and changed independently.
[env:native]
platform = native
test_framework = unity
test_build_src = yes
build_flags = -std=c++17 -Wall -Wextra
```

`shared/vmaas-purchase/library.json`:

```json
{
  "name": "vmaas-purchase",
  "version": "0.1.0",
  "description": "Hardware-free cash purchase state machine for VMaaS",
  "keywords": ["purchase", "payment", "cash", "vmaas"],
  "frameworks": "*",
  "platforms": "*",
  "headers": ["purchase.h", "sale_line.h"]
}
```

`shared/vmaas-purchase/.gitignore`:

```
.pio/
```

- [ ] **Step 2: Write the failing test**

`shared/vmaas-purchase/test/test_happy_path/test_main.cpp`:

```cpp
/**
 * @file test_main.cpp
 * @brief Host tests for one customer paying exactly and getting a product.
 *
 * The machine is deliberately choose-then-pay: it has to know the price
 * before any money is in the box, which is what lets it inhibit the coin slot
 * when the credit is enough. See spec section 6.
 */
#include <unity.h>
#include "purchase.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

static PurchaseConfig with_inhibit()
{
    PurchaseConfig cfg;
    cfg.payment_timeout_ms = 60000;
    cfg.has_inhibit = true;
    return cfg;
}

// A machine nobody has touched accepts no money.
void test_idle_inhibits_the_coin_slot()
{
    Purchase p(with_inhibit());
    const PurchaseOutput out = p.tick(0);

    TEST_ASSERT_EQUAL(PurchaseState::Idle, out.state);
    TEST_ASSERT_TRUE(out.inhibit_coins);
    TEST_ASSERT_FALSE(out.run_slot);
    TEST_ASSERT_FALSE(out.settle_sale);
    TEST_ASSERT_EQUAL_UINT32(0, out.price_minor);
}

// Choosing a slot opens the coin slot and states what is owed.
void test_choosing_a_slot_opens_the_coin_slot()
{
    Purchase p(with_inhibit());
    const PurchaseOutput out = p.slot_chosen(12, 1500, 1000);

    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, out.state);
    TEST_ASSERT_FALSE(out.inhibit_coins);
    TEST_ASSERT_EQUAL_UINT8(12, out.slot);
    TEST_ASSERT_EQUAL_UINT32(1500, out.price_minor);
    TEST_ASSERT_EQUAL_UINT32(0, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT32(1500, out.missing_minor);
}

// A part payment counts down what is still missing and nothing else.
void test_partial_payment_counts_down()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);

    const PurchaseOutput out = p.coin(1000, 2000);

    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, out.state);
    TEST_ASSERT_EQUAL_UINT32(1000, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT32(500, out.missing_minor);
    TEST_ASSERT_FALSE(out.run_slot);
    TEST_ASSERT_FALSE(out.inhibit_coins);
}

// The last coin stops the coin slot and starts the motor. It does NOT settle
// the sale: nothing has been delivered yet, and a sale booked here would have
// to be contradicted by a second one if the motor then failed. Spec 8.2.
void test_exact_payment_runs_the_motor_without_settling()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);
    p.coin(1000, 2000);

    const PurchaseOutput out = p.coin(500, 3000);

    TEST_ASSERT_EQUAL(PurchaseState::Dispensing, out.state);
    TEST_ASSERT_TRUE(out.inhibit_coins);
    TEST_ASSERT_TRUE(out.run_slot);
    TEST_ASSERT_EQUAL_UINT8(12, out.slot);
    TEST_ASSERT_EQUAL_UINT32(1500, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT32(0, out.missing_minor);
    TEST_ASSERT_FALSE(out.settle_sale);
    TEST_ASSERT_EQUAL(SaleStatus::None, out.sale_status);
}

// DONE moves to Settled and stays there: the caller, not the machine, decides
// when the customer is finished, because the caller is what writes the outbox.
void test_done_settles_and_waits_for_reset()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);
    p.coin(1500, 2000);

    const PurchaseOutput out = p.dispense_done(4000);
    TEST_ASSERT_EQUAL(PurchaseState::Settled, out.state);
    TEST_ASSERT_TRUE(out.settle_sale);
    TEST_ASSERT_EQUAL(SaleStatus::Completed, out.sale_status);

    // Time passing must not move it on by itself.
    TEST_ASSERT_EQUAL(PurchaseState::Settled, p.tick(999999).state);
}

// reset() is the only way back to Idle, and it clears the credit.
void test_reset_returns_to_idle_with_no_credit()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);
    p.coin(1500, 2000);
    p.dispense_done(4000);

    const PurchaseOutput out = p.reset();

    TEST_ASSERT_EQUAL(PurchaseState::Idle, out.state);
    TEST_ASSERT_EQUAL_UINT32(0, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT32(0, out.price_minor);
    TEST_ASSERT_TRUE(out.inhibit_coins);
    TEST_ASSERT_FALSE(out.settle_sale);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_idle_inhibits_the_coin_slot);
    RUN_TEST(test_choosing_a_slot_opens_the_coin_slot);
    RUN_TEST(test_partial_payment_counts_down);
    RUN_TEST(test_exact_payment_runs_the_motor_without_settling);
    RUN_TEST(test_done_settles_and_waits_for_reset);
    RUN_TEST(test_reset_returns_to_idle_with_no_credit);
    return UNITY_END();
}
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
$PIO test -e native -f test_happy_path
```

Expected: FAIL at compile time — `purchase.h: No such file or directory`.

- [ ] **Step 4: Write the header**

`shared/vmaas-purchase/src/purchase.h`:

```cpp
#pragma once
/**
 * @file purchase.h
 * @brief The cash purchase state machine: slot choice plus coins in,
 *        decisions out.
 *
 * Hardware-free. It knows nothing about GPIO, the LCD, the UART or HTTP, and
 * takes coin values as plain integers rather than CoinEvents so it does not
 * depend on vmaas-coin. Same cut as SlotEntry, which returns an EntryState
 * without knowing a display exists.
 *
 * The flow is choose-then-pay, so the machine always knows the price before
 * money arrives. That is what makes the INHIBIT line useful: the coin slot can
 * be blocked while idle and again once the credit covers the price, which caps
 * overpayment at a single coin.
 */
#include <cstdint>

namespace vmaas
{
    enum class PurchaseState : uint8_t
    {
        Idle,            ///< No slot chosen. Coin slot inhibited if wired.
        AwaitingPayment, ///< Slot and price known, counting credit up.
        Dispensing,      ///< Paid in full, RUN sent, waiting for DONE or NAK.
        Settled,         ///< Terminal for one customer; the caller resets.
    };

    enum class SaleStatus : uint8_t
    {
        None,      ///< Nothing to report.
        Completed, ///< Paid and dispensed.
        Failed,    ///< Paid, but the motor did not deliver.
    };

    /**
     * @brief What the caller must do after handing the machine an event.
     *
     * Several fields can be set at once: paying the last coin both stops the
     * coin slot and starts the motor.
     */
    struct PurchaseOutput
    {
        PurchaseState state = PurchaseState::Idle;
        uint32_t   price_minor = 0;    ///< 0 in Idle, and when no slot is chosen yet.
        uint32_t   credit_minor = 0;   ///< Counted so far.
        uint32_t   missing_minor = 0;  ///< price - credit, floored at 0.
        bool       inhibit_coins = true;
        bool       run_slot = false;   ///< Send RUN for `slot` now.
        uint8_t    slot = 0;
        bool       settle_sale = false; ///< Append one line to the outbox.
        SaleStatus sale_status = SaleStatus::None;
    };

    struct PurchaseConfig
    {
        /// Inactivity before an unfinished payment is abandoned. The credit is
        /// forfeited, and nothing is reported: there was no vend.
        uint32_t payment_timeout_ms = 60000;
        /// Whether the INHIBIT pin is wired. When false, a coin can arrive
        /// with no slot chosen and must still be honoured; see Task 4.
        bool has_inhibit = false;
    };

    class Purchase
    {
    public:
        explicit Purchase(const PurchaseConfig &cfg);

        /// The customer picked a slot. @p price_minor comes from the price table.
        PurchaseOutput slot_chosen(uint8_t slot, uint32_t price_minor, uint32_t now_ms);
        /// One decoded coin. A value of 0 (an unrecognised coin) adds no credit.
        PurchaseOutput coin(uint32_t value_minor, uint32_t now_ms);
        PurchaseOutput dispense_done(uint32_t now_ms);
        PurchaseOutput dispense_failed(uint32_t now_ms);
        PurchaseOutput cancel(uint32_t now_ms);
        /// Call every loop pass. This is what enforces payment_timeout_ms.
        PurchaseOutput tick(uint32_t now_ms);
        /// Called once the caller has durably written the settlement.
        PurchaseOutput reset();

    private:
        /// Builds the output AND consumes the one-shot flags, so it is not
        /// const. Every caller is a non-const member anyway.
        PurchaseOutput out();

        PurchaseConfig cfg_;
        PurchaseState  state_ = PurchaseState::Idle;
        uint32_t   price_minor_ = 0;
        uint32_t   credit_minor_ = 0;
        uint8_t    slot_ = 0;
        uint32_t   last_activity_ms_ = 0;
        bool       run_slot_ = false;
        bool       settle_sale_ = false;
        SaleStatus sale_status_ = SaleStatus::None;
    };
}
```

- [ ] **Step 5: Write the implementation**

`shared/vmaas-purchase/src/purchase.cpp`:

```cpp
/**
 * @file purchase.cpp
 * @brief The state machine. See purchase.h for the contract.
 *
 * run_slot and settle_sale are one-shot: they are set by the transition that
 * earns them and cleared by out(), so a caller that asks twice does not run
 * the motor twice or book the sale twice.
 */
#include "purchase.h"

namespace vmaas
{
    Purchase::Purchase(const PurchaseConfig &cfg) : cfg_(cfg) {}

    PurchaseOutput Purchase::out()
    {
        PurchaseOutput o;
        o.state = state_;
        o.price_minor = price_minor_;
        o.credit_minor = credit_minor_;
        o.missing_minor = price_minor_ > credit_minor_ ? price_minor_ - credit_minor_ : 0;
        o.slot = slot_;
        o.run_slot = run_slot_;
        o.settle_sale = settle_sale_;
        o.sale_status = sale_status_;

        // The coin slot is open only while the machine is genuinely waiting
        // for money it still needs. A price of 0 means no slot is chosen yet,
        // and missing_minor is then 0 — so a coin-first customer with no
        // INHIBIT pin gets the slot shut until they pick something. That is
        // correct: the pin does not exist in that configuration anyway.
        o.inhibit_coins = !(state_ == PurchaseState::AwaitingPayment &&
                            o.missing_minor > 0);

        // One-shot: run the motor once, book the sale once. Cleared here so a
        // caller that asks twice cannot do either twice.
        run_slot_ = false;
        settle_sale_ = false;

        return o;
    }

    PurchaseOutput Purchase::slot_chosen(uint8_t slot, uint32_t price_minor, uint32_t now_ms)
    {
        if (state_ != PurchaseState::Idle && state_ != PurchaseState::AwaitingPayment)
            return out();

        slot_ = slot;
        price_minor_ = price_minor;
        state_ = PurchaseState::AwaitingPayment;
        last_activity_ms_ = now_ms;

        // Credit already in the box (a coin-first customer with no INHIBIT
        // pin) carries over into the slot they finally chose.
        // As in coin(): start the motor, settle at the terminal transition.
        if (credit_minor_ >= price_minor_)
        {
            run_slot_ = true;
            state_ = PurchaseState::Dispensing;
        }

        return out();
    }

    PurchaseOutput Purchase::coin(uint32_t value_minor, uint32_t now_ms)
    {
        // An unrecognised coin adds nothing; see the OWNER DECISION in
        // coin_acceptor.cpp for why its value is 0.
        if (value_minor == 0) return out();

        if (state_ == PurchaseState::Idle)
        {
            // With INHIBIT wired this cannot happen. Without it, the money is
            // already in the box and ignoring it would be theft, so the coin
            // opens a payment with no slot chosen yet.
            if (cfg_.has_inhibit) return out();

            state_ = PurchaseState::AwaitingPayment;
            price_minor_ = 0;
            slot_ = 0;
        }

        if (state_ != PurchaseState::AwaitingPayment) return out();

        credit_minor_ += value_minor;
        last_activity_ms_ = now_ms;

        // Paying in full starts the motor and settles NOTHING. The sale is
        // booked once, at the terminal transition, with the status the
        // delivery actually had. Settling here as Completed and again in
        // dispense_failed() as Failed would book one purchase twice. Spec 8.2.
        if (price_minor_ > 0 && credit_minor_ >= price_minor_)
        {
            run_slot_ = true;
            state_ = PurchaseState::Dispensing;
        }

        return out();
    }

    PurchaseOutput Purchase::dispense_done(uint32_t now_ms)
    {
        if (state_ != PurchaseState::Dispensing) return out();

        state_ = PurchaseState::Settled;
        sale_status_ = SaleStatus::Completed;
        settle_sale_ = true;
        last_activity_ms_ = now_ms;

        return out();
    }

    PurchaseOutput Purchase::dispense_failed(uint32_t now_ms)
    {
        if (state_ != PurchaseState::Dispensing) return out();

        state_ = PurchaseState::Settled;
        sale_status_ = SaleStatus::Failed;
        settle_sale_ = true;
        last_activity_ms_ = now_ms;

        return out();
    }

    PurchaseOutput Purchase::cancel(uint32_t now_ms)
    {
        // Cancelling is only possible before the motor starts. Once money has
        // bought a vend there is nothing to cancel.
        if (state_ != PurchaseState::AwaitingPayment) return out();

        state_ = PurchaseState::Settled;
        sale_status_ = SaleStatus::None;
        last_activity_ms_ = now_ms;

        return out();
    }

    PurchaseOutput Purchase::tick(uint32_t now_ms)
    {
        if (state_ == PurchaseState::AwaitingPayment &&
            cfg_.payment_timeout_ms > 0 &&
            now_ms - last_activity_ms_ >= cfg_.payment_timeout_ms)
        {
            // Abandoned. The credit is forfeited and nothing is reported:
            // there was no vend, so there is no sale. Spec 6.4.
            state_ = PurchaseState::Settled;
            sale_status_ = SaleStatus::None;
        }

        return out();
    }

    PurchaseOutput Purchase::reset()
    {
        state_ = PurchaseState::Idle;
        price_minor_ = 0;
        credit_minor_ = 0;
        slot_ = 0;
        run_slot_ = false;
        settle_sale_ = false;
        sale_status_ = SaleStatus::None;

        return out();
    }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
$PIO test -e native -f test_happy_path
```

Expected: PASS, 6 tests.

- [ ] **Step 7: Verify**

```bash
$PIO test -e native
```

Expected: PASS, 6 tests. Report the count. **Do not commit.**

---

## Task 4: The edges — overpayment, timeout, failure, coin-first

**Files:**
- Modify: `shared/vmaas-purchase/src/purchase.cpp` (only if a test exposes a gap)
- Test: `shared/vmaas-purchase/test/test_edges/test_main.cpp`

**Interfaces:**
- Consumes: everything Task 3 produced.
- Produces: no new signatures.

> **OWNER DECISION — a coin arriving during `Dispensing`.** The motor is running and the sale is settled.
>
> **Implement this default:** the coin is ignored and its value is lost. `Purchase::coin` already returns early for any state that is not `AwaitingPayment`, so this is the behaviour Task 3 shipped. Add the test below that pins it, and the comment.
>
> **The alternative:** hold the value and carry it into the next `slot_chosen`, which would mean credit survives a customer boundary — directly against the "credit is never carried" rule, so it would need the owner to relax that rule too.
>
> Flag it in the task report.

- [ ] **Step 1: Write the failing test**

`shared/vmaas-purchase/test/test_edges/test_main.cpp`:

```cpp
/**
 * @file test_main.cpp
 * @brief Host tests for every path where the customer does not simply pay the
 *        exact amount and walk away happy.
 *
 * These are the cases that decide what happens to real money, so each one
 * names the money outcome in its comment.
 */
#include <unity.h>
#include "purchase.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

static PurchaseConfig with_inhibit()
{
    PurchaseConfig cfg;
    cfg.payment_timeout_ms = 60000;
    cfg.has_inhibit = true;
    return cfg;
}

static PurchaseConfig without_inhibit()
{
    PurchaseConfig cfg;
    cfg.payment_timeout_ms = 60000;
    cfg.has_inhibit = false;
    return cfg;
}

// A 20 kr coin for a 15 kr product: the vend happens and 5 kr stays in the
// machine. credit_minor is what the caller reports as received_minor.
void test_overpayment_vends_and_reports_what_was_received()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);

    const PurchaseOutput paid = p.coin(2000, 2000);

    TEST_ASSERT_EQUAL(PurchaseState::Dispensing, paid.state);
    TEST_ASSERT_TRUE(paid.run_slot);
    TEST_ASSERT_FALSE(paid.settle_sale);
    TEST_ASSERT_EQUAL_UINT32(1500, paid.price_minor);
    TEST_ASSERT_EQUAL_UINT32(2000, paid.credit_minor);
    TEST_ASSERT_EQUAL_UINT32(0, paid.missing_minor);

    // The 5 kr the customer does not get back reaches the backend as
    // received_minor on the one sale this purchase books, at DONE.
    const PurchaseOutput out = p.dispense_done(3000);
    TEST_ASSERT_TRUE(out.settle_sale);
    TEST_ASSERT_EQUAL(SaleStatus::Completed, out.sale_status);
    TEST_ASSERT_EQUAL_UINT32(1500, out.price_minor);
    TEST_ASSERT_EQUAL_UINT32(2000, out.credit_minor);
}

// Abandoned payment: 10 kr of a 15 kr product. No vend, nothing reported,
// money forfeited. Spec 6.4 accepts that this leaves the cash box high.
void test_timeout_forfeits_without_reporting()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);
    p.coin(1000, 2000);

    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, p.tick(61999).state);

    const PurchaseOutput out = p.tick(62000);
    TEST_ASSERT_EQUAL(PurchaseState::Settled, out.state);
    TEST_ASSERT_FALSE(out.settle_sale);
    TEST_ASSERT_EQUAL(SaleStatus::None, out.sale_status);
}

// Each coin restarts the window, so a slow customer is not cut off.
void test_each_coin_restarts_the_timeout()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 2000, 1000);
    p.coin(500, 50000);

    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, p.tick(109999).state);
    TEST_ASSERT_EQUAL(PurchaseState::Settled, p.tick(110000).state);
}

// Nothing typed, nothing paid: an idle machine never times out into Settled.
void test_idle_never_times_out()
{
    Purchase p(with_inhibit());

    for (uint32_t t = 0; t < 300000; t += 10000)
        TEST_ASSERT_EQUAL(PurchaseState::Idle, p.tick(t).state);
}

// The machine's own failure. The money is kept, but the sale is reported as
// failed so an operator can find it and compensate by hand. Spec 6.4.
void test_motor_failure_reports_a_failed_sale()
{
    Purchase p(with_inhibit());
    p.slot_chosen(7, 1500, 1000);
    p.coin(1500, 2000);

    // Paying must not have settled anything, or this purchase would reach the
    // backend twice: once claiming completed, once saying failed.
    TEST_ASSERT_FALSE(p.tick(2500).settle_sale);

    const PurchaseOutput out = p.dispense_failed(4000);

    TEST_ASSERT_EQUAL(PurchaseState::Settled, out.state);
    TEST_ASSERT_TRUE(out.settle_sale);
    TEST_ASSERT_EQUAL(SaleStatus::Failed, out.sale_status);
    TEST_ASSERT_EQUAL_UINT32(1500, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT8(7, out.slot);
}

// The invariant the whole ordering exists to protect: one purchase produces
// exactly one settlement, whichever way the delivery goes. Counting across the
// entire sequence is the point — inspecting only the last call is what let the
// double booking hide.
void test_a_failed_purchase_settles_exactly_once()
{
    Purchase p(with_inhibit());
    p.slot_chosen(7, 1500, 1000);

    int settlements = 0;
    if (p.coin(1500, 2000).settle_sale) ++settlements;
    if (p.tick(2100).settle_sale) ++settlements;
    if (p.dispense_failed(4000).settle_sale) ++settlements;
    if (p.tick(4100).settle_sale) ++settlements;

    TEST_ASSERT_EQUAL_INT(1, settlements);
}

void test_a_completed_purchase_settles_exactly_once()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);

    int settlements = 0;
    if (p.coin(1500, 2000).settle_sale) ++settlements;
    if (p.tick(2100).settle_sale) ++settlements;
    if (p.dispense_done(4000).settle_sale) ++settlements;
    if (p.tick(4100).settle_sale) ++settlements;

    TEST_ASSERT_EQUAL_INT(1, settlements);
}

// Cancelling before the motor runs: no vend, nothing reported, credit gone.
void test_cancel_forfeits_without_reporting()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);
    p.coin(500, 2000);

    const PurchaseOutput out = p.cancel(3000);

    TEST_ASSERT_EQUAL(PurchaseState::Settled, out.state);
    TEST_ASSERT_FALSE(out.settle_sale);
    TEST_ASSERT_EQUAL(SaleStatus::None, out.sale_status);
}

// With INHIBIT wired the coin slot is shut while idle, so a coin cannot
// arrive. If one somehow does, it must not start a purchase.
void test_coin_in_idle_is_refused_when_inhibit_is_wired()
{
    Purchase p(with_inhibit());

    const PurchaseOutput out = p.coin(1000, 1000);

    TEST_ASSERT_EQUAL(PurchaseState::Idle, out.state);
    TEST_ASSERT_EQUAL_UINT32(0, out.credit_minor);
}

// Without the pin, the money is already in the box. Honour it: hold the credit
// and ask for a slot. price_minor stays 0 until one is chosen.
void test_coin_in_idle_starts_a_payment_when_inhibit_is_absent()
{
    Purchase p(without_inhibit());

    const PurchaseOutput out = p.coin(1000, 1000);

    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, out.state);
    TEST_ASSERT_EQUAL_UINT32(1000, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT32(0, out.price_minor);
}

// The coin-first customer then picks something their credit already covers:
// the vend must start immediately, not wait for another coin.
void test_coin_first_then_an_affordable_slot_vends_at_once()
{
    Purchase p(without_inhibit());
    p.coin(2000, 1000);

    const PurchaseOutput out = p.slot_chosen(12, 1500, 2000);

    TEST_ASSERT_EQUAL(PurchaseState::Dispensing, out.state);
    TEST_ASSERT_TRUE(out.run_slot);
    TEST_ASSERT_FALSE(out.settle_sale);
    TEST_ASSERT_EQUAL_UINT32(2000, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT32(1500, out.price_minor);
}

// Coin-first, then something dearer: keep counting down the difference.
void test_coin_first_then_a_dearer_slot_keeps_counting()
{
    Purchase p(without_inhibit());
    p.coin(500, 1000);

    const PurchaseOutput out = p.slot_chosen(12, 1500, 2000);

    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, out.state);
    TEST_ASSERT_EQUAL_UINT32(1000, out.missing_minor);
    TEST_ASSERT_FALSE(out.run_slot);
}

// A price of 0 means "not for sale" — prices::for_slot returns 0 for a slot
// with no price, and Task 10 refuses the selection. The machine must not be
// left holding a selection it can never dispense: slot_chosen rejects it
// outright rather than parking in AwaitingPayment until the timeout.
void test_slot_with_no_price_is_refused()
{
    Purchase p(with_inhibit());

    const PurchaseOutput out = p.slot_chosen(12, 0, 1000);

    TEST_ASSERT_EQUAL(PurchaseState::Idle, out.state);
    TEST_ASSERT_TRUE(out.inhibit_coins);
    TEST_ASSERT_EQUAL_UINT32(0, out.price_minor);
    TEST_ASSERT_FALSE(out.run_slot);
}

// The coin-first path still reaches AwaitingPayment with price_minor 0, because
// it gets there through coin(), not slot_chosen(). The guard above must not
// break it.
void test_price_zero_guard_does_not_block_coin_first()
{
    Purchase p(without_inhibit());

    const PurchaseOutput out = p.coin(500, 1000);

    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, out.state);
    TEST_ASSERT_EQUAL_UINT32(500, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT32(0, out.price_minor);
}

// An unrecognised coin (value 0) must not be treated as a free payment.
void test_unrecognised_coin_adds_no_credit()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);

    const PurchaseOutput out = p.coin(0, 2000);

    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, out.state);
    TEST_ASSERT_EQUAL_UINT32(0, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT32(1500, out.missing_minor);
}

// OWNER DECISION default: a coin that lands while the motor is running is
// ignored and its value is lost.
void test_coin_during_dispensing_is_ignored()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);
    p.coin(1500, 2000);

    const PurchaseOutput out = p.coin(2000, 2500);

    TEST_ASSERT_EQUAL(PurchaseState::Dispensing, out.state);
    TEST_ASSERT_EQUAL_UINT32(1500, out.credit_minor);
    TEST_ASSERT_FALSE(out.run_slot);
}

// run_slot and settle_sale are one-shot: asking twice must not vend twice or
// book the sale twice. This is the invariant that stops a double charge.
void test_run_and_settle_are_reported_once()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);

    const PurchaseOutput first = p.coin(1500, 2000);
    TEST_ASSERT_TRUE(first.run_slot);

    const PurchaseOutput second = p.tick(2100);
    TEST_ASSERT_FALSE(second.run_slot);

    const PurchaseOutput done = p.dispense_done(3000);
    TEST_ASSERT_TRUE(done.settle_sale);
    TEST_ASSERT_FALSE(p.tick(3100).settle_sale);
}

// Choosing a second slot mid-payment moves the target and keeps the credit.
void test_changing_slot_mid_payment_keeps_the_credit()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);
    p.coin(500, 2000);

    const PurchaseOutput out = p.slot_chosen(7, 1000, 3000);

    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, out.state);
    TEST_ASSERT_EQUAL_UINT8(7, out.slot);
    TEST_ASSERT_EQUAL_UINT32(500, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT32(500, out.missing_minor);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_overpayment_vends_and_reports_what_was_received);
    RUN_TEST(test_timeout_forfeits_without_reporting);
    RUN_TEST(test_each_coin_restarts_the_timeout);
    RUN_TEST(test_idle_never_times_out);
    RUN_TEST(test_motor_failure_reports_a_failed_sale);
    RUN_TEST(test_a_failed_purchase_settles_exactly_once);
    RUN_TEST(test_a_completed_purchase_settles_exactly_once);
    RUN_TEST(test_cancel_forfeits_without_reporting);
    RUN_TEST(test_coin_in_idle_is_refused_when_inhibit_is_wired);
    RUN_TEST(test_coin_in_idle_starts_a_payment_when_inhibit_is_absent);
    RUN_TEST(test_coin_first_then_an_affordable_slot_vends_at_once);
    RUN_TEST(test_coin_first_then_a_dearer_slot_keeps_counting);
    RUN_TEST(test_slot_with_no_price_is_refused);
    RUN_TEST(test_price_zero_guard_does_not_block_coin_first);
    RUN_TEST(test_unrecognised_coin_adds_no_credit);
    RUN_TEST(test_coin_during_dispensing_is_ignored);
    RUN_TEST(test_run_and_settle_are_reported_once);
    RUN_TEST(test_changing_slot_mid_payment_keeps_the_credit);
    return UNITY_END();
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
$PIO test -e native -f test_edges
```

Expected: most pass from Task 3's implementation. Note exactly which fail — that list is the real work of this task. Do not guess: run it and read the output.

- [ ] **Step 3: Fix only what the failures expose**

Make the failing tests pass with the smallest change to `purchase.cpp`. Do not restructure what already works.

Two of the failures need named changes, because a review of the preceding task found them:

**The price-0 guard.** `slot_chosen` currently accepts a price of 0, and its completion check requires `price_minor_ > 0`, so a 0-priced selection parks in `AwaitingPayment` with nothing missing and never dispenses — it just waits for the timeout. A price of 0 means "not for sale" (`prices::for_slot` returns 0 for a slot with no price), so refuse it at the door:

```cpp
        // 0 means "no price, not for sale". Accepting it would park the
        // machine in AwaitingPayment with nothing missing and no way to
        // dispense, until the timeout quietly cleared it. The coin-first path
        // reaches price_minor_ == 0 through coin(), not here, so this guard
        // does not affect it.
        if (price_minor == 0) return out();
```

**The `reset()` contract.** `reset()` is the only method with no state guard: it succeeds from any state, including `Dispensing`. That is deliberate — it is the caller's escape hatch, and the "credit is never carried" rule needs it to work unconditionally — but it is also the one place a caller mistake could forget an in-flight vend. Make the contract explicit in `purchase.h` above `reset()`:

```cpp
        /**
         * @brief Back to Idle, credit cleared. The only way out of Settled.
         *
         * Unguarded on purpose: it must work from any state, because "credit
         * is never carried between customers" has to hold even after a fault.
         * The cost is that calling it during Dispensing forgets a vend that
         * the motor may still be running — so only the owner of the machine
         * calls it, and only once the settlement is durable.
         */
        PurchaseOutput reset();
```

Then add this comment above the early return in `Purchase::coin`:

```cpp
        // OWNER DECISION (spec 6.5, item 2). A coin that arrives while the
        // motor is running is ignored and its value is lost. The alternative,
        // not taken: hold it for the next slot_chosen, which would mean credit
        // surviving a customer boundary — against the "credit is never
        // carried" rule in the spec, so it needs the owner to relax that too.
        if (state_ != PurchaseState::AwaitingPayment) return out();
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
$PIO test -e native -f test_edges
```

Expected: PASS, 18 tests.

- [ ] **Step 5: Run the whole library suite**

```bash
$PIO test -e native
```

Expected: PASS, 24 tests (6 from `test_happy_path`, 18 from `test_edges`).

- [ ] **Step 6: Verify**

Report the count, which tests failed in Step 2 and what changed to fix them, and **flag the OWNER DECISION**. **Do not commit.**

---

## Task 5: The outbox line, formatted and host-tested

**Files:**
- Create: `shared/vmaas-purchase/src/sale_line.h`
- Create: `shared/vmaas-purchase/src/sale_line.cpp`
- Test: `shared/vmaas-purchase/test/test_sale_line/test_main.cpp`

**Interfaces:**
- Consumes: `vmaas::SaleStatus` from `purchase.h`.
- Produces: `vmaas::SaleLine{const char *event_id; uint32_t sequence_number; uint8_t slot; uint32_t price_minor; uint32_t received_minor; SaleStatus status; const char *reason; const char *occurred_at; uint32_t uptime_ms; const char *currency;}` and `size_t vmaas::format_sale_line(const SaleLine &line, char *buf, size_t buf_len)`, which returns the number of characters written excluding the terminator, or 0 if the buffer is too small.

The line format is fixed by the backend's `deviceEventSchema`, so it is worth pinning in a host test rather than discovering over the wire. `occurred_at` is null when the clock has never been synchronised, and then `uptime_ms` is emitted instead; see spec 8.3.

- [ ] **Step 1: Write the failing test**

`shared/vmaas-purchase/test/test_sale_line/test_main.cpp`:

```cpp
/**
 * @file test_main.cpp
 * @brief Host tests for the exact JSON text the backend must receive.
 *
 * The backend validates this with deviceEventSchema, so the field names and
 * nesting are a contract, not a preference. Pinning the text here means a
 * rename is caught on the PC instead of by a 400 from a machine in the field.
 */
#include <unity.h>
#include <cstring>
#include "sale_line.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

static SaleLine completed_sale()
{
    SaleLine l;
    l.event_id = "VM-16FEE909-000412";
    l.sequence_number = 412;
    l.slot = 12;
    l.price_minor = 1500;
    l.received_minor = 2000;
    l.status = SaleStatus::Completed;
    l.reason = nullptr;
    l.occurred_at = "2026-09-21T13:04:11Z";
    l.uptime_ms = 0;
    l.currency = "DKK";
    return l;
}

void test_completed_sale_is_formatted_exactly()
{
    char buf[512];
    const size_t n = format_sale_line(completed_sale(), buf, sizeof(buf));

    const char *expected =
        "{\"eventId\":\"VM-16FEE909-000412\",\"sequenceNumber\":412,"
        "\"type\":\"cash_sale\",\"occurredAt\":\"2026-09-21T13:04:11Z\","
        "\"payload\":{\"slot\":12,\"price_minor\":1500,\"received_minor\":2000,"
        "\"status\":\"completed\",\"currency\":\"DKK\"}}";

    TEST_ASSERT_EQUAL_STRING(expected, buf);
    TEST_ASSERT_EQUAL_UINT32(std::strlen(expected), n);
}

void test_failed_sale_carries_a_reason()
{
    SaleLine l = completed_sale();
    l.event_id = "VM-16FEE909-000414";
    l.sequence_number = 414;
    l.slot = 7;
    l.received_minor = 1500;
    l.status = SaleStatus::Failed;
    l.reason = "motor_nak";
    l.occurred_at = "2026-09-21T13:09:44Z";

    char buf[512];
    format_sale_line(l, buf, sizeof(buf));

    const char *expected =
        "{\"eventId\":\"VM-16FEE909-000414\",\"sequenceNumber\":414,"
        "\"type\":\"cash_sale\",\"occurredAt\":\"2026-09-21T13:09:44Z\","
        "\"payload\":{\"slot\":7,\"price_minor\":1500,\"received_minor\":1500,"
        "\"status\":\"failed\",\"reason\":\"motor_nak\",\"currency\":\"DKK\"}}";

    TEST_ASSERT_EQUAL_STRING(expected, buf);
}

// No clock: send uptime instead of a fabricated 1970 timestamp, and let the
// backend work out when it happened. Spec 8.3.
void test_unsynced_clock_emits_uptime_instead()
{
    SaleLine l = completed_sale();
    l.occurred_at = nullptr;
    l.uptime_ms = 734512;

    char buf[512];
    format_sale_line(l, buf, sizeof(buf));

    const char *expected =
        "{\"eventId\":\"VM-16FEE909-000412\",\"sequenceNumber\":412,"
        "\"type\":\"cash_sale\",\"uptimeMs\":734512,"
        "\"payload\":{\"slot\":12,\"price_minor\":1500,\"received_minor\":2000,"
        "\"status\":\"completed\",\"currency\":\"DKK\"}}";

    TEST_ASSERT_EQUAL_STRING(expected, buf);
}

// A line that does not fit must not be half-written: better no sale line at
// all than a truncated one that corrupts the queue.
void test_buffer_too_small_writes_nothing()
{
    char buf[32];
    std::memset(buf, 'x', sizeof(buf));

    const size_t n = format_sale_line(completed_sale(), buf, sizeof(buf));

    TEST_ASSERT_EQUAL_UINT32(0, n);
    TEST_ASSERT_EQUAL_CHAR('\0', buf[0]);
}

// The line must be one line: a newline inside it would split one event into
// two unparseable halves in the JSONL file.
void test_line_contains_no_newline()
{
    char buf[512];
    format_sale_line(completed_sale(), buf, sizeof(buf));

    TEST_ASSERT_NULL(std::strchr(buf, '\n'));
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_completed_sale_is_formatted_exactly);
    RUN_TEST(test_failed_sale_carries_a_reason);
    RUN_TEST(test_unsynced_clock_emits_uptime_instead);
    RUN_TEST(test_buffer_too_small_writes_nothing);
    RUN_TEST(test_line_contains_no_newline);
    return UNITY_END();
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
$PIO test -e native -f test_sale_line
```

Expected: FAIL at compile time — `sale_line.h: No such file or directory`.

- [ ] **Step 3: Write the header**

`shared/vmaas-purchase/src/sale_line.h`:

```cpp
#pragma once
/**
 * @file sale_line.h
 * @brief One outbox line, formatted as the JSON the backend expects.
 *
 * Kept hardware-free and separate from the file I/O so the exact wire text can
 * be pinned by host tests. The shape is fixed by deviceEventSchema in
 * shared/schemas/device.ts: a rename there breaks these tests, which is the
 * point.
 */
#include <cstddef>
#include <cstdint>

#include "purchase.h"

namespace vmaas
{
    /// Everything one cash_sale event carries.
    struct SaleLine
    {
        const char *event_id = nullptr;       ///< Machine id plus an NVS counter.
        uint32_t    sequence_number = 0;
        uint8_t     slot = 0;
        uint32_t    price_minor = 0;
        uint32_t    received_minor = 0;       ///< What the customer actually paid.
        SaleStatus  status = SaleStatus::None;
        const char *reason = nullptr;         ///< Omitted when null.
        /// ISO 8601 UTC, or null when the clock has never been synchronised —
        /// then uptime_ms is emitted instead. Spec 8.3.
        const char *occurred_at = nullptr;
        uint32_t    uptime_ms = 0;
        const char *currency = "DKK";
    };

    /**
     * @brief Format @p line into @p buf as one JSONL line, with no newline.
     * @return Characters written excluding the terminator, or 0 when @p buf is
     *         too small. On 0 the buffer is left as an empty string rather
     *         than a truncated line.
     */
    size_t format_sale_line(const SaleLine &line, char *buf, size_t buf_len);
}
```

- [ ] **Step 4: Write the implementation**

`shared/vmaas-purchase/src/sale_line.cpp`:

```cpp
/**
 * @file sale_line.cpp
 * @brief JSON line formatting. See sale_line.h for the contract.
 *
 * snprintf into a scratch buffer, then copy only if it fitted. Writing
 * straight into the caller's buffer would leave a truncated line behind on
 * overflow, and a truncated line in a JSONL queue is an unparseable event.
 */
#include "sale_line.h"

#include <cstdio>
#include <cstring>

namespace
{
    const char *status_text(vmaas::SaleStatus s)
    {
        switch (s)
        {
        case vmaas::SaleStatus::Completed: return "completed";
        case vmaas::SaleStatus::Failed:    return "failed";
        case vmaas::SaleStatus::None:      break;
        }
        return "none";
    }
}

namespace vmaas
{
    size_t format_sale_line(const SaleLine &line, char *buf, size_t buf_len)
    {
        if (buf == nullptr || buf_len == 0) return 0;
        buf[0] = '\0';

        char scratch[512];

        // The time field: a real timestamp when the clock is known, otherwise
        // uptime so the backend can work backwards from receipt.
        char when[64];
        if (line.occurred_at != nullptr)
            std::snprintf(when, sizeof(when), "\"occurredAt\":\"%s\"", line.occurred_at);
        else
            std::snprintf(when, sizeof(when), "\"uptimeMs\":%lu",
                          static_cast<unsigned long>(line.uptime_ms));

        char reason[96] = "";
        if (line.reason != nullptr)
            std::snprintf(reason, sizeof(reason), ",\"reason\":\"%s\"", line.reason);

        const int n = std::snprintf(
            scratch, sizeof(scratch),
            "{\"eventId\":\"%s\",\"sequenceNumber\":%lu,\"type\":\"cash_sale\",%s,"
            "\"payload\":{\"slot\":%u,\"price_minor\":%lu,\"received_minor\":%lu,"
            "\"status\":\"%s\"%s,\"currency\":\"%s\"}}",
            line.event_id != nullptr ? line.event_id : "",
            static_cast<unsigned long>(line.sequence_number),
            when,
            static_cast<unsigned>(line.slot),
            static_cast<unsigned long>(line.price_minor),
            static_cast<unsigned long>(line.received_minor),
            status_text(line.status),
            reason,
            line.currency != nullptr ? line.currency : "DKK");

        if (n < 0) return 0;
        const size_t written = static_cast<size_t>(n);
        if (written >= sizeof(scratch)) return 0;   // scratch overflowed
        if (written + 1 > buf_len) return 0;        // caller's buffer too small

        std::memcpy(buf, scratch, written + 1);
        return written;
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
$PIO test -e native -f test_sale_line
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Run the whole library suite**

```bash
$PIO test -e native
```

Expected: PASS, 25 tests.

- [ ] **Step 7: Verify**

Report the count. **Do not commit.**

---

## Task 6: `EspCoinPort` — the ISR, the edge queue and INHIBIT

**Files:**
- Create: `shared/vmaas-coin/src/esp_coin_port.h`
- Create: `shared/vmaas-coin/src/esp_coin_port.cpp`
- Modify: `Main-Controller/src/pins.h`

**Interfaces:**
- Consumes: nothing from the decoder — the port produces edges, the decoder consumes them, and neither includes the other.
- Produces: `vmaas::CoinEdge{uint32_t at_ms; bool level;}` and `vmaas::EspCoinPort` with `esp_err_t begin(int coin_pin, int inhibit_pin)` (pass `-1` for no INHIBIT), `bool next(CoinEdge &out)`, `void set_inhibit(bool on)`, `uint32_t dropped_edges() const`.

This task has no host tests: it is all ESP-IDF. It is verified by building the firmware and by the bench checks in Task 11. Keep it small enough to read in one go, precisely because it cannot be tested on the PC.

- [ ] **Step 1: Add the pins**

In `Main-Controller/src/pins.h`, inside `namespace Pins`, after the keypad columns:

```cpp
    /// HX-916 COIN, through a PC817 optocoupler. GPIO34-39 are input-only and
    /// have no internal pull-up, which normally rules them out for an
    /// open-collector input — but the optocoupler needs an external 10k
    /// pull-up anyway, so the limitation costs nothing and a general-purpose
    /// GPIO stays free.
    constexpr int COIN_IN = 35;
    /// HX-916 INHIBIT, if the harness exposes it. -1 disables the feature.
    constexpr int INHIBIT_OUT = 4;
```

- [ ] **Step 2: Write the header**

`shared/vmaas-coin/src/esp_coin_port.h`:

```cpp
#pragma once
/**
 * @file esp_coin_port.h
 * @brief ESP32 GPIO side of the coin acceptor: an ISR that timestamps edges
 *        and a queue to carry them to the main task.
 *
 * Compiled only for ESP targets, so shared/vmaas-coin still builds under
 * platform = native.
 *
 * The ISR does one thing: read the clock, push a CoinEdge, return. Every
 * decision about what the edges mean belongs to CoinAcceptor on the main
 * task. That split is what makes the decoder testable on a PC, and it keeps
 * the ISR to a handful of instructions.
 *
 * Polling was rejected: CONFIG_FREERTOS_HZ is 100, so a tick is 10 ms, and the
 * acceptor's fastest pulse setting is 20 ms. A polled loop would miss pulses.
 */
#ifdef ESP_PLATFORM

#include <cstdint>

#include "esp_err.h"

namespace vmaas
{
    /// One raw edge as the ISR saw it.
    struct CoinEdge
    {
        uint32_t at_ms = 0; ///< esp_timer time, truncated to milliseconds.
        bool     level = false; ///< The pin level after the edge, raw.
    };

    class EspCoinPort
    {
    public:
        /**
         * @brief Configure the pins, the queue and the ISR.
         * @param coin_pin     Input pin carrying the COIN pulse.
         * @param inhibit_pin  Output pin driving INHIBIT, or -1 if unwired.
         *
         * INHIBIT is asserted immediately, so the coin slot is shut before the
         * purchase machine has said anything. A machine that accepts money
         * before it is ready is worse than one that accepts none.
         */
        esp_err_t begin(int coin_pin, int inhibit_pin);

        /// Drain one edge. Returns false when the queue is empty.
        bool next(CoinEdge &out);

        /// Drive INHIBIT. A no-op when the pin is unwired.
        void set_inhibit(bool on);

        /// Edges lost to a full queue. Non-zero means coins may be miscounted.
        uint32_t dropped_edges() const;

    private:
        int coin_pin_ = -1;
        int inhibit_pin_ = -1;
    };
}

#endif // ESP_PLATFORM
```

- [ ] **Step 3: Write the implementation**

`shared/vmaas-coin/src/esp_coin_port.cpp`:

```cpp
/**
 * @file esp_coin_port.cpp
 * @brief See esp_coin_port.h. ESP-IDF only.
 */
#ifdef ESP_PLATFORM

#include "esp_coin_port.h"

#include "driver/gpio.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"

namespace
{
    /// 64 edges is eight coins' worth of a three-pulse train at two edges per
    /// pulse, with room to spare. Coins arrive by hand; this cannot fill in
    /// normal use, so a non-zero dropped_edges() means something is wrong.
    constexpr size_t EDGE_QUEUE_LEN = 64;

    QueueHandle_t edge_queue = nullptr;
    volatile uint32_t dropped = 0;
    int isr_pin = -1;

    /// Kept to the bare minimum: one clock read, one non-blocking send.
    void IRAM_ATTR coin_isr(void *)
    {
        vmaas::CoinEdge edge;
        edge.at_ms = static_cast<uint32_t>(esp_timer_get_time() / 1000);
        edge.level = gpio_get_level(static_cast<gpio_num_t>(isr_pin)) != 0;

        if (xQueueSendFromISR(edge_queue, &edge, nullptr) != pdTRUE)
            ++dropped;
    }
}

namespace vmaas
{
    esp_err_t EspCoinPort::begin(int coin_pin, int inhibit_pin)
    {
        coin_pin_ = coin_pin;
        inhibit_pin_ = inhibit_pin;
        isr_pin = coin_pin;

        if (edge_queue == nullptr)
        {
            edge_queue = xQueueCreate(EDGE_QUEUE_LEN, sizeof(CoinEdge));
            if (edge_queue == nullptr) return ESP_ERR_NO_MEM;
        }

        gpio_config_t in_cfg = {};
        in_cfg.pin_bit_mask = 1ULL << coin_pin;
        in_cfg.mode = GPIO_MODE_INPUT;
        // GPIO34-39 have no internal pull resistors at all; the 10k on the
        // optocoupler's collector is what holds the line. Asking for an
        // internal pull-up here would be silently ignored, so do not.
        in_cfg.pull_up_en = GPIO_PULLUP_DISABLE;
        in_cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
        in_cfg.intr_type = GPIO_INTR_ANYEDGE;

        esp_err_t err = gpio_config(&in_cfg);
        if (err != ESP_OK) return err;

        if (inhibit_pin_ >= 0)
        {
            gpio_config_t out_cfg = {};
            out_cfg.pin_bit_mask = 1ULL << inhibit_pin_;
            out_cfg.mode = GPIO_MODE_OUTPUT;
            out_cfg.intr_type = GPIO_INTR_DISABLE;
            err = gpio_config(&out_cfg);
            if (err != ESP_OK) return err;

            set_inhibit(true);
        }

        // ESP_ERR_INVALID_STATE means another driver already installed the
        // service, which is fine.
        err = gpio_install_isr_service(0);
        if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) return err;

        return gpio_isr_handler_add(static_cast<gpio_num_t>(coin_pin), coin_isr, nullptr);
    }

    bool EspCoinPort::next(CoinEdge &out)
    {
        if (edge_queue == nullptr) return false;
        return xQueueReceive(edge_queue, &out, 0) == pdTRUE;
    }

    void EspCoinPort::set_inhibit(bool on)
    {
        if (inhibit_pin_ < 0) return;
        gpio_set_level(static_cast<gpio_num_t>(inhibit_pin_), on ? 1 : 0);
    }

    uint32_t EspCoinPort::dropped_edges() const { return dropped; }
}

#endif // ESP_PLATFORM
```

- [ ] **Step 4: Confirm the native build still ignores it**

```bash
cd shared/vmaas-coin && $PIO test -e native
```

Expected: PASS, 13 tests. `esp_coin_port.cpp` compiles to nothing because `ESP_PLATFORM` is undefined. If the native build fails here, the guard is wrong — fix it before going on.

- [ ] **Step 5: Confirm the firmware compiles — and that this file is actually in it**

```bash
cd Main-Controller && $PIO run -e main-controller
```

Expected: SUCCESS. `driver` and `esp_timer` are already in `REQUIRES` in `src/CMakeLists.txt`; confirm rather than assume. Record the RAM and Flash percentages.

**That build alone does not compile `esp_coin_port.cpp`.** Nothing in `Main-Controller/src/` includes `esp_coin_port.h` until Task 10, so PlatformIO's library dependency finder never chains `vmaas-coin` into the firmware and the file is skipped in silence. A green build here would say nothing about the code you just wrote.

Files under `Main-Controller/src/` do not have this problem — `CMakeLists.txt` globs them — so this step is only needed for a task that adds files to `shared/`.

Force it, then undo the forcing. Temporarily add to `main.cpp`:

```cpp
#include "esp_coin_port.h"
namespace { vmaas::EspCoinPort ldf_probe; }   // TEMPORARY, delete after the build
```

Rebuild, read the real errors, fix them, then remove those two lines and rebuild once more for the figures you report. Confirm with `git status` that `main.cpp` is unmodified before you finish.

Expect this to find things the host tests cannot: the ESP-IDF toolchain is GCC 15.2 with `-Werror`, and it rejects constructs a PC compiler accepts. Increment on a `volatile` is one — deprecated in C++20 — so `++counter` on a `volatile uint32_t` must be written `counter = counter + 1`.

- [ ] **Step 6: Verify**

Report the native test count, the firmware build result, and the RAM/Flash figures. **Do not commit.**

---

## Task 7: `prices` — the `cash` and `prices` blocks of the cached configuration

**Files:**
- Create: `Main-Controller/src/prices.h`
- Create: `Main-Controller/src/prices.cpp`
- Create: `Main-Controller/data/prices.json` (a bench fixture, flashed with `uploadfs`)

**Interfaces:**
- Consumes: `vmaas::CoinConfig` from `coin_acceptor.h`, `vmaas::PurchaseConfig` from `purchase.h`.
- Produces: `namespace prices` with `struct Table { uint32_t by_slot[33]; char currency[8]; bool loaded; }`, `bool prices::load(vmaas::CoinConfig &coin, vmaas::PurchaseConfig &purchase, Table &table)` reading `/storage/prices.json`, and `uint32_t prices::for_slot(const Table &, uint8_t slot)` returning 0 when the slot has no price.

Slots are 1..32, so `by_slot[0]` is unused and index 33 is the array bound. A slot with no price is not for sale: `for_slot` returns 0 and the caller refuses the selection rather than vending something free.

- [ ] **Step 1: Write the bench fixture**

`Main-Controller/data/prices.json`:

```json
{
  "version": 1,
  "cash": {
    "currency": "DKK",
    "valueByPulses": { "1": 500, "2": 1000, "3": 2000 },
    "activeLow": true,
    "minPulseMs": 15,
    "trainGapMs": 250,
    "paymentTimeoutMs": 60000,
    "hasInhibit": false
  },
  "prices": [
    { "slot": 1, "priceMinor": 1500 },
    { "slot": 2, "priceMinor": 2000 },
    { "slot": 3, "priceMinor": 500 },
    { "slot": 4, "priceMinor": 1000 }
  ]
}
```

`hasInhibit` is false until the bench confirms the pin exists (Task 11). Slots 1-4 match the four slots in `Motorcontrol/data/config.json`.

- [ ] **Step 2: Write the header**

`Main-Controller/src/prices.h`:

```cpp
#pragma once
/**
 * @file prices.h
 * @brief Reads the cash calibration and the slot price table from LittleFS.
 *
 * The file is a cache of MachineConfiguration.payload, fetched from
 * GET /device/configuration. Selling offline from the last known prices is
 * deliberate: a coin cannot be rolled back, so payment must never wait on the
 * network.
 *
 * Every field is optional. Anything missing keeps the default already in the
 * struct the caller passed in, and a malformed file leaves Table::loaded false
 * so no cash sale can happen — the machine falls back to logging slot choices,
 * which is what it did before this feature.
 */
#include <cstdint>

#include "coin_acceptor.h"
#include "purchase.h"

namespace prices
{
    /// Highest slot number the table can hold. Slots are 1-based.
    constexpr uint8_t MAX_SLOT = 32;

    struct Table
    {
        /// Index by slot number; 0 means "no price, not for sale".
        uint32_t by_slot[MAX_SLOT + 1] = {};
        char     currency[8] = "DKK";
        bool     loaded = false;
    };

    /**
     * @brief Load /storage/prices.json over the given defaults.
     * @return True when the file parsed. False leaves every argument untouched
     *         except @p table, whose `loaded` stays false.
     */
    bool load(vmaas::CoinConfig &coin, vmaas::PurchaseConfig &purchase, Table &table);

    /// @return The price for @p slot in minor units, or 0 if it has none.
    uint32_t for_slot(const Table &table, uint8_t slot);
}
```

- [ ] **Step 3: Write the implementation**

`Main-Controller/src/prices.cpp`:

```cpp
/**
 * @file prices.cpp
 * @brief See prices.h. Uses cJSON, as config_store does.
 */
#include "prices.h"

#include <cstdio>
#include <cstring>

#include "cJSON.h"
#include "esp_log.h"

namespace
{
    constexpr const char *TAG = "prices";
    constexpr const char *PATH = "/storage/prices.json";
    /// Generous for 32 slots plus the cash block, and still small next to the
    /// 8 KB the TLS handshake wants.
    constexpr size_t MAX_FILE = 4096;

    /// Read a uint32 field, leaving @p out alone when it is absent or not a
    /// number. Every field in this file is optional by design.
    void read_u32(const cJSON *obj, const char *key, uint32_t &out)
    {
        const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
        if (cJSON_IsNumber(item) && item->valuedouble >= 0)
            out = static_cast<uint32_t>(item->valuedouble);
    }

    void read_u16(const cJSON *obj, const char *key, uint16_t &out)
    {
        uint32_t wide = out;
        read_u32(obj, key, wide);
        if (wide <= 0xFFFF) out = static_cast<uint16_t>(wide);
    }

    void read_bool(const cJSON *obj, const char *key, bool &out)
    {
        const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
        if (cJSON_IsBool(item)) out = cJSON_IsTrue(item);
    }
}

namespace prices
{
    bool load(vmaas::CoinConfig &coin, vmaas::PurchaseConfig &purchase, Table &table)
    {
        FILE *f = std::fopen(PATH, "rb");
        if (f == nullptr)
        {
            ESP_LOGW(TAG, "%s not found, no cash sales until it is provisioned", PATH);
            return false;
        }

        static char buf[MAX_FILE];
        const size_t n = std::fread(buf, 1, sizeof(buf) - 1, f);
        const bool overflowed = !std::feof(f);
        std::fclose(f);
        buf[n] = '\0';

        if (overflowed)
        {
            ESP_LOGE(TAG, "%s is larger than %u bytes, refusing to parse a fragment",
                     PATH, static_cast<unsigned>(MAX_FILE));
            return false;
        }

        cJSON *root = cJSON_Parse(buf);
        if (root == nullptr)
        {
            ESP_LOGE(TAG, "%s is not valid JSON", PATH);
            return false;
        }

        const cJSON *cash = cJSON_GetObjectItemCaseSensitive(root, "cash");
        if (cJSON_IsObject(cash))
        {
            read_bool(cash, "activeLow", coin.active_low);
            read_u16(cash, "minPulseMs", coin.min_pulse_ms);
            read_u16(cash, "trainGapMs", coin.train_gap_ms);
            read_u32(cash, "paymentTimeoutMs", purchase.payment_timeout_ms);
            read_bool(cash, "hasInhibit", purchase.has_inhibit);

            const cJSON *cur = cJSON_GetObjectItemCaseSensitive(cash, "currency");
            if (cJSON_IsString(cur) && cur->valuestring != nullptr)
                std::snprintf(table.currency, sizeof(table.currency), "%s", cur->valuestring);

            const cJSON *values = cJSON_GetObjectItemCaseSensitive(cash, "valueByPulses");
            if (cJSON_IsObject(values))
            {
                for (uint8_t p = 1; p <= vmaas::COIN_MAX_PULSES; ++p)
                {
                    char key[4];
                    std::snprintf(key, sizeof(key), "%u", static_cast<unsigned>(p));
                    read_u32(values, key, coin.value_by_pulses[p]);
                }
            }
        }

        const cJSON *list = cJSON_GetObjectItemCaseSensitive(root, "prices");
        if (cJSON_IsArray(list))
        {
            const cJSON *entry = nullptr;
            cJSON_ArrayForEach(entry, list)
            {
                if (!cJSON_IsObject(entry)) continue;

                uint32_t slot = 0;
                uint32_t price = 0;
                read_u32(entry, "slot", slot);
                read_u32(entry, "priceMinor", price);

                if (slot >= 1 && slot <= MAX_SLOT)
                    table.by_slot[slot] = price;
                else
                    ESP_LOGW(TAG, "ignoring price for out-of-range slot %lu",
                             static_cast<unsigned long>(slot));
            }
        }

        cJSON_Delete(root);
        table.loaded = true;

        ESP_LOGI(TAG, "loaded: currency %s, coins %lu/%lu/%lu, timeout %lu ms, inhibit %s",
                 table.currency,
                 static_cast<unsigned long>(coin.value_by_pulses[1]),
                 static_cast<unsigned long>(coin.value_by_pulses[2]),
                 static_cast<unsigned long>(coin.value_by_pulses[3]),
                 static_cast<unsigned long>(purchase.payment_timeout_ms),
                 purchase.has_inhibit ? "yes" : "no");

        return true;
    }

    uint32_t for_slot(const Table &table, uint8_t slot)
    {
        if (!table.loaded || slot < 1 || slot > MAX_SLOT) return 0;
        return table.by_slot[slot];
    }
}
```

- [ ] **Step 4: Build the firmware**

```bash
cd Main-Controller && $PIO run -e main-controller
```

Expected: SUCCESS. `espressif__cjson` and `esp_partition` are already in `REQUIRES`.

- [ ] **Step 5: Flash the filesystem and prove the file parses on the board**

Nothing calls `prices::load()` yet — wiring it into `app_main` is Task 10 — so a plain boot cannot log anything from this module. Prove it the way Task 6 proved its library reached the binary: force it temporarily, then undo the forcing.

Add to `app_main`, immediately after `config_store::load()`:

```cpp
    // TEMPORARY prices probe. Delete before finishing this task.
    {
        vmaas::CoinConfig probe_coin;
        vmaas::PurchaseConfig probe_purchase;
        prices::Table probe_table;
        prices::load(probe_coin, probe_purchase, probe_table);
        ESP_LOGI(TAG, "probe: slot 1 = %lu, slot 3 = %lu",
                 (unsigned long)prices::for_slot(probe_table, 1),
                 (unsigned long)prices::for_slot(probe_table, 3));
    }
```

Close any serial monitor on COM6 first — a held port makes the upload fail.

```bash
$PIO run -e main-controller -t uploadfs
$PIO run -e main-controller -t upload
$PY ../tools/capture_serial.py COM6 10
```

Expected in the capture, both lines:

```
prices: loaded: currency DKK, coins 500/1000/2000, timeout 60000 ms, inhibit no
MainController: probe: slot 1 = 1500, slot 3 = 500
```

The second line is what makes this worth doing: it proves the table was not merely parsed but is readable by slot number, with the fallback for an absent slot returning 0.

Then delete the probe block, rebuild, and confirm with `git status` that `main.cpp` is unmodified.

`capture_serial.py` lives at the repository root in `tools/`, not under `Main-Controller/` — hence the `../` above when running from `Main-Controller`.

- [ ] **Step 6: Verify**

Paste the `prices` log line into the report. **Do not commit.**

---

## Task 8: `outbox` — append-only JSONL on LittleFS

**Files:**
- Create: `Main-Controller/src/outbox.h`
- Create: `Main-Controller/src/outbox.cpp`

**Interfaces:**
- Consumes: nothing. It takes a formatted line as a `const char *`, so `format_sale_line` from Task 5 and the file I/O stay independent.
- Produces: `namespace outbox` with `esp_err_t begin()`, `esp_err_t append(const char *line)`, `bool peek(char *buf, size_t buf_len)`, `esp_err_t drop_first()`, `size_t pending()`, `uint32_t next_sequence()`.

`append` writes the line, a newline, then `fflush` + `fsync`, and only returns once the bytes are on flash. The caller must not send `RUN` until it has returned: a power cut between a delivered product and a recorded sale is the one failure that cannot be reconciled afterwards. Spec 8.2.

- [ ] **Step 1: Write the header**

`Main-Controller/src/outbox.h`:

```cpp
#pragma once
/**
 * @file outbox.h
 * @brief An append-only queue of device events on LittleFS.
 *
 * JSONL, one event per line. An array would have to be read, parsed, extended
 * and rewritten in full on every append — on flash, with a coin in someone's
 * hand. A line append is a line append, and a half-written last line after a
 * power cut is a local problem: begin() discards it and the rest of the queue
 * survives.
 *
 * append() returns only once the bytes are durable. Nothing may send RUN
 * before it has.
 */
#include <cstddef>
#include <cstdint>

#include "esp_err.h"

namespace outbox
{
    /// Longest line append() accepts, including the terminator. Larger than
    /// the 512-byte buffer format_sale_line fills, so a line that library
    /// accepts can never be one this queue refuses.
    constexpr size_t MAX_LINE = 600;
    /// Hard cap on the queue file. Past this, append() refuses rather than
    /// overwrite history, and the caller must refuse the sale.
    constexpr size_t MAX_BYTES = 64 * 1024;

    /// Mount check, sequence counter restore, and partial-line recovery.
    esp_err_t begin();

    /// Append one line durably. ESP_ERR_NO_MEM when the cap is reached.
    esp_err_t append(const char *line);

    /// Copy the oldest line into @p buf. False when the queue is empty.
    bool peek(char *buf, size_t buf_len);

    /// Remove the oldest line. Call only after it has been accepted upstream.
    esp_err_t drop_first();

    /// Lines waiting to be sent.
    size_t pending();

    /// The next sequence number, monotonic across reboots (kept in NVS).
    uint32_t next_sequence();
}
```

- [ ] **Step 2: Write the implementation**

`Main-Controller/src/outbox.cpp`:

```cpp
/**
 * @file outbox.cpp
 * @brief See outbox.h.
 *
 * drop_first() rewrites the file without its first line. That is O(n) per
 * send, which is fine: n is the backlog, the backlog is normally 0 or 1, and
 * the alternative — an offset file that must stay consistent with the data
 * file across power cuts — is two things to keep in step instead of one.
 */
#include "outbox.h"

#include <cstdio>
#include <cstring>

#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"

namespace
{
    constexpr const char *TAG = "outbox";
    constexpr const char *PATH = "/storage/outbox.jsonl";
    constexpr const char *TMP_PATH = "/storage/outbox.tmp";
    constexpr const char *NVS_NS = "vmaas";
    constexpr const char *NVS_SEQ = "outbox_seq";

    uint32_t sequence = 0;

    size_t file_size()
    {
        FILE *f = std::fopen(PATH, "rb");
        if (f == nullptr) return 0;
        std::fseek(f, 0, SEEK_END);
        const long n = std::ftell(f);
        std::fclose(f);
        return n > 0 ? static_cast<size_t>(n) : 0;
    }

    /**
     * @brief Drop a trailing line with no newline on it.
     *
     * A power cut mid-append leaves exactly that. Keeping it would feed the
     * backend a truncated event; discarding it loses one sale that was never
     * durable in the first place.
     */
    void discard_partial_line()
    {
        FILE *in = std::fopen(PATH, "rb");
        if (in == nullptr) return;

        std::fseek(in, 0, SEEK_END);
        const long size = std::ftell(in);
        if (size <= 0) { std::fclose(in); return; }

        std::fseek(in, size - 1, SEEK_SET);
        const int last = std::fgetc(in);
        std::fclose(in);

        if (last == '\n') return;   // nothing partial

        // Copy up to and including the last newline.
        in = std::fopen(PATH, "rb");
        FILE *out = std::fopen(TMP_PATH, "wb");
        if (in == nullptr || out == nullptr)
        {
            if (in != nullptr) std::fclose(in);
            if (out != nullptr) std::fclose(out);
            return;
        }

        long keep = 0;
        long pos = 0;
        int c;
        while ((c = std::fgetc(in)) != EOF)
        {
            ++pos;
            if (c == '\n') keep = pos;
        }

        std::rewind(in);
        for (long i = 0; i < keep; ++i)
            std::fputc(std::fgetc(in), out);

        std::fclose(in);
        std::fflush(out);
        std::fclose(out);
        std::remove(PATH);
        std::rename(TMP_PATH, PATH);

        ESP_LOGW(TAG, "discarded a partial trailing line (%ld bytes lost)", size - keep);
    }
}

namespace outbox
{
    esp_err_t begin()
    {
        nvs_handle_t h;
        esp_err_t err = nvs_open(NVS_NS, NVS_READWRITE, &h);
        if (err == ESP_OK)
        {
            if (nvs_get_u32(h, NVS_SEQ, &sequence) != ESP_OK) sequence = 0;
            nvs_close(h);
        }
        else
        {
            ESP_LOGW(TAG, "nvs_open failed: %s, sequence restarts at 0",
                     esp_err_to_name(err));
        }

        discard_partial_line();

        ESP_LOGI(TAG, "ready: %u pending, %u bytes, next sequence %lu",
                 static_cast<unsigned>(pending()),
                 static_cast<unsigned>(file_size()),
                 static_cast<unsigned long>(sequence));

        return ESP_OK;
    }

    uint32_t next_sequence()
    {
        ++sequence;

        nvs_handle_t h;
        if (nvs_open(NVS_NS, NVS_READWRITE, &h) == ESP_OK)
        {
            nvs_set_u32(h, NVS_SEQ, sequence);
            nvs_commit(h);
            nvs_close(h);
        }

        return sequence;
    }

    esp_err_t append(const char *line)
    {
        if (line == nullptr) return ESP_ERR_INVALID_ARG;

        const size_t len = std::strlen(line);
        if (len == 0 || len + 2 > MAX_LINE) return ESP_ERR_INVALID_SIZE;
        if (file_size() + len + 1 > MAX_BYTES)
        {
            ESP_LOGE(TAG, "queue is full (%u bytes); refusing the line",
                     static_cast<unsigned>(file_size()));
            return ESP_ERR_NO_MEM;
        }

        FILE *f = std::fopen(PATH, "ab");
        if (f == nullptr) return ESP_FAIL;

        const bool wrote = std::fwrite(line, 1, len, f) == len &&
                           std::fputc('\n', f) == '\n';

        // Durability before anything else happens. The caller must not send
        // RUN until this has returned ESP_OK.
        std::fflush(f);
        std::fclose(f);

        if (!wrote)
        {
            ESP_LOGE(TAG, "short write; the line may be partial");
            return ESP_FAIL;
        }

        return ESP_OK;
    }

    bool peek(char *buf, size_t buf_len)
    {
        if (buf == nullptr || buf_len == 0) return false;
        buf[0] = '\0';

        FILE *f = std::fopen(PATH, "rb");
        if (f == nullptr) return false;

        const bool got = std::fgets(buf, static_cast<int>(buf_len), f) != nullptr;
        std::fclose(f);
        if (!got || buf[0] == '\0') return false;

        char *nl = std::strchr(buf, '\n');
        if (nl != nullptr) *nl = '\0';

        return buf[0] != '\0';
    }

    esp_err_t drop_first()
    {
        FILE *in = std::fopen(PATH, "rb");
        if (in == nullptr) return ESP_OK;   // nothing to drop

        char line[MAX_LINE];
        if (std::fgets(line, sizeof(line), in) == nullptr)
        {
            std::fclose(in);
            std::remove(PATH);
            return ESP_OK;
        }

        FILE *out = std::fopen(TMP_PATH, "wb");
        if (out == nullptr) { std::fclose(in); return ESP_FAIL; }

        int c;
        while ((c = std::fgetc(in)) != EOF)
            std::fputc(c, out);

        std::fclose(in);
        std::fflush(out);
        std::fclose(out);
        std::remove(PATH);

        return std::rename(TMP_PATH, PATH) == 0 ? ESP_OK : ESP_FAIL;
    }

    size_t pending()
    {
        FILE *f = std::fopen(PATH, "rb");
        if (f == nullptr) return 0;

        size_t lines = 0;
        int c;
        while ((c = std::fgetc(f)) != EOF)
            if (c == '\n') ++lines;

        std::fclose(f);
        return lines;
    }
}
```

- [ ] **Step 3: Build the firmware**

```bash
cd Main-Controller && $PIO run -e main-controller
```

Expected: SUCCESS. `nvs_flash` and `spi_flash` are already in `REQUIRES`.

- [ ] **Step 4: Verify durability and recovery on the board**

Temporarily add this to `app_main`, immediately after `config_store::load()`:

```cpp
    // TEMPORARY outbox smoke test. Remove before Task 10.
    outbox::begin();
    ESP_LOGI("SMOKE", "pending before: %u", (unsigned)outbox::pending());
    char line[outbox::MAX_LINE];
    std::snprintf(line, sizeof(line), "{\"eventId\":\"SMOKE-%lu\"}",
                  (unsigned long)outbox::next_sequence());
    ESP_LOGI("SMOKE", "append: %s", esp_err_to_name(outbox::append(line)));
    if (outbox::peek(line, sizeof(line))) ESP_LOGI("SMOKE", "peek: %s", line);
    ESP_LOGI("SMOKE", "pending after: %u", (unsigned)outbox::pending());
```

Flash, capture, then **power-cycle the board twice more** and capture again.

```bash
$PIO run -e main-controller -t upload
$PY ../tools/capture_serial.py COM6 8
$PY ../tools/capture_serial.py COM6 8
```

Expected across the runs: `pending before` grows 0, 1, 2; the sequence number keeps climbing rather than restarting at 1; `peek` always returns the *oldest* line, i.e. `SMOKE-1`, not the newest.

- [ ] **Step 5: Remove the smoke test**

Delete the temporary block from `app_main` and rebuild:

```bash
$PIO run -e main-controller
```

- [ ] **Step 6: Verify**

Report the three captures' `pending`/sequence/`peek` values, and confirm the smoke test is gone. **Do not commit.**

---

## Task 9: `device_api` refactor and the drain task

**Files:**
- Create: `Main-Controller/src/device_api.h`
- Create: `Main-Controller/src/device_api.cpp`
- Modify: `Main-Controller/src/activation.cpp:254-370` (`activate` uses `device_api::post_json`)
- Modify: `Main-Controller/src/wifi_sta.cpp` (call `activation::sync_time` on connect)

**Interfaces:**
- Consumes: `activation::load_certificate(char*, size_t)`, `activation::load_private_key(char*, size_t)`, `activation::load_broker_ca(char*, size_t)` and `activation::sync_time` from `activation.h`; `config_store::API_CA_PATH` and `vmaas::fs::read_text_file` as `activation.cpp:316` already uses them; `outbox::peek`/`drop_first`/`pending` from Task 8.
- Produces: `namespace device_api` with `struct Response { int status; size_t body_len; }`, `esp_err_t device_api::begin(const char *api_base_url)`, `esp_err_t device_api::post_json(const char *url, const char *body, char *resp, size_t resp_len, Response &out)`, `esp_err_t device_api::post_json_mtls(const char *path, const char *body, char *resp, size_t resp_len, Response &out)`, and `bool device_api::drain_outbox_once()` returning true when one line was accepted and dropped.

**Read `activation.h` before writing a line of this.** Three facts there shape the whole task, and an earlier draft of this plan got all three wrong:

1. **The PEMs are not fields.** `activation::Identity` holds only `tenant_id`, `site_id`, `machine_id`, `topic_prefix`, `mqtt_host`, `mqtt_port`. The certificate, key and CA come from `load_certificate`, `load_private_key` and `load_broker_ca`, each filling a caller-supplied buffer.
2. **`api_base_url` is not stored in NVS.** It lives in `DeviceConfig`, read from `config.json` on LittleFS — `onboarding.cpp:285` passes `cfg.api_base_url` into `activate()`. So `device_api` cannot discover it; `begin()` takes it and keeps it.
3. **The PEMs must not go on a task stack.** A certificate is 1-2 KB, the CA 2.5 KB, the key 512 B, and a TLS handshake wants roughly 8 KB of its own. Hold them in function-local `static` buffers, as `activation.cpp:316` does with `ca_pem`, never as locals.

`post_json` is the no-client-certificate path activation uses: it prefers the API CA read from `config_store::API_CA_PATH` and falls back to `esp_crt_bundle_attach` when that file is absent, exactly as `activation.cpp:316-325` does today. `post_json_mtls` adds the client certificate and key, which every endpoint below `/device/activate` requires. Both share one implementation so TLS is configured in one place.

- [ ] **Step 1: Write the header**

`Main-Controller/src/device_api.h`:

```cpp
#pragma once
/**
 * @file device_api.h
 * @brief The one HTTPS client the device uses to talk to the backend.
 *
 * Lifted out of activation.cpp, which had the only working esp_http_client
 * POST in the firmware. Activation, configuration fetch and outbox drain all
 * go through here rather than growing three copies of the TLS setup.
 *
 * Sales are reported over HTTPS, not MQTT, and that is not a workaround: the
 * backend's own MQTT client records that configuration delivery became "an
 * HTTP concern", and cash sales follow it. See the spec, section 13.
 */
#include <cstddef>

#include "esp_err.h"

namespace device_api
{
    struct Response
    {
        int    status = 0;   ///< HTTP status, or 0 when the request never completed.
        size_t body_len = 0;
    };

    /**
     * @brief Remember the API base URL for the mTLS calls.
     *
     * It is not in NVS: it comes from config.json via DeviceConfig, which is
     * why the caller has to hand it over. Call once from app_main, before
     * anything uses post_json_mtls.
     *
     * @param api_base_url e.g. "https://vmaas.dk/api", ending without a slash.
     */
    esp_err_t begin(const char *api_base_url);

    /// POST JSON with no client certificate, for activation. Trusts the API CA
    /// from config_store::API_CA_PATH, falling back to the Mozilla bundle.
    esp_err_t post_json(const char *url, const char *body,
                        char *resp, size_t resp_len, Response &out);

    /// POST JSON with the machine's client certificate. @p path is appended to
    /// the base URL given to begin(), e.g. "/device/events".
    esp_err_t post_json_mtls(const char *path, const char *body,
                             char *resp, size_t resp_len, Response &out);

    /**
     * @brief Send the oldest outbox line, and drop it if the backend took it.
     *
     * A 2xx drops the line. So does a 409 or a 422: the backend has seen this
     * eventId before, or will never accept it, and retrying forever would
     * block every sale behind it. Anything else leaves the line in place.
     *
     * @return True when a line was sent and dropped.
     */
    bool drain_outbox_once();
}
```

- [ ] **Step 2: Write the implementation**

`Main-Controller/src/device_api.cpp`:

```cpp
/**
 * @file device_api.cpp
 * @brief See device_api.h.
 */
#include "device_api.h"

#include <cstdio>
#include <cstring>

#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"

#include "activation.h"
#include "config_store.h"   // API_CA_PATH
#include "outbox.h"
#include "storage.h"       // vmaas::fs::read_text_file

namespace
{
    constexpr const char *TAG = "device_api";
    constexpr int TIMEOUT_MS = 15000;

    char base_url[160] = {};

    /// PEM scratch. Static, not stack: together these are ~5 KB and the TLS
    /// handshake wants about 8 KB of its own on the same task.
    char ca_pem[2560];
    char cert_pem[2048];
    char key_pem[512];
    char api_ca_pem[2560];

    esp_err_t post(const char *url, const char *body, bool with_client_cert,
                   char *resp, size_t resp_len, device_api::Response &out)
    {
        if (url == nullptr || body == nullptr) return ESP_ERR_INVALID_ARG;
        if (resp != nullptr && resp_len > 0) resp[0] = '\0';

        esp_http_client_config_t cfg = {};
        cfg.url = url;
        cfg.method = HTTP_METHOD_POST;
        cfg.timeout_ms = TIMEOUT_MS;

        if (with_client_cert)
        {
            // Three separate accessors, each filling a buffer: the PEMs are
            // not fields on Identity. See activation.h.
            if (activation::load_broker_ca(ca_pem, sizeof(ca_pem)) != ESP_OK ||
                activation::load_certificate(cert_pem, sizeof(cert_pem)) != ESP_OK ||
                activation::load_private_key(key_pem, sizeof(key_pem)) != ESP_OK)
            {
                ESP_LOGE(TAG, "no stored certificate, key or CA; cannot use mTLS");
                return ESP_ERR_INVALID_STATE;
            }

            cfg.cert_pem = ca_pem;
            cfg.client_cert_pem = cert_pem;
            cfg.client_key_pem = key_pem;
        }
        else
        {
            // Same choice activation.cpp:316-325 makes: prefer the API CA
            // shipped in the filesystem, fall back to the Mozilla roots.
            const int n = vmaas::fs::read_text_file(config_store::API_CA_PATH,
                                                    api_ca_pem, sizeof(api_ca_pem));
            if (n > 0)
                cfg.cert_pem = api_ca_pem;
            else
                cfg.crt_bundle_attach = esp_crt_bundle_attach;
        }

        esp_http_client_handle_t client = esp_http_client_init(&cfg);
        if (client == nullptr) return ESP_FAIL;

        esp_http_client_set_header(client, "Content-Type", "application/json");

        const size_t body_len = std::strlen(body);
        esp_err_t err = esp_http_client_open(client, static_cast<int>(body_len));
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "cannot open %s: %s", url, esp_err_to_name(err));
            esp_http_client_cleanup(client);
            return err;
        }

        if (esp_http_client_write(client, body, static_cast<int>(body_len)) < 0 ||
            esp_http_client_fetch_headers(client) < 0)
        {
            ESP_LOGE(TAG, "write or headers failed for %s", url);
            esp_http_client_cleanup(client);
            return ESP_FAIL;
        }

        out.status = esp_http_client_get_status_code(client);
        if (resp != nullptr && resp_len > 1)
        {
            const int read = esp_http_client_read_response(client, resp, static_cast<int>(resp_len) - 1);
            if (read > 0)
            {
                resp[read] = '\0';
                out.body_len = static_cast<size_t>(read);
            }
        }

        ESP_LOGI(TAG, "POST %s -> %d (%u bytes)", url, out.status,
                 static_cast<unsigned>(out.body_len));

        esp_http_client_cleanup(client);
        return ESP_OK;
    }
}

namespace device_api
{
    esp_err_t begin(const char *api_base_url)
    {
        if (api_base_url == nullptr || api_base_url[0] == '\0')
            return ESP_ERR_INVALID_ARG;

        std::snprintf(base_url, sizeof(base_url), "%s", api_base_url);
        ESP_LOGI(TAG, "base url %s", base_url);
        return ESP_OK;
    }

    esp_err_t post_json(const char *url, const char *body,
                        char *resp, size_t resp_len, Response &out)
    {
        return post(url, body, false, resp, resp_len, out);
    }

    esp_err_t post_json_mtls(const char *path, const char *body,
                             char *resp, size_t resp_len, Response &out)
    {
        if (base_url[0] == '\0')
        {
            ESP_LOGE(TAG, "begin() was never called; no base url");
            return ESP_ERR_INVALID_STATE;
        }

        char url[256];
        std::snprintf(url, sizeof(url), "%s%s", base_url, path);

        return post(url, body, true, resp, resp_len, out);
    }

    bool drain_outbox_once()
    {
        char line[outbox::MAX_LINE];
        if (!outbox::peek(line, sizeof(line))) return false;

        char resp[256];
        Response r{};
        const esp_err_t err = post_json_mtls("/device/events", line, resp, sizeof(resp), r);

        if (err != ESP_OK)
        {
            ESP_LOGW(TAG, "drain failed to send: %s; keeping the line",
                     esp_err_to_name(err));
            return false;
        }

        // 2xx: accepted. 409/422: the backend has already seen this eventId,
        // or will never accept it. Both mean the line must go, or every sale
        // behind it is stuck forever.
        const bool settled = (r.status >= 200 && r.status < 300) ||
                             r.status == 409 || r.status == 422;

        if (!settled)
        {
            ESP_LOGW(TAG, "backend answered %d; keeping the line", r.status);
            return false;
        }

        if (outbox::drop_first() != ESP_OK)
        {
            ESP_LOGE(TAG, "sent but could not drop the line; it will be resent "
                          "and deduplicated on eventId");
            return false;
        }

        ESP_LOGI(TAG, "drained one line (%d), %u pending", r.status,
                 static_cast<unsigned>(outbox::pending()));
        return true;
    }
}
```

- [ ] **Step 3: Point `activate` at the shared client**

In `Main-Controller/src/activation.cpp`, replace the hand-rolled client in `activate()` (the block from `esp_http_client_config_t cfg = {};` through `esp_http_client_cleanup(client);`) with:

```cpp
        char url[192];
        std::snprintf(url, sizeof(url), "%s/device/activate", api_base_url);

        device_api::Response r{};
        const esp_err_t err = device_api::post_json(url, req_body, resp, RESP_LEN, r);
        if (err != ESP_OK) return Result::Network;

        const int status = r.status;
```

Add `#include "device_api.h"` at the top. Leave the rest of `activate()` — the status handling and the response parsing — untouched.

`activate()` already reads the API CA from `config_store::API_CA_PATH` into a `static char ca_pem[CA_PEM_LEN]` at `activation.cpp:316`. That logic moves into `device_api::post` (it is the same choice, made once), so delete it from `activate()` rather than leaving two copies.

Then call `begin()` where the base URL is known. In `Main-Controller/src/main.cpp`, right after `config_store::load()`:

```cpp
    // api_base_url comes from config.json, not NVS, so device_api cannot find
    // it by itself. onboarding.cpp:285 passes the same value into activate().
    if (device_api::begin(cfg.api_base_url) != ESP_OK)
        ESP_LOGW(TAG, "no api_base_url in config.json; reporting is disabled");
```

`vmaas::fs::read_text_file` is declared in `"storage.h"` (verified — that is what `activation.cpp:16` includes), and `config_store::API_CA_PATH` is `"/storage/api_ca.pem"`.

- [ ] **Step 4: Sync the clock on every connect**

In `Main-Controller/src/wifi_sta.cpp`, in the handler for `IP_EVENT_STA_GOT_IP`, after the existing log line:

```cpp
    // The ESP32 has no battery-backed RTC, so a cold boot with no network has
    // no date. Onboarding used to be the only caller; an offline cash sale
    // needs a timestamp too, so re-sync whenever the network comes back.
    // Failure is not fatal: sale_line falls back to uptimeMs. Spec 8.3.
    if (activation::sync_time(5000) != ESP_OK)
        ESP_LOGW(TAG, "time sync failed; sales will carry uptime instead of a timestamp");
```

Add `#include "activation.h"` if it is not already there.

- [ ] **Step 5: Build**

```bash
cd Main-Controller && $PIO run -e main-controller
```

Expected: SUCCESS. Record RAM and Flash.

- [ ] **Step 6: Prove the shared client against the live backend — without erasing the device**

The refactor touched the one path that was already proven, so it must be re-proven. **Do not erase the board to do it.** `pio run -t erase` wipes NVS, which holds this machine's certificate, private key and identity — the device would lose its activation and need a fresh one-time code from the backend to get it back. That is a real cost for a test, and it proves the *old* path rather than the new one.

Prove the new path instead. The device already holds a certificate, so `post_json_mtls` can be exercised directly against the running stack.

First point the device at the local backend. `Main-Controller/data/config.json` ships with `"api_base_url": "https://vmaas.dk/api"`, which is a production placeholder. For the bench, set it to the host's LAN address — the device-facing nginx listener is `:8443`, and the PKI covers this host:

```json
  "backend": {
    "api_base_url": "https://10.142.110.83:8443/api"
  }
```

Confirm that address is still this machine's LAN IP (`ipconfig`) and that it appears in `PKI_EXTRA_HOSTS` in `config/environment-variables/.env.backend.dev`. If the IP has moved, the certificate will not cover it and the handshake fails with a name mismatch — regenerate the PKI rather than disabling verification.

Then add a temporary probe to `app_main`, right after `device_api::begin`:

```cpp
    // TEMPORARY mTLS probe. Remove before finishing this task.
    {
        char resp[256];
        device_api::Response r{};
        const char *probe =
            "{\"eventId\":\"PROBE-1\",\"type\":\"probe\","
            "\"occurredAt\":\"2026-09-21T12:00:00Z\",\"payload\":{}}";
        ESP_LOGI(TAG, "probe: %s -> %d",
                 esp_err_to_name(device_api::post_json_mtls("/device/events", probe,
                                                            resp, sizeof(resp), r)),
                 r.status);
    }
```

```bash
$PIO run -e main-controller -t uploadfs
$PIO run -e main-controller -t upload
$PY ../tools/capture_serial.py COM6 30
```

Expected: `device_api` logging `POST https://10.142.110.83:8443/api/device/events -> 201`. A 201 means the TLS handshake, the client certificate, `requireMachine` and the route all worked — which is everything the outbox drain depends on.

A second run should log `-> 200` or `409` rather than `201`, because `eventId` is `@unique` and the backend recognises the replay. That is worth seeing: it is the idempotency the drain relies on, proven on real hardware.

Then delete the probe block, rebuild, and confirm with `git status` that `main.cpp` carries only this task's intended changes.

Activation itself needs no re-proving beyond this: its behaviour is unchanged, only the HTTP client underneath it moved, and this probe exercises that client on a stricter path than activation uses — activation runs without a client certificate, this runs with one.

- [ ] **Step 7: Verify**

Report the build figures and paste the activation log lines. If activation regressed, stop and fix it before Task 10 — everything downstream depends on mTLS working. **Do not commit.**

---

## Task 10: `purchase_task` and the LCD flow

**Files:**
- Create: `Main-Controller/src/purchase_task.h`
- Create: `Main-Controller/src/purchase_task.cpp`
- Modify: `Main-Controller/src/main.cpp` (route `Confirmed`, `on_done`, `on_nak`; start the task)

**Interfaces:**
- Consumes: `vmaas::CoinAcceptor`, `vmaas::EspCoinPort`, `vmaas::Purchase`, `vmaas::format_sale_line`, `prices::*`, `outbox::*`, `device_api::drain_outbox_once`, and `vmaas::GroveLcdRgb` plus `MotorClient` from the existing firmware.
- Produces: `namespace purchase_task` with `bool begin(vmaas::GroveLcdRgb &lcd, bool display_ok, MotorClient &motor)`, `void on_slot_confirmed(uint8_t slot)`, `void on_dispense_done()`, `void on_dispense_failed()`, `void tick(uint32_t now_ms)`.

`tick` is called from the existing main loop, so the purchase machine advances on the same cadence as `SlotEntry` and the LCD. The drain runs on its own FreeRTOS task, because an HTTPS POST takes seconds and must never stall a customer mid-payment.

- [ ] **Step 1: Write the header**

`Main-Controller/src/purchase_task.h`:

```cpp
#pragma once
/**
 * @file purchase_task.h
 * @brief The one place that knows about coins, prices, the LCD, the motor and
 *        the outbox at the same time.
 *
 * Everything decidable lives in vmaas-coin and vmaas-purchase, which are
 * hardware-free and host-tested. This file is the wiring: it moves values
 * between them and the peripherals, and it owns the ordering rule that the
 * outbox line is durable before RUN is sent.
 */
#include <cstdint>

#include "grove_lcd_rgb.h"
#include "motor_client.h"

namespace purchase_task
{
    /// Load the price table, install the ISR, start the drain task.
    /// @return False when there are no prices, in which case cash is disabled
    ///         and the firmware behaves as it did before this feature.
    bool begin(vmaas::GroveLcdRgb &lcd, bool display_ok, MotorClient &motor);

    /// SlotEntry reported Confirmed.
    void on_slot_confirmed(uint8_t slot);
    /// Motorcontrol reported DONE.
    void on_dispense_done();
    /// Motorcontrol reported NAK, or DONE never arrived.
    void on_dispense_failed();

    /// Call every main-loop pass.
    void tick(uint32_t now_ms);

    /// True while a purchase owns the display, so the caller leaves it alone.
    bool active();
}
```

- [ ] **Step 2: Write the implementation**

`Main-Controller/src/purchase_task.cpp`:

```cpp
/**
 * @file purchase_task.cpp
 * @brief See purchase_task.h.
 */
#include "purchase_task.h"

#include <cstdio>
#include <cstring>

#include <ctime>         // time, gmtime_r, strftime

#include "esp_log.h"
#include "esp_timer.h"   // esp_timer_get_time
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "activation.h"  // load_identity, for the machine id in the event id
#include "coin_acceptor.h"
#include "device_api.h"
#include "esp_coin_port.h"
#include "outbox.h"
#include "pins.h"
#include "prices.h"
#include "purchase.h"
#include "sale_line.h"

namespace
{
    constexpr const char *TAG = "purchase";
    /// How long "Take your item" or a failure notice stays readable.
    constexpr uint32_t SETTLED_HOLD_MS = 4000;
    constexpr TickType_t DRAIN_INTERVAL = pdMS_TO_TICKS(10000);

    vmaas::CoinConfig coin_cfg;
    vmaas::PurchaseConfig purchase_cfg;
    prices::Table table;

    vmaas::CoinAcceptor *acceptor = nullptr;
    vmaas::Purchase *machine = nullptr;
    vmaas::EspCoinPort port;

    vmaas::GroveLcdRgb *lcd_ = nullptr;
    bool display_ok_ = false;
    MotorClient *motor_ = nullptr;
    bool cash_enabled = false;

    uint32_t settled_until_ms = 0;
    uint32_t last_dropped_edges = 0;
    char last_row0[17] = {};
    char last_row1[17] = {};

    void show(const char *row0, const char *row1)
    {
        if (!display_ok_ || lcd_ == nullptr) return;

        if (row0 != nullptr && std::strncmp(row0, last_row0, sizeof(last_row0)) != 0)
        {
            std::snprintf(last_row0, sizeof(last_row0), "%s", row0);
            lcd_->clear_row(0);
            lcd_->print_at(0, 0, row0);
        }
        if (row1 != nullptr && std::strncmp(row1, last_row1, sizeof(last_row1)) != 0)
        {
            std::snprintf(last_row1, sizeof(last_row1), "%s", row1);
            lcd_->clear_row(1);
            lcd_->print_at(0, 1, row1);
        }
    }

    /// Minor units as "15.00kr", which fits the 16-column rows.
    void money(char *buf, size_t len, uint32_t minor)
    {
        std::snprintf(buf, len, "%lu.%02lukr",
                      static_cast<unsigned long>(minor / 100),
                      static_cast<unsigned long>(minor % 100));
    }

    void render(const vmaas::PurchaseOutput &o)
    {
        char amount[12];
        char row0[17];
        char row1[17];

        switch (o.state)
        {
        case vmaas::PurchaseState::Idle:
            show("VMaaS: pick slot", "> _");
            break;

        case vmaas::PurchaseState::AwaitingPayment:
            if (o.price_minor == 0)
            {
                money(amount, sizeof(amount), o.credit_minor);
                std::snprintf(row0, sizeof(row0), "Credit %9s", amount);
                show(row0, "Pick a slot");
            }
            else
            {
                money(amount, sizeof(amount), o.price_minor);
                std::snprintf(row0, sizeof(row0), "Slot %-3u%8s",
                              static_cast<unsigned>(o.slot), amount);
                money(amount, sizeof(amount), o.missing_minor);
                std::snprintf(row1, sizeof(row1), "Insert %8s", amount);
                show(row0, row1);
            }
            break;

        case vmaas::PurchaseState::Dispensing:
            show(nullptr, "Paid, dispensing");
            break;

        case vmaas::PurchaseState::Settled:
            if (o.sale_status == vmaas::SaleStatus::Failed)
            {
                std::snprintf(row0, sizeof(row0), "SLOT %u FAILED",
                              static_cast<unsigned>(o.slot));
                show(row0, "contact operator");
            }
            else if (o.sale_status == vmaas::SaleStatus::Completed)
            {
                show(nullptr, "Take your item");
            }
            else
            {
                show(nullptr, "Timed out");
            }
            break;
        }
    }

    /**
     * @brief Write one settlement to the outbox, durably.
     * @return True when the line is on flash.
     *
     * The ordering rule lives here: nothing sends RUN before this returns
     * true. A power cut between a delivered product and a recorded sale is the
     * one failure nobody can reconcile afterwards. Spec 8.2.
     */
    bool settle(const vmaas::PurchaseOutput &o, const char *reason)
    {
        char machine_id[48] = "VM-UNKNOWN";
        activation::Identity id{};
        if (activation::load_identity(id) == ESP_OK)
            std::snprintf(machine_id, sizeof(machine_id), "%s", id.topic_prefix);

        const uint32_t seq = outbox::next_sequence();

        char event_id[72];
        std::snprintf(event_id, sizeof(event_id), "%s-%06lu",
                      machine_id, static_cast<unsigned long>(seq));

        // A real timestamp when the clock is known, uptime otherwise.
        char stamp[32];
        const bool clock_ok = std::time(nullptr) > 1700000000;
        if (clock_ok)
        {
            const std::time_t now = std::time(nullptr);
            std::tm utc{};
            gmtime_r(&now, &utc);
            std::strftime(stamp, sizeof(stamp), "%Y-%m-%dT%H:%M:%SZ", &utc);
        }

        vmaas::SaleLine line;
        line.event_id = event_id;
        line.sequence_number = seq;
        line.slot = o.slot;
        line.price_minor = o.price_minor;
        line.received_minor = o.credit_minor;
        line.status = o.sale_status;
        line.reason = reason;
        line.occurred_at = clock_ok ? stamp : nullptr;
        line.uptime_ms = static_cast<uint32_t>(esp_timer_get_time() / 1000);
        line.currency = table.currency;

        char text[outbox::MAX_LINE];
        if (vmaas::format_sale_line(line, text, sizeof(text)) == 0)
        {
            ESP_LOGE(TAG, "could not format the sale line");
            return false;
        }

        const esp_err_t err = outbox::append(text);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "outbox append failed: %s", esp_err_to_name(err));
            return false;
        }

        ESP_LOGI(TAG, "settled %s", text);
        return true;
    }

    /// Apply one machine output: settle first, then act.
    void apply(const vmaas::PurchaseOutput &o, const char *reason)
    {
        port.set_inhibit(o.inhibit_coins);

        if (o.settle_sale && !settle(o, reason))
        {
            // A vend that cannot be recorded must not happen. Spec 11.
            show("MACHINE FAULT", "no sale recorded");
            settled_until_ms = static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS) + SETTLED_HOLD_MS;
            machine->reset();
            return;
        }

        if (o.run_slot && motor_ != nullptr)
        {
            ESP_LOGI(TAG, "paid: running slot %u", static_cast<unsigned>(o.slot));

            // run() returns false when the frame never went out. Nothing has
            // been settled yet — a purchase settles only at DONE or NAK, per
            // spec 8.2 — so this is just another delivery failure and reports
            // as exactly one failed sale.
            if (!motor_->run(o.slot))
            {
                ESP_LOGE(TAG, "RUN for slot %u was not sent", static_cast<unsigned>(o.slot));
                apply(machine->dispense_failed(
                          static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS)),
                      "run_not_sent");
                return;
            }
        }

        render(o);

        if (o.state == vmaas::PurchaseState::Settled)
            settled_until_ms = static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS) + SETTLED_HOLD_MS;
    }

    void drain_task(void *)
    {
        while (true)
        {
            if (outbox::pending() > 0)
            {
                // One line per pass, oldest first. An HTTPS POST takes
                // seconds, which is exactly why this is not on the main loop.
                device_api::drain_outbox_once();
            }
            vTaskDelay(DRAIN_INTERVAL);
        }
    }
}

namespace purchase_task
{
    bool begin(vmaas::GroveLcdRgb &lcd, bool display_ok, MotorClient &motor)
    {
        lcd_ = &lcd;
        display_ok_ = display_ok;
        motor_ = &motor;

        if (!prices::load(coin_cfg, purchase_cfg, table))
        {
            ESP_LOGE(TAG, "no price table: cash sales disabled");
            return false;
        }

        outbox::begin();

        static vmaas::CoinAcceptor acc(coin_cfg);
        static vmaas::Purchase mac(purchase_cfg);
        acceptor = &acc;
        machine = &mac;

        const int inhibit = purchase_cfg.has_inhibit ? Pins::INHIBIT_OUT : -1;
        const esp_err_t err = port.begin(Pins::COIN_IN, inhibit);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "coin port failed: %s; cash sales disabled",
                     esp_err_to_name(err));
            return false;
        }

        if (xTaskCreate(drain_task, "outbox_drain", 6144, nullptr, 4, nullptr) != pdPASS)
            ESP_LOGE(TAG, "drain task did not start; sales will queue only");

        cash_enabled = true;
        ESP_LOGI(TAG, "cash enabled: COIN on GPIO%d, inhibit %s",
                 Pins::COIN_IN, inhibit >= 0 ? "wired" : "absent");

        apply(machine->reset(), nullptr);
        return true;
    }

    void on_slot_confirmed(uint8_t slot)
    {
        if (!cash_enabled) return;

        const uint32_t price = prices::for_slot(table, slot);
        if (price == 0)
        {
            ESP_LOGW(TAG, "slot %u has no price", static_cast<unsigned>(slot));
            show(nullptr, "Slot not for sale");
            settled_until_ms = static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS) + SETTLED_HOLD_MS;
            return;
        }

        const uint32_t now = static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS);
        apply(machine->slot_chosen(slot, price, now), nullptr);
    }

    void on_dispense_done()
    {
        if (!cash_enabled) return;
        const uint32_t now = static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS);
        apply(machine->dispense_done(now), nullptr);
    }

    void on_dispense_failed()
    {
        if (!cash_enabled) return;
        const uint32_t now = static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS);
        apply(machine->dispense_failed(now), "motor_nak");
    }

    void tick(uint32_t now_ms)
    {
        if (!cash_enabled) return;

        vmaas::CoinEdge edge;
        while (port.next(edge))
            acceptor->on_edge(edge.at_ms, edge.level);

        vmaas::CoinEvent ev;
        while (acceptor->tick(now_ms, ev))
        {
            ESP_LOGI(TAG, "coin: %u pulses = %lu minor",
                     static_cast<unsigned>(ev.pulses),
                     static_cast<unsigned long>(ev.value_minor));
            apply(machine->coin(ev.value_minor, now_ms), nullptr);
        }

        // A dropped edge is not a lost diagnostic: the decoder is a
        // pulse-open/pulse-close machine, so losing one edge can merge two
        // pulses and credit the WRONG coin rather than rejecting cleanly.
        // Filling a 64-slot queue needs about ten coins inside one loop pass,
        // which no hand can do — but if it ever happens, it must be loud.
        const uint32_t drops = port.dropped_edges();
        if (drops != last_dropped_edges)
        {
            ESP_LOGE(TAG, "coin edges dropped: %lu total — a coin value may be "
                          "wrong; check the loop is not being starved",
                     static_cast<unsigned long>(drops));
            last_dropped_edges = drops;
        }

        apply(machine->tick(now_ms), nullptr);

        // Clear the settled screen once it has been readable long enough.
        if (settled_until_ms != 0 && now_ms >= settled_until_ms)
        {
            settled_until_ms = 0;
            apply(machine->reset(), nullptr);
        }
    }

    bool active() { return cash_enabled; }
}
```

- [ ] **Step 3: Wire it into `main.cpp`**

After the onboarding block and before `show_prompt()`:

```cpp
    const bool cash_ok = purchase_task::begin(lcd, display_ok, motor);
    if (!cash_ok)
        ESP_LOGW(TAG, "cash disabled; slot entry logs only, as before");
```

Add `#include "purchase_task.h"`. Then in `render()`, in the `Confirmed` case, after the existing `ESP_LOGI`:

```cpp
                if (purchase_task::active())
                {
                    purchase_task::on_slot_confirmed(slot);
                    return;   // the purchase flow owns the display from here
                }
```

In the motor callbacks:

```cpp
    motor.on_done([](uint8_t slot){
        ESP_LOGI(TAG, "slot %u dispensed", slot);
        purchase_task::on_dispense_done();
    });
```

and inside the existing `on_nak` handler, after the `CONFIG_ERROR` branch:

```cpp
        purchase_task::on_dispense_failed();
```

Finally, in the main loop, after `render(entry.tick(now_ms()));`:

```cpp
        purchase_task::tick(now_ms());
```

- [ ] **Step 4: Build, and read the Flash figure as a result**

```bash
cd Main-Controller && $PIO run -e main-controller
```

Expected: SUCCESS. If `esp_timer_get_time` or `std::time` are missing, `esp_timer` is in `REQUIRES` already — check the includes, not the CMakeLists.

**This is the first build where the four new modules are actually in the binary.** ESP-IDF links with `--gc-sections`, so `prices`, `outbox`, `device_api` and `esp_coin_port` have until now been compiled and then dropped, because nothing referenced them — confirmed by finding no `prices` symbols in `firmware.elf` after Task 7. Their reported Flash figures measured nothing.

Record the Flash percentage and compare it against **67.8%**, the figure with all four absent. Report the jump explicitly rather than only the new number. If it approaches the partition limit, say so and stop rather than trimming code to fit: `Main-Controller/partitions.csv` is where that gets solved, and resizing it is the owner's call because it changes the flash layout of a device that already holds a certificate.

You can confirm the modules really are linked in this time:

```bash
~/.platformio/packages/toolchain-xtensa-esp-elf/bin/xtensa-esp32-elf-nm.exe \
  .pio/build/main-controller/firmware.elf | grep -iE "prices|outbox|device_api|CoinPort" | head
```

Expected: symbols present. An empty result means the wiring did not take, whatever the build says.

**Stack budget.** `settle()` holds `machine_id[48]`, `event_id[72]`, `stamp[32]` and `text[600]` as locals, and calls `format_sale_line`, which adds a 512-byte scratch buffer — over 1.2 KB on one call chain. The drain task additionally runs an HTTPS handshake, which wants roughly 8 KB of its own, plus the ~5 KB of static PEM buffers in `device_api`. The plan gives the drain task 6144 bytes; if it crashes with a stack overflow, raise it rather than shrinking the buffers, and say what value worked. This firmware has hit a stack overflow in activation before for exactly this reason.

- [ ] **Step 5: Confirm the fallback path**

Cash must degrade, not crash. Rename the price file so `prices::load` fails, flash, and confirm the firmware still runs slot entry.

```bash
mv data/prices.json data/prices.json.bak
$PIO run -e main-controller -t uploadfs
$PIO run -e main-controller -t upload
$PY ../tools/capture_serial.py COM6 12
mv data/prices.json.bak data/prices.json
$PIO run -e main-controller -t uploadfs
```

Expected in the capture: `no price table: cash sales disabled`, `cash disabled; slot entry logs only, as before`, and the keypad still producing `slot N selected` lines.

- [ ] **Step 6: Verify**

Report the build figures and the fallback capture. **Do not commit.**

---

## Task 11: Backend — the `cash_sale` handler

**Files:**
- Modify: `shared/schemas/device.ts` (add `cashSalePayloadSchema`)
- Modify: `backend/src/api/services/device.service.ts` (`DeviceDb`, `recordDeviceEventService`)
- Test: `backend/src/api/services/__tests__/device-cash-sale.test.ts`

**Interfaces:**
- Consumes: the JSON line pinned by Task 5's `test_sale_line`.
- Produces: `cashSalePayloadSchema` exported from `@vmaas/shared/schemas`, and `recordDeviceEventService` writing `Sale` and `InventoryMovement` beside the `MachineEvent` when `type === "cash_sale"`.

Read `recordDeviceEventService` and the `DeviceDb` type before writing anything. The existing services inject a narrow structural `db` so they can be tested without Postgres; follow that, do not import `prisma` directly.

- [ ] **Step 1a: Let a clock-less device report at all**

`deviceEventSchema` (`shared/schemas/device.ts:18`) requires `occurredAt: z.iso.datetime()`. Spec 8.3 has the device send `uptimeMs` instead when its clock has never been synchronised — and Task 5's `test_unsynced_clock_emits_uptime_instead` pins exactly that line. As written, such a line is rejected 400 by `validate()`, and `drain_outbox_once` only drops on 2xx, 409 and 422, so it would retry forever with that line at the head of the queue. Every later sale would be stuck behind the first offline one.

Make `occurredAt` optional and accept `uptimeMs` in its place:

```ts
export const deviceEventSchema = z.object({
  body: z
    .object({
      type: z.string().trim().min(1, { message: "type is required" }),
      payload: z.record(z.string(), z.unknown()).default({}),
      /** Device-supplied id, for deduplicating a replayed offline queue. */
      eventId: z.string().trim().min(1).max(128).optional(),
      sequenceNumber: z.coerce.number().int().nonnegative().optional(),
      /**
       * Absent when the device had no clock. An ESP32 has no battery-backed
       * RTC, so a cold boot with no network cannot date its own sales — and a
       * coin cannot be rolled back while it waits for one. `uptimeMs` then
       * says how long before this request the sale happened, and the server
       * dates it from receipt. An approximate timestamp is usable; a
       * fabricated 1970 one is worse than none.
       */
      occurredAt: z.iso.datetime().optional(),
      uptimeMs: z.coerce.number().int().nonnegative().optional(),
    })
    .refine((b) => b.occurredAt !== undefined || b.uptimeMs !== undefined, {
      message: "either occurredAt or uptimeMs is required",
    }),
});
```

Then, wherever `recordDeviceEventService` turns the body into a date, resolve it once:

```ts
// A device with no clock sends how long ago instead of when. Dating from
// receipt is approximate by exactly the queue latency, which is the honest
// answer — see spec 8.3.
const occurredAt =
  body.occurredAt !== undefined
    ? new Date(body.occurredAt)
    : new Date(Date.now() - (body.uptimeMs ?? 0));
```

Use that `occurredAt` for the `MachineEvent`, the `Sale.completedAt` and the `InventoryMovement` — not `body.occurredAt`, which may be undefined.

- [ ] **Step 1b: Add the payload schema**

In `shared/schemas/device.ts`, after `deviceEventSchema`:

```ts
/**
 * The payload of a `cash_sale` device event. The device is the only writer, and
 * it is offline-first: the line was formatted on flash possibly days before it
 * arrives, so nothing here may be derived from the time of receipt.
 *
 * `receivedMinor` is what the customer actually put in. It is kept even though
 * nothing sums it yet, because data not captured cannot be reconstructed later
 * while a report can be built whenever someone wants one.
 */
export const cashSalePayloadSchema = z.object({
  slot: z.coerce.number().int().min(1).max(32),
  price_minor: z.coerce.number().int().nonnegative(),
  received_minor: z.coerce.number().int().nonnegative(),
  status: z.enum(["completed", "failed"]),
  reason: z.string().trim().max(64).optional(),
  currency: z.string().trim().length(3).default("DKK"),
});

export type CashSalePayload = z.infer<typeof cashSalePayloadSchema>;
```

- [ ] **Step 2: Write the failing test**

`backend/src/api/services/__tests__/device-cash-sale.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { recordDeviceEventService } from "../device.service";

/**
 * A cash sale is money that has already changed hands: the coin was in the box
 * before this request existed, and the device cannot be told to undo it. So the
 * only two things that matter here are that one event produces exactly one
 * Sale, and that a replay produces none.
 */

const machine = { id: "m-1", tenantId: "t-1" } as never;

function fakeDb() {
  const tx = {
    machineEvent: { create: vi.fn().mockResolvedValue({ id: "e-1" }) },
    sale: { create: vi.fn().mockResolvedValue({ id: "s-1" }) },
    inventoryMovement: { create: vi.fn().mockResolvedValue({ id: "i-1" }) },
    slot: { findFirst: vi.fn().mockResolvedValue({ id: "slot-1", productId: "p-1" }) },
  };

  return {
    tx,
    db: {
      machineEvent: tx.machineEvent,
      sale: tx.sale,
      inventoryMovement: tx.inventoryMovement,
      slot: tx.slot,
      machineCommand: { findFirst: vi.fn(), update: vi.fn() },
      machineCertificate: { create: vi.fn(), update: vi.fn() },
      machineConfiguration: { findFirst: vi.fn() },
      $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    } as never,
  };
}

function completedEvent() {
  return {
    type: "cash_sale",
    eventId: "VM-16FEE909-000412",
    sequenceNumber: 412,
    occurredAt: "2026-09-21T13:04:11Z",
    payload: {
      slot: 12,
      price_minor: 1500,
      received_minor: 2000,
      status: "completed",
      currency: "DKK",
    },
  } as never;
}

describe("recordDeviceEventService, cash_sale", () => {
  it("writes a completed Sale and decrements the slot", async () => {
    const { tx, db } = fakeDb();

    const [error] = await recordDeviceEventService(db, machine, completedEvent());

    expect(error).toBeNull();
    expect(tx.sale.create).toHaveBeenCalledTimes(1);

    const sale = tx.sale.create.mock.calls[0][0].data;
    expect(sale.status).toBe("completed");
    expect(Number(sale.price)).toBe(15);
    expect(sale.machineId).toBe("m-1");
    expect(sale.tenantId).toBe("t-1");

    const movement = tx.inventoryMovement.create.mock.calls[0][0].data;
    expect(movement.type).toBe("sale");
    expect(movement.quantity).toBe(-1);
  });

  it("records a failed vend without touching stock", async () => {
    const { tx, db } = fakeDb();
    const event = completedEvent() as unknown as { payload: Record<string, unknown> };
    event.payload.status = "failed";
    event.payload.received_minor = 1500;
    event.payload.reason = "motor_nak";

    const [error] = await recordDeviceEventService(db, machine, event as never);

    expect(error).toBeNull();
    expect(tx.sale.create.mock.calls[0][0].data.status).toBe("failed");

    // The comment on inventory_movement_type says "motor ran, nothing dropped":
    // the product was not sold, so stock must not move, but the slot's history
    // must show it so a repeatedly failing slot becomes visible.
    const movement = tx.inventoryMovement.create.mock.calls[0][0].data;
    expect(movement.type).toBe("dispense_failure");
    expect(movement.quantity).toBe(0);
  });

  it("answers a replayed eventId without creating a second Sale", async () => {
    const { tx, db } = fakeDb();
    const duplicate = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["eventId"] },
    });
    tx.machineEvent.create.mockRejectedValueOnce(duplicate);

    const [error, result] = await recordDeviceEventService(db, machine, completedEvent());

    // The device retries until it gets a 2xx. If a replay were an error, the
    // queue would jam forever behind one already-booked sale.
    expect(error).toBeNull();
    expect(result).toMatchObject({ duplicate: true });
    expect(tx.sale.create).not.toHaveBeenCalled();
  });

  it("rejects a payload that is not a cash sale shape", async () => {
    const { tx, db } = fakeDb();
    const bad = completedEvent() as unknown as { payload: Record<string, unknown> };
    bad.payload.price_minor = -1;

    const [error] = await recordDeviceEventService(db, machine, bad as never);

    expect(error).not.toBeNull();
    expect(tx.sale.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd backend && npx vitest run src/api/services/__tests__/device-cash-sale.test.ts
```

Expected: FAIL — `recordDeviceEventService` ignores the type and creates only a `MachineEvent`.

- [ ] **Step 4: Extend `DeviceDb` and the service**

In `backend/src/api/services/device.service.ts`, add to `DeviceDb`:

```ts
  sale: { create(args: unknown): Promise<unknown> };
  inventoryMovement: { create(args: unknown): Promise<unknown> };
  slot: { findFirst(args: unknown): Promise<unknown> };
```

Then, inside `recordDeviceEventService`, branch on the event type before the existing generic path. Match the file's existing `Result`/`err`/`ok` style rather than throwing:

```ts
  // A cash sale is the one device event that moves money, so it gets a Sale
  // row and an inventory movement beside the raw event, all in one
  // transaction keyed on the device's eventId.
  if (body.type === "cash_sale") {
    const parsed = cashSalePayloadSchema.safeParse(body.payload);
    if (!parsed.success) {
      return err({
        reason: "UNKNOWN_ERROR" as const,
        message: `cash_sale payload rejected: ${parsed.error.message}`,
      });
    }

    const cash = parsed.data;
    const priceMajor = cash.price_minor / 100;

    try {
      return ok(
        await db.$transaction(async (tx) => {
          try {
            await tx.machineEvent.create({
              data: {
                machineId: machine.id,
                tenantId: machine.tenantId,
                type: body.type,
                payload: body.payload,
                eventId: body.eventId,
                sequenceNumber: body.sequenceNumber,
                occurredAt,
              },
            });
          } catch (cause) {
            // eventId is @unique precisely so a replayed offline queue is
            // recognised. Answering anything but success here would jam the
            // device's queue behind a sale that is already booked.
            if ((cause as { code?: string }).code === "P2002") {
              return { duplicate: true as const };
            }
            throw cause;
          }

          const slot = (await tx.slot.findFirst({
            where: { machineId: machine.id, slotNumber: cash.slot },
            select: { id: true, productId: true },
          })) as { id: string; productId: string | null } | null;

          const sale = (await tx.sale.create({
            data: {
              tenantId: machine.tenantId,
              machineId: machine.id,
              productId: slot?.productId ?? null,
              status: cash.status,
              price: priceMajor,
              completedAt: cash.status === "completed" ? occurredAt : null,
            },
          })) as { id: string };

          await tx.inventoryMovement.create({
            data: {
              tenantId: machine.tenantId,
              slotId: slot?.id ?? null,
              // "motor ran, nothing dropped": a failed vend is a trace in the
              // slot's history, not an accounting entry, so quantity is 0.
              type: cash.status === "completed" ? "sale" : "dispense_failure",
              quantity: cash.status === "completed" ? -1 : 0,
              saleId: sale.id,
              note: cash.reason ?? null,
              occurredAt,
            },
          });

          return { saleId: sale.id, duplicate: false as const };
        }),
      );
    } catch (cause) {
      console.error("[device.service] recording the cash sale failed", cause);
      return err({
        reason: "UNKNOWN_ERROR" as const,
        message: cause instanceof Error ? cause.message : "Unknown error while recording the cash sale.",
      });
    }
  }
```

Import `cashSalePayloadSchema` from `@vmaas/shared/schemas`.

There is no named error helper in `device.service.ts` — verified. The file builds its failures inline as `err({ reason: "UNKNOWN_ERROR", message })`, four times over, so the code above matches the file's own idiom rather than inventing a helper. If you find yourself wanting one, that is a refactor of four existing call sites and belongs in its own task, not this one.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/api/services/__tests__/device-cash-sale.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Run the whole backend suite**

```bash
npm run test
```

Expected: no new failures. Record the before and after totals; the baseline was 217 tests on 2026-09-21.

- [ ] **Step 7: Prove the path over real mTLS, without hardware**

`backend/tools/fake-machine.ts` already stands in for a device: it activates over HTTPS, connects to EMQX over mTLS and fetches `GET /api/device/configuration` with the certificate it was issued. Reuse its plumbing rather than building a second client.

Read it first, then add a `--cash-sale` mode that POSTs one line to `/api/device/events` through the same undici `Agent` it already constructs for the configuration fetch. Send exactly the text Task 5's `test_completed_sale_is_formatted_exactly` pins, so the wire format is proven end to end rather than only in a unit test.

```bash
cd backend
docker compose -f ../docker/docker-compose.yml cp emqx:/pki/ca.crt ./ca.crt
npm run fake-machine -- --machine <uuid> --code <one-time code> --ca ./ca.crt --cash-sale
```

Expected: `201` on the first POST. **Send the identical line a second time** and expect a 2xx again, with only one `Sale` row in the database — that is the replay guarantee from spec 9.1, and it is the one thing a unit test with a mocked `P2002` cannot fully prove.

Check the row:

```bash
docker compose -f ../docker/docker-compose.yml exec postgres \
  psql -U postgres -d vmaas -c \
  "select status, price, created_at from sales order by created_at desc limit 5;"
```

If the container or database name differs, read `docker/docker-compose.yml` — do not guess.

- [ ] **Step 8: Verify**

Report both test totals, the two POST statuses from step 7, the `sales` row count after the replay, and confirm the controller needs no change because `postDeviceEventController` already returns 201 for any successful `recordDeviceEventService`. **Do not commit.**

---

## Task 12: Bench verification

**Files:** none. This task changes nothing; it finds out what is true.

**Interfaces:** none.

Do the electrical checks before anything is plugged into the ESP32. The order matters: step 1 cannot be undone once a pin is destroyed.

- [ ] **Step 1: Measure the COIN idle voltage with the ESP32 disconnected**

Power the HX-916 from 12 V with nothing connected to the ESP32. Measure between the white COIN wire and GND with no coin inserted.

- **0 V or floating** → a true open collector. The optocoupler is still the design, but a direct connection would also have worked.
- **~12 V** → there is an internal pull-up to 12 V. The optocoupler is mandatory; a direct connection would destroy GPIO35.

Record the reading. This is the one measurement the spec left open (section 3.4).

- [ ] **Step 2: Establish the pulse polarity**

With the optocoupler wired per spec 3.3, flash the current firmware and insert one 5 kr coin.

```bash
cd Main-Controller && $PY ../tools/capture_serial.py COM6 15
```

Expected: a `purchase` line reading `coin: 1 pulses = 500 minor`.

If instead nothing appears, or the pulse count is wrong, the polarity is inverted: set `"activeLow": false` in `data/prices.json`, `-t uploadfs`, and repeat. Record which value was correct — this settles the NO/NC ambiguity the spec flagged.

- [ ] **Step 3: Confirm the pulse count for each coin**

Insert one 5 kr, one 10 kr and one 20 kr coin, separately, with a pause between them.

Expected: `1 pulses = 500`, `2 pulses = 1000`, `3 pulses = 2000`. If a coin gives the wrong count, the acceptor's own calibration is wrong; reprogram it on the unit rather than changing the table.

- [ ] **Step 4: Find out whether INHIBIT exists**

Inspect the harness for a fifth wire or a labelled INHIBIT pin. If there is one, wire it to GPIO4 through a transistor, set `"hasInhibit": true`, `-t uploadfs`, and confirm that a coin inserted with no slot chosen is physically refused.

If there is no such pin, leave `hasInhibit` false and confirm the fallback instead: a coin with no slot chosen must show `Credit 5.00kr` / `Pick a slot`, not be silently swallowed.

Record which case applies. This settles the second open question from spec 3.4.

- [ ] **Step 5: One end-to-end vend**

Motorcontrol must be powered on COM7.

Pick slot 1 on the keypad (15.00 kr in the fixture), insert 10 kr then 5 kr.

Expected: the LCD moves `Slot 1     15.00kr` / `Insert 15.00 kr` → `Insert  5.00 kr` → `Paid, dispensing` → `Take your item`; the motor runs; a `purchase` log line shows the settled JSON; and the backend has one `Sale` row with `price = 15` and `status = completed`.

- [ ] **Step 6: One overpayment and one failed vend**

Overpayment: pick slot 3 (5.00 kr) and insert 20 kr. Expected: it vends, and the settled line reads `price_minor: 500, received_minor: 2000`.

Failed vend: unplug the motor for slot 1, pick slot 1, pay 15 kr. Expected: `SLOT 1 FAILED` / `contact operator`, and a `Sale` row with `status = failed`.

- [ ] **Step 7: One offline sale, drained later**

Power down the backend (or disconnect Wi-Fi), complete a vend, confirm the sale queues, then restore the network.

```bash
$PY ../tools/capture_serial.py COM6 30
```

Expected: the vend completes with no network; `outbox` reports a growing `pending`; and within one drain interval of the network returning, `device_api` logs `POST .../device/events -> 201` and `drained one line`. The backend then holds exactly one `Sale` for that vend — not two.

- [ ] **Step 8: Verify**

Write the findings into the spec as a new section, following the convention of section 12 in the keypad spec (`docs/superpowers/specs/2026-09-17-keypad-slot-entry-design.md:375`):

```markdown
## 14. Hardware verification result (2026-09-21, COM6)
```

State the measured COIN idle voltage, the polarity that worked, the pulse count per coin, whether INHIBIT exists, and the outcome of each of steps 5-7. Then report the same in the task report. **Do not commit.**

---

## Self-review

Checked against the spec on 2026-09-21:

**Spec coverage.** Section 3.1-3.2 (harness, calibration) → Task 12 steps 1-4 and the `prices.json` fixture in Task 7. Section 3.3 (wiring, pins) → Task 6 step 1. Section 3.4 (the two open bench questions) → Task 12 steps 1-2 and 4. Section 4 (architecture, new files) → the File Structure table and Tasks 1-11. Section 5.1 (`vmaas-coin` API) → Tasks 1-2. Section 5.2 (`vmaas-purchase` API) → Tasks 3-4. Section 6.1-6.2 (states, LCD) → Task 3 and Task 10's `render`. Section 6.3 (coin slot in Idle, both hardware cases) → Task 4 and Task 12 step 4. Section 6.4 (what happens to forfeited money) → Task 4's four money tests. Section 6.5 (the two owner decisions) → Tasks 2 and 4, marked. Section 7 (configuration) → Task 7. Section 8.1-8.4 (outbox, ordering, clock, drain) → Tasks 5, 8, 9. Section 9 + 9.1 (backend, replay) → Task 11. Section 10 (integration) → Task 10 step 3. Section 11 (error handling) → the fallback in Task 10 step 5, the outbox-full path in Task 8, `settle` failing in Task 10. Section 12 (testing) → the test folders in Tasks 1-5 and 11, and Task 12. No uncovered requirement found.

**Placeholders.** None. Every code step carries the actual code; every run step carries the actual command and the expected result.

**Type consistency.** `CoinEvent`, `CoinConfig`, `COIN_MAX_PULSES`, `CoinEdge`, `PurchaseState`, `SaleStatus`, `PurchaseOutput`, `PurchaseConfig`, `SaleLine`, `prices::Table`, `outbox::MAX_LINE` and `device_api::Response` are each defined once and used with the same names and field names afterwards. Task 10 consumes `table.currency`, `o.credit_minor` and `o.price_minor` exactly as Tasks 3, 5 and 7 define them. The JSON keys pinned in Task 5's test (`eventId`, `sequenceNumber`, `type`, `occurredAt`, `payload.slot`, `payload.price_minor`, `payload.received_minor`, `payload.status`, `payload.reason`, `payload.currency`) are the same keys Task 11's `cashSalePayloadSchema` and test consume.

Three things an executor must read rather than assume, all flagged in the task text: the real member names on `activation::Identity` (Task 9 step 3), the real name of the error helper in `device.service.ts` (Task 11 step 4), and which of Task 4's tests actually fail against Task 3's implementation (Task 4 step 2).
