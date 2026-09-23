#include "broker_endpoint.h"

#include <cstdio>

namespace vmaas
{
    namespace
    {
        bool present(const char* s) { return s != nullptr && s[0] != 0; }
    }

    BrokerEndpoint broker_endpoint(const char* config_host, uint16_t config_port, const char* activation_host, uint16_t activation_port)
    {
        BrokerEndpoint e{};

        e.host_overridden = present(config_host);
        e.port_overridden = config_port != 0;

        const char* host = e.host_overridden ? config_host : (present(activation_host) ? activation_host : "");
        std::snprintf(e.host, sizeof(e.host), "%s", host);

        e.port = e.port_overridden ? config_port : activation_port;
        e.usable = e.host[0] != 0 && e.port != 0;

        return e;
    }
}
