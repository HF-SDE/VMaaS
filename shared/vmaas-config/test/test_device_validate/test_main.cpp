/**
 * @file test_main.cpp
 * @brief Host tests for parse_device_config() validation and hostile input.
 *
 * The contract under test: every rejection names its field, leaves the
 * default in place, and still returns a usable config. Nothing crashes and
 * nothing is silently truncated.
 */
#include <unity.h>
#include <cstring>
#include <string>
#include "device_config.h"
#include "device_config_parser.h"

using namespace vmaas;

namespace
{
    bool has_issue(const DeviceParseResult& r, ConfigIssueKind kind, const char* field)
    {
        for (size_t i = 0; i < r.issue_count; ++i)
            if (r.issues[i].kind == kind && std::strcmp(r.issues[i].field, field) == 0)
                return true;
        return false;
    }
}

void setUp() {}
void tearDown() {}

void test_over_long_name_is_rejected_and_default_kept()
{
    // 17 characters: one too many for MAX_DEVICE_NAME.
    const DeviceParseResult r = parse_device_config(R"({"device": {"name": "ABCDEFGHIJKLMNOPQ"}})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "device.name"));
    TEST_ASSERT_EQUAL_STRING("", r.config.name); // NOT truncated to 16 chars
}

void test_name_of_exactly_sixteen_chars_is_accepted()
{
    const DeviceParseResult r = parse_device_config(R"({"device": {"name": "ABCDEFGHIJKLMNOP"}})");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_STRING("ABCDEFGHIJKLMNOP", r.config.name);
}

void test_port_out_of_range_is_rejected_and_default_kept()
{
    const DeviceParseResult r = parse_device_config(R"({"backend": {"mqtt_port": 70000}})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "backend.mqtt_port"));
    TEST_ASSERT_EQUAL_UINT16(8883, r.config.mqtt_port);
}

void test_zero_timing_is_rejected_and_default_kept()
{
    const DeviceParseResult r = parse_device_config(R"({"timings": {"keypad_debounce_ms": 0}})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "timings.keypad_debounce_ms"));
    TEST_ASSERT_EQUAL_UINT32(20, r.config.keypad_debounce_ms);
}

void test_long_timing_field_path_is_not_truncated()
{
    // The longest dotted path in this schema is 33 characters. It has to survive
    // intact, or a log line names a field nobody can find.
    const DeviceParseResult r = parse_device_config(R"({"timings": {"slot_entry_result_hold_ms": 0}})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "timings.slot_entry_result_hold_ms"));
}

void test_wrong_type_is_rejected_and_default_kept()
{
    const DeviceParseResult r = parse_device_config(R"({"backend": {"mqtt_port": "8883"}})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "backend.mqtt_port"));
    TEST_ASSERT_EQUAL_UINT16(8883, r.config.mqtt_port);
}

void test_section_of_wrong_type_is_reported_once()
{
    const DeviceParseResult r = parse_device_config(R"({"device": "not an object"})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "device"));
    TEST_ASSERT_EQUAL_STRING("", r.config.name);
}

void test_malformed_json_still_yields_defaults()
{
    const DeviceParseResult r = parse_device_config(R"({"device": )");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_EQUAL_UINT32(20, r.config.keypad_debounce_ms);
    TEST_ASSERT_EQUAL_UINT16(8883, r.config.mqtt_port);
}

void test_nullptr_is_safe()
{
    const DeviceParseResult r = parse_device_config(nullptr);
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_EQUAL_UINT32(20, r.config.keypad_debounce_ms);
}

void test_non_object_root_is_rejected()
{
    const DeviceParseResult r = parse_device_config(R"([1, 2, 3])");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_FALSE(r.json_valid);
}

void test_deep_nesting_is_rejected_before_cjson_recurses()
{
    // 5000 opening brackets. Without the depth guard this recurses 5000 frames
    // deep inside cJSON and blows a FreeRTOS task stack on the device.
    std::string bomb(5000, '[');
    bomb.append(5000, ']');
    const DeviceParseResult r = parse_device_config(bomb.c_str());
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_TRUE(r.json_error_offset > 0);
    TEST_ASSERT_EQUAL_UINT32(20, r.config.keypad_debounce_ms);
}

void test_braces_inside_a_string_do_not_count_as_nesting()
{
    const DeviceParseResult r = parse_device_config(R"({"device": {"name": "{{{{{{{{{{"}})");
    TEST_ASSERT_TRUE(r.json_valid); // depth is 2, not 12
    TEST_ASSERT_EQUAL_STRING("{{{{{{{{{{", r.config.name);
}

void test_issue_list_saturates_without_overflowing()
{
    // Twelve bad fields, room for eight issues.
    const DeviceParseResult r = parse_device_config(R"({
        "device":  { "name": 1, "machine_id": 2 },
        "backend": { "mqtt_host": 3, "client_id": 4, "mqtt_port": 0 },
        "timings": { "keypad_debounce_ms": 0, "slot_entry_timeout_ms": 0,
                     "slot_entry_result_hold_ms": 0 }
    })");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_LESS_OR_EQUAL_UINT(DeviceParseResult::MAX_ISSUES, r.issue_count);
    TEST_ASSERT_EQUAL_UINT32(20, r.config.keypad_debounce_ms);
}

// A double far outside long long cannot be cast to one: that conversion is
// undefined behaviour, not a wrap-around. The range test has to run first.
void test_astronomical_number_is_rejected_before_any_cast()
{
    const DeviceParseResult r = parse_device_config(R"({"backend": {"mqtt_port": 1e300}})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "backend.mqtt_port"));
    TEST_ASSERT_EQUAL_UINT16(8883, r.config.mqtt_port);
}

// 1e400 overflows double itself, so cJSON yields infinity.
void test_infinity_is_rejected()
{
    const DeviceParseResult r = parse_device_config(R"({"timings": {"keypad_debounce_ms": 1e400}})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(20, r.config.keypad_debounce_ms);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_over_long_name_is_rejected_and_default_kept);
    RUN_TEST(test_name_of_exactly_sixteen_chars_is_accepted);
    RUN_TEST(test_port_out_of_range_is_rejected_and_default_kept);
    RUN_TEST(test_zero_timing_is_rejected_and_default_kept);
    RUN_TEST(test_long_timing_field_path_is_not_truncated);
    RUN_TEST(test_wrong_type_is_rejected_and_default_kept);
    RUN_TEST(test_section_of_wrong_type_is_reported_once);
    RUN_TEST(test_malformed_json_still_yields_defaults);
    RUN_TEST(test_nullptr_is_safe);
    RUN_TEST(test_non_object_root_is_rejected);
    RUN_TEST(test_deep_nesting_is_rejected_before_cjson_recurses);
    RUN_TEST(test_braces_inside_a_string_do_not_count_as_nesting);
    RUN_TEST(test_issue_list_saturates_without_overflowing);
    RUN_TEST(test_astronomical_number_is_rejected_before_any_cast);
    RUN_TEST(test_infinity_is_rejected);
    return UNITY_END();
}
