#include "provisioning.h"

#include <atomic>
#include <cstdio>
#include <cstring>
#include "esp_event.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_wifi_types.h"
#include "esp_random.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
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

    /// How long stop() waits for the manager to finish tearing BLE down.
    constexpr uint32_t END_TIMEOUT_MS = 10000;

    /**
     * @brief How long BLE stays up after the phone's credentials connected.
     *
     * The app learns that the machine is online only by polling over BLE;
     * stopping at once cut it off mid-poll and left it spinning. Activation
     * stops BLE sooner if the technician gets there first.
     */
    constexpr uint32_t SUCCESS_GRACE_MS = 10000;

    ESP_EVENT_DEFINE_BASE(VMAAS_PROV_EVENT);
    constexpr int32_t STOP_REQUEST = 0;

    SemaphoreHandle_t s_ended = nullptr; ///< Given on NETWORK_PROV_END.
    esp_timer_handle_t s_grace_timer = nullptr;
    esp_event_handler_instance_t s_prov_handler = nullptr;
    esp_event_handler_instance_t s_stop_handler = nullptr;

    // Written on the event-loop task, read by onboarding on main.
    char s_remote_ssid[33] = {};
    std::atomic<bool> s_cred_received{false};
    std::atomic<bool> s_cred_failed{false};
    std::atomic<bool> s_end_seen{false};

    void on_prov_event(void*, esp_event_base_t, int32_t id, void* data)
    {
        switch (id)
        {
            case NETWORK_PROV_WIFI_CRED_RECV:
            {
                const wifi_sta_config_t* sta = static_cast<const wifi_sta_config_t*>(data);
                // sta->ssid is 32 bytes and only NUL-terminated when shorter.
                std::snprintf(s_remote_ssid, sizeof(s_remote_ssid), "%.32s", reinterpret_cast<const char*>(sta->ssid));
                s_cred_received = true;
                break;
            }
            case NETWORK_PROV_WIFI_CRED_FAIL:
                s_cred_failed = true;
                break;
            case NETWORK_PROV_WIFI_CRED_SUCCESS:
                esp_timer_start_once(s_grace_timer, static_cast<uint64_t>(SUCCESS_GRACE_MS) * 1000);
                break;
            case NETWORK_PROV_END:
                s_end_seen = true;
                xSemaphoreGive(s_ended);
                break;
            default:
                break;
        }
    }

    /// esp_timer task: only hands the stop to the event loop, see on_stop_request().
    void on_grace_elapsed(void*)
    {
        esp_event_post(VMAAS_PROV_EVENT, STOP_REQUEST, nullptr, 0, 0);
    }

    /*
     * Runs on the default event-loop task, never on the caller's. Stopping
     * the manager unregisters its Wi-Fi/IP handlers while it holds its own
     * lock. From any other task that waits on the loop's mutex, and the loop
     * may at that moment be dispatching GOT_IP to the manager's handler,
     * which waits on that same lock: a deadlock. main hit it every time,
     * because it reacts to wifi_sta's GOT_IP handler while that dispatch is
     * still running. On this task the loop's mutex is already ours.
     */
    void on_stop_request(void*, esp_event_base_t, int32_t, void*)
    {
        network_prov_mgr_stop_provisioning();
    }

    void unregister_handlers()
    {
        if (s_prov_handler != nullptr)
        {
            esp_event_handler_instance_unregister(NETWORK_PROV_EVENT, ESP_EVENT_ANY_ID, s_prov_handler);
            s_prov_handler = nullptr;
        }
        if (s_stop_handler != nullptr)
        {
            esp_event_handler_instance_unregister(VMAAS_PROV_EVENT, STOP_REQUEST, s_stop_handler);
            s_stop_handler = nullptr;
        }
    }
}

namespace provisioning
{
    const char* pin() { return s_pin; }

    bool take_credentials_received(char* ssid, size_t len)
    {
        if (!s_cred_received.exchange(false)) return false;
        std::snprintf(ssid, len, "%s", s_remote_ssid);
        return true;
    }

    bool take_connect_failed() { return s_cred_failed.exchange(false); }

    bool ended() { return s_end_seen; }

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

        if (s_ended == nullptr) {
            s_ended = xSemaphoreCreateBinary();
        }
        xSemaphoreTake(s_ended, 0); // Drop a NETWORK_PROV_END left over from an earlier session.
        s_cred_received = false;
        s_cred_failed = false;
        s_end_seen = false;

        err = (s_ended == nullptr) ? ESP_ERR_NO_MEM : ESP_OK;
        if (err == ESP_OK && s_grace_timer == nullptr)
        {
            esp_timer_create_args_t targs = {};
            targs.callback = &on_grace_elapsed;
            targs.dispatch_method = ESP_TIMER_TASK;
            targs.name = "prov_grace";
            err = esp_timer_create(&targs, &s_grace_timer);
        }
        if (err == ESP_OK) {
            err = network_prov_mgr_disable_auto_stop(1000);
        }
        if (err == ESP_OK) {
            err = esp_event_handler_instance_register(NETWORK_PROV_EVENT, ESP_EVENT_ANY_ID, &on_prov_event, nullptr, &s_prov_handler);
        }
        if (err == ESP_OK) {
            err = esp_event_handler_instance_register(VMAAS_PROV_EVENT, STOP_REQUEST, &on_stop_request, nullptr, &s_stop_handler);
        }

        if (err == ESP_OK)
        {
            ESP_LOGI(TAG, "provisioning as '%s', pin %s", device_name, s_pin);
            err = network_prov_mgr_start_provisioning(NETWORK_PROV_SECURITY_2, &s_sec2, device_name, nullptr);
        }
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "starting provisioning failed: %s", esp_err_to_name(err));
            unregister_handlers();
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
        // The stop itself runs on the event-loop task (see on_stop_request());
        // deinit() only frees the manager once NETWORK_PROV_END says the
        // service is idle, so it has no handlers left to unregister.
        ESP_LOGI(TAG, "stopping provisioning");
        esp_timer_stop(s_grace_timer);
        if (!s_end_seen)
        {
            const esp_err_t post_err = esp_event_post(VMAAS_PROV_EVENT, STOP_REQUEST, nullptr, 0, portMAX_DELAY);
            if (post_err != ESP_OK) {
                ESP_LOGE(TAG, "posting the stop request failed: %s", esp_err_to_name(post_err));
            }
            else if (xSemaphoreTake(s_ended, pdMS_TO_TICKS(END_TIMEOUT_MS)) != pdTRUE) {
                ESP_LOGW(TAG, "no NETWORK_PROV_END within %u ms, deinitialising anyway", static_cast<unsigned>(END_TIMEOUT_MS));
            }
        }
        unregister_handlers();

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
