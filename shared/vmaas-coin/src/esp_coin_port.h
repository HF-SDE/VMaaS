#pragma once
/**
 * @file esp_coin_port.h
 * @brief ESP32 GPIO side of the coin acceptor: an ISR that timestamps edges
 *        and a queue to carry them to the main task.
 *
 * Compiled only for ESP targets, so shared/vmaas-coin still builds under
 * platform = native.
 *
 * The ISR does one thing: read the clock, push a CoinEdge, return. Every
 * decision about what the edges mean belongs to CoinAcceptor on the main
 * task. That split is what makes the decoder testable on a PC, and it keeps
 * the ISR to a handful of instructions.
 *
 * Polling was rejected: CONFIG_FREERTOS_HZ is 100, so a tick is 10 ms, and the
 * acceptor's fastest pulse setting is 20 ms. A polled loop would miss pulses.
 */
#ifdef ESP_PLATFORM

#include <cstdint>

#include "esp_err.h"

namespace vmaas
{
    /// One raw edge as the ISR saw it.
    struct CoinEdge
    {
        uint32_t at_ms = 0; ///< esp_timer time, truncated to milliseconds.
        bool     level = false; ///< The pin level after the edge, raw.
    };

    /**
     * @brief One coin acceptor's GPIO port.
     *
     * Exactly one instance may exist, and begin() may be called for only one
     * pin over the process lifetime. The ISR, the edge queue and the dropped
     * counter are file-scope state in esp_coin_port.cpp, shared by every
     * EspCoinPort instance rather than owned per-object. A second begin()
     * call for a different coin_pin silently retargets that shared state
     * without detaching the first pin's interrupt handler (it is never
     * removed via gpio_isr_handler_add), so edges from both pins would be
     * timestamped and read back through gpio_get_level() on whichever pin
     * begin() set last — a compiler-unenforced trap, not a runtime error.
     */
    class EspCoinPort
    {
    public:
        /**
         * @brief Configure the pins, the queue and the ISR.
         * @param coin_pin     Input pin carrying the COIN pulse.
         * @param inhibit_pin  Output pin driving INHIBIT, or -1 if unwired.
         *
         * INHIBIT is asserted immediately, so the coin slot is shut before the
         * purchase machine has said anything. A machine that accepts money
         * before it is ready is worse than one that accepts none.
         */
        esp_err_t begin(int coin_pin, int inhibit_pin);

        /// Drain one edge. Returns false when the queue is empty.
        bool next(CoinEdge &out);

        /// Drive INHIBIT. A no-op when the pin is unwired.
        void set_inhibit(bool on);

        /// Edges lost to a full queue. Non-zero means coins may be miscounted.
        uint32_t dropped_edges() const;

    private:
        int coin_pin_ = -1;
        int inhibit_pin_ = -1;
    };
}

#endif // ESP_PLATFORM
