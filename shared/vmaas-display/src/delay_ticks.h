#pragma once
/**
 * @file delay_ticks.h
 * @brief How many RTOS ticks to wait so a delay is never shorter than asked.
 */
#include <cstdint>

namespace vmaas
{
    /**
     * @brief Ticks to pass to vTaskDelay() for a delay of at least @p ms.
     *
     * vTaskDelay(n) returns at the n-th tick boundary from now, and the first
     * boundary may be almost no time away, so only n - 1 whole ticks are
     * guaranteed. Those must cover @p ms by themselves: round up, then add
     * one. Rounding down and adding one, as delay_ms() once did, turned a
     * 2 ms wait at 100 Hz into vTaskDelay(1) - anywhere from 0 to 10 ms.
     *
     * @param ms             The minimum delay.
     * @param tick_period_ms Milliseconds per tick, portTICK_PERIOD_MS on target.
     * @return 0 for no delay, else the tick count to block for.
     */
    constexpr uint32_t delay_ticks(uint32_t ms, uint32_t tick_period_ms)
    {
        return ms == 0 ? 0 : (ms + tick_period_ms - 1) / tick_period_ms + 1;
    }
}
