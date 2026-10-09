# HX-916 Coin Acceptor and Cash Purchase Flow for Main-Controller

**Date:** 2026-09-21
**Status:** Designed, not implemented.
**Scope:** Firmware and backend. Two new shared libraries
`shared/vmaas-coin/` and `shared/vmaas-purchase/`, four new files in
`Main-Controller/src/`, one new field group in `MachineConfiguration.payload`,
and one new event type handled by `recordDeviceEventService`. No schema
migration.

## 1. Goal

Let a customer pay for a vend with coins. An HX-916 programmable multi-coin
acceptor is wired to Main-Controller, the customer picks a slot on the keypad,
the LCD shows the price and counts down what is still missing, and the vend
starts the moment the credit covers the price. The sale is written to an
on-flash queue and reported to the backend over the existing mTLS HTTPS path.

This replaces mock payment as the real cash path for v1. Card and mobile
payment are unaffected and out of scope here.

Three pieces come out of this, split by what they depend on:

- `shared/vmaas-coin` turns edge timestamps into `CoinEvent`s carrying a coin
  value. It touches no GPIO.
- `shared/vmaas-purchase` turns a slot choice and a stream of coin values into
  purchase decisions. It touches no hardware, no display and no network.
- `Main-Controller/src/` wires those two to the keypad, the LCD, the motor and
  an append-only outbox on LittleFS.

Both libraries are hardware-free for the same reason `vmaas-entry` is: the
simulator and the host test suite must be able to run the whole payment policy
with no coin acceptor on the desk.

## 2. Non-goals (v1)

- Change. The HX-916 has no coin dispenser and no escrow. Once a coin is
  accepted it is in the box, and no firmware can return it. Section 6.4 states
  what happens to the difference.
- Carrying credit between customers. Credit is always cleared; see 6.4.
- Bill validators, card readers, mobile payment.
- A cash reconciliation table or report. The received amount is recorded in the
  sale payload so it can be reconstructed later, but nothing sums it today.
- Reporting abandoned partial payments. Deliberately dropped; see 6.4 and 13.
- Price validation in the admin UI. Deliberately dropped; see 13.
- Localisation of LCD strings. They stay ASCII English, as in `main.cpp` today.
- MQTT. Cash sales report over HTTPS. **Superseded detail (2026-09-22):** this
  spec was written when the firmware had no MQTT client at all. It has one now —
  `Main-Controller/src/broker_client.{h,cpp}`, added by commit 75aff80 on
  another branch and merged into `dev`, which connects to the broker over mTLS
  so the machine reads Online. It publishes presence, not sales. Cash sales
  still go over HTTPS, for the reason in section 13: configuration delivery and
  device-initiated reporting were deliberately moved off MQTT, and sales follow
  configuration. This spec does not change `broker_client`.

## 3. Hardware

### 3.1 The HX-916

A programmable multi-coin acceptor with a four-wire harness. It is calibrated
by hand on the unit itself: each coin type is taught by inserting samples, and
each type is assigned a number of output pulses.

| Wire | Typical colour | Direction | Purpose |
|------|----------------|-----------|---------|
| DC12V | red | in | 12 V DC supply. The sorting solenoid draws short current peaks; size the supply for ~1 A. |
| GND | black or green | — | Common ground, reference for supply and signal. |
| COIN | white | out | Pulse output. One accepted coin produces N pulses, where N is what the unit was programmed to emit for that coin type. |
| COUNTER | grey | out | Drives a mechanical tally counter. Not a microcontroller signal and not used here. Left unconnected. |

Two switches on the unit change the electrical behaviour:

- **NO/NC** selects the polarity of the pulse. Set to **NC** on the bench unit.
- **Speed** selects the pulse width: fast 20 ms, medium 50 ms, slow 100 ms.
  Use **slow (100 ms)** unless the bench shows a reason not to; see 3.4.

### 3.2 Coin calibration

Three coin types, programmed so the pulse count identifies the coin:

| Pulses | Coin | `value_minor` (øre) |
|--------|------|---------------------|
| 1 | 5 kr | 500 |
| 2 | 10 kr | 1000 |
| 3 | 20 kr | 2000 |

1 kr and 2 kr are deliberately not accepted. Fewer coin types means shorter
pulse trains and less chance of misrecognition.

The consequence is that only multiples of 5 kr can be paid exactly. A price of
17 kr cannot be paid correctly by anyone, ever. This is a real constraint on
how prices should be set, and it is not enforced anywhere; see 13.

### 3.3 Wiring (Main-Controller, ESP32-WROVER on COM6)

The COIN output is optocoupled. This is not a precaution against a measurement
that was skipped — it is the safe choice regardless of what the measurement
shows, and it also keeps the sorting solenoid inductive spikes off the ESP32.

```
  HX-916                    PC817                  ESP32-WROVER
 ---------                 -------                --------------
  DC12V   o--- +12V
  GND     o--- GND12 --------o cathode
  COIN    o---[1k]-----------o anode
  COUNTER o--- (unconnected)

                         collector o----+---- GPIO35   (COIN in)
                                        |
                                    [10k] to 3V3       (external pull-up)
                         emitter   o---------- GND3V3

  INHIBIT (if present) <----------------- GPIO4         (through a transistor
                                                         or a second PC817)
```

| Signal | GPIO | Why this pin |
|--------|------|--------------|
| COIN in | 35 | Input-only and without an internal pull-up, which normally rules it out for an open-collector input. The optocoupler needs an external 10k pull-up anyway, so the limitation costs nothing, and a general-purpose GPIO stays free. Confirmed free on the bench unit. |
| INHIBIT out | 4 | Ordinary output, not a strapping pin. Only wired if the harness has the pin. **Changed from 13 on 2026-09-22:** the door-lock work took GPIO13 for the relay after this spec was written, so the two collided. 16/17 carry PSRAM, 6-11 carry flash, 34-39 are input-only and 0/2/5/12/15 are strapping pins, which leaves 4 as the only free general-purpose output. |

Neither conflicts with the existing assignments in `Main-Controller/src/pins.h`:
UART 32/33, I2C 21/22, keypad rows 26/19/14/27, keypad columns 23/25/18,
door relay 13. A `static_assert` in `pins.h` now fails the build if any two
assignments collide, so this list cannot silently go stale again.

### 3.4 Two things the bench must settle

Both are configuration, not constants, so neither blocks implementation.

1. **Pulse polarity.** The NO/NC labelling on these units is inconsistent
   between vendors, and the optocoupler inverts the signal once more depending
   on which side the LED sits. Whether an accepted coin reads as a low pulse or
   a high pulse must be observed, not assumed. `CoinConfig::active_low`
   carries the answer.
2. ~~**Whether INHIBIT exists.**~~ **Settled on the bench, 2026-09-22: it does.**
   The harness carries a pin pair labelled `SET`, described on the unit as
   "Disable signal input. Upper PIN: signal input, lower PIN: ground."
   Measured behaviour: **shorting the two pins blocks coin acceptance.**

   That matches the firmware's existing polarity with no change needed:
   `Purchase` asserts `inhibit_coins` whenever the machine is not actively
   waiting for money it still needs, `EspCoinPort::set_inhibit(true)` drives
   `INHIBIT_OUT` high, and through an optocoupler that closes the `SET` pair.

   Wire it through its own optocoupler rather than directly: the `SET` pair
   references the acceptor's 12 V ground, not the ESP32's, and a direct
   connection would tie the two grounds together.

   Set `cash.hasInhibit` to `true` in the device's configuration once it is
   wired, and section 6.3's stronger behaviour takes effect — the coin slot is
   shut while idle, so money cannot enter the machine at all without a product
   having been chosen.

## 4. Architecture

```
  COIN edge ---> EspCoinPort (ISR: timestamp only)
                      |
                   queue
                      v
                 vmaas-coin ---- CoinEvent{pulses, value_minor}
                                      |
  keypad ---> SlotEntry --Confirmed(slot)-->  vmaas-purchase
                                                  |
                              +-------------------+--------------------+
                              |                   |                    |
                          PurchaseOutput      PurchaseOutput      PurchaseOutput
                          .inhibit_coins      .run_slot           .settle_sale
                              |                   |                    |
                           GPIO4             MotorClient RUN      outbox.jsonl
                                                                       |
                                                             device_api (HTTPS)
                                                                       |
                                                         POST /device/events
```

The ISR does one thing: push a `(timestamp, level)` pair onto a queue and
return. Every interpretation — is this a new coin, how many pulses, what value
— happens on the main task inside `vmaas-coin`. That is what makes the decoder
testable on a host: it only ever sees a stream of timestamped edges.

`vmaas-purchase` knows nothing about GPIO, the LCD, the UART or HTTP. It
receives coin values and slot choices and returns decisions. This is the same
cut as `SlotEntry`, which returns an `EntryState` without knowing a display
exists.

### 4.1 New files

| File | Responsibility |
|------|----------------|
| `shared/vmaas-coin/src/coin_acceptor.{h,cpp}` | Pulse train decoder, hardware-free |
| `shared/vmaas-coin/src/esp_coin_port.{h,cpp}` | GPIO ISR, edge queue, INHIBIT pin |
| `shared/vmaas-purchase/src/purchase.{h,cpp}` | Purchase state machine, hardware-free |
| `Main-Controller/src/device_api.{h,cpp}` | The HTTPS client lifted out of `activation.cpp` |
| `Main-Controller/src/prices.{h,cpp}` | Reads the cached configuration blob, resolves slot prices |
| `Main-Controller/src/outbox.{h,cpp}` | Append-only JSONL queue on LittleFS |
| `Main-Controller/src/purchase_task.{h,cpp}` | Glues coin, entry, purchase, LCD and motor together |

`device_api` is a refactor, not new behaviour. `activation.cpp:275-362` already
contains a working `esp_http_client` POST with TLS; activation, configuration
fetch and outbox drain must share one client rather than grow three copies.

## 5. Public API

### 5.1 vmaas-coin

```cpp
namespace vmaas
{
    /// One accepted coin, decoded from a pulse train.
    struct CoinEvent
    {
        uint8_t  pulses;      ///< Pulses counted in the train.
        uint32_t value_minor; ///< Coin value in minor units. 0 = unrecognised.
    };

    struct CoinConfig
    {
        bool     active_low = true;  ///< Whether a coin reads as a low pulse.
        uint16_t min_pulse_ms = 15;  ///< Shorter edges are noise, not coins.
        uint16_t train_gap_ms = 250; ///< Silence this long ends a pulse train.
        /// pulses -> value, index 1..8. 0 means "this count is not a coin".
        uint32_t value_by_pulses[9] = {};
    };

    class CoinAcceptor
    {
    public:
        explicit CoinAcceptor(const CoinConfig &cfg);

        /// Feed one edge drained from the ISR queue. Never called in the ISR.
        void on_edge(uint32_t at_ms, bool level);

        /// Call every loop. Returns true and fills `out` when a train closes.
        bool tick(uint32_t now_ms, CoinEvent &out);

        uint32_t rejected_pulses() const; ///< Too short to be a real pulse.
        uint32_t unknown_trains() const;  ///< Pulse count absent from the table.
    };
}
```

Values are integers in minor units. Money and floating point do not mix:
`0.1 + 0.2 != 0.3` in binary floating point, and a machine that loses a minor
unit per transaction is an accounting fault. The backend uses `Decimal` for the
same reason (`schema.prisma:388`); integer minor units are the ESP32
equivalent.

`train_gap_ms = 250` sits in the gap between two timescales. With the acceptor
on its 100 ms setting, pulses within one train are roughly 100-200 ms apart,
while two coins inserted by hand are at least half a second apart. On the 20 ms
setting the value can come down, which is why it is configuration.

### 5.2 vmaas-purchase

```cpp
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

    /// What the caller must do after handing the machine an event. Several
    /// fields can be set at once: paying the last coin both stops the coin
    /// slot and starts the motor.
    struct PurchaseOutput
    {
        PurchaseState state;
        uint32_t   price_minor;    ///< 0 in Idle.
        uint32_t   credit_minor;   ///< Counted so far.
        uint32_t   missing_minor;  ///< price - credit, floored at 0.
        bool       inhibit_coins;  ///< Drive the INHIBIT pin to this.
        bool       run_slot;       ///< Send RUN for `slot` now.
        uint8_t    slot;
        bool       settle_sale;    ///< Append one line to the outbox.
        SaleStatus sale_status;    ///< What to report when settle_sale is set.
    };

    struct PurchaseConfig
    {
        uint32_t payment_timeout_ms = 60000; ///< Inactivity before giving up.
        bool     has_inhibit = false;        ///< Whether GPIO4 is wired. 
    };

    class Purchase
    {
    public:
        explicit Purchase(const PurchaseConfig &cfg);

        PurchaseOutput slot_chosen(uint8_t slot, uint32_t price_minor, uint32_t now_ms);
        PurchaseOutput coin(uint32_t value_minor, uint32_t now_ms);
        PurchaseOutput dispense_done(uint32_t now_ms);
        PurchaseOutput dispense_failed(uint32_t now_ms);
        PurchaseOutput cancel(uint32_t now_ms);
        PurchaseOutput tick(uint32_t now_ms);

        /// Called once the caller has durably written the settlement.
        PurchaseOutput reset();
    };
}
```

`Settled` exists as its own state on purpose. `SlotEntry` resets itself the
instant it reports `Confirmed`, which is why `main.cpp` needs the
`result_hold_until_ms` workaround (`main.cpp:106`). Here the machine does not
reset itself: it stays in `Settled` until the owner has written the outbox line
and called `reset()`. Money must not be able to disappear because a display
needed refreshing.

## 6. Behaviour

### 6.1 State transitions

```
  Idle --slot chosen--> AwaitingPayment --credit >= price--> Dispensing
   ^                         |                                   |
   |                         | payment_timeout_ms                | DONE / NAK
   |                         v                                   v
   +----- reset() ------- Settled <------------------------- Settled
```

### 6.2 On the LCD

Sixteen columns per row, as everywhere else in this firmware.

```
  Idle                Row0: "VMaaS: pick slot"     (unchanged)
                      Row1: "> _"

  AwaitingPayment     Row0: "Slot 12  15.00kr"
                      Row1: "Insert 15.00 kr"
                       ...after a 10 kr coin:
                      Row1: "Insert  5.00 kr"

  AwaitingPayment     Row0: "Credit   10.00kr"    (no INHIBIT pin, coin first;
  with price_minor 0  Row1: "Pick a slot"          see 6.3)

  Dispensing          Row1: "Paid, dispensing"

  Settled, completed  Row1: "Take your item"
  Settled, failed     Row0: "SLOT 12 FAILED"
                      Row1: "contact operator"
  Settled, timeout    Row1: "Timed out"
```

### 6.3 The coin slot in Idle

Because the flow is choose-then-pay, the coin slot can be blocked entirely
while no slot is selected. With INHIBIT wired, money cannot enter the machine
without a product having been chosen, and INHIBIT is asserted again the moment
credit covers the price. Maximum overpayment is then one coin, and zero for
prices that are multiples of 5 kr.

The design must not depend on the pin existing. Without INHIBIT a customer can
drop a coin into an idle machine, and ignoring it would be theft — the money is
already in the box. So a coin arriving in `Idle` when `has_inhibit` is false
moves to `AwaitingPayment` with that credit and `price_minor = 0`, showing
`"Pick a slot"` on row 1, under the same timeout. One code path, two hardware
realities.

### 6.4 What happens to money the customer does not get back

Credit is always cleared at the end of a customer. It is never carried to the
next one.

| Situation | Vend | Reported | The difference |
|-----------|------|----------|----------------|
| Exact payment | yes | `cash_sale`, `completed` | none |
| Overpayment (one coin too large) | yes | `cash_sale`, `completed`, `received_minor` > `price_minor` | kept by the machine, visible in the payload |
| Payment abandoned before the price is covered | no | nothing, only a device log line | kept by the machine, invisible to the backend |
| Motor fails after payment | no | `cash_sale`, `failed` | kept by the machine, visible in the payload |

The abandoned case is the one piece of information this design gives up. The
cash box will hold slightly more than the sum of reported sales. That is a
known and explainable difference rather than a mystery, and with INHIBIT
blocking an idle machine it is rare.

Overpayment and a failed vend are different in kind: the first is the
customer's coin being too large, the second is the machine's own failure. Both
keep the money, but the failed vend is reported with `status: "failed"`, so an
operator can find it and compensate by hand. `sale_status` already has `failed`
(`schema.prisma:285`), so this costs one field in a payload, not a new event
type.

A timeout settles with `settle_sale = false` and `sale_status = None`: there
was no vend, so there is nothing to report. `tick()` in `Idle` is a no-op.

### 6.5 Decision rules left open for the implementer

Following the convention of the keypad spec section 6.2, two rules are
deliberately not decided here, because they are policy rather than mechanism:

1. **An unrecognised pulse train.** `CoinAcceptor` counted a train whose pulse
   count is not in `value_by_pulses`. The acceptor has taken a coin the
   firmware cannot name: the money is in the box and its value is unknown.
   Crediting a guessed value cheats one party; crediting nothing cheats the
   other. Implement the choice in `CoinAcceptor::tick` and state the reasoning
   in a comment.
2. **A coin arriving during `Dispensing`.** The motor is already running and the
   sale is settled. Whether that coin joins the next purchase, is counted into
   the current one, or is discarded needs one rule, in `Purchase::coin`.

## 7. Configuration

Coin calibration and prices arrive the same way, in the existing versioned
`MachineConfiguration.payload` (`schema.prisma:514`), fetched by the device
with `GET /device/configuration` over mTLS and cached to LittleFS.

```json
{
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
    { "slot": 12, "priceMinor": 1500 }
  ]
}
```

Prices are resolved server side as `Slot.price ?? Product.price`, mirroring the
nullable override in the schema (`schema.prisma:461`). The device receives one
number per slot and never applies the fallback itself — otherwise the LCD could
show one price while the backend books another.

Putting the coin timings here means the NC switch and the speed switch can be
answered from the admin UI instead of by reflashing.

The device sells offline from the last cached blob. A purchase never calls the
network synchronously: a coin cannot be rolled back, so payment must not depend
on connectivity.

## 8. Reporting

### 8.1 The outbox

An append-only JSONL file on LittleFS, one line per event, matching
`deviceEventSchema` (`shared/schemas/device.ts:18`) field for field.

```jsonl
{"eventId":"VM-16FEE909-000412","sequenceNumber":412,"type":"cash_sale","occurredAt":"2026-09-21T13:04:11Z","payload":{"slot":12,"price_minor":1500,"received_minor":2000,"status":"completed","currency":"DKK"}}
{"eventId":"VM-16FEE909-000414","sequenceNumber":414,"type":"cash_sale","occurredAt":"2026-09-21T13:09:44Z","payload":{"slot":7,"price_minor":1500,"received_minor":1500,"status":"failed","reason":"motor_nak","currency":"DKK"}}
```

`eventId` is the machine id plus a counter held in NVS, monotonic across
reboots. `MachineEvent.eventId` is already `@unique` and documented as
"Device-supplied, for deduplicating a replayed offline queue (§10)"
(`schema.prisma:557`). The outbox pattern is not new here; it is the mechanism
the schema was already built for.

JSONL rather than one JSON array: an array has to be read, parsed, extended and
rewritten in full on every append — on flash, with a coin in someone's hand. A
line append is a line append. It also localises corruption: a half-written last
line after a power cut is discarded and the rest of the queue is intact.

### 8.2 Ordering

**One purchase settles exactly once, at the terminal transition** — on `DONE`
with `completed`, or on `NAK` with `failed`. Paying in full sends `RUN` and
nothing else; it writes no outbox line.

An earlier draft of this design had payment itself settle the sale as
`completed`, so that the line was durable before `RUN` went out. That was wrong,
and wrong in the direction that costs money. A failed vend would then settle a
second time as `failed`, and one purchase would reach the backend as two
`cash_sale` events and two `Sale` rows: one claiming a product was sold and one
saying it was not. Reported revenue would be inflated by the price of the
product on every single failed vend — precisely the case 6.4 exists to surface
cleanly for an operator.

The cost of settling at the terminal transition is the window it opens: if power
is lost between `RUN` and `DONE`, a product may drop with no sale recorded. That
window is the length of one vend, a second or two, and a power cut inside it is
rare. A motor `NAK` is not rare. Trading a rare unbooked delivery for a
systematic double-booking on every failure is not a trade worth making, so the
ordering follows correctness of the record rather than durability before the
motor turns.

Two consequences elsewhere:

- `RUN` failing to send at all (`MotorClient::run` returning false) needs no
  special handling beyond reporting it as a failed dispense. Nothing has been
  settled at that point, so it produces one `failed` sale, like any other
  delivery failure.
- The outbox write still happens before the machine returns to `Idle`, and a
  write that fails still forfeits the credit and shows a fault (section 11). A
  vend that cannot be recorded must not be repeated.

### 8.3 The clock

The ESP32 has no battery-backed RTC, so after a cold boot with no network it
does not know the date. `activation::sync_time()`
(`Main-Controller/src/activation.h:101`) already exists but is only called
during onboarding. It must also run on every successful Wi-Fi connect.

If the clock is still unsynced when a sale settles, the outbox line carries
`uptime_ms` instead of `occurredAt`, and the backend derives the timestamp from
receipt time minus elapsed time. An approximate timestamp is usable; a
fabricated one from 1970 is worse than none.

### 8.4 Draining

A separate task drains the queue whenever the network is up: read the oldest
line, `POST /device/events`, one line at a time, oldest first.

What happens to the line depends on what the answer means, not on its number:

| Answer | Action | Why |
|--------|--------|-----|
| 2xx | drop | Accepted. |
| 409, 422 | drop | The backend has seen this `eventId`, or will never accept the payload. Retrying cannot change either. |
| 400, and any other 4xx not listed below | **drop, and log at ERROR naming the line** | The backend will never accept it. Keeping it blocks every sale behind it forever. Dropping it loses one sale's record, which is bad — so it must be loud enough that an operator can reconstruct it from the log. |
| 401, 403 | keep, back off, log at ERROR | The certificate is revoked or the machine is disabled. The queue is fine; the machine's credential is not, and an operator must fix it. Retrying is correct. |
| 408, 429 | keep, back off | Timeout or rate limit. Explicitly try again later. |
| 5xx, transport failure | keep, back off | The backend's problem, not the line's. |

The distinction that matters is **"this line will never be accepted"** versus
**"try again later"**. An earlier draft of this spec kept everything that was
not 2xx/409/422, which meant a single malformed line — one bad `occurredAt`, one
field the schema rejects — would wedge the queue permanently and silently stop
all cash-sale reporting from that machine. Head-of-line blocking on a queue
whose whole purpose is to survive outages is worse than losing the one line that
caused it, provided the loss is recorded.

## 9. Backend changes

No migration. Every table involved already exists.

`recordDeviceEventService` gains a handler for `type: "cash_sale"`, doing all
of this in one `$transaction`:

```
MachineEvent     (deduplicated on eventId)
Sale             (status from the payload, price from price_minor)
InventoryMovement(type: sale, quantity: -1)        when status = completed
InventoryMovement(type: dispense_failure, qty: 0)  when status = failed
```

`inventory_movement_type` already has `dispense_failure // motor ran, nothing
dropped` (`schema.prisma:326`). The zero-quantity movement is deliberate: the
product was not sold, so stock must not decrement, but the event belongs in the
slot history so a repeatedly failing slot becomes visible. It is a trace, not
an accounting entry.

`DeviceDb` (`device.service.ts:18`) is extended with `sale` and
`inventoryMovement` so the new path stays injectable and host-testable, as the
existing device services are.

### 9.1 Replay is an expected event, not an error

When the outbox replays a line the backend has already booked, `eventId @unique`
raises a Prisma `P2002`. That must be caught and answered **200 OK**, not 500.
Otherwise the device can never drain its queue and will retry the same sale
forever. The whole transaction keys off one `eventId`, so it is atomically
replayable.

## 10. Main-Controller integration

`app_main` gains, after the existing keypad and LCD setup:

1. Load the cached configuration blob; build `CoinConfig` and `PurchaseConfig`.
2. `coin_port.begin(Pins::COIN_IN, Pins::INHIBIT_OUT)` — install the ISR and
   the edge queue.
3. `outbox::begin()` — mount, and discard a trailing partial line.
4. Start the drain task.
5. Start `purchase_task`, which owns the `CoinAcceptor`, the `Purchase` machine
   and the existing `SlotEntry`.

The main loop keeps `bus.poll`, `keypad_task_next` and `lcd.tick`. The
`Confirmed` output of `SlotEntry` is routed into `Purchase::slot_chosen`
instead of straight to the display, and the existing `on_done` and `on_nak`
callbacks of `MotorClient` (`main.cpp:213-228`) are routed into
`dispense_done` and `dispense_failed`.

`pins.h` gains:

```cpp
constexpr int COIN_IN = 35;      ///< HX-916 COIN through a PC817. Input only.
constexpr int INHIBIT_OUT = 4;   ///< HX-916 INHIBIT, if the harness has it.
```

## 11. Error handling

| Failure | Behaviour |
|---------|-----------|
| No cached configuration | No prices, so no cash sales. LCD shows "no prices set"; slot entry still works and logs, as today. |
| Price missing for the chosen slot | Refuse the selection, row 1 "Slot not for sale", back to Idle. No coins accepted. |
| Coin pulse too short | Counted in `rejected_pulses()`, ignored. |
| Unrecognised pulse count | Counted in `unknown_trains()`; policy per 6.5. |
| Motor NAK or no DONE | `dispense_failed`, sale reported `failed`, per 6.4. |
| Outbox write fails | Do not send `RUN`. Row 1 "Machine fault", credit forfeited, logged loudly. A vend that cannot be recorded must not happen. |
| Outbox full | Same as a write failure. Cap the file and refuse new sales rather than overwrite history. |
| Network down | Nothing special. Sales queue; the drain task backs off. |
| Clock unsynced | `uptime_ms` in place of `occurredAt`, per 8.3. |

## 12. Testing

Host tests, native, following `vmaas-keypad` and `vmaas-entry`:

**`vmaas-coin`** — edge streams in, `CoinEvent`s out. One pulse to 5 kr, two to
10 kr, three to 20 kr; a train shorter than `min_pulse_ms` rejected; two coins
separated by more than `train_gap_ms` decoded as two coins; the same two closer
than the gap decoded as one train; `active_low` false inverting the whole
suite; an unrecognised pulse count.

**`vmaas-purchase`** — the state table. Exact payment; overpayment; underpayment
then timeout; a coin in `Idle` with and without `has_inhibit`; `dispense_failed`
after full payment; `cancel` mid-payment; `inhibit_coins` asserted in `Idle` and
again once credit covers the price; `Settled` persisting until `reset()`.

**Backend** — a `cash_sale` creating `Sale` plus `InventoryMovement`; a
`failed` one creating the zero-quantity movement and no stock change; the same
`eventId` twice answering 200 with one `Sale` row.

**Bench** — measure the COIN idle voltage with the ESP32 disconnected before
wiring anything (3.4); confirm pulse polarity from the first coin log line;
confirm the pulse count per coin type; confirm whether INHIBIT exists and
blocks the slot; one end-to-end vend; one vend with the motor unplugged; one
offline vend drained after Wi-Fi returns.

## 13. Out of scope, worth doing later

- **Price validation in the admin UI.** A warning when a price cannot be paid
  exactly with the coins of that machine. Harder than it looks: the accepted
  coins live per machine in `MachineConfiguration.payload`, while
  `Product.price` is tenant-level and shared across machines that may be
  calibrated differently (`schema.prisma:388`). A correct warning has to look
  across every machine the product sits in. Deliberately deferred.
- **Cash reconciliation reporting.** `received_minor` is recorded per sale, so
  the numbers exist; nothing sums them yet.
- **Reporting abandoned partial payments.** Would close the last gap between
  the cash box and the reported total.
- **Alert creation.** Nothing in the backend writes `SecurityAlert` today, only
  reads it (`alerts.service.ts`). A failed cash sale is a good first caller
  once a creation path exists.
- **~~An MQTT client on the device.~~** Landed on 2026-09-22, before this spec
  was implemented: `Main-Controller/src/broker_client.{h,cpp}` (commit 75aff80)
  connects to the broker over mTLS for machine presence. It reuses the same
  `activation::load_certificate` / `load_private_key` / `load_broker_ca`
  accessors that `device_api` uses, and holds its own PEM buffers — so the
  device now carries two independent TLS users and two copies of those PEMs in
  RAM. Anything built against this spec must budget for that rather than
  assuming it is alone. The original note follows for the record.

  The backend side is complete —
  `backend/src/mqtt/client.ts` connects over mTLS and subscribes to
  `v1/+/+/+/command-results/#`, with `acl.ts`, `handlers.ts` and `topics.ts`
  beside it — and activation already stores the broker host, port and
  certificate on the device (`activation.h:78`). What is missing is the
  firmware end: `Main-Controller/src/CMakeLists.txt` lists its `REQUIRES`
  exhaustively and `mqtt` is not among them, so no MQTT code could compile into
  this app today.

  HTTP is not a workaround for that gap, it is where this codebase has already
  moved. The comment on `createPublish` in `client.ts` records that
  `handleConfigurationRequested` was removed because "configuration delivery is
  an HTTP concern"; MQTT remains the live channel for commands. Cash sales
  follow configuration onto HTTP for the same reason. Should a device-side MQTT
  client arrive later, it would be a second transport behind the same outbox,
  not a change to any of the logic in this spec.
