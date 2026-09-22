#include "journal.h"

#include <cstdio>
#include <cstring>

namespace
{
    using namespace vmaas::events;

    /// Collects the oldest unacked records while iterating the file.
    struct TakeCtx
    {
        uint32_t after;
        Record* out;
        size_t max;
        uint32_t count;
    };

    bool take_visitor(void* ctx, const char* line)
    {
        TakeCtx* t = static_cast<TakeCtx*>(ctx);
        if (t->count >= t->max) return false;

        Record r{};
        if (!decode_record(line, r)) return true;
        if (r.seq <= t->after) return true;

        t->out[t->count++] = r;
        return t->count < t->max;
    }

    /// Finds the highest sequence number present, to resume after a lost cursor.
    bool max_seq_visitor(void* ctx, const char* line)
    {
        uint32_t* highest = static_cast<uint32_t*>(ctx);
        Record r{};
        if (decode_record(line, r) && r.seq > *highest) *highest = r.seq;
        return true;
    }

    /// Streams the records to keep into a temp file during compaction.
    struct CompactCtx
    {
        FilePort* fs;
        const char* tmp;
        uint32_t keep_after; ///< Records with seq <= this are discarded.
        uint32_t kept;
        bool ok = true; ///< False once an append into the temp file has failed.
    };

    bool compact_visitor(void* ctx, const char* line)
    {
        CompactCtx* c = static_cast<CompactCtx*>(ctx);
        Record r{};
        if (!decode_record(line, r)) return true; // torn tail, discard
        if (r.seq <= c->keep_after) return true;

        if (!c->fs->append_line(c->tmp, line))
        {
            c->ok = false;
            return false;
        }
        ++c->kept;
        return true;
    }

    /// Counts unacked records, to work out how many must go when nothing is acked.
    struct CountCtx
    {
        uint32_t after;
        uint32_t count;
        uint32_t lowest;
    };

    bool count_visitor(void* ctx, const char* line)
    {
        CountCtx* c = static_cast<CountCtx*>(ctx);
        Record r{};
        if (!decode_record(line, r) || r.seq <= c->after) return true;
        if (c->count == 0 || r.seq < c->lowest) c->lowest = r.seq;
        ++c->count;
        return true;
    }
}

namespace vmaas::events
{
    Journal::Journal(FilePort& fs, const char* jsonl_path, const char* cursor_path, size_t cap_bytes)
        : fs_(fs), jsonl_(jsonl_path), cursor_(cursor_path), cap_bytes_(cap_bytes) {}

    bool Journal::begin()
    {
        uint32_t highest = 0;
        fs_.for_each_line(jsonl_, &highest, max_seq_visitor);

        char buf[64];
        if (fs_.read_all(cursor_, buf, sizeof(buf)))
        {
            unsigned long acked = 0, next = 0;
            if (std::sscanf(buf, "%lu|%lu", &acked, &next) == 2 && next > acked)
            {
                acked_ = static_cast<uint32_t>(acked);

                const uint32_t from_journal = highest + 1;
                const uint32_t from_cursor = static_cast<uint32_t>(next);
                next_ = from_journal > from_cursor ? from_journal : from_cursor;
                return save_cursor();
            }
        }

        acked_ = 0;
        next_ = highest + 1;
        return save_cursor();
    }

    bool Journal::save_cursor()
    {
        char buf[48];
        std::snprintf(buf, sizeof(buf), "%lu|%lu",
                      static_cast<unsigned long>(acked_), static_cast<unsigned long>(next_));
        return fs_.write_atomic(cursor_, buf);
    }

    uint32_t Journal::append(const char* type, const char* payload, uint32_t uptime_ms, uint64_t wall_ms)
    {
        const char* type_in = (type == nullptr) ? "" : type;
        const char* payload_in = (payload == nullptr) ? "{}" : payload;

        if (std::strlen(type_in) >= MAX_TYPE || std::strlen(payload_in) >= MAX_PAYLOAD) return 0;

        Record r{};
        r.seq = next_;
        r.uptime_ms = uptime_ms;
        r.wall_ms = wall_ms;
        std::snprintf(r.type, sizeof(r.type), "%s", type_in);
        std::snprintf(r.payload, sizeof(r.payload), "%s", payload_in);

        char line[MAX_LINE];
        if (!encode_record(r, line, sizeof(line))) return 0;
        if (!fs_.append_line(jsonl_, line)) return 0;

        ++next_;

        if (!save_cursor()) return 0;

        return r.seq;
    }

    uint32_t Journal::take(Record* out, size_t max)
    {
        if (out == nullptr || max == 0) return 0;
        TakeCtx ctx{acked_, out, max, 0};
        fs_.for_each_line(jsonl_, &ctx, take_visitor);
        return ctx.count;
    }

    bool Journal::ack_through(uint32_t seq)
    {
        if (seq <= acked_) return true;
        acked_ = seq;
        return save_cursor();
    }

    bool Journal::rewrite_keeping_after(uint32_t keep_after, uint32_t* kept_out)
    {
        char tmp[96];
        const int n = std::snprintf(tmp, sizeof(tmp), "%s%s", jsonl_, tmp_suffix_);
        if (n <= 0 || static_cast<size_t>(n) >= sizeof(tmp)) return false;
        fs_.write_atomic(tmp, "");

        CompactCtx ctx{&fs_, tmp, keep_after, 0};
        fs_.for_each_line(jsonl_, &ctx, compact_visitor);

        if (!ctx.ok) return false;

        if (ctx.kept == 0) fs_.write_atomic(tmp, "");

        if (!fs_.rename(tmp, jsonl_)) return false;

        if (kept_out != nullptr) *kept_out = ctx.kept;
        return true;
    }

    bool Journal::compact_if_needed()
    {
        const long bytes = fs_.size(jsonl_);
        if (bytes < 0 || static_cast<size_t>(bytes) < cap_bytes_) return false;

        if (!rewrite_keeping_after(acked_, nullptr)) return false;

        const long after_pass1 = fs_.size(jsonl_);
        if (after_pass1 >= 0 && static_cast<size_t>(after_pass1) < cap_bytes_)
        {
            save_cursor();
            return true;
        }

        CountCtx c{acked_, 0, 0};
        fs_.for_each_line(jsonl_, &c, count_visitor);

        if (c.count > 0)
        {
            const uint32_t dropping = (c.count + 1) / 2;
            const uint32_t keep_after = c.lowest + dropping - 1;
            if (rewrite_keeping_after(keep_after, nullptr)) dropped_ += dropping;
        }
        save_cursor();
        return true;
    }
}
