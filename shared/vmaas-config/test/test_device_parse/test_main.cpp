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
        "version": 1,
        "device":  { "name": "VMaaS-0042", "machine_id": "5f2c1a90-6b3e-4d21-9f77-1c0a8e4b2d55" },
        "backend": { "mqtt_host": "mqtt.vmaas.dk", "mqtt_port": 8883, "client_id": "vmaas-0042" },
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
    TEST_ASSERT_EQUAL_STRING("mqtt.vmaas.dk", r.config.mqtt_host);
    TEST_ASSERT_EQUAL_UINT16(8883, r.config.mqtt_port);
    TEST_ASSERT_EQUAL_STRING("vmaas-0042", r.config.mqtt_client_id);
    TEST_ASSERT_EQUAL_UINT32(25, r.config.keypad_debounce_ms);
    TEST_ASSERT_EQUAL_UINT32(8000, r.config.slot_entry_timeout_ms);
    TEST_ASSERT_EQUAL_UINT32(1500, r.config.slot_entry_result_hold_ms);
}

void test_absent_sections_take_defaults_and_are_not_an_error()
{
    const DeviceParseResult r = parse_device_config(R"({"version": 1})");
    const DeviceConfig d = device_config_defaults();
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_STRING("", r.config.name);
    TEST_ASSERT_EQUAL_UINT16(d.mqtt_port, r.config.mqtt_port);
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

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_full_file_yields_every_field);
    RUN_TEST(test_absent_sections_take_defaults_and_are_not_an_error);
    RUN_TEST(test_partial_section_keeps_defaults_for_the_rest);
    RUN_TEST(test_unknown_keys_are_ignored);
    RUN_TEST(test_newer_version_is_tolerated);
    return UNITY_END();
}
