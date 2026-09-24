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

    /**
     * @brief Write a whole text file, replacing any existing one.
     *
     * Writes to "<path>.tmp" and renames it over @p path, the same dance
     * outbox.cpp does for its rewrites. The reason is the mirror image of
     * read_text_file's: a power cut partway through a plain write leaves a
     * shortened file behind, and a truncated config parses as valid JSON
     * surprisingly often. With the rename, a cut either leaves the previous
     * file untouched or lands the new one whole.
     *
     * @param path Absolute VFS path.
     * @param data Bytes to write. Not required to be NUL-terminated.
     * @param len Number of bytes from @p data to write.
     * @return true once the new contents are on flash under @p path.
     */
    bool write_text_file(const char* path, const char* data, size_t len);
}
