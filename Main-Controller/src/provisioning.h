#pragma once
/**
 * @file provisioning.h
 * @brief BLE provisioning with a PIN the device generates and shows.
 *
 * The machine draws a fresh eight-digit PIN at the start of every onboarding
 * session, computes the SRP6a salt and verifier from it on the spot, and prints
 * it on the display. The PIN is never stored and never leaves the device except
 * on that screen, so there is no factory tooling, no provisioning database and
 * no QR sticker.
 */
#include "esp_err.h"

/// BLE provisioning for the Main-Controller.
namespace provisioning
{
    constexpr int PIN_DIGITS = 8;

    /**
     * @brief Draw a PIN, compute its salt and verifier, and start advertising.
     * @param device_name Service name shown by the phone app. At most 16 characters.
     * @return ESP_OK once the service is running.
     * @note Precondition: the RF subsystem must already be powered (e.g. by a
     *       prior `wifi_sta::scan()`/connect, or the BT controller) before
     *       calling this. `esp_random()` is a true hardware RNG only while RF
     *       is powered, and the PIN is drawn here before anything else runs -
     *       `begin()` cannot start BLE first, because the salt and verifier it
     *       hands to `network_prov_mgr_start_provisioning()` are derived from
     *       the PIN. A caller that calls this before powering RF will silently
     *       get a weaker PIN.
     * @note Not reentrant: calling `begin()` again without an intervening
     *       `stop()` is not supported.
     */
    esp_err_t begin(const char* device_name);

    /// @return The current session's PIN as eight digits plus NUL. "" before begin().
    /// @note Only meaningful once `begin()` has returned ESP_OK - the PIN is
    ///       drawn before anything in `begin()` can fail, so after a failed
    ///       `begin()` this still returns a live-looking PIN that no session
    ///       backs.
    const char* pin();

    /// @brief Stop advertising and release the Bluetooth memory.
    void stop();
}
