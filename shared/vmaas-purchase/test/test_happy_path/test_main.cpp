/**
 * @file test_main.cpp
 * @brief Host tests for one customer paying exactly and getting a product.
 *
 * The machine is deliberately choose-then-pay: it has to know the price
 * before any money is in the box, which is what lets it inhibit the coin slot
 * when the credit is enough. See spec section 6.
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

// A machine nobody has touched accepts no money.
void test_idle_inhibits_the_coin_slot()
{
    Purchase p(with_inhibit());
    const PurchaseOutput out = p.tick(0);

    TEST_ASSERT_EQUAL(PurchaseState::Idle, out.state);
    TEST_ASSERT_TRUE(out.inhibit_coins);
    TEST_ASSERT_FALSE(out.run_slot);
    TEST_ASSERT_FALSE(out.settle_sale);
    TEST_ASSERT_EQUAL_UINT32(0, out.price_minor);
}

// Choosing a slot opens the coin slot and states what is owed.
void test_choosing_a_slot_opens_the_coin_slot()
{
    Purchase p(with_inhibit());
    const PurchaseOutput out = p.slot_chosen(12, 1500, 1000);

    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, out.state);
    TEST_ASSERT_FALSE(out.inhibit_coins);
    TEST_ASSERT_EQUAL_UINT8(12, out.slot);
    TEST_ASSERT_EQUAL_UINT32(1500, out.price_minor);
    TEST_ASSERT_EQUAL_UINT32(0, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT32(1500, out.missing_minor);
}

// A part payment counts down what is still missing and nothing else.
void test_partial_payment_counts_down()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);

    const PurchaseOutput out = p.coin(1000, 2000);

    TEST_ASSERT_EQUAL(PurchaseState::AwaitingPayment, out.state);
    TEST_ASSERT_EQUAL_UINT32(1000, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT32(500, out.missing_minor);
    TEST_ASSERT_FALSE(out.run_slot);
    TEST_ASSERT_FALSE(out.inhibit_coins);
}

// The last coin stops the coin slot and starts the motor. It does NOT settle
// the sale: nothing has been delivered yet, and a sale booked here would have
// to be contradicted by a second one if the motor then failed. Spec 8.2.
void test_exact_payment_runs_the_motor_without_settling()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);
    p.coin(1000, 2000);

    const PurchaseOutput out = p.coin(500, 3000);

    TEST_ASSERT_EQUAL(PurchaseState::Dispensing, out.state);
    TEST_ASSERT_TRUE(out.inhibit_coins);
    TEST_ASSERT_TRUE(out.run_slot);
    TEST_ASSERT_EQUAL_UINT8(12, out.slot);
    TEST_ASSERT_EQUAL_UINT32(1500, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT32(0, out.missing_minor);
    TEST_ASSERT_FALSE(out.settle_sale);
    TEST_ASSERT_EQUAL(SaleStatus::None, out.sale_status);
}

// DONE moves to Settled and stays there: the caller, not the machine, decides
// when the customer is finished, because the caller is what writes the outbox.
void test_done_settles_and_waits_for_reset()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);
    p.coin(1500, 2000);

    const PurchaseOutput out = p.dispense_done(4000);
    TEST_ASSERT_EQUAL(PurchaseState::Settled, out.state);
    TEST_ASSERT_TRUE(out.settle_sale);
    TEST_ASSERT_EQUAL(SaleStatus::Completed, out.sale_status);

    // Time passing must not move it on by itself.
    TEST_ASSERT_EQUAL(PurchaseState::Settled, p.tick(999999).state);
}

// reset() is the only way back to Idle, and it clears the credit.
void test_reset_returns_to_idle_with_no_credit()
{
    Purchase p(with_inhibit());
    p.slot_chosen(12, 1500, 1000);
    p.coin(1500, 2000);
    p.dispense_done(4000);

    const PurchaseOutput out = p.reset();

    TEST_ASSERT_EQUAL(PurchaseState::Idle, out.state);
    TEST_ASSERT_EQUAL_UINT32(0, out.credit_minor);
    TEST_ASSERT_EQUAL_UINT32(0, out.price_minor);
    TEST_ASSERT_TRUE(out.inhibit_coins);
    TEST_ASSERT_FALSE(out.settle_sale);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_idle_inhibits_the_coin_slot);
    RUN_TEST(test_choosing_a_slot_opens_the_coin_slot);
    RUN_TEST(test_partial_payment_counts_down);
    RUN_TEST(test_exact_payment_runs_the_motor_without_settling);
    RUN_TEST(test_done_settles_and_waits_for_reset);
    RUN_TEST(test_reset_returns_to_idle_with_no_credit);
    return UNITY_END();
}
