#pragma once
/**
 * @file pins.h
 * @brief GPIO assignments for the Motorcontrol board.
 */

/// Motorcontrol pin numbers.
namespace Pins
{
    constexpr int UART_TX = 17; ///< Transmits to Main-Controller's RX.
    constexpr int UART_RX = 16; ///< Receives from Main-Controller's TX.
}
