#pragma once
/**
 * @file pins.h
 * @brief GPIO assignments for the Main-Controller board.
 *
 * Every pin the firmware drives is declared here and nowhere else, so the
 * static_assert at the bottom of this file can see the whole board at once.
 * Adding an assignment elsewhere puts it outside that check.
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

    /// Front door lock relay. Not a strapping pin, so it cannot disturb boot.
    /// See door_lock.h for the polarity.
    constexpr int DOOR_RELAY = 13;

    /// HX-916 COIN, through a PC817 optocoupler. GPIO34-39 are input-only and
    /// have no internal pull-up, which normally rules them out for an
    /// open-collector input — but the optocoupler needs an external 10k
    /// pull-up anyway, so the limitation costs nothing and a general-purpose
    /// GPIO stays free.
    constexpr int COIN_IN = 35;
    /// HX-916 INHIBIT, if the harness exposes it. purchase_task passes -1
    /// instead when `hasInhibit` is false, which disables the feature.
    ///
    /// GPIO4 rather than 13: 13 is the door relay. On this module 16/17 carry
    /// PSRAM, 6-11 carry flash, 34-39 are input-only, and 0/2/5/12/15 are
    /// strapping pins (12 held high stops the board booting), which leaves 4
    /// as the only free general-purpose output.
    constexpr int INHIBIT_OUT = 4;

    namespace detail
    {
        /// Every pin above, in one place for the uniqueness check.
        constexpr int ALL[] = {
            UART_RX, UART_TX,
            I2C_SDA, I2C_SCL,
            KEYPAD_ROWS[0], KEYPAD_ROWS[1], KEYPAD_ROWS[2], KEYPAD_ROWS[3],
            KEYPAD_COLS[0], KEYPAD_COLS[1], KEYPAD_COLS[2],
            DOOR_RELAY,
            COIN_IN,
            INHIBIT_OUT,
        };

        constexpr bool all_distinct(const int *pins, int count)
        {
            for (int i = 1; i < count; ++i)
                for (int j = 0; j < i; ++j)
                    if (pins[i] == pins[j]) return false;
            return true;
        }
    }

    // Two peripherals on one pin is silent on an ESP32: gpio_config() does not
    // fail on a pin that is already taken, it just overwrites the earlier
    // owner, and the fault only shows up as hardware misbehaving. Catch it at
    // compile time instead.
    static_assert(detail::all_distinct(detail::ALL, sizeof(detail::ALL) / sizeof(detail::ALL[0])),
                  "Two peripherals are assigned the same GPIO in Pins");
}
