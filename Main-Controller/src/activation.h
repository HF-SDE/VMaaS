#pragma once
/**
 * @file activation.h
 * @brief Turning a one-time setup code into a client certificate.
 *
 * The machine generates its own EC P-256 key, asks the platform to sign a CSR
 * for it, and keeps the answer in NVS. The private key is created on the device
 * and never leaves it; what travels is a certificate request and, back, a
 * certificate.
 *
 * Everything here blocks and expects to run from the onboarding task, not from
 * an event handler.
 *
 * @note NVS is not encrypted unless flash encryption is enabled, and it is not.
 *       Someone with physical access and a USB cable can read the private key
 *       out of a machine. Flash encryption is a separate decision with its own
 *       cost in field debugging, and is deliberately out of scope here.
 */
#include <cstddef>
#include <cstdint>

#include "esp_err.h"

/// Device activation against the platform API.
namespace activation
{
    /// Longest identifier the platform hands back, plus NUL. UUIDs are 36.
    constexpr size_t ID_MAX = 64;

    /// "v1/{tenantId}/{siteId}/{machineId}" is three UUIDs and three slashes.
    constexpr size_t TOPIC_PREFIX_MAX = 128;

    constexpr size_t HOST_MAX = 64;

    /**
     * @brief How many rejections in a row before the machine stops offering a retry.
     *
     * The platform allows ten attempts against one activation row and then
     * refuses that code for good, so a technician who keeps retyping would
     * eventually be locked out without ever being told. Stopping earlier turns
     * that into an instruction - claim the machine again - while there are
     * still attempts left to spend on the new code.
     *
     * This is a device-side policy, not something the platform reports: see
     * the note on Result::CodeExpired.
     */
    constexpr int MAX_REJECTIONS = 5;

    /// What an activation attempt did, in the terms the display cares about.
    enum class Result : uint8_t
    {
        Ok,
        /// The platform refused the code. Type a different one.
        CodeRejected,
        /**
         * Give up on codes: only a fresh claim helps now.
         *
         * @note Inferred here, not reported by the platform. Its /activate
         *       endpoint answers every rejection - wrong code, expired code,
         *       attempts exhausted, disabled machine - with the same
         *       `400 {"error":"Activation rejected"}`, on purpose, so that a
         *       prober cannot learn which machine ids and codes exist. The
         *       device therefore counts its own consecutive rejections and
         *       reports this once it reaches MAX_REJECTIONS.
         */
        CodeExpired,
        /// Transport, TLS or a 5xx. The code itself is probably fine.
        Unreachable,
    };

    /// Identity and broker address the platform returned, as stored in NVS.
    struct Identity
    {
        char     tenant_id[ID_MAX];
        char     site_id[ID_MAX];
        char     machine_id[ID_MAX];
        char     topic_prefix[TOPIC_PREFIX_MAX];
        char     mqtt_host[HOST_MAX];
        uint16_t mqtt_port;
    };

    /**
     * @brief Whether this machine already holds a certificate.
     *
     * The single test for "activated". Nothing else is consulted: a machine
     * with a stored certificate is one the platform has signed for.
     */
    bool has_certificate();

    /**
     * @brief Get the clock good enough for TLS.
     *
     * A certificate's notBefore/notAfter cannot be checked without a real
     * date, and an ESP32 boots in 1970. A handshake that fails for that reason
     * reports something that looks nothing like a clock problem, so this runs
     * first and its failure is reported as itself.
     *
     * @param timeout_ms How long to wait for the first SNTP answer.
     * @return ESP_OK once the system clock is past 2020.
     */
    esp_err_t sync_time(uint32_t timeout_ms);

    /**
     * @brief Generate a key if needed, request a certificate, store the answer.
     *
     * Blocks for the length of one HTTPS round trip. On Result::Ok everything
     * in Identity plus the certificate, the CA and the private key are in NVS
     * and survive a power cycle.
     *
     * @param api_base_url e.g. "https://vmaas.dk/api". Must not be empty.
     * @param machine_id   The machine's id from config.json. Must not be empty.
     * @param code         The setup code, exactly as typed.
     * @return What happened, in the terms the display cares about.
     */
    Result activate(const char* api_base_url, const char* machine_id, const char* code);

    /**
     * @brief Read back what activate() stored.
     * @param out Filled only on ESP_OK; untouched otherwise.
     * @return ESP_ERR_NVS_NOT_FOUND when this machine has never been activated.
     */
    esp_err_t load_identity(Identity& out);

    /// What a renewal attempt did.
    enum class RenewResult : uint8_t
    {
        /// A certificate for our key came back; store_renewed() puts it in NVS.
        Ok,
        /// The platform answered, but not with a certificate for our key.
        Rejected,
        /// Transport, TLS or a 5xx. Worth trying again later.
        Unreachable,
    };

    /// Room for the PEMs renew() hands back.
    constexpr size_t RENEWED_CERT_MAX = 2048;
    constexpr size_t RENEWED_CA_MAX = 2560;

    /**
     * @brief The stored certificate's validity window, in UTC seconds.
     * @return ESP_ERR_NVS_NOT_FOUND when there is no certificate,
     *         ESP_ERR_INVALID_RESPONSE when it does not parse.
     */
    esp_err_t certificate_validity(int64_t& not_before, int64_t& not_after);

    /**
     * @brief Ask the platform for a new certificate for the existing key.
     *
     * Authenticates with the current certificate, so it has to run while that
     * one is still valid. Never generates a key, and stores nothing: the
     * certificate is checked against the key and handed back.
     *
     * Storing is left to the caller because device_api reads the certificate
     * from NVS on every request. The platform revokes the old certificate the
     * first time it sees the new one, so a new certificate in NVS would cut off
     * the broker session and api_client, which still hold the old one, for as
     * long as the machine waits to restart.
     *
     * @param cert_out Receives the certificate PEM, RENEWED_CERT_MAX bytes.
     * @param ca_out   Receives the CA PEM, RENEWED_CA_MAX bytes.
     */
    RenewResult renew(char* cert_out, char* ca_out);

    /// @brief Replace the stored certificate and CA with what renew() returned.
    esp_err_t store_renewed(const char* cert, const char* ca);

    /**
     * @brief Read the stored device certificate, private key or broker CA.
     *
     * Subsystem B needs all three to open an mTLS connection to the broker.
     *
     * @param out     Receives a NUL-terminated PEM.
     * @param out_len Size of out.
     * @return ESP_ERR_NVS_NOT_FOUND when absent, ESP_ERR_NVS_INVALID_LENGTH
     *         when out is too small.
     */
    esp_err_t load_certificate(char* out, size_t out_len);
    esp_err_t load_private_key(char* out, size_t out_len);
    esp_err_t load_broker_ca(char* out, size_t out_len);
}
