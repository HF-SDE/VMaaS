#pragma once
/**
 * @file keypad_error.h
 * @brief Result codes returned by the vmaas-keypad driver.
 *
 * The library never logs. Every fallible call returns one of these and the
 * caller decides what to do; to_string() gives a log-friendly name.
 */
#include <cstdint>

namespace vmaas
{
    /// Result of a Keypad call. None means success.
    enum class KeypadError : uint8_t
    {
        None = 0,        /// Success.
        BadPinConfig,    /// Negative pin, duplicate pin, or wrong row/column count.
        GpioInitFailed,  /// The port could not configure the pins.
        PortUnavailable, /// begin() has not been called, or it failed.
    };

    /**
     * @brief Human-readable name of an error code.
     * @param e Code to name.
     * @return Static string such as "BadPinConfig"; "Unknown" for values outside the enum.
     */
    const char* to_string(KeypadError e);
}
