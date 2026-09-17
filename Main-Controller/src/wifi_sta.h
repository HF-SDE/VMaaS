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

    /// @brief esp_wifi_restore(): erase the stored station configuration.
    esp_err_t forget();
}
