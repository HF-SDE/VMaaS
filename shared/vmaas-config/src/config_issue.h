#pragma once
/**
 * @file config_issue.h
 * @brief How a config file's fields are rejected, shared by every schema.
 *
 * Both schemas in this library report problems the same way: the type and the
 * dotted path of the field it happened on. The two parsers differ in what
 * they do about it, not in how they say it.
 */
#include <cstdint>

namespace vmaas
{
    /// What went wrong with one field, or with the file as a whole.
    enum class ConfigIssueKind : uint8_t
    {
        None = 0,      ///< No issue (never stored; keeps 0 meaningful).
        InvalidJson,   ///< Not valid JSON, not an object, or nested deeper than the limit. Whole file ignored.
        MissingField,  ///< A required field is absent, or present but empty where that is not allowed.
        WrongType,     ///< Field present but of the wrong JSON type.
        OutOfRange,    ///< A number outside its allowed range, or a string longer than its buffer.
        InputOnlyPin,  ///< pin 34-39: no output driver on the ESP32, cannot drive a motor.
        DuplicateSlot, ///< The same slot number appears twice. Reported on the later entry.
        DuplicatePin,  ///< The same GPIO appears twice. Reported on the later entry.
        TooManySlots,  ///< More than MAX_SLOTS entries.
        NewerVersion,  ///< "version" is higher than this library understands. Parsing continued.
    };

    /// One rejected field or file-level problem.
    struct ConfigIssue
    {
        ConfigIssueKind kind; ///< What went wrong.
        char field[34];       ///< Dotted path such as "slots[3].pin" or "timings.slot_entry_timeout_ms"; "" for file-level issues.
    };

    /**
     * @brief Human-readable name of an issue kind.
     * @param kind Kind to name.
     * @return Static string such as "OutOfRange"; "Unknown" for values outside the enum.
     */
    const char* to_string(ConfigIssueKind kind);
}
