#pragma once
/**
 * @file pins.h
 * @brief GPIO assignments for the Main-Controller board.
 */

/// Main-Controller pin numbers.
namespace Pins
{
    constexpr int UART_RX = 32; ///< Receives from Motorcontrol's TX (GPIO17, silkscreen TX2).
    constexpr int UART_TX = 33; ///< Transmits to Motorcontrol's RX (GPIO16, silkscreen RX2).

    constexpr int I2C_SDA = 21; ///< Grove-LCD SDA. ESP32 default I2C SDA.
    constexpr int I2C_SCL = 22; ///< Grove-LCD SCL. ESP32 default I2C SCL.
}
