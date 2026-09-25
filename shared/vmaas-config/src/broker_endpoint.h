#pragma once
/**
 * @file broker_endpoint.h
 * @brief Settles which broker address a device dials.
 */
#include <cstdint>
#include "device_config.h"

namespace vmaas
{
    /// The address broker_client should dial, and where each half came from.
    struct BrokerEndpoint
    {
        char     host[MAX_BROKER_HOST]; ///< "" only when neither source had one.
        uint16_t port;                  ///< 0 only when neither source had one.
        bool     host_overridden;       ///< The host came from config.json, not activation.
        bool     port_overridden;       ///< The port came from config.json, not activation.
        bool     usable;                ///< Both halves are present; dialling is worth attempting.
    };

    /**
     * @brief Picks the broker address, config.json winning over activation.
     *
     * The device learns this address twice: POST /device/activate stores one in
     * NVS, and config.json may name another. Keeping the broker out of the file
     * was once what made disagreement impossible, but it also made the address
     * permanent - changing it meant activating again, which means a new
     * certificate and a new claim merely to follow a broker to a new IP.
     *
     * So they may now disagree, and this is the one place that says who wins:
     * a non-empty field in the file does, each half independently, so a broker
     * that moved address but kept its port needs only the line that changed.
     * The two `*_overridden` flags exist so the caller can log which source it
     * actually dialled - an operator debugging a machine that will not connect
     * should never have to guess that.
     *
     * @param config_host      config.json's broker.host, "" when absent.
     * @param config_port      config.json's broker.port, 0 when absent.
     * @param activation_host  What activation stored, "" when never activated.
     * @param activation_port  What activation stored, 0 when never activated.
     */
    BrokerEndpoint broker_endpoint(const char* config_host, uint16_t config_port,
                                   const char* activation_host, uint16_t activation_port);
}
