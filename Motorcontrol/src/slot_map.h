#pragma once
/**
 * @file slot_map.h
 * @brief Mapping from protocol slot numbers to the GPIOs that drive each motor.
 *
 * Main-Controller only ever refers to slots; it never sees GPIO numbers.
 * This table is the single place where the cabinet wiring is described.
 *
 * @warning PROVISIONAL WIRING. Replace with the real mapping when the
 *          cabinet is wired.
 */
#include <cstddef>
#include <cstdint>
#include "driver/gpio.h"

/// One row of the slot table.
struct SlotPin
{
    uint8_t slot;   ///< Slot number as sent by Main-Controller in RUN.
    gpio_num_t pin; ///< GPIO that drives this slot's motor.
};

/// Compile-time slot table for this Motorcontrol board.
namespace SlotMap
{
    /// The wiring table. Slots not listed here are answered with NAK UNKNOWN_SLOT.
    constexpr SlotPin pins[] = {
        {1, GPIO_NUM_18},
        {2, GPIO_NUM_19},
        {3, GPIO_NUM_21},
        {4, GPIO_NUM_22},
    };
    /// Number of entries in pins.
    constexpr size_t count = sizeof(pins) / sizeof(pins[0]);
}
