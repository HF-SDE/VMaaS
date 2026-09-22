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
    constexpr size_t MAX_FILE = 4096;

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
    bool load(vmaas::CoinConfig &coin, vmaas::PurchaseConfig &purchase, Table &table)
    {
        static char buf[MAX_FILE];
        const int n = vmaas::fs::read_text_file(PATH, buf, sizeof(buf));
        if (n == -1)
        {
            ESP_LOGW(TAG, "%s not found or unreadable, no cash sales until it is provisioned", PATH);
            return false;
        }
        if (n == -2)
        {
            ESP_LOGE(TAG, "%s is larger than %u bytes, refusing to parse a fragment",
                     PATH, static_cast<unsigned>(MAX_FILE));
            return false;
        }

        cJSON *root = cJSON_Parse(buf);
        if (root == nullptr || !cJSON_IsObject(root))
        {
            ESP_LOGE(TAG, "%s is not a valid JSON object", PATH);
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
