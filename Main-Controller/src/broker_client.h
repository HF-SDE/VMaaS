#pragma once
/**
 * @file broker_client.h
 * @brief The machine's MQTT presence on the platform broker.
 *
 * Holding this connection open is what makes a machine read Online in the
 * admin UI. The platform derives that from the broker's own connection
 * lifecycle - the rule in config/emqx/emqx.conf posts to
 * `/api/internal/mqtt/connection`, which moves `Machine.status` - not from
 * anything the device publishes.
 *
 * The client subscribes to nothing and publishes nothing. Presence needs
 * neither.
 *
 * @note Named broker_client rather than mqtt_client because esp-mqtt's own
 *       public header is `mqtt_client.h`, and a file of that name in the app
 *       component would shadow it for every translation unit including it.
 */
#include "esp_err.h"

/// The machine's connection to the platform MQTT broker.
namespace broker_client
{
    /**
     * @brief Connect to the broker, and keep reconnecting for the rest of uptime.
     *
     * Returns as soon as the connecting task is running, not when the
     * connection is up: the first connect needs Wi-Fi and a synchronised
     * clock, and waiting for either in app_main would hold up the sales loop.
     * Call it once, after onboarding.
     *
     * Does nothing and answers ESP_ERR_INVALID_STATE when the machine holds no
     * certificate - an unactivated machine has no identity to connect with, and
     * correctly reads Offline until it is activated.
     *
     * @return ESP_OK once the task is started, ESP_ERR_INVALID_STATE when the
     *         machine is not activated, ESP_ERR_NO_MEM when the task could not
     *         be created. A later failure to reach the broker is not an error
     *         here; it is logged and retried.
     */
    esp_err_t start();

    /// @return true while the MQTT connection to the broker is up.
    bool is_connected();
}
