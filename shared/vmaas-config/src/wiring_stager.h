#pragma once
/**
 * @file wiring_stager.h
 * @brief Collects a WIRING_BEGIN / WIRING_SLOT* / WIRING_COMMIT transfer into
 *        a SlotConfig. Hardware-free; the caller validates the result with
 *        parse_slot_config() after serialising it.
 */
#include <cstddef>
#include <cstdint>
#include "slot_config.h"

namespace vmaas
{
    /// @brief Collects one WIRING_BEGIN/SLOT*/COMMIT transfer; hardware-free.
    class WiringStager
    {
    public:
        /// Staging is discarded this long after the last wiring frame.
        static constexpr uint32_t TIMEOUT_MS = 10000;

        enum class Result : uint8_t
        {
            Ok,
            NotBegun,      ///< No WIRING_BEGIN, or the staging expired.
            Full,          ///< More than MAX_SLOTS slots, or pin_count > MAX_PINS_PER_SLOT.
            CountMismatch, ///< COMMIT's count differs from the slots staged; staging is kept.
            BadSteps,      ///< steps_per_vend outside STEPS_PER_VEND_MIN..MAX; staging is kept.
        };

        /// @brief Start a transfer: clears any prior staging and records the deadline.
        void begin(uint32_t now_ms);
        /// @brief Stage one slot's row.
        Result add_slot(uint8_t slot, const uint8_t* pins, uint8_t pin_count, uint32_t now_ms);
        /// On Ok, @p out holds the table and staging is cleared.
        Result commit(uint8_t count, uint16_t steps_per_vend, uint32_t now_ms, SlotConfig& out);
        /// Call every loop pass; expires the staging after TIMEOUT_MS of silence.
        void tick(uint32_t now_ms);
        bool active() const { return active_; }
        /// @brief Discard any staged rows and leave the transfer inactive.
        void reset();

    private:
        bool active_ = false;
        uint32_t last_frame_ms_ = 0;
        SlotConfig staged_{};
    };
}
