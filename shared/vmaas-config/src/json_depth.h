#pragma once
/**
 * @file json_depth.h
 * @brief Bracket-nesting guard, run before cJSON sees a file.
 */
#include <cstddef>

namespace vmaas
{
    /// Deepest bracket nesting accepted.
    constexpr int MAX_NESTING_DEPTH = 8;

    /**
     * @brief Scan bracket depth outside string literals.
     *
     * cJSON parses recursively: one stack frame per nesting level. A file of
     * several thousand opening brackets exhausts a FreeRTOS task stack, which
     * on an ESP32 means a panic or silent memory corruption rather than an
     * error. This flat scan runs first so cJSON is never handed such a file.
     *
     * String literals are skipped, so an ordinary value like "{{{{{{{{{{"
     * counts for nothing.
     *
     * @param text NUL-terminated JSON text.
     * @param offset Set to the byte offset of the offending bracket when the limit is passed.
     * @return true when the text nests deeper than MAX_NESTING_DEPTH.
     */
    bool nesting_too_deep(const char* text, size_t& offset);
}
