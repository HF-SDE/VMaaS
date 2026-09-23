#include "slot_config_parser.h"

#include <cstdio>
#include <cstring>
#include "cJSON.h"
#include "json_depth.h"

namespace vmaas
{
    namespace
    {
        constexpr long long SLOT_MIN = 1;
        constexpr long long SLOT_MAX = 255;
        constexpr long long GPIO_MIN = 0;
        constexpr long long GPIO_MAX = 39;
        constexpr long long INPUT_ONLY_MIN = 34; // GPIO 34-39 have no output driver on the ESP32.

        /// Longest field path: "slots[31].pins[5]" is 17 chars; leave headroom.
        constexpr size_t FIELD_CAP = 24;

        void add_issue(SlotParseResult& r, ConfigIssueKind kind, const char* field)
        {
            if (r.issue_count >= SlotParseResult::MAX_ISSUES) return;
            ConfigIssue& issue = r.issues[r.issue_count++];
            issue.kind = kind;
            std::snprintf(issue.field, sizeof(issue.field), "%s", field);
        }

        // Builds "slots[i]" or "slots[i].key" into buf.
        const char* entry_field(char* buf, size_t cap, size_t index, const char* key)
        {
            if (key == nullptr) {
                std::snprintf(buf, cap, "slots[%u]", static_cast<unsigned>(index));
            }
            else {
                std::snprintf(buf, cap, "slots[%u].%s", static_cast<unsigned>(index), key);
            }
            return buf;
        }

        // Builds "slots[i].pins[j]" into buf.
        const char* pin_field(char* buf, size_t cap, size_t index, size_t j)
        {
            std::snprintf(buf, cap, "slots[%u].pins[%u]", static_cast<unsigned>(index), static_cast<unsigned>(j));
            return buf;
        }

        // Validates one JSON value as a whole number in [lo, hi]. Reports the
        // problem under `field` and returns false; true when out holds the value.
        // The range test runs before any cast: converting a double outside long
        // long's range is undefined behaviour, not a wrap-around. Written negated
        // so NaN and infinity fail it too - every comparison against NaN is false.
        bool read_number(const cJSON* item, const char* field, long long lo, long long hi, long long& out, SlotParseResult& r)
        {
            if (!cJSON_IsNumber(item))
            {
                add_issue(r, ConfigIssueKind::WrongType, field);
                return false;
            }
            const double d = cJSON_GetNumberValue(item);
            if (!(d >= static_cast<double>(lo) && d <= static_cast<double>(hi)))
            {
                add_issue(r, ConfigIssueKind::OutOfRange, field);
                return false;
            }
            // Provably in range now, so the round trip is safe.
            if (d != static_cast<double>(static_cast<long long>(d)))
            {
                add_issue(r, ConfigIssueKind::WrongType, field);
                return false;
            }
            out = static_cast<long long>(d);
            return true;
        }

        // Reads parent[key] as a whole number in [lo, hi]. Absent and required gives
        // MissingField; absent and optional returns false with no issue.
        bool read_int(const cJSON* parent, const char* key, const char* field, bool required,
                      long long lo, long long hi, long long& out, SlotParseResult& r)
        {
            const cJSON* item = cJSON_GetObjectItemCaseSensitive(parent, key);
            if (item == nullptr)
            {
                if (required) {
                    add_issue(r, ConfigIssueKind::MissingField, field);
                }
                return false;
            }
            return read_number(item, field, lo, hi, out, r);
        }

        SlotParseResult invalid(size_t error_offset)
        {
            SlotParseResult r{};
            r.json_valid = false;
            r.json_error_offset = error_offset;
            add_issue(r, ConfigIssueKind::InvalidJson, "");
            return r;
        }

        // True when `pin` is already used by an accepted entry, or by an earlier
        // pin of the entry being built (candidate[0..count)).
        bool pin_in_use(const SlotParseResult& r, const uint8_t* candidate, size_t count, uint8_t pin)
        {
            for (size_t j = 0; j < r.config.slot_count; ++j)
                for (size_t k = 0; k < r.config.slots[j].pin_count; ++k)
                    if (r.config.slots[j].pins[k] == pin) return true;
            for (size_t k = 0; k < count; ++k)
                if (candidate[k] == pin) return true;
            return false;
        }

        // Validates one entry and appends it to r.config when it is well formed on its own
        // and its pins collide with nothing accepted so far.
        void read_entry(const cJSON* item, size_t index, SlotParseResult& r)
        {
            char field[FIELD_CAP];
            if (!cJSON_IsObject(item))
            {
                add_issue(r, ConfigIssueKind::WrongType, entry_field(field, sizeof(field), index, nullptr));
                return;
            }

            long long slot = 0;
            bool valid = read_int(item, "slot", entry_field(field, sizeof(field), index, "slot"),
                                  true, SLOT_MIN, SLOT_MAX, slot, r);

            const cJSON* pins = cJSON_GetObjectItemCaseSensitive(item, "pins");
            if (pins == nullptr || !cJSON_IsArray(pins) || cJSON_GetArraySize(pins) == 0)
            {
                add_issue(r, ConfigIssueKind::MissingField, entry_field(field, sizeof(field), index, "pins"));
                return;
            }
            if (static_cast<size_t>(cJSON_GetArraySize(pins)) > MAX_PINS_PER_SLOT)
            {
                add_issue(r, ConfigIssueKind::OutOfRange, entry_field(field, sizeof(field), index, "pins"));
                return;
            }

            uint8_t candidate[MAX_PINS_PER_SLOT] = {};
            size_t count = 0;
            size_t j = 0;
            const cJSON* pin_item = nullptr;
            cJSON_ArrayForEach(pin_item, pins)
            {
                long long pin = 0;
                const char* pf = pin_field(field, sizeof(field), index, j);
                if (!read_number(pin_item, pf, GPIO_MIN, GPIO_MAX, pin, r))
                {
                    valid = false;
                }
                else if (pin >= INPUT_ONLY_MIN)
                {
                    add_issue(r, ConfigIssueKind::InputOnlyPin, pf);
                    valid = false;
                }
                else if (pin_in_use(r, candidate, count, static_cast<uint8_t>(pin)))
                {
                    add_issue(r, ConfigIssueKind::DuplicatePin, pf);
                    valid = false;
                }
                else
                {
                    candidate[count++] = static_cast<uint8_t>(pin);
                }
                ++j;
            }

            if (!valid || r.config.slot_count >= MAX_SLOTS)
                return;

            for (size_t k = 0; k < r.config.slot_count; ++k)
            {
                if (r.config.slots[k].slot == static_cast<uint8_t>(slot))
                {
                    add_issue(r, ConfigIssueKind::DuplicateSlot, entry_field(field, sizeof(field), index, "slot"));
                    return;
                }
            }

            SlotEntry& e = r.config.slots[r.config.slot_count++];
            e.slot = static_cast<uint8_t>(slot);
            e.pin_count = static_cast<uint8_t>(count);
            std::memcpy(e.pins, candidate, sizeof(e.pins));
        }

        void read_motor(const cJSON* root, SlotParseResult& r)
        {
            const cJSON* motor = cJSON_GetObjectItemCaseSensitive(root, "motor");
            if (motor == nullptr)
            {
                add_issue(r, ConfigIssueKind::MissingField, "motor");
                return;
            }
            if (!cJSON_IsObject(motor))
            {
                add_issue(r, ConfigIssueKind::WrongType, "motor");
                return;
            }
            long long steps = 0;
            if (read_int(motor, "stepsPerVend", "motor.stepsPerVend", true, STEPS_PER_VEND_MIN, STEPS_PER_VEND_MAX, steps, r)) {
                r.config.steps_per_vend = static_cast<uint16_t>(steps);
            }
        }

        bool only_newer_version_issues(const SlotParseResult& r)
        {
            for (size_t i = 0; i < r.issue_count; ++i)
                if (r.issues[i].kind != ConfigIssueKind::NewerVersion)
                    return false;
            return true;
        }
    }

    SlotParseResult parse_slot_config(const char* json_text)
    {
        if (json_text == nullptr) return invalid(0);

        size_t deep_offset = 0;
        if (nesting_too_deep(json_text, deep_offset)) return invalid(deep_offset);

        cJSON* root = cJSON_Parse(json_text);
        if (root == nullptr)
        {
            const char* err = cJSON_GetErrorPtr();
            const size_t offset = (err != nullptr && err >= json_text) ? static_cast<size_t>(err - json_text) : 0;
            return invalid(offset);
        }
        if (!cJSON_IsObject(root)) {
            cJSON_Delete(root);
            return invalid(0);
        }

        SlotParseResult r{};
        r.json_valid = true;

        long long version = SLOT_SCHEMA_VERSION;
        if (read_int(root, "version", "version", false, 0, 1000000, version, r) && version > SLOT_SCHEMA_VERSION) {
            add_issue(r, ConfigIssueKind::NewerVersion, "version");
        }

        read_motor(root, r);

        const cJSON* slots = cJSON_GetObjectItemCaseSensitive(root, "slots");
        if (slots == nullptr || !cJSON_IsArray(slots) || cJSON_GetArraySize(slots) == 0)
        {
            add_issue(r, ConfigIssueKind::MissingField, "slots");
        }
        else
        {
            const int count = cJSON_GetArraySize(slots);
            if (static_cast<size_t>(count) > MAX_SLOTS) {
                add_issue(r, ConfigIssueKind::TooManySlots, "slots");
            }

            size_t index = 0;
            const cJSON* item = nullptr;
            cJSON_ArrayForEach(item, slots)
            {
                if (index >= MAX_SLOTS) break;
                read_entry(item, index, r);
                ++index;
            }
        }
        cJSON_Delete(root);

        r.ok = only_newer_version_issues(r);
        if (!r.ok)
        {
            r.config.steps_per_vend = 0;
            r.config.slot_count = 0;
            std::memset(r.config.slots, 0, sizeof(r.config.slots));
        }
        return r;
    }
}
