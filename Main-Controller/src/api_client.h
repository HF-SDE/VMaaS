#pragma once
/**
 * @file api_client.h
 * @brief Authenticated HTTP to the platform, using the machine's certificate.
 *
 * The same client configuration activation builds for its unauthenticated
 * POST, plus the client certificate and key from NVS. nginx verifies the
 * certificate on :8443 and passes X-Client-Verify to the backend, where
 * requireMachine turns it into a machine row - which is why nothing sent from
 * here needs to carry a machine, tenant or site id.
 *
 * Its own module rather than part of the event reporter because certificate
 * renewal and GET /device/configuration need exactly this and neither exists
 * yet. One handle is kept open across calls, so draining a backlog costs one
 * TLS handshake rather than one per event.
 */
#include <cstddef>
#include "esp_err.h"

/// Authenticated calls to the platform API.
namespace api_client
{
    /**
     * @brief Load the certificate, key and trust anchor into static buffers.
     * @param api_base_url e.g. "https://vmaas.dk:8443/api". Must not be empty.
     * @return ESP_ERR_INVALID_STATE when the machine has no certificate.
     */
    esp_err_t begin(const char* api_base_url);

    /**
     * @brief POST @p body as JSON to @p path, relative to the base URL.
     * @param path         e.g. "/device/events/batch".
     * @param status_out   HTTP status, set whenever the response was read.
     * @param response     Receives the response body, NUL-terminated and truncated to fit.
     * @return ESP_OK when a response was received, whatever its status.
     */
    esp_err_t post_json(const char* path, const char* body, int& status_out, char* response, size_t response_cap);

    /// @brief Close the kept-open connection. Safe to call when none is open.
    void end();
}
