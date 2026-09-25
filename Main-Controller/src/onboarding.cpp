/**
 * @file onboarding.cpp
 * @brief Blocking Wi-Fi onboarding driver: BLE by default, keypad as the fallback.
 *
 * The loop mirrors the sales loop in main.cpp: drain the keypad queue, tick,
 * draw only what changed.
 */
#include "onboarding.h"

#include <cstdio>
#include <cstring>
#include "activation.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "keypad_task.h"
#include "onboarding_flow.h"
#include "provisioning.h"
#include "wifi_sta.h"

namespace
{
    constexpr const char* TAG = "Onboarding";
    constexpr TickType_t POLL_INTERVAL = pdMS_TO_TICKS(50);
    constexpr uint32_t CONNECT_TIMEOUT_MS = 15000;
    constexpr uint32_t SNTP_TIMEOUT_MS = 10000;

    /**
     * @brief How long stored credentials get before setup is opened anyway.
     *
     * Long enough for an access point that is merely slow to appear, short
     * enough that a technician standing at a machine whose network is gone
     * does not conclude it is dead.
     */
    constexpr uint32_t STALE_WIFI_MS = 25000;

    /**
     * @brief What onboarding still owes the platform once Wi-Fi is up.
     *
     * Decided once, before the loop, because none of the three inputs can
     * change while onboarding runs.
     */
    vmaas::ActivationNeed decide_activation(const vmaas::DeviceConfig& cfg)
    {
        if (activation::has_certificate())
        {
            ESP_LOGI(TAG, "a device certificate is already stored");
            return vmaas::ActivationNeed::NotNeeded;
        }
        if (cfg.machine_id[0] == '\0')
        {
            ESP_LOGE(TAG, "config.json has no machine_id: this unit was never flashed with one");
            return vmaas::ActivationNeed::NoMachineId;
        }
        if (cfg.api_base_url[0] == '\0')
        {
            ESP_LOGE(TAG, "config.json has no backend.api_base_url");
            return vmaas::ActivationNeed::NoApiAddress;
        }
        return vmaas::ActivationNeed::Needed;
    }

    /// Maps what activation.cpp reports onto what the flow draws.
    vmaas::ActivationOutcome to_outcome(activation::Result r)
    {
        switch (r)
        {
            case activation::Result::Ok:           
                return vmaas::ActivationOutcome::Ok;
            case activation::Result::CodeRejected: 
                return vmaas::ActivationOutcome::CodeRejected;
            case activation::Result::CodeExpired:  
                return vmaas::ActivationOutcome::CodeExpired;
            case activation::Result::Unreachable:  
                break;
        }
        return vmaas::ActivationOutcome::Unreachable;
    }

    uint32_t now_ms()
    {
        return static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS);
    }

    // Mirrors main.cpp's log_lcd(): warn once per failing call rather than
    // silently going text-blind mid-session.
    void log_lcd(const char* what, vmaas::LcdError err)
    {
        if (err != vmaas::LcdError::None) {
            ESP_LOGW(TAG, "display %s: %s", what, vmaas::to_string(err));
        }
    }
}

namespace onboarding
{
    void run(const vmaas::DeviceConfig& cfg, vmaas::GroveLcdRgb& lcd, bool backlight_ok)
    {
        const bool have_wifi = wifi_sta::has_credentials();
        if (!have_wifi)
        {
            wifi_sta::pause_retries();
        }
        else
        {
            ESP_LOGI(TAG, "credentials already stored: retrying them while setup stays open");
        }

        static char nets[vmaas::ONBOARDING_MAX_NETWORKS][wifi_sta::SSID_BUF_LEN];
        const int found = wifi_sta::scan(nets, vmaas::ONBOARDING_MAX_NETWORKS);
        ESP_LOGI(TAG, "scan found %d network(s)", found);

        bool rf_ready = (found >= 0);
        if (!rf_ready)
        {
            const esp_err_t start_err = esp_wifi_start();
            rf_ready = (start_err == ESP_OK || start_err == ESP_ERR_WIFI_CONN);
            if (!rf_ready) {
                ESP_LOGE(TAG, "esp_wifi_start failed: %s", esp_err_to_name(start_err));
            }
        }

        const char* ptrs[vmaas::ONBOARDING_MAX_NETWORKS];
        const size_t count = (found > 0) ? static_cast<size_t>(found) : 0;
        for (size_t i = 0; i < count; ++i) {
            ptrs[i] = nets[i];
        }

        char name[17];
        if (cfg.name[0] != '\0')
        {
            std::snprintf(name, sizeof(name), "%s", cfg.name);
        }
        else
        {
            uint8_t mac[6] = {};
            if (esp_wifi_get_mac(WIFI_IF_STA, mac) == ESP_OK)
                std::snprintf(name, sizeof(name), "VMaaS-%02X%02X%02X", mac[3], mac[4], mac[5]);
            else
                std::snprintf(name, sizeof(name), "VMaaS");
        }

        bool prov_started = false;   ///< begin() succeeded, so stop() is owed.
        bool prov_attempted = false; ///< Tried once; never retried every 50 ms.

        if (!rf_ready)
        {
            ESP_LOGE(TAG, "RF not powered, skipping BLE provisioning entirely; keypad only");
            prov_attempted = true;
        }
        else if (!have_wifi)
        {
            prov_attempted = true;
            if (provisioning::begin(name) == ESP_OK) {
                prov_started = true;
            }
            else {
                ESP_LOGE(TAG, "BLE provisioning unavailable, keypad only");
            }
        }

        // Empty until provisioning actually starts; set_pin() fills it in on
        // the stale-credentials path.
        vmaas::OnboardingFlow flow(name, prov_started ? provisioning::pin() : "");
        flow.set_networks(ptrs, count);
        flow.set_activation(decide_activation(cfg));
        flow.begin(now_ms());

        char last0[17] = {}, last1[17] = {};
        uint8_t last_r = 0xFF, last_g = 0xFF, last_b = 0xFF;
        uint32_t connect_started = 0;
        bool waiting_for_ip = false;
        bool connected_handled = false;
        bool prov_stopped = false;
        const uint32_t stale_wifi_at = now_ms() + STALE_WIFI_MS;

        while (true)
        {
            vmaas::KeyEvent ev{};
            vmaas::FlowState st = flow.tick(now_ms());
            while (keypad_task_next(ev)) {
                st = flow.handle(ev);
            }

            if (st.connect_requested && !waiting_for_ip)
            {
                ESP_LOGI(TAG, "connecting to '%s'", st.ssid);
                if (wifi_sta::set_credentials(st.ssid, st.password) == ESP_OK)
                {
                    waiting_for_ip = true;
                    connect_started = now_ms();
                }
                else
                {
                    flow.on_connect_result(false);
                }
            }

            if (waiting_for_ip)
            {
                if (wifi_sta::is_connected())
                {
                    waiting_for_ip = false;
                    connected_handled = true;
                    flow.on_connect_result(true);
                }
                else if (now_ms() - connect_started > CONNECT_TIMEOUT_MS)
                {
                    waiting_for_ip = false;
                    wifi_sta::forget();
                    flow.on_connect_result(false);
                }
            }
            else if (!connected_handled && wifi_sta::is_connected())
            {
                connected_handled = true;

                wifi_config_t wcfg = {};
                if (esp_wifi_get_config(WIFI_IF_STA, &wcfg) == ESP_OK)
                {
                    char ssid_buf[wifi_sta::SSID_BUF_LEN] = {};
                    std::memcpy(ssid_buf, wcfg.sta.ssid, sizeof(wcfg.sta.ssid));
                    flow.set_connected_ssid(ssid_buf);
                }
                else
                {
                    ESP_LOGW(TAG, "esp_wifi_get_config failed, Connected row 1 will be blank");
                }

                flow.on_connect_result(true);
            }

            if (!prov_attempted && !connected_handled && static_cast<int32_t>(now_ms() - stale_wifi_at) > 0) {
                ESP_LOGW(TAG, "stored credentials did not connect in %u ms, opening setup", static_cast<unsigned>(STALE_WIFI_MS));
                prov_attempted = true;
                wifi_sta::pause_retries();
                esp_wifi_disconnect();

                if (provisioning::begin(name) == ESP_OK)
                {
                    prov_started = true;
                    // The constructor had no PIN to show; this is it.
                    flow.set_pin(provisioning::pin());
                }
                else
                {
                    ESP_LOGE(TAG, "BLE provisioning unavailable, keypad only");
                }
            }

            if (prov_started && !prov_stopped && connected_handled)
            {
                // BLE has nothing left to do once credentials are in, and the
                // TLS handshake in activate() wants the heap NimBLE is holding.
                prov_stopped = true;
                provisioning::stop();
            }

            if (std::strcmp(st.row0, last0) != 0 || std::strcmp(st.row1, last1) != 0)
            {
                log_lcd("clear", lcd.clear());
                log_lcd("row 0", lcd.print_at(0, 0, st.row0));
                log_lcd("row 1", lcd.print_at(0, 1, st.row1));
                std::snprintf(last0, sizeof(last0), "%s", st.row0);
                std::snprintf(last1, sizeof(last1), "%s", st.row1);
            }
            if (backlight_ok && (st.r != last_r || st.g != last_g || st.b != last_b))
            {
                log_lcd("set_rgb", lcd.set_rgb(st.r, st.g, st.b));
                last_r = st.r; last_g = st.g; last_b = st.b;
            }

            if (st.activate_requested)
            {
                ESP_LOGI(TAG, "activating machine '%s' against %s", cfg.machine_id, cfg.api_base_url);

                activation::Result r = activation::Result::Unreachable;
                if (activation::sync_time(SNTP_TIMEOUT_MS) != ESP_OK)
                {
                    ESP_LOGE(TAG, "no clock, not attempting activation");
                }
                else
                {
                    r = activation::activate(cfg.api_base_url, cfg.machine_id, st.code);
                }

                ESP_LOGI(TAG, "stack headroom after activation: %u bytes", static_cast<unsigned>(uxTaskGetStackHighWaterMark(nullptr)));

                flow.on_activation_result(to_outcome(r));
                vTaskDelay(POLL_INTERVAL);
                continue;
            }

            if (st.done) break;

            vTaskDelay(POLL_INTERVAL);
        }

        if (prov_started && !prov_stopped) {
            provisioning::stop();
        }
        if (backlight_ok) {
            log_lcd("set_rgb", lcd.set_rgb(255, 255, 255));
        }
        wifi_sta::resume_retries();
        ESP_LOGI(TAG, "onboarding complete");
    }
}
