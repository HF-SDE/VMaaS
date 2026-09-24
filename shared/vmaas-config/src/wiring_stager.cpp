/**
 * @file wiring_stager.cpp
 * @brief WiringStager. See wiring_stager.h.
 */
#include "wiring_stager.h"

namespace vmaas
{
    void WiringStager::begin(uint32_t now_ms)
    {
        reset();
        active_ = true;
        last_frame_ms_ = now_ms;
    }

    WiringStager::Result WiringStager::add_slot(uint8_t slot, const uint8_t* pins, uint8_t pin_count, uint32_t now_ms)
    {
        if (!active_) return Result::NotBegun;
        last_frame_ms_ = now_ms;
        if (pin_count > MAX_PINS_PER_SLOT || staged_.slot_count >= MAX_SLOTS) return Result::Full;

        SlotEntry& e = staged_.slots[staged_.slot_count++];
        e.slot = slot;
        e.pin_count = pin_count;
        for (uint8_t i = 0; i < pin_count; ++i) e.pins[i] = pins[i];
        for (uint8_t i = pin_count; i < MAX_PINS_PER_SLOT; ++i) e.pins[i] = 0;
        return Result::Ok;
    }

    WiringStager::Result WiringStager::commit(uint8_t count, uint16_t steps_per_vend, uint32_t now_ms, SlotConfig& out)
    {
        if (!active_) return Result::NotBegun;
        last_frame_ms_ = now_ms;
        if (count != staged_.slot_count) return Result::CountMismatch;
        if (steps_per_vend < STEPS_PER_VEND_MIN || steps_per_vend > STEPS_PER_VEND_MAX) return Result::BadSteps;

        staged_.steps_per_vend = steps_per_vend;
        out = staged_;
        reset();
        return Result::Ok;
    }

    void WiringStager::tick(uint32_t now_ms)
    {
        if (active_ && now_ms - last_frame_ms_ >= TIMEOUT_MS) reset();
    }

    void WiringStager::reset()
    {
        active_ = false;
        staged_ = SlotConfig{};
    }
}
