# Stepper Dispense: Design

Date: 2026-09-23
Status: Approved for planning
Amends: `2026-09-22-slot-pin-wiring-design.md` (sections "RUN semantics",
"UART protocol", "Schema v2", "Multi-pin RUN", "Payload")

## Summary

The slot motors are stepper motors, one DRV8825 driver per motor at 1/32
microstepping, wired the way `kreativwelt3d/ESP32-Vending-Machine` does it: one
**shared STEP line** to every driver and one **nENABLE line per driver**. DIR is
hardwired on the driver boards. A dispense is a fixed number of step pulses, not
a fixed time.

Motorcontrol today drives one GPIO high for `RUN_TIME_MS`, which is a DC-motor
model. This design replaces it with: enable the slot's drivers, emit
`steps_per_vend` pulses on the shared STEP line from a hardware timer, disable
the drivers, send `DONE`. The pulse count is a per-machine setting authored in
the admin UI and delivered in the same published configuration as the pin
wiring. The pulse interval is a firmware constant.

Main-Controller gains a DONE timeout so a lost frame no longer strands a paid
sale in `Dispensing` forever.

## Goals

- A `RUN` turns exactly one spiral revolution (or whatever `stepsPerVend` says),
  on every motor of the slot, simultaneously.
- Motorcontrol stays responsive on UART during a vend: `STATUS` answers, `STOP`
  works.
- `stepsPerVend` is set per machine in the admin UI and reaches Motorcontrol
  through the existing publish chain, versioned with the wiring.
- No driver is enabled while idle.
- A vend that never reports `DONE` fails the sale after a configurable timeout.

## Non-goals

- Per-slot step counts. One number per machine.
- Acceleration ramps. Spirals start at full speed.
- Stall or drop detection. `DONE` means "pulses sent", not "item fell".
- Controlling DIR, nRESET, nSLEEP or the M0–M2 microstep pins from firmware.
- Configuring the step interval from the backend. It is a firmware constant.
- Backwards compatibility with `config.json` v1. Same reasoning as the wiring
  spec: no machines in production.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Pulse generation | `gptimer` alarm ISR toggling the STEP GPIO, counting steps down | Non-blocking, so UART stays alive; ~1 µs per ISR at 6.4 kHz is under 1 % CPU. LEDC+PCNT would be jitter-free but needs two peripherals and overshoots by a step; blocking bit-bang (the reference repo) kills `STOP` and `STATUS` for the whole vend. |
| Timer stop | The ISR never calls a driver API. It leaves STEP low and sets `done`; `stop()` from task context stops the timer. | Keeps the ISR trivially IRAM-safe. The idle timer costs nothing for the ≤10 ms until `tick()` sees the flag. |
| Where the vend sequence lives | `VendSequencer`, a pure state machine in `shared/vmaas-motor`, host-tested | Motorcontrol has no native test env. Every other piece of logic in this repo that can be tested without hardware is a shared lib with `pio test -e native`. `CommandHandler` becomes a thin layer whose only possible bugs are GPIO number and polarity, which the bench catches. |
| STEP pin | `Pins::STEP = 4` in `Motorcontrol/src/pins.h` | Board wiring, same category as the UART pins. GPIO 4 has the devkit's blue LED, which then shows step activity. |
| Step interval | `Config::STEP_INTERVAL_US = 312` in new `Motorcontrol/src/config.h` | 6400 × 312 µs = 2.0 s per revolution. Tuned on the bench; if a spiral stalls, slow down here first, then consider 1/16. |
| `stepsPerVend` storage | `Machine.stepsPerVend Int @default(6400)` | A machine property, not a slot or pin property. One column, one migration. |
| `stepsPerVend` transport | Inside `wiring.motor` in the payload; `WIRING_COMMIT` carries it as u16 | Wiring and step count commit atomically on Motorcontrol. No second pipeline. |
| `CONFIG` command | `ConfigParam::RUN_TIME_MS` removed; opcode kept, always `NAK BAD_PARAM` | The backend owns the truth now and delivers it as a versioned file. A volatile UART override would be a second source of truth invisible in the admin UI. Main-Controller never sent `CONFIG`. |
| Enable polarity | Idle HIGH, active LOW | DRV8825 nENABLE is active low. Today's `begin()` drives pins low, which would energise every motor at boot. |
| DONE timeout | `timings.dispense_timeout_ms` in Main-Controller's `config.json`, default 30000 | A false timeout records a successful vend as failed, so the bound must exceed the longest vend the admin UI allows (65535 × 312 µs = 20.4 s). Lives beside the other device timings with a safe default. |

## Hardware assumptions

- One DRV8825 per motor. STEP inputs of all drivers wired in parallel to
  `Pins::STEP`. Each driver's nENABLE wired to its own Motorcontrol GPIO; that
  GPIO number is the `Pin.number` the admin UI records for the slot.
- DIR, nRESET, nSLEEP hardwired on each driver board. M0–M2 set for 1/32.
  VREF (current limit) set per driver with the trim pot.
- All drivers share GND with Motorcontrol.
- 200-step motors, so 6400 microsteps per revolution at 1/32. The default
  `stepsPerVend` assumes this; a different motor changes the number, not the
  design.

## Motorcontrol

### `StepGenerator`

`Motorcontrol/src/step_generator.h/.cpp`. Owns the STEP GPIO and one `gptimer`
at 1 MHz resolution, alarm every `STEP_INTERVAL_US / 2` with auto-reload.

```cpp
class IStepGenerator {
public:
    virtual ~IStepGenerator() = default;
    virtual void start(uint32_t steps) = 0;  ///< Begin emitting `steps` pulses. STEP is low on entry.
    virtual void stop() = 0;                 ///< Stop the timer, drive STEP low. Safe in any state.
    virtual bool done() const = 0;           ///< All pulses emitted since the last start().
};
```

- `begin()` configures the GPIO as output low and creates, enables and
  registers the timer with an IRAM alarm callback. Called once, after the
  slot table has been validated and the nENABLE pins raised, so the STEP
  GPIO is never touched in the config-error state.
- `start(steps)` sets `remaining_edges_ = 2 * steps`, clears `done_`, starts
  the timer.
- The ISR: if `remaining_edges_ > 0`, toggle STEP and decrement. If that
  brought it to zero, STEP is now low (an even count always ends low) and
  `done_` is set. The ISR never calls `gptimer_stop`.
- `stop()` calls `gptimer_stop`, drives STEP low, zeroes `remaining_edges_`.
  Idempotent; called after every vend and on `STOP`.
- `remaining_edges_` and `done_` are `volatile` and only written by the ISR
  while the timer runs; `start()`/`stop()` write them only with the timer
  stopped.

DRV8825 needs STEP high and low for at least 1.9 µs each; the half-period is
156 µs. Maximum step rate of the chip is 250 kHz; ours is 3.2 kHz.

### `VendSequencer` (`shared/vmaas-motor`)

Hardware-free state machine for one dispense. No ESP-IDF, no logging. Same cut
as `vmaas-purchase`: events in, actions out.

```cpp
namespace vmaas {
    enum class VendState : uint8_t { Idle, Enabling, Stepping };

    struct VendActions {
        bool enable_pins = false;   ///< Drive the slot's nENABLE pins LOW.
        bool disable_pins = false;  ///< Drive the slot's nENABLE pins HIGH.
        bool start_steps = false;   ///< IStepGenerator::start(steps).
        bool stop_steps = false;    ///< IStepGenerator::stop().
        bool send_done = false;     ///< Send DONE for `slot`.
        uint8_t slot = 0;
        uint32_t steps = 0;
    };

    class VendSequencer {
    public:
        VendState state() const;
        uint8_t current_slot() const;             ///< 0 when Idle.
        /// Begin a vend. Caller has already checked BUSY and UNKNOWN_SLOT.
        VendActions run(uint8_t slot, uint32_t steps, uint32_t now_tick);
        /// STOP from Main-Controller. Idle -> no actions.
        VendActions stop();
        /// Call every loop pass. `step_done` is IStepGenerator::done().
        VendActions tick(uint32_t now_tick, bool step_done);
    };
}
```

```
Idle ──run──▶ Enabling ──(now_tick - started >= 1)──▶ Stepping ──step_done──▶ Idle
                 │                                        │              + disable_pins
               stop                                     stop           + stop_steps
                 ▼                                        ▼              + send_done
               Idle                                     Idle
             + disable_pins                           + disable_pins
                                                      + stop_steps
```

- `Enabling` lasts until the tick counter has advanced by one, which is 0–10 ms
  depending on where in the tick the RUN arrived. That is enough: DRV8825's
  nENABLE acts within microseconds (the 1.7 ms wake-up applies to nSLEEP, which
  is hardwired), and the first STEP edge comes another 156 µs after start. The
  reference repo waits 2 ms.
- Exactly one `send_done` per `run`. `stop()` never produces `send_done`.
- `tick()` in `Idle` produces no actions.
- The sequencer knows the slot number, not the pins. The caller resolves
  `slot -> pins` from `SlotConfig` when acting on `enable_pins`/`disable_pins`.

### `CommandHandler`

Keeps the protocol responsibilities: length checks, `ACK`/`NAK`, `STATUS`,
`BUSY`, `UNKNOWN_SLOT`. Motor behaviour moves out.

- Constructor takes `IStepGenerator&` and the `SlotConfig` (slots with pin
  arrays, plus `steps_per_vend`) instead of the `SlotPin*` table.
- `begin()` drives every configured nENABLE pin **HIGH**. (The `app_main`
  early-boot pass below has already done this for the same pins; `begin()`
  repeats it because it owns the pins from here on.)
- `handle_run()`: validate, `ACK`, then `act(sequencer_.run(slot, steps_per_vend, now))`.
- `handle_stop()`: `act(sequencer_.stop())`, then `ACK`.
- `tick()`: `act(sequencer_.tick(now, gen_.done()))`.
- `act(actions)`: for `enable_pins`/`disable_pins`, write every pin of
  `actions.slot`; for `start_steps`/`stop_steps`, call the generator; for
  `send_done`, `bus_.send(frames::done(slot))`.
- `STATUS` reports `BUSY` in both `Enabling` and `Stepping`.
- `handle_config()`: every param is `NAK BAD_PARAM`. `run_time_ms_` is gone.

### Early boot

DRV8825 has an internal pull-down on nENABLE, and ESP32 GPIOs float during
reset, so every driver is enabled from power-on until firmware says otherwise.
`app_main` cannot know the pin list before `config.json` is parsed, but it can
shorten the window: mount the filesystem and parse the config **before**
`bus.begin()` and before any logging that waits on UART, then drive the
configured pins high immediately, then continue. The remaining window is the
boot ROM plus LittleFS mount, on the order of a few hundred milliseconds. The
hardware fix (pull-ups) is listed under Risks; firmware does what it can.

### Constants

```cpp
// Motorcontrol/src/pins.h
namespace Pins {
    constexpr int UART_TX = 17;
    constexpr int UART_RX = 16;
    constexpr int STEP    = 4;   ///< Shared STEP to every DRV8825. Devkit LED shows activity.
}

// Motorcontrol/src/config.h  (new)
namespace Config {
    /// Full STEP period in microseconds. Half of it is the gptimer alarm.
    /// 312 us x 6400 steps = 2.0 s per revolution at 1/32 microstepping.
    /// Raising it slows every vend on this board; Main-Controller's
    /// timings.dispense_timeout_ms must stay above the longest vend.
    constexpr uint32_t STEP_INTERVAL_US = 312;
}
```

### Reserved pins

`slot_config_parser` is pure and does not know the board. After a successful
parse, `config_store` rejects any table where a pin is reserved on this board:
`Pins::STEP`, `Pins::UART_TX`, `Pins::UART_RX`, the console UART0 pins 1 and 3,
and the SPI flash pins 6–11. The reason is `"slots[i].pins[j] reserved"`. At
boot that is the existing config-error state; on `WIRING_COMMIT` (Plan B) it is
`NAK WRITE_FAILED`, so the backend sees the command fail instead of the board
rebooting into config-error.

**The check runs before any pin is touched.** `disable_all_motors()` skips
reserved pins, so a table naming GPIO 16 never turns the UART RX line into an
output driven against Main-Controller's TX (`uart_set_pin` only routes the
input matrix and would not undo it), a table naming GPIO 4 never drives STEP in
the config-error state, and a table naming 6–11 never resets a flash line. The
legitimate nENABLE pins in the same table are still raised, so the drivers are
off while the board sits in config-error.

## Shared protocol (`shared/vmaas-protocol`)

`protocol.h` and `PROTOCOL.md` change in the same commit, as that file
requires.

| Change | Before | After |
|---|---|---|
| `ConfigParam::RUN_TIME_MS` | u16, volatile, default 500 | Removed. `ConfigParam` stays as an empty enum with a comment that no parameters are defined. `frames::config()` and `MotorClient::config()` removed; nothing calls them. |
| `WIRING_COMMIT` payload | `count` u8 | `count` u8, `steps_per_vend` u16 LE. 3 bytes. `steps_per_vend == 0` gives `NAK BAD_PAYLOAD`. |
| `RUN` semantics | "pin high for RUN_TIME_MS" | "enable the slot's drivers, emit `steps_per_vend` pulses on the shared STEP line, disable, `DONE`". Duration is `steps_per_vend × STEP_INTERVAL_US` plus one tick. |
| `STOP` | pin low | generator stopped, drivers disabled. No `DONE`. |

Everything else in the wiring spec's protocol section (`WIRING_BEGIN`,
`WIRING_SLOT`, error codes 7–9, the 10 s staging timeout, `BUSY` on commit
while running) stands.

## `config.json` v2 (`shared/vmaas-config`)

```json
{
  "version": 2,
  "motor": { "stepsPerVend": 6400 },
  "slots": [
    { "slot": 1, "pins": [18] },
    { "slot": 3, "pins": [21, 22] }
  ]
}
```

| Field | Type | Rule |
|---|---|---|
| `version` | integer | Optional. Higher than 2 gives `NewerVersion`, file still usable. |
| `motor` | object | **Required** (`MissingField`). |
| `motor.stepsPerVend` | integer | **Required**, 1–65535 (`MissingField` / `WrongType` / `OutOfRange`). |
| `slots` | array | Required, 1–32 entries, as before. |
| `slots[i].slot` | integer | 1–255, unique. |
| `slots[i].pins` | array | Required, 1–6 integers 0–33, each unique across the whole file (`DuplicatePin`), 34–39 give `InputOnlyPin`. The v1 `pin` scalar is not accepted. |

No default for `stepsPerVend` in firmware, for the same reason there is no
default wiring: a wrong value dispenses wrongly to someone who has paid. The
file always comes from the backend or from `uploadfs`, and both know the number.

```cpp
constexpr int SLOT_SCHEMA_VERSION = 2;
constexpr size_t MAX_PINS_PER_SLOT = 6;

struct SlotEntry {
    uint8_t slot;
    uint8_t pin_count;
    uint8_t pins[MAX_PINS_PER_SLOT];
};

struct SlotConfig {
    uint16_t steps_per_vend;
    size_t slot_count;
    SlotEntry slots[MAX_SLOTS];
};
```

No new `ConfigIssue` kinds are needed.

## Payload

The `wiring` block keeps the shape of the file, so Main-Controller still knows
one format and forwards without translating:

```jsonc
"wiring": {
  "version": 2,
  "motor": { "stepsPerVend": 6400 },
  "slots": [ { "slot": 1, "pins": [18] }, { "slot": 3, "pins": [21, 22] } ]
}
```

Main-Controller reads `motor.stepsPerVend` and puts it in `WIRING_COMMIT`.
Motorcontrol's `save_config()` writes the block back into the file. About 30
extra bytes; irrelevant against `MAX_CONFIG_BYTES`.

## Backend and admin UI

The step count follows the pins' pipeline step for step. No new endpoint, no
new table.

- **Prisma:** `Machine.stepsPerVend Int @default(6400)`. One migration. The
  1–65535 bound is enforced in Zod and by a Postgres CHECK
  (`machines_stepsPerVend_range`), because seeds bypass Zod, just as the pin
  table's 0–33 CHECK does.
- **Reserved GPIOs in the backend and the editor:** the console pins 1 and 3,
  the flash pins 6–11, and the Motorcontrol board's own pins 4 (STEP), 16 and
  17 (UART to Main-Controller) are refused by Zod and by the slot inspector,
  from one list in `shared/lib/gpio.ts`. The firmware keeps its own check
  (`config_store.cpp`), so the two lists must be kept in step when the board
  changes.
- **Shared schema:** `saveSlotLayoutSchema` gains
  `stepsPerVend: z.number().int().min(1).max(65535)`, required.
  `shared/types/machine.ts` gains the field.
- **`saveSlotLayout`** writes `machine.stepsPerVend` inside the transaction
  that already saves slots and pins. "Save layout" saves layout, pins and step
  count together.
- **`buildConfigurationPayload(slots, cash, motor)`** takes a third argument
  `{ stepsPerVend }` and emits `wiring.motor`. Pure; covered by the existing
  payload tests plus one for the motor block.
- **`publishConfigurationService`** selects `stepsPerVend` from the machine.
  Rollback republishes an older version's payload, so the step count rolls
  back with the wiring for free.
- **Editor** (`machine-layout/[id]`, moved there by the 2026-09-23 layout-editing
  plan): a machine-level card, visible whether or not a slot is selected. The
  value lives in the editor's undoable `Layout` state beside `columns`/`rows`,
  so it is saved, reset and undone with the grid; the card validates with the
  bounds from `shared/lib/gpio.ts` and commits on blur or Enter:

  ```
  +- Motor ----------------------+
  | Steps per vend      [ 6400 ] |
  | 6400 = one full turn at 1/32 |
  +------------------------------+
  ```

  The helper text is static because the UI does not know the firmware's step
  interval and therefore cannot show a duration.

### Relation to Plan A

Plan A (`2026-09-22-slot-pin-wiring-a-backend-ui.md`) is being executed and
finishes as written, without the step count. This spec's plan adds three small
backend/UI tasks (column and schema; service and payload; editor card) on top
of Plan A's Tasks 3–6, then the firmware tasks. Plan B (Main-Controller
forwarding, Motorcontrol `WIRING_*`) is written afterwards against the
combined payload. Editing a plan that is half-executed in another session is
avoided.

## Main-Controller: DONE timeout

`Dispensing` today waits forever for `DONE` or `NAK`. With vends of seconds
rather than 500 ms, a lost frame is a paid customer at a frozen machine.

- **`timings.dispense_timeout_ms`** in `data/config.json`, default **30000**
  in `device_config_defaults()`. A missing key gives 30 s without an issue,
  like the other timings. `0` disables the timeout, the same convention as
  `payment_timeout_ms`. `DEVICE_SCHEMA_VERSION` is unchanged: unknown and
  missing keys are already handled.
- **`PurchaseConfig::dispense_timeout_ms`**, set where the device config is
  applied to the purchase task (not from `prices.json`, which is the backend's
  cash block; this is a device timing).
- **`Purchase`** records `dispense_started_ms_` on entering `Dispensing`.
  `tick()` in `Dispensing` with `dispense_timeout_ms > 0 && now - started >=
  timeout` takes the `dispense_failed()` path: `Settled`, `settle_sale`,
  `SaleStatus::Failed`, and sets a new one-shot `PurchaseOutput::stop_motor`.
- **`purchase_task`** on `stop_motor`: `motor_->stop()`, failure reason
  `"done_timeout"` (the existing NAK path keeps `"motor_nak"`). `STOP` is
  idempotent and `ACK`ed even when Motorcontrol is idle, so it is safe whether
  the `DONE` was lost or the motor is genuinely stuck.
- **Late `DONE`** after the timeout is ignored by the existing guard in
  `dispense_done()`. The sale stays `Failed` although the item may have
  dropped. `purchase_task` logs it at WARN.
- **Why 30 s.** A false timeout is worse than a slow failure: it records a
  successful vend as failed while the customer holds the item. The longest
  vend the admin UI allows is 65535 × 312 µs = 20.4 s; 30 s gives 50 % margin.
  Whoever raises `STEP_INTERVAL_US` on Motorcontrol must raise this too; the
  comment on the constant says so.

## Error handling

| Situation | Behaviour |
|---|---|
| `RUN` while `Enabling` or `Stepping` | `NAK BUSY`, running vend unaffected. Unchanged. |
| `STOP` during a vend | Generator stopped, all drivers disabled, `ACK`, no `DONE`. |
| `STATUS` during a vend | `STATUS_REPLY BUSY slot`. Answered immediately; the ISR does the work. |
| `WIRING_COMMIT` with `steps_per_vend == 0` | `NAK BAD_PAYLOAD`. Staging buffer kept. |
| `WIRING_COMMIT` with a reserved pin | `NAK WRITE_FAILED`. Old wiring stays in force. |
| `config.json` without `motor.stepsPerVend` at boot | Config-error state, as for any invalid file. |
| `StepGenerator::begin()` fails (timer could not be created) | Config-error state with reason `step generator failed`: every `RUN` is `NAK CONFIG_ERROR`, Main-Controller shows `MOTOR CONFIG ERR`, the 30 s restart loop retries. Continuing would let a `RUN` enable a driver and report a false `DONE`. |
| `DONE` never arrives | Main-Controller fails the sale after `dispense_timeout_ms`, sends `STOP`. |
| Stall, jammed or empty spiral | Not detected. `DONE` is sent after the pulses. Same contract as today and as the reference repo. |

## Risks

- **Drivers enabled from power-on.** DRV8825's internal pull-down on nENABLE
  plus floating ESP32 GPIOs during reset means every motor holds current for a
  few hundred milliseconds at boot, more if `config.json` is missing (the
  board then never learns which pins to raise). **Recommendation: 10 kΩ
  pull-ups from each nENABLE line to 3.3 V.** Firmware raises the pins as early
  as it can (see Early boot), but only hardware closes the window fully.
- **Shared STEP line fan-out.** Each DRV8825 STEP input is roughly 100 kΩ; 24
  drivers is about 4 kΩ, fine for one ESP32 GPIO. Beyond ~30 drivers or with
  long runs, buffer the line.
- **Torque at 1/32.** Incremental torque per microstep is small. If a spiral
  stalls at 312 µs, slow down first (raise `STEP_INTERVAL_US`, then raise
  `dispense_timeout_ms` to match), then consider M0–M2 at 1/16 with
  `stepsPerVend` halved. Both are bench tuning, not design changes.
- **Two motors on one slot draw twice the current.** Carried over from the
  wiring spec. Measure on the bench before multi-pin `RUN` is called done.
- **Two firmware constants must agree:** `STEP_INTERVAL_US` on Motorcontrol
  and `dispense_timeout_ms` on Main-Controller. Documented on both; no
  mechanism enforces it.
- **Disabled drivers may still count STEP.** DRV8825's nENABLE switches the
  H-bridge outputs off; whether the indexer keeps advancing on STEP while
  disabled is to be confirmed on the bench. If it does, every idle motor on the
  shared line advances its internal position during another slot's vend and
  may jump up to a few full steps when next enabled. Harmless for a spiral,
  but worth knowing before anyone relies on absolute position.
- **Rollback to a pre-motor payload.** Configurations published between the
  wiring plan and this one are labelled `version: 2` but have no `motor`
  block; republishing one via `fromVersion` would hand the firmware a file it
  refuses (`MissingField motor`). No such row exists in any database today
  (checked 2026-09-23), so the guard (`VERSION_INCOMPATIBLE` on rollback) is
  deferred to Plan B.
- **`stepsPerVend` assumes 200-step motors at 1/32.** A different motor or
  microstep setting changes the correct number; the admin UI's helper text
  states the assumption.

## Testing

| Layer | How |
|---|---|
| `VendSequencer` | `pio test -e native` in `shared/vmaas-motor`: every transition, `stop()` in each state, exactly one `send_done` per `run`, no actions in `Idle`, `Enabling` lasts one tick, slot number carried in every action. |
| `slot_config_parser` v2 | Existing native suite extended: `motor` missing, `stepsPerVend` 0 / 65536 / non-integer, `pins` array of 1 and 6 and 7, v1 `pin` scalar rejected, duplicate pin across two slots. |
| Protocol | Existing native suite: `WIRING_COMMIT` 3-byte encode/decode, `steps_per_vend == 0`, `CONFIG` gives `BAD_PARAM`, `frames::config` gone. |
| `Purchase` | Native in `vmaas-purchase`: timeout yields exactly one `Failed` settlement and `stop_motor`; `DONE` just before the deadline wins; `DONE` after the deadline is ignored; timeout does not tick in `Idle`, `AwaitingPayment` or `Settled`; `dispense_timeout_ms = 0` never times out. |
| `device_config` | Native: `timings.dispense_timeout_ms` read, default 30000 when absent. |
| Backend | Vitest: Zod bounds for `stepsPerVend`; `saveSlotLayout` writes the column; payload builder emits `wiring.motor`; publish selects it; rollback carries it. |
| Bench | Logic analyser on STEP and one nENABLE: 6400 pulses at 312 µs period, nENABLE low from ~10 ms before the first pulse until after the last. `STATUS` and `STOP` answered mid-vend. All nENABLE high at boot and in idle (check with the pull-ups fitted). Motor turns exactly one revolution. Flash Motorcontrol with a test build that drops `DONE` and confirm Main-Controller fails the sale at 30 s with reason `done_timeout`, Motorcontrol logs the `STOP`, and the LCD shows the failure notice. |

## Build order

1. `shared/vmaas-motor`: `VendSequencer` with native tests.
2. `shared/vmaas-config`: schema v2 (`motor`, `pins[]`), native tests.
3. `shared/vmaas-protocol`: `RUN_TIME_MS` removed, `WIRING_COMMIT` payload,
   `PROTOCOL.md`, native tests.
4. `shared/vmaas-purchase` + `device_config`: DONE timeout, native tests.
5. Motorcontrol: `StepGenerator`, `CommandHandler` on the sequencer, `pins.h`,
   `config.h`, early-boot enable, reserved-pin check. Bench: one motor, one
   revolution, on the flashed `data/config.json`.
6. Main-Controller: `dispense_timeout_ms` wiring into `purchase_task`,
   `MotorClient::config()` removed.
7. Backend and UI: column, schema, service, payload, editor card (after Plan A
   lands).
8. Plan B, written against this spec and the wiring spec together.
