#include "config_store.h"

#include <cstdio>
#include <cstring>
#include "esp_littlefs.h"
#include "esp_log.h"
#include "config_parser.h"

namespace
{
    constexpr const char* TAG = "ConfigStore";

    config_store::LoadResult failed(const char* reason)
    {
        config_store::LoadResult r{};
        r.ok = false;
        std::snprintf(r.reason, sizeof(r.reason), "%s", reason);
        return r;
    }
}

namespace config_store
{
    bool mount_storage()
    {
        esp_vfs_littlefs_conf_t conf = {};
        conf.base_path = MOUNT_POINT;
        conf.partition_label = PARTITION_LABEL;
        conf.format_if_mount_failed = false;
        conf.dont_mount = false;

        const esp_err_t err = esp_vfs_littlefs_register(&conf);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "mount %s failed: %s", MOUNT_POINT, esp_err_to_name(err));
            return false;
        }

        size_t total = 0, used = 0;
        if (esp_littlefs_info(PARTITION_LABEL, &total, &used) == ESP_OK)
            ESP_LOGI(TAG, "mounted %s: %u of %u bytes used", MOUNT_POINT, (unsigned)used, (unsigned)total);
        else
            ESP_LOGW(TAG, "mounted %s, but usage query failed", MOUNT_POINT);
        return true;
    }

    int read_text_file(const char* path, char* buf, size_t capacity)
    {
        if (buf == nullptr || capacity == 0)
            return -2;

        FILE* f = std::fopen(path, "rb");
        if (f == nullptr)
            return -1;

        const size_t n = std::fread(buf, 1, capacity - 1, f);
        const bool more = (std::fgetc(f) != EOF);
        const bool failed_read = std::ferror(f) != 0;
        std::fclose(f);

        if (more || failed_read)
        {
            buf[0] = '\0';
            return failed_read ? -1 : -2;
        }
        buf[n] = '\0';
        return static_cast<int>(n);
    }

    LoadResult load_config()
    {
        // Boot-time only, called once from app_main; .bss rather than the task stack.
        static char text[MAX_CONFIG_BYTES];
        const int n = read_text_file(CONFIG_PATH, text, sizeof(text));
        if (n == -1)
        {
            ESP_LOGW(TAG, "%s missing or unreadable", CONFIG_PATH);
            return failed("config.json missing");
        }
        if (n == -2)
        {
            ESP_LOGW(TAG, "%s larger than %u bytes", CONFIG_PATH, (unsigned)(MAX_CONFIG_BYTES - 1));
            return failed("config.json too large");
        }

        const vmaas::ParseResult r = vmaas::parse_config(text);
        if (!r.json_valid)
        {
            ESP_LOGW(TAG, "%s: invalid JSON near byte %u", CONFIG_PATH, (unsigned)r.json_error_offset);
            return failed("config.json invalid JSON");
        }

        LoadResult out{};
        out.ok = r.ok;
        out.config = r.config;
        for (size_t i = 0; i < r.issue_count; ++i)
        {
            const vmaas::ConfigIssue& issue = r.issues[i];
            if (issue.kind == vmaas::ConfigIssueKind::NewerVersion)
            {
                ESP_LOGW(TAG, "%s: schema version newer than %d, parsing anyway", CONFIG_PATH, vmaas::CONFIG_SCHEMA_VERSION);
                continue;
            }
            ESP_LOGW(TAG, "%s: %s %s", CONFIG_PATH, issue.field, vmaas::to_string(issue.kind));
            if (out.reason[0] == '\0')
                std::snprintf(out.reason, sizeof(out.reason), "%s %s", issue.field, vmaas::to_string(issue.kind));
        }

        if (!out.ok)
        {
            ESP_LOGW(TAG, "%s: %d bytes, %u issue(s), no valid slot table", CONFIG_PATH, n, (unsigned)r.issue_count);
            return out;
        }

        ESP_LOGI(TAG, "%s: %d bytes, %u slot(s)", CONFIG_PATH, n, (unsigned)out.config.slot_count);
        for (size_t i = 0; i < out.config.slot_count; ++i)
            ESP_LOGI(TAG, "  slot %u -> GPIO %d", out.config.slots[i].slot, out.config.slots[i].pin);
        return out;
    }
}
