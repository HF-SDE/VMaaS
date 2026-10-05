#include <unity.h>
#include "renewal_policy.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

namespace
{
    constexpr int64_t DAY = 86400;
    constexpr int64_t T0 = 1790000000; // an arbitrary UTC second
}

void test_utc_seconds_epoch()
{
    TEST_ASSERT_EQUAL_INT64(0, utc_seconds({1970, 1, 1, 0, 0, 0}));
}

void test_utc_seconds_known_instant()
{
    // date -u -d 2026-10-01T09:55:30Z +%s
    TEST_ASSERT_EQUAL_INT64(1790848530, utc_seconds({2026, 10, 1, 9, 55, 30}));
}

void test_utc_seconds_leap_day()
{
    TEST_ASSERT_EQUAL_INT64(utc_seconds({2028, 3, 1, 0, 0, 0}) - DAY, utc_seconds({2028, 2, 29, 0, 0, 0}));
}

void test_utc_seconds_far_future()
{
    // X.509 GeneralizedTime "no expiry" sentinel.
    TEST_ASSERT_EQUAL_INT64(253402300799, utc_seconds({9999, 12, 31, 23, 59, 59}));
}

void test_fresh_90_day_certificate_is_not_due()
{
    TEST_ASSERT_FALSE(should_renew(T0, T0, T0 + 90 * DAY));
}

void test_90_day_certificate_with_a_day_left_is_due()
{
    TEST_ASSERT_TRUE(should_renew(T0 + 89 * DAY, T0, T0 + 90 * DAY));
}

void test_freshly_issued_short_certificate_is_not_due()
{
    // A renewal ends in a restart that asks again: "yes" here is a reboot loop.
    TEST_ASSERT_FALSE(should_renew(T0, T0, T0 + 7 * DAY));
    TEST_ASSERT_FALSE(should_renew(T0, T0, T0 + 1 * DAY));
}

void test_short_certificate_near_its_end_is_due()
{
    TEST_ASSERT_TRUE(should_renew(T0 + 6 * DAY, T0, T0 + 7 * DAY));
}

void test_expired_certificate_is_due()
{
    TEST_ASSERT_TRUE(should_renew(T0 + 91 * DAY, T0, T0 + 90 * DAY));
}

void test_90_day_certificate_is_due_at_30_days_left()
{
    TEST_ASSERT_FALSE(should_renew(T0 + 60 * DAY - 1, T0, T0 + 90 * DAY));
    TEST_ASSERT_TRUE(should_renew(T0 + 60 * DAY, T0, T0 + 90 * DAY));
}

void test_clock_before_not_before_is_not_due()
{
    TEST_ASSERT_FALSE(should_renew(T0 - DAY, T0, T0 + 90 * DAY));
}

void test_inverted_window_is_due()
{
    TEST_ASSERT_TRUE(should_renew(T0, T0, T0));
    TEST_ASSERT_TRUE(should_renew(T0, T0 + DAY, T0));
}

void test_seconds_until_due_is_the_first_due_second()
{
    const int64_t wait = seconds_until_due(T0, T0, T0 + 90 * DAY);
    TEST_ASSERT_EQUAL_INT64(60 * DAY, wait);
    TEST_ASSERT_FALSE(should_renew(T0 + wait - 1, T0, T0 + 90 * DAY));
    TEST_ASSERT_TRUE(should_renew(T0 + wait, T0, T0 + 90 * DAY));
}

void test_seconds_until_due_rounds_up_an_uneven_lifetime()
{
    // 1-day certificate: 2/3 of 86400 is 57600 exactly; 86401 is not divisible.
    const int64_t wait = seconds_until_due(T0, T0, T0 + DAY + 1);
    TEST_ASSERT_FALSE(should_renew(T0 + wait - 1, T0, T0 + DAY + 1));
    TEST_ASSERT_TRUE(should_renew(T0 + wait, T0, T0 + DAY + 1));
}

void test_seconds_until_due_is_zero_once_due()
{
    TEST_ASSERT_EQUAL_INT64(0, seconds_until_due(T0 + 80 * DAY, T0, T0 + 90 * DAY));
    TEST_ASSERT_EQUAL_INT64(0, seconds_until_due(T0, T0, T0));
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_utc_seconds_epoch);
    RUN_TEST(test_utc_seconds_known_instant);
    RUN_TEST(test_utc_seconds_leap_day);
    RUN_TEST(test_utc_seconds_far_future);
    RUN_TEST(test_fresh_90_day_certificate_is_not_due);
    RUN_TEST(test_90_day_certificate_with_a_day_left_is_due);
    RUN_TEST(test_freshly_issued_short_certificate_is_not_due);
    RUN_TEST(test_short_certificate_near_its_end_is_due);
    RUN_TEST(test_expired_certificate_is_due);
    RUN_TEST(test_90_day_certificate_is_due_at_30_days_left);
    RUN_TEST(test_clock_before_not_before_is_not_due);
    RUN_TEST(test_inverted_window_is_due);
    RUN_TEST(test_seconds_until_due_is_the_first_due_second);
    RUN_TEST(test_seconds_until_due_rounds_up_an_uneven_lifetime);
    RUN_TEST(test_seconds_until_due_is_zero_once_due);
    return UNITY_END();
}
