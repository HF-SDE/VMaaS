/**
 * @file test_main.cpp
 * @brief Host tests for ConfigIssueKind, to_string() and the ParseResult shape.
 *
 * Guards that every issue kind has its own log-friendly name so a boot log
 * line always tells which validation failed, that None is 0, and that the
 * result type has room for the schema it describes.
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
        ConfigIssueKind::None,         ConfigIssueKind::InvalidJson,  ConfigIssueKind::MissingField,
        ConfigIssueKind::WrongType,    ConfigIssueKind::OutOfRange,   ConfigIssueKind::InputOnlyPin,
        ConfigIssueKind::DuplicateSlot, ConfigIssueKind::DuplicatePin, ConfigIssueKind::TooManySlots,
        ConfigIssueKind::NewerVersion,
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

// A fresh ParseResult must read as "nothing parsed, no issues" so callers can rely on zero-init.
void test_parse_result_default_is_clean()
{
    ParseResult r{};
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
    TEST_ASSERT_EQUAL_UINT32(0, r.config.slot_count);
    TEST_ASSERT_TRUE(ParseResult::MAX_ISSUES >= 1);
}

// The longest field name the parser can emit, "slots[31].slot", must fit with its NUL.
void test_issue_field_buffer_fits_longest_name()
{
    TEST_ASSERT_TRUE(sizeof(ConfigIssue::field) >= sizeof("slots[31].slot"));
    TEST_ASSERT_EQUAL_UINT32(32, MAX_SLOTS);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_none_is_zero);
    RUN_TEST(test_every_kind_has_a_distinct_non_empty_string);
    RUN_TEST(test_unknown_value_maps_to_unknown);
    RUN_TEST(test_parse_result_default_is_clean);
    RUN_TEST(test_issue_field_buffer_fits_longest_name);
    return UNITY_END();
}
