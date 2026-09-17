#pragma once
/**
 * @file keypad_port.h
 * @brief Hardware seam between Keypad and the GPIO pins.
 */
#include <cstddef>
#include "keypad_error.h"

namespace vmaas
{
    /// Minimal row-drive + column-read abstraction used by Keypad.
    class KeypadPort
    {
    public:
        virtual ~KeypadPort() = default;

        /**
         * @brief Claim the pins: rows as outputs (idle high), columns as inputs with pull-up.
         * @param rows Row GPIO numbers.
         * @param row_count Number of entries in @p rows.
         * @param cols Column GPIO numbers.
         * @param col_count Number of entries in @p cols.
         * @return KeypadError::None on success, GpioInitFailed if the pins could not be claimed.
         */
        virtual KeypadError configure(const int* rows, size_t row_count, const int* cols, size_t col_count) = 0;

        /**
         * @brief Drive one row.
         * @param row Index into the row array passed to configure().
         * @param level true drives high (row not selected), false drives low (selected).
         */
        virtual void drive_row(size_t row, bool level) = 0;

        /**
         * @brief Sample one column.
         * @param col Index into the column array passed to configure().
         * @return true when the line reads high, which with the pull-up means "not pressed".
         */
        virtual bool read_col(size_t col) = 0;
    };
}
