/**
 * @file coin_acceptor.cpp
 * @brief Pulse-train decoding. See coin_acceptor.h for the contract.
 */
#include "coin_acceptor.h"

namespace vmaas
{
    CoinAcceptor::CoinAcceptor(const CoinConfig &cfg) : cfg_(cfg) {}

    void CoinAcceptor::on_edge(uint32_t at_ms, bool level)
    {
        const bool now_asserted = asserted(level);

        if (now_asserted && !in_pulse_)
        {
            in_pulse_ = true;
            pulse_start_ms_ = at_ms;
            return;
        }

        if (!now_asserted && in_pulse_)
        {
            in_pulse_ = false;

            if (at_ms - pulse_start_ms_ < cfg_.min_pulse_ms)
            {
                ++rejected_pulses_;
                return;
            }

            if (pulses_ < COIN_MAX_PULSES) ++pulses_;
            last_edge_ms_ = at_ms;
        }
    }

    bool CoinAcceptor::tick(uint32_t now_ms, CoinEvent &out)
    {
        if (pulses_ == 0) return false;
        if (in_pulse_) return false;
        if (now_ms - last_edge_ms_ < cfg_.train_gap_ms) return false;

        out.pulses = pulses_;
        out.value_minor = value_for(pulses_);
        pulses_ = 0;

        if (out.value_minor == 0) ++unknown_trains_;

        return true;
    }

    uint32_t CoinAcceptor::value_for(uint8_t pulses) const
    {
        if (pulses == 0 || pulses > COIN_MAX_PULSES) return 0;
        return cfg_.value_by_pulses[pulses];
    }
}
