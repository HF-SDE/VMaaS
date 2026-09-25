#pragma once
/**
 * @file purchase.h
 * @brief The cash purchase state machine: slot choice plus coins in,
 *        decisions out.
 *
 * Hardware-free. It knows nothing about GPIO, the LCD, the UART or HTTP, and
 * takes coin values as plain integers rather than CoinEvents so it does not
 * depend on vmaas-coin. Same cut as SlotEntry, which returns an EntryState
 * without knowing a display exists.
 *
 * The flow is choose-then-pay, so the machine always knows the price before
 * money arrives. That is what makes the INHIBIT line useful: the coin slot can
 * be blocked while idle and again once the credit covers the price, which caps
 * overpayment at a single coin.
 */
#include <cstdint>

namespace vmaas
{
    enum class PurchaseState : uint8_t
    {
        Idle,            ///< No slot chosen. Coin slot inhibited if wired.
        AwaitingPayment, ///< Slot and price known, counting credit up.
        Dispensing,      ///< Paid in full, RUN sent, waiting for DONE or NAK.
        Settled,         ///< Terminal for one customer; the caller resets.
    };

    enum class SaleStatus : uint8_t
    {
        None,      ///< Nothing to report.
        Completed, ///< Paid and dispensed.
        Failed,    ///< Paid, but the motor did not deliver.
    };

    /**
     * @brief What the caller must do after handing the machine an event.
     *
     * Several fields can be set at once: paying the last coin both stops the
     * coin slot and starts the motor.
     */
    struct PurchaseOutput
    {
        PurchaseState state = PurchaseState::Idle;
        uint32_t   price_minor = 0;    ///< 0 in Idle, and when no slot is chosen yet.
        uint32_t   credit_minor = 0;   ///< Counted so far.
        uint32_t   missing_minor = 0;  ///< price - credit, floored at 0.
        bool       inhibit_coins = true;
        bool       run_slot = false;   ///< Send RUN for `slot` now.
        uint8_t    slot = 0;
        bool       settle_sale = false; ///< Append one line to the outbox.
        SaleStatus sale_status = SaleStatus::None;
        /// Send STOP to Motorcontrol now. Set once, on the dispense timeout,
        /// so a motor that is genuinely stuck is switched off; harmless when
        /// the DONE was merely lost, because STOP is idempotent.
        bool       stop_motor = false;
    };

    struct PurchaseConfig
    {
        /// Inactivity before an unfinished payment is abandoned. The credit is
        /// forfeited, and nothing is reported: there was no vend.
        uint32_t payment_timeout_ms = 60000;
        /// Whether the INHIBIT pin is wired. When false, a coin can arrive
        /// with no slot chosen and must still be honoured; see Task 4.
        bool has_inhibit = false;
        /// How long Dispensing waits for DONE or NAK before the sale is booked
        /// Failed and STOP is requested. 0 disables the timeout. Must exceed
        /// the longest vend Motorcontrol can be configured for: 65535 steps at
        /// STEP_INTERVAL_US = 312 is 20.4 s, so 30 s leaves margin. A false
        /// timeout is worse than a slow failure - it books a successful vend as
        /// Failed while the customer holds the item.
        uint32_t dispense_timeout_ms = 30000;
    };

    class Purchase
    {
    public:
        explicit Purchase(const PurchaseConfig &cfg);

        /// The customer picked a slot. @p price_minor comes from the price table.
        PurchaseOutput slot_chosen(uint8_t slot, uint32_t price_minor, uint32_t now_ms);
        /// One decoded coin. A value of 0 (an unrecognised coin) adds no credit.
        PurchaseOutput coin(uint32_t value_minor, uint32_t now_ms);
        PurchaseOutput dispense_done(uint32_t now_ms);
        PurchaseOutput dispense_failed(uint32_t now_ms);
        PurchaseOutput cancel(uint32_t now_ms);
        /// Call every loop pass. This is what enforces payment_timeout_ms and dispense_timeout_ms.
        PurchaseOutput tick(uint32_t now_ms);
        /**
         * @brief Back to Idle, credit cleared. The only way out of Settled.
         *
         * Unguarded on purpose: it must work from any state, because "credit
         * is never carried between customers" has to hold even after a fault.
         * The cost is that calling it during Dispensing forgets a vend that
         * the motor may still be running — so only the owner of the machine
         * calls it, and only once the settlement is durable.
         */
        PurchaseOutput reset();

    private:
        /// Builds the output AND consumes the one-shot flags, so it is not
        /// const. Every caller is a non-const member anyway.
        PurchaseOutput out();

        PurchaseConfig cfg_;
        PurchaseState  state_ = PurchaseState::Idle;
        uint32_t   price_minor_ = 0;
        uint32_t   credit_minor_ = 0;
        uint8_t    slot_ = 0;
        uint32_t   last_activity_ms_ = 0;
        uint32_t   dispense_started_ms_ = 0; ///< When RUN was issued; the dispense deadline counts from here.
        bool       run_slot_ = false;
        bool       settle_sale_ = false;
        SaleStatus sale_status_ = SaleStatus::None;
        bool       stop_motor_ = false;
    };
}
