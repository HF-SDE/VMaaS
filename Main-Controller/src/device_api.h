#pragma once
/**
 * @file device_api.h
 * @brief The one HTTPS client the device uses to talk to the backend.
 *
 * Lifted out of activation.cpp, which had the only working esp_http_client
 * POST in the firmware. Activation, configuration fetch and outbox drain all
 * go through here rather than growing three copies of the TLS setup.
 *
 * Sales are reported over HTTPS, not MQTT, and that is not a workaround: the
 * backend's own MQTT client records that configuration delivery became "an
 * HTTP concern", and cash sales follow it.
 *
 * Thread safety: begin() must run once, from a single task at startup - it
 * creates the internal lock, and every other call fails rather than touching
 * the shared PEM/url buffers unlocked if made before begin() has run. After
 * that, post_json(), post_json_mtls() and drain_outbox_once() are all safe to
 * call from different tasks: Task 10 gives outbox draining its own FreeRTOS
 * task precisely so a slow HTTPS POST cannot stall the main loop mid-payment,
 * which means a second caller can genuinely be in flight here at the same
 * time (e.g. activation running from the onboarding task). The lock is held
 * for the whole of one POST, including the TLS handshake, which can take
 * seconds - that is correct, since two concurrent handshakes over the same
 * static PEM buffers would corrupt both, not merely race harmlessly.
 */
#include <cstddef>

#include "esp_err.h"

namespace device_api
{
    struct Response
    {
        int    status = 0;   ///< HTTP status, or 0 when the request never completed.
        size_t body_len = 0;
    };

    /**
     * @brief Remember the API base URL for the mTLS calls.
     *
     * It is not in NVS: it comes from config.json via DeviceConfig, which is
     * why the caller has to hand it over. Call once from app_main, before
     * anything uses post_json_mtls.
     *
     * @param api_base_url e.g. "https://vmaas.dk/api", ending without a slash.
     */
    esp_err_t begin(const char *api_base_url);

    /// POST JSON with no client certificate, for activation. Trusts the API CA
    /// from config_store::API_CA_PATH, falling back to the Mozilla bundle.
    esp_err_t post_json(const char *url, const char *body, char *resp, size_t resp_len, Response &out);

    /// POST JSON with the machine's client certificate. @p path is appended to
    /// the base URL given to begin(), e.g. "/device/events".
    esp_err_t post_json_mtls(const char *path, const char *body, char *resp, size_t resp_len, Response &out);

    /**
     * @brief Send the oldest outbox line, and drop it once the backend has
     *        rendered a verdict on it - accepted, deduped, or permanently
     *        rejected - rather than only once it is accepted.
     *
     * The question that decides drop-vs-keep is not "did this
     * succeed" but "will the backend ever accept this line": a 2xx, a 409 or
     * a 422 drop it (accepted, or already seen, or never going to be valid);
     * a 400 or any other 4xx not covered below also drops it, logged at
     * ERROR with the whole line, because the backend has judged the line
     * itself unacceptable and that log is the only surviving record of the
     * sale being lost; a 401 or 403 keeps it and logs at ERROR (the
     * machine's credential is the problem, not the line - only a human can
     * fix that, so retrying forever is correct); a 408, 429, a 5xx or a
     * transport failure all keep it and back off, because the backend never
     * rendered a permanent verdict. See device_api.cpp for the exact table.
     *
     * @return True when a line was sent and dropped.
     */
    bool drain_outbox_once();
}
