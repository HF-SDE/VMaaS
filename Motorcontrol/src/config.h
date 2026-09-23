#pragma once
/**
 * @file config.h
 * @brief Compile-time settings for the Motorcontrol firmware.
 */
#include <cstdint>

/// Motorcontrol configuration.
namespace Config
{
    /// Full STEP period in microseconds; half of it is the gptimer alarm.
    /// 312 us x 6400 steps = 2.0 s per revolution of a 200-step motor at 1/32
    /// microstepping. DRV8825 needs at least 1.9 us high and low; we give 156.
    ///
    /// Raising this slows every vend on this board. Main-Controller's
    /// `timings.dispense_timeout_ms` (default 30 s) must stay above
    /// stepsPerVend x STEP_INTERVAL_US for the largest stepsPerVend the admin
    /// UI allows (65535), so raise that too.
    constexpr uint32_t STEP_INTERVAL_US = 312;
}
