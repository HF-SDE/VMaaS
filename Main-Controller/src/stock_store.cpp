/**
 * @file stock_store.cpp
 * @brief See stock_store.h.
 */
#include "stock_store.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "esp_log.h"
#include "storage.h"

namespace
{
    constexpr const char *TAG = "stock_store";
    constexpr const char *PATH = "/storage/stock_sales.txt";
    /// Longest line save() writes: 16-char ledger, 10-digit sequence, 3-digit slot, 10-digit time, 3 spaces, newline.
    constexpr size_t MAX_ROW = 44;
    constexpr size_t MAX_BYTES = vmaas::STOCK_MAX_OWN_SALES * MAX_ROW + 1;
}

namespace stock_store
{
    LoadResult load(vmaas::StockLedger &ledger)
    {
        char *buf = static_cast<char *>(std::malloc(MAX_BYTES));
        if (buf == nullptr)
        {
            ESP_LOGE(TAG, "no memory to read %s", PATH);
            return LoadResult::Failed;
        }

        const int n = vmaas::fs::read_text_file(PATH, buf, MAX_BYTES);
        if (n == -1)
        {
            std::free(buf);
            return LoadResult::Absent;
        }
        if (n < 0)
        {
            ESP_LOGE(TAG, "%s is unreadable or too large", PATH);
            std::free(buf);
            return LoadResult::Failed;
        }

        LoadResult result = LoadResult::Loaded;
        char *line = buf;
        while (line != nullptr && *line != '\0')
        {
            char *next = std::strchr(line, '\n');
            if (next != nullptr) *next++ = '\0';

            char l[vmaas::STOCK_LEDGER_MAX + 1] = {};
            unsigned long seq = 0, t = 0;
            unsigned slot = 0;
            if (std::sscanf(line, "%16s %lu %u %lu", l, &seq, &slot, &t) != 4 || slot == 0 || slot > 255 ||
                !ledger.record_sale(l, static_cast<uint32_t>(seq), static_cast<uint8_t>(slot), static_cast<int64_t>(t)))
            {
                ESP_LOGE(TAG, "%s has an unusable line: \"%s\"", PATH, line);
                result = LoadResult::Failed;
            }
            line = next;
        }

        std::free(buf);
        return result;
    }

    bool save(const vmaas::StockLedger &ledger)
    {
        const size_t cap = ledger.own_sale_count() * MAX_ROW + 1;
        char *buf = static_cast<char *>(std::malloc(cap));
        if (buf == nullptr)
        {
            ESP_LOGE(TAG, "no memory to write %s; own sales kept in RAM until the next save", PATH);
            return false;
        }

        size_t pos = 0;
        buf[0] = '\0';
        for (size_t i = 0; i < ledger.own_sale_count(); ++i)
        {
            const vmaas::OwnSale s = ledger.own_sale(i);
            const int n = std::snprintf(buf + pos, cap - pos, "%s %lu %u %lu\n", s.ledger,
                                        static_cast<unsigned long>(s.sequence), static_cast<unsigned>(s.slot),
                                        static_cast<unsigned long>(s.at));
            if (n < 0 || static_cast<size_t>(n) >= cap - pos)
            {
                std::free(buf);
                return false;
            }
            pos += static_cast<size_t>(n);
        }

        const bool ok = vmaas::fs::write_text_file(PATH, buf, pos);
        std::free(buf);
        if (!ok) ESP_LOGE(TAG, "could not write %s", PATH);
        return ok;
    }
}
