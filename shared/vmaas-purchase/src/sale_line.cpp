/**
 * @file sale_line.cpp
 * @brief JSON line formatting. See sale_line.h for the contract.
 *
 * snprintf into a scratch buffer, then copy only if it fitted. Writing
 * straight into the caller's buffer would leave a truncated line behind on
 * overflow, and a truncated line in a JSONL queue is an unparseable event.
 */
#include "sale_line.h"

#include <cstdio>
#include <cstring>

namespace
{
    const char *status_text(vmaas::SaleStatus s)
    {
        switch (s)
        {
        case vmaas::SaleStatus::Completed: return "completed";
        case vmaas::SaleStatus::Failed:    return "failed";
        case vmaas::SaleStatus::None:      break;
        }
        return "none";
    }
}

namespace vmaas
{
    size_t format_sale_line(const SaleLine &line, char *buf, size_t buf_len)
    {
        if (buf == nullptr || buf_len == 0) return 0;
        buf[0] = '\0';

        char scratch[512];

        // Optional event_id field: omit the entire key if null or empty.
        // Schema validates min(1) when present, so empty string is invalid.
        char event_id_part[100] = "";
        if (line.event_id != nullptr && std::strlen(line.event_id) > 0)
        {
            const int ret = std::snprintf(event_id_part, sizeof(event_id_part),"\"eventId\":\"%s\",", line.event_id);
            if (ret < 0 || ret >= (int)sizeof(event_id_part))
            {
                buf[0] = '\0';
                return 0;
            }
        }

        // The time field: a real timestamp when the clock is known, otherwise
        // uptime so the backend can work backwards from receipt.
        char when[64];
        if (line.occurred_at != nullptr)
        {
            const int ret = std::snprintf(when, sizeof(when), "\"occurredAt\":\"%s\"", line.occurred_at);
            if (ret < 0 || ret >= (int)sizeof(when))
            {
                buf[0] = '\0';
                return 0;
            }
        }
        else
        {
            const int ret = std::snprintf(when, sizeof(when), "\"uptimeMs\":%lu", static_cast<unsigned long>(line.uptime_ms));
            if (ret < 0 || ret >= (int)sizeof(when))
            {
                buf[0] = '\0';
                return 0;
            }
        }

        char reason[96] = "";
        if (line.reason != nullptr)
        {
            const int ret = std::snprintf(reason, sizeof(reason), ",\"reason\":\"%s\"", line.reason);
            if (ret < 0 || ret >= (int)sizeof(reason))
            {
                buf[0] = '\0';
                return 0;
            }
        }

        const int n = std::snprintf(
            scratch, sizeof(scratch),
            "{%s\"sequenceNumber\":%lu,\"type\":\"cash_sale\",%s,"
            "\"payload\":{\"slot\":%u,\"price_minor\":%lu,\"received_minor\":%lu,"
            "\"status\":\"%s\"%s,\"currency\":\"%s\",\"ledger\":\"%s\"}}",
            event_id_part,
            static_cast<unsigned long>(line.sequence_number),
            when,
            static_cast<unsigned>(line.slot),
            static_cast<unsigned long>(line.price_minor),
            static_cast<unsigned long>(line.received_minor),
            status_text(line.status),
            reason,
            line.currency != nullptr ? line.currency : "DKK",
            line.ledger != nullptr ? line.ledger : "");

        if (n < 0) return 0;
        const size_t written = static_cast<size_t>(n);
        if (written >= sizeof(scratch)) return 0;
        if (written + 1 > buf_len) return 0;

        std::memcpy(buf, scratch, written + 1);
        return written;
    }
}
