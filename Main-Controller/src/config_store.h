#pragma once
/**
 * @file config_store.h
 * @brief LittleFS mount and device-config loading for Main-Controller.
 */
#include <cstddef>
#include "device_config.h"

/// Configuration loading for the Main-Controller.
namespace config_store
{
    constexpr const char* MOUNT_POINT     = "/storage";             ///< VFS mount point.
    constexpr const char* PARTITION_LABEL = "storage";              ///< Name in partitions.csv.
    constexpr const char* CONFIG_PATH     = "/storage/config.json"; ///< Device configuration file.

    /**
     * @brief Optional trust anchor for the API, if it is not behind a public root.
     *
     * Absent on a production unit, where esp_crt_bundle's Mozilla roots verify
     * the API host. Present on a bench or on-premise deployment whose API is
     * served by a private CA - the local dev stack's nginx is exactly that.
     *
     * It lives on the filesystem rather than in the firmware because it is
     * per-deployment data, the same as backend.api_base_url beside it: pointing
     * a machine at a different environment should not need a new build.
     */
    constexpr const char* API_CA_PATH     = "/storage/api_ca.pem";

    /// Largest config.json accepted, in bytes including the NUL. Bigger files are rejected.
    constexpr size_t MAX_CONFIG_BYTES = 2048;

    /**
     * @brief Mount storage, read CONFIG_PATH, parse it and log the outcome.
     *
     * Logs one warning per issue at WARN and the resulting settings at INFO.
     * Call once, from app_main, before anything else touches the filesystem.
     *
     * @return Settings that are always usable, defaults included.
     */
    vmaas::DeviceConfig load();
}
