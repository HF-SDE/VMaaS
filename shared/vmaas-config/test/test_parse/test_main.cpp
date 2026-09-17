/**
 * @file test_main.cpp
 * @brief Host tests for parse_config() structure handling.
 *
 * The contract under test: a well-formed file yields the slot table in file
 * order and ok == true; anything that is not a JSON object with a "slots"
 * array yields ok == false and names the problem; unknown keys and a newer
 * schema version are tolerated.
 */
#include <unity.h>
#include <cstring>
#include <string>
#include "config.h"
#include "config_parser.h"

using namespace vmaas;

namespace
{
    constexpr const char* FOUR_SLOTS = R"({
        "version": 1,
        "slots": [
            { "slot": 1, "pin": 18 },
            { "slot": 2, "pin": 19 },
            { "slot": 3, "pin": 21 },
            { "slot": 4, "pin": 22 }
        ]
    })";

    bool has_issue(const ParseResult& r, ConfigIssueKind kind, const char* field)
    {
        for (size_t i = 0; i < r.issue_count; ++i)
            if (r.issues[i].kind == kind && std::strcmp(r.issues[i].field, field) == 0)
                return true;
        return false;
    }
}

void setUp() {}
void tearDown() {}

void test_valid_file_gives_slots_in_file_order()
{
    const ParseResult r = parse_config(FOUR_SLOTS);
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
    TEST_ASSERT_EQUAL_UINT32(4, r.config.slot_count);
    TEST_ASSERT_EQUAL_UINT8(1, r.config.slots[0].slot);
    TEST_ASSERT_EQUAL_INT(18, r.config.slots[0].pin);
    TEST_ASSERT_EQUAL_UINT8(4, r.config.slots[3].slot);
    TEST_ASSERT_EQUAL_INT(22, r.config.slots[3].pin);
}

void test_single_slot_file_is_ok()
{
    const ParseResult r = parse_config(R"({"slots": [{"slot": 7, "pin": 5}]})");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(1, r.config.slot_count);
    TEST_ASSERT_EQUAL_UINT8(7, r.config.slots[0].slot);
    TEST_ASSERT_EQUAL_INT(5, r.config.slots[0].pin);
}

// There is no default wiring: a file without "slots" is unusable.
void test_empty_object_is_missing_slots()
{
    const ParseResult r = parse_config("{}");
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(0, r.config.slot_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "slots"));
}

void test_nullptr_is_invalid_json()
{
    const ParseResult r = parse_config(nullptr);
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InvalidJson, ""));
}

void test_invalid_json_gives_offset()
{
    const char* json = R"({"slots": [{"slot": 1,)";
    const ParseResult r = parse_config(json);
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InvalidJson, ""));
    TEST_ASSERT_TRUE(r.json_error_offset > 0);
    TEST_ASSERT_TRUE(r.json_error_offset <= std::strlen(json));
}

void test_non_object_root_is_invalid_json()
{
    const ParseResult r = parse_config(R"([{"slot": 1, "pin": 18}])");
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InvalidJson, ""));
}

// Deep nesting is rejected before cJSON recurses, so a hostile file cannot exhaust the stack.
void test_deeply_nested_json_is_rejected_before_parsing()
{
    std::string json = "{\"x\":";
    for (int i = 0; i < 20; ++i) json += "[";
    json += "1";
    for (int i = 0; i < 20; ++i) json += "]";
    json += "}";
    const ParseResult r = parse_config(json.c_str());
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_EQUAL(ConfigIssueKind::InvalidJson, r.issues[0].kind);
    TEST_ASSERT_TRUE(r.json_error_offset > 0);
    TEST_ASSERT_TRUE(r.json_error_offset < json.size());
}

// The schema itself is depth 3 (object > array > object) and must stay well inside the limit.
void test_schema_depth_is_within_limit()
{
    const ParseResult r = parse_config(R"({"slots": [{"slot": 1, "pin": 18, "meta": {"a": [1]}}]})");
    TEST_ASSERT_TRUE(r.ok);
}

void test_unknown_keys_are_ignored_everywhere()
{
    const char* json = R"({
        "version": 1,
        "wifi": {"ssid": "x"},
        "slots": [{"slot": 1, "pin": 18, "label": "cola"}],
        "notes": [1, 2, 3]
    })";
    const ParseResult r = parse_config(json);
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
    TEST_ASSERT_EQUAL_UINT32(1, r.config.slot_count);
}

// A file from a newer firmware still applies; the caller gets a hint.
void test_newer_version_is_flagged_but_ok()
{
    const ParseResult r = parse_config(R"({"version": 2, "slots": [{"slot": 1, "pin": 18}]})");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::NewerVersion, "version"));
    TEST_ASSERT_EQUAL_UINT32(1, r.config.slot_count);
}

void test_current_version_gives_no_issue()
{
    TEST_ASSERT_EQUAL_UINT32(0, parse_config(R"({"version": 1, "slots": [{"slot": 1, "pin": 18}]})").issue_count);
}

void test_non_numeric_version_is_wrong_type_and_not_ok()
{
    const ParseResult r = parse_config(R"({"version": "1", "slots": [{"slot": 1, "pin": 18}]})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "version"));
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_valid_file_gives_slots_in_file_order);
    RUN_TEST(test_single_slot_file_is_ok);
    RUN_TEST(test_empty_object_is_missing_slots);
    RUN_TEST(test_nullptr_is_invalid_json);
    RUN_TEST(test_invalid_json_gives_offset);
    RUN_TEST(test_non_object_root_is_invalid_json);
    RUN_TEST(test_deeply_nested_json_is_rejected_before_parsing);
    RUN_TEST(test_schema_depth_is_within_limit);
    RUN_TEST(test_unknown_keys_are_ignored_everywhere);
    RUN_TEST(test_newer_version_is_flagged_but_ok);
    RUN_TEST(test_current_version_gives_no_issue);
    RUN_TEST(test_non_numeric_version_is_wrong_type_and_not_ok);
    return UNITY_END();
}
