/**
 * @file command_handler.cpp
 * @brief CommandHandler request execution. See command_handler.h.
 */
#include "command_handler.h"
#include "config_store.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/task.h"
#include "wiring_commit.h"

using namespace vmaas;

namespace
{
    constexpr const char* TAG = "CmdHandler";
}

CommandHandler::CommandHandler(UartBus& bus, const SlotConfig& cfg, IStepGenerator& gen)
    : bus_(bus), cfg_(cfg), gen_(gen)
{
}

void CommandHandler::begin()
{
    for (size_t i = 0; i < cfg_.slot_count; ++i)
    {
        const SlotEntry& e = cfg_.slots[i];
        for (size_t k = 0; k < e.pin_count; ++k)
        {
            config_store::raise_enable_pin(static_cast<gpio_num_t>(e.pins[k]));
        }
    }
    bus_.on_frame([this](const Frame& f) { handle(f); });
    ESP_LOGI(TAG, "ready, %u slots, %u steps per vend", (unsigned)cfg_.slot_count, (unsigned)cfg_.steps_per_vend);
}

void CommandHandler::tick()
{
    stager_.tick(now_ms());
    if (seq_.state() == VendState::Idle) return;
    act(seq_.tick(xTaskGetTickCount(), gen_.done()));
}

State CommandHandler::state() const
{
    return seq_.state() == VendState::Idle ? State::IDLE : State::BUSY;
}

uint32_t CommandHandler::now_ms() const
{
    return static_cast<uint32_t>(esp_timer_get_time() / 1000);
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
    case Cmd::RUN:           handle_run(f);           break;
    case Cmd::STOP:          handle_stop(f);          break;
    case Cmd::STATUS:        handle_status(f);        break;
    case Cmd::CONFIG:        handle_config(f);        break;
    case Cmd::WIRING_BEGIN:  handle_wiring_begin(f);  break;
    case Cmd::WIRING_SLOT:   handle_wiring_slot(f);   break;
    case Cmd::WIRING_COMMIT: handle_wiring_commit(f); break;
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

    if (seq_.state() != VendState::Idle)
    {
        ESP_LOGW(TAG, "RUN %u rejected: busy with slot %u", f.payload[0], seq_.current_slot());
        bus_.send(frames::nak(Cmd::RUN, ErrorCode::BUSY));
        return;
    }
    const uint8_t slot = f.payload[0];
    const SlotEntry* e = entry_for(slot);
    if (e == nullptr)
    {
        ESP_LOGW(TAG, "RUN %u rejected: unknown slot", slot);
        bus_.send(frames::nak(Cmd::RUN, ErrorCode::UNKNOWN_SLOT));
        return;
    }

    bus_.send(frames::ack(Cmd::RUN));
    act(seq_.run(slot, cfg_.steps_per_vend, xTaskGetTickCount()));
    ESP_LOGI(TAG, "slot %u: %u driver(s) enabled, %u steps to follow", slot, (unsigned)e->pin_count, (unsigned)cfg_.steps_per_vend);
}

void CommandHandler::handle_stop(const Frame& f)
{
    if (f.len != 0)
    {
        ESP_LOGW(TAG, "STOP with bad len=%u", f.len);
        bus_.send(frames::nak(Cmd::STOP, ErrorCode::BAD_PAYLOAD));
        return;
    }
    if (seq_.state() != VendState::Idle) {
        ESP_LOGI(TAG, "slot %u stopped by request", seq_.current_slot());
    }
    act(seq_.stop());
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
    bus_.send(frames::status_reply(state(), seq_.current_slot()));
}

void CommandHandler::handle_config(const Frame& f)
{
    if (f.len != 3)
    {
        ESP_LOGW(TAG, "CONFIG with bad len=%u", f.len);
        bus_.send(frames::nak(Cmd::CONFIG, ErrorCode::BAD_PAYLOAD));
        return;
    }

    ESP_LOGW(TAG, "CONFIG with unknown param %u", f.payload[0]);
    bus_.send(frames::nak(Cmd::CONFIG, ErrorCode::BAD_PARAM));
}

void CommandHandler::handle_wiring_begin(const Frame& f)
{
    if (f.len != 0) { bus_.send(frames::nak(Cmd::WIRING_BEGIN, ErrorCode::BAD_PAYLOAD)); return; }
    stager_.begin(now_ms());
    bus_.send(frames::ack(Cmd::WIRING_BEGIN));
}

void CommandHandler::handle_wiring_slot(const Frame& f)
{
    if (f.len < 2 || f.len != 2 + f.payload[1]) { bus_.send(frames::nak(Cmd::WIRING_SLOT, ErrorCode::BAD_PAYLOAD)); return; }
    const WiringStager::Result result = stager_.add_slot(f.payload[0], &f.payload[2], f.payload[1], now_ms());
    if (result == WiringStager::Result::Ok) { bus_.send(frames::ack(Cmd::WIRING_SLOT)); return; }
    bus_.send(frames::nak(Cmd::WIRING_SLOT, wiring_commit::nak_for(result)));
}

void CommandHandler::handle_wiring_commit(const Frame& f)
{
    if (f.len != 3) { bus_.send(frames::nak(Cmd::WIRING_COMMIT, ErrorCode::BAD_PAYLOAD)); return; }
    if (seq_.state() != VendState::Idle)
    {
        ESP_LOGW(TAG, "WIRING_COMMIT refused: vend in progress on slot %u", seq_.current_slot());
        bus_.send(frames::nak(Cmd::WIRING_COMMIT, ErrorCode::BUSY));
        return;
    }
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
    apply_table(applied);
    bus_.send(frames::ack(Cmd::WIRING_COMMIT));
}

const SlotEntry* CommandHandler::entry_for(uint8_t slot) const
{
    for (size_t i = 0; i < cfg_.slot_count; ++i)
        if (cfg_.slots[i].slot == slot)
            return &cfg_.slots[i];
    return nullptr;
}

void CommandHandler::set_enabled(const SlotEntry& e, bool enabled)
{
    for (size_t k = 0; k < e.pin_count; ++k)
        gpio_set_level(static_cast<gpio_num_t>(e.pins[k]), enabled ? 0 : 1);
}

void CommandHandler::act(const VendActions& a)
{
    const SlotEntry* e = (a.enable_pins || a.disable_pins) ? entry_for(a.slot) : nullptr;

    if (a.stop_steps) gen_.stop();
    if (a.enable_pins && e != nullptr) set_enabled(*e, true);
    if (a.start_steps) gen_.start(a.steps);
    if (a.disable_pins && e != nullptr) set_enabled(*e, false);
    if (a.send_done)
    {
        bus_.send(frames::done(a.slot));
        ESP_LOGI(TAG, "slot %u done", a.slot);
    }
}

void CommandHandler::apply_table(const SlotConfig& next)
{
    for (size_t i = 0; i < next.slot_count; ++i)
        for (size_t k = 0; k < next.slots[i].pin_count; ++k)
            config_store::raise_enable_pin(static_cast<gpio_num_t>(next.slots[i].pins[k]));
    cfg_ = next;
    ESP_LOGI(TAG, "wiring applied: %u slots, %u steps per vend", (unsigned)cfg_.slot_count, (unsigned)cfg_.steps_per_vend);
}
