#include "record.h"

#include <cstdio>
#include <cstring>

namespace
{
    /// Reads digits up to the next '|' or NUL. Returns nullptr when there are none.
    const char* read_u64(const char* p, uint64_t& out)
    {
        if (p == nullptr || *p < '0' || *p > '9') return nullptr;
        uint64_t v = 0;
        while (*p >= '0' && *p <= '9')
        {
            v = v * 10 + static_cast<uint64_t>(*p - '0');
            ++p;
        }
        out = v;
        return p;
    }

    /// Steps over one delimiter. Returns nullptr when it is not there.
    const char* skip_pipe(const char* p)
    {
        return (p != nullptr && *p == '|') ? p + 1 : nullptr;
    }
}

namespace vmaas::events
{
    bool encode_record(const Record& r, char* out, size_t cap)
    {
        if (out == nullptr || cap == 0) return false;
        if (std::strchr(r.payload, '\n') != nullptr) return false;
        if (std::strchr(r.type, '\n') != nullptr || std::strchr(r.type, '|') != nullptr) return false;

        const int n = std::snprintf(out, cap, "%lu|%lu|%llu|%s|%s", static_cast<unsigned long>(r.seq), static_cast<unsigned long>(r.uptime_ms), static_cast<unsigned long long>(r.wall_ms), r.type, r.payload);
        return n > 0 && static_cast<size_t>(n) < cap;
    }

    bool decode_record(const char* line, Record& out)
    {
        if (line == nullptr || *line == '\0') return false;

        uint64_t seq = 0, uptime = 0, wall = 0;
        const char* p = read_u64(line, seq);
        p = skip_pipe(p);
        p = read_u64(p, uptime);
        p = skip_pipe(p);
        p = read_u64(p, wall);
        p = skip_pipe(p);
        if (p == nullptr) return false;

        const char* type_end = std::strchr(p, '|');
        if (type_end == nullptr) return false;

        const size_t type_len = static_cast<size_t>(type_end - p);
        if (type_len == 0 || type_len >= MAX_TYPE) return false;

        const char* payload = type_end + 1;
        if (std::strlen(payload) >= MAX_PAYLOAD) return false;

        out = Record{};
        out.seq = static_cast<uint32_t>(seq);
        out.uptime_ms = static_cast<uint32_t>(uptime);
        out.wall_ms = wall;
        std::memcpy(out.type, p, type_len);
        out.type[type_len] = '\0';
        std::snprintf(out.payload, MAX_PAYLOAD, "%s", payload);
        return true;
    }
}
