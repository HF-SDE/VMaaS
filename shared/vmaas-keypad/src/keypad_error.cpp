/**
 * @file keypad_error.cpp
 * @brief Names for KeypadError.
 */
#include "keypad_error.h"

namespace vmaas
{
    const char* to_string(KeypadError e)
    {
        switch (e)
        {
            case KeypadError::None:
                return "None";
            case KeypadError::BadPinConfig:
                return "BadPinConfig";
            case KeypadError::GpioInitFailed:
                return "GpioInitFailed";
            case KeypadError::PortUnavailable:
                return "PortUnavailable";
        }
        return "Unknown";
    }
}
