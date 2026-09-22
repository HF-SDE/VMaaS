#pragma once
/**
 * @file record.h
 * @brief One line of the machine's event journal.
 *
 * Format: seq|uptime_ms|wall_ms|type|payload_json
 *
 * Pipe-delimited rather than JSON so that this library needs no JSON parser:
 * the four scalar fields are split on the first four delimiters and everything
 * after the fourth is the payload, verbatim, so a payload containing a pipe
 * survives untouched. A payload containing a newline is refused at encode
 * time, because a newline would forge a record boundary.
 *
 * wall_ms is 0 when the record was written before the clock was synchronised.
 * See timing.h for how such a record gets a timestamp on its way out.
 */
#include <cstddef>
#include <cstdint>
#include <cstdio>

namespace vmaas::events
{
    constexpr size_t MAX_TYPE = 32;     ///< Event type plus NUL, e.g. "door-released".
    constexpr size_t MAX_PAYLOAD = 192; ///< Serialised JSON object plus NUL.
    /// Longest encoded line plus NUL, derived from the fields it must hold:
    /// two uint32 (10 digits each), one uint64 (20 digits), type and payload
    /// at their maxima (excluding NUL), and four delimiters.
    constexpr size_t MAX_LINE = 10 + 1 + 10 + 1 + 20 + 1 + (MAX_TYPE - 1) + 1 + (MAX_PAYLOAD - 1) + 1;

    /// One journal entry, as stored.
    struct Record
    {
        uint32_t seq;            ///< Monotonic, never reused, assigned by the journal.
        uint32_t uptime_ms;      ///< Milliseconds since boot when the event happened.
        uint64_t wall_ms;        ///< Unix milliseconds, or 0 when the clock was unknown.
        char type[MAX_TYPE];     ///< Event type as the platform will store it.
        char payload[MAX_PAYLOAD]; ///< Serialised JSON object, opaque here.
    };

    /**
     * @brief Render @p r as one line, without a trailing newline.
     * @return false when the payload holds a newline or @p cap is too small.
     */
    bool encode_record(const Record& r, char* out, size_t cap);

    /**
     * @brief Parse one line, as written by encode_record().
     * @return false for anything malformed, including the truncated tail a
     *         power cut during a write leaves behind.
     */
    bool decode_record(const char* line, Record& out);
}
