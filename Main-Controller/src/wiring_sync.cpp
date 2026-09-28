/**
 * @file wiring_sync.cpp
 * @brief See wiring_sync.h.
 */
#include "wiring_sync.h"

#include <cstdio>
#include <cstring>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "config.h"
#include "prices.h"
#include "purchase_task.h"
#include "slot_config_parser.h"
#include "wiring_sender.h"

namespace
{
    constexpr const char *TAG = "wiring_sync";
    using wiring_sync::WIRING_JSON_MAX;

    MotorClient *motor_ = nullptr;
    vmaas::WiringSender sender;

    portMUX_TYPE lock = portMUX_INITIALIZER_UNLOCKED;
    // Guarded by `lock`: written by request() from any task.
    bool pending_ = false;
    bool pending_new_config_ = false;
    bool in_flight_ = false;
    TickType_t last_error_request_ = 0;
    bool error_requested_once_ = false;

    // Main task only.
    bool in_flight_new_config_ = false;
    /// A transfer that failed for a reason that can pass (no reply, BUSY) is
    /// tried again at retry_at_ms_. Without this a Boot send that lost the
    /// race with Motorcontrol's own boot would never repair a board that has
    /// a valid but wrong config.json, since such a board never reports ERROR.
    bool retry_armed_ = false;
    uint32_t retry_at_ms_ = 0;

    // Handed to config_sync: written under `lock`, then `result_ready` given.
    SemaphoreHandle_t result_ready = nullptr;
    wiring_sync::Outcome result_ = wiring_sync::Outcome::Pending;
    char result_detail_[64] = {};

    char wiring_json[WIRING_JSON_MAX];

    const char *failure_text(const vmaas::WiringStep &s, char *buf, size_t len)
    {
        switch (s.failure)
        {
            case vmaas::WiringFailure::BadTable:
                std::snprintf(buf, len, "wiring rejected (unsendable table)");
                break;
            case vmaas::WiringFailure::NoReply:
                std::snprintf(buf, len, "wiring rejected (no reply)");
                break;
            case vmaas::WiringFailure::Nak:
                std::snprintf(buf, len, "wiring rejected (nak %u)", static_cast<unsigned>(s.nak));
                break;
            default:
                std::snprintf(buf, len, "wiring rejected");
                break;
        }
        return buf;
    }

    /// Main task. Ends the in-flight transfer and hands the outcome to a waiter.
    void finish(wiring_sync::Outcome outcome, const char *detail)
    {
        taskENTER_CRITICAL(&lock);
        in_flight_ = false;
        taskEXIT_CRITICAL(&lock);

        if (outcome == wiring_sync::Outcome::Applied) {
            ESP_LOGI(TAG, "wiring transfer finished: %s", detail);
        }
        else {
            ESP_LOGE(TAG, "%s", detail);
        }

        if (!in_flight_new_config_) return;
        in_flight_new_config_ = false;

        // Format outside the critical section (interrupts are off inside it),
        // copy the finished bytes in under it.
        char local[sizeof(result_detail_)];
        std::snprintf(local, sizeof(local), "%s", detail);
        taskENTER_CRITICAL(&lock);
        result_ = outcome;
        std::memcpy(result_detail_, local, sizeof(local));
        taskEXIT_CRITICAL(&lock);
        xSemaphoreGive(result_ready);
    }

    /// Main task. Sends what the sender asks for and handles its end states.
    void apply(const vmaas::WiringStep &s)
    {
        switch (s.kind)
        {
            case vmaas::WiringStep::Kind::Send:
                if (!motor_->send(s.frame)) {
                    ESP_LOGW(TAG, "could not write cmd 0x%02X; the reply timeout will retry", static_cast<unsigned>(s.frame.cmd));
                }
                break;
            case vmaas::WiringStep::Kind::Done:
                finish(wiring_sync::Outcome::Applied, "Motorcontrol took the table");
                break;
            case vmaas::WiringStep::Kind::Failed:
            {
                char buf[48];
                finish(wiring_sync::Outcome::Rejected, failure_text(s, buf, sizeof(buf)));
                // Only failures that can pass are retried: a table Motorcontrol
                // refuses on its merits (WRITE_FAILED, BAD_PAYLOAD, ...) would be
                // refused again every time.
                const bool transient = s.failure == vmaas::WiringFailure::NoReply || (s.failure == vmaas::WiringFailure::Nak && s.nak == vmaas::ErrorCode::BUSY);
                if (transient)
                {
                    retry_armed_ = true;
                    retry_at_ms_ = static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS) + Config::wiring_retry_ms;
                    ESP_LOGW(TAG, "retrying the wiring in %lu ms", static_cast<unsigned long>(Config::wiring_retry_ms));
                }
                break;
            }
            case vmaas::WiringStep::Kind::Wait:
                break;
        }
    }

    /// Main task. Reads, validates and converts the cached table, then starts.
    void start_transfer(uint32_t now_ms)
    {
        if (!prices::read_wiring(wiring_json, sizeof(wiring_json)))
        {
            if (in_flight_new_config_)
            {
                finish(wiring_sync::Outcome::Rejected, "wiring unreadable or too large");
                return;
            }
            ESP_LOGI(TAG, "no published wiring cached; Motorcontrol keeps its own config.json");
            finish(wiring_sync::Outcome::Applied, "no wiring");
            return;
        }

        static vmaas::SlotParseResult parsed;
        parsed = vmaas::parse_slot_config(wiring_json);
        if (!parsed.ok)
        {
            finish(wiring_sync::Outcome::Rejected, "wiring invalid");
            return;
        }

        static vmaas::WiringTable table;
        table = {};
        table.steps_per_vend = parsed.config.steps_per_vend;
        table.row_count = static_cast<uint8_t>(parsed.config.slot_count);
        for (size_t i = 0; i < parsed.config.slot_count; ++i)
        {
            const vmaas::SlotEntry &e = parsed.config.slots[i];
            table.rows[i].slot = e.slot;
            table.rows[i].pin_count = e.pin_count;
            for (uint8_t p = 0; p < e.pin_count; ++p) table.rows[i].pins[p] = e.pins[p];
        }

        ESP_LOGI(TAG, "sending wiring: %u slots, %u steps per vend",
                 static_cast<unsigned>(table.row_count), static_cast<unsigned>(table.steps_per_vend));
        apply(sender.start(table, now_ms));
    }
}

namespace wiring_sync
{
    void begin(MotorClient &motor)
    {
        motor_ = &motor;
        if (result_ready == nullptr) result_ready = xSemaphoreCreateBinary();
    }

    void request(Source source)
    {
        const TickType_t now = xTaskGetTickCount();

        if (source == Source::NewConfig && result_ready != nullptr) {
            xSemaphoreTake(result_ready, 0);
        }

        taskENTER_CRITICAL(&lock);
        bool accepted = true;
        if (source == Source::MotorError)
        {
            const bool too_soon = error_requested_once_ && (now - last_error_request_) < pdMS_TO_TICKS(Config::wiring_error_request_gap_ms);
            accepted = !pending_ && !in_flight_ && !too_soon;
            if (accepted)
            {
                last_error_request_ = now;
                error_requested_once_ = true;
            }
        }
        if (accepted)
        {
            pending_ = true;
            if (source == Source::NewConfig) pending_new_config_ = true;
        }
        taskEXIT_CRITICAL(&lock);

        if (accepted) {
            ESP_LOGI(TAG, "wiring requested (%s)", source == Source::Boot ? "boot" : source == Source::NewConfig ? "new configuration" : "Motorcontrol in config error");
        }
    }

    void tick(uint32_t now_ms)
    {
        if (motor_ == nullptr) return;

        if (sender.busy())
        {
            apply(sender.tick(now_ms));
            return;
        }

        const bool idle = purchase_task::idle();
        bool start = false;
        taskENTER_CRITICAL(&lock);
        if (retry_armed_ && static_cast<int32_t>(now_ms - retry_at_ms_) >= 0)
        {
            retry_armed_ = false;
            pending_ = true;
        }
        if (pending_ && !in_flight_ && idle)
        {
            retry_armed_ = false;
            pending_ = false;
            in_flight_ = true;
            in_flight_new_config_ = pending_new_config_;
            pending_new_config_ = false;
            start = true;
        }
        taskEXIT_CRITICAL(&lock);

        if (start) start_transfer(now_ms);
    }

    bool handles(vmaas::Cmd cmd)
    {
        return cmd == vmaas::Cmd::WIRING_BEGIN || cmd == vmaas::Cmd::WIRING_SLOT || cmd == vmaas::Cmd::WIRING_COMMIT;
    }

    void on_ack(vmaas::Cmd cmd, uint32_t now_ms)
    {
        apply(sender.on_ack(cmd, now_ms));
    }

    void on_nak(vmaas::Cmd cmd, vmaas::ErrorCode err, uint32_t now_ms)
    {
        ESP_LOGW(TAG, "NAK for cmd 0x%02X, error %u (attempt %u of %u)", static_cast<unsigned>(cmd),
                 static_cast<unsigned>(err), static_cast<unsigned>(sender.attempt()),
                 static_cast<unsigned>(vmaas::WiringSender::MAX_ATTEMPTS));
        apply(sender.on_nak(cmd, err, now_ms));
    }

    Outcome wait_for_result(uint32_t timeout_ms, char *detail, size_t detail_len)
    {
        if (xSemaphoreTake(result_ready, pdMS_TO_TICKS(timeout_ms)) != pdTRUE)
        {
            std::snprintf(detail, detail_len, "wiring pending, machine busy");
            return Outcome::Pending;
        }

        char local[sizeof(result_detail_)];
        taskENTER_CRITICAL(&lock);
        const Outcome o = result_;
        std::memcpy(local, result_detail_, sizeof(local));
        taskEXIT_CRITICAL(&lock);
        std::snprintf(detail, detail_len, "%s", local);
        return o;
    }
}
