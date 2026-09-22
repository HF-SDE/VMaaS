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

    /// Keypad matrix rows, driven low one at a time. Header pins 3, 6, 1, 4.
    constexpr int KEYPAD_ROWS[4] = {26, 19, 14, 27};
    /// Keypad matrix columns, inputs with internal pull-ups. Header pins 7, 2, 5.
    constexpr int KEYPAD_COLS[3] = {23, 25, 18};

    /// Front door lock relay. Free, and not a strapping pin, so it cannot
    /// disturb boot. See door_lock.h for the polarity.
    constexpr int DOOR_RELAY = 13;

    /// HX-916 COIN, through a PC817 optocoupler. GPIO34-39 are input-only and
    /// have no internal pull-up, which normally rules them out for an
    /// open-collector input — but the optocoupler needs an external 10k
    /// pull-up anyway, so the limitation costs nothing and a general-purpose
    /// GPIO stays free.
    constexpr int COIN_IN = 35;
    /// HX-916 INHIBIT, if the harness exposes it. -1 disables the feature.
    constexpr int INHIBIT_OUT = 13;
}
