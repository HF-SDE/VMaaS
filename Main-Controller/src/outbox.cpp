/**
 * @file outbox.cpp
 * @brief See outbox.h.
 *
 * drop_first() rewrites the file without its first line. That is O(n) per
 * send, which is fine: n is the backlog, the backlog is normally 0 or 1, and
 * the alternative — an offset file that must stay consistent with the data
 * file across power cuts — is two things to keep in step instead of one.
 *
 * This file does NOT use vmaas::fs::read_text_file (see storage.h), even
 * though config_store, activation and prices all do. That helper reads an
 * entire file into one caller-sized buffer and fails outright if the file
 * does not fit — correct for a config file with a known ceiling, wrong for a
 * queue that is meant to grow to MAX_BYTES and that must be read, appended
 * and trimmed one line at a time. So the I/O here is hand-rolled
 * fopen/fgets/fgetc/fputc on purpose. Do not "fix" this by swapping it for
 * read_text_file.
 */
#include "outbox.h"

#include <cstdio>
#include <cstring>

#include "esp_log.h"
#include "esp_random.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "nvs.h"
#include "nvs_flash.h"

namespace
{
    constexpr const char *TAG = "outbox";
    constexpr const char *PATH = "/storage/outbox.jsonl";
    constexpr const char *TMP_PATH = "/storage/outbox.tmp";
    constexpr const char *NVS_NS = "vmaas";
    constexpr const char *NVS_SEQ = "outbox_seq";
    constexpr const char *NVS_LEDGER = "outbox_ledger";
    constexpr size_t LEDGER_LEN = 8;

    uint32_t sequence = 0;
    char ledger_id[LEDGER_LEN + 1] = "";

    void generate_ledger()
    {
        static const char alphabet[] = "abcdefghijklmnopqrstuvwxyz0123456789";
        for (size_t i = 0; i < LEDGER_LEN; ++i) ledger_id[i] = alphabet[esp_random() % 36];
        ledger_id[LEDGER_LEN] = '\0';
    }

    /**
     * @brief Guards every access to PATH/TMP_PATH, created by begin().
     *
     * Task 9's purchase task calls append() from the main loop while Task
     * 10's drain task calls peek()/drop_first() from its own FreeRTOS task,
     * deliberately, so a slow HTTPS POST cannot stall a customer mid-payment.
     * Without this lock, drop_first()'s rewrite-in-place (read PATH, write
     * TMP_PATH, remove PATH, rename TMP_PATH) can interleave with a
     * concurrent append(): the drain task's std::remove(PATH) can delete a
     * file that append() just wrote a brand-new, already-accepted, coin-
     * backed sale into, and the following rename replaces it with a copy
     * that predates that sale. That sale — already reported durable to its
     * caller, already dispensed a product — would vanish with no trace. This
     * is normal concurrent operation, not a crash window, so the lock is not
     * optional.
     */
    SemaphoreHandle_t g_mutex = nullptr;

    /// Acquire g_mutex. Fails loudly instead of proceeding unlocked when
    /// begin() has not run yet (or its xSemaphoreCreateMutex() failed).
    bool lock()
    {
        if (g_mutex == nullptr)
        {
            ESP_LOGE(TAG, "called before begin() created the lock; refusing");
            return false;
        }
        return xSemaphoreTake(g_mutex, portMAX_DELAY) == pdTRUE;
    }

    void unlock()
    {
        xSemaphoreGive(g_mutex);
    }

    size_t file_size()
    {
        FILE *f = std::fopen(PATH, "rb");
        if (f == nullptr) return 0;
        std::fseek(f, 0, SEEK_END);
        const long n = std::ftell(f);
        std::fclose(f);
        return n > 0 ? static_cast<size_t>(n) : 0;
    }

    /**
     * @brief Rescue a rewrite (drop_first() or discard_partial_line()) that
     *        was interrupted between removing PATH and renaming TMP_PATH in.
     *
     * Both of those functions read PATH, write the corrected contents to
     * TMP_PATH, then std::remove(PATH) followed by std::rename(TMP_PATH,
     * PATH). A power cut in that gap leaves PATH missing and TMP_PATH
     * holding the real, undelivered backlog - potentially days of it, since
     * that is exactly the outage this module exists to survive. Nothing else
     * looks for TMP_PATH: the next append() would fopen(PATH, "ab"), create
     * a fresh empty file, and silently orphan every line still in TMP_PATH
     * forever. So this must run first, before begin() does anything else
     * that assumes PATH is the whole story.
     */
    void recover_orphaned_rewrite()
    {
        FILE *f = std::fopen(PATH, "rb");
        if (f != nullptr)
        {
            std::fclose(f);
            return;
        }

        FILE *tmp = std::fopen(TMP_PATH, "rb");
        if (tmp == nullptr) return;
        std::fclose(tmp);

        if (std::rename(TMP_PATH, PATH) == 0)
        {
            ESP_LOGW(TAG, "recovered an interrupted rewrite: %s -> %s", TMP_PATH, PATH);
        }
        else
        {
            ESP_LOGE(TAG, "found an orphaned %s but could not rename it into place", TMP_PATH);
        }
    }

    /**
     * @brief Drop a trailing line with no newline on it.
     *
     * A power cut mid-append leaves exactly that. Keeping it would feed the
     * backend a truncated event; discarding it loses one sale that was never
     * durable in the first place.
     */
    void discard_partial_line()
    {
        FILE *in = std::fopen(PATH, "rb");
        if (in == nullptr) return;

        std::fseek(in, 0, SEEK_END);
        const long size = std::ftell(in);
        if (size <= 0) { 
            std::fclose(in); 
            return; 
        }

        std::fseek(in, size - 1, SEEK_SET);
        const int last = std::fgetc(in);
        std::fclose(in);

        if (last == '\n') return;

        in = std::fopen(PATH, "rb");
        FILE *out = std::fopen(TMP_PATH, "wb");
        if (in == nullptr || out == nullptr)
        {
            if (in != nullptr) std::fclose(in);
            if (out != nullptr) std::fclose(out);
            return;
        }

        long keep = 0;
        long pos = 0;
        int c;
        while ((c = std::fgetc(in)) != EOF)
        {
            ++pos;
            if (c == '\n') keep = pos;
        }

        std::rewind(in);
        for (long i = 0; i < keep; ++i)
            std::fputc(std::fgetc(in), out);

        std::fclose(in);
        std::fflush(out);
        std::fclose(out);
        std::remove(PATH);
        std::rename(TMP_PATH, PATH);

        ESP_LOGW(TAG, "discarded a partial trailing line (%ld bytes lost)", size - keep);
    }

    esp_err_t append_impl(const char *line, size_t len)
    {
        if (file_size() + len + 1 > outbox::MAX_BYTES)
        {
            ESP_LOGE(TAG, "queue is full (%u bytes); refusing the line", static_cast<unsigned>(file_size()));
            return ESP_ERR_NO_MEM;
        }

        FILE *f = std::fopen(PATH, "ab");
        if (f == nullptr) return ESP_FAIL;

        const bool wrote = std::fwrite(line, 1, len, f) == len && std::fputc('\n', f) == '\n';

        // Durability before anything else happens. The caller must not send
        // RUN until this has returned ESP_OK.
        //
        // fflush() alone only leaves the vendored LittleFS VFS's own write
        // buffer; fclose() is what makes it durable here. Traced from
        // source: Main-Controller/managed_components/joltwallet__littlefs/
        // src/esp_littlefs.c:2171 has vfs_littlefs_close() call
        // lfs_file_close(), and src/littlefs/lfs.c:3247-3253 shows
        // lfs_file_close_() unconditionally calling lfs_file_sync_() before
        // it frees the file's buffers - so fclose() on this VFS always syncs
        // to physical flash, with no separate fsync() needed.
        std::fflush(f);
        std::fclose(f);

        if (!wrote)
        {
            ESP_LOGE(TAG, "short write; the line may be partial");
            return ESP_FAIL;
        }

        return ESP_OK;
    }

    bool peek_impl(char *buf, size_t buf_len)
    {
        buf[0] = '\0';

        FILE *f = std::fopen(PATH, "rb");
        if (f == nullptr) return false;

        const bool got = std::fgets(buf, static_cast<int>(buf_len), f) != nullptr;
        if (!got || buf[0] == '\0') { std::fclose(f); return false; }

        char *nl = std::strchr(buf, '\n');
        if (nl != nullptr)
        {
            *nl = '\0';
            std::fclose(f);
            return buf[0] != '\0';
        }

        ESP_LOGE(TAG, "oldest line does not fit in the %u-byte buffer given to peek(); refusing to return a truncated event", static_cast<unsigned>(buf_len));
        std::fclose(f);
        buf[0] = '\0';
        return false;
    }

    esp_err_t drop_first_impl()
    {
        FILE *in = std::fopen(PATH, "rb");
        if (in == nullptr) return ESP_OK;   // nothing to drop

        char line[outbox::MAX_LINE];
        if (std::fgets(line, sizeof(line), in) == nullptr)
        {
            std::fclose(in);
            std::remove(PATH);
            return ESP_OK;
        }

        FILE *out = std::fopen(TMP_PATH, "wb");
        if (out == nullptr) { std::fclose(in); return ESP_FAIL; }

        int c;
        while ((c = std::fgetc(in)) != EOF) {
            std::fputc(c, out);
        }

        std::fclose(in);
        std::fflush(out);
        std::fclose(out);
        std::remove(PATH);

        return std::rename(TMP_PATH, PATH) == 0 ? ESP_OK : ESP_FAIL;
    }

    size_t pending_impl()
    {
        FILE *f = std::fopen(PATH, "rb");
        if (f == nullptr) return 0;

        size_t lines = 0;
        int c;
        while ((c = std::fgetc(f)) != EOF) {
            if (c == '\n') ++lines;
        }

        std::fclose(f);
        return lines;
    }
}

namespace outbox
{
    esp_err_t begin()
    {
        if (g_mutex == nullptr) g_mutex = xSemaphoreCreateMutex();
        if (g_mutex == nullptr)
        {
            ESP_LOGE(TAG, "xSemaphoreCreateMutex failed; outbox is unusable");
            return ESP_ERR_NO_MEM;
        }

        esp_err_t nvs_err = nvs_flash_init();
        if (nvs_err != ESP_OK)
        {
            ESP_LOGW(TAG, "nvs_flash_init failed: %s; sequence will not persist across reboots, not erasing NVS to try to fix it (it also holds the device certificate)", esp_err_to_name(nvs_err));
        }

        if (!lock()) return ESP_FAIL;

        recover_orphaned_rewrite();
        discard_partial_line();

        if (nvs_err == ESP_OK)
        {
            nvs_handle_t h;
            const esp_err_t err = nvs_open(NVS_NS, NVS_READWRITE, &h);
            if (err == ESP_OK)
            {
                if (nvs_get_u32(h, NVS_SEQ, &sequence) != ESP_OK) sequence = 0;

                size_t len = sizeof(ledger_id);
                if (nvs_get_str(h, NVS_LEDGER, ledger_id, &len) != ESP_OK || std::strlen(ledger_id) != LEDGER_LEN)
                {
                    generate_ledger();
                    if (nvs_set_str(h, NVS_LEDGER, ledger_id) != ESP_OK || nvs_commit(h) != ESP_OK) {
                        ESP_LOGE(TAG, "could not persist sale ledger %s; the next boot starts another one", ledger_id);
                    }
                    else {
                        ESP_LOGW(TAG, "new sale ledger %s", ledger_id);
                    }
                }
                nvs_close(h);
            }
            else
            {
                ESP_LOGW(TAG, "nvs_open failed: %s, sequence restarts at 0", esp_err_to_name(err));
            }
        }

        if (ledger_id[0] == '\0') generate_ledger();

        ESP_LOGI(TAG, "ready: %u pending, %u bytes, ledger %s, next sequence %lu", static_cast<unsigned>(pending_impl()), static_cast<unsigned>(file_size()), ledger_id, static_cast<unsigned long>(sequence));

        unlock();
        return ESP_OK;
    }

    /// Assumes the caller already holds g_mutex, like the *_impl() helpers
    /// above. Split out so next_sequence() can lock around it exactly once.
    uint32_t next_sequence_impl()
    {
        ++sequence;

        nvs_handle_t h;
        const esp_err_t open_err = nvs_open(NVS_NS, NVS_READWRITE, &h);
        if (open_err == ESP_OK)
        {
            const esp_err_t set_err = nvs_set_u32(h, NVS_SEQ, sequence);
            const esp_err_t commit_err = (set_err == ESP_OK) ? nvs_commit(h) : set_err;
            nvs_close(h);

            if (set_err != ESP_OK || commit_err != ESP_OK)
            {
                ESP_LOGE(TAG, "failed to persist sequence %lu (set: %s, commit: %s); an unclean reboot before the next successful persist will reuse this eventId", static_cast<unsigned long>(sequence), esp_err_to_name(set_err), esp_err_to_name(commit_err));

            }
        }
        else
        {
            ESP_LOGE(TAG, "nvs_open failed: %s; sequence %lu is not persisted", esp_err_to_name(open_err), static_cast<unsigned long>(sequence));
        }

        return sequence;
    }

    uint32_t next_sequence()
    {
        if (!lock()) return 0;
        const uint32_t result = next_sequence_impl();
        unlock();
        return result;
    }

    const char *ledger() { return ledger_id; }

    esp_err_t append(const char *line)
    {
        if (line == nullptr) return ESP_ERR_INVALID_ARG;

        const size_t len = std::strlen(line);
        if (len == 0 || len + 2 > MAX_LINE) return ESP_ERR_INVALID_SIZE;

        if (!lock()) return ESP_ERR_INVALID_STATE;
        const esp_err_t result = append_impl(line, len);
        unlock();
        return result;
    }

    bool peek(char *buf, size_t buf_len)
    {
        if (buf == nullptr || buf_len == 0) return false;

        if (!lock()) { 
            buf[0] = '\0';
            return false; 
        }
        const bool result = peek_impl(buf, buf_len);
        unlock();
        return result;
    }

    esp_err_t drop_first()
    {
        if (!lock()) return ESP_ERR_INVALID_STATE;
        const esp_err_t result = drop_first_impl();
        unlock();
        return result;
    }

    size_t pending()
    {
        if (!lock()) return 0;
        const size_t result = pending_impl();
        unlock();
        return result;
    }
}
