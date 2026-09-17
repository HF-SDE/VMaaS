/**
 * @file entry_state.cpp
 * @brief Names and parsing for EntryState.
 */
#include "entry_state.h"

namespace vmaas
{
    const char* to_string(EntryStatus s)
    {
        switch (s)
        {
        case EntryStatus::Editing:   return "Editing";
        case EntryStatus::Confirmed: return "Confirmed";
        case EntryStatus::Cancelled: return "Cancelled";
        case EntryStatus::TimedOut:  return "TimedOut";
        }
        return "Unknown";
    }

    bool slot_number(const EntryState& st, uint8_t& out)
    {
        if (st.buffer[0] == '\0')
            return false;

        uint16_t value = 0;
        for (const char* p = st.buffer; *p != '\0'; ++p)
        {
            if (*p < '0' || *p > '9')
                return false;
            value = static_cast<uint16_t>(value * 10 + (*p - '0'));
        }
        out = static_cast<uint8_t>(value);
        return true;
    }
}
