/**
 * @file api_client.cpp
 * @brief Authenticated HTTP to the platform, using the machine's certificate.
 */
#include "api_client.h"

#include <cstdio>
#include <cstring>

#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"

#include "activation.h"
#include "config_store.h"
#include "storage.h"

namespace
{
    constexpr const char* TAG = "ApiClient";

    // The largest buffers in this module, held statically because
    // esp_http_client does not copy client_cert_pem/client_key_pem - they
    // have to outlive every request made through the kept-open handle, the
    // same reason broker_client.cpp holds its copies statically rather than
    // on a task stack.
    constexpr size_t CERT_LEN = 2048;
    constexpr size_t KEY_LEN = 2048;

    // Must stay >= activation.cpp's CA_PEM_LEN (2560): both read the very
    // same config_store::API_CA_PATH file, and vmaas::fs::read_text_file()
    // refuses a file that does not fit rather than truncating it. If this
    // buffer were smaller than activation's, a private CA PEM sized between
    // the two limits would let activation succeed while this reader silently
    // got have_ca = false and fell back to esp_crt_bundle_attach - the
    // Mozilla bundle, which cannot verify a private CA. The machine would
    // then activate but never manage to report a single event, with nothing
    // but TLS errors in a log to explain why. The two constants are kept in
    // step by value, not by a shared symbol, because activation.cpp is out
    // of scope for this module.
    constexpr size_t CA_LEN = 2560;
    constexpr size_t URL_LEN = 256;

    char client_cert[CERT_LEN];
    char client_key[KEY_LEN];
    char api_ca[CA_LEN];
    char base_url[URL_LEN];
    bool have_ca = false;
    bool ready = false;

    esp_http_client_handle_t client = nullptr;
}

namespace api_client
{
    esp_err_t begin(const char* api_base_url)
    {
        if (api_base_url == nullptr || api_base_url[0] == '\0') return ESP_ERR_INVALID_ARG;

        if (!activation::has_certificate()) return ESP_ERR_INVALID_STATE;

        esp_err_t err = activation::load_certificate(client_cert, sizeof(client_cert));
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "cannot read the device certificate: %s", esp_err_to_name(err));
            return err;
        }

        err = activation::load_private_key(client_key, sizeof(client_key));
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "cannot read the private key: %s", esp_err_to_name(err));
            return err;
        }

        ESP_LOGI(TAG, "client certificate (%d bytes) and private key (%d bytes) loaded", static_cast<int>(std::strlen(client_cert)), static_cast<int>(std::strlen(client_key)));

        const int ca_len = vmaas::fs::read_text_file(config_store::API_CA_PATH, api_ca, sizeof(api_ca));
        have_ca = (ca_len > 0);
        if (have_ca) {
            ESP_LOGW(TAG, "verifying the API against the private CA in %s (%d bytes)", config_store::API_CA_PATH, ca_len);
        } else if (ca_len == -2) {
            ESP_LOGE(TAG, "%s does not fit %d bytes; falling back to the public CA bundle, which cannot verify a private CA - this machine will be unable to reach the API until the file fits", config_store::API_CA_PATH, static_cast<int>(sizeof(api_ca)));
        }

        std::snprintf(base_url, sizeof(base_url), "%s", api_base_url);
        ready = true;
        return ESP_OK;
    }

    esp_err_t post_json(const char* path, const char* body, int& status_out, char* response, size_t response_cap)
    {
        if (!ready) return ESP_ERR_INVALID_STATE;
        if (path == nullptr || body == nullptr || response == nullptr || response_cap == 0) return ESP_ERR_INVALID_ARG;

        char url[URL_LEN + 64];
        std::snprintf(url, sizeof(url), "%s%s", base_url, path);

        if (client == nullptr)
        {
            esp_http_client_config_t cfg = {};
            cfg.url = url;
            cfg.method = HTTP_METHOD_POST;
            cfg.timeout_ms = 15000;
            cfg.keep_alive_enable = true;
            cfg.client_cert_pem = client_cert;
            cfg.client_key_pem = client_key;
            if (have_ca) cfg.cert_pem = api_ca;
            else cfg.crt_bundle_attach = esp_crt_bundle_attach;

            client = esp_http_client_init(&cfg);
            if (client == nullptr) return ESP_FAIL;
        }
        else
        {
            esp_http_client_set_url(client, url);
            esp_http_client_set_method(client, HTTP_METHOD_POST);
        }

        esp_http_client_set_header(client, "Content-Type", "application/json");

        const int body_len = static_cast<int>(std::strlen(body));
        esp_err_t err = esp_http_client_open(client, body_len);
        if (err != ESP_OK)
        {
            end();
            return err;
        }

        if (esp_http_client_write(client, body, body_len) != body_len)
        {
            end();
            return ESP_FAIL;
        }

        if (esp_http_client_fetch_headers(client) < 0)
        {
            end();
            return ESP_FAIL;
        }

        status_out = esp_http_client_get_status_code(client);

        const int read = esp_http_client_read_response(client, response, static_cast<int>(response_cap) - 1);
        response[read > 0 ? read : 0] = '\0';

        if (!esp_http_client_is_complete_data_received(client)) end();

        return ESP_OK;
    }

    void end()
    {
        if (client == nullptr) return;
        esp_http_client_cleanup(client);
        client = nullptr;
    }
}
