/**
 * @file command_handler.cpp
 * @brief CommandHandler request execution and motor timing. See command_handler.h.
 */
#include "command_handler.h"
#include "esp_log.h"
#include "freertos/task.h"

using namespace vmaas;

namespace
{
    constexpr const char* TAG = "CmdHandler";
}

CommandHandler::CommandHandler(UartBus& bus, const SlotPin* slots, size_t count)
    : bus_(bus), slots_(slots), slot_count_(count)
{
}

void CommandHandler::begin()
{
    for (size_t i = 0; i < slot_count_; ++i)
    {
        gpio_reset_pin(slots_[i].pin);
        gpio_set_level(slots_[i].pin, 0);
        gpio_set_direction(slots_[i].pin, GPIO_MODE_OUTPUT);
        gpio_set_level(slots_[i].pin, 0);
    }
    bus_.on_frame([this](const Frame& f) { handle(f); });
    ESP_LOGI(TAG, "ready, %u slots, run_time=%u ms", (unsigned)slot_count_, run_time_ms_);
}

void CommandHandler::tick()
{
    if (state_ != State::BUSY)
        return;
    const TickType_t elapsed = xTaskGetTickCount() - run_started_;
    if (elapsed < pdMS_TO_TICKS(run_time_ms_))
        return;

    set_motor(current_pin_, false);
    const uint8_t finished = current_slot_;
    state_ = State::IDLE;
    current_slot_ = 0;
    current_pin_ = GPIO_NUM_NC;
    bus_.send(frames::done(finished));
    ESP_LOGI(TAG, "slot %u done", finished);
}

void CommandHandler::handle(const Frame& f)
{
    if (is_reply(f.cmd))
    {
        ESP_LOGW(TAG, "ignoring reply-type frame 0x%02X", (unsigned)f.cmd);
        return;
    }

    switch (f.cmd)
    {
    case Cmd::RUN:    handle_run(f);    break;
    case Cmd::STOP:   handle_stop(f);   break;
    case Cmd::STATUS: handle_status(f); break;
    case Cmd::CONFIG: handle_config(f); break;
    default:
        ESP_LOGW(TAG, "unknown cmd 0x%02X", (unsigned)f.cmd);
        bus_.send(frames::nak(f.cmd, ErrorCode::UNKNOWN_CMD));
        break;
    }
}

void CommandHandler::handle_run(const Frame& f)
{
    if (f.len != 1)
    {
        ESP_LOGW(TAG, "RUN with bad len=%u", f.len);
        bus_.send(frames::nak(Cmd::RUN, ErrorCode::BAD_PAYLOAD));
        return;
    }
    // OWNER DECISION 2: policy when a RUN arrives while another is active.
    // Current policy: reject. Alternative: queue it and start after DONE.
    if (state_ == State::BUSY)
    {
        ESP_LOGW(TAG, "RUN %u rejected: busy with slot %u", f.payload[0], current_slot_);
        bus_.send(frames::nak(Cmd::RUN, ErrorCode::BUSY));
        return;
    }
    const uint8_t slot = f.payload[0];
    const gpio_num_t pin = pin_for(slot);
    if (pin == GPIO_NUM_NC)
    {
        ESP_LOGW(TAG, "RUN %u rejected: unknown slot", slot);
        bus_.send(frames::nak(Cmd::RUN, ErrorCode::UNKNOWN_SLOT));
        return;
    }

    bus_.send(frames::ack(Cmd::RUN));
    state_ = State::BUSY;
    current_slot_ = slot;
    current_pin_ = pin;
    run_started_ = xTaskGetTickCount();
    set_motor(pin, true);
    ESP_LOGI(TAG, "slot %u running on GPIO %d for %u ms", slot, (int)pin, run_time_ms_);
}

void CommandHandler::handle_stop(const Frame& f)
{
    if (f.len != 0)
    {
        ESP_LOGW(TAG, "STOP with bad len=%u", f.len);
        bus_.send(frames::nak(Cmd::STOP, ErrorCode::BAD_PAYLOAD));
        return;
    }
    if (state_ == State::BUSY)
    {
        set_motor(current_pin_, false);
        ESP_LOGI(TAG, "slot %u stopped by request", current_slot_);
        state_ = State::IDLE;
        current_slot_ = 0;
        current_pin_ = GPIO_NUM_NC;
    }
    bus_.send(frames::ack(Cmd::STOP));
}

void CommandHandler::handle_status(const Frame& f)
{
    if (f.len != 0)
    {
        ESP_LOGW(TAG, "STATUS with bad len=%u", f.len);
        bus_.send(frames::nak(Cmd::STATUS, ErrorCode::BAD_PAYLOAD));
        return;
    }
    bus_.send(frames::status_reply(state_, current_slot_));
}

void CommandHandler::handle_config(const Frame& f)
{
    if (f.len != 3)
    {
        ESP_LOGW(TAG, "CONFIG with bad len=%u", f.len);
        bus_.send(frames::nak(Cmd::CONFIG, ErrorCode::BAD_PAYLOAD));
        return;
    }
    const uint16_t value = static_cast<uint16_t>(f.payload[1] | (f.payload[2] << 8));
    switch (static_cast<ConfigParam>(f.payload[0]))
    {
    case ConfigParam::RUN_TIME_MS:
        run_time_ms_ = value;
        ESP_LOGI(TAG, "run_time set to %u ms", run_time_ms_);
        bus_.send(frames::ack(Cmd::CONFIG));
        break;
    default:
        ESP_LOGW(TAG, "CONFIG with unknown param %u", f.payload[0]);
        bus_.send(frames::nak(Cmd::CONFIG, ErrorCode::BAD_PARAM));
        break;
    }
}

gpio_num_t CommandHandler::pin_for(uint8_t slot) const
{
    for (size_t i = 0; i < slot_count_; ++i)
        if (slots_[i].slot == slot)
            return slots_[i].pin;
    return GPIO_NUM_NC;
}

void CommandHandler::set_motor(gpio_num_t pin, bool on)
{
    if (pin != GPIO_NUM_NC)
        gpio_set_level(pin, on ? 1 : 0);
}
