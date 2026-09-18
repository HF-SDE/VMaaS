#include "provisioning.h"

#include <cstring>
#include "esp_log.h"
#include "esp_random.h"
#include "esp_srp.h"
#include "network_provisioning/manager.h"
#include "network_provisioning/scheme_ble.h"

namespace
{
    constexpr const char* TAG = "Provisioning";
    constexpr const char* USERNAME = "wifiprov";
    constexpr int SALT_LEN = 16;

    char s_pin[provisioning::PIN_DIGITS + 1] = {};
    char* s_salt = nullptr;
    char* s_verifier = nullptr;
    int s_verifier_len = 0;
    network_prov_security2_params_t s_sec2 = {};
}

namespace provisioning
{
    const char* pin() { return s_pin; }

    esp_err_t begin(const char* device_name)
    {

        for (int i = 0; i < PIN_DIGITS; ++i) {
            s_pin[i] = static_cast<char>('0' + (esp_random() % 10));
        }
        s_pin[PIN_DIGITS] = '\0';

        esp_err_t err = esp_srp_gen_salt_verifier(USERNAME, std::strlen(USERNAME), s_pin, std::strlen(s_pin), &s_salt, SALT_LEN, &s_verifier, &s_verifier_len);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "salt/verifier generation failed: %s", esp_err_to_name(err));
            return err;
        }

        s_sec2.salt = s_salt;
        s_sec2.salt_len = SALT_LEN;
        s_sec2.verifier = s_verifier;
        s_sec2.verifier_len = static_cast<uint16_t>(s_verifier_len);

        network_prov_mgr_config_t cfg = {};
        cfg.scheme = network_prov_scheme_ble;
        cfg.scheme_event_handler = NETWORK_PROV_SCHEME_BLE_EVENT_HANDLER_FREE_BTDM;
        err = network_prov_mgr_init(cfg);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "network_prov_mgr_init failed: %s", esp_err_to_name(err));
            // esp_srp_gen_salt_verifier already succeeded above; free what it
            // allocated so a failed begin() does not leak, and null s_sec2's
            // copies of the same pointers so it does not dangle.
            free(s_salt);
            free(s_verifier);
            s_salt = nullptr;
            s_verifier = nullptr;
            s_sec2.salt = nullptr;
            s_sec2.verifier = nullptr;
            return err;
        }

        ESP_LOGI(TAG, "provisioning as '%s', pin %s", device_name, s_pin);
        err = network_prov_mgr_start_provisioning(NETWORK_PROV_SECURITY_2, &s_sec2, device_name, nullptr);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "network_prov_mgr_start_provisioning failed: %s", esp_err_to_name(err));
            // The manager was initialized above but never started; undo both
            // so a failed begin() leaves nothing running and nothing leaked.
            esp_err_t deinit_err = network_prov_mgr_deinit();
            if (deinit_err != ESP_OK) {
                ESP_LOGW(TAG, "network_prov_mgr_deinit failed: %s", esp_err_to_name(deinit_err));
            }
            free(s_salt);
            free(s_verifier);
            s_salt = nullptr;
            s_verifier = nullptr;
            s_sec2.salt = nullptr;
            s_sec2.verifier = nullptr;
            return err;
        }

        return ESP_OK;
    }

    void stop()
    {
        network_prov_mgr_stop_provisioning();
        esp_err_t deinit_err = network_prov_mgr_deinit();
        if (deinit_err != ESP_OK) {
            ESP_LOGW(TAG, "network_prov_mgr_deinit failed: %s", esp_err_to_name(deinit_err));
        }

        free(s_salt);
        free(s_verifier);
        s_salt = nullptr;
        s_verifier = nullptr;
        s_sec2.salt = nullptr;
        s_sec2.verifier = nullptr;
    }
}
