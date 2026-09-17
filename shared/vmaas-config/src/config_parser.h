#pragma once
/**
 * @file config_parser.h
 * @brief Parse and validate a Motorcontrol config.json text.
 */
#include "config.h"

namespace vmaas
{
    /**
     * @brief Parse @p json_text into a validated slot table.
     *
     * - "slots" is required: an array of objects, each with integer "slot"
     *   (1-255) and "pin" (0-33). Absent, empty or not an array gives
     *   MissingField.
     * - Slot numbers and pins must each be unique across the table
     *   (DuplicateSlot / DuplicatePin on the later entry).
     * - At most MAX_SLOTS entries (TooManySlots). The first MAX_SLOTS are
     *   still validated so the log can name every problem it can see.
     * - Unknown keys are ignored. "version" higher than
     *   CONFIG_SCHEMA_VERSION gives NewerVersion and parsing continues.
     * - Invalid JSON, a nullptr, a non-object root, or nesting deeper than 8
     *   levels (checked before the recursive parser runs, so a hostile file
     *   cannot exhaust the stack) gives json_valid == false and one
     *   InvalidJson issue with json_error_offset set.
     *
     * The result is usable (ok == true, slot_count > 0) only when the text is
     * valid JSON and no issue other than NewerVersion was found. Otherwise
     * slot_count is 0. Allocation happens only inside cJSON while parsing.
     *
     * @param json_text NUL-terminated JSON text, or nullptr.
     * @return Slot table plus issues. Never fails.
     */
    ParseResult parse_config(const char* json_text);
}
