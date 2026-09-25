/**
 * @file vend_sequencer.cpp
 * @brief The state machine. See vend_sequencer.h for the contract.
 */
#include "vend_sequencer.h"

namespace vmaas
{
    VendActions VendSequencer::run(uint8_t slot, uint32_t steps, uint32_t now_tick)
    {
        VendActions a;
        if (state_ != VendState::Idle) return a;

        state_ = VendState::Enabling;
        slot_ = slot;
        steps_ = steps;
        enabled_at_tick_ = now_tick;

        a.enable_pins = true;
        a.slot = slot;
        a.steps = steps;
        return a;
    }

    VendActions VendSequencer::stop()
    {
        if (state_ == VendState::Idle) return VendActions{};
        return finish(false);
    }

    VendActions VendSequencer::tick(uint32_t now_tick, bool step_done)
    {
        switch (state_)
        {
        case VendState::Idle:
            return VendActions{};

        case VendState::Enabling:
        {
            if (now_tick - enabled_at_tick_ < ENABLE_SETTLE_TICKS) return VendActions{};
            state_ = VendState::Stepping;
            VendActions a;
            a.start_steps = true;
            a.slot = slot_;
            a.steps = steps_;
            return a;
        }

        case VendState::Stepping:
            if (!step_done) return VendActions{};
            return finish(true);
        }
        return VendActions{};
    }

    // Shared tail of a completed and an interrupted vend: the generator is
    // stopped (harmless if it never started), the drivers are disabled, and
    // only a completed vend earns a DONE.
    VendActions VendSequencer::finish(bool with_done)
    {
        VendActions a;
        a.stop_steps = true;
        a.disable_pins = true;
        a.send_done = with_done;
        a.slot = slot_;
        a.steps = steps_;

        state_ = VendState::Idle;
        slot_ = 0;
        steps_ = 0;
        return a;
    }
}
