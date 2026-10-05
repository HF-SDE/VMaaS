#pragma once
/**
 * @file cert_renewal.h
 * @brief Renewing the device certificate before it expires.
 *
 * A task reads the stored certificate's validity window and sleeps until
 * vmaas::should_renew() says it is due, waking at least every
 * Config::cert_renewal_check_ms. When it is due, it asks the platform for a
 * new one over the connection the current certificate still opens, waits
 * until no purchase is under way, stores it and restarts at once.
 *
 * A restart rather than reloading in place: api_client and broker_client hold
 * the certificate in buffers that esp_http_client and esp-mqtt read without
 * copying, and the platform revokes the old certificate as soon as the new
 * one is used anywhere. The new certificate therefore reaches NVS only
 * immediately before the restart - device_api reads NVS on every request, so
 * storing it earlier would let one request switch while the rest could not.
 */
#include "esp_err.h"

/// Certificate renewal.
namespace cert_renewal
{
    /**
     * @brief Start the renewal task.
     * @return ESP_ERR_INVALID_STATE when the machine is not activated.
     */
    esp_err_t start();
}
