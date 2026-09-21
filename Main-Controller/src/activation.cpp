#include "activation.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>

#include "cJSON.h"
#include "config_store.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif_sntp.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "storage.h"

#include "mbedtls/pk.h"
#include "mbedtls/x509_csr.h"
#include "psa/crypto.h"

namespace
{
    constexpr const char* TAG = "Activation";

    /// One namespace, so a factory reset is one nvs_erase_all().
    constexpr const char* NS = "activation";

    // NVS keys. Fifteen characters is the limit; these are well inside it.
    constexpr const char* K_KEY    = "key";
    constexpr const char* K_CERT   = "cert";
    constexpr const char* K_CA     = "ca";
    constexpr const char* K_TENANT = "tenant";
    constexpr const char* K_SITE   = "site";
    constexpr const char* K_MACHINE = "machine";
    constexpr const char* K_PREFIX = "prefix";
    constexpr const char* K_HOST   = "mqtt_host";
    constexpr const char* K_PORT   = "mqtt_port";

    // An EC P-256 key in PEM is about 240 bytes and a CSR about 390; the
    // response carries two certificates and five identifiers. All three are
    // heap allocations made and freed inside one call - none of this is worth
    // holding on the stack of a task that also drives a display.
    constexpr size_t KEY_PEM_LEN  = 512;
    constexpr size_t CSR_PEM_LEN  = 1024;
    constexpr size_t REQ_LEN      = 2048;
    constexpr size_t RESP_LEN     = 8192;

    /// One PEM certificate with room to spare.
    constexpr size_t CA_PEM_LEN   = 2560;

    /// "CN=" plus an id, so the two cannot drift apart.
    constexpr size_t SUBJECT_LEN = activation::ID_MAX + 4;

    /// Anything before this cannot be a real clock, only a freshly booted one.
    constexpr time_t YEAR_2020 = 1577836800;

    int rejections = 0;

    esp_err_t nvs_get(const char* key, char* out, size_t out_len)
    {
        nvs_handle_t h;
        esp_err_t err = nvs_open(NS, NVS_READONLY, &h);
        if (err != ESP_OK) return err;

        size_t len = out_len;
        err = nvs_get_str(h, key, out, &len);
        nvs_close(h);
        return err;
    }

    esp_err_t nvs_put_str(nvs_handle_t h, const char* key, const char* value)
    {
        const esp_err_t err = nvs_set_str(h, key, value);
        if (err != ESP_OK) ESP_LOGE(TAG, "nvs_set_str('%s') failed: %s", key, esp_err_to_name(err));
        return err;
    }

    /**
     * @brief The device's private key, generated on first use.
     *
     * Generated once and reused across activations: a reactivated machine
     * keeps the same key and gets a new certificate for it. EC P-256 rather
     * than RSA-2048 because RSA key generation on an ESP32 takes 30-60 seconds
     * with a technician watching, and P-256 takes milliseconds.
     */
    esp_err_t load_or_create_key(mbedtls_pk_context& key, char* pem, size_t pem_len)
    {
        esp_err_t err = nvs_get(K_KEY, pem, pem_len);
        if (err == ESP_OK)
        {
            const int rc = mbedtls_pk_parse_key(&key, reinterpret_cast<const unsigned char*>(pem),
                                                std::strlen(pem) + 1, nullptr, 0);
            if (rc == 0) return ESP_OK;
            ESP_LOGW(TAG, "stored key does not parse (-0x%04x), generating a new one", -rc);
            mbedtls_pk_free(&key);
            mbedtls_pk_init(&key);
        }
        else if (err != ESP_ERR_NVS_NOT_FOUND && err != ESP_ERR_NVS_NOT_INITIALIZED)
        {
            return err;
        }

        psa_key_attributes_t attr = PSA_KEY_ATTRIBUTES_INIT;
        psa_set_key_type(&attr, PSA_KEY_TYPE_ECC_KEY_PAIR(PSA_ECC_FAMILY_SECP_R1));
        psa_set_key_bits(&attr, 256);
        psa_set_key_usage_flags(&attr, PSA_KEY_USAGE_SIGN_HASH | PSA_KEY_USAGE_EXPORT);
        psa_set_key_algorithm(&attr, MBEDTLS_PK_ALG_ECDSA(PSA_ALG_SHA_256));

        mbedtls_svc_key_id_t kid = MBEDTLS_SVC_KEY_ID_INIT;
        const psa_status_t ps = psa_generate_key(&attr, &kid);
        psa_reset_key_attributes(&attr);
        if (ps != PSA_SUCCESS)
        {
            ESP_LOGE(TAG, "psa_generate_key failed: %d", static_cast<int>(ps));
            return ESP_FAIL;
        }

        // Copies the material out, so the PSA key can go immediately.
        int rc = mbedtls_pk_copy_from_psa(kid, &key);
        psa_destroy_key(kid);
        if (rc != 0)
        {
            ESP_LOGE(TAG, "pk_copy_from_psa failed: -0x%04x", -rc);
            return ESP_FAIL;
        }

        rc = mbedtls_pk_write_key_pem(&key, reinterpret_cast<unsigned char*>(pem), pem_len);
        if (rc != 0)
        {
            ESP_LOGE(TAG, "pk_write_key_pem failed: -0x%04x", -rc);
            return ESP_FAIL;
        }

        nvs_handle_t h;
        err = nvs_open(NS, NVS_READWRITE, &h);
        if (err != ESP_OK) return err;
        err = nvs_put_str(h, K_KEY, pem);
        if (err == ESP_OK) err = nvs_commit(h);
        nvs_close(h);

        ESP_LOGI(TAG, "generated a new EC P-256 device key");
        return err;
    }

    /**
     * @brief Build a PEM CSR for the key.
     *
     * The subject is set because a CSR must have one, not because it matters:
     * the platform builds the issued certificate's subject from its own
     * activation record and ignores what the request asked for.
     */
    esp_err_t make_csr(mbedtls_pk_context& key, const char* machine_id, char* pem, size_t pem_len)
    {
        char subject[SUBJECT_LEN];
        std::snprintf(subject, sizeof(subject), "CN=%s", machine_id);

        mbedtls_x509write_csr req;
        mbedtls_x509write_csr_init(&req);
        mbedtls_x509write_csr_set_md_alg(&req, MBEDTLS_MD_SHA256);
        mbedtls_x509write_csr_set_key(&req, &key);

        esp_err_t out = ESP_OK;
        int rc = mbedtls_x509write_csr_set_subject_name(&req, subject);
        if (rc != 0)
        {
            ESP_LOGE(TAG, "csr_set_subject_name failed: -0x%04x", -rc);
            out = ESP_FAIL;
        }
        else
        {
            // No RNG callback in mbedtls 4.x: the writer draws from PSA.
            rc = mbedtls_x509write_csr_pem(&req, reinterpret_cast<unsigned char*>(pem), pem_len);
            if (rc != 0)
            {
                ESP_LOGE(TAG, "csr_pem failed: -0x%04x", -rc);
                out = ESP_FAIL;
            }
        }

        mbedtls_x509write_csr_free(&req);
        return out;
    }

    void copy_field(char* dst, size_t dst_len, const cJSON* obj, const char* key)
    {
        const cJSON* item = cJSON_GetObjectItemCaseSensitive(obj, key);
        if (cJSON_IsString(item) && item->valuestring != nullptr)
        {
            std::strncpy(dst, item->valuestring, dst_len - 1);
            dst[dst_len - 1] = '\0';
        }
        else
        {
            dst[0] = '\0';
        }
    }
}

namespace activation
{
    bool has_certificate()
    {
        nvs_handle_t h;
        if (nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return false;

        size_t len = 0;
        const esp_err_t err = nvs_get_str(h, K_CERT, nullptr, &len);
        nvs_close(h);

        // A zero-length value would be a half-written activation, which is not
        // a certificate.
        return err == ESP_OK && len > 1;
    }

    esp_err_t sync_time(uint32_t timeout_ms)
    {
        std::time_t now = std::time(nullptr);
        if (now > YEAR_2020)
        {
            ESP_LOGI(TAG, "clock already set");
            return ESP_OK;
        }

        esp_sntp_config_t cfg = ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");
        esp_err_t err = esp_netif_sntp_init(&cfg);
        // Onboarding can reach this more than once - a retry after a rejection
        // comes back through here - and a second init is not an error.
        if (err == ESP_ERR_INVALID_STATE) err = ESP_OK;
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "sntp_init failed: %s", esp_err_to_name(err));
            return err;
        }

        err = esp_netif_sntp_sync_wait(pdMS_TO_TICKS(timeout_ms));
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "no SNTP answer within %u ms", static_cast<unsigned>(timeout_ms));
            return err;
        }

        now = std::time(nullptr);
        if (now <= YEAR_2020)
        {
            ESP_LOGE(TAG, "SNTP answered but the clock is still %lld", static_cast<long long>(now));
            return ESP_ERR_INVALID_STATE;
        }

        ESP_LOGI(TAG, "clock set to %lld", static_cast<long long>(now));
        return ESP_OK;
    }

    Result activate(const char* api_base_url, const char* machine_id, const char* code)
    {
        if (api_base_url == nullptr || api_base_url[0] == '\0' ||
            machine_id == nullptr || machine_id[0] == '\0')
        {
            ESP_LOGE(TAG, "activate() called without an API address or a machine id");
            return Result::Unreachable;
        }

        char* key_pem = static_cast<char*>(std::calloc(1, KEY_PEM_LEN));
        char* csr_pem = static_cast<char*>(std::calloc(1, CSR_PEM_LEN));
        char* req_body = static_cast<char*>(std::calloc(1, REQ_LEN));
        char* resp = static_cast<char*>(std::calloc(1, RESP_LEN));

        const psa_status_t ps = psa_crypto_init();
        if (ps != PSA_SUCCESS) ESP_LOGW(TAG, "psa_crypto_init: %d", static_cast<int>(ps));

        mbedtls_pk_context key;
        mbedtls_pk_init(&key);

        Result result = Result::Unreachable;
        esp_http_client_handle_t client = nullptr;

        auto finish = [&](Result r) {
            if (client != nullptr) esp_http_client_cleanup(client);
            mbedtls_pk_free(&key);
            std::free(resp);
            std::free(req_body);
            std::free(csr_pem);
            std::free(key_pem);
            return r;
        };

        if (key_pem == nullptr || csr_pem == nullptr || req_body == nullptr || resp == nullptr)
        {
            ESP_LOGE(TAG, "out of memory");
            return finish(Result::Unreachable);
        }

        if (load_or_create_key(key, key_pem, KEY_PEM_LEN) != ESP_OK) return finish(Result::Unreachable);
        if (make_csr(key, machine_id, csr_pem, CSR_PEM_LEN) != ESP_OK) return finish(Result::Unreachable);

        cJSON* body = cJSON_CreateObject();
        cJSON_AddStringToObject(body, "machineId", machine_id);
        cJSON_AddStringToObject(body, "code", code);
        cJSON_AddStringToObject(body, "csr", csr_pem);
        const bool printed = cJSON_PrintPreallocated(body, req_body, REQ_LEN, /*fmt=*/0);
        cJSON_Delete(body);
        if (!printed)
        {
            ESP_LOGE(TAG, "request body does not fit %u bytes", static_cast<unsigned>(REQ_LEN));
            return finish(Result::Unreachable);
        }

        char url[192];
        std::snprintf(url, sizeof(url), "%s/device/activate", api_base_url);

        esp_http_client_config_t cfg = {};
        cfg.url = url;
        cfg.method = HTTP_METHOD_POST;
        cfg.timeout_ms = 15000;

        static char ca_pem[CA_PEM_LEN];
        const int ca_len = vmaas::fs::read_text_file(config_store::API_CA_PATH, ca_pem, sizeof(ca_pem));
        if (ca_len > 0)
        {
            ESP_LOGW(TAG, "verifying the API against the private CA in %s (%d bytes), not the bundle", config_store::API_CA_PATH, ca_len);
            cfg.cert_pem = ca_pem;
        }
        else
        {
            cfg.crt_bundle_attach = esp_crt_bundle_attach;
        }

        client = esp_http_client_init(&cfg);
        if (client == nullptr)
        {
            ESP_LOGE(TAG, "http_client_init failed");
            return finish(Result::Unreachable);
        }

        esp_http_client_set_header(client, "Content-Type", "application/json");
        esp_http_client_set_post_field(client, req_body, static_cast<int>(std::strlen(req_body)));

        esp_err_t err = esp_http_client_open(client, static_cast<int>(std::strlen(req_body)));
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "cannot open %s: %s", url, esp_err_to_name(err));
            return finish(Result::Unreachable);
        }

        const int written = esp_http_client_write(client, req_body, static_cast<int>(std::strlen(req_body)));
        if (written < 0)
        {
            ESP_LOGE(TAG, "write failed");
            return finish(Result::Unreachable);
        }

        if (esp_http_client_fetch_headers(client) < 0)
        {
            ESP_LOGE(TAG, "fetch_headers failed");
            return finish(Result::Unreachable);
        }

        const int status = esp_http_client_get_status_code(client);
        const int read = esp_http_client_read_response(client, resp, RESP_LEN - 1);
        if (read >= 0) resp[read] = '\0';

        ESP_LOGI(TAG, "POST %s -> %d (%d bytes)", url, status, read);

        if (status == 400)
        {
            ++rejections;
            ESP_LOGW(TAG, "activation rejected (%d in a row)", rejections);
            return finish(rejections >= MAX_REJECTIONS ? Result::CodeExpired : Result::CodeRejected);
        }

        if (status != 200)
        {
            ESP_LOGE(TAG, "unexpected status %d", status);
            return finish(Result::Unreachable);
        }

        cJSON* root = cJSON_Parse(resp);
        if (root == nullptr || !cJSON_IsObject(root))
        {
            ESP_LOGE(TAG, "response is not a JSON object");
            cJSON_Delete(root);
            return finish(Result::Unreachable);
        }

        Identity id{};
        char* cert = nullptr;
        char* ca = nullptr;

        const cJSON* c = cJSON_GetObjectItemCaseSensitive(root, "certificate");
        const cJSON* a = cJSON_GetObjectItemCaseSensitive(root, "caCertificate");
        if (cJSON_IsString(c) && cJSON_IsString(a))
        {
            cert = c->valuestring;
            ca = a->valuestring;
        }

        copy_field(id.tenant_id, sizeof(id.tenant_id), root, "tenantId");
        copy_field(id.site_id, sizeof(id.site_id), root, "siteId");
        copy_field(id.machine_id, sizeof(id.machine_id), root, "machineId");
        copy_field(id.topic_prefix, sizeof(id.topic_prefix), root, "topicPrefix");

        const cJSON* mqtt = cJSON_GetObjectItemCaseSensitive(root, "mqtt");
        if (cJSON_IsObject(mqtt))
        {
            copy_field(id.mqtt_host, sizeof(id.mqtt_host), mqtt, "host");
            const cJSON* port = cJSON_GetObjectItemCaseSensitive(mqtt, "port");
            if (cJSON_IsNumber(port) && port->valuedouble >= 1 && port->valuedouble <= 65535) {
                id.mqtt_port = static_cast<uint16_t>(port->valuedouble);
            }
        }

        if (cert == nullptr || ca == nullptr || id.topic_prefix[0] == '\0' || id.mqtt_host[0] == '\0' || id.mqtt_port == 0)
        {
            ESP_LOGE(TAG, "response is missing a required field");
            cJSON_Delete(root);
            return finish(Result::Unreachable);
        }

        nvs_handle_t h;
        err = nvs_open(NS, NVS_READWRITE, &h);
        if (err == ESP_OK)
        {
            err = nvs_put_str(h, K_CA, ca);
            if (err == ESP_OK) err = nvs_put_str(h, K_TENANT, id.tenant_id);
            if (err == ESP_OK) err = nvs_put_str(h, K_SITE, id.site_id);
            if (err == ESP_OK) err = nvs_put_str(h, K_MACHINE, id.machine_id);
            if (err == ESP_OK) err = nvs_put_str(h, K_PREFIX, id.topic_prefix);
            if (err == ESP_OK) err = nvs_put_str(h, K_HOST, id.mqtt_host);
            if (err == ESP_OK) err = nvs_set_u16(h, K_PORT, id.mqtt_port);
            if (err == ESP_OK) err = nvs_put_str(h, K_CERT, cert);
            if (err == ESP_OK) err = nvs_commit(h);
            nvs_close(h);
        }

        cJSON_Delete(root);

        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "storing the activation failed: %s", esp_err_to_name(err));
            return finish(Result::Unreachable);
        }

        rejections = 0;
        ESP_LOGI(TAG, "activated: prefix '%s' broker %s:%u", id.topic_prefix, id.mqtt_host, static_cast<unsigned>(id.mqtt_port));
        result = Result::Ok;
        return finish(result);
    }

    esp_err_t load_identity(Identity& out)
    {
        Identity id{};
        esp_err_t err = nvs_get(K_TENANT, id.tenant_id, sizeof(id.tenant_id));
        if (err != ESP_OK) return err;
        if ((err = nvs_get(K_SITE, id.site_id, sizeof(id.site_id))) != ESP_OK) return err;
        if ((err = nvs_get(K_MACHINE, id.machine_id, sizeof(id.machine_id))) != ESP_OK) return err;
        if ((err = nvs_get(K_PREFIX, id.topic_prefix, sizeof(id.topic_prefix))) != ESP_OK) return err;
        if ((err = nvs_get(K_HOST, id.mqtt_host, sizeof(id.mqtt_host))) != ESP_OK) return err;

        nvs_handle_t h;
        if ((err = nvs_open(NS, NVS_READONLY, &h)) != ESP_OK) return err;
        err = nvs_get_u16(h, K_PORT, &id.mqtt_port);
        nvs_close(h);
        if (err != ESP_OK) return err;

        out = id;
        return ESP_OK;
    }

    esp_err_t load_certificate(char* out, size_t out_len) { return nvs_get(K_CERT, out, out_len); }
    esp_err_t load_private_key(char* out, size_t out_len) { return nvs_get(K_KEY, out, out_len); }
    esp_err_t load_broker_ca(char* out, size_t out_len)   { return nvs_get(K_CA, out, out_len); }
}
