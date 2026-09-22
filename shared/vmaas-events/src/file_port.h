#pragma once
/**
 * @file file_port.h
 * @brief The filesystem, as the journal needs to see it.
 *
 * The journal performs no I/O itself so that all of its logic runs in host
 * tests against an in-memory fake. On the device this is implemented over the
 * mounted LittleFS in vmaas-fs, which cannot be compiled natively because it
 * includes esp_littlefs.h.
 */
#include <cstddef>

namespace vmaas::events
{
    /// Line visitor. Return false to stop iterating.
    using LineVisitor = bool (*)(void* ctx, const char* line);

    /// The few filesystem operations the journal performs.
    class FilePort
    {
    public:
        virtual ~FilePort() = default;

        /// Append one line plus '\n' to @p path, creating it if absent, and flush.
        virtual bool append_line(const char* path, const char* line) = 0;

        /// Visit every complete line of @p path in order. A missing file visits nothing and succeeds.
        virtual bool for_each_line(const char* path, void* ctx, LineVisitor visit) = 0;

        /// Read a whole small file. Returns false when it is absent or does not fit.
        virtual bool read_all(const char* path, char* out, size_t cap) = 0;

        /// Replace @p path's contents with @p text, atomically as far as the filesystem allows.
        virtual bool write_atomic(const char* path, const char* text) = 0;

        /// Size of @p path in bytes, or -1 when it is absent.
        virtual long size(const char* path) = 0;

        /// Rename @p from over @p to.
        virtual bool rename(const char* from, const char* to) = 0;

        /// Delete @p path. Succeeds when it is already absent.
        virtual bool remove(const char* path) = 0;
    };
}
