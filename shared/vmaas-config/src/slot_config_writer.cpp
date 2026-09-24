/**
 * @file slot_config_writer.cpp
 * @brief write_slot_config_json(). See slot_config_writer.h.
 */
#include "slot_config_writer.h"
#include <cstdio>

namespace vmaas
{
    namespace
    {
        // Appends formatted text at *pos; returns false once the buffer is full.
        bool put(char* out, size_t cap, size_t& pos, const char* fmt, unsigned a = 0)
        {
            if (pos >= cap) return false;
            const int n = std::snprintf(out + pos, cap - pos, fmt, a);
            if (n < 0 || static_cast<size_t>(n) >= cap - pos) return false;
            pos += static_cast<size_t>(n);
            return true;
        }
    }

    int write_slot_config_json(const SlotConfig& cfg, char* out, size_t cap)
    {
        if (out == nullptr || cap == 0) return -1;
        size_t pos = 0;
        bool ok = put(out, cap, pos, "{\"version\":2,\"motor\":{\"stepsPerVend\":%u},\"slots\":[", cfg.steps_per_vend);
        for (size_t i = 0; ok && i < cfg.slot_count; ++i)
        {
            const SlotEntry& e = cfg.slots[i];
            ok = put(out, cap, pos, i ? ",{\"slot\":%u,\"pins\":[" : "{\"slot\":%u,\"pins\":[", e.slot);
            for (size_t k = 0; ok && k < e.pin_count; ++k) {
                ok = put(out, cap, pos, k ? ",%u" : "%u", e.pins[k]);
            }
            ok = ok && put(out, cap, pos, "]}");
        }
        ok = ok && put(out, cap, pos, "]}");
        if (!ok)
        {
            out[0] = '\0';
            return -1;
        }
        return static_cast<int>(pos);
    }
}
