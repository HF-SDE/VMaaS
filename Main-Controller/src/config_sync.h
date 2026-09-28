#pragma once
/**
 * @file config_sync.h
 * @brief Fetches this machine's own configuration over HTTPS and applies it.
 *
 * The other half of the command channel. MQTT says only that something
 * changed - the command carries a version number, never the configuration
 * itself - and the device then asks GET /device/configuration for the newest
 * one. That split is deliberate on both sides: because the device always
 * fetches the *latest*, a QoS-1 message redelivered an hour late cannot apply
 * a stale configuration, and the broker never has to carry a payload.
 *
 * Prices and the currency go live immediately; the wiring is forwarded to
 * Motorcontrol by wiring_sync, and the command is reported applied only once
 * Motorcontrol has taken it. See purchase_task::set_prices() for
 * why the cash calibration in the same payload waits for a reboot.
 */
#include "esp_err.h"

namespace config_sync
{
    /**
     * @brief Create the request queue and start the sync task.
     *
     * Call once from app_main, after device_api::begin(). The task fetches once
     * on its own as soon as the network and the clock are up, so a machine that
     * was reconfigured while it was switched off does not have to wait for
     * someone to publish again.
     */
    esp_err_t begin();

    /**
     * @brief Hand over a raw command payload from the MQTT commands topic.
     *
     * Safe to call from the mqtt event handler, and that is the whole point:
     * the handler must not fetch anything itself. device_api holds its lock
     * across a full TLS handshake - seconds - and blocking the mqtt task for
     * that long stops keepalive, after which the broker drops the connection
     * and the machine reads Offline. So this only copies the payload onto a
     * queue and returns.
     *
     * Parsing happens on the sync task rather than here, which keeps the
     * transport free of any knowledge of what a command means.
     *
     * @param json The message body, NUL-terminated. Unknown command types are
     *        logged and dropped.
     */
    void on_command(const char *json);
}
