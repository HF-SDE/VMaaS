#include "config_store.h"

#include <cstdio>
#include "esp_littlefs.h"
#include "esp_log.h"

#include "config_parser.h"

namespace
{
    constexpr const char *TAG = "ConfigStore";
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
        return true;
    }

    int read_text_file(const char *path, char *buf, size_t capacity)
    {
        if (buf == nullptr || capacity == 0)
            return -2;

        FILE *f = std::fopen(path, "rb");
        if (f == nullptr)
            return -1;

        const size_t n = std::fread(buf, 1, capacity - 1, f);
        const bool more = (std::fgetc(f) != EOF);
        std::fclose(f);

        if (more)
        {
            buf[0] = '\0';
            return -2;
        }
        buf[n] = '\0';
        return static_cast<int>(n);
    }

    namespace
    {
        void log_effective(const vmaas::Config &c)
        {
            ESP_LOGI(TAG, "effective config: uart rx=%d tx=%d baud=%d | i2c sda=%d scl=%d clock=%lu Hz", c.pins.uart_rx, c.pins.uart_tx, c.uart.baud_rate, c.pins.i2c_sda, c.pins.i2c_scl, (unsigned long)c.i2c.clock_hz);
        }
    }

    vmaas::Config load_config(const vmaas::Config &defaults)
    {
        static char text[MAX_CONFIG_BYTES];
        const int n = read_text_file(CONFIG_PATH, text, sizeof(text));
        if (n == -1)
        {
            ESP_LOGW(TAG, "%s not found, using defaults", CONFIG_PATH);
            log_effective(defaults);
            return defaults;
        }
        if (n == -2)
        {
            ESP_LOGW(TAG, "%s larger than %u bytes, using defaults", CONFIG_PATH, (unsigned)(MAX_CONFIG_BYTES - 1));
            log_effective(defaults);
            return defaults;
        }

        const vmaas::ParseResult r = vmaas::parse_config(text, defaults);
        if (!r.json_valid)
            ESP_LOGW(TAG, "%s: invalid JSON near byte %u, using defaults", CONFIG_PATH, (unsigned)r.json_error_offset);
        for (size_t i = 0; i < r.issue_count; ++i)
        {
            // Nothing is rejected here: the file only announces a newer schema.
            if (r.issues[i].kind == vmaas::ConfigIssueKind::NewerVersion)
            {
                ESP_LOGW(TAG, "%s: schema version newer than %d, parsing anyway", CONFIG_PATH, vmaas::CONFIG_SCHEMA_VERSION);
                continue;
            }
            ESP_LOGW(TAG, "%s: %s rejected (%s), using default", CONFIG_PATH, r.issues[i].field, vmaas::to_string(r.issues[i].kind));
        }
        ESP_LOGI(TAG, "%s: %d bytes, %u issue(s)", CONFIG_PATH, n, (unsigned)r.issue_count);
        log_effective(r.config);
        return r.config;
    }
}
