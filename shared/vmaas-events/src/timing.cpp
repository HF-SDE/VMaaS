#include "timing.h"

#include <cstdio>
#include <ctime>

namespace vmaas::events
{
    uint64_t occurred_at_ms(const Record& r, uint64_t now_wall_ms, uint32_t now_uptime_ms)
    {
        if (r.wall_ms != 0) return r.wall_ms;

        const uint32_t age_ms = (now_uptime_ms >= r.uptime_ms) ? (now_uptime_ms - r.uptime_ms) : 0;
        return (now_wall_ms > age_ms) ? (now_wall_ms - age_ms) : 0;
    }

    bool build_event_id(const char* machine_id, uint32_t seq, char* out, size_t cap)
    {
        if (machine_id == nullptr || machine_id[0] == '\0' || out == nullptr) return false;

        const int n = std::snprintf(out, cap, "%s-%lu", machine_id, static_cast<unsigned long>(seq));
        return n > 0 && static_cast<size_t>(n) < cap;
    }

    bool format_iso8601(uint64_t unix_ms, char* out, size_t cap)
    {
        if (out == nullptr || cap < 25) return false;

        const std::time_t secs = static_cast<std::time_t>(unix_ms / 1000ULL);
        const unsigned ms = static_cast<unsigned>(unix_ms % 1000ULL);

        std::tm tm{};
#if defined(_WIN32)
        if (gmtime_s(&tm, &secs) != 0) return false;
#else
        if (gmtime_r(&secs, &tm) == nullptr) return false;
#endif

        const int n = std::snprintf(out, cap, "%04d-%02d-%02dT%02d:%02d:%02d.%03uZ", tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec, ms);
        return n > 0 && static_cast<size_t>(n) < cap;
    }
}
