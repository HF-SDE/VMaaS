#include "file_io.h"

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <sys/stat.h>
#include <unistd.h>

#include "esp_log.h"
#include "record.h"

namespace
{
    constexpr const char* TAG = "VmaasFileIo";
}

namespace vmaas::fs
{
    bool LittleFsPort::append_line(const char* path, const char* line)
    {
        FILE* f = std::fopen(path, "a");
        if (f == nullptr)
        {
            ESP_LOGE(TAG, "cannot open %s for append", path);
            return false;
        }

        const bool written = std::fprintf(f, "%s\n", line) > 0;
        // fflush() alone only moves the record out of stdio's own userspace
        // buffer and into the write() LittleFS sees; the data can still sit
        // in LittleFS's internal program cache until the file is synced or
        // closed. lfs_file_close() (which fclose() reaches through the VFS
        // layer) does that sync as part of closing, so checking fclose()'s
        // result - which the naive version of this function discards - is
        // what actually catches a failure to land the record before this
        // call returns. That is the entire durability claim of this design:
        // a power cut right after append_line() returns must not lose the
        // record the caller was just told is stored.
        const bool flushed = (std::fflush(f) == 0);
        const bool closed = (std::fclose(f) == 0);
        return written && flushed && closed;
    }

    bool LittleFsPort::for_each_line(const char* path, void* ctx, vmaas::events::LineVisitor visit)
    {
        FILE* f = std::fopen(path, "r");
        if (f == nullptr) return true;

        // +1 beyond MAX_LINE: MAX_LINE already covers the longest encoded
        // line's content plus its own NUL (record.h), but on disk that line
        // is followed by the '\n' append_line() adds. Without the extra
        // byte, fgets() on a maximum-length line would stop one byte short
        // of that newline and this loop would mistake a complete record for
        // a torn tail - discarding it and everything after it.
        char line[vmaas::events::MAX_LINE + 1];
        bool keep_going = true;
        while (keep_going && std::fgets(line, sizeof(line), f) != nullptr)
        {
            const size_t len = std::strlen(line);
            if (len == 0 || line[len - 1] != '\n') break;
            line[len - 1] = '\0';
            keep_going = visit(ctx, line);
        }

        std::fclose(f);
        return true;
    }

    bool LittleFsPort::read_all(const char* path, char* out, size_t cap)
    {
        if (out == nullptr || cap == 0) return false;

        FILE* f = std::fopen(path, "r");
        if (f == nullptr) return false;

        const size_t n = std::fread(out, 1, cap - 1, f);

        // Peek one more byte, exactly as read_text_file() does in
        // storage.cpp: feof() after an fread() that exactly exhausts the
        // file is not reliably set until another read is attempted, so it
        // cannot tell "fits exactly" apart from "longer than the buffer".
        // Without this peek, a cursor longer than cap would be silently
        // accepted shortened - a truncated cursor that still parses is worse
        // than no cursor at all.
        const bool more = (std::fgetc(f) != EOF);
        const bool failed_read = std::ferror(f) != 0;
        std::fclose(f);

        if (more || failed_read) return false;
        out[n] = '\0';
        return true;
    }

    bool LittleFsPort::write_atomic(const char* path, const char* text)
    {
        char tmp[128];
        const int n = std::snprintf(tmp, sizeof(tmp), "%s.tmp", path);
        if (n <= 0 || static_cast<size_t>(n) >= sizeof(tmp)) return false;

        FILE* f = std::fopen(tmp, "w");
        if (f == nullptr) return false;

        const bool written = std::fputs(text, f) >= 0;
        const bool flushed = (std::fflush(f) == 0);
        const bool closed = (std::fclose(f) == 0);

        if (!written || !flushed || !closed)
        {
            ::unlink(tmp);
            return false;
        }

        if (::rename(tmp, path) != 0)
        {
            ::unlink(tmp);
            return false;
        }
        return true;
    }

    long LittleFsPort::size(const char* path)
    {
        struct stat st{};
        if (::stat(path, &st) != 0) return -1;
        return static_cast<long>(st.st_size);
    }

    bool LittleFsPort::rename(const char* from, const char* to)
    {
        return ::rename(from, to) == 0;
    }

    bool LittleFsPort::remove(const char* path)
    {
        return ::unlink(path) == 0 || errno == ENOENT;
    }
}
