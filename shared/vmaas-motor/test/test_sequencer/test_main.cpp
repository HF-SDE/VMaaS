/**
 * @file test_main.cpp
 * @brief Host tests for VendSequencer: every transition, STOP in every state,
 *        exactly one DONE per vend, and no action when idle.
 */
#include <unity.h>
#include "vend_sequencer.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

namespace
{
    void assert_no_actions(const VendActions& a)
    {
        TEST_ASSERT_FALSE(a.enable_pins);
        TEST_ASSERT_FALSE(a.disable_pins);
        TEST_ASSERT_FALSE(a.start_steps);
        TEST_ASSERT_FALSE(a.stop_steps);
        TEST_ASSERT_FALSE(a.send_done);
    }

    // Drives a fresh sequencer to Stepping: run at tick 100, settle at tick 101.
    VendSequencer stepping(uint8_t slot = 3, uint32_t steps = 6400)
    {
        VendSequencer s;
        s.run(slot, steps, 100);
        s.tick(101, false);
        return s;
    }
}

void test_idle_tick_does_nothing()
{
    VendSequencer s;
    assert_no_actions(s.tick(5, false));
    assert_no_actions(s.tick(6, true));
    TEST_ASSERT_EQUAL(VendState::Idle, s.state());
    TEST_ASSERT_EQUAL_UINT8(0, s.current_slot());
}

void test_run_enables_pins_and_enters_enabling()
{
    VendSequencer s;
    const VendActions a = s.run(3, 6400, 100);
    TEST_ASSERT_TRUE(a.enable_pins);
    TEST_ASSERT_FALSE(a.disable_pins);
    TEST_ASSERT_FALSE(a.start_steps);
    TEST_ASSERT_FALSE(a.send_done);
    TEST_ASSERT_EQUAL_UINT8(3, a.slot);
    TEST_ASSERT_EQUAL(VendState::Enabling, s.state());
    TEST_ASSERT_EQUAL_UINT8(3, s.current_slot());
}

// The drivers need a moment after nENABLE goes low. Same tick: nothing yet.
void test_tick_before_settle_does_nothing()
{
    VendSequencer s;
    s.run(3, 6400, 100);
    assert_no_actions(s.tick(100, false));
    TEST_ASSERT_EQUAL(VendState::Enabling, s.state());
}

void test_tick_after_settle_starts_steps_with_slot_and_count()
{
    VendSequencer s;
    s.run(3, 6400, 100);
    const VendActions a = s.tick(101, false);
    TEST_ASSERT_TRUE(a.start_steps);
    TEST_ASSERT_FALSE(a.enable_pins);
    TEST_ASSERT_FALSE(a.disable_pins);
    TEST_ASSERT_FALSE(a.send_done);
    TEST_ASSERT_EQUAL_UINT8(3, a.slot);
    TEST_ASSERT_EQUAL_UINT32(6400, a.steps);
    TEST_ASSERT_EQUAL(VendState::Stepping, s.state());
}

// The generator's done flag is still true from the previous vend until
// start() clears it. During Enabling it must be ignored.
void test_stale_step_done_during_enabling_is_ignored()
{
    VendSequencer s;
    s.run(3, 6400, 100);
    const VendActions a = s.tick(100, true);
    assert_no_actions(a);
    TEST_ASSERT_EQUAL(VendState::Enabling, s.state());
}

void test_step_done_finishes_with_disable_stop_and_one_done()
{
    VendSequencer s = stepping(3);
    assert_no_actions(s.tick(150, false));
    TEST_ASSERT_EQUAL(VendState::Stepping, s.state());

    const VendActions a = s.tick(300, true);
    TEST_ASSERT_TRUE(a.stop_steps);
    TEST_ASSERT_TRUE(a.disable_pins);
    TEST_ASSERT_TRUE(a.send_done);
    TEST_ASSERT_FALSE(a.enable_pins);
    TEST_ASSERT_FALSE(a.start_steps);
    TEST_ASSERT_EQUAL_UINT8(3, a.slot);
    TEST_ASSERT_EQUAL(VendState::Idle, s.state());
    TEST_ASSERT_EQUAL_UINT8(0, s.current_slot());

    // The flag stays true on the generator; the next tick must not send a second DONE.
    assert_no_actions(s.tick(301, true));
}

void test_stop_in_idle_does_nothing()
{
    VendSequencer s;
    assert_no_actions(s.stop());
    TEST_ASSERT_EQUAL(VendState::Idle, s.state());
}

void test_stop_in_enabling_disables_without_done()
{
    VendSequencer s;
    s.run(7, 6400, 100);
    const VendActions a = s.stop();
    TEST_ASSERT_TRUE(a.disable_pins);
    TEST_ASSERT_TRUE(a.stop_steps);
    TEST_ASSERT_FALSE(a.send_done);
    TEST_ASSERT_FALSE(a.enable_pins);
    TEST_ASSERT_FALSE(a.start_steps);
    TEST_ASSERT_EQUAL_UINT8(7, a.slot);
    TEST_ASSERT_EQUAL(VendState::Idle, s.state());
}

void test_stop_in_stepping_stops_and_disables_without_done()
{
    VendSequencer s = stepping(7);
    const VendActions a = s.stop();
    TEST_ASSERT_TRUE(a.stop_steps);
    TEST_ASSERT_TRUE(a.disable_pins);
    TEST_ASSERT_FALSE(a.send_done);
    TEST_ASSERT_EQUAL_UINT8(7, a.slot);
    TEST_ASSERT_EQUAL(VendState::Idle, s.state());

    // A late done flag after STOP must not produce a DONE either.
    assert_no_actions(s.tick(999, true));
}

void test_run_while_busy_is_ignored()
{
    VendSequencer s = stepping(3);
    const VendActions a = s.run(4, 100, 200);
    assert_no_actions(a);
    TEST_ASSERT_EQUAL(VendState::Stepping, s.state());
    TEST_ASSERT_EQUAL_UINT8(3, s.current_slot());
}

void test_tick_wrap_around_still_settles()
{
    VendSequencer s;
    s.run(3, 6400, 0xFFFFFFFFu);
    assert_no_actions(s.tick(0xFFFFFFFFu, false));
    const VendActions a = s.tick(0, false);
    TEST_ASSERT_TRUE(a.start_steps);
    TEST_ASSERT_EQUAL(VendState::Stepping, s.state());
}

void test_sequencer_is_reusable_after_a_vend()
{
    VendSequencer s = stepping(3);
    s.tick(300, true);
    const VendActions a = s.run(5, 3200, 400);
    TEST_ASSERT_TRUE(a.enable_pins);
    TEST_ASSERT_EQUAL_UINT8(5, a.slot);
    const VendActions b = s.tick(401, true); // stale flag again
    TEST_ASSERT_TRUE(b.start_steps);
    TEST_ASSERT_EQUAL_UINT32(3200, b.steps);
}

// Every vend after the first sees the generator's done flag still true from
// the previous vend until start() clears it. Settling must start the steps,
// not finish the vend.
void test_stale_step_done_at_settle_starts_steps_instead_of_finishing()
{
    VendSequencer s;
    s.run(3, 6400, 100);
    const VendActions a = s.tick(101, true);
    TEST_ASSERT_TRUE(a.start_steps);
    TEST_ASSERT_FALSE(a.send_done);
    TEST_ASSERT_FALSE(a.disable_pins);
    TEST_ASSERT_EQUAL(VendState::Stepping, s.state());
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_idle_tick_does_nothing);
    RUN_TEST(test_run_enables_pins_and_enters_enabling);
    RUN_TEST(test_tick_before_settle_does_nothing);
    RUN_TEST(test_tick_after_settle_starts_steps_with_slot_and_count);
    RUN_TEST(test_stale_step_done_during_enabling_is_ignored);
    RUN_TEST(test_step_done_finishes_with_disable_stop_and_one_done);
    RUN_TEST(test_stop_in_idle_does_nothing);
    RUN_TEST(test_stop_in_enabling_disables_without_done);
    RUN_TEST(test_stop_in_stepping_stops_and_disables_without_done);
    RUN_TEST(test_run_while_busy_is_ignored);
    RUN_TEST(test_tick_wrap_around_still_settles);
    RUN_TEST(test_sequencer_is_reusable_after_a_vend);
    RUN_TEST(test_stale_step_done_at_settle_starts_steps_instead_of_finishing);
    return UNITY_END();
}
