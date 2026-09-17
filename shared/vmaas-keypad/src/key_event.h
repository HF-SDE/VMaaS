#pragma once
/**
 * @file key_event.h
 * @brief What the keypad driver emits, and what vmaas-entry consumes.
 */
#include <cstdint>

namespace vmaas
{
    /// Whether a key went down or came up.
    enum class KeyEventType : uint8_t
    {
        Pressed = 0, /// Key went down and survived debounce.
        Released,    /// Key came up and survived debounce.
    };

    /// One debounced key transition.
    struct KeyEvent
    {
        char key;          /// '0'-'9', '*' or '#'.
        KeyEventType type; /// Down or up.
        uint32_t at_ms;    /// Caller's clock when the transition was accepted.
    };
}
