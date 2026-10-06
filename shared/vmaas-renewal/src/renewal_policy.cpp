/**
 * @file renewal_policy.cpp
 * @brief See renewal_policy.h.
 */
#include "renewal_policy.h"

namespace vmaas
{
    int64_t utc_seconds(const CivilTime& t)
    {
        // Howard Hinnant's days_from_civil: newlib on the ESP32 has no timegm(),
        // and mktime() depends on whatever TZ happens to be set.
        const int64_t y = static_cast<int64_t>(t.year) - (t.mon <= 2 ? 1 : 0);
        const int64_t era = (y >= 0 ? y : y - 399) / 400;
        const int64_t yoe = y - era * 400;
        const int64_t mp = (t.mon + 9) % 12;
        const int64_t doy = (153 * mp + 2) / 5 + t.day - 1;
        const int64_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        const int64_t days = era * 146097 + doe - 719468;

        return days * 86400 + t.hour * 3600 + t.min * 60 + t.sec;
    }

    bool should_renew(int64_t now, int64_t not_before, int64_t not_after)
    {
        const int64_t lifetime = not_after - not_before;
        if (lifetime <= 0) return true;

        const int64_t elapsed = now - not_before;
        return elapsed * 3 >= lifetime * 2;
    }

    int64_t seconds_until_due(int64_t now, int64_t not_before, int64_t not_after)
    {
        if (should_renew(now, not_before, not_after)) return 0;

        const int64_t lifetime = not_after - not_before;
        const int64_t due_at = not_before + (lifetime * 2 + 2) / 3;
        return due_at - now;
    }
}
