#include "wifi_sta.h"

#include <cstdio>
#include <cstring>
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "nvs_flash.h"

namespace
{
    constexpr const char* TAG = "WifiSta";

    /// First retry delay after a disconnect. Doubles up to BACKOFF_MAX_MS.
    constexpr uint32_t BACKOFF_MIN_MS = 2000;
    /// Ceiling for the retry delay. A wrong password must not keep the radio busy for months.
    constexpr uint32_t BACKOFF_MAX_MS = 60000;

    bool s_connected = false;
    uint32_t s_backoff_ms = BACKOFF_MIN_MS;
    esp_timer_handle_t s_retry_timer = nullptr;

    void retry_cb(void*)
    {
        esp_wifi_connect();
    }

    void on_event(void*, esp_event_base_t base, int32_t id, void* data)
    {
        if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START)
        {
            esp_wifi_connect();
        }
        else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED)
        {
            s_connected = false;
            ESP_LOGW(TAG, "disconnected, retrying in %u ms", static_cast<unsigned>(s_backoff_ms));
            esp_timer_stop(s_retry_timer);
            esp_timer_start_once(s_retry_timer, static_cast<uint64_t>(s_backoff_ms) * 1000);
            s_backoff_ms = (s_backoff_ms > BACKOFF_MAX_MS / 2) ? BACKOFF_MAX_MS : s_backoff_ms * 2;
        }
        else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP)
        {
            const ip_event_got_ip_t* e = static_cast<const ip_event_got_ip_t*>(data);
            s_connected = true;
            s_backoff_ms = BACKOFF_MIN_MS;
            ESP_LOGI(TAG, "connected, ip " IPSTR, IP2STR(&e->ip_info.ip));
        }
    }
}

namespace wifi_sta
{
    esp_err_t init()
    {
        esp_err_t err = nvs_flash_init();
        if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND)
        {
            ESP_LOGW(TAG, "nvs unusable, erasing it");
            if ((err = nvs_flash_erase()) != ESP_OK)
                return err;
            err = nvs_flash_init();
        }
        if (err != ESP_OK)
            return err;

        if ((err = esp_netif_init()) != ESP_OK)
            return err;

        err = esp_event_loop_create_default();
        if (err != ESP_OK && err != ESP_ERR_INVALID_STATE)
            return err;

        esp_netif_create_default_wifi_sta();

        wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
        if ((err = esp_wifi_init(&cfg)) != ESP_OK)
            return err;
        if ((err = esp_wifi_set_storage(WIFI_STORAGE_FLASH)) != ESP_OK)
            return err;
        if ((err = esp_wifi_set_mode(WIFI_MODE_STA)) != ESP_OK)
            return err;

        if ((err = esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &on_event, nullptr)) != ESP_OK)
            return err;
        if ((err = esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &on_event, nullptr)) != ESP_OK)
            return err;

        esp_timer_create_args_t targs = {};
        targs.callback = &retry_cb;
        targs.arg = nullptr;
        targs.dispatch_method = ESP_TIMER_TASK;
        targs.name = "wifi_retry";
        targs.skip_unhandled_events = true;
        return esp_timer_create(&targs, &s_retry_timer);
    }

    bool has_credentials()
    {
        wifi_config_t cfg = {};
        if (esp_wifi_get_config(WIFI_IF_STA, &cfg) != ESP_OK)
            return false;
        return cfg.sta.ssid[0] != '\0';
    }

    esp_err_t connect()
    {
        if (!has_credentials())
        {
            ESP_LOGI(TAG, "no stored credentials, staying offline");
            return ESP_OK;
        }
        return esp_wifi_start();
    }

    bool is_connected()
    {
        return s_connected;
    }

    esp_err_t set_credentials(const char* ssid, const char* password)
    {
        if (ssid == nullptr || password == nullptr)
            return ESP_ERR_INVALID_ARG;

        wifi_config_t cfg = {};
        const size_t ssid_len = std::strlen(ssid);
        const size_t pass_len = std::strlen(password);
        if (ssid_len == 0 || ssid_len >= sizeof(cfg.sta.ssid))
            return ESP_ERR_INVALID_ARG;
        if (pass_len >= sizeof(cfg.sta.password))
            return ESP_ERR_INVALID_ARG;

        std::snprintf(reinterpret_cast<char*>(cfg.sta.ssid), sizeof(cfg.sta.ssid), "%s", ssid);
        std::snprintf(reinterpret_cast<char*>(cfg.sta.password), sizeof(cfg.sta.password), "%s", password);

        esp_err_t err = esp_wifi_set_config(WIFI_IF_STA, &cfg);
        if (err != ESP_OK)
            return err;

        s_backoff_ms = BACKOFF_MIN_MS;
        if ((err = esp_wifi_start()) != ESP_OK)
            return err;

        esp_wifi_connect();
        return ESP_OK;
    }

    esp_err_t forget()
    {
        s_connected = false;
        return esp_wifi_restore();
    }
}
