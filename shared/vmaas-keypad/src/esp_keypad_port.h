#pragma once
/**
 * @file esp_keypad_port.h
 * @brief ESP-IDF implementation of KeypadPort.
 *
 * The only file in vmaas-keypad that includes an ESP-IDF header.
 * Rows become outputs idling high, columns
 * become inputs with the internal pull-up, which is what makes an unpressed
 * column read high.
 */
#ifdef ESP_PLATFORM

#include "keypad_port.h"
#include "keypad.h"

namespace vmaas
{
    /// Drives the keypad matrix with the ESP-IDF gpio driver.
    class EspKeypadPort : public KeypadPort
    {
    public:
        KeypadError configure(const int* rows, size_t row_count, const int* cols, size_t col_count) override;
        void drive_row(size_t row, bool level) override;
        bool read_col(size_t col) override;

    private:
        int rows_[KEYPAD_ROW_COUNT] = {};
        int cols_[KEYPAD_COL_COUNT] = {};
        bool configured_ = false;
    };
}

#endif // ESP_PLATFORM
