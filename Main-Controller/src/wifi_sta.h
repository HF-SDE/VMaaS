#pragma once
/**
 * @file wifi_sta.h
 * @brief Non-blocking Wi-Fi station layer over esp_wifi.
 *
 * esp_wifi stores the station configuration in NVS itself. This module
 * deliberately keeps no copy: has_credentials() asks the driver, and
 * set_credentials() lets the driver persist. A second store would give two
 * answers to one question.
 */
#include <cstddef>
#include <cstdint>
#include "esp_err.h"

/// Wi-Fi station control for the Main-Controller.
namespace wifi_sta
{
    /**
     * @brief Bring up NVS, netif, the default event loop and the Wi-Fi driver in STA mode.
     *
     * Does not connect. Leaves storage at WIFI_STORAGE_FLASH so the driver
     * persists credentials. Call once, from app_main.
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
     * @return ESP_OK once the driver is started, or the driver's error.
     */
    esp_err_t connect();

    /// @return true between IP_EVENT_STA_GOT_IP and the next disconnect.
    bool is_connected();

    /**
     * @brief Store credentials and connect. The driver writes them to NVS.
     * @param ssid NUL-terminated SSID, 1-32 bytes.
     * @param password NUL-terminated passphrase, 0-63 bytes. Empty means an open network.
     * @return ESP_ERR_INVALID_ARG on a null or over-long argument, else the driver's result.
     */
    esp_err_t set_credentials(const char* ssid, const char* password);

    /**
     * @brief esp_wifi_restore(): erase the stored station configuration.
     *
     * IDF documents esp_wifi_restore() as resetting what esp_wifi_set_config()
     * AND esp_wifi_set_mode() set, so this re-asserts WIFI_MODE_STA
     * afterwards - otherwise set_credentials() right after forget() (the
     * 5=retry path in onboarding) would run against a driver no longer in
     * STA mode. Also stops the retry timer and resets the backoff to its
     * minimum, so a set_credentials() call right afterwards starts its own
     * retry sequence from scratch.
     * @return The first failing esp_err_t (esp_wifi_restore() or the
     *         following esp_wifi_set_mode()), else ESP_OK. Failures are
     *         also logged.
     */
    esp_err_t forget();

    /**
     * @brief Stop the retry timer and suppress arming a new one on disconnect.
     *
     * Call before a BLE provisioning attempt: network_provisioning drives
     * the same STA interface and counts disconnects itself to decide
     * whether to report an auth error to the phone app. Two components
     * calling esp_wifi_connect() on one interface is a real conflict.
     * Balance every call with resume_retries(), on every exit path.
     */
    void pause_retries();

    /// @brief Resume retry-on-disconnect after pause_retries().
    void resume_retries();

    // Named SSID_BUF_LEN, not MAX_SSID_LEN: esp_wifi_types_generic.h #defines
    // MAX_SSID_LEN as 32, and that macro would silently rewrite every later
    // use of an identically-named constant in this translation unit.
    constexpr size_t SSID_BUF_LEN = 33; ///< 32 characters + NUL.

    /**
     * @brief Scan for access points. Blocks for roughly two seconds.
     *
     * Results are strongest first with duplicate SSIDs removed: one access
     * point on two bands otherwise appears twice under the same name, and a
     * list with the same entry twice looks broken.
     *
     * Not re-entrant: the driver records are pulled into a buffer shared
     * across calls (see SCAN_RECORD_CAPACITY in wifi_sta.cpp), so exactly one
     * caller may be inside scan() at a time. Today that holds by construction:
     * onboarding::run() calls it once, before the sales loop starts.
     *
     * @param out Destination, at least @p max rows.
     * @param max Rows available.
     * @return Number of entries written, or -1 on failure. The cause is
     *         logged (ESP_LOGE) rather than returned, since a plain int
     *         cannot carry both a count and an esp_err_t without ambiguity
     *         (ESP_FAIL == -1 would otherwise be indistinguishable from a
     *         one-entry result).
     */
    int scan(char out[][SSID_BUF_LEN], size_t max);
}
