#pragma once
/**
 * @file config_parser.h
 * @brief Merge a config.json text over firmware defaults.
 */
#include "config.h"

namespace vmaas
{
    /**
     * @brief Parse @p json_text and merge accepted fields over @p defaults.
     *
     * - Every field is optional; absent fields keep their default.
     * - Unknown keys are ignored.
     * - A field that is not an integer, out of range, an input-only GPIO in an
     *   output role, or a duplicate of another pin is rejected on its own: the
     *   default is used for that field and one ConfigIssue is recorded.
     * - Invalid JSON (or a nullptr, or a non-object root) yields the defaults
     *   unchanged, json_valid == false and one InvalidJson issue.
     * - Text nested more than 8 levels deep in objects or arrays counts as
     *   invalid JSON. A non-recursive pre-scan rejects it before the underlying
     *   parser recurses, so a small hostile file cannot exhaust the caller's
     *   stack. Schema v1 nests two levels; json_error_offset then points at the
     *   bracket that crossed the limit.
     *
     * Allocation happens only inside cJSON while parsing; the result is plain data.
     *
     * @param json_text NUL-terminated JSON text, or nullptr.
     * @param defaults Firmware defaults, normally built from pins.h/config.h.
     * @return Effective config plus issues. Never fails.
     */
    ParseResult parse_config(const char* json_text, const Config& defaults);
}
