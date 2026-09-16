/**
 * @file test_main.cpp
 * @brief Host tests for ConfigIssueKind and to_string().
 *
 * Guards that every issue kind has its own log-friendly name so a boot log
 * line always tells which validation failed, and that None is 0.
 */
#include <unity.h>
#include <cstring>
#include "config.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

void test_none_is_zero()
{
    TEST_ASSERT_EQUAL_UINT8(0, static_cast<uint8_t>(ConfigIssueKind::None));
}

void test_every_kind_has_a_distinct_non_empty_string()
{
    const ConfigIssueKind all[] = {
        ConfigIssueKind::None, ConfigIssueKind::InvalidJson, ConfigIssueKind::WrongType,
        ConfigIssueKind::OutOfRange, ConfigIssueKind::InputOnlyPin,
        ConfigIssueKind::DuplicatePin, ConfigIssueKind::NewerVersion,
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

void test_unknown_value_maps_to_unknown()
{
    TEST_ASSERT_EQUAL_STRING("Unknown", to_string(static_cast<ConfigIssueKind>(0xFF)));
}

// A fresh ParseResult must be "no issues, valid" so callers can rely on zero-init,
// and the array must have room for one issue per schema field: schema v1 has 7
// such fields, so a fully broken file never has issues silently dropped.
void test_parse_result_default_is_clean_and_has_room_for_all_fields()
{
    ParseResult r{};
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
    TEST_ASSERT_TRUE(ParseResult::MAX_ISSUES >= 7);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_none_is_zero);
    RUN_TEST(test_every_kind_has_a_distinct_non_empty_string);
    RUN_TEST(test_unknown_value_maps_to_unknown);
    RUN_TEST(test_parse_result_default_is_clean_and_has_room_for_all_fields);
    return UNITY_END();
}
