/**
 * @file config_error_responder.cpp
 * @brief ConfigErrorResponder request handling. See config_error_responder.h.
 */
#include "config_error_responder.h"
#include "esp_log.h"

using namespace vmaas;

namespace
{
    constexpr const char* TAG = "ConfigError";

    // Payload length each request must carry, mirroring CommandHandler so a
    // malformed frame gets the same BAD_PAYLOAD answer in both states.
    bool expected_len(Cmd cmd, uint8_t& len)
    {
        switch (cmd)
        {
        case Cmd::RUN:    len = 1; return true;
        case Cmd::STOP:   len = 0; return true;
        case Cmd::STATUS: len = 0; return true;
        case Cmd::CONFIG: len = 3; return true;
        default:          return false;
        }
    }
}

ConfigErrorResponder::ConfigErrorResponder(UartBus& bus) : bus_(bus) {}

void ConfigErrorResponder::begin()
{
    bus_.on_frame([this](const Frame& f) { handle(f); });
    ESP_LOGW(TAG, "no valid slot configuration: refusing RUN/STOP/CONFIG, reporting State::ERROR");
}

void ConfigErrorResponder::handle(const Frame& f)
{
    if (is_reply(f.cmd))
    {
        ESP_LOGW(TAG, "ignoring reply-type frame 0x%02X", (unsigned)f.cmd);
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
    ESP_LOGW(TAG, "refusing cmd 0x%02X: no valid slot configuration", (unsigned)f.cmd);
    bus_.send(frames::nak(f.cmd, ErrorCode::CONFIG_ERROR));
}
