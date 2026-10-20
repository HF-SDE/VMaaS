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

#include "char_lcd.h"
#include "motor_client.h"
#include "prices.h"

namespace purchase_task
{
    /// Load the price table, install the ISR, start the drain task.
    /// @param dispense_timeout_ms From config.json timings.dispense_timeout_ms;
    ///        how long a paid vend waits for DONE before it is booked Failed. 0 disables.
    /// @return False when there are no prices, in which case cash is disabled
    ///         and the firmware behaves as it did before this feature.
    bool begin(vmaas::CharLcd &lcd, bool display_ok, MotorClient &motor, uint32_t dispense_timeout_ms);

    /**
     * @brief Swap in a freshly fetched price table.
     *
     * Called from config_sync's task rather than the main loop, which is why
     * the swap is guarded: on_slot_confirmed() reads a price on the main task
     * and a settled sale copies the currency out of the same struct. @p fresh
     * is copied, so the caller keeps ownership of it.
     *
     * Only prices and the currency go live. The cash calibration that arrives
     * in the same payload - coin pulse values, payment timeout, inhibit - was
     * copied into the CoinAcceptor and Purchase state machines when begin()
     * constructed them, so a change to it takes effect at the next reboot and
     * not before. Anywhere an operator is told the configuration was applied
     * has to say so.
     */
    void set_prices(const prices::Table &fresh);

    /**
     * @brief Apply a new stock baseline from config_sync.
     *
     * Safe from config_sync's task: guarded by the same lock as the prices.
     * The machine's own sales the baseline already counts are dropped from
     * /storage/stock_sales.json (spec: slot stock).
     */
    void set_stock(const vmaas::StockBaseline &baseline);

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

    /// True while row 1 belongs to purchase_task: a notice such as "Sold out"
    /// is being held, or a purchase is under way. The main loop's slot-entry
    /// echo must not draw "> _" over it until the customer types again.
    bool owns_display();

    /// The customer backs out of the slot they chose. Cancels only while
    /// nothing has been paid, since coins cannot be handed back.
    /// @return True if a purchase was cancelled and the machine is idle again.
    bool cancel_unpaid();

    /// Forget what is on screen, so the next tick() redraws the purchase.
    /// For the main loop, after it has written over row 1 mid-purchase.
    void invalidate_display();

    /// True when no purchase is under way: nothing chosen, nothing paid,
    /// nothing dispensing. Always true with cash disabled, since no RUN is
    /// sent then. Gates the wiring transfer (wiring_sync).
    bool idle();

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
