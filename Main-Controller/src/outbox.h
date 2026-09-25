#pragma once
/**
 * @file outbox.h
 * @brief An append-only queue of device events on LittleFS.
 *
 * JSONL, one event per line. An array would have to be read, parsed, extended
 * and rewritten in full on every append — on flash, with a coin in someone's
 * hand. A line append is a line append, and a half-written last line after a
 * power cut is a local problem: begin() discards it and the rest of the queue
 * survives.
 *
 * append() returns only once the bytes are durable. Nothing may send RUN
 * before it has.
 *
 * Thread safety: begin() must run once, before any other call, from a single
 * task at startup - it creates the internal lock. After that, append(),
 * peek(), drop_first(), pending() and next_sequence() are all safe to call
 * from different tasks (Task 9's purchase task calls append() while Task 10's
 * drain task calls peek()/drop_first() from its own task, on purpose, so an
 * HTTPS POST cannot stall a customer mid-payment). A call made before begin()
 * has run fails rather than touching the file unlocked.
 */
#include <cstddef>
#include <cstdint>

#include "esp_err.h"

namespace outbox
{
    /// Longest line append() accepts, including the terminator. Larger than
    /// the 512-byte buffer format_sale_line fills, so a line that library
    /// accepts can never be one this queue refuses.
    constexpr size_t MAX_LINE = 600;
    /// Hard cap on the queue file. Past this, append() refuses rather than
    /// overwrite history, and the caller must refuse the sale.
    constexpr size_t MAX_BYTES = 64 * 1024;

    /// Mount check, sequence counter restore, and partial-line recovery.
    /// Call once, from one task, before any other function in this file.
    esp_err_t begin();

    /// Append one line durably. ESP_ERR_NO_MEM when the cap is reached.
    esp_err_t append(const char *line);

    /// Copy the oldest line into @p buf. False when the queue is empty, or
    /// when the oldest line does not fit in @p buf (never returns a
    /// truncated fragment).
    bool peek(char *buf, size_t buf_len);

    /// Remove the oldest line. Call only after it has been accepted upstream.
    esp_err_t drop_first();

    /// Lines waiting to be sent.
    size_t pending();

    /// The next sequence number, monotonic across reboots when NVS is
    /// healthy (logged loudly and kept RAM-only when it is not - see
    /// outbox.cpp for why this module never erases NVS to recover).
    uint32_t next_sequence();
}
