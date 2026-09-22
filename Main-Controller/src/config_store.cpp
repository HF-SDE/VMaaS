#include "config_store.h"

#include "device_config_parser.h"
#include "esp_log.h"
#include "storage.h"

namespace
{
    constexpr const char* TAG = "ConfigStore";

    void log_settings(const vmaas::DeviceConfig& c)
    {
        ESP_LOGI(TAG, "name '%s' machine_id '%s'", c.name, c.machine_id);
        ESP_LOGI(TAG, "api '%s'", c.api_base_url);
        ESP_LOGI(TAG, "timings debounce %u entry %u hold %u ms", static_cast<unsigned>(c.keypad_debounce_ms), static_cast<unsigned>(c.slot_entry_timeout_ms), static_cast<unsigned>(c.slot_entry_result_hold_ms));
    }

    vmaas::DeviceConfig defaults_with_warning(const char* why)
    {
        ESP_LOGW(TAG, "%s, using built-in defaults", why);
        const vmaas::DeviceConfig c = vmaas::device_config_defaults();
        log_settings(c);
        return c;
    }
}

namespace config_store
{
    vmaas::DeviceConfig load()
    {
        if (!vmaas::fs::mount(PARTITION_LABEL, MOUNT_POINT)) {
            return defaults_with_warning("storage not mounted");
        }

        static char text[MAX_CONFIG_BYTES];
        const int n = vmaas::fs::read_text_file(CONFIG_PATH, text, sizeof(text));
        if (n == -1) {
            return defaults_with_warning("config.json missing or unreadable");
        }
        if (n == -2) {
            return defaults_with_warning("config.json larger than the read buffer");
        }

        const vmaas::DeviceParseResult r = vmaas::parse_device_config(text);
        if (!r.json_valid) {
            ESP_LOGW(TAG, "%s is not valid JSON at byte %u", CONFIG_PATH, static_cast<unsigned>(r.json_error_offset));
        }
        for (size_t i = 0; i < r.issue_count; ++i)
        {
            ESP_LOGW(TAG, "config %s: %s", r.issues[i].field[0] != '\0' ? r.issues[i].field : "(file)", vmaas::to_string(r.issues[i].kind));
        }

        log_settings(r.config);
        return r.config;
    }
}
