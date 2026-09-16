#pragma once
/**
 * @file config_store.h
 * @brief LittleFS mount and config file access for the Main-Controller.
 */
#include <cstddef>

#include "config.h"

namespace config_store
{
    constexpr const char* MOUNT_POINT = "/storage";               ///< VFS mount point.
    constexpr const char* PARTITION_LABEL = "storage";            ///< Name in partitions.csv.
    constexpr const char* CONFIG_PATH = "/storage/config.json";   ///< Device config file.

    /**
     * @brief Mount the LittleFS partition at MOUNT_POINT.
     *
     * Never formats. On failure the error is logged and false returned; the
     * caller continues on defaults.
     * @return true if the filesystem is mounted.
     */
    bool mount_storage();

    /**
     * @brief Read a whole text file into a buffer and NUL-terminate it.
     * @param path Absolute VFS path.
     * @param buf Destination buffer.
     * @param capacity Size of @p buf in bytes, including room for the NUL.
     * @return Bytes read (>= 0); -1 if the file cannot be opened; -2 if it does not fit.
     */
    int read_text_file(const char* path, char* buf, size_t capacity);

    /// Largest config.json accepted, in bytes including the NUL. Bigger files are ignored with a warning.
    constexpr size_t MAX_CONFIG_BYTES = 2048;

    /**
     * @brief Read, parse and log the device configuration.
     *
     * Reads CONFIG_PATH, merges it over @p defaults with vmaas::parse_config(),
     * logs one warning per issue and the effective configuration at INFO level.
     * The device always gets a usable Config back: on any failure the defaults.
     *
     * @param defaults Factory values (see defaults.h).
     * @return Effective configuration.
     */
    vmaas::Config load_config(const vmaas::Config& defaults);
}
