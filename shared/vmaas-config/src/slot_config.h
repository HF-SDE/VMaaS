#pragma once
/**
 * @file slot_config.h
 * @brief Slot configuration schema for the VMaaS Motorcontrol.
 *
 * The cabinet wiring (protocol slot number -> motor nENABLE GPIOs) and the
 * pulse count per vend live in /storage/config.json on Motorcontrol. There is
 * no default in firmware: parse_slot_config() (slot_config_parser.h) either
 * yields a complete, validated table (ok == true) or a list of issues that
 * make the file unusable. The library never logs; the caller decides what to
 * print.
 *
 * Contrast device_config.h, whose every field has a safe default: a wrong
 * motor pin or pulse count dispenses wrongly to someone who has already paid,
 * a wrong MQTT host costs telemetry.
 *
 * The motors are steppers on DRV8825 drivers. One STEP line is shared by every
 * driver (a firmware constant on Motorcontrol); each driver has its own
 * nENABLE GPIO, and that GPIO is the "pin" recorded here. A slot has several
 * pins when two spirals are merged into one wide slot.
 *
 * Schema version 2 (config.json):
 * @code
 * {
 *   "version": 2,
 *   "motor": { "stepsPerVend": 6400 },
 *   "slots": [
 *     { "slot": 1, "pins": [18] },
 *     { "slot": 3, "pins": [21, 22] }
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
    constexpr int SLOT_SCHEMA_VERSION = 2;

    /// Largest slot table accepted. Bounds the fixed arrays below; no heap is used.
    constexpr size_t MAX_SLOTS = 32;

    /// Most nENABLE pins one slot may drive. Six is what a WIRING_SLOT frame
    /// can carry once slot and pin_count have taken two of its eight bytes.
    constexpr size_t MAX_PINS_PER_SLOT = 6;

    /// Bounds on motor.stepsPerVend. 6400 is one revolution of a 200-step motor at 1/32 microstepping.
    constexpr uint16_t STEPS_PER_VEND_MIN = 1;
    constexpr uint16_t STEPS_PER_VEND_MAX = 65535;

    /// One row of the wiring table.
    struct SlotEntry
    {
        uint8_t slot;                    ///< Slot number as sent by Main-Controller in RUN. 1-255.
        uint8_t pin_count;               ///< Valid entries in pins, 1..MAX_PINS_PER_SLOT.
        uint8_t pins[MAX_PINS_PER_SLOT]; ///< nENABLE GPIOs, 0-33 (output-capable), unique across the file.
    };

    /// Validated table. slot_count is 0 unless SlotParseResult::ok is true.
    struct SlotConfig
    {
        uint16_t steps_per_vend;     ///< STEP pulses per RUN, from motor.stepsPerVend.
        size_t slot_count;           ///< Number of valid entries in slots.
        SlotEntry slots[MAX_SLOTS];  ///< Entries in file order.
    };

    /// Output of parse_slot_config(). Fixed size, no heap.
    struct SlotParseResult
    {
        static constexpr size_t MAX_ISSUES = 8; ///< Issues kept; further ones are dropped (count saturates).

        SlotConfig config;         ///< Table. Empty (slot_count 0, steps_per_vend 0) unless ok.
        bool ok;                   ///< json_valid and no issue other than NewerVersion: the table may be used.
        bool json_valid;           ///< false means the text was not a JSON object (or too deep).
        size_t json_error_offset;  ///< Byte offset of the JSON error when json_valid is false; 0 otherwise.
        size_t issue_count;        ///< Number of valid entries in issues, at most MAX_ISSUES.
        ConfigIssue issues[MAX_ISSUES]; ///< The first issue_count entries are valid.
    };
}
