/**
 * @file test_main.cpp
 * @brief Host tests for occurred_at_ms(), build_event_id() and format_iso8601().
 */
#include <unity.h>
#include <cstring>
#include "timing.h"

using namespace vmaas::events;

void setUp() {}
void tearDown() {}

void test_a_record_with_a_real_clock_keeps_its_timestamp()
{
    Record r{};
    r.wall_ms = 1758456224000ULL;
    r.uptime_ms = 1000;
    TEST_ASSERT_TRUE(occurred_at_ms(r, 1758456999000ULL, 500000) == 1758456224000ULL);
}

// The door opened before SNTP answered: the timestamp is reconstructed from
// how long ago that was, not invented.
void test_a_clockless_record_is_back_dated_by_its_age()
{
    Record r{};
    r.wall_ms = 0;
    r.uptime_ms = 10000;            // happened 10 s after boot
    const uint64_t now_wall = 1758456224000ULL;
    const uint32_t now_uptime = 70000; // 60 s later
    TEST_ASSERT_TRUE(occurred_at_ms(r, now_wall, now_uptime) == now_wall - 60000ULL);
}

// An uptime counter that wrapped, or a clock that is somehow behind the event,
// must not produce a timestamp before the epoch.
void test_back_dating_never_goes_below_zero()
{
    Record r{};
    r.wall_ms = 0;
    r.uptime_ms = 90000;
    TEST_ASSERT_TRUE(occurred_at_ms(r, 1000ULL, 100000) == 0);
}

void test_an_event_id_is_the_machine_id_and_the_sequence()
{
    char out[160];
    TEST_ASSERT_TRUE(build_event_id("33333333-3333-4333-8333-333333333333", 42, out, sizeof(out)));
    TEST_ASSERT_EQUAL_STRING("33333333-3333-4333-8333-333333333333-42", out);
}

void test_an_event_id_needs_a_machine_id()
{
    char out[160];
    TEST_ASSERT_FALSE(build_event_id("", 42, out, sizeof(out)));
}

void test_an_event_id_that_does_not_fit_is_refused()
{
    char out[8];
    TEST_ASSERT_FALSE(build_event_id("33333333-3333-4333-8333-333333333333", 42, out, sizeof(out)));
}

void test_a_timestamp_is_formatted_as_the_schema_expects()
{
    char out[32];
    TEST_ASSERT_TRUE(format_iso8601(1758456224000ULL, out, sizeof(out)));
    // Confirmed against: node -e "console.log(new Date(1758456224000).toISOString())"
    TEST_ASSERT_EQUAL_STRING("2025-09-21T12:03:44.000Z", out);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_a_record_with_a_real_clock_keeps_its_timestamp);
    RUN_TEST(test_a_clockless_record_is_back_dated_by_its_age);
    RUN_TEST(test_back_dating_never_goes_below_zero);
    RUN_TEST(test_an_event_id_is_the_machine_id_and_the_sequence);
    RUN_TEST(test_an_event_id_needs_a_machine_id);
    RUN_TEST(test_an_event_id_that_does_not_fit_is_refused);
    RUN_TEST(test_a_timestamp_is_formatted_as_the_schema_expects);
    return UNITY_END();
}
