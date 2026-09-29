#pragma once
/**
 * @file stock_ledger.h
 * @brief How many items a slot has, on the machine, including while offline.
 *
 * The backend sends a baseline: per slot the quantity it knows, the time the
 * slot was last counted, and which of this machine's sales that quantity
 * already reflects (one ack per recent ledger). The machine adds its own sales
 * the backend has not counted yet, and subtracts those that happened after
 * the slot's count.
 *
 * Pure: no clock, no flash, no heap. Times are UTC seconds; 0 means "never
 * counted" for a slot and "unknown" for a sale.
 */
#include <cstddef>
#include <cstdint>

namespace vmaas
{
    constexpr size_t STOCK_MAX_SLOTS = 32;
    constexpr size_t STOCK_MAX_OWN_SALES = 512;
    constexpr size_t STOCK_LEDGER_MAX = 16;
    /// Distinct ledgers among the unacknowledged sales. A new ledger only
    /// appears after an NVS reset, so more than one is already rare.
    constexpr size_t STOCK_MAX_LEDGERS = 4;

    struct StockSlot
    {
        uint8_t slot;
        uint32_t quantity;
        int64_t counted_at; ///< 0 = never counted.
    };

    /// "The backend has booked this ledger's sales up to and including as_of_sequence."
    struct StockAck
    {
        char ledger[STOCK_LEDGER_MAX + 1];
        uint32_t as_of_sequence;
    };

    struct StockBaseline
    {
        uint8_t ack_count;
        StockAck acks[STOCK_MAX_LEDGERS]; ///< The machine's most recently used ledgers.
        uint8_t slot_count;
        StockSlot slots[STOCK_MAX_SLOTS];
    };

    struct OwnSale
    {
        char ledger[STOCK_LEDGER_MAX + 1];
        uint32_t sequence;
        uint8_t slot;
        int64_t at; ///< 0 = unknown (clock not set).
    };

    /// "YYYY-MM-DDTHH:MM:SS[.fff]Z" to UTC seconds. False on anything else.
    bool parse_iso8601_utc(const char* text, int64_t& out_seconds);

    class StockLedger
    {
    public:
        /// Replace the baseline; drop own sales it already counts (same ledger, sequence <= asOfSequence).
        void set_baseline(const StockBaseline& b);
        /// Note a completed sale. False, and nothing recorded, when the list
        /// is full (STOCK_MAX_OWN_SALES sales, or STOCK_MAX_LEDGERS ledgers).
        bool record_sale(const char* ledger, uint32_t sequence, uint8_t slot, int64_t at);
        /// Items left in @p slot. Meaningless without a baseline (then sold_out() is false).
        uint32_t available(uint8_t slot) const;
        /// Unreliable: true. No baseline: false. Otherwise: list full, slot not in the baseline, or available() == 0.
        bool sold_out(uint8_t slot) const;
        bool has_baseline() const { return has_baseline_; }
        /// The own sales could not be restored: sell nothing until the next
        /// baseline, which set_baseline() clears this with.
        void mark_unreliable() { unreliable_ = true; }
        bool full() const { return own_count_ >= STOCK_MAX_OWN_SALES || ledger_full_; }
        size_t own_sale_count() const { return own_count_; }
        /// The i-th own sale, rebuilt from the compact storage.
        OwnSale own_sale(size_t i) const;

    private:
        /// 12 bytes a sale, so 512 of them fit the ESP32's static DRAM.
        struct Entry
        {
            uint32_t sequence;
            uint32_t at;      ///< UTC seconds, 0 = unknown.
            uint8_t slot;
            uint8_t ledger;   ///< Index into ledgers_.
        };

        bool counted_by_backend(const Entry& e) const;
        const StockSlot* find(uint8_t slot) const;
        int ledger_index(const char* ledger, bool add);
        void compact_ledgers();

        StockBaseline baseline_{};
        bool has_baseline_ = false;
        Entry own_[STOCK_MAX_OWN_SALES]{};
        size_t own_count_ = 0;
        char ledgers_[STOCK_MAX_LEDGERS][STOCK_LEDGER_MAX + 1]{};
        uint8_t ledger_count_ = 0;
        bool ledger_full_ = false;
        bool unreliable_ = false;
    };
}
