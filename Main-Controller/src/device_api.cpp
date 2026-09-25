/**
 * @file device_api.cpp
 * @brief See device_api.h.
 */
#include "device_api.h"

#include <cstdio>
#include <cstring>

#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "nvs_flash.h"

#include "activation.h"
#include "config_store.h"   // API_CA_PATH
#include "outbox.h"
#include "storage.h"       // vmaas::fs::read_text_file
#include "wifi_sta.h"      // wifi_sta::is_connected

namespace
{
    constexpr const char *TAG = "device_api";
    constexpr int TIMEOUT_MS = 15000;

    char base_url[160] = {};

    /// PEM scratch. Static, not stack: together these are ~5 KB and the TLS
    /// handshake wants about 8 KB of its own on the same task.
    char ca_pem[2560];
    char cert_pem[2048];
    char key_pem[512];
    char api_ca_pem[2560];

    /**
     * @brief Guards base_url and every PEM buffer above, created by begin().
     *
     * post_json() and post_json_mtls() can now genuinely run from two tasks
     * at once - Task 10 puts outbox draining on its own FreeRTOS task so a
     * slow POST cannot stall the main loop, and activation can still be in
     * flight from the onboarding task. Without this lock, two concurrent
     * calls would both write ca_pem/cert_pem/key_pem/api_ca_pem and race the
     * mbedTLS layer reading them mid-handshake, corrupting both requests.
     *
     * Held for the whole of one POST, including the TLS handshake - seconds,
     * not microseconds. That is deliberate, not an oversight: see
     * device_api.h's Thread safety paragraph for why a shorter critical
     * section would not be safe here.
     */
    SemaphoreHandle_t g_mutex = nullptr;

    /// Acquire g_mutex. Fails loudly instead of proceeding unlocked when
    /// begin() has not run yet (or its xSemaphoreCreateMutex() failed).
    bool lock()
    {
        if (g_mutex == nullptr)
        {
            ESP_LOGE(TAG, "called before begin() created the lock; refusing");
            return false;
        }
        return xSemaphoreTake(g_mutex, portMAX_DELAY) == pdTRUE;
    }

    void unlock()
    {
        xSemaphoreGive(g_mutex);
    }

    // Everything below this point assumes the caller already holds g_mutex.

    /**
     * One request, POST or GET. The two differ only in whether a body is sent:
     * a GET is this function with @p body null, which is why the TLS setup,
     * certificate loading and response handling are not duplicated for it.
     *
     * A body that does not fit sets Response::truncated rather than returning
     * an error, since the status line is still valid - see device_api.h. It is
     * declared from Content-Length before a byte is read; a chunked response
     * carries none, so a read that exactly fills the buffer is called truncated
     * too, that being the one case where "it just fits" and "there was more"
     * are indistinguishable.
     */
    esp_err_t request_impl(esp_http_client_method_t method, const char *url, const char *body, bool with_client_cert, char *resp, size_t resp_len, device_api::Response &out)
    {
        if (url == nullptr) return ESP_ERR_INVALID_ARG;
        if (method == HTTP_METHOD_POST && body == nullptr) return ESP_ERR_INVALID_ARG;
        if (resp != nullptr && resp_len > 0) resp[0] = '\0';

        if (!wifi_sta::is_connected())
        {
            ESP_LOGD(TAG, "no network yet, not attempting %s", url);
            return ESP_ERR_INVALID_STATE;
        }

        esp_http_client_config_t cfg = {};
        cfg.url = url;
        cfg.method = method;
        cfg.timeout_ms = TIMEOUT_MS;

        if (with_client_cert)
        {
            if (activation::load_broker_ca(ca_pem, sizeof(ca_pem)) != ESP_OK ||
                activation::load_certificate(cert_pem, sizeof(cert_pem)) != ESP_OK ||
                activation::load_private_key(key_pem, sizeof(key_pem)) != ESP_OK)
            {
                ESP_LOGE(TAG, "no stored certificate, key or CA; cannot use mTLS");
                return ESP_ERR_INVALID_STATE;
            }

            cfg.cert_pem = ca_pem;
            cfg.client_cert_pem = cert_pem;
            cfg.client_key_pem = key_pem;
        }
        else
        {
            const int n = vmaas::fs::read_text_file(config_store::API_CA_PATH, api_ca_pem, sizeof(api_ca_pem));
            if (n > 0) {
                cfg.cert_pem = api_ca_pem;
            }
            else {
                cfg.crt_bundle_attach = esp_crt_bundle_attach;
            }
        }

        esp_http_client_handle_t client = esp_http_client_init(&cfg);
        if (client == nullptr) return ESP_FAIL;

        const size_t body_len = body != nullptr ? std::strlen(body) : 0;
        if (body != nullptr) esp_http_client_set_header(client, "Content-Type", "application/json");

        esp_err_t err = esp_http_client_open(client, static_cast<int>(body_len));
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "cannot open %s: %s", url, esp_err_to_name(err));
            esp_http_client_cleanup(client);
            return err;
        }

        if (body_len > 0 && esp_http_client_write(client, body, static_cast<int>(body_len)) < 0)
        {
            ESP_LOGE(TAG, "write failed for %s", url);
            esp_http_client_cleanup(client);
            return ESP_FAIL;
        }

        const int content_length = esp_http_client_fetch_headers(client);
        if (content_length < 0)
        {
            ESP_LOGE(TAG, "headers failed for %s", url);
            esp_http_client_cleanup(client);
            return ESP_FAIL;
        }

        out.status = esp_http_client_get_status_code(client);

        const size_t room = resp != nullptr && resp_len > 1 ? resp_len - 1 : 0;
        if (room > 0)
        {
            if (content_length > 0 && static_cast<size_t>(content_length) > room) out.truncated = true;

            const int read = esp_http_client_read_response(client, resp, static_cast<int>(room));
            if (read > 0)
            {
                resp[read] = '\0';
                out.body_len = static_cast<size_t>(read);

                if (content_length <= 0 && static_cast<size_t>(read) == room) out.truncated = true;
            }
        }

        ESP_LOGI(TAG, "%s %s -> %d (%u bytes%s)",
                 method == HTTP_METHOD_GET ? "GET" : "POST", url, out.status,
                 static_cast<unsigned>(out.body_len), out.truncated ? ", TRUNCATED" : "");

        esp_http_client_cleanup(client);
        return ESP_OK;
    }
}

namespace device_api
{
    esp_err_t begin(const char *api_base_url)
    {
        const esp_err_t nvs_err = nvs_flash_init();
        if (nvs_err != ESP_OK)
        {
            ESP_LOGW(TAG, "nvs_flash_init failed: %s; mTLS calls will fail until "
                          "something else initialises NVS successfully, not erasing "
                          "NVS to try to fix it (it also holds the device certificate)",
                     esp_err_to_name(nvs_err));
        }

        if (g_mutex == nullptr) g_mutex = xSemaphoreCreateMutex();
        if (g_mutex == nullptr)
        {
            ESP_LOGE(TAG, "xSemaphoreCreateMutex failed; device_api is unusable");
            return ESP_ERR_NO_MEM;
        }

        if (api_base_url == nullptr || api_base_url[0] == '\0') return ESP_ERR_INVALID_ARG;

        if (!lock()) return ESP_FAIL;
        std::snprintf(base_url, sizeof(base_url), "%s", api_base_url);
        ESP_LOGI(TAG, "base url %s", base_url);
        unlock();
        return ESP_OK;
    }

    esp_err_t post_json(const char *url, const char *body, char *resp, size_t resp_len, Response &out)
    {
        if (!lock()) return ESP_ERR_INVALID_STATE;
        const esp_err_t result = request_impl(HTTP_METHOD_POST, url, body, false, resp, resp_len, out);
        unlock();
        return result;
    }

    esp_err_t post_json_mtls(const char *path, const char *body, char *resp, size_t resp_len, Response &out)
    {
        if (!lock()) return ESP_ERR_INVALID_STATE;

        esp_err_t result;
        if (base_url[0] == '\0')
        {
            ESP_LOGE(TAG, "begin() was never called; no base url");
            result = ESP_ERR_INVALID_STATE;
        }
        else
        {
            char url[256];
            std::snprintf(url, sizeof(url), "%s%s", base_url, path);
            result = request_impl(HTTP_METHOD_POST, url, body, true, resp, resp_len, out);
        }

        unlock();
        return result;
    }

    esp_err_t get_mtls(const char *path, char *resp, size_t resp_len, Response &out)
    {
        if (!lock()) return ESP_ERR_INVALID_STATE;

        esp_err_t result;
        if (base_url[0] == '\0')
        {
            ESP_LOGE(TAG, "begin() was never called; no base url");
            result = ESP_ERR_INVALID_STATE;
        }
        else
        {
            char url[256];
            std::snprintf(url, sizeof(url), "%s%s", base_url, path);
            result = request_impl(HTTP_METHOD_GET, url, nullptr, true, resp, resp_len, out);
        }

        unlock();
        return result;
    }

    bool drain_outbox_once()
    {
        char line[outbox::MAX_LINE];
        if (!outbox::peek(line, sizeof(line))) return false;

        char resp[256];
        Response r{};
        const esp_err_t err = post_json_mtls("/device/events", line, resp, sizeof(resp), r);

        if (err != ESP_OK)
        {
            ESP_LOGW(TAG, "drain failed to send: %s; keeping the line", esp_err_to_name(err));
            return false;
        }

        const int status = r.status;
        bool drop;

        if (status >= 200 && status < 300)
        {
            drop = true;
        }
        else if (status == 409 || status == 422)
        {
            drop = true;
        }
        else if (status == 401 || status == 403)
        {
            ESP_LOGE(TAG, "backend answered %d to /device/events: a credential problem, not a queue problem; keeping the line and retrying", status);
            drop = false;
        }
        else if (status == 408 || status == 429)
        {
            ESP_LOGW(TAG, "backend answered %d; transient, keeping the line", status);
            drop = false;
        }
        else if (status >= 400 && status < 500)
        {
            ESP_LOGE(TAG, "backend answered %d to /device/events, dropping the line (will never be accepted): %s", status, line);
            drop = true;
        }
        else
        {
            ESP_LOGW(TAG, "backend answered %d; keeping the line", status);
            drop = false;
        }

        if (!drop) return false;

        if (outbox::drop_first() != ESP_OK)
        {
            ESP_LOGE(TAG, "sent but could not drop the line; it will be resent and deduplicated on eventId");
            return false;
        }

        ESP_LOGI(TAG, "drained one line (%d), %u pending", status, static_cast<unsigned>(outbox::pending()));
        return true;
    }
}
