/**
 * @file config_sync.cpp
 * @brief See config_sync.h.
 */
#include "config_sync.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "cJSON.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

#include "activation.h"     // sync_time
#include "config.h"
#include "device_api.h"
#include "prices.h"
#include "purchase_task.h"
#include "storage.h"
#include "wifi_sta.h"

namespace
{
    constexpr const char *TAG = "config_sync";

    constexpr const char *PATH = "/device/configuration";
    constexpr const char *RESULT_PATH = "/device/command-results";

    /**
     * Which configuration version is already on flash.
     *
     * A separate one-line file rather than a field inside prices.json, so
     * prices.cpp keeps parsing exactly the payload the backend built and
     * nothing has to agree on an extra key that only this device would write.
     */
    constexpr const char *VERSION_PATH = "/storage/config_version";

    /// Command ids are "cfg-" plus a uuid, so 40 characters. This leaves room.
    constexpr size_t COMMAND_ID_MAX = 64;

    /// The commands the platform sends today are well under 200 bytes. A
    /// larger one is refused rather than silently clipped - a clipped JSON
    /// object would fail to parse and be reported as a malformed command,
    /// which would send whoever reads that log looking at the backend.
    constexpr size_t COMMAND_JSON_MAX = 512;

    struct Request
    {
        char json[COMMAND_JSON_MAX];
    };

    QueueHandle_t queue = nullptr;

    /// Response scratch, module-scope rather than on the task stack: a live TLS
    /// handshake wants several KB of the same stack. event_reporter.cpp keeps
    /// its batch buffers off its stack for exactly this reason.
    char response[prices::MAX_PAYLOAD + 512];

    /// @return The version on flash, or -1 when there is none to compare with.
    int stored_version()
    {
        char buf[16];
        const int n = vmaas::fs::read_text_file(VERSION_PATH, buf, sizeof(buf));
        if (n <= 0) return -1;
        return std::atoi(buf);
    }

    void store_version(int version)
    {
        char buf[16];
        const int n = std::snprintf(buf, sizeof(buf), "%d", version);
        if (n <= 0 || !vmaas::fs::write_text_file(VERSION_PATH, buf, static_cast<size_t>(n)))
        {
            ESP_LOGW(TAG, "could not record version %d; the next boot will fetch it again", version);
        }
    }

    /**
     * @brief Tell the backend what became of a command.
     *
     * This is what stops it being pending, and stops the reconnect hook
     * republishing it. Best effort: the configuration is already applied by
     * now, and a machine that cannot report that is still correctly configured.
     */
    void report_result(const char *command_id, bool completed, const char *detail)
    {
        if (command_id == nullptr || command_id[0] == '\0') return;

        char body[256];
        std::snprintf(body, sizeof(body),
                      "{\"commandId\":\"%s\",\"status\":\"%s\",\"detail\":\"%s\"}",
                      command_id, completed ? "completed" : "failed", detail != nullptr ? detail : "");

        char resp[128];
        device_api::Response r{};
        const esp_err_t err = device_api::post_json_mtls(RESULT_PATH, body, resp, sizeof(resp), r);

        if (err != ESP_OK || r.status < 200 || r.status >= 300) {
            ESP_LOGW(TAG, "could not report %s: err %s, status %d", command_id, esp_err_to_name(err), r.status);
        }
    }

    /**
     * @brief Fetch, compare, persist, apply.
     *
     * A 404 and an unchanged version are both answers rather than failures: the
     * first means nobody has published for this machine, the second is the
     * common case for the boot fetch and for a command redelivered after a
     * reconnect, and stopping there is what keeps a flaky connection from
     * writing flash every time it comes back.
     *
     * The payload is parsed once as a gate before anything is written, so one
     * this firmware cannot read leaves the working configuration on flash
     * rather than replacing it with one the machine would fail to boot on. It
     * is then read back after the merge, because the merge - not the payload -
     * decides what the machine is actually configured with, and what goes live
     * has to be that same document.
     *
     * Payload first, version second. A reset between the two leaves the version
     * reading older than the file, so the next boot fetches again and rewrites
     * both; the opposite order would leave a device convinced it was current
     * while running the old prices.
     *
     * @param detail Filled with a short reason, reported back with the command.
     * @param[out] retry True when the failure was the network rather than the
     *        configuration, i.e. when trying the same thing again could work.
     *        A truncated or unparseable configuration is not retried - it will
     *        be just as large and just as unreadable next time.
     * @return True when the machine is now running the newest configuration -
     *         including the case where it already was.
     */
    bool fetch_once(char *detail, size_t detail_len, bool &retry)
    {
        retry = false;
        detail[0] = '\0';

        ESP_LOGI(TAG, "heap before fetch: %u free, %u largest block",
                 static_cast<unsigned>(esp_get_free_heap_size()),
                 static_cast<unsigned>(heap_caps_get_largest_free_block(MALLOC_CAP_8BIT)));

        device_api::Response r{};
        const esp_err_t err = device_api::get_mtls(PATH, response, sizeof(response), r);

        if (err != ESP_OK)
        {
            std::snprintf(detail, detail_len, "fetch failed: %s", esp_err_to_name(err));
            ESP_LOGW(TAG, "%s", detail);
            retry = true;
            return false;
        }

        if (r.truncated)
        {
            std::snprintf(detail, detail_len, "configuration is larger than %u bytes",
                          static_cast<unsigned>(sizeof(response) - 1));
            ESP_LOGE(TAG, "%s", detail);
            return false;
        }

        if (r.status == 404)
        {
            ESP_LOGI(TAG, "no configuration published for this machine yet");
            std::snprintf(detail, detail_len, "no configuration published");
            return false;
        }

        if (r.status != 200)
        {
            std::snprintf(detail, detail_len, "backend answered %d", r.status);
            ESP_LOGW(TAG, "%s", detail);
            retry = r.status >= 500 || r.status == 429 || r.status == 408;
            return false;
        }

        cJSON *root = cJSON_Parse(response);
        const cJSON *version_item = cJSON_GetObjectItemCaseSensitive(root, "version");
        const cJSON *payload = cJSON_GetObjectItemCaseSensitive(root, "payload");

        if (!cJSON_IsObject(root) || !cJSON_IsNumber(version_item) || !cJSON_IsObject(payload))
        {
            std::snprintf(detail, detail_len, "response is not {version, payload}");
            ESP_LOGE(TAG, "%s", detail);
            cJSON_Delete(root);
            return false;
        }

        const int version = version_item->valueint;
        if (version == stored_version())
        {
            ESP_LOGI(TAG, "already running configuration v%d", version);
            std::snprintf(detail, detail_len, "already at v%d", version);
            cJSON_Delete(root);
            return true;
        }

        char *text = cJSON_PrintUnformatted(payload);
        cJSON_Delete(root);

        if (text == nullptr)
        {
            std::snprintf(detail, detail_len, "out of memory rendering the payload");
            ESP_LOGE(TAG, "%s", detail);
            retry = true;
            return false;
        }

        prices::Table probe;
        vmaas::CoinConfig probe_coin;
        vmaas::PurchaseConfig probe_purchase;
        if (!prices::parse(text, probe_coin, probe_purchase, probe))
        {
            std::snprintf(detail, detail_len, "v%d did not parse", version);
            ESP_LOGE(TAG, "%s", detail);
            cJSON_free(text);
            return false;
        }

        if (!prices::merge_store(text))
        {
            std::snprintf(detail, detail_len, "could not write v%d to flash", version);
            ESP_LOGE(TAG, "%s", detail);
            cJSON_free(text);
            retry = true;
            return false;
        }
        cJSON_free(text);

        store_version(version);

        prices::Table fresh;
        vmaas::CoinConfig coin;
        vmaas::PurchaseConfig purchase;
        if (!prices::load(coin, purchase, fresh))
        {
            std::snprintf(detail, detail_len, "v%d written but did not load back", version);
            ESP_LOGE(TAG, "%s", detail);
            return false;
        }

        purchase_task::set_prices(fresh);

        ESP_LOGI(TAG, "applied configuration v%d", version);
        std::snprintf(detail, detail_len, "applied v%d", version);
        return true;
    }

    /**
     * @brief Pull "commandId" out of a command payload.
     *
     * Empty when there is none, which is the boot fetch's case: nothing asked
     * for it, so there is nothing to report back. An unrecognised `type` is
     * logged but still fetched - asking for the newest configuration is never
     * wrong, and the log is what shows the platform has grown a command this
     * firmware predates.
     */
    void read_command_id(const char *json, char *out, size_t out_len)
    {
        out[0] = '\0';
        if (json == nullptr || json[0] == '\0') return;

        cJSON *root = cJSON_Parse(json);
        if (!cJSON_IsObject(root))
        {
            ESP_LOGW(TAG, "command payload is not a JSON object");
            cJSON_Delete(root);
            return;
        }

        const cJSON *type = cJSON_GetObjectItemCaseSensitive(root, "type");
        if (cJSON_IsString(type) && std::strcmp(type->valuestring, "apply_configuration") != 0)
        {
            ESP_LOGW(TAG, "unknown command type '%s'; fetching anyway", type->valuestring);
        }

        const cJSON *id = cJSON_GetObjectItemCaseSensitive(root, "commandId");
        if (cJSON_IsString(id) && id->valuestring != nullptr) {
            std::snprintf(out, out_len, "%s", id->valuestring);
        }

        cJSON_Delete(root);
    }

    /**
     * @brief Wait for the network, fetch once, then fetch on every command.
     *
     * The first fetch needs more than an IP: device_api verifies the backend's
     * certificate, which cannot be checked against a clock that still reads
     * 1970. broker_client's connect task waits for the same two things.
     *
     * Every command waiting at the top of a pass wants the same thing - the
     * newest configuration - so they are collected and answered together from
     * one fetch. A burst of publishes, or a reconnect redelivering everything
     * still open, therefore costs one round trip. Results are reported only
     * after that fetch has run: reporting on the strength of one that has not
     * would tell the platform the machine is configured when it may have failed.
     */
    void sync_task(void *)
    {
        while (!wifi_sta::is_connected()) {
            vTaskDelay(pdMS_TO_TICKS(1000));
        }

        while (activation::sync_time(Config::broker_sntp_timeout_ms) != ESP_OK)
        {
            ESP_LOGW(TAG, "no clock yet, cannot verify the backend certificate; retrying");
            vTaskDelay(pdMS_TO_TICKS(Config::broker_clock_retry_ms));
        }

        // The boot fetch. No command asked for it, so there is no id to report.
        Request req{};

        for (;;)
        {
            char ids[Config::config_sync_queue_len + 1][COMMAND_ID_MAX];
            int id_count = 0;

            read_command_id(req.json, ids[id_count], COMMAND_ID_MAX);
            if (ids[id_count][0] != 0) ++id_count;

            Request extra{};
            while (id_count < Config::config_sync_queue_len + 1 &&
                   xQueueReceive(queue, &extra, 0) == pdTRUE)
            {
                read_command_id(extra.json, ids[id_count], COMMAND_ID_MAX);
                if (ids[id_count][0] != 0) ++id_count;
            }

            char detail[96];
            bool ok = false;
            for (int attempt = 1; attempt <= Config::config_sync_max_attempts; ++attempt)
            {
                bool retry = false;
                ok = fetch_once(detail, sizeof(detail), retry);
                if (ok || !retry) break;

                ESP_LOGW(TAG, "attempt %d of %d failed; retrying in %u ms",
                         attempt, Config::config_sync_max_attempts,
                         static_cast<unsigned>(Config::config_sync_retry_ms));
                vTaskDelay(pdMS_TO_TICKS(Config::config_sync_retry_ms));
            }

            for (int i = 0; i < id_count; ++i) {
                report_result(ids[i], ok, detail);
            }

            ESP_LOGI(TAG, "stack headroom in the sync task: %u bytes",
                     static_cast<unsigned>(uxTaskGetStackHighWaterMark(nullptr)));

            if (xQueueReceive(queue, &req, portMAX_DELAY) != pdTRUE) req = Request{};
        }
    }
}

namespace config_sync
{
    esp_err_t begin()
    {
        if (queue != nullptr)
        {
            ESP_LOGW(TAG, "already started");
            return ESP_OK;
        }

        queue = xQueueCreate(Config::config_sync_queue_len, sizeof(Request));
        if (queue == nullptr)
        {
            ESP_LOGE(TAG, "could not create the request queue");
            return ESP_ERR_NO_MEM;
        }

        if (xTaskCreate(sync_task, "config_sync", Config::config_sync_task_stack, nullptr,
                        Config::config_sync_task_priority, nullptr) != pdPASS)
        {
            ESP_LOGE(TAG, "could not start the sync task; the machine keeps its stored configuration");
            vQueueDelete(queue);
            queue = nullptr;
            return ESP_ERR_NO_MEM;
        }

        return ESP_OK;
    }

    void on_command(const char *json)
    {
        if (queue == nullptr)
        {
            ESP_LOGW(TAG, "command arrived before begin(); dropping it");
            return;
        }

        Request req{};
        const int written = std::snprintf(req.json, sizeof(req.json), "%s", json != nullptr ? json : "");
        if (written < 0 || static_cast<size_t>(written) >= sizeof(req.json))
        {
            ESP_LOGE(TAG, "command payload is longer than %u bytes; dropping it",
                     static_cast<unsigned>(sizeof(req.json) - 1));
            return;
        }

        if (xQueueSend(queue, &req, 0) != pdTRUE) {
            ESP_LOGW(TAG, "request queue is full; the pending fetch covers this command");
        }
    }
}
