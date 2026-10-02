#include "command_parser.h"
#include "pins.h"

namespace
{
    /// Highest GPIO number on the ESP32 this board uses.
    constexpr int LAST_GPIO = 39;
    /// GPIO 34 and up are sense-only: they accept a write and drive nothing.
    constexpr int FIRST_INPUT_ONLY_GPIO = 34;
    /// Anything at or above this is reported as too large rather than wrapped.
    constexpr unsigned long long PARSE_CEILING = 1000000000ULL;

    bool is_space(char c)
    {
        return c == ' ' || c == '\t' || c == '\r' || c == '\n';
    }

    /**
     * @brief Take the next whitespace-separated word, advancing @p p past it.
     * @return Start of the word with @p len set, or nullptr at end of line.
     */
    const char* take(const char*& p, size_t& len)
    {
        while (*p && is_space(*p)) ++p;
        if (!*p) return nullptr;
        const char* start = p;
        while (*p && !is_space(*p)) ++p;
        len = static_cast<size_t>(p - start);
        return start;
    }

    bool word_is(const char* tok, size_t len, const char* literal)
    {
        for (size_t i = 0; i < len; ++i)
        {
            if (literal[i] == '\0' || tok[i] != literal[i]) return false;
        }
        return literal[len] == '\0';
    }

    /**
     * @brief Read a plain non-negative decimal number.
     * @return False if the word is not all digits. Values are saturated at
     *         PARSE_CEILING so a long run of digits still compares as too large.
     */
    bool parse_uint(const char* tok, size_t len, unsigned long long& out)
    {
        if (len == 0) return false;
        unsigned long long value = 0;
        for (size_t i = 0; i < len; ++i)
        {
            if (tok[i] < '0' || tok[i] > '9') return false;
            if (value < PARSE_CEILING) value = value * 10 + static_cast<unsigned long long>(tok[i] - '0');
        }
        out = value;
        return true;
    }

    motortest::Command invalid(motortest::ParseError e)
    {
        motortest::Command c;
        c.kind = motortest::CommandKind::Invalid;
        c.error = e;
        return c;
    }

    /// True once the line holds nothing but trailing whitespace.
    bool at_end(const char* p)
    {
        while (*p && is_space(*p)) ++p;
        return *p == '\0';
    }
}

namespace motortest
{
    bool is_reserved_pin(int pin)
    {
        // Mirrors Motorcontrol's config_store.cpp: the shared STEP line, the
        // link to Main-Controller, the console UART0 and the SPI flash.
        if (pin == Pins::STEP || pin == Pins::UART_TX || pin == Pins::UART_RX) return true;
        if (pin == 1 || pin == 3) return true;
        return pin >= 6 && pin <= 11;
    }

    Command parse_command(const char* line)
    {
        Command c;
        if (line == nullptr)
        {
            c.kind = CommandKind::Empty;
            return c;
        }

        const char* p = line;
        size_t len = 0;
        const char* verb = take(p, len);
        if (verb == nullptr)
        {
            c.kind = CommandKind::Empty;
            return c;
        }

        if (word_is(verb, len, "stop") || word_is(verb, len, "pins"))
        {
            if (!at_end(p)) return invalid(ParseError::TrailingInput);
            c.kind = word_is(verb, len, "stop") ? CommandKind::Stop : CommandKind::Pins;
            return c;
        }

        const bool slow = word_is(verb, len, "slow");
        if (!slow && !word_is(verb, len, "run")) return invalid(ParseError::UnknownCommand);

        const char* pin_tok = take(p, len);
        if (pin_tok == nullptr) return invalid(ParseError::MissingPin);
        unsigned long long pin = 0;
        if (!parse_uint(pin_tok, len, pin)) return invalid(ParseError::BadNumber);

        const char* steps_tok = take(p, len);
        if (steps_tok == nullptr) return invalid(ParseError::MissingSteps);
        unsigned long long steps = 0;
        if (!parse_uint(steps_tok, len, steps)) return invalid(ParseError::BadNumber);

        // Only `slow` carries an interval; `run` uses the firmware constant.
        unsigned long long interval = 0;
        if (slow)
        {
            const char* interval_tok = take(p, len);
            if (interval_tok == nullptr) return invalid(ParseError::MissingInterval);
            if (!parse_uint(interval_tok, len, interval)) return invalid(ParseError::BadNumber);
        }

        if (!at_end(p)) return invalid(ParseError::TrailingInput);

        if (pin > static_cast<unsigned long long>(LAST_GPIO)) return invalid(ParseError::PinOutOfRange);
        if (pin >= static_cast<unsigned long long>(FIRST_INPUT_ONLY_GPIO)) return invalid(ParseError::PinInputOnly);
        if (is_reserved_pin(static_cast<int>(pin))) return invalid(ParseError::PinReserved);

        if (steps == 0) return invalid(ParseError::StepsZero);
        if (steps > MAX_STEPS) return invalid(ParseError::StepsTooLarge);

        if (slow)
        {
            if (interval < MIN_INTERVAL_US) return invalid(ParseError::IntervalTooSmall);
            if (interval > MAX_INTERVAL_US) return invalid(ParseError::IntervalTooLarge);
        }

        c.kind = slow ? CommandKind::Slow : CommandKind::Run;
        c.error = ParseError::None;
        c.pin = static_cast<int>(pin);
        c.steps = static_cast<uint32_t>(steps);
        c.interval_us = static_cast<uint32_t>(interval);
        return c;
    }

    const char* describe(ParseError e)
    {
        switch (e)
        {
        case ParseError::None:           return "ok";
        case ParseError::UnknownCommand: return "unknown command, expected run/stop/pins";
        case ParseError::MissingPin:     return "run needs a pin number";
        case ParseError::MissingSteps:   return "run needs a step count";
        case ParseError::MissingInterval: return "slow needs a step interval in microseconds";
        case ParseError::BadNumber:      return "expected a non-negative whole number";
        case ParseError::TrailingInput:  return "too many arguments";
        case ParseError::PinOutOfRange:  return "no such GPIO on this board";
        case ParseError::PinInputOnly:   return "GPIO 34-39 are input-only and cannot drive nENABLE";
        case ParseError::PinReserved:    return "reserved: STEP, the UART link, the console or the flash";
        case ParseError::StepsZero:      return "step count must be above zero";
        case ParseError::StepsTooLarge:  return "step count above the 65535 cap";
        case ParseError::IntervalTooSmall: return "interval below 100 us; use run for the shipped speed";
        case ParseError::IntervalTooLarge: return "interval above 50000 us";
        }
        return "unknown error";
    }
}
