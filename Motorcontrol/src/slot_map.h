#pragma once
// Slot number (as sent by Main-Controller in RUN) -> GPIO that drives
// that slot's motor. Main-Controller never sees GPIO numbers.
//
// PROVISIONAL WIRING. Replace with the real mapping when the cabinet is wired.
#include <cstddef>
#include <cstdint>
#include "driver/gpio.h"

struct SlotPin
{
    uint8_t slot;
    gpio_num_t pin;
};

namespace SlotMap
{
    constexpr SlotPin pins[] = {
        {1, GPIO_NUM_18},
        {2, GPIO_NUM_19},
        {3, GPIO_NUM_21},
        {4, GPIO_NUM_22},
    };
    constexpr size_t count = sizeof(pins) / sizeof(pins[0]);
}
