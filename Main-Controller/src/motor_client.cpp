/**
 * @file motor_client.cpp
 * @brief MotorClient request sending and reply dispatch. See motor_client.h.
 */
#include "motor_client.h"
#include "esp_log.h"

using namespace vmaas;

namespace
{
    constexpr const char* TAG = "MotorClient";
}

MotorClient::MotorClient(UartBus& bus) : bus_(bus) {}

void MotorClient::begin()
{
    bus_.on_frame([this](const Frame& f) { handle(f); });
}

bool MotorClient::run(uint8_t slot)
{
    return bus_.send(frames::run(slot));
}

bool MotorClient::stop()
{
    return bus_.send(frames::stop());
}

bool MotorClient::request_status()
{
    return bus_.send(frames::status());
}

bool MotorClient::send(const Frame& f)
{
    return bus_.send(f);
}

void MotorClient::handle(const Frame& f)
{
    if (!is_reply(f.cmd))
    {
        ESP_LOGW(TAG, "ignoring request-type frame 0x%02X from Motorcontrol", (unsigned)f.cmd);
        return;
    }
    switch (f.cmd)
    {
    case Cmd::ACK:
        if (f.len != 1)
        {
            ESP_LOGW(TAG, "ACK with bad len=%u, ignored", f.len);
            break;
        }
        if (on_ack_)
            on_ack_(static_cast<Cmd>(f.payload[0]));
        break;
    case Cmd::NAK:
        if (f.len != 2)
        {
            ESP_LOGW(TAG, "NAK with bad len=%u, ignored", f.len);
            break;
        }
        if (on_nak_)
            on_nak_(static_cast<Cmd>(f.payload[0]), static_cast<ErrorCode>(f.payload[1]));
        break;
    case Cmd::DONE:
        if (f.len != 1)
        {
            ESP_LOGW(TAG, "DONE with bad len=%u, ignored", f.len);
            break;
        }
        if (on_done_)
            on_done_(f.payload[0]);
        break;
    case Cmd::STATUS_REPLY:
        if (f.len != 2)
        {
            ESP_LOGW(TAG, "STATUS_REPLY with bad len=%u, ignored", f.len);
            break;
        }
        if (on_status_)
            on_status_(static_cast<State>(f.payload[0]), f.payload[1]);
        break;
    default:
        ESP_LOGW(TAG, "unexpected reply 0x%02X len=%u", (unsigned)f.cmd, f.len);
        break;
    }
}
