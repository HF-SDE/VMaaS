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

    uint32_t now_ms()
    {
        return static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS);
    }

    // Mirrors main.cpp's log_lcd(): warn once per failing call rather than
    // silently going text-blind mid-session.
    void log_lcd(const char* what, vmaas::LcdError err)
    {
        if (err != vmaas::LcdError::None)
            ESP_LOGW(TAG, "display %s: %s", what, vmaas::to_string(err));
    }
}

namespace onboarding
{
    void run(const vmaas::DeviceConfig& cfg, vmaas::GroveLcdRgb& lcd, bool backlight_ok)
    {
        wifi_sta::pause_retries();

        static char nets[vmaas::ONBOARDING_MAX_NETWORKS][wifi_sta::SSID_BUF_LEN];
        const int found = wifi_sta::scan(nets, vmaas::ONBOARDING_MAX_NETWORKS);
        ESP_LOGI(TAG, "scan found %d network(s)", found);

        bool rf_ready = (found >= 0);
        if (!rf_ready)
        {
            const esp_err_t start_err = esp_wifi_start();
            rf_ready = (start_err == ESP_OK || start_err == ESP_ERR_WIFI_CONN);
            if (!rf_ready)
                ESP_LOGE(TAG, "esp_wifi_start failed: %s", esp_err_to_name(start_err));
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

        if (rf_ready)
        {
            if (provisioning::begin(name) != ESP_OK)
                ESP_LOGE(TAG, "BLE provisioning unavailable, keypad only");
        }
        else
        {.
            ESP_LOGE(TAG, "RF not powered, skipping BLE provisioning entirely; keypad only");
        }

        vmaas::OnboardingFlow flow(name, provisioning::pin());
        flow.set_networks(ptrs, count);
        flow.begin(now_ms());

        char last0[17] = {}, last1[17] = {};
        uint8_t last_r = 0xFF, last_g = 0xFF, last_b = 0xFF;
        uint32_t connect_started = 0;
        bool waiting_for_ip = false;
        bool connected_handled = false;

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

            if (st.done)
                break;

            vTaskDelay(POLL_INTERVAL);
        }

        provisioning::stop();
        if (backlight_ok)
            log_lcd("set_rgb", lcd.set_rgb(255, 255, 255));
        wifi_sta::resume_retries();
        ESP_LOGI(TAG, "onboarding complete");
    }
}
