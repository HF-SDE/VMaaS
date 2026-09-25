/**
 * @file config_error_responder.cpp
 * @brief ConfigErrorResponder request handling. See config_error_responder.h.
 */
#include "config_error_responder.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "wiring_commit.h"

using namespace vmaas;

namespace
{
    constexpr const char* TAG = "ConfigError";

    // Payload length each fixed-length request must carry, mirroring
    // CommandHandler so a malformed frame gets the same BAD_PAYLOAD answer
    // in both states. WIRING_SLOT is variable-length and checked separately.
    bool expected_len(Cmd cmd, uint8_t& len)
    {
        switch (cmd)
        {
        case Cmd::RUN:           len = 1; return true;
        case Cmd::STOP:          len = 0; return true;
        case Cmd::STATUS:        len = 0; return true;
        case Cmd::CONFIG:        len = 3; return true;
        case Cmd::WIRING_BEGIN:  len = 0; return true;
        case Cmd::WIRING_COMMIT: len = 3; return true;
        default:                 return false;
        }
    }
}

ConfigErrorResponder::ConfigErrorResponder(UartBus& bus) : bus_(bus) {}

void ConfigErrorResponder::begin()
{
    bus_.on_frame([this](const Frame& f) { handle(f); });
    ESP_LOGW(TAG, "no valid slot configuration: refusing RUN/STOP/CONFIG, accepting WIRING_*, reporting State::ERROR");
}

void ConfigErrorResponder::tick()
{
    stager_.tick(now_ms());
}

uint32_t ConfigErrorResponder::now_ms() const
{
    return static_cast<uint32_t>(esp_timer_get_time() / 1000);
}

void ConfigErrorResponder::handle(const Frame& f)
{
    if (is_reply(f.cmd))
    {
        ESP_LOGW(TAG, "ignoring reply-type frame 0x%02X", (unsigned)f.cmd);
        return;
    }

    if (f.cmd == Cmd::WIRING_SLOT)
    {
        handle_wiring_slot(f);
        return;
    }

    uint8_t len = 0;
    if (!expected_len(f.cmd, len))
    {
        bus_.send(frames::nak(f.cmd, ErrorCode::UNKNOWN_CMD));
        return;
    }
    if (f.len != len)
    {
        bus_.send(frames::nak(f.cmd, ErrorCode::BAD_PAYLOAD));
        return;
    }
    if (f.cmd == Cmd::STATUS)
    {
        bus_.send(frames::status_reply(State::ERROR, 0));
        return;
    }
    if (f.cmd == Cmd::WIRING_BEGIN)
    {
        handle_wiring_begin(f);
        return;
    }
    if (f.cmd == Cmd::WIRING_COMMIT)
    {
        handle_wiring_commit(f);
        return;
    }

    ESP_LOGW(TAG, "refusing cmd 0x%02X: no valid slot configuration", (unsigned)f.cmd);
    bus_.send(frames::nak(f.cmd, ErrorCode::CONFIG_ERROR));
}

void ConfigErrorResponder::handle_wiring_begin(const Frame&)
{
    stager_.begin(now_ms());
    bus_.send(frames::ack(Cmd::WIRING_BEGIN));
}

void ConfigErrorResponder::handle_wiring_slot(const Frame& f)
{
    if (f.len < 2 || f.len != 2 + f.payload[1]) { bus_.send(frames::nak(Cmd::WIRING_SLOT, ErrorCode::BAD_PAYLOAD)); return; }
    const WiringStager::Result result = stager_.add_slot(f.payload[0], &f.payload[2], f.payload[1], now_ms());
    if (result == WiringStager::Result::Ok) { bus_.send(frames::ack(Cmd::WIRING_SLOT)); return; }
    bus_.send(frames::nak(Cmd::WIRING_SLOT, wiring_commit::nak_for(result)));
}

void ConfigErrorResponder::handle_wiring_commit(const Frame& f)
{
    const uint16_t steps = static_cast<uint16_t>(f.payload[1] | (f.payload[2] << 8));
    SlotConfig staged{};
    const WiringStager::Result result = stager_.commit(f.payload[0], steps, now_ms(), staged);
    if (result != WiringStager::Result::Ok)
    {
        ESP_LOGW(TAG, "WIRING_COMMIT refused: staging result %u", (unsigned)result);
        bus_.send(frames::nak(Cmd::WIRING_COMMIT, wiring_commit::nak_for(result)));
        return;
    }

    SlotConfig applied{};
    char reason[40];
    if (!wiring_commit::commit_wiring(staged, applied, reason, sizeof(reason)))
    {
        ESP_LOGW(TAG, "WIRING_COMMIT failed: %s; keeping the running table", reason);
        bus_.send(frames::nak(Cmd::WIRING_COMMIT, ErrorCode::WRITE_FAILED));
        return;
    }

    ESP_LOGI(TAG, "new wiring written; restarting into it");
    bus_.send(frames::ack(Cmd::WIRING_COMMIT));
    vTaskDelay(pdMS_TO_TICKS(50));
    esp_restart();
}
