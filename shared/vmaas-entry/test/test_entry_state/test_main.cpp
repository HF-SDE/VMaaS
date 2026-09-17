/**
 * @file test_main.cpp
 * @brief Host tests for EntryStatus naming and slot_number() parsing.
 *
 * slot_number() is what turns typed characters into a number the protocol can
 * carry, so it is the last place a stray character can be caught before a
 * DISPENSE goes out with a nonsense slot.
 */
#include <unity.h>
#include <cstring>
#include "entry_state.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

void test_editing_is_zero()
{
    TEST_ASSERT_EQUAL_UINT8(0, static_cast<uint8_t>(EntryStatus::Editing));
}

void test_every_status_has_a_distinct_non_empty_string()
{
    const EntryStatus all[] = {
        EntryStatus::Editing, EntryStatus::Confirmed,
        EntryStatus::Cancelled, EntryStatus::TimedOut,
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

void test_unknown_status_is_named_not_crashed()
{
    TEST_ASSERT_EQUAL_STRING("Unknown", to_string(static_cast<EntryStatus>(99)));
}

void test_slot_number_parses_one_and_two_digits()
{
    EntryState a{{'7', '\0', '\0'}, EntryStatus::Confirmed};
    uint8_t out = 0;
    TEST_ASSERT_TRUE(slot_number(a, out));
    TEST_ASSERT_EQUAL_UINT8(7, out);

    EntryState b{{'1', '2', '\0'}, EntryStatus::Confirmed};
    TEST_ASSERT_TRUE(slot_number(b, out));
    TEST_ASSERT_EQUAL_UINT8(12, out);
}

void test_slot_number_rejects_an_empty_buffer()
{
    EntryState st{{'\0', '\0', '\0'}, EntryStatus::Editing};
    uint8_t out = 42;
    TEST_ASSERT_FALSE(slot_number(st, out));
    TEST_ASSERT_EQUAL_UINT8(42, out);   // untouched on failure
}

void test_slot_number_rejects_a_non_digit()
{
    EntryState st{{'1', '#', '\0'}, EntryStatus::Confirmed};
    uint8_t out = 0;
    TEST_ASSERT_FALSE(slot_number(st, out));
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_editing_is_zero);
    RUN_TEST(test_every_status_has_a_distinct_non_empty_string);
    RUN_TEST(test_unknown_status_is_named_not_crashed);
    RUN_TEST(test_slot_number_parses_one_and_two_digits);
    RUN_TEST(test_slot_number_rejects_an_empty_buffer);
    RUN_TEST(test_slot_number_rejects_a_non_digit);
    return UNITY_END();
}
