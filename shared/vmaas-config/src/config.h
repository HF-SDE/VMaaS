#pragma once
/**
 * @file config.h
 * @brief Device configuration schema for VMaaS controllers.
 *
 * A Config is plain data. The firmware builds one from its compile-time
 * defaults, and parse_config() (config_parser.h) merges /storage/config.json
 * over it. The library never logs; every problem is reported as a
 * ConfigIssue and the caller decides what to print.
 *
 * Schema version 1 (config.json):
 * @code
 * {
 *   "version": 1,
 *   "pins": { "uart_rx": 32, "uart_tx": 33, "i2c_sda": 21, "i2c_scl": 22 },
 *   "uart": { "baud_rate": 115200 },
 *   "i2c":  { "clock_hz": 100000 }
 * }
 * @endcode
 */
#include <cstddef>
#include <cstdint>

namespace vmaas
{
    /// Schema version this library understands. Files with a higher version parse with a NewerVersion issue.
    constexpr int CONFIG_SCHEMA_VERSION = 1;

    /// Effective device configuration. Every field has a firmware default.
    struct Config
    {
        /// GPIO assignment for the two buses.
        struct Pins
        {
            int uart_rx; ///< GPIO receiving from Motorcontrol. Any GPIO 0-39.
            int uart_tx; ///< GPIO transmitting to Motorcontrol. Output-capable GPIO (0-33).
            int i2c_sda; ///< Grove-LCD SDA. Output-capable GPIO (0-33).
            int i2c_scl; ///< Grove-LCD SCL. Output-capable GPIO (0-33).
        } pins; ///< GPIO numbers for the UART link and the I2C bus.

        /// UART link towards Motorcontrol.
        struct Uart
        {
            int baud_rate; ///< bit/s towards Motorcontrol. Positive.
        } uart; ///< Settings of the UART link towards Motorcontrol.

        /// I2C bus towards the Grove-LCD.
        struct I2c
        {
            uint32_t clock_hz; ///< SCL frequency for the Grove-LCD. Positive.
        } i2c; ///< Settings of the I2C bus towards the Grove-LCD.
    };

    /// What went wrong with one field, or with the file as a whole.
    enum class ConfigIssueKind : uint8_t
    {
        None = 0,     ///< No issue (never stored; keeps 0 meaningful).
        InvalidJson,  ///< The text is not valid JSON. Whole file ignored.
        WrongType,    ///< Field present but not an integer number (or object where one is expected).
        OutOfRange,   ///< Integer outside the allowed range (pin 0-39, positive baud/clock).
        InputOnlyPin, ///< GPIO 34-39 used for an output role (uart_tx, i2c_sda, i2c_scl).
        DuplicatePin, ///< Two pins resolve to the same GPIO on the merged result.
        NewerVersion, ///< "version" is higher than CONFIG_SCHEMA_VERSION. Parsing continued.
    };

    /// One rejected field or file-level problem.
    struct ConfigIssue
    {
        ConfigIssueKind kind; ///< What went wrong.
        const char* field;    ///< Dotted path such as "pins.uart_tx"; "" for file-level issues. Static storage.
    };

    /// Output of parse_config(). Fixed size, no heap.
    struct ParseResult
    {
        static constexpr size_t MAX_ISSUES = 8; ///< One per field plus file-level. Schema v1 has 7 fields that can each raise one issue; grow this when adding fields. Excess issues are dropped.

        Config config;             ///< Defaults merged with every accepted field.
        bool json_valid;           ///< false means the text was not JSON and config equals the defaults.
        size_t json_error_offset;  ///< Byte offset cJSON reported when json_valid is false; 0 otherwise.
        size_t issue_count;        ///< Number of valid entries in issues.
        ConfigIssue issues[MAX_ISSUES]; ///< The first issue_count entries are valid; the rest is unspecified.
    };

    /**
     * @brief Human-readable name of an issue kind.
     * @param kind Kind to name.
     * @return Static string such as "OutOfRange"; "Unknown" for values outside the enum.
     */
    const char* to_string(ConfigIssueKind kind);
}
