#pragma once
/**
 * @file config.h
 * @brief Compile-time settings for the Main-Controller firmware.
 */

/// Main-Controller configuration.
namespace Config
{
    /// UART speed towards Motorcontrol in bit/s. Must match Motorcontrol.
    constexpr int baud_rate = 115200;
}
