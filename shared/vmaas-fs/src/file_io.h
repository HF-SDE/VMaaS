#pragma once
/**
 * @file file_io.h
 * @brief The event journal's filesystem, implemented on the mounted LittleFS.
 *
 * Lives here rather than in vmaas-events because it is device-only: the
 * journal itself stays hardware-free so its logic can be tested on a host.
 * See file_port.h for what each method promises the journal.
 */
#include "file_port.h"

namespace vmaas::fs
{
    /// vmaas::events::FilePort over the LittleFS mounted by mount().
    class LittleFsPort : public vmaas::events::FilePort
    {
    public:
        bool append_line(const char* path, const char* line) override;
        bool for_each_line(const char* path, void* ctx, vmaas::events::LineVisitor visit) override;
        bool read_all(const char* path, char* out, size_t cap) override;
        bool write_atomic(const char* path, const char* text) override;
        long size(const char* path) override;
        bool rename(const char* from, const char* to) override;
        bool remove(const char* path) override;
    };
}
