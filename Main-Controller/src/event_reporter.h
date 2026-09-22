#pragma once
/**
 * @file event_reporter.h
 * @brief Durable reporting of machine events to the platform.
 *
 * record() appends to a journal on LittleFS and returns; a sender task drains
 * it to POST /device/events/batch whenever the machine has Wi-Fi, a clock and
 * a certificate. An event survives being offline and survives a reboot.
 *
 * Appending needs no certificate, so an unactivated machine still records what
 * happened to it and sends it once it has an identity. The sender task, by
 * contrast, is not created at all until then: an idle task costs 8 KB of stack
 * for work it cannot do. See broker_client::start() for the same pattern and
 * the same reasoning.
 */
#include <cstddef>
#include "esp_err.h"

/// The machine's event queue and its sender.
namespace event_reporter
{
    /**
     * @brief Open the journal. Call after config_store::load() has mounted storage.
     * @return ESP_OK when the journal is usable; events are dropped otherwise.
     */
    esp_err_t begin();

    /**
     * @brief Queue one event.
     * @param type         e.g. "door-released".
     * @param payload_json Serialised JSON OBJECT, single line, e.g.
     *                     "{\"source\":\"keypad\"}", or nullptr for "{}".
     *                     Anything that is not an object - a bare string, a
     *                     number, a fragment - is refused, because the batch
     *                     builder splices it in unquoted and would corrupt
     *                     every other event in the same request.
     * @return true when it was stored durably. Safe to call before start(),
     *         and before begin() succeeds. Callers should log a false: it
     *         means the platform will not hear about this event.
     */
    bool record(const char* type, const char* payload_json);

    /**
     * @brief Start the sender task.
     * @param api_base_url Where the platform is, from config.json.
     * @return ESP_ERR_INVALID_STATE on an unactivated machine, in which case no
     *         task is created and nothing is sent until the next boot.
     */
    esp_err_t start(const char* api_base_url);
}
