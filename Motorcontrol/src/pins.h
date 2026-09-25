#pragma once
/**
 * @file pins.h
 * @brief GPIO assignments for the Motorcontrol board.
 *
 * The motor nENABLE pins are NOT here: they come from /storage/config.json
 * (one per driver, published by the backend). Only the fixed board wiring is.
 */

/// Motorcontrol pin numbers.
namespace Pins
{
    constexpr int UART_TX = 17; ///< Transmits to Main-Controller's RX (GPIO32).
    constexpr int UART_RX = 16; ///< Receives from Main-Controller's TX (GPIO33).

    /// Shared STEP line, wired in parallel to every DRV8825's STEP input. The
    /// devkit's blue LED sits on GPIO4, so it flickers while a motor turns.
    /// Must be below 32: StepGenerator writes GPIO.out_w1ts/out_w1tc directly.
    constexpr int STEP = 4;
}
