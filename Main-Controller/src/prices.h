#pragma once
/**
 * @file prices.h
 * @brief Reads the cash calibration and the slot price table from LittleFS.
 *
 * The file is a cache of MachineConfiguration.payload, fetched from
 * GET /device/configuration. Selling offline from the last known prices is
 * deliberate: a coin cannot be rolled back, so payment must never wait on the
 * network.
 *
 * Every field is optional. Anything missing keeps the default already in the
 * struct the caller passed in, and a malformed file leaves Table::loaded false
 * so no cash sale can happen — the machine falls back to logging slot choices,
 * which is what it did before this feature.
 */
#include <cstdint>

#include "coin_acceptor.h"
#include "purchase.h"

namespace prices
{
    /// Highest slot number the table can hold. Slots are 1-based.
    constexpr uint8_t MAX_SLOT = 32;

    struct Table
    {
        /// Index by slot number; 0 means "no price, not for sale".
        uint32_t by_slot[MAX_SLOT + 1] = {};
        char     currency[8] = "DKK";
        bool     loaded = false;
    };

    /**
     * @brief Load /storage/prices.json over the given defaults.
     * @return True when the file parsed. False leaves every argument untouched
     *         except @p table, whose `loaded` stays false.
     */
    bool load(vmaas::CoinConfig &coin, vmaas::PurchaseConfig &purchase, Table &table);

    /// @return The price for @p slot in minor units, or 0 if it has none.
    uint32_t for_slot(const Table &table, uint8_t slot);
}
