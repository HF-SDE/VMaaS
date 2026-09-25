#include "config_store.h"

#include <cstdio>
#include <cstring>
#include "driver/gpio.h"
#include "esp_log.h"
#include "pins.h"
#include "slot_config_parser.h"
#include "storage.h"

namespace
{
    constexpr const char* TAG = "ConfigStore";
    constexpr size_t MAX_PINS_LOG = 24; // "18,19,21,22,23,25" fits

    config_store::LoadResult failed(const char* reason)
    {
        config_store::LoadResult r{};
        r.ok = false;
        std::snprintf(r.reason, sizeof(r.reason), "%s", reason);
        return r;
    }

    // GPIOs a slot must never drive: the shared STEP line, the link to
    // Main-Controller, the console UART0 (1, 3) and the SPI flash (6-11).
    bool is_reserved(int pin)
    {
        if (pin == Pins::STEP || pin == Pins::UART_TX || pin == Pins::UART_RX) return true;
        if (pin == 1 || pin == 3) return true;
        return pin >= 6 && pin <= 11;
    }
}

namespace config_store
{
    LoadResult load_config()
    {
        // Boot-time only, called once from app_main; .bss rather than the task stack.
        static char text[MAX_CONFIG_BYTES];
        const int n = vmaas::fs::read_text_file(CONFIG_PATH, text, sizeof(text));
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

        const vmaas::SlotParseResult r = vmaas::parse_slot_config(text);
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
                ESP_LOGW(TAG, "%s: schema version newer than %d, parsing anyway", CONFIG_PATH, vmaas::SLOT_SCHEMA_VERSION);
                continue;
            }
            ESP_LOGW(TAG, "%s: %s %s", CONFIG_PATH, issue.field, vmaas::to_string(issue.kind));
            if (out.reason[0] == '\0') {
                std::snprintf(out.reason, sizeof(out.reason), "%s %s", issue.field, vmaas::to_string(issue.kind));
            }
        }

        if (!out.ok)
        {
            ESP_LOGW(TAG, "%s: %d bytes, %u issue(s), no valid slot table", CONFIG_PATH, n, (unsigned)r.issue_count);
            return out;
        }

        ESP_LOGI(TAG, "%s: %d bytes, %u slot(s), %u steps per vend", CONFIG_PATH, n, (unsigned)out.config.slot_count, (unsigned)out.config.steps_per_vend);
        return out;
    }

    bool uses_reserved_pin(const vmaas::SlotConfig& cfg, char* reason, size_t cap)
    {
        for (size_t i = 0; i < cfg.slot_count; ++i)
        {
            for (size_t k = 0; k < cfg.slots[i].pin_count; ++k)
            {
                const int pin = cfg.slots[i].pins[k];
                if (is_reserved(pin))
                {
                    std::snprintf(reason, cap, "slots[%u].pins[%u] reserved", (unsigned)i, (unsigned)k);
                    ESP_LOGW(TAG, "%s: slot %u uses GPIO %d, which is %s on this board",
                             CONFIG_PATH, cfg.slots[i].slot, pin,
                             pin == Pins::STEP ? "the shared STEP line" :
                             (pin == Pins::UART_TX || pin == Pins::UART_RX) ? "a UART pin" :
                             (pin == 1 || pin == 3) ? "the console" : "a flash line");
                    return true;
                }
            }
        }
        return false;
    }

    void raise_enable_pin(gpio_num_t pin)
    {
        gpio_reset_pin(pin);
        gpio_set_level(pin, 1);
        gpio_set_direction(pin, GPIO_MODE_OUTPUT);
        gpio_set_level(pin, 1);
    }

    void disable_all_motors(const vmaas::SlotConfig& cfg)
    {
        for (size_t i = 0; i < cfg.slot_count; ++i)
        {
            for (size_t k = 0; k < cfg.slots[i].pin_count; ++k)
            {
                const int pin = cfg.slots[i].pins[k];
                if (is_reserved(pin)) continue;
                raise_enable_pin(static_cast<gpio_num_t>(pin));
            }
        }
    }

    void log_table(const vmaas::SlotConfig& cfg)
    {
        for (size_t i = 0; i < cfg.slot_count; ++i)
        {
            const vmaas::SlotEntry& e = cfg.slots[i];
            char pins[MAX_PINS_LOG];
            size_t used = 0;
            for (size_t k = 0; k < e.pin_count && used < sizeof(pins); ++k) {
                used += std::snprintf(pins + used, sizeof(pins) - used, "%s%u", k ? "," : "", e.pins[k]);
            }
            ESP_LOGI(TAG, "  slot %u -> nENABLE GPIO %s", e.slot, pins);
        }
    }
}
