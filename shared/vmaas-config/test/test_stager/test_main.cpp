#include <unity.h>
#include "wiring_stager.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

namespace
{
    const uint8_t P18[] = {18};
    const uint8_t P21_22[] = {21, 22};
}

void test_begin_add_commit_yields_the_table()
{
    WiringStager s;
    s.begin(1000);
    TEST_ASSERT_EQUAL(WiringStager::Result::Ok, s.add_slot(1, P18, 1, 1010));
    TEST_ASSERT_EQUAL(WiringStager::Result::Ok, s.add_slot(3, P21_22, 2, 1020));
    SlotConfig out{};
    TEST_ASSERT_EQUAL(WiringStager::Result::Ok, s.commit(2, 6400, 1030, out));
    TEST_ASSERT_EQUAL_UINT16(6400, out.steps_per_vend);
    TEST_ASSERT_EQUAL_UINT32(2, out.slot_count);
    TEST_ASSERT_EQUAL_UINT8(3, out.slots[1].slot);
    TEST_ASSERT_EQUAL_UINT8(22, out.slots[1].pins[1]);
    TEST_ASSERT_FALSE(s.active());
}

void test_slot_or_commit_without_begin_is_not_begun()
{
    WiringStager s;
    SlotConfig out{};
    TEST_ASSERT_EQUAL(WiringStager::Result::NotBegun, s.add_slot(1, P18, 1, 5));
    TEST_ASSERT_EQUAL(WiringStager::Result::NotBegun, s.commit(0, 6400, 5, out));
}

void test_begin_clears_a_previous_transfer()
{
    WiringStager s;
    s.begin(0);
    s.add_slot(1, P18, 1, 1);
    s.begin(2);
    SlotConfig out{};
    TEST_ASSERT_EQUAL(WiringStager::Result::Ok, s.commit(0, 6400, 3, out));
    TEST_ASSERT_EQUAL_UINT32(0, out.slot_count);
}

// count is the only defence against a dropped WIRING_SLOT frame.
void test_count_mismatch_refuses_and_keeps_staging()
{
    WiringStager s;
    s.begin(0);
    s.add_slot(1, P18, 1, 1);
    SlotConfig out{};
    TEST_ASSERT_EQUAL(WiringStager::Result::CountMismatch, s.commit(2, 6400, 2, out));
    TEST_ASSERT_TRUE(s.active());
    TEST_ASSERT_EQUAL(WiringStager::Result::Ok, s.commit(1, 6400, 3, out));
}

void test_too_many_pins_or_slots_is_full()
{
    WiringStager s;
    s.begin(0);
    const uint8_t seven[] = {0, 2, 5, 12, 13, 14, 15};
    TEST_ASSERT_EQUAL(WiringStager::Result::Full, s.add_slot(1, seven, 7, 1));
    for (uint8_t i = 1; i <= MAX_SLOTS; ++i) {
        TEST_ASSERT_EQUAL(WiringStager::Result::Ok, s.add_slot(i, P18, 1, 2));
    }
    TEST_ASSERT_EQUAL(WiringStager::Result::Full, s.add_slot(33, P18, 1, 3));
}

void test_zero_steps_is_bad_steps()
{
    WiringStager s;
    s.begin(0);
    SlotConfig out{};
    TEST_ASSERT_EQUAL(WiringStager::Result::BadSteps, s.commit(0, 0, 1, out));
}

// A Main-Controller that dies mid-transfer must leave no partial state behind.
void test_staging_expires_ten_seconds_after_the_last_frame()
{
    WiringStager s;
    s.begin(0);
    s.add_slot(1, P18, 1, 4000);
    s.tick(4000 + WiringStager::TIMEOUT_MS - 1);
    TEST_ASSERT_TRUE(s.active());
    s.tick(4000 + WiringStager::TIMEOUT_MS);
    TEST_ASSERT_FALSE(s.active());
    SlotConfig out{};
    TEST_ASSERT_EQUAL(WiringStager::Result::NotBegun, s.commit(1, 6400, 14001, out));
}

void test_tick_wraps_around()
{
    WiringStager s;
    s.begin(0xFFFFFF00u);
    s.tick(0xFFFFFF00u + 5000);
    TEST_ASSERT_TRUE(s.active());
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_begin_add_commit_yields_the_table);
    RUN_TEST(test_slot_or_commit_without_begin_is_not_begun);
    RUN_TEST(test_begin_clears_a_previous_transfer);
    RUN_TEST(test_count_mismatch_refuses_and_keeps_staging);
    RUN_TEST(test_too_many_pins_or_slots_is_full);
    RUN_TEST(test_zero_steps_is_bad_steps);
    RUN_TEST(test_staging_expires_ten_seconds_after_the_last_frame);
    RUN_TEST(test_tick_wraps_around);
    return UNITY_END();
}
