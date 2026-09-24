/**
 * @file wiring_commit.cpp
 * @brief wiring_commit::commit_wiring(). See wiring_commit.h.
 */
#include "wiring_commit.h"
#include <cstdio>
#include "config_store.h"
#include "esp_log.h"
#include "slot_config_parser.h"
#include "slot_config_writer.h"
#include "storage.h"

namespace
{
    constexpr const char* TAG = "WiringCommit";
}

namespace wiring_commit
{
    bool commit_wiring(const vmaas::SlotConfig& staged, vmaas::SlotConfig& applied, char* reason, size_t cap)
    {
        static char text[config_store::MAX_CONFIG_BYTES];
        const int n = vmaas::write_slot_config_json(staged, text, sizeof(text));
        if (n < 0)
        {
            std::snprintf(reason, cap, "table too large");
            return false;
        }

        const vmaas::SlotParseResult r = vmaas::parse_slot_config(text);
        if (!r.ok)
        {
            const char* what = r.issue_count > 0 ? vmaas::to_string(r.issues[0].kind) : "invalid";
            const char* field = r.issue_count > 0 ? r.issues[0].field : "";
            std::snprintf(reason, cap, "%s %s", field, what);
            ESP_LOGW(TAG, "staged table rejected: %s", reason);
            return false;
        }
        if (config_store::uses_reserved_pin(r.config, reason, cap)) return false;

        if (!vmaas::fs::write_text_file(config_store::CONFIG_PATH, text, static_cast<size_t>(n)))
        {
            std::snprintf(reason, cap, "write failed");
            return false;
        }

        applied = r.config;
        ESP_LOGI(TAG, "%s rewritten: %d bytes, %u slot(s), %u steps per vend", config_store::CONFIG_PATH, n, (unsigned)applied.slot_count, (unsigned)applied.steps_per_vend);
        return true;
    }

    vmaas::ErrorCode nak_for(vmaas::WiringStager::Result r)
    {
        switch (r)
        {
        case vmaas::WiringStager::Result::Ok:            return vmaas::ErrorCode::BAD_PAYLOAD; // unreachable: callers check Ok first
        case vmaas::WiringStager::Result::NotBegun:      return vmaas::ErrorCode::WIRING_STATE;
        case vmaas::WiringStager::Result::Full:          return vmaas::ErrorCode::WIRING_FULL;
        case vmaas::WiringStager::Result::CountMismatch: return vmaas::ErrorCode::WRITE_FAILED;
        case vmaas::WiringStager::Result::BadSteps:      return vmaas::ErrorCode::BAD_PAYLOAD;
        }
        return vmaas::ErrorCode::WRITE_FAILED; // unreachable; keeps this well-defined without a default case
    }
}
