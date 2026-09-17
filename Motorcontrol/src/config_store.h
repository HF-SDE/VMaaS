#pragma once
/**
 * @file config_store.h
 * @brief LittleFS mount and slot-config loading for Motorcontrol.
 */
#include <cstddef>
#include "slot_config.h"

namespace config_store
{
    constexpr const char* MOUNT_POINT = "/storage";               ///< VFS mount point.
    constexpr const char* PARTITION_LABEL = "storage";            ///< Name in partitions.csv.
    constexpr const char* CONFIG_PATH = "/storage/config.json";   ///< Slot wiring file.

    /// Largest config.json accepted, in bytes including the NUL. Bigger files are rejected.
    constexpr size_t MAX_CONFIG_BYTES = 2048;

    /// Outcome of load_config().
    struct LoadResult
    {
        vmaas::SlotConfig config; ///< Validated slot table. Only meaningful when ok.
        bool ok;              ///< true: the table may drive motors. false: see reason.
        char reason[40];      ///< Short cause for logs, e.g. "config.json missing" or "slots[2].pin OutOfRange".
    };

    /**
     * @brief Read, parse and log the slot configuration.
     *
     * Reads CONFIG_PATH and runs vmaas::parse_slot_config(). Logs one warning per
     * issue and, on success, the slot table at INFO level. There is no
     * default wiring: when the file is missing or invalid, ok is false and
     * the caller must not drive any motor.
     *
     * @return Slot table and verdict.
     */
    LoadResult load_config();
}
