/**
 * @file test_main.cpp
 * @brief Host tests for the DONE timeout: a paid vend whose DONE never comes
 *        must fail exactly once, ask for STOP, and not be resurrected by a
 *        late DONE.
 *
 * Money outcome in every case: the customer paid, the sale is booked Failed.
 */
#include <unity.h>
#include "purchase.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

namespace
{
    PurchaseConfig cfg(uint32_t dispense_timeout_ms)
    {
        PurchaseConfig c;
        c.payment_timeout_ms = 60000;
        c.has_inhibit = true;
        c.dispense_timeout_ms = dispense_timeout_ms;
        return c;
    }

    // Slot 3 at 15 kr, paid with 20 kr at t=2000. RUN is issued at t=2000.
    Purchase paid(uint32_t dispense_timeout_ms)
    {
        Purchase p(cfg(dispense_timeout_ms));
        p.slot_chosen(3, 1500, 1000);
        const PurchaseOutput o = p.coin(2000, 2000);
        TEST_ASSERT_TRUE(o.run_slot);
        TEST_ASSERT_EQUAL(PurchaseState::Dispensing, o.state);
        return p;
    }
}

void test_default_dispense_timeout_is_thirty_seconds()
{
    PurchaseConfig c;
    TEST_ASSERT_EQUAL_UINT32(30000, c.dispense_timeout_ms);
}

void test_no_done_before_the_deadline_keeps_dispensing()
{
    Purchase p = paid(30000);
    const PurchaseOutput o = p.tick(2000 + 29999);
    TEST_ASSERT_EQUAL(PurchaseState::Dispensing, o.state);
    TEST_ASSERT_FALSE(o.settle_sale);
    TEST_ASSERT_FALSE(o.stop_motor);
}

void test_timeout_fails_the_sale_once_and_asks_for_stop()
{
    Purchase p = paid(30000);
    const PurchaseOutput o = p.tick(2000 + 30000);
    TEST_ASSERT_EQUAL(PurchaseState::Settled, o.state);
    TEST_ASSERT_TRUE(o.settle_sale);
    TEST_ASSERT_EQUAL(SaleStatus::Failed, o.sale_status);
    TEST_ASSERT_TRUE(o.stop_motor);
    TEST_ASSERT_EQUAL_UINT32(2000, o.credit_minor); // what was received, for the sale line

    // One-shots are consumed: the next pass books nothing and stops nothing.
    const PurchaseOutput again = p.tick(2000 + 30001);
    TEST_ASSERT_EQUAL(PurchaseState::Settled, again.state);
    TEST_ASSERT_FALSE(again.settle_sale);
    TEST_ASSERT_FALSE(again.stop_motor);
}

void test_done_just_before_the_deadline_completes_the_sale()
{
    Purchase p = paid(30000);
    p.tick(2000 + 29999);
    const PurchaseOutput o = p.dispense_done(2000 + 29999);
    TEST_ASSERT_EQUAL(PurchaseState::Settled, o.state);
    TEST_ASSERT_EQUAL(SaleStatus::Completed, o.sale_status);
    TEST_ASSERT_TRUE(o.settle_sale);
    TEST_ASSERT_FALSE(o.stop_motor);

    // The deadline passing afterwards changes nothing.
    const PurchaseOutput later = p.tick(2000 + 30000);
    TEST_ASSERT_EQUAL(PurchaseState::Settled, later.state);
    TEST_ASSERT_FALSE(later.settle_sale);
    TEST_ASSERT_FALSE(later.stop_motor);
}

void test_late_done_after_timeout_is_ignored()
{
    Purchase p = paid(30000);
    p.tick(2000 + 30000);
    const PurchaseOutput o = p.dispense_done(2000 + 30500);
    TEST_ASSERT_EQUAL(PurchaseState::Settled, o.state);
    TEST_ASSERT_EQUAL(SaleStatus::Failed, o.sale_status);
    TEST_ASSERT_FALSE(o.settle_sale);
    TEST_ASSERT_FALSE(o.stop_motor);
}

void test_zero_disables_the_dispense_timeout()
{
    Purchase p = paid(0);
    const PurchaseOutput o = p.tick(2000 + 600000);
    TEST_ASSERT_EQUAL(PurchaseState::Dispensing, o.state);
    TEST_ASSERT_FALSE(o.settle_sale);
    TEST_ASSERT_FALSE(o.stop_motor);
}

void test_dispense_timeout_does_not_tick_in_other_states()
{
    Purchase idle(cfg(30000));
    TEST_ASSERT_EQUAL(PurchaseState::Idle, idle.tick(100000).state);
    TEST_ASSERT_FALSE(idle.tick(100001).stop_motor);

    Purchase awaiting(cfg(30000));
    awaiting.slot_chosen(3, 1500, 1000);
    const PurchaseOutput a = awaiting.tick(1000 + 30000); // under the 60 s payment timeout
    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, a.state);
    TEST_ASSERT_FALSE(a.stop_motor);
}

// The deadline counts from the moment RUN is issued, whichever event issued it.
void test_deadline_counts_from_the_run_not_the_slot_choice()
{
    Purchase p(cfg(30000));
    p.slot_chosen(3, 1500, 1000);
    p.coin(1000, 5000);
    p.coin(1000, 9000); // paid here, RUN at t=9000
    TEST_ASSERT_EQUAL(PurchaseState::Dispensing, p.tick(9000 + 29999).state);
    const PurchaseOutput o = p.tick(9000 + 30000);
    TEST_ASSERT_EQUAL(PurchaseState::Settled, o.state);
    TEST_ASSERT_TRUE(o.stop_motor);
}

void test_reset_clears_a_pending_stop_motor()
{
    Purchase p = paid(30000);
    p.tick(2000 + 30000); // consumes stop_motor via out()
    const PurchaseOutput r = p.reset();
    TEST_ASSERT_EQUAL(PurchaseState::Idle, r.state);
    TEST_ASSERT_FALSE(r.stop_motor);
    TEST_ASSERT_FALSE(r.settle_sale);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_default_dispense_timeout_is_thirty_seconds);
    RUN_TEST(test_no_done_before_the_deadline_keeps_dispensing);
    RUN_TEST(test_timeout_fails_the_sale_once_and_asks_for_stop);
    RUN_TEST(test_done_just_before_the_deadline_completes_the_sale);
    RUN_TEST(test_late_done_after_timeout_is_ignored);
    RUN_TEST(test_zero_disables_the_dispense_timeout);
    RUN_TEST(test_dispense_timeout_does_not_tick_in_other_states);
    RUN_TEST(test_deadline_counts_from_the_run_not_the_slot_choice);
    RUN_TEST(test_reset_clears_a_pending_stop_motor);
    return UNITY_END();
}
