#pragma once
/**
 * @file pins.h
 * @brief GPIO assignments for the Main-Controller board.
 */

/// Main-Controller pin numbers.
namespace Pins
{
    constexpr int UART_RX = 32; ///Receives pin on Motorcontrol's RX.
    constexpr int UART_TX = 33; ///Transmits pin on Motorcontrol's TX.

    constexpr int I2C_SDA = 21; ///< Grove-LCD SDA. ESP32 default I2C SDA.
    constexpr int I2C_SCL = 22; ///< Grove-LCD SCL. ESP32 default I2C SCL.
}
