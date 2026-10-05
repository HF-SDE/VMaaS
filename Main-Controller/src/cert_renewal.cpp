/**
 * @file cert_renewal.cpp
 * @brief See cert_renewal.h.
 */
#include "cert_renewal.h"

#include <algorithm>
#include <cstdlib>
#include <ctime>

#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "activation.h"
#include "config.h"
#include "purchase_task.h"
#include "renewal_policy.h"
#include "wifi_sta.h"

namespace
{
    constexpr const char* TAG = "CertRenewal";

    bool started = false;

    void wait_for_clock()
    {
        while (!wifi_sta::is_connected()) vTaskDelay(pdMS_TO_TICKS(1000));

        while (activation::sync_time(Config::broker_sntp_timeout_ms) != ESP_OK)
        {
            vTaskDelay(pdMS_TO_TICKS(Config::broker_clock_retry_ms));
        }
    }

    /// Store what renew() returned and restart into it, once no purchase is under way.
    void store_and_restart(const char* cert, const char* ca)
    {
        ESP_LOGI(TAG, "renewed certificate received; restarting once no purchase is under way");
        while (!purchase_task::idle()) vTaskDelay(pdMS_TO_TICKS(Config::cert_renewal_idle_poll_ms));

        if (activation::store_renewed(cert, ca) != ESP_OK) return;

        ESP_LOGW(TAG, "restarting into the renewed certificate");
        esp_restart();
    }

    uint32_t wait_until_due_ms(int64_t now, int64_t not_before, int64_t not_after)
    {
        const int64_t until_due_ms = vmaas::seconds_until_due(now, not_before, not_after) * 1000;
        return static_cast<uint32_t>(std::clamp<int64_t>(until_due_ms, Config::cert_renewal_min_wait_ms, Config::cert_renewal_check_ms));
    }

    /// One check. Returns how long to wait before the next.
    uint32_t check_once()
    {
        int64_t not_before = 0;
        int64_t not_after = 0;
        const esp_err_t err = activation::certificate_validity(not_before, not_after);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "cannot read the certificate's validity: %s", esp_err_to_name(err));
            return Config::cert_renewal_check_ms;
        }

        const int64_t now = static_cast<int64_t>(std::time(nullptr));
        const long long hours_left = static_cast<long long>((not_after - now) / 3600);

        if (!vmaas::should_renew(now, not_before, not_after))
        {
            const uint32_t wait_ms = wait_until_due_ms(now, not_before, not_after);
            ESP_LOGI(TAG, "certificate valid for %lld more hours; looking again in %u minutes", hours_left, static_cast<unsigned>(wait_ms / 60000));
            return wait_ms;
        }

        ESP_LOGW(TAG, "certificate has %lld hours left; renewing", hours_left);

        char* cert = static_cast<char*>(std::calloc(1, activation::RENEWED_CERT_MAX));
        char* ca = static_cast<char*>(std::calloc(1, activation::RENEWED_CA_MAX));
        if (cert == nullptr || ca == nullptr)
        {
            std::free(cert);
            std::free(ca);
            ESP_LOGE(TAG, "out of memory");
            return Config::cert_renewal_retry_ms;
        }

        const activation::RenewResult result = activation::renew(cert, ca);
        if (result == activation::RenewResult::Ok) store_and_restart(cert, ca);

        std::free(cert);
        std::free(ca);

        switch (result)
        {
            case activation::RenewResult::Ok:
                ESP_LOGE(TAG, "could not store the renewed certificate; asking again later");
                return Config::cert_renewal_retry_ms;
            case activation::RenewResult::Rejected:
                ESP_LOGE(TAG, "the platform refused the renewal; if the certificate expires the machine must be activated again");
                return Config::cert_renewal_check_ms;
            case activation::RenewResult::Unreachable:
            default:
                ESP_LOGW(TAG, "renewal did not get through; trying again later");
                return Config::cert_renewal_retry_ms;
        }
    }

    void renewal_task(void*)
    {
        wait_for_clock();

        while (true)
        {
            const uint32_t wait_ms = check_once();
            ESP_LOGD(TAG, "stack headroom: %u bytes", static_cast<unsigned>(uxTaskGetStackHighWaterMark(nullptr)));
            vTaskDelay(pdMS_TO_TICKS(wait_ms));
        }
    }
}

namespace cert_renewal
{
    esp_err_t start()
    {
        if (started) return ESP_OK;

        if (!activation::has_certificate())
        {
            ESP_LOGW(TAG, "not activated, nothing to renew");
            return ESP_ERR_INVALID_STATE;
        }

        if (xTaskCreate(renewal_task, "cert_renewal", Config::cert_renewal_task_stack, nullptr,
                        Config::cert_renewal_task_priority, nullptr) != pdPASS)
        {
            ESP_LOGE(TAG, "could not start the renewal task");
            return ESP_ERR_NO_MEM;
        }

        started = true;
        return ESP_OK;
    }
}
