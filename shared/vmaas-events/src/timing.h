#pragma once
/**
 * @file timing.h
 * @brief Turning a stored record into the fields the platform's schema wants.
 */
#include <cstddef>
#include <cstdint>

#include "record.h"

namespace vmaas::events
{
    /**
     * @brief The Unix milliseconds to report for @p r.
     *
     * A record written with a synchronised clock keeps its own timestamp. One
     * written before the clock was known is back-dated from how long ago it
     * happened: now minus the uptime that has passed since. Never below 0.
     */
    uint64_t occurred_at_ms(const Record& r, uint64_t now_wall_ms, uint32_t now_uptime_ms);

    /**
     * @brief Build "<machine_id>-<seq>".
     *
     * MachineEvent.eventId is unique across the whole table rather than per
     * machine, so the machine id has to be in it.
     *
     * @return false when @p machine_id is empty or the result does not fit.
     */
    bool build_event_id(const char* machine_id, uint32_t seq, char* out, size_t cap);

    /// @brief Format Unix milliseconds as "YYYY-MM-DDTHH:MM:SS.mmmZ", which z.iso.datetime() accepts.
    bool format_iso8601(uint64_t unix_ms, char* out, size_t cap);
}
