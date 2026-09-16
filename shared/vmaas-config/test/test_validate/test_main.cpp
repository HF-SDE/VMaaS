/**
 * @file test_main.cpp
 * @brief Host tests for parse_config() validation rules.
 *
 * Every rule that can make a pin assignment physically wrong on the ESP32 is
 * checked here: GPIO range, input-only pins in output roles, two roles on one
 * pin, and non-positive bus speeds. Also the forward-compatibility rules:
 * unknown keys and a newer schema version must not break parsing.
 */
#include <unity.h>
#include <cstring>
#include "config.h"
#include "config_parser.h"

using namespace vmaas;

namespace
{
    constexpr Config DEFAULTS = {{32, 33, 21, 22}, {115200}, {100000}};

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

void test_pin_above_39_is_out_of_range()
{
    const ParseResult r = parse_config(R"({"pins": {"uart_rx": 40}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(32, r.config.pins.uart_rx);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "pins.uart_rx"));
}

void test_negative_pin_is_out_of_range()
{
    const ParseResult r = parse_config(R"({"pins": {"i2c_scl": -1}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(22, r.config.pins.i2c_scl);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "pins.i2c_scl"));
}

void test_boundary_pins_0_and_39_are_accepted_for_rx()
{
    const ParseResult a = parse_config(R"({"pins": {"uart_rx": 0}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(0, a.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_UINT32(0, a.issue_count);
    const ParseResult b = parse_config(R"({"pins": {"uart_rx": 39}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(39, b.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_UINT32(0, b.issue_count);
}

// GPIO 34-39 have no output driver on the ESP32.
void test_input_only_pin_rejected_for_output_roles()
{
    const ParseResult r = parse_config(
        R"({"pins": {"uart_tx": 34, "i2c_sda": 36, "i2c_scl": 39}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(33, r.config.pins.uart_tx);
    TEST_ASSERT_EQUAL_INT(21, r.config.pins.i2c_sda);
    TEST_ASSERT_EQUAL_INT(22, r.config.pins.i2c_scl);
    TEST_ASSERT_EQUAL_UINT32(3, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InputOnlyPin, "pins.uart_tx"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InputOnlyPin, "pins.i2c_sda"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InputOnlyPin, "pins.i2c_scl"));
}

void test_pin_33_is_still_an_output_pin()
{
    const ParseResult r = parse_config(R"({"pins": {"i2c_sda": 33, "uart_tx": 25}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(33, r.config.pins.i2c_sda);
    TEST_ASSERT_EQUAL_INT(25, r.config.pins.uart_tx);
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
}

// Two file fields on one GPIO: the later one (in uart_rx, uart_tx, i2c_sda, i2c_scl order) loses.
void test_duplicate_between_two_file_fields_rejects_the_later_one()
{
    const ParseResult r = parse_config(R"({"pins": {"uart_rx": 16, "uart_tx": 16}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(16, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_INT(33, r.config.pins.uart_tx);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::DuplicatePin, "pins.uart_tx"));
}

// A file field colliding with a default: the file field loses, whatever its order.
void test_duplicate_with_a_default_rejects_the_file_field()
{
    const ParseResult r = parse_config(R"({"pins": {"uart_rx": 21}})", DEFAULTS); // 21 is default i2c_sda
    TEST_ASSERT_EQUAL_INT(32, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_INT(21, r.config.pins.i2c_sda);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::DuplicatePin, "pins.uart_rx"));
}

// Moving a default out of the way in the same file is fine.
void test_swapping_two_pins_in_one_file_is_accepted()
{
    const ParseResult r = parse_config(R"({"pins": {"uart_rx": 33, "uart_tx": 32}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(33, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_INT(32, r.config.pins.uart_tx);
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
}

// A rejected pin falls back to its default, and that default takes part in the duplicate check.
void test_rejected_pin_reverts_before_duplicate_check()
{
    // uart_tx 40 is out of range -> reverts to 33. uart_rx 33 then collides with it and loses.
    const ParseResult r = parse_config(R"({"pins": {"uart_rx": 33, "uart_tx": 40}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(32, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_INT(33, r.config.pins.uart_tx);
    TEST_ASSERT_EQUAL_UINT32(2, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "pins.uart_tx"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::DuplicatePin, "pins.uart_rx"));
}

// A revert can create a new collision with a pair already checked; the scan must catch it.
void test_duplicate_cascade_after_revert()
{
    // uart_tx 21 collides with default i2c_sda 21 -> uart_tx reverts to 33.
    // Now uart_rx 33 (file) collides with uart_tx 33 (default) -> uart_rx reverts to 32.
    const ParseResult r = parse_config(R"({"pins": {"uart_rx": 33, "uart_tx": 21}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(32, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_INT(33, r.config.pins.uart_tx);
    TEST_ASSERT_EQUAL_INT(21, r.config.pins.i2c_sda);
    TEST_ASSERT_EQUAL_UINT32(2, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::DuplicatePin, "pins.uart_tx"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::DuplicatePin, "pins.uart_rx"));
}

void test_non_positive_baud_and_clock_are_out_of_range()
{
    const ParseResult r = parse_config(R"({"uart": {"baud_rate": 0}, "i2c": {"clock_hz": -5}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(115200, r.config.uart.baud_rate);
    TEST_ASSERT_EQUAL_UINT32(100000, r.config.i2c.clock_hz);
    TEST_ASSERT_EQUAL_UINT32(2, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "uart.baud_rate"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "i2c.clock_hz"));
}

void test_values_too_large_for_destination_are_out_of_range()
{
    const ParseResult r = parse_config(
        R"({"uart": {"baud_rate": 3000000000}, "i2c": {"clock_hz": 5000000000}})", DEFAULTS);
    TEST_ASSERT_EQUAL_INT(115200, r.config.uart.baud_rate);
    TEST_ASSERT_EQUAL_UINT32(100000, r.config.i2c.clock_hz);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "uart.baud_rate"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "i2c.clock_hz"));
}

// Forward compatibility: keys we do not know are not errors.
void test_unknown_keys_are_ignored_everywhere()
{
    const char* json = R"({
        "version": 1,
        "wifi": {"ssid": "x"},
        "pins": {"uart_rx": 16, "spare": 5},
        "uart": {"baud_rate": 9600, "parity": "none"}
    })";
    const ParseResult r = parse_config(json, DEFAULTS);
    TEST_ASSERT_EQUAL_INT(16, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_INT(9600, r.config.uart.baud_rate);
    TEST_ASSERT_EQUAL_UINT32(0, r.issue_count);
}

// A file from a newer firmware still applies; the caller gets a hint.
void test_newer_version_is_flagged_but_applied()
{
    const ParseResult r = parse_config(R"({"version": 2, "pins": {"uart_rx": 16}})", DEFAULTS);
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_EQUAL_INT(16, r.config.pins.uart_rx);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::NewerVersion, "version"));
}

void test_current_and_older_version_give_no_issue()
{
    TEST_ASSERT_EQUAL_UINT32(0, parse_config(R"({"version": 1})", DEFAULTS).issue_count);
    TEST_ASSERT_EQUAL_UINT32(0, parse_config(R"({"version": 0})", DEFAULTS).issue_count);
}

void test_non_numeric_version_is_wrong_type()
{
    const ParseResult r = parse_config(R"({"version": "1"})", DEFAULTS);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "version"));
}

// Schema v1 can produce at most 7 issues (version + 4 pins + baud + clock), one per field, so
// MAX_ISSUES (8) is never reached. This pins that bound; if a field is added, MAX_ISSUES must
// grow with it.
void test_every_field_wrong_stays_below_max_issues()
{
    const char* json = R"({
        "version": "x",
        "pins": {"uart_rx": "a", "uart_tx": "b", "i2c_sda": "c", "i2c_scl": "d"},
        "uart": {"baud_rate": "e"},
        "i2c": {"clock_hz": "f"}
    })";
    const ParseResult r = parse_config(json, DEFAULTS);
    TEST_ASSERT_TRUE(r.issue_count <= ParseResult::MAX_ISSUES);
    TEST_ASSERT_EQUAL_UINT32(7, r.issue_count);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_pin_above_39_is_out_of_range);
    RUN_TEST(test_negative_pin_is_out_of_range);
    RUN_TEST(test_boundary_pins_0_and_39_are_accepted_for_rx);
    RUN_TEST(test_input_only_pin_rejected_for_output_roles);
    RUN_TEST(test_pin_33_is_still_an_output_pin);
    RUN_TEST(test_duplicate_between_two_file_fields_rejects_the_later_one);
    RUN_TEST(test_duplicate_with_a_default_rejects_the_file_field);
    RUN_TEST(test_swapping_two_pins_in_one_file_is_accepted);
    RUN_TEST(test_rejected_pin_reverts_before_duplicate_check);
    RUN_TEST(test_duplicate_cascade_after_revert);
    RUN_TEST(test_non_positive_baud_and_clock_are_out_of_range);
    RUN_TEST(test_values_too_large_for_destination_are_out_of_range);
    RUN_TEST(test_unknown_keys_are_ignored_everywhere);
    RUN_TEST(test_newer_version_is_flagged_but_applied);
    RUN_TEST(test_current_and_older_version_give_no_issue);
    RUN_TEST(test_non_numeric_version_is_wrong_type);
    RUN_TEST(test_every_field_wrong_stays_below_max_issues);
    return UNITY_END();
}
