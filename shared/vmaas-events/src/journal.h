#pragma once
/**
 * @file journal.h
 * @brief The machine's durable event queue.
 *
 * An append-only file of records plus a cursor file holding the highest
 * sequence number the platform has acknowledged. Append-only is what makes a
 * power cut cheap: it can cost the record being written and nothing behind it.
 *
 * A cursor rather than a per-record "sent" flag, because the queue drains
 * strictly oldest-first, so one high-water mark says everything a flag would
 * and nothing has to be rewritten in place.
 */
#include <cstddef>
#include <cstdint>

#include "file_port.h"
#include "record.h"

namespace vmaas::events
{
    /// Append-only event queue over a FilePort.
    class Journal
    {
    public:
        /**
         * @param fs          Filesystem to use. Must outlive the journal.
         * @param jsonl_path  Records file.
         * @param cursor_path Cursor file.
         * @param cap_bytes   Size at which compaction runs. See compact_if_needed().
         */
        Journal(FilePort& fs, const char* jsonl_path, const char* cursor_path, size_t cap_bytes);

        /// @brief Load the cursor, creating it when absent. Call once.
        bool begin();

        /**
         * @brief Append one event.
         * @param type       Event type, e.g. "door-released".
         * @param payload    Serialised JSON object. Must not contain a newline.
         * @param uptime_ms  Milliseconds since boot, now.
         * @param wall_ms    Unix milliseconds now, or 0 when the clock is unknown.
         * @return The sequence number assigned, or 0 when the record was
         *         refused - or when it was written but its cursor could not
         *         be persisted, which is not a durable append even though the
         *         line is on disk. See the comment at that return for why the
         *         caller must treat it as a failure and log it.
         */
        uint32_t append(const char* type, const char* payload, uint32_t uptime_ms, uint64_t wall_ms);

        /**
         * @brief Copy up to @p max unacknowledged records, oldest first.
         * @return How many were written to @p out.
         */
        uint32_t take(Record* out, size_t max);

        /// @brief Record that everything up to and including @p seq is safely stored.
        bool ack_through(uint32_t seq);

        uint32_t next_seq() const { return next_; }
        uint32_t acked() const { return acked_; }

        /**
         * @brief Shrink the records file when it has grown past the cap.
         *
         * Up to two passes, each streaming the records worth keeping into a
         * temp file and renaming it over the original, so an interruption
         * leaves the original intact. The first pass always runs and drops
         * what the platform has acknowledged. Whether the second pass runs
         * is decided by re-measuring the file afterwards, never by the
         * value of acked_: if the file is still over the cap - a machine
         * that has been offline for a very long time, whether or not it
         * ever acknowledged anything - the oldest of what remains is
         * sacrificed too, counted in dropped(), because a full filesystem
         * would take config.json down with it. Measuring rather than
         * branching on acked_ is what lets this keep reclaiming space on
         * every call that needs it, not just the first.
         *
         * @return true when the file was rewritten.
         */
        bool compact_if_needed();

        /// @return How many unsent records have been dropped for space since boot.
        uint32_t dropped() const { return dropped_; }

    private:
        bool save_cursor();

        /**
         * @brief Rewrite the records file keeping only seq > @p keep_after.
         *
         * The shared streaming step behind both passes of compact_if_needed():
         * removes any stale temp file, streams survivors into it (creating it
         * empty when none survive, since rename needs a source file), and
         * renames it over the records file.
         *
         * @param kept_out When non-null, set to how many records survived.
         * @return false when the temp path does not fit or the rename fails;
         *         the original file is untouched either way.
         */
        bool rewrite_keeping_after(uint32_t keep_after, uint32_t* kept_out);

        FilePort& fs_;
        const char* jsonl_;
        const char* cursor_;
        size_t cap_bytes_;
        uint32_t acked_ = 0;
        uint32_t next_ = 1;
        const char* tmp_suffix_ = ".tmp";
        uint32_t dropped_ = 0;
    };
}
