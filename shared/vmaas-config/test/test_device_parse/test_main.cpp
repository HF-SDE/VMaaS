/**
 * @file test_main.cpp
 * @brief Host tests for parse_device_config() structure handling.
 *
 * The contract under test: a well-formed file yields every field; absent
 * sections fall back to defaults without being an error; unknown keys and a
 * newer schema version are tolerated; config is usable in every case.
 */
#include <unity.h>
#include <cstring>
#include "device_config.h"
#include "device_config_parser.h"

using namespace vmaas;

namespace
{
    constexpr const char* FULL = R"({
        "version": 2,
        "device":  { "name": "VMaaS-0042", "machine_id": "5f2c1a90-6b3e-4d21-9f77-1c0a8e4b2d55" },
        "backend": { "api_base_url": "https://vmaas.dk/api" },
        "timings": { "keypad_debounce_ms": 25, "slot_entry_timeout_ms": 8000,
                     "slot_entry_result_hold_ms": 1500 }
    })";
}

void setUp() {}
void tearDown() {}

void test_full_file_yields_every_field()
{
    const DeviceParseResult r = parse_device_config(FULL);
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_EQUAL_UINT(0, r.issue_count);
    TEST_ASSERT_EQUAL_STRING("VMaaS-0042", r.config.name);
    TEST_ASSERT_EQUAL_STRING("5f2c1a90-6b3e-4d21-9f77-1c0a8e4b2d55", r.config.machine_id);
    TEST_ASSERT_EQUAL_STRING("https://vmaas.dk/api", r.config.api_base_url);
    TEST_ASSERT_EQUAL_UINT32(25, r.config.keypad_debounce_ms);
    TEST_ASSERT_EQUAL_UINT32(8000, r.config.slot_entry_timeout_ms);
    TEST_ASSERT_EQUAL_UINT32(1500, r.config.slot_entry_result_hold_ms);
}

void test_absent_sections_take_defaults_and_are_not_an_error()
{
    const DeviceParseResult r = parse_device_config(R"({"version": 2})");
    const DeviceConfig d = device_config_defaults();
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_STRING("", r.config.name);
    TEST_ASSERT_EQUAL_STRING("", r.config.api_base_url);
    TEST_ASSERT_EQUAL_UINT32(d.keypad_debounce_ms, r.config.keypad_debounce_ms);
    TEST_ASSERT_EQUAL_UINT32(d.slot_entry_timeout_ms, r.config.slot_entry_timeout_ms);
    TEST_ASSERT_EQUAL_UINT32(d.slot_entry_result_hold_ms, r.config.slot_entry_result_hold_ms);
}

void test_partial_section_keeps_defaults_for_the_rest()
{
    const DeviceParseResult r = parse_device_config(R"({"timings": {"keypad_debounce_ms": 30}})");
    const DeviceConfig d = device_config_defaults();
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(30, r.config.keypad_debounce_ms);
    TEST_ASSERT_EQUAL_UINT32(d.slot_entry_timeout_ms, r.config.slot_entry_timeout_ms);
}

void test_unknown_keys_are_ignored()
{
    const DeviceParseResult r = parse_device_config(R"({"device": {"name": "A", "colour": "red"}, "zzz": 1})");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_STRING("A", r.config.name);
}

void test_newer_version_is_tolerated()
{
    const DeviceParseResult r = parse_device_config(R"({"version": 99, "device": {"name": "A"}})");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT(1, r.issue_count);
    TEST_ASSERT_EQUAL(ConfigIssueKind::NewerVersion, r.issues[0].kind);
    TEST_ASSERT_EQUAL_STRING("A", r.config.name);
}

// A v1 file predates api_base_url, so its backend section carries fields this
// schema no longer knows. It must still parse: the machine keeps working, it
// simply has no API address until someone reflashes the filesystem.
void test_a_v1_file_still_parses_and_leaves_the_api_url_empty()
{
    const DeviceParseResult r = parse_device_config(R"({
        "version": 1,
        "device":  { "name": "Old" },
        "backend": { "mqtt_host": "mqtt.vmaas.dk", "mqtt_port": 8883, "client_id": "x" }
    })");
    TEST_ASSERT_TRUE(r.json_valid);
    TEST_ASSERT_EQUAL_STRING("Old", r.config.name);
    TEST_ASSERT_EQUAL_STRING("", r.config.api_base_url);
}

void test_door_code_and_unlock_time_are_read()
{
    const char* json = R"({"version":3,"door":{"code":"4711"},"timings":{"door_unlock_ms":750}})";
    const DeviceParseResult r = parse_device_config(json);
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_STRING("4711", r.config.door_code);
    TEST_ASSERT_EQUAL_UINT32(750, r.config.door_unlock_ms);
}

// The default must leave the door unreachable from the keypad.
void test_an_absent_door_section_disables_the_code()
{
    const DeviceParseResult r = parse_device_config(R"({"version":3})");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_STRING("", r.config.door_code);
    TEST_ASSERT_EQUAL_UINT32(500, r.config.door_unlock_ms);
}

// A coil told to hold for a minute is a burnt coil.
void test_an_out_of_range_unlock_time_is_refused_and_defaulted()
{
    const DeviceParseResult r = parse_device_config(R"({"version":3,"timings":{"door_unlock_ms":60000}})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(500, r.config.door_unlock_ms);
}

void test_an_over_long_door_code_is_refused_and_defaulted()
{
    const DeviceParseResult r = parse_device_config(R"({"version":3,"door":{"code":"123456789"}})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_STRING("", r.config.door_code);
}

// ServiceCode only ever buffers '0'-'9': a non-digit code could never be
// typed, which would permanently disable keypad release while still latching
// the recogniser on '*' for the full timeout on every attempt.
void test_a_non_digit_door_code_is_refused_and_defaulted()
{
    const DeviceParseResult r = parse_device_config(R"({"version":3,"door":{"code":"abcd"}})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_UINT(1, r.issue_count);
    TEST_ASSERT_EQUAL(ConfigIssueKind::OutOfRange, r.issues[0].kind);
    TEST_ASSERT_EQUAL_STRING("door.code", r.issues[0].field);
    TEST_ASSERT_EQUAL_STRING("", r.config.door_code);
}

// A code that is mostly digits but has one stray non-digit character must
// still be refused outright, not silently accepted for its digit prefix.
void test_a_door_code_with_one_non_digit_character_is_refused()
{
    const DeviceParseResult r = parse_device_config(R"({"version":3,"door":{"code":"471x"}})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_STRING("", r.config.door_code);
}

// A v2 file on a machine in the field still parses; both fields default.
void test_a_version_two_file_still_parses()
{
    const DeviceParseResult r = parse_device_config(R"({"version":2,"timings":{"keypad_debounce_ms":20}})");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_STRING("", r.config.door_code);
}


/**
 * Schema v4: the broker address may be overridden from the file.
 *
 * Until v4 it could only come back from POST /device/activate, which meant a
 * machine could not be pointed at a different broker without being activated
 * again - a new certificate and a new claim to change an IP. An empty host and
 * a zero port mean "use whatever activation stored", so a file that says
 * nothing about the broker behaves exactly as it did before.
 */
void test_broker_host_and_port_are_read()
{
    const DeviceParseResult r = parse_device_config(R"({
        "version": 4,
        "broker": { "host": "192.168.78.225", "port": 8883 }
    })");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT(0, r.issue_count);
    TEST_ASSERT_EQUAL_STRING("192.168.78.225", r.config.broker_host);
    TEST_ASSERT_EQUAL_UINT16(8883, r.config.broker_port);
}

void test_an_absent_broker_section_defers_to_activation()
{
    const DeviceParseResult r = parse_device_config(R"({"version": 4})");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_STRING("", r.config.broker_host);
    TEST_ASSERT_EQUAL_UINT16(0, r.config.broker_port);
}

// The host may be overridden on its own: a broker that moved to a new address
// on the standard port needs no port line, and writing one only invites drift.
void test_a_broker_host_without_a_port_leaves_the_port_deferred()
{
    const DeviceParseResult r = parse_device_config(R"({
        "version": 4,
        "broker": { "host": "broker.vmaas.dk" }
    })");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_STRING("broker.vmaas.dk", r.config.broker_host);
    TEST_ASSERT_EQUAL_UINT16(0, r.config.broker_port);
}

void test_an_out_of_range_broker_port_is_refused_and_deferred()
{
    const DeviceParseResult r = parse_device_config(R"({
        "version": 4,
        "broker": { "host": "192.168.78.225", "port": 70000 }
    })");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_UINT16(0, r.config.broker_port);
}

// Port 0 is not a usable port and is also the sentinel for "defer to
// activation", so writing it is refused rather than silently meaning that.
void test_a_zero_broker_port_is_refused()
{
    const DeviceParseResult r = parse_device_config(R"({
        "version": 4,
        "broker": { "host": "192.168.78.225", "port": 0 }
    })");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_UINT16(0, r.config.broker_port);
}

void test_an_over_long_broker_host_is_refused_and_deferred()
{
    // MAX_BROKER_HOST is 64, so 64 characters is one too many with the NUL.
    const DeviceParseResult r = parse_device_config(R"({
        "version": 4,
        "broker": { "host": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
    })");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL_STRING("", r.config.broker_host);
}

// A machine already in the field carries a v3 file. It must keep working and
// must not be told it is newer than the firmware understands.
void test_a_v3_file_parses_and_defers_the_broker()
{
    const DeviceParseResult r = parse_device_config(R"({
        "version": 3,
        "backend": { "api_base_url": "https://vmaas.dk/api" }
    })");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT(0, r.issue_count);
    TEST_ASSERT_EQUAL_STRING("https://vmaas.dk/api", r.config.api_base_url);
    TEST_ASSERT_EQUAL_STRING("", r.config.broker_host);
}

void test_dispense_timeout_is_read()
{
    const DeviceParseResult r = parse_device_config(R"({"version":4,"timings":{"dispense_timeout_ms":45000}})");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(45000, r.config.dispense_timeout_ms);
}

void test_absent_dispense_timeout_defaults_to_thirty_seconds()
{
    const DeviceParseResult r = parse_device_config(R"({"version":4,"timings":{"keypad_debounce_ms":20}})");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(30000, r.config.dispense_timeout_ms);
    TEST_ASSERT_EQUAL_UINT32(30000, device_config_defaults().dispense_timeout_ms);
}

// Zero means "no timeout", so it is a value here, not an error like the other timings.
void test_zero_dispense_timeout_is_accepted()
{
    const DeviceParseResult r = parse_device_config(R"({"version":4,"timings":{"dispense_timeout_ms":0}})");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT(0, r.issue_count);
    TEST_ASSERT_EQUAL_UINT32(0, r.config.dispense_timeout_ms);
}

void test_over_long_dispense_timeout_is_refused_and_defaulted()
{
    const DeviceParseResult r = parse_device_config(R"({"version":4,"timings":{"dispense_timeout_ms":600001}})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_EQUAL(ConfigIssueKind::OutOfRange, r.issues[0].kind);
    TEST_ASSERT_EQUAL_STRING("timings.dispense_timeout_ms", r.issues[0].field);
    TEST_ASSERT_EQUAL_UINT32(30000, r.config.dispense_timeout_ms);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_full_file_yields_every_field);
    RUN_TEST(test_absent_sections_take_defaults_and_are_not_an_error);
    RUN_TEST(test_partial_section_keeps_defaults_for_the_rest);
    RUN_TEST(test_unknown_keys_are_ignored);
    RUN_TEST(test_newer_version_is_tolerated);
    RUN_TEST(test_a_v1_file_still_parses_and_leaves_the_api_url_empty);
    RUN_TEST(test_door_code_and_unlock_time_are_read);
    RUN_TEST(test_an_absent_door_section_disables_the_code);
    RUN_TEST(test_an_out_of_range_unlock_time_is_refused_and_defaulted);
    RUN_TEST(test_an_over_long_door_code_is_refused_and_defaulted);
    RUN_TEST(test_a_non_digit_door_code_is_refused_and_defaulted);
    RUN_TEST(test_a_door_code_with_one_non_digit_character_is_refused);
    RUN_TEST(test_a_version_two_file_still_parses);
    RUN_TEST(test_broker_host_and_port_are_read);
    RUN_TEST(test_an_absent_broker_section_defers_to_activation);
    RUN_TEST(test_a_broker_host_without_a_port_leaves_the_port_deferred);
    RUN_TEST(test_an_out_of_range_broker_port_is_refused_and_deferred);
    RUN_TEST(test_a_zero_broker_port_is_refused);
    RUN_TEST(test_an_over_long_broker_host_is_refused_and_deferred);
    RUN_TEST(test_a_v3_file_parses_and_defers_the_broker);
    RUN_TEST(test_dispense_timeout_is_read);
    RUN_TEST(test_absent_dispense_timeout_defaults_to_thirty_seconds);
    RUN_TEST(test_zero_dispense_timeout_is_accepted);
    RUN_TEST(test_over_long_dispense_timeout_is_refused_and_defaulted);
    return UNITY_END();
}
