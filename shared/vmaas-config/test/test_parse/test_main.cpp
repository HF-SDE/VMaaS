/**
 * @file test_main.cpp
 * @brief Host tests for parse_slot_config() structure handling.
 *
 * The contract under test: a well-formed v2 file yields the step count and
 * the slot table in file order with ok == true; anything that is not a JSON
 * object with a "motor" block and a "slots" array yields ok == false and
 * names the problem; unknown keys and a newer schema version are tolerated.
 */
#include <unity.h>
#include <cstring>
#include <string>
#include "slot_config.h"
#include "slot_config_parser.h"

using namespace vmaas;

namespace
{
    constexpr const char* MOTOR = R"("motor": {"stepsPerVend": 6400},)";

    constexpr const char* FOUR_SLOTS = R"({
        "version": 2,
        "motor": { "stepsPerVend": 6400 },
        "slots": [
            { "slot": 1, "pins": [18] },
            { "slot": 2, "pins": [19] },
            { "slot": 3, "pins": [21, 22] },
            { "slot": 4, "pins": [23] }
        ]
    })";

    // Wraps a slots-array body in a complete v2 file with the default motor block.
    std::string file(const char* slots_body)
    {
        return std::string("{") + MOTOR + "\"slots\": " + slots_body + "}";
    }

    bool has_issue(const SlotParseResult& r, ConfigIssueKind kind, const char* field)
    {
        for (size_t i = 0; i < r.issue_count; ++i)
            if (r.issues[i].kind == kind && std::strcmp(r.issues[i].field, field) == 0)
                return true;
        return false;
    }
}

void setUp() {}
void tearDown() {}

void test_valid_file_gives_steps_and_slots_in_file_order()
{
    const SlotParseResult r = parse_slot_config(FOUR_SLOTS);
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
    TEST_ASSERT_EQUAL_UINT16(6400, r.config.steps_per_vend);
    TEST_ASSERT_EQUAL_UINT32(4, r.config.slot_count);
    TEST_ASSERT_EQUAL_UINT8(1, r.config.slots[0].slot);
    TEST_ASSERT_EQUAL_UINT8(1, r.config.slots[0].pin_count);
    TEST_ASSERT_EQUAL_UINT8(18, r.config.slots[0].pins[0]);
    TEST_ASSERT_EQUAL_UINT8(3, r.config.slots[2].slot);
    TEST_ASSERT_EQUAL_UINT8(2, r.config.slots[2].pin_count);
    TEST_ASSERT_EQUAL_UINT8(21, r.config.slots[2].pins[0]);
    TEST_ASSERT_EQUAL_UINT8(22, r.config.slots[2].pins[1]);
    TEST_ASSERT_EQUAL_UINT8(4, r.config.slots[3].slot);
    TEST_ASSERT_EQUAL_UINT8(23, r.config.slots[3].pins[0]);
}

void test_single_slot_file_is_ok()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 7, "pins": [5]}])").c_str());
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(1, r.config.slot_count);
    TEST_ASSERT_EQUAL_UINT8(7, r.config.slots[0].slot);
    TEST_ASSERT_EQUAL_UINT8(5, r.config.slots[0].pins[0]);
}

// There is no default wiring and no default step count: an empty object is unusable on both counts.
void test_empty_object_is_missing_motor_and_slots()
{
    const SlotParseResult r = parse_slot_config("{}");
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(0, r.config.slot_count);
    TEST_ASSERT_EQUAL_UINT16(0, r.config.steps_per_vend);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "motor"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "slots"));
}

void test_missing_motor_block_is_missing_field()
{
    const SlotParseResult r = parse_slot_config(R"({"slots": [{"slot": 1, "pins": [18]}]})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(0, r.config.slot_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "motor"));
}

void test_missing_steps_per_vend_is_missing_field()
{
    const SlotParseResult r = parse_slot_config(R"({"motor": {}, "slots": [{"slot": 1, "pins": [18]}]})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "motor.stepsPerVend"));
}

void test_motor_not_an_object_is_wrong_type()
{
    const SlotParseResult r = parse_slot_config(R"({"motor": 6400, "slots": [{"slot": 1, "pins": [18]}]})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "motor"));
}

void test_nullptr_is_invalid_json()
{
    const SlotParseResult r = parse_slot_config(nullptr);
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InvalidJson, ""));
}

void test_invalid_json_gives_offset()
{
    const char* json = R"({"motor": {"stepsPerVend": 6400}, "slots": [{"slot": 1,)";
    const SlotParseResult r = parse_slot_config(json);
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InvalidJson, ""));
    TEST_ASSERT_TRUE(r.json_error_offset > 0);
    TEST_ASSERT_TRUE(r.json_error_offset <= std::strlen(json));
}

void test_non_object_root_is_invalid_json()
{
    const SlotParseResult r = parse_slot_config(R"([{"slot": 1, "pins": [18]}])");
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
    const SlotParseResult r = parse_slot_config(json.c_str());
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_EQUAL(ConfigIssueKind::InvalidJson, r.issues[0].kind);
    TEST_ASSERT_TRUE(r.json_error_offset > 0);
    TEST_ASSERT_TRUE(r.json_error_offset < json.size());
}

// The schema itself is depth 4 (object > array > object > array) and must stay well inside the limit.
void test_schema_depth_is_within_limit()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1, "pins": [18], "meta": {"a": [1]}}])").c_str());
    TEST_ASSERT_TRUE(r.ok);
}

void test_unknown_keys_are_ignored_everywhere()
{
    const char* json = R"({
        "version": 2,
        "wifi": {"ssid": "x"},
        "motor": {"stepsPerVend": 6400, "stepIntervalUs": 312},
        "slots": [{"slot": 1, "pins": [18], "label": "cola"}],
        "notes": [1, 2, 3]
    })";
    const SlotParseResult r = parse_slot_config(json);
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
    TEST_ASSERT_EQUAL_UINT32(1, r.config.slot_count);
}

// A file from a newer firmware still applies; the caller gets a hint.
void test_newer_version_is_flagged_but_ok()
{
    const SlotParseResult r = parse_slot_config(R"({"version": 3, "motor": {"stepsPerVend": 6400}, "slots": [{"slot": 1, "pins": [18]}]})");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::NewerVersion, "version"));
    TEST_ASSERT_EQUAL_UINT32(1, r.config.slot_count);
}

void test_current_version_gives_no_issue()
{
    TEST_ASSERT_EQUAL_UINT32(0, parse_slot_config(R"({"version": 2, "motor": {"stepsPerVend": 6400}, "slots": [{"slot": 1, "pins": [18]}]})").issue_count);
}

// A v1 file is not silently accepted with an older version number: it lacks
// "motor" and uses the removed "pin" scalar, and both are reported.
void test_v1_file_is_unusable()
{
    const SlotParseResult r = parse_slot_config(R"({"version": 1, "slots": [{"slot": 1, "pin": 18}]})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "motor"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "slots[0].pins"));
}

void test_non_numeric_version_is_wrong_type_and_not_ok()
{
    const SlotParseResult r = parse_slot_config(R"({"version": "2", "motor": {"stepsPerVend": 6400}, "slots": [{"slot": 1, "pins": [18]}]})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "version"));
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_valid_file_gives_steps_and_slots_in_file_order);
    RUN_TEST(test_single_slot_file_is_ok);
    RUN_TEST(test_empty_object_is_missing_motor_and_slots);
    RUN_TEST(test_missing_motor_block_is_missing_field);
    RUN_TEST(test_missing_steps_per_vend_is_missing_field);
    RUN_TEST(test_motor_not_an_object_is_wrong_type);
    RUN_TEST(test_nullptr_is_invalid_json);
    RUN_TEST(test_invalid_json_gives_offset);
    RUN_TEST(test_non_object_root_is_invalid_json);
    RUN_TEST(test_deeply_nested_json_is_rejected_before_parsing);
    RUN_TEST(test_schema_depth_is_within_limit);
    RUN_TEST(test_unknown_keys_are_ignored_everywhere);
    RUN_TEST(test_newer_version_is_flagged_but_ok);
    RUN_TEST(test_current_version_gives_no_issue);
    RUN_TEST(test_v1_file_is_unusable);
    RUN_TEST(test_non_numeric_version_is_wrong_type_and_not_ok);
    return UNITY_END();
}
