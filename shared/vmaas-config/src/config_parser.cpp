#include "config_parser.h"

#include <cstdio>
#include <cstring>
#include "cJSON.h"

namespace vmaas
{
    namespace
    {
        constexpr long long SLOT_MIN = 1;
        constexpr long long SLOT_MAX = 255;
        constexpr long long GPIO_MIN = 0;
        constexpr long long GPIO_MAX = 39;
        constexpr long long INPUT_ONLY_MIN = 34; // GPIO 34-39 have no output driver on the ESP32.

        // Schema v1 is depth 3 (object > array > object). Anything deeper than this is
        // rejected before cJSON recurses, so a hostile file cannot exhaust the stack.
        constexpr int MAX_NESTING_DEPTH = 8;

        void add_issue(ParseResult& r, ConfigIssueKind kind, const char* field)
        {
            if (r.issue_count >= ParseResult::MAX_ISSUES)
                return;
            ConfigIssue& issue = r.issues[r.issue_count++];
            issue.kind = kind;
            std::snprintf(issue.field, sizeof(issue.field), "%s", field);
        }

        // Builds "slots[i]" or "slots[i].key" into buf. buf must hold at least 20 chars.
        const char* entry_field(char* buf, size_t cap, size_t index, const char* key)
        {
            if (key == nullptr)
                std::snprintf(buf, cap, "slots[%u]", static_cast<unsigned>(index));
            else
                std::snprintf(buf, cap, "slots[%u].%s", static_cast<unsigned>(index), key);
            return buf;
        }

        // Reads parent[key] as an integer into out. Returns false (with an issue) when the
        // key is absent or not an integer number; true when out holds the value.
        bool read_int(const cJSON* parent, const char* key, const char* field, bool required,
                      long long& out, ParseResult& r)
        {
            const cJSON* item = cJSON_GetObjectItemCaseSensitive(parent, key);
            if (item == nullptr)
            {
                if (required)
                    add_issue(r, ConfigIssueKind::MissingField, field);
                return false;
            }
            if (!cJSON_IsNumber(item))
            {
                add_issue(r, ConfigIssueKind::WrongType, field);
                return false;
            }
            const double d = cJSON_GetNumberValue(item);
            // Range check before the cast: converting an out-of-range double to
            // long long is undefined behaviour. 2^62 keeps the cast well inside.
            constexpr double LIMIT = 4611686018427387904.0; // 2^62
            if (d != d || d > LIMIT || d < -LIMIT ||
                d != static_cast<double>(static_cast<long long>(d)))
            {
                add_issue(r, ConfigIssueKind::WrongType, field);
                return false;
            }
            out = static_cast<long long>(d);
            return true;
        }

        // Scans bracket depth outside string literals. Returns true and the offending
        // byte offset when the text nests deeper than MAX_NESTING_DEPTH.
        bool nesting_too_deep(const char* text, size_t& offset)
        {
            int depth = 0;
            bool in_string = false;
            bool escaped = false;
            for (size_t i = 0; text[i] != '\0'; ++i)
            {
                const char c = text[i];
                if (in_string)
                {
                    if (escaped)
                        escaped = false;
                    else if (c == '\\')
                        escaped = true;
                    else if (c == '"')
                        in_string = false;
                    continue;
                }
                if (c == '"')
                {
                    in_string = true;
                }
                else if (c == '{' || c == '[')
                {
                    if (++depth > MAX_NESTING_DEPTH)
                    {
                        offset = i;
                        return true;
                    }
                }
                else if (c == '}' || c == ']')
                {
                    if (depth > 0)
                        --depth;
                }
            }
            return false;
        }

        ParseResult invalid(size_t error_offset)
        {
            ParseResult r{};
            r.json_valid = false;
            r.json_error_offset = error_offset;
            add_issue(r, ConfigIssueKind::InvalidJson, "");
            return r;
        }

        // Validates one entry and appends it to r.config when it is well formed on its own.
        // Cross-entry rules (duplicates) run afterwards over the appended entries.
        void read_entry(const cJSON* item, size_t index, ParseResult& r)
        {
            char field[20];
            if (!cJSON_IsObject(item))
            {
                add_issue(r, ConfigIssueKind::WrongType, entry_field(field, sizeof(field), index, nullptr));
                return;
            }

            long long slot = 0, pin = 0;
            const bool have_slot = read_int(item, "slot", entry_field(field, sizeof(field), index, "slot"), true, slot, r);
            const bool have_pin  = read_int(item, "pin",  entry_field(field, sizeof(field), index, "pin"),  true, pin,  r);
            bool valid = have_slot && have_pin;

            if (have_slot && (slot < SLOT_MIN || slot > SLOT_MAX))
            {
                add_issue(r, ConfigIssueKind::OutOfRange, entry_field(field, sizeof(field), index, "slot"));
                valid = false;
            }
            if (have_pin)
            {
                if (pin < GPIO_MIN || pin > GPIO_MAX)
                {
                    add_issue(r, ConfigIssueKind::OutOfRange, entry_field(field, sizeof(field), index, "pin"));
                    valid = false;
                }
                else if (pin >= INPUT_ONLY_MIN)
                {
                    add_issue(r, ConfigIssueKind::InputOnlyPin, entry_field(field, sizeof(field), index, "pin"));
                    valid = false;
                }
            }
            if (!valid || r.config.slot_count >= MAX_SLOTS)
                return;

            // Duplicates are checked against the entries accepted so far, so the later one is named.
            for (size_t j = 0; j < r.config.slot_count; ++j)
            {
                if (r.config.slots[j].slot == static_cast<uint8_t>(slot))
                {
                    add_issue(r, ConfigIssueKind::DuplicateSlot, entry_field(field, sizeof(field), index, "slot"));
                    return;
                }
                if (r.config.slots[j].pin == static_cast<int>(pin))
                {
                    add_issue(r, ConfigIssueKind::DuplicatePin, entry_field(field, sizeof(field), index, "pin"));
                    return;
                }
            }
            r.config.slots[r.config.slot_count++] = SlotEntry{static_cast<uint8_t>(slot), static_cast<int>(pin)};
        }

        bool only_newer_version_issues(const ParseResult& r)
        {
            for (size_t i = 0; i < r.issue_count; ++i)
                if (r.issues[i].kind != ConfigIssueKind::NewerVersion)
                    return false;
            return true;
        }
    }

    ParseResult parse_config(const char* json_text)
    {
        if (json_text == nullptr)
            return invalid(0);

        size_t deep_offset = 0;
        if (nesting_too_deep(json_text, deep_offset))
            return invalid(deep_offset);

        cJSON* root = cJSON_Parse(json_text);
        if (root == nullptr)
        {
            const char* err = cJSON_GetErrorPtr();
            const size_t offset = (err != nullptr && err >= json_text) ? static_cast<size_t>(err - json_text) : 0;
            return invalid(offset);
        }
        if (!cJSON_IsObject(root))
        {
            cJSON_Delete(root);
            return invalid(0);
        }

        ParseResult r{};
        r.json_valid = true;

        long long version = CONFIG_SCHEMA_VERSION;
        if (read_int(root, "version", "version", false, version, r) && version > CONFIG_SCHEMA_VERSION)
            add_issue(r, ConfigIssueKind::NewerVersion, "version");

        const cJSON* slots = cJSON_GetObjectItemCaseSensitive(root, "slots");
        if (slots == nullptr || !cJSON_IsArray(slots) || cJSON_GetArraySize(slots) == 0)
        {
            add_issue(r, ConfigIssueKind::MissingField, "slots");
        }
        else
        {
            const int count = cJSON_GetArraySize(slots);
            if (static_cast<size_t>(count) > MAX_SLOTS)
                add_issue(r, ConfigIssueKind::TooManySlots, "slots");

            size_t index = 0;
            const cJSON* item = nullptr;
            cJSON_ArrayForEach(item, slots)
            {
                if (index >= MAX_SLOTS)
                    break;
                read_entry(item, index, r);
                ++index;
            }
        }
        cJSON_Delete(root);

        r.ok = only_newer_version_issues(r);
        if (!r.ok)
        {
            r.config.slot_count = 0;
            std::memset(r.config.slots, 0, sizeof(r.config.slots));
        }
        return r;
    }
}
