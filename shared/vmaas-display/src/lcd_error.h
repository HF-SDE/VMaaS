#pragma once
/**
 * @file lcd_error.h
 * @brief Result codes returned by the vmaas-display driver.
 *
 * The library never logs. Every fallible call returns one of these and the
 * caller decides what to do; to_string() gives a log-friendly name.
 */
#include <cstdint>

namespace vmaas
{
    /// Result of a display driver call. None means success.
    enum class LcdError : uint8_t
    {
        None = 0,        /// Success.
        NotInitialized,  /// begin() has not been called, or it failed on the LCD part.
        InvalidArgument, /// col/row outside 16x2, nullptr text, or text too long for the scroll buffer.
        I2cWrite,        /// The port reported a failed write (NAK, timeout, display unplugged).
        RgbChipNotFound, /// Grove only: neither 0x62 (v4.0) nor 0x30 (v5.0) answered during begin().
    };

    /**
     * @brief Human-readable name of an error code.
     * @param e Code to name.
     * @return Static string such as "I2cWrite"; "Unknown" for values outside the enum.
     */
    const char* to_string(LcdError e);
}
