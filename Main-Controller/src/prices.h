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
#include <cstddef>
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

    /**
     * @brief Parse a configuration payload over the given defaults.
     *
     * The body of load(), reachable without going through flash first: this is
     * the same JSON, and config_sync has it in memory the moment
     * GET /device/configuration answers. Parsing before storing is also what
     * lets a malformed payload be rejected without overwriting a good file.
     *
     * @param json NUL-terminated MachineConfiguration.payload.
     * @return True when it parsed. False leaves every argument untouched
     *         except @p table, whose `loaded` stays false.
     */
    bool parse(const char *json, vmaas::CoinConfig &coin, vmaas::PurchaseConfig &purchase, Table &table);

    /**
     * @brief Merge a fetched payload into the cached one on flash.
     *
     * Merge and not replace, for the same reason parse() treats every field as
     * optional: a block the payload does not carry is not a block the platform
     * is asking to have cleared. The backend publishes `cash: {}` today - it
     * has no coin calibration to publish yet - and writing that over the file
     * would wipe the provisioned pulse values, leaving the machine unable to
     * value a coin from its next reboot on.
     *
     * Top-level keys present in @p json replace their stored counterparts. An
     * empty object replaces nothing. Keys only in the stored file are kept.
     *
     * Kept here rather than in config_sync so the path stays private to the
     * one file that knows what lives at it.
     *
     * @return True once the merged document is on flash.
     */
    bool merge_store(const char *json);

    /**
     * @brief Copy the cached payload's `wiring` block out as JSON text.
     *
     * The block has config.json v2's shape ({version, motor, slots}), so the
     * text goes straight into vmaas::parse_slot_config().
     *
     * @return False when there is no file, it does not parse, or it has no
     *         non-empty `wiring` object (a machine never published with
     *         wiring), or @p out is too small. @p out is then empty.
     */
    bool read_wiring(char *out, size_t out_len);

    /// Largest payload the device will accept, in bytes. The response buffer
    /// the fetch reads into has to be at least this big for a configuration
    /// that fits on flash to also fit through the wire.
    constexpr size_t MAX_PAYLOAD = 4096;

    /// @return The price for @p slot in minor units, or 0 if it has none.
    uint32_t for_slot(const Table &table, uint8_t slot);
}
