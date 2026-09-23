#include "device_config_parser.h"

#include <cstdio>
#include <cstring>
#include "cJSON.h"
#include "json_depth.h"

namespace vmaas
{
    namespace
    {
        constexpr long long TIMING_MIN = 1;
        constexpr long long TIMING_MAX = 600000;

        void add_issue(DeviceParseResult& r, ConfigIssueKind kind, const char* field)
        {
            if (r.issue_count >= DeviceParseResult::MAX_ISSUES) return;
            
            ConfigIssue& issue = r.issues[r.issue_count++];
            issue.kind = kind;
            std::snprintf(issue.field, sizeof(issue.field), "%s", field);
        }

        // Copies parent[key] into dst when it is a string that fits. Leaves dst untouched
        // otherwise, so the default survives. Never truncates: a silently shortened
        // hostname or machine id is worse than none, because it looks plausible in a log.
        void read_string(DeviceParseResult& r, const cJSON* parent, const char* key, char* dst, size_t cap, const char* field)
        {
            const cJSON* item = cJSON_GetObjectItemCaseSensitive(parent, key);
            if (item == nullptr) return;

            if (!cJSON_IsString(item) || item->valuestring == nullptr)
            {
                add_issue(r, ConfigIssueKind::WrongType, field);
                return;
            }
            if (std::strlen(item->valuestring) >= cap)
            {
                add_issue(r, ConfigIssueKind::OutOfRange, field);
                return;
            }
            std::snprintf(dst, cap, "%s", item->valuestring);
        }

        // Reads parent[key] as a whole number.
        // when the key is absent or the value is unusable, then the default survives.
        void read_int(DeviceParseResult& r, const cJSON* parent, const char* key, long long lo, long long hi, const char* field, long long& out)
        {
            const cJSON* item = cJSON_GetObjectItemCaseSensitive(parent, key);
            if (item == nullptr)
                return;
            if (!cJSON_IsNumber(item))
            {
                add_issue(r, ConfigIssueKind::WrongType, field);
                return;
            }
            const double d = item->valuedouble;
            // Range test before any cast: converting a double outside long long's
            // range is undefined behaviour, not a wrap-around. Written negated so
            // NaN and infinity fail it too - every comparison against NaN is false.
            if (!(d >= static_cast<double>(lo) && d <= static_cast<double>(hi)))
            {
                add_issue(r, ConfigIssueKind::OutOfRange, field);
                return;
            }
            // Provably in range now, so the round trip is safe.
            if (d != static_cast<double>(static_cast<long long>(d)))
            {
                add_issue(r, ConfigIssueKind::WrongType, field);
                return;
            }
            out = static_cast<long long>(d);
        }

        // Returns the named section when it is an object. A section of the wrong type is
        // an issue; an absent one is not, because every field it holds has a default.
        const cJSON* section(DeviceParseResult& r, const cJSON* root, const char* key)
        {
            const cJSON* s = cJSON_GetObjectItemCaseSensitive(root, key);
            if (s == nullptr)
                return nullptr;
            if (!cJSON_IsObject(s))
            {
                add_issue(r, ConfigIssueKind::WrongType, key);
                return nullptr;
            }
            return s;
        }

        void read_timing(DeviceParseResult& r, const cJSON* timings, const char* key, const char* field, uint32_t& out)
        {
            long long v = out;
            read_int(r, timings, key, TIMING_MIN, TIMING_MAX, field, v);
            out = static_cast<uint32_t>(v);
        }
    }

    DeviceConfig device_config_defaults()
    {
        DeviceConfig c{};
        c.name[0] = '\0';
        c.machine_id[0] = '\0';
        c.api_base_url[0] = '\0';
        c.broker_host[0] = '\0';
        c.broker_port = 0;
        c.keypad_debounce_ms = 20;
        c.slot_entry_timeout_ms = 10000;
        c.slot_entry_result_hold_ms = 2000;
        c.door_code[0] = '\0';
        c.door_unlock_ms = 500;
        c.dispense_timeout_ms = 30000;
        return c;
    }

    DeviceParseResult parse_device_config(const char* json_text)
    {
        DeviceParseResult r{};
        r.config = device_config_defaults();
        r.json_valid = false;
        r.ok = false;

        if (json_text == nullptr)
        {
            add_issue(r, ConfigIssueKind::InvalidJson, "");
            return r;
        }

        size_t offset = 0;
        if (nesting_too_deep(json_text, offset))
        {
            r.json_error_offset = offset;
            add_issue(r, ConfigIssueKind::InvalidJson, "");
            return r;
        }

        cJSON* root = cJSON_Parse(json_text);
        if (root == nullptr || !cJSON_IsObject(root))
        {
            const char* end = cJSON_GetErrorPtr();
            r.json_error_offset = (end != nullptr && end >= json_text) ? static_cast<size_t>(end - json_text) : 0;
            add_issue(r, ConfigIssueKind::InvalidJson, "");
            cJSON_Delete(root);
            return r;
        }
        r.json_valid = true;

        long long version = DEVICE_SCHEMA_VERSION;
        read_int(r, root, "version", 0, 1000000, "version", version);
        if (version > DEVICE_SCHEMA_VERSION) {
            add_issue(r, ConfigIssueKind::NewerVersion, "version");
        }

        if (const cJSON* device = section(r, root, "device"))
        {
            read_string(r, device, "name", r.config.name, MAX_DEVICE_NAME, "device.name");
            read_string(r, device, "machine_id", r.config.machine_id, MAX_MACHINE_ID, "device.machine_id");
        }

        if (const cJSON* backend = section(r, root, "backend"))
        {
            read_string(r, backend, "api_base_url", r.config.api_base_url, MAX_API_BASE_URL,
                        "backend.api_base_url");
        }

        if (const cJSON* broker = section(r, root, "broker"))
        {
            read_string(r, broker, "host", r.config.broker_host, MAX_BROKER_HOST, "broker.host");
            long long port = r.config.broker_port;
            read_int(r, broker, "port", 1, 65535, "broker.port", port);
            r.config.broker_port = static_cast<uint16_t>(port);
        }

        if (const cJSON* door = section(r, root, "door"))
        {
            read_string(r, door, "code", r.config.door_code, MAX_DOOR_CODE, "door.code");

            // ServiceCode only ever buffers '0'-'9' (see service_code.cpp), so a
            // non-digit code could never be typed: the door would be
            // permanently unopenable from the keypad while still latching the
            // recogniser on '*' for SERVICE_CODE_TIMEOUT_MS, swallowing a
            // paying customer's keypad input. Reject it here, the same way
            // read_string above rejects a code that does not fit, and fall
            // back to "" - which disables keypad release outright instead of
            // dangling in an unopenable state.
            bool door_code_is_all_digits = true;
            for (const char* p = r.config.door_code; *p != '\0'; ++p)
            {
                if (*p < '0' || *p > '9')
                {
                    door_code_is_all_digits = false;
                    break;
                }
            }
            if (!door_code_is_all_digits)
            {
                add_issue(r, ConfigIssueKind::OutOfRange, "door.code");
                r.config.door_code[0] = '\0';
            }
        }

        if (const cJSON* timings = section(r, root, "timings"))
        {
            read_timing(r, timings, "keypad_debounce_ms", "timings.keypad_debounce_ms", r.config.keypad_debounce_ms);
            read_timing(r, timings, "slot_entry_timeout_ms", "timings.slot_entry_timeout_ms", r.config.slot_entry_timeout_ms);
            read_timing(r, timings, "slot_entry_result_hold_ms", "timings.slot_entry_result_hold_ms", r.config.slot_entry_result_hold_ms);
            {
                long long v = r.config.door_unlock_ms;
                read_int(r, timings, "door_unlock_ms", 100, 2000, "timings.door_unlock_ms", v);
                r.config.door_unlock_ms = static_cast<uint32_t>(v);
            }
            {
                long long v = r.config.dispense_timeout_ms;
                read_int(r, timings, "dispense_timeout_ms", 0, TIMING_MAX, "timings.dispense_timeout_ms", v);
                r.config.dispense_timeout_ms = static_cast<uint32_t>(v);
            }
        }
        cJSON_Delete(root);

        r.ok = true;
        for (size_t i = 0; i < r.issue_count; ++i) {
            if (r.issues[i].kind != ConfigIssueKind::NewerVersion) {
                r.ok = false;
            }
        }
        return r;
    }
}
