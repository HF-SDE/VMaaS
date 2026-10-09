# Main-Controller Wi-Fi Onboarding — Design

**Date:** 2026-09-17
**Status:** Proposed
**Scope:** Main-Controller firmware (ESP-IDF 6.1, ESP32-WROVER), shared library `vmaas-entry`, new managed component `espressif/network_provisioning`
**Builds on:** `2026-09-17-main-controller-config-and-wifi-design.md` (implemented)

## 1. Goal

Let a technician put a Main-Controller onto a Wi-Fi network without a laptop.

Two ways in, one outcome. The default is Bluetooth LE with Espressif's own phone
app. The fallback needs nothing but the machine itself: a network list and a
character picker on the 16x2 display, driven from the 12-key keypad.

## 2. Non-goals

- **Re-provisioning from firmware.** Onboarding opens only when the device has no
  credentials. A machine whose network password changes is recovered with a USB
  cable and a flash erase. `wifi_sta::forget()` exists, so a future trigger is a
  small change — but nothing calls it except the failure path in §7.
- A service menu, or any other keypad-driven configuration.
- Configuring MQTT, the backend, or anything else in `config.json`.
- A QR code sticker, a production provisioning database, or factory-installed
  credentials. §8 removes the need for all three.

## 3. Entry and exit

```c++
const vmaas::DeviceConfig cfg = config_store::load();
wifi_sta::init();
if (!wifi_sta::has_credentials())
    onboarding::run(cfg, lcd, keypad_source);   // blocks until connected
// ... the sales loop, unchanged
```

**Entry:** `wifi_sta::has_credentials()` is false — first boot, or after a flash
erase. Nothing else opens onboarding.

**Exit:** `IP_EVENT_STA_GOT_IP`. Nothing else closes it. A wrong password never
leaves stored credentials behind (§7), so the machine cannot end up provisioned
but unreachable.

**Exclusive:** while onboarding runs it owns the keypad and the display. The
machine does not sell. A machine being installed is not yet open for business,
and after §2's decision this happens once in its life.

**No timeout.** It waits indefinitely. There is nothing else for it to do.

## 4. Keypad

```
┌───┬───┬───┐
│ 1 │ 2 │ 3 │   <- character ->     charset in the middle      fine
├───┼───┼───┤
│ 4 │ 5 │ 6 │   <- cursor ->        insert in the middle       the text
├───┼───┼───┤
│ 7 │ 8 │ 9 │   <- five ->          reveal in the middle       coarse
├───┼───┼───┤
│ * │ 0 │ # │   delete              space                      done
└───┴───┴───┘
```

| Key | In the character picker | In the network list | On the error screen |
|---|---|---|---|
| `1` | previous character | — | — |
| `2` | cycle `abc` → `ABC` → `123` → `!@#` | — | — |
| `3` | next character | — | — |
| `4` | move the text cursor left | — | — |
| `5` | insert the selected character | select the entry | retry |
| `6` | move the text cursor right | — | — |
| `7` | jump five characters back | — | — |
| `8` | reveal the password for 2 s | — | — |
| `9` | jump five characters forward | — | — |
| `*` | delete the character left of the cursor | back to the BLE screen | back to the list |
| `0` | space | — | — |
| `#` | field done | — | — |

Every row is left-middle-right, where left and right are opposites at one
granularity: one character, one cursor position, five characters. `2`, `5` and
`8` are the middle column and each does something to what the row above and
below navigate.

`5` and `*` mean different things on different screens. That is safe only because
no two of those screens are ever on display at the same time — which is exactly
what `OnboardingFlow`'s tests pin down.

The symbol set behind `!@#` is `!"#$%&'()*+,-./:;<=>?@[\]^_{|}~` — what Wi-Fi
passwords actually contain. Space is on `0`, not in the symbol set.

### 4.1 Empty fields

| Key | On an empty field |
|---|---|
| `*` | Leaves the field: the SSID screen returns to the network list, the password screen returns to the list as well. With text present, `*` deletes instead. |
| `#` | On the password screen it accepts an empty passphrase, because open networks have none. On the SSID screen it does nothing — there is no such thing as an empty SSID, and silently accepting one would produce a connection attempt that can only fail. |

`*` is therefore delete-or-back depending on whether the field holds anything.
That is the behaviour people expect from a backspace, and it means no screen is a
dead end.

## 5. Screen flow

```
                    ┌────────────────┐
                    │VMaaS-0042      │  blue backlight
                    │PIN 1234 5678   │  row 1 cycles: the PIN for 5 s, then
                    └────────────────┘  "* = manual setup" (16 chars) for 3 s
                            │ *
                            ▼
                    ┌────────────────┐
                    │Select network  │  white
             ┌──────│[Cafe-Gaesten]  │  1/3 scroll the list, 5 selects,
             │      └────────────────┘  * goes back to the BLE screen
             │              │ 5 on [Enter manually]
             │              ▼
             │      ┌────────────────┐
             │      │SSID            │  row 0 is the label until the first
             │      │ b c d e[f]g h i│  character, then the text
             │      └────────────────┘
             │              │ #
             ▼              ▼
     ┌────────────────┐
     │****f           │  white. Row 0 is "Password" until the first character.
     │ b c d e[f]g h i│  Masked except the character left of the cursor;
     └────────────────┘  8 reveals the whole string for 2 s.
             │ #
             ▼
     ┌────────────────┐
     │Connecting...   │  yellow
     │Cafe-Gaesten    │
     └────────────────┘
             │
      ┌──────┴───────┐
      ▼              ▼
┌────────────────┐  ┌────────────────┐
│Wrong password  │  │WiFi connected  │  green for 2 s, then white,
│5=retry  *=back │  │Cafe-Gaesten    │  then the sales loop
└────────────────┘  └────────────────┘
  red. forget() has
  already run. 5 returns
  to the password screen
  for the same network;
  * returns to the list.
```

The two halves of the BLE row are not on screen for equal time. The PIN is read
and typed into a phone, so it gets 5 seconds; the hint only has to be noticed
once, so 3 is enough. An even split would make the PIN harder to catch than it
needs to be.

`[Enter manually]` is 16 characters with its brackets and is always the last
entry in the list, including when the scan finds nothing. It is the only way onto
a hidden network.

The BLE service keeps advertising the whole time, including while someone is
typing. RAM sits at 12.5% of 327 KB, so the Bluetooth stack costs nothing the
machine needs, and it means a technician can abandon the keypad and reach for
their phone without rebooting. If credentials arrive over BLE mid-typing, they
win: the connection succeeds, and onboarding exits.

## 6. Backlight

Extends the scheme already in `main.cpp`, which uses white for normal and red for
a motor fault.

| State | Colour | |
|---|---|---|
| Sales *(existing)* | white | `255,255,255` |
| Motor fault *(existing)* | red | `255,0,0` |
| BLE waiting | blue | `0,80,255` |
| List and text entry | white | `255,255,255` |
| Connecting | yellow | `255,200,0` |
| Connected | green for 2 s, then white | `0,255,0` |
| Wrong password | red | `255,0,0` |

**Colour never carries meaning alone.** `backlight_ok` can be false — `begin()`
probes for both the PCA9633 (v4.0, 0x62) and the SGM31323 (v5.0, 0x30), and a
failed probe leaves the display working as text only. Red and green are also the
pair most people confuse. `Wrong password` and `WiFi connected` say everything
without a single colour; the backlight only reinforces it.

Onboarding restores white before it returns. Otherwise the sales screen inherits
a green backlight until something else happens to call `set_rgb()`.

## 7. Failure handling

| Situation | Behaviour |
|---|---|
| Wrong password | `wifi_sta::forget()`, red, `Wrong password` / `5=retry *=back` |
| Scan finds nothing | The list holds only `[Enter manually]` |
| BLE session fails | `network_provisioning` resets itself and keeps advertising |
| Display dead (`display_ok` false) | The PIN is logged over serial, BLE keeps advertising, and the machine waits. Without a screen there is no way to show a PIN, and no way to run the keypad flow. |

The wrong-password path is the reason onboarding exits on an IP rather than on
stored credentials. `set_credentials()` writes to NVS immediately, so without
`forget()` a single mistyped character would leave the machine with credentials
that do not work — and §2 means onboarding would never open again.

## 8. The PIN

The device generates its own PIN at the start of every onboarding session and
shows it on the display. It is never stored and never leaves the machine except
on that screen.

```c++
// protocomm ships this in ESP-IDF. Its own documentation names this exact use:
//   "for devices which intentionally want to generate different password each
//    time and can send it to the client securely. e.g., a device has a display
//    and it shows the pin"
esp_err_t esp_srp_gen_salt_verifier(const char* username, int username_len,
                                    const char* pass, int pass_len,
                                    char** bytes_salt, int salt_len,
                                    char** verifier, int* verifier_len);
```

Eight digits from `esp_random()`, displayed as `PIN 1234 5678`.

`esp_random()` is a true hardware RNG only while the RF subsystem is powered.
An earlier draft of this section claimed BLE is already running when the PIN is
drawn; it cannot be. `network_prov_mgr_start_provisioning()` takes the salt and
verifier as arguments, and those are derived from the PIN, so the PIN
necessarily exists first.

The ordering requirement is therefore the driver's: it runs `wifi_sta::scan()`
before `provisioning::begin()`. The scan calls `esp_wifi_start()`, which powers
the radio and leaves it powered, so the PIN is drawn with the RF subsystem
running. Scanning first is what the flow wants anyway — the network list is
ready by the time anyone presses `*`.

`provisioning::begin()` documents this as a precondition rather than assuming
it, because a caller that reorders the two would silently weaken the PIN.

Eight digits rather than four: SRP6a fails closed and every attempt costs a full
BLE connection and handshake, but 10,000 possibilities is a small space, and
reading eight digits off a screen costs the technician nothing.

This replaces the production tooling the earlier sketch needed. No
`nvs_partition_gen`, no salt and verifier written at the factory, no QR sticker on
the side of the machine, and no PIN that is the same for the life of the device.

## 9. Components

| File | Responsibility |
|---|---|
| `shared/vmaas-entry/src/text_entry.{h,cpp}` | `TextEntry` — the character picker. Pure logic, host-tested, beside `SlotEntry` |
| `shared/vmaas-entry/src/onboarding_flow.{h,cpp}` | `OnboardingFlow` — the screen state machine. Pure logic, host-tested |
| `Main-Controller/src/provisioning.{h,cpp}` | Wraps `espressif/network_provisioning`: PIN, salt and verifier, BLE lifecycle |
| `Main-Controller/src/onboarding.{h,cpp}` | The driver: joins flow, keypad, display, backlight and `wifi_sta` |
| `Main-Controller/src/wifi_sta.{h,cpp}` | Gains `scan()` |

### 9.1 `TextEntry`

```c++
namespace vmaas
{
    constexpr size_t TEXT_ENTRY_MAX = 64;   ///< A WPA2 passphrase is at most 63 characters.
    constexpr uint32_t TEXT_ENTRY_REVEAL_MS = 2000;

    enum class Charset : uint8_t { Lower, Upper, Digits, Symbols };
    enum class TextEntryStatus : uint8_t { Editing, Done };

    struct TextEntryState
    {
        TextEntryStatus status;
        const char* text;   ///< What has been typed. Always NUL-terminated.
        char display[17];   ///< Row 0: the text, masked when masking is on.
        char picker[17];    ///< Row 1: the charset window, selection in brackets.
    };

    /// Character picker for a 16x2 display and a 12-key keypad.
    class TextEntry
    {
    public:
        /// @param max_len Characters accepted, at most TEXT_ENTRY_MAX.
        /// @param mask true for a password: every character but the one left of
        ///        the cursor shows as '*', unless a reveal is running.
        TextEntry(size_t max_len, bool mask);

        TextEntryState handle(const KeyEvent& ev);
        TextEntryState tick(uint32_t now_ms);  ///< Ends a reveal.
        TextEntryState state() const;
        void reset();
    };
}
```

**Masking.** Every character is `*` except the one immediately left of the cursor
— the one just inserted, or just moved past. With the cursor at position 0 the
whole string is masked. Pressing `8` reveals everything for 2 s; any other key
ends the reveal at once.

Showing the character *at the cursor* rather than the last character of the
string matters once `4` and `6` can move: otherwise going back to fix a typo
would reveal the wrong character.

**The picker row.** Sixteen characters wide, the selection in `[ ]`, centred on
the selection where the charset allows and clamped at the ends. It never scrolls:
it is a positioned UI element, and a moving one would put the brackets over the
wrong character.

### 9.2 `OnboardingFlow`

```c++
namespace vmaas
{
    enum class OnboardingScreen : uint8_t
    {
        BleWaiting, NetworkList, SsidEntry, PasswordEntry,
        Connecting, WrongPassword, Connected
    };

    struct FlowState
    {
        OnboardingScreen screen;
        char row0[17];
        char row1[17];
        uint8_t r, g, b;        ///< Backlight for this screen.
        bool connect_requested;  ///< True for one call: the driver should connect.
        const char* ssid;        ///< Valid while connect_requested.
        const char* password;    ///< Valid while connect_requested.
        bool done;               ///< Onboarding is finished; start the sales loop.
    };

    /// The onboarding screen flow. No display, no GPIO, no Wi-Fi: feed it keys
    /// and results, ask it what the two rows say.
    class OnboardingFlow
    {
    public:
        OnboardingFlow(const char* device_name, const char* pin);

        void set_networks(const char* const* ssids, size_t count);
        void on_connect_result(bool ok); ///< Driver reports what wifi_sta did.

        FlowState handle(const KeyEvent& ev);
        /// Advances the BLE row cycle (5 s PIN, 3 s hint) and the timed screens.
        FlowState tick(uint32_t now_ms);
        FlowState state() const;
    };
}
```

The driver owns every side effect: it scans, calls `wifi_sta::set_credentials()`
when `connect_requested` comes back true, waits for the IP, and reports the
outcome through `on_connect_result()`. The flow itself only decides what is on
screen and where a key leads.

### 9.3 `wifi_sta::scan()`

```c++
constexpr size_t MAX_SCAN_RESULTS = 20;
constexpr size_t MAX_SSID_LEN = 33;   ///< 32 + NUL.

/// Blocking scan. Strongest first, duplicate SSIDs removed.
/// @return number of entries written, or a negative esp_err_t.
int scan(char out[][MAX_SSID_LEN], size_t max);
```

Duplicates are removed because one access point on two bands appears twice with
the same name, and a list with the same entry twice looks broken.

## 10. Strings

| Screen | Row 0 | Row 1 |
|---|---|---|
| Sales *(existing, shortened)* | `VMaaS: pick slot` (16) | `> _` |
| BLE | device name (≤16) | `PIN 1234 5678` (13) for 5 s ⇄ `* = manual setup` (16) for 3 s |
| Network list | `Select network` (14) | `[Cafe-Gaesten]` |
| SSID entry | `SSID` → the text | the picker |
| Password entry | `Password` → masked text | the picker |
| Connecting | `Connecting...` (13) | the SSID |
| Connected | `WiFi connected` (14) | the SSID |
| Wrong password | `Wrong password` (14) | `5=retry  *=back` (15) |

`PROMPT_ROW0` is 18 characters today, so the sales screen has been showing
`VMaaS - vaelg sl` on a 16-column display. It is shortened here, and translated:
the UI is English throughout.

**Row 0 and short messages must fit in 16 characters.** `print_at` truncates
silently, so a long string is not caught by any test — it just looks wrong on the
bench. Only text that deliberately scrolls may be longer, and there is exactly one
of those: `ERROR_ROW1`, 33 characters, printed with `Overflow::Scroll`. Scrolling
is for text read once; anything glanced at repeatedly, or that is itself a
positioned element, has to fit.

## 11. Testing

### 11.1 Host (`platform = native`)

| Suite | Covers |
|---|---|
| `test_text_entry` | insert, charset cycling, jump of five at both ends, cursor movement, insert in the middle, delete, space, max length |
| `test_text_mask` | masking follows the cursor, `8` reveals for 2 s, any other key ends the reveal early, an unmasked field is never masked |
| `test_onboarding_flow` | `*` from BLE to the list and back, list navigation, `[Enter manually]` always last, SSID skipped when a network is picked, `5`/`*` on the error screen, `done` only after a successful result, row contents and backlight per screen, and that the BLE row holds the PIN for 5 s and the hint for 3 |
| `test_text_empty` | `*` on an empty field leaves it instead of deleting, `#` accepts an empty password but not an empty SSID, no screen is a dead end |

### 11.2 Hardware (WROVER on COM6)

1. Erase flash. Confirm onboarding opens and the BLE screen alternates.
2. Provision from Espressif's **ESP BLE Provisioning** app using the PIN on the
   screen. Confirm green, then the sales prompt.
3. Erase again. Press `*`, confirm the scan list holds real networks and
   `[Enter manually]` last.
4. Pick a network, type the real password, confirm connection.
5. Type a deliberately wrong password. Confirm red, `5=retry` returns to the
   password screen, and that a reboot reopens onboarding — proving `forget()` ran.
6. Confirm `[Enter manually]` reaches a hidden SSID.
7. Confirm `8` reveals the password and that it re-masks by itself.

## 12. Decisions recorded

| Decision | Choice |
|---|---|
| When does onboarding open? | Only when there are no credentials. No firmware recovery path. |
| A machine whose network password changed? | Needs a USB cable. Accepted. |
| Can it sell while onboarding is open? | No. |
| When is onboarding done? | On a confirmed IP, never on stored credentials. |
| Text entry | Character picker, keymap in §4 |
| Password masking | Character left of the cursor, `8` reveals for 2 s |
| Where does the PIN come from? | Generated on the device each session, shown on screen |
| BLE during manual entry | Keeps advertising |
| UI language | English |
| Architecture | One blocking `onboarding::run()`. No `Screen` interface, no screen stack. |
| Flow logic | Its own host-tested class, not buried in the driver |
