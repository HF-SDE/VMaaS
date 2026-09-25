/**
 * @file door_lock.cpp
 * @brief GPIO and timer driving the front door lock relay.
 */
#include "door_lock.h"

#include "freertos/FreeRTOS.h"

#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"

#include "config.h"
#include "pins.h"

namespace
{
    constexpr const char* TAG = "DoorLock";

    esp_timer_handle_t release_timer = nullptr;

    /**
     * Guards `released` and `release_deadline_us`. Both are written by
     * pulse() on the caller's task and read - and sometimes written - by
     * on_release_timer() on the esp_timer task, and release_deadline_us is a
     * 64-bit value, so `volatile` alone would neither prevent a torn read on
     * a 32-bit core nor give either task a guarantee about when the other's
     * write becomes visible. A spinlock costs nothing here: both sides only
     * ever hold it for a couple of assignments.
     */
    portMUX_TYPE state_lock = portMUX_INITIALIZER_UNLOCKED;
    bool released = false;

    /**
     * Boot-time deadline, in microseconds, of the pulse currently in flight.
     * Written by pulse() before it arms the timer, read by on_release_timer()
     * to decide whether it is still the pulse the timer was last armed for.
     * See on_release_timer() for why a plain "the timer fired, so lock" is
     * not safe.
     */
    int64_t release_deadline_us = 0;

    /// Level that energises the coil, i.e. releases the door.
    constexpr int RELEASED_LEVEL = Config::door_relay_active_low ? 0 : 1;
    constexpr int LOCKED_LEVEL   = Config::door_relay_active_low ? 1 : 0;

    /// Below this many microseconds early, a callback locks rather than
    /// re-arming for a few leftover microseconds it would never be woken for
    /// anyway.
    constexpr int64_t DEADLINE_SLOP_US = 1000;

    void lock_now()
    {
        gpio_set_level(static_cast<gpio_num_t>(Pins::DOOR_RELAY), LOCKED_LEVEL);
        portENTER_CRITICAL(&state_lock);
        released = false;
        // Zeroed so a callback that is still queued behind this one - from a
        // pulse this lock_now() was not even called for - reads a deadline in
        // the past and locks instead of trying to re-arm a timer nothing is
        // tracking anymore. Locking is always the safe side to converge on.
        release_deadline_us = 0;
        portEXIT_CRITICAL(&state_lock);
    }

    /**
     * esp_timer_stop() cannot cancel a callback that esp_timer has already
     * dispatched to its own task but not yet run: by the time pulse() calls
     * esp_timer_stop() for a timer whose alarm just fired, the timer already
     * reports "not running", the stop is a no-op, and pulse() goes on to
     * energise the relay and arm a fresh timer for the new pulse. The old
     * callback then still runs. If it simply locked, it would cut the brand
     * new pulse short - a valid code granted and re-locked within
     * milliseconds, never open long enough to use.
     *
     * So this does not trust "I was called, therefore my pulse is over". It
     * trusts the deadline pulse() last wrote instead. If that deadline is
     * still meaningfully ahead, a newer pulse extended it after this callback
     * was already queued: re-arm for whatever is actually left and leave the
     * relay alone. Only lock when the deadline this callback was armed for is
     * the one still current.
     */
    void on_release_timer(void*)
    {
        const int64_t now = esp_timer_get_time();
        portENTER_CRITICAL(&state_lock);
        const int64_t deadline = release_deadline_us;
        portEXIT_CRITICAL(&state_lock);

        const int64_t remaining = deadline - now;
        if (remaining > DEADLINE_SLOP_US)
        {
            // Superseded. pulse() will almost always have already armed the
            // real timer for the new deadline, so this normally fails with
            // "already running" - expected, and ignored, the same as the
            // "already stopped" case in pulse(). It only matters on the rare
            // path where that arm did not happen: then this is the only
            // thing left enforcing the deadline, so a failure here is not
            // ignored - it falls back to locking immediately rather than
            // leaving the coil energised with nothing timing it out.
            const esp_err_t err = esp_timer_start_once(release_timer, static_cast<uint64_t>(remaining));
            if (err != ESP_OK && err != ESP_ERR_INVALID_STATE)
            {
                lock_now();
            }
            return;
        }

        lock_now();
        ESP_LOGI(TAG, "door relay de-energised");
    }

    uint32_t clamp_ms(uint32_t ms)
    {
        if (ms < Config::door_unlock_min_ms) return Config::door_unlock_min_ms;
        if (ms > Config::door_unlock_max_ms) return Config::door_unlock_max_ms;
        return ms;
    }
}

namespace door_lock
{
    esp_err_t begin()
    {
        const gpio_num_t pin = static_cast<gpio_num_t>(Pins::DOOR_RELAY);

        // Level first, direction second. The other order drives the pin at its
        // reset level for as long as the configuration takes, which on an
        // active-low relay is a door that clicks open during boot.
        esp_err_t err = gpio_set_level(pin, LOCKED_LEVEL);
        if (err != ESP_OK) return err;

        gpio_config_t cfg = {};
        cfg.pin_bit_mask = 1ULL << Pins::DOOR_RELAY;
        cfg.mode = GPIO_MODE_OUTPUT;
        cfg.pull_up_en = GPIO_PULLUP_DISABLE;
        cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
        cfg.intr_type = GPIO_INTR_DISABLE;
        err = gpio_config(&cfg);
        if (err != ESP_OK) return err;

        err = gpio_set_level(pin, LOCKED_LEVEL);
        if (err != ESP_OK) return err;

        const esp_timer_create_args_t targs = {
            .callback = &on_release_timer,
            .arg = nullptr,
            .dispatch_method = ESP_TIMER_TASK,
            .name = "door_release",
            .skip_unhandled_events = true,
        };
        err = esp_timer_create(&targs, &release_timer);
        if (err != ESP_OK) return err;

        portENTER_CRITICAL(&state_lock);
        released = false;
        release_deadline_us = 0;
        portEXIT_CRITICAL(&state_lock);

        ESP_LOGI(TAG, "door lock ready on GPIO%d, locked level %d", Pins::DOOR_RELAY, LOCKED_LEVEL);
        return ESP_OK;
    }

    esp_err_t pulse(uint32_t ms)
    {
        if (release_timer == nullptr) return ESP_ERR_INVALID_STATE;

        const uint32_t hold = clamp_ms(ms);

        esp_timer_stop(release_timer);

        esp_err_t err = gpio_set_level(static_cast<gpio_num_t>(Pins::DOOR_RELAY), RELEASED_LEVEL);
        if (err != ESP_OK) return err;

        // Written before the timer is armed, so a callback that reads it the
        // instant the timer fires never sees a stale deadline.
        const int64_t deadline = esp_timer_get_time() + static_cast<int64_t>(hold) * 1000;
        portENTER_CRITICAL(&state_lock);
        release_deadline_us = deadline;
        released = true;
        portEXIT_CRITICAL(&state_lock);

        err = esp_timer_start_once(release_timer, static_cast<uint64_t>(hold) * 1000ULL);
        if (err == ESP_ERR_INVALID_STATE)
        {
            ESP_LOGI(TAG, "release timer already armed by a superseded callback's re-arm; leaving it");
        }
        else if (err != ESP_OK)
        {
            lock_now();
            return err;
        }

        ESP_LOGI(TAG, "door released for %u ms", static_cast<unsigned>(hold));
        return ESP_OK;
    }

    bool is_released()
    {
        portENTER_CRITICAL(&state_lock);
        const bool r = released;
        portEXIT_CRITICAL(&state_lock);
        return r;
    }
}
