#pragma once
/**
 * @file coin_acceptor.h
 * @brief Decodes HX-916 pulse trains into coin values.
 *
 * Hardware-free on purpose: the decoder only ever sees timestamped edges, so
 * the whole of it runs under `platform = native`. The ISR that produces those
 * edges lives in esp_coin_port.h and does nothing but timestamp and queue.
 *
 * The acceptor emits one pulse train per accepted coin, and the number of
 * pulses identifies which coin it was. A train is complete when the line has
 * been quiet for CoinConfig::train_gap_ms.
 */
#include <cstdint>

namespace vmaas
{
    /// Largest pulse count the acceptor can be programmed to emit.
    constexpr uint8_t COIN_MAX_PULSES = 8;

    /// One accepted coin, decoded from a pulse train.
    struct CoinEvent
    {
        uint8_t  pulses = 0;      ///< Pulses counted in the train.
        uint32_t value_minor = 0; ///< Coin value in minor units. 0 = unrecognised.
    };

    /**
     * @brief Calibration for one acceptor, loaded from the device configuration.
     *
     * Every field is configuration rather than a constant because all of them
     * depend on switches on the acceptor itself, which a technician may change
     * in the field.
     */
    struct CoinConfig
    {
        /// True when a coin pulls the line low. Which way round it is depends
        /// on the NO/NC switch and on how the optocoupler is wired, so it must
        /// be observed on the bench, never assumed.
        bool active_low = true;
        /// Pulses shorter than this are contact noise or a solenoid spike.
        uint16_t min_pulse_ms = 15;
        /// Silence this long ends a train. Must sit between the spacing of
        /// pulses within one coin and the spacing of two coins by hand.
        uint16_t train_gap_ms = 250;
        /// pulses -> value in minor units, index 1..COIN_MAX_PULSES.
        /// 0 means "this pulse count is not a coin".
        uint32_t value_by_pulses[COIN_MAX_PULSES + 1] = {};
    };

    /**
     * @brief Turns a stream of edges into CoinEvents.
     *
     * Usage: drain the ISR queue into on_edge(), then call tick() every loop
     * pass. tick() is what closes a train, so it must be called even when no
     * edges arrive.
     */
    class CoinAcceptor
    {
    public:
        explicit CoinAcceptor(const CoinConfig &cfg);

        /**
         * @brief Feed one edge. Never call this from an ISR.
         * @param at_ms  When the edge happened.
         * @param level  The new line level, raw, before active_low is applied.
         */
        void on_edge(uint32_t at_ms, bool level);

        /**
         * @brief Close a train whose gap has elapsed.
         * @return True when @p out has been filled with a completed coin.
         */
        bool tick(uint32_t now_ms, CoinEvent &out);

        uint32_t rejected_pulses() const { return rejected_pulses_; }
        uint32_t unknown_trains() const { return unknown_trains_; }

    private:
        /// True when @p level means "the acceptor is asserting a pulse".
        bool asserted(bool level) const { return cfg_.active_low ? !level : level; }
        uint32_t value_for(uint8_t pulses) const;

        CoinConfig cfg_;
        bool     in_pulse_ = false;    ///< A pulse is currently asserted.
        uint32_t pulse_start_ms_ = 0;  ///< When the current pulse began.
        uint8_t  pulses_ = 0;          ///< Pulses counted in the open train.
        uint32_t last_edge_ms_ = 0;    ///< When the train last saw an edge.
        uint32_t rejected_pulses_ = 0;
        uint32_t unknown_trains_ = 0;
    };
}
