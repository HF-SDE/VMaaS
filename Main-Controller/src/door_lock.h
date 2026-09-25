#pragma once
/**
 * @file door_lock.h
 * @brief The front door's solenoid lock, switched through a 12 V relay.
 *
 * Fail-secure: the solenoid is released only while the relay is energised, so
 * the locked state is the unpowered state. A reset, a brown-out and the moment
 * before begin() runs all leave the door locked, and that is deliberate.
 *
 * The pulse is ended by a one-shot esp_timer rather than by the main loop,
 * because the loop can be held up for tens of milliseconds by bus.poll() and
 * far longer by onboarding. A pulse-to-release coil must not stay energised
 * because a loop was late.
 *
 * A second pulse() call restarts the timer rather than stacking a new one,
 * and the release callback trusts a deadline rather than "I was called, so
 * lock" - esp_timer_stop() cannot cancel a callback that has already been
 * dispatched to the timer task, so without the deadline check a pulse that
 * lands right as the previous one's timer fires could be cut short instead
 * of extended. See door_lock.cpp for the full race.
 */
#include <cstdint>
#include "esp_err.h"

/// The front door lock relay.
namespace door_lock
{
    /**
     * @brief Put the relay in the locked state and create the release timer.
     *
     * Sets the pin's level before its direction, so configuring the output
     * cannot flick the door open. Call once from app_main.
     */
    esp_err_t begin();

    /**
     * @brief Release the lock for @p ms milliseconds.
     *
     * @param ms Pulse length, clamped to [Config::door_unlock_min_ms,
     *           Config::door_unlock_max_ms].
     * @return ESP_OK when the relay was energised and the timer armed.
     *
     * Calling this while a pulse is running restarts the timer rather than
     * stacking a second one, so holding the key down cannot extend the pulse
     * without bound.
     */
    esp_err_t pulse(uint32_t ms);

    /// @return true while the relay is energised.
    bool is_released();
}
