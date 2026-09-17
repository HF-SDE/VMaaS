#pragma once
/**
 * @file storage.h
 * @brief LittleFS mounting and whole-file reading, shared by both controllers.
 */
#include <cstddef>

/// Filesystem access for VMaaS controllers.
namespace vmaas::fs
{
    /**
     * @brief Mount a LittleFS partition.
     *
     * Never formats: a partition that will not mount. Logs the failure, or the usage on success.
     *
     * @param partition_label Name in partitions.csv, e.g. "storage".
     * @param mount_point VFS path, e.g. "/storage".
     * @return true if the filesystem is mounted.
     */
    bool mount(const char* partition_label, const char* mount_point);

    /**
     * @brief Read a whole text file into a buffer and NUL-terminate it.
     *
     * A file larger than the buffer is rejected rather than shortened: a
     * truncated config parses as valid JSON surprisingly often.
     *
     * @param path Absolute VFS path.
     * @param buf Destination buffer.
     * @param capacity Size of @p buf in bytes, including room for the NUL.
     * @return Bytes read (>= 0); -1 if the file cannot be opened or read;
     *         -2 if it does not fit or the arguments are invalid.
     */
    int read_text_file(const char* path, char* buf, size_t capacity);
}
