/**
 * @file test_main.cpp
 * @brief Host tests for every path where the customer does not simply pay the
 *        exact amount and walk away happy.
 *
 * These are the cases that decide what happens to real money, so each one
 * names the money outcome in its comment.
 */
#include <unity.h>
#include "purchase.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

static PurchaseConfig with_inhibit()
{
    PurchaseConfig cfg;
    cfg.payment_timeout_ms = 60000;
    cfg.has_inhibit = true;
    return cfg;
}

static PurchaseConfig without_inhibit()
{
    PurchaseConfig cfg;
    cfg.payment_timeout_ms = 60000;
    cfg.has_inhibit = false;
    return cfg;
}

// A 20 kr coin for a 15 kr product: the vend happens and 5 kr stays in the
// machine. credit_minor is what the caller reports as received_minor.
void test_overpayment_vends_and_reports_what_was_received()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);

    const PurchaseOutput paid = p.coin(2000, 2000);

    TEST_ASSERT_EQUAL(PurchaseState::Dispensing, paid.state);
    TEST_ASSERT_TRUE(paid.run_slot);
    TEST_ASSERT_FALSE(paid.settle_sale);
    TEST_ASSERT_EQUAL_UINT32(1500, paid.price_minor);
    TEST_ASSERT_EQUAL_UINT32(2000, paid.credit_minor);
    TEST_ASSERT_EQUAL_UINT32(0, paid.missing_minor);

    // The 5 kr the customer does not get back reaches the backend as
    // received_minor on the one sale this purchase books, at DONE.
    const PurchaseOutput out = p.dispense_done(3000);
    TEST_ASSERT_TRUE(out.settle_sale);
    TEST_ASSERT_EQUAL(SaleStatus::Completed, out.sale_status);
    TEST_ASSERT_EQUAL_UINT32(1500, out.price_minor);
    TEST_ASSERT_EQUAL_UINT32(2000, out.credit_minor);
}

// Abandoned payment: 10 kr of a 15 kr product. No vend, nothing reported,
// money forfeited. Spec 6.4 accepts that this leaves the cash box high.
void test_timeout_forfeits_without_reporting()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);
    p.coin(1000, 2000);

    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, p.tick(61999).state);

    const PurchaseOutput out = p.tick(62000);
    TEST_ASSERT_EQUAL(PurchaseState::Settled, out.state);
    TEST_ASSERT_FALSE(out.settle_sale);
    TEST_ASSERT_EQUAL(SaleStatus::None, out.sale_status);
}

// Each coin restarts the window, so a slow customer is not cut off.
void test_each_coin_restarts_the_timeout()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 2000, 1000);
    p.coin(500, 50000);

    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, p.tick(109999).state);
    TEST_ASSERT_EQUAL(PurchaseState::Settled, p.tick(110000).state);
}

// Nothing typed, nothing paid: an idle machine never times out into Settled.
void test_idle_never_times_out()
{
    Purchase p(with_inhibit());

    for (uint32_t t = 0; t < 300000; t += 10000)
        TEST_ASSERT_EQUAL(PurchaseState::Idle, p.tick(t).state);
}

// The machine's own failure. The money is kept, but the sale is reported as
// failed so an operator can find it and compensate by hand. Spec 6.4.
void test_motor_failure_reports_a_failed_sale()
{
    Purchase p(with_inhibit());
    p.slot_chosen(7, 1500, 1000);
    p.coin(1500, 2000);

    // Paying must not have settled anything, or this purchase would reach the
    // backend twice: once claiming completed, once saying failed.
    TEST_ASSERT_FALSE(p.tick(2500).settle_sale);

    const PurchaseOutput out = p.dispense_failed(4000);

    TEST_ASSERT_EQUAL(PurchaseState::Settled, out.state);
    TEST_ASSERT_TRUE(out.settle_sale);
    TEST_ASSERT_EQUAL(SaleStatus::Failed, out.sale_status);
    TEST_ASSERT_EQUAL_UINT32(1500, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT8(7, out.slot);
}

// The invariant the whole ordering exists to protect: one purchase produces
// exactly one settlement, whichever way the delivery goes. Counting across the
// entire sequence is the point — inspecting only the last call is what let the
// double booking hide.
void test_a_failed_purchase_settles_exactly_once()
{
    Purchase p(with_inhibit());
    p.slot_chosen(7, 1500, 1000);

    int settlements = 0;
    if (p.coin(1500, 2000).settle_sale) ++settlements;
    if (p.tick(2100).settle_sale) ++settlements;
    if (p.dispense_failed(4000).settle_sale) ++settlements;
    if (p.tick(4100).settle_sale) ++settlements;

    TEST_ASSERT_EQUAL_INT(1, settlements);
}

void test_a_completed_purchase_settles_exactly_once()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);

    int settlements = 0;
    if (p.coin(1500, 2000).settle_sale) ++settlements;
    if (p.tick(2100).settle_sale) ++settlements;
    if (p.dispense_done(4000).settle_sale) ++settlements;
    if (p.tick(4100).settle_sale) ++settlements;

    TEST_ASSERT_EQUAL_INT(1, settlements);
}

// Cancelling before the motor runs: no vend, nothing reported, credit gone.
void test_cancel_forfeits_without_reporting()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);
    p.coin(500, 2000);

    const PurchaseOutput out = p.cancel(3000);

    TEST_ASSERT_EQUAL(PurchaseState::Settled, out.state);
    TEST_ASSERT_FALSE(out.settle_sale);
    TEST_ASSERT_EQUAL(SaleStatus::None, out.sale_status);
}

// The customer backs out of a slot before paying: nothing was received, so
// nothing is forfeited and nothing is reported - straight back to idle.
void test_cancel_unpaid_returns_to_idle()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);

    const PurchaseOutput out = p.cancel_unpaid(2000);

    TEST_ASSERT_EQUAL(PurchaseState::Idle, out.state);
    TEST_ASSERT_EQUAL_UINT8(0, out.slot);
    TEST_ASSERT_EQUAL_UINT32(0, out.price_minor);
    TEST_ASSERT_FALSE(out.settle_sale);
    TEST_ASSERT_TRUE(out.inhibit_coins);   // the coin slot shuts again
}

// Money is in and the machine cannot hand it back, so backing out is refused:
// the purchase and its credit stay, and another slot can still be chosen.
void test_cancel_unpaid_keeps_a_purchase_with_credit()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);
    p.coin(500, 2000);

    const PurchaseOutput out = p.cancel_unpaid(3000);

    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, out.state);
    TEST_ASSERT_EQUAL_UINT32(500, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT8(12, out.slot);
    TEST_ASSERT_FALSE(out.settle_sale);
}

// Nothing to back out of: idle stays idle, a vend in progress keeps going.
void test_cancel_unpaid_leaves_other_states_alone()
{
    Purchase idle(with_inhibit());
    TEST_ASSERT_EQUAL(PurchaseState::Idle, idle.cancel_unpaid(1000).state);

    Purchase vending(with_inhibit());
    vending.slot_chosen(12, 1500, 1000);
    vending.coin(1500, 2000);
    const PurchaseOutput out = vending.cancel_unpaid(2500);
    TEST_ASSERT_EQUAL(PurchaseState::Dispensing, out.state);
    TEST_ASSERT_FALSE(out.run_slot);       // the RUN was already handed out
}

// With INHIBIT wired the coin slot is shut while idle, so a coin cannot
// arrive. If one somehow does, it must not start a purchase.
void test_coin_in_idle_is_refused_when_inhibit_is_wired()
{
    Purchase p(with_inhibit());

    const PurchaseOutput out = p.coin(1000, 1000);

    TEST_ASSERT_EQUAL(PurchaseState::Idle, out.state);
    TEST_ASSERT_EQUAL_UINT32(0, out.credit_minor);
}

// Without the pin, the money is already in the box. Honour it: hold the credit
// and ask for a slot. price_minor stays 0 until one is chosen.
void test_coin_in_idle_starts_a_payment_when_inhibit_is_absent()
{
    Purchase p(without_inhibit());

    const PurchaseOutput out = p.coin(1000, 1000);

    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, out.state);
    TEST_ASSERT_EQUAL_UINT32(1000, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT32(0, out.price_minor);
}

// The coin-first customer then picks something their credit already covers:
// the vend must start immediately, not wait for another coin.
void test_coin_first_then_an_affordable_slot_vends_at_once()
{
    Purchase p(without_inhibit());
    p.coin(2000, 1000);

    const PurchaseOutput out = p.slot_chosen(12, 1500, 2000);

    TEST_ASSERT_EQUAL(PurchaseState::Dispensing, out.state);
    TEST_ASSERT_TRUE(out.run_slot);
    TEST_ASSERT_FALSE(out.settle_sale);
    TEST_ASSERT_EQUAL_UINT32(2000, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT32(1500, out.price_minor);
}

// Coin-first, then something dearer: keep counting down the difference.
void test_coin_first_then_a_dearer_slot_keeps_counting()
{
    Purchase p(without_inhibit());
    p.coin(500, 1000);

    const PurchaseOutput out = p.slot_chosen(12, 1500, 2000);

    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, out.state);
    TEST_ASSERT_EQUAL_UINT32(1000, out.missing_minor);
    TEST_ASSERT_FALSE(out.run_slot);
}

// A price of 0 means "not for sale" — prices::for_slot returns 0 for a slot
// with no price, and Task 10 refuses the selection. The machine must not be
// left holding a selection it can never dispense: slot_chosen rejects it
// outright rather than parking in AwaitingPayment until the timeout.
void test_slot_with_no_price_is_refused()
{
    Purchase p(with_inhibit());

    const PurchaseOutput out = p.slot_chosen(12, 0, 1000);

    TEST_ASSERT_EQUAL(PurchaseState::Idle, out.state);
    TEST_ASSERT_TRUE(out.inhibit_coins);
    TEST_ASSERT_EQUAL_UINT32(0, out.price_minor);
    TEST_ASSERT_FALSE(out.run_slot);
}

// The coin-first path still reaches AwaitingPayment with price_minor 0, because
// it gets there through coin(), not slot_chosen(). The guard above must not
// break it.
void test_price_zero_guard_does_not_block_coin_first()
{
    Purchase p(without_inhibit());

    const PurchaseOutput out = p.coin(500, 1000);

    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, out.state);
    TEST_ASSERT_EQUAL_UINT32(500, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT32(0, out.price_minor);
}

// An unrecognised coin (value 0) must not be treated as a free payment.
void test_unrecognised_coin_adds_no_credit()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);

    const PurchaseOutput out = p.coin(0, 2000);

    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, out.state);
    TEST_ASSERT_EQUAL_UINT32(0, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT32(1500, out.missing_minor);
}

// OWNER DECISION default: a coin that lands while the motor is running is
// ignored and its value is lost.
void test_coin_during_dispensing_is_ignored()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);
    p.coin(1500, 2000);

    const PurchaseOutput out = p.coin(2000, 2500);

    TEST_ASSERT_EQUAL(PurchaseState::Dispensing, out.state);
    TEST_ASSERT_EQUAL_UINT32(1500, out.credit_minor);
    TEST_ASSERT_FALSE(out.run_slot);
}

// run_slot and settle_sale are one-shot: asking twice must not vend twice or
// book the sale twice. This is the invariant that stops a double charge.
void test_run_and_settle_are_reported_once()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);

    const PurchaseOutput first = p.coin(1500, 2000);
    TEST_ASSERT_TRUE(first.run_slot);

    const PurchaseOutput second = p.tick(2100);
    TEST_ASSERT_FALSE(second.run_slot);

    const PurchaseOutput done = p.dispense_done(3000);
    TEST_ASSERT_TRUE(done.settle_sale);
    TEST_ASSERT_FALSE(p.tick(3100).settle_sale);
}

// Choosing a second slot mid-payment moves the target and keeps the credit.
void test_changing_slot_mid_payment_keeps_the_credit()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);
    p.coin(500, 2000);

    const PurchaseOutput out = p.slot_chosen(7, 1000, 3000);

    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, out.state);
    TEST_ASSERT_EQUAL_UINT8(7, out.slot);
    TEST_ASSERT_EQUAL_UINT32(500, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT32(500, out.missing_minor);
}

// Fix round 2 (found by the owner hand-testing the real board): a real main
// loop calls tick() roughly 20x/sec forever, including throughout the whole
// time a purchase sits Settled while purchase_task.cpp's own display hold is
// showing. Nothing in this file simulated that before - every other test
// here calls Purchase's methods one at a time, the way a reader steps
// through code, never a loop advancing time. This pins what the library
// itself must guarantee for that loop to be safe: once Settled, repeated
// tick() calls must be inert (no re-latching a one-shot flag, no state
// change), and reset() must always bring the machine back regardless of how
// many tick()s ran while it sat Settled.
//
// The bug the owner actually hit was NOT in this library - Purchase::reset()
// was always reachable and always worked, as this test shows. The bug was in
// purchase_task.cpp, which re-armed its own hold timer on every single
// tick() pass while o.state happened to be Settled, instead of only on the
// transition into it, so that timer's deadline never arrived and
// purchase_task never actually called reset(). This library test cannot see
// that timer at all - it lives one layer up, in purchase_task.cpp, which has
// no host test harness. See the task report for that gap.
void test_repeated_tick_while_settled_does_not_relatch_and_reset_still_works()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);
    p.coin(1500, 2000);

    const PurchaseOutput settled = p.dispense_done(3000);
    TEST_ASSERT_EQUAL(PurchaseState::Settled, settled.state);
    TEST_ASSERT_TRUE(settled.settle_sale);

    // Simulate a real main loop: tick() every 50 ms for several simulated
    // seconds while nothing else happens - exactly what purchase_task::tick()
    // does while its own display hold is up.
    for (uint32_t t = 3050; t <= 15000; t += 50)
    {
        const PurchaseOutput out = p.tick(t);
        TEST_ASSERT_EQUAL(PurchaseState::Settled, out.state);
        TEST_ASSERT_EQUAL(SaleStatus::Completed, out.sale_status);
        TEST_ASSERT_FALSE(out.settle_sale);   // one-shot: must never re-latch
        TEST_ASSERT_FALSE(out.run_slot);
    }

    // The library was never stuck: reset() works regardless of how long or
    // how many times tick() ran first, and a new sale can start immediately.
    const PurchaseOutput after_reset = p.reset();
    TEST_ASSERT_EQUAL(PurchaseState::Idle, after_reset.state);

    const PurchaseOutput next_sale = p.slot_chosen(7, 1000, 15100);
    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, next_sale.state);
    TEST_ASSERT_EQUAL_UINT8(7, next_sale.slot);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_overpayment_vends_and_reports_what_was_received);
    RUN_TEST(test_timeout_forfeits_without_reporting);
    RUN_TEST(test_each_coin_restarts_the_timeout);
    RUN_TEST(test_idle_never_times_out);
    RUN_TEST(test_motor_failure_reports_a_failed_sale);
    RUN_TEST(test_a_failed_purchase_settles_exactly_once);
    RUN_TEST(test_a_completed_purchase_settles_exactly_once);
    RUN_TEST(test_cancel_forfeits_without_reporting);
    RUN_TEST(test_cancel_unpaid_returns_to_idle);
    RUN_TEST(test_cancel_unpaid_keeps_a_purchase_with_credit);
    RUN_TEST(test_cancel_unpaid_leaves_other_states_alone);
    RUN_TEST(test_coin_in_idle_is_refused_when_inhibit_is_wired);
    RUN_TEST(test_coin_in_idle_starts_a_payment_when_inhibit_is_absent);
    RUN_TEST(test_coin_first_then_an_affordable_slot_vends_at_once);
    RUN_TEST(test_coin_first_then_a_dearer_slot_keeps_counting);
    RUN_TEST(test_slot_with_no_price_is_refused);
    RUN_TEST(test_price_zero_guard_does_not_block_coin_first);
    RUN_TEST(test_unrecognised_coin_adds_no_credit);
    RUN_TEST(test_coin_during_dispensing_is_ignored);
    RUN_TEST(test_run_and_settle_are_reported_once);
    RUN_TEST(test_changing_slot_mid_payment_keeps_the_credit);
    RUN_TEST(test_repeated_tick_while_settled_does_not_relatch_and_reset_still_works);
    return UNITY_END();
}
