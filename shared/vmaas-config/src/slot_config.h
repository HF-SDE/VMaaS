#pragma once
/**
 * @file slot_config.h
 * @brief Slot configuration schema for the VMaaS Motorcontrol.
 *
 * The cabinet wiring (protocol slot number -> motor GPIO) lives in
 * /storage/config.json on Motorcontrol. There is no default wiring in
 * firmware: parse_slot_config() (slot_config_parser.h) either yields a
 * complete, validated slot table (ok == true) or a list of issues that make
 * the file unusable. The library never logs; the caller decides what to print.
 *
 * Contrast device_config.h, whose every field has a safe default: a wrong
 * motor pin dispenses the wrong product, a wrong MQTT host costs telemetry.
 *
 * Schema version 1 (config.json):
 * @code
 * {
 *   "version": 1,
 *   "slots": [
 *     { "slot": 1, "pin": 18 },
 *     { "slot": 2, "pin": 19 }
 *   ]
 * }
 * @endcode
 */
#include <cstddef>
#include <cstdint>
#include "config_issue.h"

namespace vmaas
{
    /// Schema version this library understands. Files with a higher version parse with a NewerVersion issue.
    constexpr int SLOT_SCHEMA_VERSION = 1;

    /// Largest slot table accepted. Bounds the fixed arrays below; no heap is used.
    constexpr size_t MAX_SLOTS = 32;

    /// One row of the wiring table.
    struct SlotEntry
    {
        uint8_t slot; ///< Slot number as sent by Main-Controller in RUN. 1-255.
        int pin;      ///< GPIO that drives this slot's motor. 0-33 (output-capable).
    };

    /// Validated slot table. slot_count is 0 unless SlotParseResult::ok is true.
    struct SlotConfig
    {
        size_t slot_count;           ///< Number of valid entries in slots.
        SlotEntry slots[MAX_SLOTS];  ///< Entries in file order.
    };

    /// Output of parse_slot_config(). Fixed size, no heap.
    struct SlotParseResult
    {
        static constexpr size_t MAX_ISSUES = 8; ///< Issues kept; further ones are dropped (count saturates).

        SlotConfig config;         ///< Slot table. Empty (slot_count 0) unless ok.
        bool ok;                   ///< json_valid and no issue other than NewerVersion: the table may be used.
        bool json_valid;           ///< false means the text was not a JSON object (or too deep).
        size_t json_error_offset;  ///< Byte offset of the JSON error when json_valid is false; 0 otherwise.
        size_t issue_count;        ///< Number of valid entries in issues, at most MAX_ISSUES.
        ConfigIssue issues[MAX_ISSUES]; ///< The first issue_count entries are valid.
    };
}
