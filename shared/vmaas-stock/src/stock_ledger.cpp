/**
 * @file stock_ledger.cpp
 * @brief See stock_ledger.h.
 */
#include "stock_ledger.h"

#include <cstring>

namespace
{
    bool digits(const char* p, int n, int& out)
    {
        out = 0;
        for (int i = 0; i < n; ++i)
        {
            if (p[i] < '0' || p[i] > '9') return false;
            out = out * 10 + (p[i] - '0');
        }
        return true;
    }

    /// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's days_from_civil).
    int64_t days_from_civil(int y, int m, int d)
    {
        y -= m <= 2;
        const int64_t era = (y >= 0 ? y : y - 399) / 400;
        const int64_t yoe = y - era * 400;
        const int64_t doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
        const int64_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146097 + doe - 719468;
    }
}

namespace vmaas
{
    bool parse_iso8601_utc(const char* t, int64_t& out)
    {
        if (t == nullptr || std::strlen(t) < 20) return false;
        int y, mo, d, h, mi, s;
        if (!digits(t, 4, y) || t[4] != '-' || !digits(t + 5, 2, mo) || t[7] != '-' || !digits(t + 8, 2, d) ||
            t[10] != 'T' || !digits(t + 11, 2, h) || t[13] != ':' || !digits(t + 14, 2, mi) || t[16] != ':' ||
            !digits(t + 17, 2, s))
            return false;
        const char* rest = t + 19;
        if (*rest == '.')
        {
            ++rest;
            while (*rest >= '0' && *rest <= '9') ++rest;
        }
        if (rest[0] != 'Z' || rest[1] != '\0') return false;
        if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return false;
        out = days_from_civil(y, mo, d) * 86400 + h * 3600 + mi * 60 + s;
        return true;
    }

    const StockSlot* StockLedger::find(uint8_t slot) const
    {
        for (uint8_t i = 0; i < baseline_.slot_count; ++i) {
            if (baseline_.slots[i].slot == slot) return &baseline_.slots[i];
        }
        return nullptr;
    }

    bool StockLedger::counted_by_backend(const Entry& e) const
    {
        for (uint8_t i = 0; i < baseline_.ack_count; ++i)
        {
            const StockAck& a = baseline_.acks[i];
            if (std::strcmp(ledgers_[e.ledger], a.ledger) == 0) return e.sequence <= a.as_of_sequence;
        }
        return false;
    }

    int StockLedger::ledger_index(const char* ledger, bool add)
    {
        for (uint8_t i = 0; i < ledger_count_; ++i) {
            if (std::strncmp(ledgers_[i], ledger, STOCK_LEDGER_MAX) == 0) return i;
        }
        if (!add || ledger_count_ >= STOCK_MAX_LEDGERS) return -1;
        std::strncpy(ledgers_[ledger_count_], ledger, STOCK_LEDGER_MAX);
        ledgers_[ledger_count_][STOCK_LEDGER_MAX] = '\0';
        return ledger_count_++;
    }

    /// Drop ledgers no remaining sale uses, and renumber the entries.
    void StockLedger::compact_ledgers()
    {
        uint8_t remap[STOCK_MAX_LEDGERS];
        uint8_t kept = 0;
        for (uint8_t l = 0; l < ledger_count_; ++l)
        {
            bool used = false;
            for (size_t i = 0; i < own_count_ && !used; ++i)  {
                used = own_[i].ledger == l;
            }
            if (!used) continue;
            if (kept != l) std::memcpy(ledgers_[kept], ledgers_[l], sizeof(ledgers_[l]));
            remap[l] = kept++;
        }
        for (size_t i = 0; i < own_count_; ++i) own_[i].ledger = remap[own_[i].ledger];
        ledger_count_ = kept;
    }

    void StockLedger::set_baseline(const StockBaseline& b)
    {
        baseline_ = b;
        if (baseline_.ack_count > STOCK_MAX_LEDGERS) baseline_.ack_count = STOCK_MAX_LEDGERS;
        for (uint8_t i = 0; i < baseline_.ack_count; ++i) {
            baseline_.acks[i].ledger[STOCK_LEDGER_MAX] = '\0';
        }
        if (baseline_.slot_count > STOCK_MAX_SLOTS) baseline_.slot_count = STOCK_MAX_SLOTS;
        has_baseline_ = true;

        size_t kept = 0;
        for (size_t i = 0; i < own_count_; ++i) {
            if (!counted_by_backend(own_[i])) own_[kept++] = own_[i];
        }
        own_count_ = kept;

        compact_ledgers();
        ledger_full_ = false;
        unreliable_ = false;
    }

    bool StockLedger::record_sale(const char* ledger, uint32_t sequence, uint8_t slot, int64_t at)
    {
        if (ledger == nullptr || own_count_ >= STOCK_MAX_OWN_SALES) return false;
        const int ix = ledger_index(ledger, true);
        if (ix < 0)
        {
            ledger_full_ = true;
            return false;
        }

        Entry& e = own_[own_count_++];
        e.sequence = sequence;
        e.at = at > 0 && at <= static_cast<int64_t>(UINT32_MAX) ? static_cast<uint32_t>(at) : 0;
        e.slot = slot;
        e.ledger = static_cast<uint8_t>(ix);
        return true;
    }

    OwnSale StockLedger::own_sale(size_t i) const
    {
        OwnSale s{};
        const Entry& e = own_[i];
        std::memcpy(s.ledger, ledgers_[e.ledger], sizeof(s.ledger));
        s.sequence = e.sequence;
        s.slot = e.slot;
        s.at = e.at;
        return s;
    }

    uint32_t StockLedger::available(uint8_t slot) const
    {
        const StockSlot* b = find(slot);
        if (b == nullptr) return 0;

        uint32_t sold = 0;
        for (size_t i = 0; i < own_count_; ++i)
        {
            const Entry& e = own_[i];
            if (e.slot != slot || counted_by_backend(e)) continue;
            // Strictly after the count, like the backend; unknown time always counts.
            const bool after_count = b->counted_at == 0 || e.at == 0 || static_cast<int64_t>(e.at) > b->counted_at;
            if (after_count) ++sold;
        }
        return sold >= b->quantity ? 0 : b->quantity - sold;
    }

    bool StockLedger::sold_out(uint8_t slot) const
    {
        if (unreliable_) return true;
        if (!has_baseline_) return false;
        if (full()) return true;
        return available(slot) == 0;
    }
}
