/**
 * @file lcd_error.cpp
 * @brief Names for LcdError values. See lcd_error.h.
 */
#include "lcd_error.h"

namespace vmaas
{
    const char* to_string(LcdError e)
    {
        switch (e)
        {
            case LcdError::None:
                return "None";
            case LcdError::NotInitialized:
                return "NotInitialized";
            case LcdError::InvalidArgument:
                return "InvalidArgument";
            case LcdError::I2cWrite:
                return "I2cWrite";
            case LcdError::RgbChipNotFound:
                return "RgbChipNotFound";
        }
        return "Unknown";
    }
}
