#pragma once
/**
 * @file config.h
 * @brief Slot configuration schema for the VMaaS Motorcontrol.
 *
 * The cabinet wiring (protocol slot number -> motor GPIO) lives in
 * /storage/config.json on Motorcontrol. There is no default wiring in
 * firmware: parse_config() (config_parser.h) either yields a complete,
 * validated slot table (ok == true) or a list of issues that make the file
 * unusable. The library never logs; the caller decides what to print.
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

namespace vmaas
{
    /// Schema version this library understands. Files with a higher version parse with a NewerVersion issue.
    constexpr int CONFIG_SCHEMA_VERSION = 1;

    /// Largest slot table accepted. Bounds the fixed arrays below; no heap is used.
    constexpr size_t MAX_SLOTS = 32;

    /// One row of the wiring table.
    struct SlotEntry
    {
        uint8_t slot; ///< Slot number as sent by Main-Controller in RUN. 1-255.
        int pin;      ///< GPIO that drives this slot's motor. 0-33 (output-capable).
    };

    /// Validated slot table. slot_count is 0 unless ParseResult::ok is true.
    struct Config
    {
        size_t slot_count;           ///< Number of valid entries in slots.
        SlotEntry slots[MAX_SLOTS];  ///< Entries in file order.
    };

    /// What went wrong with one field, or with the file as a whole.
    enum class ConfigIssueKind : uint8_t
    {
        None = 0,      ///< No issue (never stored; keeps 0 meaningful).
        InvalidJson,   ///< Not valid JSON, not an object, or nested deeper than the limit. Whole file ignored.
        MissingField,  ///< "slots" absent/not an array/empty, or an entry lacks "slot" or "pin".
        WrongType,     ///< Field present but not an integer number, or an entry is not an object.
        OutOfRange,    ///< slot outside 1-255 or pin outside 0-39.
        InputOnlyPin,  ///< pin 34-39: no output driver on the ESP32, cannot drive a motor.
        DuplicateSlot, ///< The same slot number appears twice. Reported on the later entry.
        DuplicatePin,  ///< The same GPIO appears twice. Reported on the later entry.
        TooManySlots,  ///< More than MAX_SLOTS entries.
        NewerVersion,  ///< "version" is higher than CONFIG_SCHEMA_VERSION. Parsing continued; file still usable.
    };

    /// One rejected field or file-level problem.
    struct ConfigIssue
    {
        ConfigIssueKind kind; ///< What went wrong.
        char field[20];       ///< Dotted path such as "slots[3].pin"; "" for file-level issues.
    };

    /// Output of parse_config(). Fixed size, no heap.
    struct ParseResult
    {
        static constexpr size_t MAX_ISSUES = 8; ///< Issues kept; further ones are dropped (count saturates).

        Config config;             ///< Slot table. Empty (slot_count 0) unless ok.
        bool ok;                   ///< json_valid and no issue other than NewerVersion: the table may be used.
        bool json_valid;           ///< false means the text was not a JSON object (or too deep).
        size_t json_error_offset;  ///< Byte offset of the JSON error when json_valid is false; 0 otherwise.
        size_t issue_count;        ///< Number of valid entries in issues, at most MAX_ISSUES.
        ConfigIssue issues[MAX_ISSUES]; ///< The first issue_count entries are valid.
    };

    /**
     * @brief Human-readable name of an issue kind.
     * @param kind Kind to name.
     * @return Static string such as "OutOfRange"; "Unknown" for values outside the enum.
     */
    const char* to_string(ConfigIssueKind kind);
}
