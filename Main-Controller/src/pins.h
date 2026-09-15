#pragma once
/**
 * @file pins.h
 * @brief GPIO assignments for the Main-Controller board.
 */

/// Main-Controller pin numbers.
namespace Pins
{
    constexpr int UART_RX = 16; ///Receives pin on Motorcontrol's TX.
    constexpr int UART_TX = 17; ///Transmits pin on Motorcontrol's RX.
}
