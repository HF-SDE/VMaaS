#pragma once
/**
 * @file fake_fs.h
 * @brief An in-memory FilePort, so the journal's logic is tested on the host.
 *
 * Deliberately simple: a map of paths to contents. It models the two things
 * the real filesystem does that the journal must survive - a file that does
 * not exist yet, and a trailing line with no newline, which is what an
 * interrupted append leaves behind.
 */
#include <cstdio>
#include <map>
#include <string>

#include "file_port.h"

namespace vmaas::events::test
{
    class FakeFs : public FilePort
    {
    public:
        std::map<std::string, std::string> files;

        /// When true, rename() fails without touching either file - simulates
        /// an interrupted rewrite so tests can check what a caller does when
        /// the replacement never lands. Defaults to false: every existing
        /// test gets the old, always-succeeds behaviour unchanged.
        bool fail_rename = false;

        /// When >= 0, the (fail_append_after_n + 1)th append_line() call to any
        /// GIVEN path fails and leaves that file untouched - simulating a
        /// filesystem that fills up partway through a write. Counted per path
        /// rather than globally, so arming this right before a compaction call
        /// affects the fresh temp file it writes into without also requiring
        /// the test to account for appends already made to the journal itself.
        /// Defaults to -1 (off): every existing test gets the old,
        /// always-succeeds behaviour unchanged.
        int fail_append_after_n = -1;

        bool append_line(const char* path, const char* line) override
        {
            if (fail_append_after_n >= 0)
            {
                int& calls = append_calls_[path];
                if (calls >= fail_append_after_n) return false;
                ++calls;
            }
            files[path] += line;
            files[path] += "\n";
            return true;
        }

        bool for_each_line(const char* path, void* ctx, LineVisitor visit) override
        {
            auto it = files.find(path);
            if (it == files.end()) return true;

            std::string current;
            for (char c : it->second)
            {
                if (c == '\n')
                {
                    if (!visit(ctx, current.c_str())) return true;
                    current.clear();
                }
                else current += c;
            }
            return true; // a trailing partial line is ignored, as on device
        }

        bool read_all(const char* path, char* out, size_t cap) override
        {
            auto it = files.find(path);
            if (it == files.end() || it->second.size() + 1 > cap) return false;
            std::snprintf(out, cap, "%s", it->second.c_str());
            return true;
        }

        bool write_atomic(const char* path, const char* text) override
        {
            files[path] = text;
            return true;
        }

        long size(const char* path) override
        {
            auto it = files.find(path);
            return it == files.end() ? -1 : static_cast<long>(it->second.size());
        }

        bool rename(const char* from, const char* to) override
        {
            if (fail_rename) return false;
            auto it = files.find(from);
            if (it == files.end()) return false;
            files[to] = it->second;
            files.erase(it);
            return true;
        }

        bool remove(const char* path) override
        {
            files.erase(path);
            return true;
        }

    private:
        std::map<std::string, int> append_calls_; ///< Per-path count, for fail_append_after_n.
    };

    inline constexpr const char* JSONL = "/events.jsonl";
    inline constexpr const char* CURSOR = "/events.cursor";
}
