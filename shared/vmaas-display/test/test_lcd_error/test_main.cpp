/**
 * @file test_main.cpp
 * @brief Host tests for LcdError and to_string().
 *
 * Pure enum/string checks, no FakePort needed. Guards two things callers rely
 * on: LcdError::None is 0 (so `if (err)` style checks would work) and every
 * error code has its own log-friendly name, so a log line always tells which
 * failure happened.
 */
#include <unity.h>
#include <cstring>
#include "lcd_error.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

// None must be 0 so it is the natural "no error" value and enum ordering stays stable.
void test_none_is_zero()
{
    TEST_ASSERT_EQUAL_UINT8(0, static_cast<uint8_t>(LcdError::None));
}

// Every code needs its own name; a shared or empty string would make log lines ambiguous.
void test_every_enumerator_has_a_distinct_non_empty_string()
{
    const LcdError all[] = {
        LcdError::None, LcdError::NotInitialized, LcdError::InvalidArgument,
        LcdError::I2cWrite, LcdError::RgbChipNotFound,
    };
    const size_t n = sizeof(all) / sizeof(all[0]);
    for (size_t i = 0; i < n; ++i)
    {
        const char* s = to_string(all[i]);
        TEST_ASSERT_NOT_NULL(s);
        TEST_ASSERT_TRUE(std::strlen(s) > 0);
        for (size_t j = 0; j < i; ++j)
            TEST_ASSERT_TRUE(std::strcmp(s, to_string(all[j])) != 0);
    }
}

// A corrupted or future value must still produce a printable string, never a nullptr.
void test_unknown_value_maps_to_unknown()
{
    TEST_ASSERT_EQUAL_STRING("Unknown", to_string(static_cast<LcdError>(0xFF)));
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_none_is_zero);
    RUN_TEST(test_every_enumerator_has_a_distinct_non_empty_string);
    RUN_TEST(test_unknown_value_maps_to_unknown);
    return UNITY_END();
}
