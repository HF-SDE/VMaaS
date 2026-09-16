#pragma once
/**
 * @file settings.h
 * @brief Compile-time settings for the Main-Controller firmware.
 */
#include <cstdint>

/// Main-Controller configuration.
namespace Config
{
    /// UART speed towards Motorcontrol in bit/s. Must match Motorcontrol.
    constexpr int baud_rate = 115200;

    /// I2C SCL frequency for the Grove-LCD in Hz. Standard mode; the module is not rated for 400 kHz.
    constexpr uint32_t i2c_clock_hz = 100000;
}
