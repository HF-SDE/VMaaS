/**
 * @file purchase.cpp
 * @brief The state machine. See purchase.h for the contract.
 *
 * run_slot and settle_sale are one-shot: they are set by the transition that
 * earns them and cleared by out(), so a caller that asks twice does not run
 * the motor twice or book the sale twice.
 */
#include "purchase.h"

namespace vmaas
{
    Purchase::Purchase(const PurchaseConfig &cfg) : cfg_(cfg) {}

    PurchaseOutput Purchase::out()
    {
        PurchaseOutput o;
        o.state = state_;
        o.price_minor = price_minor_;
        o.credit_minor = credit_minor_;
        o.missing_minor = price_minor_ > credit_minor_ ? price_minor_ - credit_minor_ : 0;
        o.slot = slot_;
        o.run_slot = run_slot_;
        o.settle_sale = settle_sale_;
        o.sale_status = sale_status_;

        // The coin slot is open only while the machine is genuinely waiting
        // for money it still needs. A price of 0 means no slot is chosen yet,
        // and missing_minor is then 0 — so a coin-first customer with no
        // INHIBIT pin gets the slot shut until they pick something. That is
        // correct: the pin does not exist in that configuration anyway.
        o.inhibit_coins = !(state_ == PurchaseState::AwaitingPayment && o.missing_minor > 0);

        // One-shot: run the motor once, book the sale once. Cleared here so a
        // caller that asks twice cannot do either twice.
        run_slot_ = false;
        settle_sale_ = false;

        return o;
    }

    PurchaseOutput Purchase::slot_chosen(uint8_t slot, uint32_t price_minor, uint32_t now_ms)
    {
        if (state_ != PurchaseState::Idle && state_ != PurchaseState::AwaitingPayment) {
            return out();
        }

        if (price_minor == 0) return out();

        slot_ = slot;
        price_minor_ = price_minor;
        state_ = PurchaseState::AwaitingPayment;
        last_activity_ms_ = now_ms;

        if (credit_minor_ >= price_minor_)
        {
            run_slot_ = true;
            state_ = PurchaseState::Dispensing;
        }

        return out();
    }

    PurchaseOutput Purchase::coin(uint32_t value_minor, uint32_t now_ms)
    {
        if (value_minor == 0) return out();

        if (state_ == PurchaseState::Idle)
        {
            if (cfg_.has_inhibit) return out();

            state_ = PurchaseState::AwaitingPayment;
            price_minor_ = 0;
            slot_ = 0;
        }

        if (state_ != PurchaseState::AwaitingPayment) return out();

        credit_minor_ += value_minor;
        last_activity_ms_ = now_ms;

        if (price_minor_ > 0 && credit_minor_ >= price_minor_)
        {
            run_slot_ = true;
            state_ = PurchaseState::Dispensing;
        }

        return out();
    }

    PurchaseOutput Purchase::dispense_done(uint32_t now_ms)
    {
        if (state_ != PurchaseState::Dispensing) return out();

        state_ = PurchaseState::Settled;
        sale_status_ = SaleStatus::Completed;
        settle_sale_ = true;
        last_activity_ms_ = now_ms;

        return out();
    }

    PurchaseOutput Purchase::dispense_failed(uint32_t now_ms)
    {
        if (state_ != PurchaseState::Dispensing) return out();

        state_ = PurchaseState::Settled;
        sale_status_ = SaleStatus::Failed;
        settle_sale_ = true;
        last_activity_ms_ = now_ms;

        return out();
    }

    PurchaseOutput Purchase::cancel(uint32_t now_ms)
    {
        if (state_ != PurchaseState::AwaitingPayment) return out();

        state_ = PurchaseState::Settled;
        sale_status_ = SaleStatus::None;
        last_activity_ms_ = now_ms;

        return out();
    }

    PurchaseOutput Purchase::tick(uint32_t now_ms)
    {
        if (state_ == PurchaseState::AwaitingPayment &&
            cfg_.payment_timeout_ms > 0 &&
            now_ms - last_activity_ms_ >= cfg_.payment_timeout_ms)
        {
            state_ = PurchaseState::Settled;
            sale_status_ = SaleStatus::None;
        }

        return out();
    }

    PurchaseOutput Purchase::reset()
    {
        state_ = PurchaseState::Idle;
        price_minor_ = 0;
        credit_minor_ = 0;
        slot_ = 0;
        run_slot_ = false;
        settle_sale_ = false;
        sale_status_ = SaleStatus::None;

        return out();
    }
}
