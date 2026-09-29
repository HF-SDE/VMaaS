/**
 * @file prices.cpp
 * @brief See prices.h. Uses cJSON, as config_store does, and vmaas::fs for the
 *        same whole-file-read-with-bound-check config_store and activation use.
 */
#include "prices.h"

#include <cstdio>
#include <cstring>

#include "cJSON.h"
#include "esp_log.h"
#include "storage.h"

namespace
{
    constexpr const char *TAG = "prices";
    constexpr const char *PATH = "/storage/prices.json";
    /// Generous for 32 slots plus the cash block, and still small next to the
    /// 8 KB the TLS handshake wants.

    /// Reads obj[key] as a whole, non-negative number that fits in uint32_t.
    /// Leaves @p out untouched when the key is absent, the value is not a
    /// number, is non-finite, is outside uint32_t's range, or is fractional.
    /// Every field in this file is optional by design, so "unusable" means
    /// "keep the caller's default", never "guess".
    void read_u32(const cJSON *obj, const char *key, uint32_t &out)
    {
        const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
        if (item == nullptr || !cJSON_IsNumber(item)) return;

        const double d = item->valuedouble;

        if (!(d >= 0.0 && d <= static_cast<double>(UINT32_MAX))) return;

        if (d != static_cast<double>(static_cast<uint32_t>(d))) return;

        out = static_cast<uint32_t>(d);
    }

    void read_u16(const cJSON *obj, const char *key, uint16_t &out)
    {
        uint32_t wide = out;
        read_u32(obj, key, wide);
        if (wide <= 0xFFFF) out = static_cast<uint16_t>(wide);
    }

    void read_bool(const cJSON *obj, const char *key, bool &out)
    {
        const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
        if (cJSON_IsBool(item)) out = cJSON_IsTrue(item);
    }
}

namespace prices
{
    /// Shared by load() and load_stock(); see load_stock().
    static char load_buf[MAX_PAYLOAD];

    bool load(vmaas::CoinConfig &coin, vmaas::PurchaseConfig &purchase, Table &table)
    {
        char *buf = load_buf;
        const int n = vmaas::fs::read_text_file(PATH, buf, sizeof(load_buf));
        if (n == -1)
        {
            ESP_LOGW(TAG, "%s not found or unreadable, no cash sales until it is provisioned", PATH);
            return false;
        }
        if (n == -2)
        {
            ESP_LOGE(TAG, "%s is larger than %u bytes, refusing to parse a fragment",
                     PATH, static_cast<unsigned>(MAX_PAYLOAD));
            return false;
        }

        return parse(buf, coin, purchase, table);
    }

    bool merge_store(const char *json)
    {
        cJSON *fresh = cJSON_Parse(json);
        if (!cJSON_IsObject(fresh))
        {
            ESP_LOGE(TAG, "refusing to merge a payload that is not a JSON object");
            cJSON_Delete(fresh);
            return false;
        }

        static char buf[MAX_PAYLOAD];
        cJSON *merged = nullptr;
        if (vmaas::fs::read_text_file(PATH, buf, sizeof(buf)) > 0) merged = cJSON_Parse(buf);

        if (!cJSON_IsObject(merged))
        {
            // Unprovisioned, or a file that no longer parses.
            cJSON_Delete(merged);
            merged = cJSON_CreateObject();
        }

        if (merged == nullptr)
        {
            cJSON_Delete(fresh);
            return false;
        }

        const cJSON *item = nullptr;
        cJSON_ArrayForEach(item, fresh)
        {
            if (cJSON_IsObject(item) && item->child == nullptr) continue;

            cJSON *copy = cJSON_Duplicate(item, true);
            if (copy == nullptr) continue;

            cJSON_DeleteItemFromObjectCaseSensitive(merged, item->string);
            cJSON_AddItemToObject(merged, item->string, copy);
        }

        char *text = cJSON_PrintUnformatted(merged);
        cJSON_Delete(merged);
        cJSON_Delete(fresh);

        if (text == nullptr)
        {
            ESP_LOGE(TAG, "out of memory rendering the merged configuration");
            return false;
        }

        const bool ok = vmaas::fs::write_text_file(PATH, text, std::strlen(text));
        cJSON_free(text);
        return ok;
    }

    bool read_wiring(char *out, size_t out_len)
    {
        if (out_len == 0) return false;
        out[0] = '\0';

        static char buf[MAX_PAYLOAD];
        if (vmaas::fs::read_text_file(PATH, buf, sizeof(buf)) <= 0) return false;

        cJSON *root = cJSON_Parse(buf);
        cJSON *wiring = cJSON_GetObjectItemCaseSensitive(root, "wiring");
        bool ok = cJSON_IsObject(wiring) && wiring->child != nullptr;
        if (ok)
        {
            ok = cJSON_PrintPreallocated(wiring, out, static_cast<int>(out_len), false) != 0;
            if (!ok) out[0] = '\0';
        }
        cJSON_Delete(root);
        return ok;
    }

    bool parse_stock(const char *json, vmaas::StockBaseline &out)
    {
        if (json == nullptr) return false;
        cJSON *root = cJSON_Parse(json);
        const cJSON *stock = cJSON_GetObjectItemCaseSensitive(root, "stock");
        const cJSON *acks = cJSON_GetObjectItemCaseSensitive(stock, "acks");
        const cJSON *slots = cJSON_GetObjectItemCaseSensitive(stock, "slots");
        if (!cJSON_IsObject(stock) || !cJSON_IsArray(acks) || !cJSON_IsArray(slots))
        {
            cJSON_Delete(root);
            return false;
        }

        vmaas::StockBaseline b{};
        const cJSON *ack = nullptr;
        cJSON_ArrayForEach(ack, acks)
        {
            if (b.ack_count >= vmaas::STOCK_MAX_LEDGERS) break;
            const cJSON *ledger = cJSON_GetObjectItemCaseSensitive(ack, "ledger");
            uint32_t as_of = 0;
            read_u32(ack, "asOfSequence", as_of);
            if (!cJSON_IsString(ledger) || std::strlen(ledger->valuestring) > vmaas::STOCK_LEDGER_MAX) continue;
            vmaas::StockAck &a = b.acks[b.ack_count++];
            std::snprintf(a.ledger, sizeof(a.ledger), "%s", ledger->valuestring);
            a.as_of_sequence = as_of;
        }

        const cJSON *row = nullptr;
        cJSON_ArrayForEach(row, slots)
        {
            if (b.slot_count >= vmaas::STOCK_MAX_SLOTS) break;
            uint32_t slot = 0, qty = 0;
            read_u32(row, "slot", slot);
            read_u32(row, "quantity", qty);
            if (slot == 0 || slot > 255) continue;
            int64_t counted = 0;
            const cJSON *at = cJSON_GetObjectItemCaseSensitive(row, "countedAt");
            if (cJSON_IsString(at) && !vmaas::parse_iso8601_utc(at->valuestring, counted)) counted = 0;
            b.slots[b.slot_count++] = {static_cast<uint8_t>(slot), qty, counted};
        }

        cJSON_Delete(root);
        out = b;
        return true;
    }

    bool load_stock(vmaas::StockBaseline &out)
    {
        if (vmaas::fs::read_text_file(PATH, load_buf, sizeof(load_buf)) <= 0) return false;
        return parse_stock(load_buf, out);
    }

    bool parse(const char *json, vmaas::CoinConfig &coin, vmaas::PurchaseConfig &purchase, Table &table)
    {
        if (json == nullptr) return false;

        cJSON *root = cJSON_Parse(json);
        if (root == nullptr || !cJSON_IsObject(root))
        {
            ESP_LOGE(TAG, "configuration payload is not a valid JSON object");
            cJSON_Delete(root);
            return false;
        }

        const cJSON *cash = cJSON_GetObjectItemCaseSensitive(root, "cash");
        if (cJSON_IsObject(cash))
        {
            read_bool(cash, "activeLow", coin.active_low);
            read_u16(cash, "minPulseMs", coin.min_pulse_ms);
            read_u16(cash, "trainGapMs", coin.train_gap_ms);
            read_u32(cash, "paymentTimeoutMs", purchase.payment_timeout_ms);
            read_bool(cash, "hasInhibit", purchase.has_inhibit);


            const cJSON *cur = cJSON_GetObjectItemCaseSensitive(cash, "currency");
            if (cJSON_IsString(cur) && cur->valuestring != nullptr && std::strlen(cur->valuestring) < sizeof(table.currency)) {
                    std::snprintf(table.currency, sizeof(table.currency), "%s", cur->valuestring);
                }

            const cJSON *values = cJSON_GetObjectItemCaseSensitive(cash, "valueByPulses");
            if (cJSON_IsObject(values))
            {
                for (uint8_t p = 1; p <= vmaas::COIN_MAX_PULSES; ++p)
                {
                    char key[4];
                    std::snprintf(key, sizeof(key), "%u", static_cast<unsigned>(p));
                    read_u32(values, key, coin.value_by_pulses[p]);
                }
            }
        }

        const cJSON *list = cJSON_GetObjectItemCaseSensitive(root, "prices");
        if (cJSON_IsArray(list))
        {
            const cJSON *entry = nullptr;
            cJSON_ArrayForEach(entry, list)
            {
                if (!cJSON_IsObject(entry)) continue;

                uint32_t slot = 0;
                uint32_t price = 0;
                read_u32(entry, "slot", slot);
                read_u32(entry, "priceMinor", price);

                if (slot >= 1 && slot <= MAX_SLOT) {
                    table.by_slot[slot] = price;
                } else {
                    ESP_LOGW(TAG, "ignoring price for out-of-range slot %lu", static_cast<unsigned long>(slot));
                }
            }
        }

        cJSON_Delete(root);
        table.loaded = true;

        ESP_LOGI(TAG, "loaded: currency %s, coins %lu/%lu/%lu, timeout %lu ms, inhibit %s",
                 table.currency,
                 static_cast<unsigned long>(coin.value_by_pulses[1]),
                 static_cast<unsigned long>(coin.value_by_pulses[2]),
                 static_cast<unsigned long>(coin.value_by_pulses[3]),
                 static_cast<unsigned long>(purchase.payment_timeout_ms),
                 purchase.has_inhibit ? "yes" : "no");

        return true;
    }

    uint32_t for_slot(const Table &table, uint8_t slot)
    {
        if (!table.loaded || slot < 1 || slot > MAX_SLOT) return 0;
        return table.by_slot[slot];
    }
}
