#pragma once
/**
 * @file wiring_sync.h
 * @brief Keeps Motorcontrol's slot table equal to the published wiring.
 *
 * The backend's configuration payload carries a `wiring` block, which
 * config_sync caches in /storage/prices.json. This module sends it to
 * Motorcontrol as WIRING_BEGIN / WIRING_SLOT x n / WIRING_COMMIT
 * (shared/vmaas-protocol/PROTOCOL.md, "Wiring transfer"), using
 * vmaas::WiringSender for the frame order and retries.
 *
 * It is sent on a new configuration, on every boot, and when Motorcontrol
 * reports STATUS ERROR: there is no command to ask Motorcontrol which table it
 * runs, so Main-Controller keeps it in step.
 *
 * Everything except request() and wait_for_result() runs on the main task,
 * which owns the UART. A transfer starts only when purchase_task::idle().
 */
#include <cstddef>
#include <cstdint>
#include "motor_client.h"
#include "protocol.h"

namespace wiring_sync
{
    /// Largest `wiring` block, as rendered JSON, that can be sent. A v2 table
    /// of 32 slots x 6 pins renders to well under this; config_sync refuses a
    /// payload whose wiring does not fit, so it is never reported applied.
    constexpr size_t WIRING_JSON_MAX = 2048;

    /// Why a transfer was asked for. Only NewConfig has a waiter.
    enum class Source : uint8_t
    {
        Boot,
        NewConfig,
        MotorError,
    };

    /// What wait_for_result() tells config_sync.
    enum class Outcome : uint8_t
    {
        Applied,  ///< Motorcontrol ACKed WIRING_COMMIT.
        Rejected, ///< Invalid table, or Motorcontrol refused it MAX_ATTEMPTS times; see detail.
        Pending,  ///< Timed out waiting (the machine stayed busy); the request is still pending.
    };

    /// Call once from app_main after motor.begin(), before tick() or request().
    void begin(MotorClient &motor);

    /**
     * @brief Ask for a transfer. Safe from any task.
     *
     * Requests coalesce into one pending transfer. MotorError is dropped while
     * a transfer is pending or in flight, and when one was accepted less than
     * Config::wiring_error_request_gap_ms ago. NewConfig also clears any stale
     * outcome, so wait_for_result() only reports a transfer started after it.
     */
    void request(Source source);

    /// Main task, every loop pass: starts pending transfers and drives the sender.
    void tick(uint32_t now_ms);

    /// True for WIRING_BEGIN/SLOT/COMMIT: replies main.cpp must route here.
    bool handles(vmaas::Cmd cmd);

    /// Main task: an ACK for a WIRING_* command.
    void on_ack(vmaas::Cmd cmd, uint32_t now_ms);

    /// Main task: a NAK for a WIRING_* command.
    void on_nak(vmaas::Cmd cmd, vmaas::ErrorCode err, uint32_t now_ms);

    /**
     * @brief Block until the NewConfig transfer finishes. config_sync's task only.
     * @param detail Filled with a short reason for Rejected and Pending.
     */
    Outcome wait_for_result(uint32_t timeout_ms, char *detail, size_t detail_len);
}
