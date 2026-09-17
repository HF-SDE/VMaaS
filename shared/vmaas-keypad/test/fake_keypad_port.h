#pragma once
/**
 * @file fake_keypad_port.h
 * @brief Matrix-simulating KeypadPort for the host tests. Included as "../fake_keypad_port.h".
 *
 * press(r, c) / release(r, c) set which switches are closed. read_col() then
 * answers the way real hardware would: a column reads low when a closed-switch
 * path connects it to any row that is currently driven low. Because the path
 * may run through other pressed keys, three-key ghosting appears on its own
 * and the driver's suppression can be tested honestly.
 *
 * configure() records the pins it was handed and can be made to fail with
 * fail_configure so GpioInitFailed can be exercised.
 */
#include <cstddef>
#include <vector>
#include "keypad_port.h"

class FakeKeypadPort : public vmaas::KeypadPort
{
public:
    static constexpr size_t ROWS = 4;
    static constexpr size_t COLS = 3;

    std::vector<int> configured_rows;
    std::vector<int> configured_cols;
    bool fail_configure = false;
    int configure_calls = 0;
    int read_col_calls = 0;

    vmaas::KeypadError configure(const int* rows, size_t row_count,
                                 const int* cols, size_t col_count) override
    {
        ++configure_calls;
        if (fail_configure)
            return vmaas::KeypadError::GpioInitFailed;
        configured_rows.assign(rows, rows + row_count);
        configured_cols.assign(cols, cols + col_count);
        return vmaas::KeypadError::None;
    }

    void drive_row(size_t row, bool level) override
    {
        if (row < ROWS)
            row_low_[row] = !level;
    }

    bool read_col(size_t col) override
    {
        ++read_col_calls;
        if (col >= COLS)
            return true;
        return !col_is_pulled_low(col);
    }

    void press(size_t row, size_t col)
    {
        if (row < ROWS && col < COLS)
            closed_[row][col] = true;
    }

    void release(size_t row, size_t col)
    {
        if (row < ROWS && col < COLS)
            closed_[row][col] = false;
    }

    void release_all()
    {
        for (size_t r = 0; r < ROWS; ++r)
            for (size_t c = 0; c < COLS; ++c)
                closed_[r][c] = false;
    }

private:
    bool closed_[ROWS][COLS] = {};
    bool row_low_[ROWS] = {};

    // Flood the bipartite graph of closed switches from every low row and
    // report whether `col` ends up in the reachable set. This is what makes a
    // phantom key appear when three switches form an L.
    bool col_is_pulled_low(size_t col) const
    {
        bool row_seen[ROWS] = {};
        bool col_seen[COLS] = {};
        for (size_t r = 0; r < ROWS; ++r)
            row_seen[r] = row_low_[r];

        bool grew = true;
        while (grew)
        {
            grew = false;
            for (size_t r = 0; r < ROWS; ++r)
                for (size_t c = 0; c < COLS; ++c)
                {
                    if (!closed_[r][c])
                        continue;
                    if (row_seen[r] && !col_seen[c]) { col_seen[c] = true; grew = true; }
                    if (col_seen[c] && !row_seen[r]) { row_seen[r] = true; grew = true; }
                }
        }
        return col_seen[col];
    }
};
