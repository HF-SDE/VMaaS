/**
 * @file test_main.cpp
 * @brief Host tests for delay_ticks(): a delay of ms must never come up short.
 *
 * vTaskDelay(n) returns at the n-th tick boundary from now, and the first
 * boundary can be any distance away, down to almost none. So only n - 1 whole
 * ticks are guaranteed, and those have to cover the delay on their own.
 */
#include <unity.h>
#include "delay_ticks.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

void test_a_delay_shorter_than_a_tick_still_waits_a_whole_tick()
{
    TEST_ASSERT_EQUAL_UINT32(2, delay_ticks(2, 10));
}

void test_an_exact_multiple_of_the_tick_gets_one_extra()
{
    TEST_ASSERT_EQUAL_UINT32(2, delay_ticks(10, 10));
    TEST_ASSERT_EQUAL_UINT32(6, delay_ticks(50, 10));
}

void test_a_remainder_rounds_up()
{
    TEST_ASSERT_EQUAL_UINT32(3, delay_ticks(11, 10));
}

void test_a_one_millisecond_tick()
{
    TEST_ASSERT_EQUAL_UINT32(3, delay_ticks(2, 1));
}

void test_no_delay_waits_no_ticks()
{
    TEST_ASSERT_EQUAL_UINT32(0, delay_ticks(0, 10));
}

void test_the_guaranteed_ticks_always_cover_the_delay()
{
    const uint32_t tick_periods[] = {1, 2, 10};
    for (uint32_t tick : tick_periods)
    {
        for (uint32_t ms = 1; ms <= 100; ++ms)
        {
            const uint32_t n = delay_ticks(ms, tick);
            TEST_ASSERT_TRUE_MESSAGE((n - 1) * tick >= ms, "n - 1 ticks fall short of the delay");
        }
    }
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_a_delay_shorter_than_a_tick_still_waits_a_whole_tick);
    RUN_TEST(test_an_exact_multiple_of_the_tick_gets_one_extra);
    RUN_TEST(test_a_remainder_rounds_up);
    RUN_TEST(test_a_one_millisecond_tick);
    RUN_TEST(test_no_delay_waits_no_ticks);
    RUN_TEST(test_the_guaranteed_ticks_always_cover_the_delay);
    return UNITY_END();
}
