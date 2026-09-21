#pragma once
/**
 * @file device_config.h
 * @brief Device configuration schema for the VMaaS Main-Controller.
 *
 * Schema version 1 (config.json):
 * @code
 * {
 *   "version": 1,
 *   "device":   { "name": "VMaaS-0042", "machine_id": "5f2c1a90-..." },
 *   "backend":  { "api_base_url": "https://vmaas.dk/api" },
 *   "timings":  { "keypad_debounce_ms": 20, "slot_entry_timeout_ms": 10000, "slot_entry_result_hold_ms": 2000 }
 * }
 * @endcode
 */
#include <cstddef>
#include <cstdint>
#include "config_issue.h"

namespace vmaas
{
    /// Schema version this library understands. Higher versions parse with a NewerVersion issue.
    constexpr int DEVICE_SCHEMA_VERSION = 2;

    constexpr size_t MAX_DEVICE_NAME = 17; ///< 16 chars + NUL: one row of the 16x2 display.
    constexpr size_t MAX_MACHINE_ID  = 37; ///< 36 chars + NUL: a UUID fits.
    constexpr size_t MAX_API_BASE_URL = 97; ///< 96 chars + NUL.

    /// Validated device settings. Every field always holds either a file value or its default.
    struct DeviceConfig
    {
        char     name[MAX_DEVICE_NAME];         ///< Shown by the provisioning app and on the LCD. "" means derive from MAC.
        char     machine_id[MAX_MACHINE_ID];    ///< Identity towards the backend. "" means unidentified.
        /// Base address of the platform API, e.g. "https://vmaas.dk/api". "" means
        /// the device has nowhere to activate against and says so rather than trying.
        /// The broker address, the CA and the topic prefix are NOT here: they come
        /// back from POST /device/activate, so carrying them would be three fields
        /// that can disagree with the platform.
        char     api_base_url[MAX_API_BASE_URL];
        uint32_t keypad_debounce_ms;            ///< How long a key state must hold before it is believed.
        uint32_t slot_entry_timeout_ms;         ///< Inactivity before a partial slot entry is discarded.
        uint32_t slot_entry_result_hold_ms;     ///< How long a result line stays on screen.
    };

    /// The value of every field when config.json does not supply it, or supplies it badly.
    DeviceConfig device_config_defaults();

    /// Output of parse_device_config(). Fixed size, no heap.
    struct DeviceParseResult
    {
        static constexpr size_t MAX_ISSUES = 8; ///< Issues kept; further ones are dropped (count saturates).

        DeviceConfig config;            ///< ALWAYS usable, whatever ok and json_valid say.
        bool ok;                        ///< No issue other than NewerVersion was found.
        bool json_valid;                ///< false means the text was not a JSON object (or too deep).
        size_t json_error_offset;       ///< Byte offset of the JSON error when json_valid is false; 0 otherwise.
        size_t issue_count;             ///< Number of valid entries in issues, at most MAX_ISSUES.
        ConfigIssue issues[MAX_ISSUES]; ///< The first issue_count entries are valid.
    };
}
