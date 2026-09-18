#pragma once
/**
 * @file onboarding_flow.h
 * @brief The Wi-Fi onboarding screen flow, without a display or a radio.
 *
 * Feed it key events and connection results; ask it what the two display rows
 * say and what colour the backlight should be. Every side effect - scanning,
 * storing credentials, waiting for an IP - belongs to the driver.
 */
#include <cstddef>
#include <cstdint>
#include "key_event.h"
#include "text_entry.h"

namespace vmaas
{
    /// Networks kept from a scan. The list always has one more row: [Enter manually].
    constexpr size_t ONBOARDING_MAX_NETWORKS = 20;
    constexpr size_t ONBOARDING_SSID_MAX = 33;   ///< 32 + NUL.
    constexpr size_t ONBOARDING_PASS_MAX = 64;   ///< 63 + NUL.

    constexpr uint32_t ONBOARDING_PIN_MS = 5000;   ///< How long the BLE row shows the PIN.
    constexpr uint32_t ONBOARDING_HINT_MS = 3000;  ///< How long it shows the manual-setup hint.
    constexpr uint32_t ONBOARDING_CONNECTED_MS = 2000; ///< Green before the sales loop.

    enum class OnboardingScreen : uint8_t
    {
        BleWaiting,    ///< Device name and PIN; * goes manual.
        NetworkList,   ///< Scan results plus [Enter manually].
        SsidEntry,     ///< Only reached through [Enter manually].
        PasswordEntry,
        Connecting,
        WrongPassword,
        Connected,
    };

    /// Everything the driver needs for one pass of the loop.
    struct FlowState
    {
        OnboardingScreen screen;
        char row0[17];
        char row1[17];
        uint8_t r, g, b;        ///< Backlight for this screen.
        bool connect_requested; ///< True from '#' on the password screen until on_connect_result() answers.
        const char* ssid;       ///< Valid while connect_requested.
        const char* password;  ///< Valid while connect_requested.
        bool done;              ///< Onboarding is finished; start the sales loop.
    };

    /// The onboarding screen flow. Fixed buffers, no heap.
    class OnboardingFlow
    {
    public:
        /**
         * @param device_name Shown on the BLE screen and by the phone app. At most 16 characters.
         * @param pin Eight digits, shown as "PIN 1234 5678".
         */
        OnboardingFlow(const char* device_name, const char* pin);

        /**
         * @brief Replace the scan results.
         * @param ssids Array of NUL-terminated SSIDs; may be nullptr when count is 0.
         * @param count Entries in ssids. Clamped to ONBOARDING_MAX_NETWORKS.
         *        [Enter manually] is appended by the flow and is not part of count.
         */
        void set_networks(const char* const* ssids, size_t count);

        /**
         * @brief Anchor the BLE row cycle to the caller's real clock.
         *
         * The constructor cannot know the caller's monotonic clock, so it
         * leaves screen_since_ms_ at 0. On real hardware the first tick()
         * lands several seconds into boot, which would cut the first PIN
         * phase short (or skip it) instead of showing it for the full
         * ONBOARDING_PIN_MS. Call this once, right after construction and
         * before the first tick().
         * @param now_ms Caller's monotonic clock in milliseconds.
         */
        void begin(uint32_t now_ms);

        /**
         * @brief Give the flow the SSID for a connection it did not itself request.
         *
         * BLE-provisioned credentials are applied by the provisioning
         * component directly; the flow only learns about the result via
         * on_connect_result(true), by which point chosen_ssid_ is still
         * empty because no NetworkList/PasswordEntry screen ever ran. Call
         * this before on_connect_result(true) on that path so the Connected
         * screen's row 1 is not blank.
         * @param ssid NUL-terminated SSID. Truncated to fit if longer than storage.
         */
        void set_connected_ssid(const char* ssid);

        /**
         * @brief Report what the driver's connection attempt did.
         * @param ok True once the AP accepted the credentials and an IP was obtained.
         *        False sends the flow to the WrongPassword screen with the
         *        password field cleared.
         */
        void on_connect_result(bool ok);

        /**
         * @brief Feed one key event.
         * @param ev Event from the keypad. Released events are accepted and ignored.
         * @return The resulting state: the active screen, the two display
         *         rows, the backlight colour, and whether a connection is
         *         now requested.
         */
        FlowState handle(const KeyEvent& ev);

        /**
         * @brief Advances the BLE row cycle and the timed screens.
         * @param now_ms Caller's monotonic clock in milliseconds.
         * @return The current state. `done` becomes true once the green
         *         Connected hold has elapsed.
         */
        FlowState tick(uint32_t now_ms);

        /**
         * @brief Current state without changing anything.
         * @return The same FlowState handle() and tick() would return right now.
         */
        FlowState state() const;

    private:
        FlowState snapshot() const;
        void go(OnboardingScreen next, uint32_t now_ms);
        const char* row_for_list_selection() const;

        OnboardingScreen screen_ = OnboardingScreen::BleWaiting;
        char name_[17] = {};
        char pin_row_[17] = {};   ///< "PIN 1234 5678", built once in the constructor.

        char networks_[ONBOARDING_MAX_NETWORKS][ONBOARDING_SSID_MAX] = {};
        size_t network_count_ = 0;
        size_t selection_ = 0;    ///< 0..network_count_; the last row is [Enter manually].

        TextEntry ssid_entry_{ONBOARDING_SSID_MAX - 1, false, false};   ///< No mask, no empty SSID.
        TextEntry pass_entry_{ONBOARDING_PASS_MAX - 1, true, true};     ///< Masked, empty allowed (open networks).
        char chosen_ssid_[ONBOARDING_SSID_MAX] = {};

        bool connect_pending_ = false;
        bool done_ = false;
        uint32_t screen_since_ms_ = 0;
        uint32_t now_ms_ = 0;     ///< Last time seen, so state() can render the BLE cycle.
    };
}
