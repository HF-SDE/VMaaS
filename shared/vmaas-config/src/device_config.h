#pragma once
/**
 * @file device_config.h
 * @brief Device configuration schema for the VMaaS Main-Controller.
 *
 * Schema version 4 (config.json):
 * @code
 * {
 *   "version": 4,
 *   "device":   { "name": "VMaaS-0042", "machine_id": "5f2c1a90-..." },
 *   "backend":  { "api_base_url": "https://vmaas.dk/api" },
 *   "broker":   { "host": "192.168.78.225", "port": 8883 },
 *   "door":     { "code": "4711" },
 *   "timings":  { "keypad_debounce_ms": 20, "slot_entry_timeout_ms": 10000, "slot_entry_result_hold_ms": 2000, "door_unlock_ms": 500, "dispense_timeout_ms": 30000 }
 * }
 * @endcode
 */
#include <cstddef>
#include <cstdint>
#include "config_issue.h"

namespace vmaas
{
    /// Schema version this library understands. Higher versions parse with a NewerVersion issue.
    constexpr int DEVICE_SCHEMA_VERSION = 4;

    constexpr size_t MAX_DEVICE_NAME = 17; ///< 16 chars + NUL: one row of the 16x2 display.
    constexpr size_t MAX_MACHINE_ID  = 37; ///< 36 chars + NUL: a UUID fits.
    constexpr size_t MAX_API_BASE_URL = 97; ///< 96 chars + NUL.
    constexpr size_t MAX_DOOR_CODE = 9; ///< 8 digits + NUL.
    /// 63 chars + NUL, matching activation::HOST_MAX so an override copies in whole.
    constexpr size_t MAX_BROKER_HOST = 64;

    /// Validated device settings. Every field always holds either a file value or its default.
    struct DeviceConfig
    {
        char     name[MAX_DEVICE_NAME];         ///< Shown by the provisioning app and on the LCD. "" means derive from MAC.
        char     machine_id[MAX_MACHINE_ID];    ///< Identity towards the backend. "" means unidentified.
        /// Base address of the platform API, e.g. "https://vmaas.dk/api". "" means
        /// the device has nowhere to activate against and says so rather than trying.
        /// The CA and the topic prefix are NOT here: they come back from
        /// POST /device/activate, and nothing about a redeployment changes them.
        char     api_base_url[MAX_API_BASE_URL];
        /// Broker address, overriding what POST /device/activate stored in NVS.
        ///
        /// Until schema v4 this could ONLY come from activation, which made the
        /// address effectively permanent: pointing a machine at a moved broker
        /// meant activating it again - a new certificate, a reset row and a new
        /// claim to change an IP. The two sources can now disagree, which is
        /// exactly what keeping it out was meant to prevent, so the precedence
        /// is fixed and logged rather than left to be inferred: a non-empty
        /// value here wins, and broker_client says at boot which one it used.
        ///
        /// "" means defer to activation, which is what a file without a
        /// "broker" section gets - so v3 files keep their old behaviour.
        char     broker_host[MAX_BROKER_HOST];
        /// Broker port, 0 meaning defer to activation. Same precedence as
        /// broker_host, and independent of it: a broker that only changed port
        /// needs no host line.
        uint16_t broker_port;
        uint32_t keypad_debounce_ms;            ///< How long a key state must hold before it is believed.
        uint32_t slot_entry_timeout_ms;         ///< Inactivity before a partial slot entry is discarded.
        uint32_t slot_entry_result_hold_ms;     ///< How long a result line stays on screen.
        /// Front door service code. "" disables keypad release entirely, which
        /// is the default: an unconfigured machine has no way into the door.
        char     door_code[MAX_DOOR_CODE];
        /// How long the door relay is energised, in milliseconds. The solenoid
        /// is pulse-to-release and not rated to be held, hence the narrow range.
        uint32_t door_unlock_ms;
        /// How long a paid sale waits for Motorcontrol's DONE (or NAK) before
        /// it is booked Failed and STOP is sent. 0 disables the timeout. Must
        /// stay above the longest vend Motorcontrol can be configured for
        /// (stepsPerVend x STEP_INTERVAL_US): 65535 x 312 us is 20.4 s, so 30 s
        /// leaves margin. Raise it if STEP_INTERVAL_US is raised on Motorcontrol.
        uint32_t dispense_timeout_ms;
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
