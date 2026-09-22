#pragma once
/**
 * @file sale_line.h
 * @brief One outbox line, formatted as the JSON the backend expects.
 *
 * Kept hardware-free and separate from the file I/O so the exact wire text can
 * be pinned by host tests. The shape is fixed by deviceEventSchema in
 * shared/schemas/device.ts: a rename there breaks these tests, which is the
 * point.
 */
#include <cstddef>
#include <cstdint>

#include "purchase.h"

namespace vmaas
{
    /// Everything one cash_sale event carries.
    struct SaleLine
    {
        const char *event_id = nullptr;       ///< Machine id plus an NVS counter.
        uint32_t    sequence_number = 0;
        uint8_t     slot = 0;
        uint32_t    price_minor = 0;
        uint32_t    received_minor = 0;       ///< What the customer actually paid.
        SaleStatus  status = SaleStatus::None;
        const char *reason = nullptr;         ///< Omitted when null.
        /// ISO 8601 UTC, or null when the clock has never been synchronised —
        /// then uptime_ms is emitted instead.
        const char *occurred_at = nullptr;
        uint32_t    uptime_ms = 0;
        const char *currency = "DKK";
    };

    /**
     * @brief Format @p line into @p buf as one JSONL line, with no newline.
     * @return Characters written excluding the terminator, or 0 when @p buf is
     *         too small. On 0 the buffer is left as an empty string rather
     *         than a truncated line.
     */
    size_t format_sale_line(const SaleLine &line, char *buf, size_t buf_len);
}
