/**
 * @file test_main.cpp
 * @brief Host tests for KeypadError and to_string().
 *
 * Pure enum/string checks, no fake port needed. Guards two things callers
 * rely on: KeypadError::None is 0, and every code has its own log-friendly
 * name so a log line always says which failure happened.
 */
#include <unity.h>
#include <cstring>
#include "keypad_error.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

// None must be 0 so it is the natural "no error" value and enum ordering stays stable.
void test_none_is_zero()
{
    TEST_ASSERT_EQUAL_UINT8(0, static_cast<uint8_t>(KeypadError::None));
}

// Every code needs its own name; a shared or empty string would make log lines ambiguous.
void test_every_enumerator_has_a_distinct_non_empty_string()
{
    const KeypadError all[] = {
        KeypadError::None, KeypadError::BadPinConfig,
        KeypadError::GpioInitFailed, KeypadError::PortUnavailable,
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

// A value outside the enum must not walk off the end of a lookup table.
void test_unknown_value_is_named_not_crashed()
{
    const char* s = to_string(static_cast<KeypadError>(99));
    TEST_ASSERT_NOT_NULL(s);
    TEST_ASSERT_EQUAL_STRING("Unknown", s);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_none_is_zero);
    RUN_TEST(test_every_enumerator_has_a_distinct_non_empty_string);
    RUN_TEST(test_unknown_value_is_named_not_crashed);
    return UNITY_END();
}
