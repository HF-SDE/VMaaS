#pragma once
/**
 * @file stock_store.h
 * @brief The machine's own unacknowledged sales, on flash.
 *
 * /storage/stock_sales.txt, one sale per line: "<ledger> <sequence> <slot> <utc seconds or 0>\n".
 * Written atomically after every change, so a power cut never loses a sale
 * the stock count depends on. The baseline lives in prices.json.
 *
 * A plain line format rather than JSON: reading it back needs only the file
 * buffer, not a parse tree several times its size, and this runs while the
 * heap is shared with Wi-Fi.
 */
#include "stock_ledger.h"

namespace stock_store
{
    enum class LoadResult
    {
        Absent,   ///< No file: nothing sold since the last baseline, or a fresh machine.
        Loaded,   ///< Every sale in the file is in the ledger.
        Failed,   ///< The file exists but could not be read back; the ledger is incomplete.
    };

    /// Replay the stored sales into @p ledger (call before set_baseline).
    LoadResult load(vmaas::StockLedger &ledger);
    /// Write @p ledger's own sales. False when the write failed.
    bool save(const vmaas::StockLedger &ledger);
}
