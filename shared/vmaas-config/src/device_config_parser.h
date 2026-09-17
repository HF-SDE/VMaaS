#pragma once
/**
 * @file device_config_parser.h
 * @brief Parse and validate a Main-Controller config.json text.
 */
#include "device_config.h"

namespace vmaas
{
    /**
     * @brief Parse @p json_text into device settings.
     *
     * Starts from device_config_defaults() and overwrites each field the file
     * supplies cleanly. A malformed field is reported as an issue and leaves
     * its default in place, so result.config is usable even when ok is false
     * and even when json_valid is false. This is the opposite of
     * parse_slot_config(), which yields nothing when anything is wrong,
     * because there is no safe default wiring for a motor.
     *
     * - Missing sections are not an error; their fields take defaults.
     * - Unknown keys are ignored. "version" above DEVICE_SCHEMA_VERSION gives
     *   NewerVersion and parsing continues.
     * - A string longer than its buffer gives OutOfRange and keeps the
     *   default. Values are never silently truncated: a shortened hostname or
     *   machine id is worse than none, because it looks plausible in a log.
     * - mqtt_port must be 1-65535; timings must be 1-600000 ms. Zero is
     *   rejected: a zero debounce or timeout makes the keypad unusable and a
     *   caller has no way to notice.
     * - Invalid JSON, a nullptr, a non-object root, or nesting deeper than
     *   MAX_NESTING_DEPTH gives json_valid == false, one InvalidJson issue and
     *   json_error_offset set. The depth check runs before cJSON recurses, so
     *   a hostile or corrupt file cannot exhaust the task stack.
     *
     * @param json_text NUL-terminated JSON text, or nullptr.
     * @return Settings plus issues. Never fails.
     */
    DeviceParseResult parse_device_config(const char* json_text);
}
