#pragma once
/**
 * @file broker_client.h
 * @brief The machine's MQTT presence on the platform broker.
 *
 * Holding this connection open is what makes a machine read Online in the
 * admin UI: the rule in config/emqx/emqx.conf posts the broker's own
 * connect and disconnect events to `/api/internal/mqtt/connection`, which
 * moves `Machine.status`. The device publishes nothing and subscribes to
 * nothing - presence needs neither.
 *
 * @note Named broker_client, not mqtt_client, because esp-mqtt already has a
 *       public `mqtt_client.h` that a file of that name here would shadow.
 */
#include "esp_err.h"
#include "device_config.h"

/// The machine's connection to the platform MQTT broker.
namespace broker_client
{
    /**
     * @brief Connect to the broker, and keep reconnecting for the rest of uptime.
     *
     * Returns once the connecting task is running, not once the connection is
     * up: the first connect needs Wi-Fi and a synchronised clock, and waiting
     * for either in app_main would hold up the sales loop. Call it once, after
     * onboarding.
     *
     * An unactivated machine has no certificate to connect with, so this does
     * nothing and it stays Offline until it is activated.
     *
     * @param cfg config.json as loaded by config_store. Its broker.host and
     *        broker.port override what activation stored in NVS; empty and
     *        zero defer to activation. See vmaas::broker_endpoint() for the
     *        precedence rule and why a file override exists at all.
     *
     * @return ESP_OK once the task is started, ESP_ERR_INVALID_STATE when the
     *         machine is not activated, ESP_ERR_NO_MEM when the task could not
     *         be created. Failing to reach the broker later is logged and
     *         retried, not reported here.
     */
    esp_err_t start(const vmaas::DeviceConfig& cfg);

    /// @return true while the MQTT connection to the broker is up.
    bool is_connected();
}
