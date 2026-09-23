#pragma once
/**
 * @file purchase_task.h
 * @brief The one place that knows about coins, prices, the LCD, the motor and
 *        the outbox at the same time.
 *
 * Everything decidable lives in vmaas-coin and vmaas-purchase, which are
 * hardware-free and host-tested. This file is the wiring: it moves values
 * between them and the peripherals, and it owns the ordering rule that the
 * outbox line is durable before RUN is sent.
 */
#include <cstdint>

#include "grove_lcd_rgb.h"
#include "motor_client.h"

namespace purchase_task
{
    /// Load the price table, install the ISR, start the drain task.
    /// @param dispense_timeout_ms From config.json timings.dispense_timeout_ms;
    ///        how long a paid vend waits for DONE before it is booked Failed. 0 disables.
    /// @return False when there are no prices, in which case cash is disabled
    ///         and the firmware behaves as it did before this feature.
    bool begin(vmaas::GroveLcdRgb &lcd, bool display_ok, MotorClient &motor, uint32_t dispense_timeout_ms);

    /// SlotEntry reported Confirmed.
    void on_slot_confirmed(uint8_t slot);
    /// Motorcontrol reported DONE.
    void on_dispense_done();
    /// Motorcontrol reported NAK for RUN. (A DONE that never arrives is
    /// handled by the dispense timeout inside tick().)
    void on_dispense_failed();

    /// Call every main-loop pass.
    void tick(uint32_t now_ms);

    /// True while a purchase owns the display, so the caller leaves it alone.
    bool active();

    /**
     * @brief Tell purchase_task whether main.cpp's persistent motor-fault
     *        banner (show_motor_error()/clear_motor_error()) is on screen.
     *
     * The banner is operator-facing and must win over any purchase-flow
     * notice, which is transient by comparison. Call with @c true from
     * show_motor_error() and @c false from clear_motor_error(), so the two
     * renderers never fight over the one physical display: while active,
     * purchase_task stops writing to the LCD (state changes and settlement
     * still happen normally, only the display write is deferred), and
     * clearing it resynchronises the display with whatever purchase_task's
     * state actually is by then.
     */
    void set_motor_fault(bool fault_on);
}
