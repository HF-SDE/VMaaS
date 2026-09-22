/**
 * @file event_reporter.cpp
 * @brief Durable reporting of machine events to the platform.
 */
#include "event_reporter.h"

#include <cstdio>
#include <cstring>
#include <ctime>

#include "cJSON.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "activation.h"
#include "api_client.h"
#include "config.h"
#include "device_config.h"
#include "file_io.h"
#include "journal.h"
#include "record.h"
#include "timing.h"
#include "wifi_sta.h"

namespace
{
    constexpr const char* TAG = "EventReporter";

    constexpr const char* JOURNAL_PATH = "/storage/events.jsonl";
    constexpr const char* CURSOR_PATH = "/storage/events.cursor";
    constexpr const char* BATCH_PATH = "/device/events/batch";

    constexpr TickType_t WIFI_POLL = pdMS_TO_TICKS(1000);

    /// The field a record written before the clock synced gains. Spliced into
    /// the stored payload, not substituted for it - see splice_estimated().
    constexpr char CLOCK_ESTIMATED_FIELD[] = "\"clock\":\"estimated\"";
    constexpr size_t CLOCK_ESTIMATED_LEN = sizeof(CLOCK_ESTIMATED_FIELD) - 1; // excludes the NUL

    /// Longest a stored payload can grow once splice_estimated() adds the
    /// field above: the original content minus its closing '}' (MAX_PAYLOAD -
    /// 2 characters at most), plus a comma, plus the field, plus '}' and a
    /// NUL. Works out to exactly MAX_PAYLOAD + 1 (comma) + CLOCK_ESTIMATED_LEN.
    constexpr size_t SPLICED_PAYLOAD_CAP = vmaas::events::MAX_PAYLOAD + 1 + CLOCK_ESTIMATED_LEN;

    /// build_event_id() writes "<machine_id>-<seq>": machine_id content up to
    /// ID_MAX-1 characters, a dash, a uint32 at up to 10 digits, and the NUL.
    constexpr size_t EVENT_ID_CAP = (activation::ID_MAX - 1) + 1 + 10 + 1;

    /// format_iso8601() always writes exactly "YYYY-MM-DDTHH:MM:SS.mmmZ" (24
    /// characters) plus a NUL, and refuses a smaller buffer outright.
    constexpr size_t ISO8601_CAP = 25;

    /// One event's worst-case cost inside the request body: the JSON keys and
    /// punctuation build_body() writes around it (69 literal characters in
    /// its format string - {"type":"(9) + ","payload":(12) + ,"eventId":"(12)
    /// + ","sequenceNumber":(19) + ,"occurredAt":"(15) + "}(2) - plus a
    /// leading comma when not the first entry), the type and payload at their
    /// stored maxima, an eventId, the sequenceNumber's digits, and an
    /// occurredAt timestamp.
    constexpr size_t EVENT_JSON_OVERHEAD = 70;
    constexpr size_t MAX_EVENT_JSON = EVENT_JSON_OVERHEAD + (vmaas::events::MAX_TYPE - 1) + SPLICED_PAYLOAD_CAP + (EVENT_ID_CAP - 1) + 10 // sequenceNumber digits, uint32 max + (ISO8601_CAP - 1);

    /// The batch body: "{"events":[" (11) + up to reporter_batch_size entries + "]}" (2).
    ///
    /// The brief's own sample sized this as a literal 4608, which a batch of
    /// reporter_batch_size (20) full-size records does not fit: 20 *
    /// MAX_EVENT_JSON alone is well over 8 KB. Deriving it from the same named
    /// constants everything else here uses is what "never a literal" (task
    /// brief, point 6) is for - it also means the size tracks correctly if
    /// MAX_PAYLOAD, MAX_TYPE, ID_MAX or reporter_batch_size ever change.
    constexpr size_t BODY_CAP = 13 + static_cast<size_t>(Config::reporter_batch_size) * MAX_EVENT_JSON;

    /// Bounds the platform's JSON response, not a stored record, so it is not
    /// derived from the constants above.
    ///
    /// Sized from the largest answer that still has to be UNDERSTOOD rather
    /// than merely survived: a validateDetailed 400. Measured against the
    /// middleware's own shape ({"error":...,"issues":[{"path":["body",
    /// "events",N,"<field>"],"message":"..."},...]}), one issue costs roughly
    /// 75 bytes, so 6 bad records come to about 488 bytes and a full batch of
    /// 20 to about 1.6 KB. At the old 512 the body truncated mid-JSON from
    /// the seventh issue on, cJSON_Parse() failed, mark_refused() returned 0,
    /// and the whole window fell into the halving cascade - the exact
    /// fallback validateDetailed, the schema split and the path walker exist
    /// to avoid - while the unread tail also forced a reconnect every time
    /// (see post_json()'s no-drain policy). 2048 covers the worst case the
    /// endpoint can produce for reporter_batch_size records with headroom.
    constexpr size_t RESPONSE_CAP = 2048;

    vmaas::fs::LittleFsPort port;
    vmaas::events::Journal journal(port, JOURNAL_PATH, CURSOR_PATH, Config::reporter_journal_cap);

    bool journal_ready = false;
    TaskHandle_t sender = nullptr;

    /**
     * @brief Serialises every Journal call, because two tasks make them.
     *
     * record() runs on the main loop task; take(), ack_through() and
     * compact_if_needed() run on the sender task. Two of those interleavings
     * destroy data outright:
     *
     *  - compact_if_needed() -> rewrite_keeping_after() streams the survivors
     *    into a temp file and then renames it over the live journal. A record
     *    appended between the streaming pass and the rename is inside the file
     *    the rename discards, while next_ has already advanced and the cursor
     *    has already been saved. The event is gone with no error, no dropped()
     *    increment and nothing left on disk to notice at the next boot.
     *  - save_cursor() -> write_atomic() writes one fixed temp path and
     *    renames it. append() calls it on the main task while ack_through()
     *    and compact_if_needed() call it on the sender task, so two
     *    fopen(tmp, "w") calls truncate each other, one rename then fails with
     *    its source gone, and the cursor can be left unparseable.
     *
     * esp_littlefs's own lock does not help: it serialises a single VFS call,
     * not a multi-call sequence like stream-then-rename.
     *
     * The mutex lives HERE and not in Journal on purpose. Journal is built to
     * be hardware-free and host-testable under FakeFs; giving it a FreeRTOS
     * handle would make it untestable on the host and would put a lock inside
     * a class that has no idea which of its calls belong to one atomic
     * operation. Recursive, so a future helper that already holds it can call
     * another one without deadlocking itself.
     */
    SemaphoreHandle_t journal_lock = nullptr;

    /// RAII holder for journal_lock. Waits indefinitely: every critical
    /// section below is a bounded amount of filesystem work with no network
    /// call inside it, so the wait always ends.
    class JournalGuard
    {
    public:
        JournalGuard() { if (journal_lock != nullptr) xSemaphoreTakeRecursive(journal_lock, portMAX_DELAY); }
        ~JournalGuard() { if (journal_lock != nullptr) xSemaphoreGiveRecursive(journal_lock); }
        JournalGuard(const JournalGuard&) = delete;
        JournalGuard& operator=(const JournalGuard&) = delete;
    };

    char machine_id[activation::ID_MAX] = {};
    char api_base[vmaas::MAX_API_BASE_URL] = {};

    /// Shared scratch for whichever batch body is being built next. drain_once()
    /// and send_without_refused() run strictly one after another on the sender
    /// task - never concurrently - and neither reads a body after its own
    /// post_json() call returns, so one BODY_CAP buffer serves both instead of
    /// each keeping its own ~8 KB copy.
    char body[BODY_CAP];

    /// Shared scratch for whichever batch is currently being taken from the
    /// journal, rendered and sent. Same justification as `body`: one sender
    /// task, nothing else touches this array, and nothing reads a record
    /// after journal.ack_through() has moved past it. This also takes
    /// sizeof(Record) * reporter_batch_size - 240 * 20 = 4800 bytes - off
    /// drain_once()'s stack frame, which mattered a great deal more than the
    /// body buffer did: see drain_once()'s own comment.
    vmaas::events::Record recs[Config::reporter_batch_size];

    uint32_t locked_take(uint32_t max)
    {
        JournalGuard guard;
        return journal.take(recs, max);
    }

    bool locked_ack_through(uint32_t seq)
    {
        JournalGuard guard;
        return journal.ack_through(seq);
    }

    /// Peeks one record to decide Progress vs Empty. Reuses `recs`, which is
    /// safe for the same reason drain_once() reuses it: nothing reads a record
    /// after ack_through() has moved past it.
    bool locked_has_more()
    {
        JournalGuard guard;
        return journal.take(recs, 1) != 0;
    }

    void locked_compact()
    {
        JournalGuard guard;
        journal.compact_if_needed();
    }

    uint32_t locked_dropped()
    {
        JournalGuard guard;
        return journal.dropped();
    }

    /// What one drain_once() call accomplished.
    enum class DrainResult
    {
        Empty,    ///< The backlog is empty; wait for record() to notify or for the heartbeat.
        Progress, ///< Sent a batch and more is queued; go again immediately, no backoff.
        Failed,   ///< Nothing was acknowledged this pass; back off and retry.
    };

    uint32_t uptime_ms()
    {
        return static_cast<uint32_t>(esp_timer_get_time() / 1000);
    }

    /// Unix milliseconds, or 0 while the clock has not been set.
    uint64_t wall_ms()
    {
        const std::time_t now = std::time(nullptr);
        if (now < 1600000000) return 0; // before 2020: SNTP has not answered
        return static_cast<uint64_t>(now) * 1000ULL;
    }

    /**
     * @brief Adds `"clock":"estimated"` to a stored JSON object payload.
     *
     * record() writes the caller's payload once, before it is known whether
     * the clock will still be unsynchronised when the record is finally sent.
     * This runs only for a record whose wall_ms is 0, and it has to ADD the
     * marker to what record() wrote - "{"source":"keypad"}" must become
     * "{"source":"keypad","clock":"estimated"}", not be replaced by
     * "{"clock":"estimated"}" outright. Replacing it would erase every field
     * an offline event was written to preserve in the first place - exactly
     * the events this design exists to keep. Spec 5.3: the payload gains the
     * field, it does not lose the rest.
     *
     * @param payload Object payload exactly as stored, e.g. "{}" or "{\"source\":\"keypad\"}".
     * @return false when payload is not a JSON object, or the splice does not fit @p cap.
     */
    bool splice_estimated(const char* payload, char* out, size_t cap)
    {
        const size_t len = std::strlen(payload);
        if (len < 2 || payload[0] != '{' || payload[len - 1] != '}') return false;

        const bool empty = (len == 2);
        const int n = std::snprintf(out, cap, "%.*s%s%s}", static_cast<int>(len - 1), payload, empty ? "" : ",", CLOCK_ESTIMATED_FIELD);
        return n > 0 && static_cast<size_t>(n) < cap;
    }

    /**
     * @brief Renders `count` records as the batch body the endpoint expects.
     * @param skip Entries the platform has already refused; nullptr sends all.
     */
    bool build_body(const vmaas::events::Record* recs, uint32_t count, const bool* skip,
                    char* out, size_t cap, uint64_t now_wall, uint32_t now_uptime)
    {
        size_t used = 0;
        const int head = std::snprintf(out, cap, "{\"events\":[");
        if (head < 0) return false;
        used = static_cast<size_t>(head);

        bool first = true;
        for (uint32_t i = 0; i < count; ++i)
        {
            if (skip != nullptr && skip[i]) continue;

            char event_id[EVENT_ID_CAP];
            if (!vmaas::events::build_event_id(machine_id, recs[i].seq, event_id, sizeof(event_id))) return false;

            char when[ISO8601_CAP];
            if (!vmaas::events::format_iso8601(vmaas::events::occurred_at_ms(recs[i], now_wall, now_uptime), when, sizeof(when))) {
                return false;
            }

            // A record written before the clock was known says so, rather than
            // presenting a reconstructed timestamp as a reading.
            const bool estimated = (recs[i].wall_ms == 0);

            char payload_buf[SPLICED_PAYLOAD_CAP];
            const char* payload_out = recs[i].payload;
            if (estimated)
            {
                if (!splice_estimated(recs[i].payload, payload_buf, sizeof(payload_buf))) return false;
                payload_out = payload_buf;
            }

            const int n = std::snprintf(out + used, cap - used,
                                        "%s{\"type\":\"%s\",\"payload\":%s,\"eventId\":\"%s\","
                                        "\"sequenceNumber\":%lu,\"occurredAt\":\"%s\"}",
                                        first ? "" : ",", recs[i].type, payload_out,
                                        event_id, static_cast<unsigned long>(recs[i].seq), when);
            if (n < 0 || used + static_cast<size_t>(n) >= cap) return false;
            used += static_cast<size_t>(n);
            first = false;
        }

        const int tail = std::snprintf(out + used, cap - used, "]}");
        return tail > 0 && used + static_cast<size_t>(tail) < cap;
    }

    /**
     * @brief Marks the batch indexes a 400 response blamed.
     *
     * validateDetailed answers with Zod's own paths, ["body","events",N,...],
     * so the index is the number after "events".
     *
     * @return How many distinct indexes were named. 0 means the response did
     *         not identify anything, which the caller has to treat as "the
     *         whole window is suspect".
     */
    uint32_t mark_refused(const char* response, bool* refused, uint32_t count)
    {
        cJSON* root = cJSON_Parse(response);
        if (root == nullptr) return 0;

        uint32_t found = 0;
        const cJSON* issues = cJSON_GetObjectItemCaseSensitive(root, "issues");
        const cJSON* issue = nullptr;
        cJSON_ArrayForEach(issue, issues)
        {
            const cJSON* path = cJSON_GetObjectItemCaseSensitive(issue, "path");
            bool after_events = false;
            const cJSON* segment = nullptr;
            cJSON_ArrayForEach(segment, path)
            {
                if (after_events && cJSON_IsNumber(segment))
                {
                    const int index = segment->valueint;
                    if (index >= 0 && static_cast<uint32_t>(index) < count && !refused[index])
                    {
                        refused[index] = true;
                        ++found;
                    }
                    break;
                }
                after_events = cJSON_IsString(segment) && std::strcmp(segment->valuestring, "events") == 0;
            }
        }

        cJSON_Delete(root);
        return found;
    }

    /**
     * @brief Handles a 400 that named at least one bad index: drops those and
     *        sends the rest, once.
     *
     * The batch is stored all-or-nothing, so one bad record fails the request
     * for the other nineteen. Those nineteen are good events and must not be
     * lost, so the refused ones are dropped - they would be refused forever -
     * and the rest go again immediately.
     *
     * Only called when `named > 0`. A response that names nothing is not this
     * function's problem: see drain_once()'s handling of that case, which
     * halves the batch instead of dropping it outright - the same remedy a
     * 413 gets, for the same reason.
     *
     * @return true when the outcome is settled: everything refused was
     *         dropped, and anything left over is confirmed sent. false to
     *         leave the window untouched and retry it later, unchanged.
     */
    bool send_without_refused(vmaas::events::Record* recs, uint32_t count, const bool* refused,
                              uint32_t named, const char* response)
    {
        const uint32_t last = recs[count - 1].seq;

        for (uint32_t i = 0; i < count; ++i)
        {
            if (refused[i]) {
                ESP_LOGE(TAG, "dropping event %lu, the platform refused it: %s", static_cast<unsigned long>(recs[i].seq), response);
            }
        }

        if (named == count)
        {
            locked_ack_through(last);
            return true;
        }

        if (!build_body(recs, count, refused, body, sizeof(body), wall_ms(), uptime_ms())) return false;

        int status = 0;
        static char retry_response[RESPONSE_CAP];
        if (api_client::post_json(BATCH_PATH, body, status, retry_response, sizeof(retry_response)) != ESP_OK) {
            return false;
        }

        if (status >= 200 && status < 300)
        {
            locked_ack_through(last);
            ESP_LOGI(TAG, "sent events %lu..%lu without %lu refused (%s)", static_cast<unsigned long>(recs[0].seq), static_cast<unsigned long>(last), static_cast<unsigned long>(named), retry_response);
            return true;
        }

        ESP_LOGW(TAG, "retry without the refused records answered %d, will try again later", status);
        return false;
    }

    /**
     * @brief Drains as much of the backlog as one call safely can.
     *
     * A loop, not recursion. A 413, a 400 that names no usable index, and a
     * build_body() failure on the primary batch all get the same remedy:
     * halve `max_batch` and take the (still-unacknowledged) backlog again,
     * down to the single record that is then dropped. Recursing here used to
     * put a full `Record recs[reporter_batch_size]` - 240 bytes *
     * reporter_batch_size = 4800 bytes - on THIS task's stack at every level
     * of the halving cascade, while api_client::post_json()'s TLS handshake
     * is also live on the same task and mbedTLS wants several KB of its own.
     * A 20->10->5->2->1 cascade would have asked for on the order of 24 KB it
     * did not have. `recs` is module-scope now for exactly this reason, and
     * this loop means no level of halving costs a fresh stack frame at all.
     *
     * @param max_batch Events to take from the journal on the first attempt
     *                  of this call. Halved in place on each retry; never
     *                  grows back for the rest of this call.
     */
    DrainResult drain_once(uint32_t max_batch)
    {
        while (true)
        {
            const uint32_t count = locked_take(max_batch);
            if (count == 0) return DrainResult::Empty;

            if (!build_body(recs, count, nullptr, body, sizeof(body), wall_ms(), uptime_ms()))
            {
                if (count > 1)
                {
                    ESP_LOGW(TAG, "cannot render events %lu..%lu as one batch, halving", static_cast<unsigned long>(recs[0].seq), static_cast<unsigned long>(recs[count - 1].seq));
                    max_batch = count / 2;
                    continue;
                }
                ESP_LOGE(TAG, "cannot render event %lu, dropping it", static_cast<unsigned long>(recs[0].seq));
                locked_ack_through(recs[0].seq);
                return DrainResult::Failed;
            }

            int status = 0;
            static char response[RESPONSE_CAP];
            const esp_err_t err = api_client::post_json(BATCH_PATH, body, status, response, sizeof(response));
            if (err != ESP_OK)
            {
                ESP_LOGW(TAG, "batch POST failed: %s", esp_err_to_name(err));
                return DrainResult::Failed;
            }

            if (status >= 200 && status < 300)
            {
                locked_ack_through(recs[count - 1].seq);
                ESP_LOGI(TAG, "sent events %lu..%lu (%s)", static_cast<unsigned long>(recs[0].seq), static_cast<unsigned long>(recs[count - 1].seq), response);
                return locked_has_more() ? DrainResult::Progress : DrainResult::Empty;
            }

            if (status == 400)
            {
                bool refused[Config::reporter_batch_size] = {};
                const uint32_t named = mark_refused(response, refused, count);

                if (named == 0)
                {
                    if (count > 1)
                    {
                        ESP_LOGW(TAG, "batch of %lu refused with no usable detail, halving", static_cast<unsigned long>(count));
                        max_batch = count / 2;
                        continue;
                    }
                    ESP_LOGE(TAG, "event %lu refused with no usable detail, dropping it: %s", static_cast<unsigned long>(recs[0].seq), response);
                    locked_ack_through(recs[0].seq);
                    return DrainResult::Failed;
                }

                if (!send_without_refused(recs, count, refused, named, response)) return DrainResult::Failed;
                return locked_has_more() ? DrainResult::Progress : DrainResult::Empty;
            }

            if (status == 413)
            {
                if (count > 1)
                {
                    ESP_LOGW(TAG, "batch of %lu too large, halving", static_cast<unsigned long>(count));
                    max_batch = count / 2;
                    continue;
                }
                ESP_LOGE(TAG, "event %lu is too large to send, dropping it", static_cast<unsigned long>(recs[0].seq));
                locked_ack_through(recs[0].seq);
                return DrainResult::Failed;
            }

            ESP_LOGW(TAG, "batch refused with %d, will retry", status);
            return DrainResult::Failed;
        }
    }

    void sender_task(void*)
    {
        for (int waited = 0; !wifi_sta::is_connected(); ++waited)
        {
            if (waited % 30 == 0) ESP_LOGI(TAG, "waiting for Wi-Fi before reporting events");
            vTaskDelay(WIFI_POLL);
        }

        for (int waited = 0; wall_ms() == 0; ++waited)
        {
            if (waited % 30 == 0) ESP_LOGW(TAG, "no clock yet, cannot stamp events; waiting for SNTP");
            vTaskDelay(WIFI_POLL);
        }
        ESP_LOGI(TAG, "clock is set, event reporting can start");

        while (api_client::begin(api_base) != ESP_OK)
        {
            ESP_LOGE(TAG, "api client unavailable; events stay queued, retrying in %u ms", static_cast<unsigned>(Config::reporter_api_retry_ms));
            vTaskDelay(pdMS_TO_TICKS(Config::reporter_api_retry_ms));
        }

        uint32_t backoff = Config::reporter_backoff_min_ms;

        while (true)
        {
            switch (drain_once(Config::reporter_batch_size))
            {
            case DrainResult::Progress:
                backoff = Config::reporter_backoff_min_ms;
                continue;

            case DrainResult::Empty:
            {
                backoff = Config::reporter_backoff_min_ms;
                locked_compact();
                const uint32_t dropped = locked_dropped();
                if (dropped > 0) {
                    ESP_LOGW(TAG, "events dropped for space so far: %lu", static_cast<unsigned long>(dropped));
                }

                ESP_LOGI(TAG, "sender task stack high-water mark: %u bytes still free of %d",
                         static_cast<unsigned>(uxTaskGetStackHighWaterMark(nullptr)) * sizeof(StackType_t),
                         Config::reporter_task_stack);

                api_client::end();

                ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(Config::reporter_backoff_max_ms));
                continue;
            }

            case DrainResult::Failed:
                ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(backoff));
                backoff = (backoff * 2 > Config::reporter_backoff_max_ms) ? Config::reporter_backoff_max_ms : backoff * 2;
                continue;
            }
        }
    }
}

namespace event_reporter
{
    esp_err_t begin()
    {
        if (journal_lock == nullptr)
        {
            journal_lock = xSemaphoreCreateRecursiveMutex();
            if (journal_lock == nullptr)
            {
                ESP_LOGE(TAG, "could not create the journal lock; events will not be recorded");
                journal_ready = false;
                return ESP_ERR_NO_MEM;
            }
        }

        journal_ready = journal.begin();
        if (!journal_ready)
        {
            ESP_LOGE(TAG, "event journal unavailable; events will not be recorded");
            return ESP_FAIL;
        }
        ESP_LOGI(TAG, "event journal ready, next sequence %lu, acknowledged %lu", static_cast<unsigned long>(journal.next_seq()), static_cast<unsigned long>(journal.acked()));
        return ESP_OK;
    }

    bool record(const char* type, const char* payload_json)
    {
        if (!journal_ready) return false;

        if (payload_json != nullptr)
        {
            const char* first = payload_json;
            while (*first == ' ' || *first == '\t' || *first == '\r' || *first == '\n') ++first;

            const char* last = first + std::strlen(first);
            while (last > first && (last[-1] == ' ' || last[-1] == '\t' || last[-1] == '\r' || last[-1] == '\n')) --last;

            if (last - first < 2 || *first != '{' || last[-1] != '}')
            {
                ESP_LOGE(TAG, "refusing a '%s' event: the payload is not a JSON object", type);
                return false;
            }
        }

        uint32_t seq = 0;
        {
            JournalGuard guard;
            seq = journal.append(type, payload_json, uptime_ms(), wall_ms());
        }

        if (seq == 0)
        {
            ESP_LOGE(TAG, "could not record a '%s' event: it was refused, or its cursor could not be written", type);
            return false;
        }

        ESP_LOGI(TAG, "recorded '%s' as sequence %lu", type, static_cast<unsigned long>(seq));
        if (sender != nullptr) xTaskNotifyGive(sender);
        return true;
    }

    esp_err_t start(const char* api_base_url)
    {
        if (sender != nullptr) return ESP_OK;
        if (!journal_ready) return ESP_ERR_INVALID_STATE;

        if (!activation::has_certificate())
        {
            ESP_LOGW(TAG, "not activated, no event sender; events stay queued");
            return ESP_ERR_INVALID_STATE;
        }

        activation::Identity id{};
        if (activation::load_identity(id) != ESP_OK) return ESP_ERR_INVALID_STATE;
        std::snprintf(machine_id, sizeof(machine_id), "%s", id.machine_id);
        std::snprintf(api_base, sizeof(api_base), "%s", api_base_url);

        const BaseType_t ok = xTaskCreate(sender_task, "events", Config::reporter_task_stack, nullptr, Config::reporter_task_priority, &sender);
        if (ok != pdPASS)
        {
            sender = nullptr;
            ESP_LOGE(TAG, "could not start the event sender task");
            return ESP_ERR_NO_MEM;
        }
        return ESP_OK;
    }
}
