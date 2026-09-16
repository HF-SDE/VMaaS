#include "config_parser.h"

#include <climits>
#include <cstring>
#include "cJSON.h"

namespace vmaas
{
    namespace
    {
        // Field names used in issues. Static storage so ConfigIssue::field can point at them.
        constexpr const char* F_VERSION   = "version";
        constexpr const char* F_PINS      = "pins";
        constexpr const char* F_UART_RX   = "pins.uart_rx";
        constexpr const char* F_UART_TX   = "pins.uart_tx";
        constexpr const char* F_I2C_SDA   = "pins.i2c_sda";
        constexpr const char* F_I2C_SCL   = "pins.i2c_scl";
        constexpr const char* F_UART      = "uart";
        constexpr const char* F_BAUD      = "uart.baud_rate";
        constexpr const char* F_I2C       = "i2c";
        constexpr const char* F_CLOCK     = "i2c.clock_hz";

        void add_issue(ParseResult& r, ConfigIssueKind kind, const char* field)
        {
            if (r.issue_count < ParseResult::MAX_ISSUES)
                r.issues[r.issue_count++] = ConfigIssue{kind, field};
        }

        // One integer field read from the file. Holds a 64-bit value so range checks
        // (Task 4) can see values that do not fit the destination type.
        struct Candidate
        {
            long long value;
            bool from_file;
        };

        // Reads parent[key] as an integer. Absent: candidate untouched. Present but not an
        // integer number: WrongType issue, candidate untouched.
        void read_int(const cJSON* parent, const char* key, const char* field,
                      Candidate& out, ParseResult& r)
        {
            if (parent == nullptr)
                return;
            const cJSON* item = cJSON_GetObjectItemCaseSensitive(parent, key);
            if (item == nullptr)
                return;
            if (!cJSON_IsNumber(item))
            {
                add_issue(r, ConfigIssueKind::WrongType, field);
                return;
            }
            const double d = cJSON_GetNumberValue(item);
            // Range check before the cast: converting an out-of-range double to
            // long long is undefined behaviour. 2^62 keeps the cast well inside.
            constexpr double LIMIT = 4611686018427387904.0; // 2^62
            if (d != d || d > LIMIT || d < -LIMIT ||
                d != static_cast<double>(static_cast<long long>(d)))
            {
                add_issue(r, ConfigIssueKind::WrongType, field);
                return;
            }
            out.value = static_cast<long long>(d);
            out.from_file = true;
        }

        // Returns root[key] if it is an object; nullptr if absent; nullptr plus a
        // WrongType issue if present with another type.
        const cJSON* read_section(const cJSON* root, const char* key, const char* field, ParseResult& r)
        {
            const cJSON* item = cJSON_GetObjectItemCaseSensitive(root, key);
            if (item == nullptr)
                return nullptr;
            if (!cJSON_IsObject(item))
            {
                add_issue(r, ConfigIssueKind::WrongType, field);
                return nullptr;
            }
            return item;
        }

        constexpr long long GPIO_MIN = 0;
        constexpr long long GPIO_MAX = 39;
        constexpr long long INPUT_ONLY_MIN = 34; // GPIO 34-39 have no output driver on the ESP32.

        // Rejects a pin candidate that is outside 0-39, or input-only in an output role.
        // A rejected candidate reverts to its default so it still takes part in the duplicate check.
        void validate_pin(Candidate& c, long long default_value, bool output_role,
                          const char* field, ParseResult& r)
        {
            if (!c.from_file)
                return;
            if (c.value < GPIO_MIN || c.value > GPIO_MAX)
                add_issue(r, ConfigIssueKind::OutOfRange, field);
            else if (output_role && c.value >= INPUT_ONLY_MIN)
                add_issue(r, ConfigIssueKind::InputOnlyPin, field);
            else
                return;
            c.value = default_value;
            c.from_file = false;
        }

        // Rejects a positive-integer candidate outside 1..max.
        void validate_positive(Candidate& c, long long default_value, long long max,
                               const char* field, ParseResult& r)
        {
            if (!c.from_file)
                return;
            if (c.value < 1 || c.value > max)
            {
                add_issue(r, ConfigIssueKind::OutOfRange, field);
                c.value = default_value;
                c.from_file = false;
            }
        }

        // OWNER DECISION default: on a collision the later file-provided field loses.
        // Order is uart_rx, uart_tx, i2c_sda, i2c_scl. A default never loses to a file value.
        // A reverted pin gets its default back, which may collide with a pair already
        // checked, so the scan restarts after every revert. Each revert clears one
        // from_file flag, so it runs at most five passes.
        void reject_duplicates(Candidate* pins[4], const long long defaults[4],
                               const char* fields[4], ParseResult& r)
        {
            bool changed = true;
            while (changed)
            {
                changed = false;
                for (int j = 1; j < 4 && !changed; ++j)
                {
                    for (int i = 0; i < j && !changed; ++i)
                    {
                        if (pins[i]->value != pins[j]->value)
                            continue;
                        int loser = -1;
                        if (pins[j]->from_file)
                            loser = j;
                        else if (pins[i]->from_file)
                            loser = i;
                        if (loser < 0)
                            continue; // two defaults colliding is a firmware bug, not a file issue
                        add_issue(r, ConfigIssueKind::DuplicatePin, fields[loser]);
                        pins[loser]->value = defaults[loser];
                        pins[loser]->from_file = false;
                        changed = true;
                    }
                }
            }
        }

        // cJSON recurses once per nesting level, so the depth of the file decides how
        // much stack the parse needs. Schema v1 is two levels deep ({"pins": {...}});
        // 8 leaves room for the file to grow. Anything deeper is rejected here, before
        // cJSON recurses, so a hostile ~70-byte file cannot exhaust the caller's stack.
        constexpr int MAX_NESTING_DEPTH = 8;

        // Walks @p text counting brackets outside string literals. Returns true and
        // sets @p offset to the index of the offending byte if a '{' or '[' would take
        // the nesting past MAX_NESTING_DEPTH. Never reports a depth error for text that
        // stays inside the limit; unbalanced or otherwise broken text is left to cJSON.
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

        ParseResult invalid(const Config& defaults, size_t error_offset)
        {
            ParseResult r{};
            r.config = defaults;
            r.json_valid = false;
            r.json_error_offset = error_offset;
            add_issue(r, ConfigIssueKind::InvalidJson, "");
            return r;
        }
    }

    ParseResult parse_config(const char* json_text, const Config& defaults)
    {
        if (json_text == nullptr)
            return invalid(defaults, 0);

        size_t deep_offset = 0;
        if (nesting_too_deep(json_text, deep_offset))
            return invalid(defaults, deep_offset);

        cJSON* root = cJSON_Parse(json_text);
        if (root == nullptr)
        {
            const char* err = cJSON_GetErrorPtr();
            const size_t offset = (err != nullptr && err >= json_text) ? static_cast<size_t>(err - json_text) : 0;
            return invalid(defaults, offset);
        }
        if (!cJSON_IsObject(root))
        {
            cJSON_Delete(root);
            return invalid(defaults, 0);
        }

        ParseResult r{};
        r.config = defaults;
        r.json_valid = true;

        Candidate version  = {CONFIG_SCHEMA_VERSION, false};
        Candidate uart_rx  = {defaults.pins.uart_rx, false};
        Candidate uart_tx  = {defaults.pins.uart_tx, false};
        Candidate i2c_sda  = {defaults.pins.i2c_sda, false};
        Candidate i2c_scl  = {defaults.pins.i2c_scl, false};
        Candidate baud     = {defaults.uart.baud_rate, false};
        Candidate clock_hz = {static_cast<long long>(defaults.i2c.clock_hz), false};

        read_int(root, "version", F_VERSION, version, r);

        const cJSON* pins = read_section(root, "pins", F_PINS, r);
        read_int(pins, "uart_rx", F_UART_RX, uart_rx, r);
        read_int(pins, "uart_tx", F_UART_TX, uart_tx, r);
        read_int(pins, "i2c_sda", F_I2C_SDA, i2c_sda, r);
        read_int(pins, "i2c_scl", F_I2C_SCL, i2c_scl, r);

        const cJSON* uart = read_section(root, "uart", F_UART, r);
        read_int(uart, "baud_rate", F_BAUD, baud, r);

        const cJSON* i2c = read_section(root, "i2c", F_I2C, r);
        read_int(i2c, "clock_hz", F_CLOCK, clock_hz, r);

        cJSON_Delete(root);

        if (version.from_file && version.value > CONFIG_SCHEMA_VERSION)
            add_issue(r, ConfigIssueKind::NewerVersion, F_VERSION);

        validate_pin(uart_rx, defaults.pins.uart_rx, false, F_UART_RX, r);
        validate_pin(uart_tx, defaults.pins.uart_tx, true,  F_UART_TX, r);
        validate_pin(i2c_sda, defaults.pins.i2c_sda, true,  F_I2C_SDA, r);
        validate_pin(i2c_scl, defaults.pins.i2c_scl, true,  F_I2C_SCL, r);

        Candidate* pin_table[4] = {&uart_rx, &uart_tx, &i2c_sda, &i2c_scl};
        const long long pin_defaults[4] = {defaults.pins.uart_rx, defaults.pins.uart_tx,
                                           defaults.pins.i2c_sda, defaults.pins.i2c_scl};
        const char* pin_fields[4] = {F_UART_RX, F_UART_TX, F_I2C_SDA, F_I2C_SCL};
        reject_duplicates(pin_table, pin_defaults, pin_fields, r);

        validate_positive(baud, defaults.uart.baud_rate, INT_MAX, F_BAUD, r);
        validate_positive(clock_hz, static_cast<long long>(defaults.i2c.clock_hz), UINT32_MAX, F_CLOCK, r);

        r.config.pins.uart_rx   = static_cast<int>(uart_rx.value);
        r.config.pins.uart_tx   = static_cast<int>(uart_tx.value);
        r.config.pins.i2c_sda   = static_cast<int>(i2c_sda.value);
        r.config.pins.i2c_scl   = static_cast<int>(i2c_scl.value);
        r.config.uart.baud_rate = static_cast<int>(baud.value);
        r.config.i2c.clock_hz   = static_cast<uint32_t>(clock_hz.value);
        return r;
    }
}
