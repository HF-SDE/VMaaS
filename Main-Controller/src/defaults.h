#pragma once
/**
 * @file defaults.h
 * @brief Factory configuration of the Main-Controller as a vmaas::Config.
 */
#include "config.h"
#include "pins.h"
#include "settings.h"

/// Configuration values used when the device has no config.json or it is invalid.
constexpr vmaas::Config DEFAULTS = {
    {Pins::UART_RX, Pins::UART_TX, Pins::I2C_SDA, Pins::I2C_SCL},
    {Config::baud_rate},
    {Config::i2c_clock_hz},
};
