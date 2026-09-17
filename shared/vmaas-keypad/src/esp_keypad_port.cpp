/**
 * @file esp_keypad_port.cpp
 * @brief ESP-IDF GPIO wiring for the keypad matrix.
 */
#ifdef ESP_PLATFORM

#include "esp_keypad_port.h"
#include "driver/gpio.h"

namespace vmaas
{
    KeypadError EspKeypadPort::configure(const int* rows, size_t row_count, const int* cols, size_t col_count)
    {
        configured_ = false;
        if (row_count != KEYPAD_ROW_COUNT || col_count != KEYPAD_COL_COUNT)
            return KeypadError::BadPinConfig;

        uint64_t row_mask = 0;
        uint64_t col_mask = 0;
        for (size_t i = 0; i < row_count; ++i)
        {
            rows_[i] = rows[i];
            row_mask |= (1ULL << rows[i]);
        }
        for (size_t i = 0; i < col_count; ++i)
        {
            cols_[i] = cols[i];
            col_mask |= (1ULL << cols[i]);
        }

        gpio_config_t row_cfg = {};
        row_cfg.pin_bit_mask = row_mask;
        row_cfg.mode = GPIO_MODE_OUTPUT;
        row_cfg.pull_up_en = GPIO_PULLUP_DISABLE;
        row_cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
        row_cfg.intr_type = GPIO_INTR_DISABLE;
        if (gpio_config(&row_cfg) != ESP_OK)
            return KeypadError::GpioInitFailed;

        // Columns float without this pull-up, and a floating input reads as
        // noise: every scan would invent keypresses.
        gpio_config_t col_cfg = {};
        col_cfg.pin_bit_mask = col_mask;
        col_cfg.mode = GPIO_MODE_INPUT;
        col_cfg.pull_up_en = GPIO_PULLUP_ENABLE;
        col_cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
        col_cfg.intr_type = GPIO_INTR_DISABLE;
        if (gpio_config(&col_cfg) != ESP_OK)
            return KeypadError::GpioInitFailed;

        for (size_t i = 0; i < row_count; ++i)
            gpio_set_level(static_cast<gpio_num_t>(rows_[i]), 1);

        configured_ = true;
        return KeypadError::None;
    }

    void EspKeypadPort::drive_row(size_t row, bool level)
    {
        if (!configured_ || row >= KEYPAD_ROW_COUNT)
            return;
        gpio_set_level(static_cast<gpio_num_t>(rows_[row]), level ? 1 : 0);
    }

    bool EspKeypadPort::read_col(size_t col)
    {
        if (!configured_ || col >= KEYPAD_COL_COUNT)
            return true;
        return gpio_get_level(static_cast<gpio_num_t>(cols_[col])) != 0;
    }
}

#endif // ESP_PLATFORM
