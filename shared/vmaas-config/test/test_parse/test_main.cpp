/**
 * @file test_main.cpp
 * @brief Host tests for parse_config() merge behaviour.
 *
 * The contract under test: the file only has to mention what differs from
 * the firmware defaults, a broken file never changes anything, and a field of
 * the wrong type is rejected on its own without dragging the rest down.
 */
#include <unity.h>
#include <cstring>
#include <string>
#include "config.h"
#include "config_parser.h"

using namespace vmaas;

namespace
{
    constexpr Config DEFAULTS = {
        {32, 33, 21, 22}, // pins: uart_rx, uart_tx, i2c_sda, i2c_scl
        {115200},         // uart.baud_rate
        {100000},         // i2c.clock_hz
    };

    bool same(const Config& a, const Config& b)
    {
        return a.pins.uart_rx == b.pins.uart_rx && a.pins.uart_tx == b.pins.uart_tx &&
               a.pins.i2c_sda == b.pins.i2c_sda && a.pins.i2c_scl == b.pins.i2c_scl &&
               a.uart.baud_rate == b.uart.baud_rate && a.i2c.clock_hz == b.i2c.clock_hz;
    }

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

// The minimal valid file changes nothing.
void test_empty_object_gives_defaults_and_no_issues()
{
    const ParseResult r = parse_config("{}", DEFAULTS);
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_TRUE(same(r.config, DEFAULTS));
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
}

// nullptr is treated like an unreadable file: defaults, one InvalidJson issue.
void test_nullptr_gives_defaults_with_invalid_json()
{
    const ParseResult r = parse_config(nullptr, DEFAULTS);
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_TRUE(same(r.config, DEFAULTS));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InvalidJson, ""));
}

// Only the mentioned field changes; siblings keep their defaults.
void test_partial_file_overrides_only_named_field()
{
    const ParseResult r = parse_config(R"({"pins": {"uart_rx": 16}})", DEFAULTS);
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_EQUAL_INT(16, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_INT(33, r.config.pins.uart_tx);
    TEST_ASSERT_EQUAL_INT(21, r.config.pins.i2c_sda);
    TEST_ASSERT_EQUAL_INT(22, r.config.pins.i2c_scl);
    TEST_ASSERT_EQUAL_INT(115200, r.config.uart.baud_rate);
    TEST_ASSERT_EQUAL_UINT32(100000, r.config.i2c.clock_hz);
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
}

// Every field can be set from the file.
void test_full_file_applies_all_fields()
{
    const char* json = R"({
        "version": 1,
        "pins": {"uart_rx": 16, "uart_tx": 17, "i2c_sda": 25, "i2c_scl": 26},
        "uart": {"baud_rate": 57600},
        "i2c": {"clock_hz": 400000}
    })";
    const ParseResult r = parse_config(json, DEFAULTS);
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_EQUAL_INT(16, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_INT(17, r.config.pins.uart_tx);
    TEST_ASSERT_EQUAL_INT(25, r.config.pins.i2c_sda);
    TEST_ASSERT_EQUAL_INT(26, r.config.pins.i2c_scl);
    TEST_ASSERT_EQUAL_INT(57600, r.config.uart.baud_rate);
    TEST_ASSERT_EQUAL_UINT32(400000, r.config.i2c.clock_hz);
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
}

// Broken JSON: nothing applied, the error offset points into the text.
void test_invalid_json_gives_defaults_and_offset()
{
    const char* json = R"({"pins": {"uart_rx": 16,)";
    const ParseResult r = parse_config(json, DEFAULTS);
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_TRUE(same(r.config, DEFAULTS));
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InvalidJson, ""));
    TEST_ASSERT_TRUE(r.json_error_offset > 0);
    TEST_ASSERT_TRUE(r.json_error_offset <= std::strlen(json));
}

// A top-level array is valid JSON but not a config object.
void test_non_object_root_is_invalid_json()
{
    const ParseResult r = parse_config("[1, 2, 3]", DEFAULTS);
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_TRUE(same(r.config, DEFAULTS));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InvalidJson, ""));
}

// A string where a number belongs: that field is rejected, the neighbour is applied.
void test_wrong_type_rejects_only_that_field()
{
    const ParseResult r = parse_config(R"({"pins": {"uart_rx": "32", "uart_tx": 17}})", DEFAULTS);
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_EQUAL_INT(32, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_INT(17, r.config.pins.uart_tx);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "pins.uart_rx"));
}

// A non-integer number is not a pin.
void test_fractional_number_is_wrong_type()
{
    const ParseResult r = parse_config(R"({"pins": {"uart_rx": 16.5}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(32, r.config.pins.uart_rx);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "pins.uart_rx"));
}

// A section that is not an object is rejected as one issue; its fields keep defaults.
void test_section_of_wrong_type_is_one_issue()
{
    const ParseResult r = parse_config(R"({"pins": 5, "uart": {"baud_rate": 9600}})", DEFAULTS);
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_TRUE(same(r.config, Config{{32, 33, 21, 22}, {9600}, {100000}}));
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "pins"));
}

// A hostile file can nest brackets far deeper than the stack can take: cJSON
// recurses once per level, and the ESP-IDF main task has a few kilobytes. The
// pre-scan must reject such a file before cJSON ever sees it.
void test_deeply_nested_json_is_rejected_before_parsing()
{
    std::string json = "{\"x\":";
    for (int i = 0; i < 20; ++i)
        json += '[';
    json += '1';
    for (int i = 0; i < 20; ++i)
        json += ']';
    json += '}';

    const ParseResult r = parse_config(json.c_str(), DEFAULTS);
    TEST_ASSERT_FALSE(r.json_valid);
    TEST_ASSERT_TRUE(same(r.config, DEFAULTS));
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(ConfigIssueKind::InvalidJson),
                            static_cast<uint8_t>(r.issues[0].kind));
    TEST_ASSERT_TRUE(r.json_error_offset > 0);
    TEST_ASSERT_TRUE(r.json_error_offset < json.size());
}

// Positive control for the depth pre-scan: the real schema nests two levels
// deep and must keep parsing normally.
void test_nesting_within_limit_still_parses()
{
    const ParseResult r = parse_config(R"({"pins": {"uart_rx": 16}})", DEFAULTS);
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_EQUAL_INT(16, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_empty_object_gives_defaults_and_no_issues);
    RUN_TEST(test_nullptr_gives_defaults_with_invalid_json);
    RUN_TEST(test_partial_file_overrides_only_named_field);
    RUN_TEST(test_full_file_applies_all_fields);
    RUN_TEST(test_invalid_json_gives_defaults_and_offset);
    RUN_TEST(test_non_object_root_is_invalid_json);
    RUN_TEST(test_wrong_type_rejects_only_that_field);
    RUN_TEST(test_fractional_number_is_wrong_type);
    RUN_TEST(test_section_of_wrong_type_is_one_issue);
    RUN_TEST(test_deeply_nested_json_is_rejected_before_parsing);
    RUN_TEST(test_nesting_within_limit_still_parses);
    return UNITY_END();
}
