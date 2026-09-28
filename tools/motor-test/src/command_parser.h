#pragma once
/**
 * @file command_parser.h
 * @brief Parses one line of the bench firmware's serial command language.
 *
 * Kept free of ESP-IDF headers so it can be exercised on the host with
 * `pio test -e native`; the firmware side only turns the result into GPIO
 * writes. The reserved-pin rule mirrors Motorcontrol's config_store.cpp, and
 * reads the pin numbers it guards from Motorcontrol's pins.h rather than
 * repeating them, so the two cannot drift apart.
 */
#include <cstdint>

/// Bench firmware for spinning one DRV8825 by hand.
namespace motortest
{
    /// What a parsed line asks for.
    enum class CommandKind
    {
        Run,     ///< Enable one driver and emit a pulse train at the shipped speed.
        Slow,    ///< Same, but at a caller-chosen step interval. Bench diagnosis only.
        Stop,    ///< Abort now and raise every nENABLE pin.
        Pins,    ///< Report which pins are raised and which are refused.
        Empty,   ///< Blank line; nothing to do, not an error.
        Invalid, ///< Unusable; `error` says why.
    };

    /// Why a line was refused. One reason per failing line.
    enum class ParseError
    {
        None,
        UnknownCommand, ///< First word is not run/stop/pins.
        MissingPin,
        MissingSteps,
        MissingInterval,
        BadNumber,      ///< A field was not a plain non-negative integer.
        TrailingInput,  ///< More words than the command takes.
        PinOutOfRange,  ///< Not a GPIO number on this ESP32.
        PinInputOnly,   ///< GPIO 34-39 cannot be driven as an output.
        PinReserved,    ///< STEP, the UART link, the console or the SPI flash.
        StepsZero,
        StepsTooLarge,
        IntervalTooSmall,
        IntervalTooLarge,
    };

    /// A parsed line. `pin` and `steps` are meaningful for Run and Slow;
    /// `interval_us` only for Slow, where the caller chose it.
    struct Command
    {
        CommandKind kind = CommandKind::Invalid;
        ParseError error = ParseError::None;
        int pin = -1;
        uint32_t steps = 0;
        uint32_t interval_us = 0;
    };

    /// Largest pulse train one `run` may ask for; 65535 is the admin UI's cap on stepsPerVend.
    constexpr uint32_t MAX_STEPS = 65535;

    /// Bounds on `slow`'s step interval. Below MIN there is no reason not to use
    /// `run`, which pulses through the shipped generator; above MAX even a short
    /// train takes minutes. Both are bench limits, not driver limits.
    constexpr uint32_t MIN_INTERVAL_US = 100;
    constexpr uint32_t MAX_INTERVAL_US = 50000;

    /**
     * @brief Parse one line. Surrounding and repeated whitespace is ignored.
     * @param line NUL-terminated input; nullptr is treated as blank.
     * @return The request, or a Command whose kind is Invalid with `error` set.
     */
    Command parse_command(const char* line);

    /**
     * @brief True for a GPIO a bench run must never drive: the shared STEP
     *        line, the UART link to Main-Controller, the console or the flash.
     */
    bool is_reserved_pin(int pin);

    /// A short, stable description of @p e for printing after `ERR`.
    const char* describe(ParseError e);
}
