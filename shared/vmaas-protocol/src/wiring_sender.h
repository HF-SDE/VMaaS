#pragma once
/**
 * @file wiring_sender.h
 * @brief Main-Controller's side of the wiring transfer, as a pure state machine.
 *
 * Decides which WIRING_* frame goes out next from the replies Motorcontrol
 * sends back, following the sender rules in PROTOCOL.md ("Wiring transfer"):
 * one frame at a time, wait for its reply; after any NAK other than BUSY,
 * start again from WIRING_BEGIN; after NAK BUSY on COMMIT keep the staging
 * and retry COMMIT while inside Motorcontrol's 10 s staging window.
 *
 * No UART, no clock, no heap: the caller passes the time in and sends the
 * frame a WiringStep carries. That is what lets it run under platform = native.
 *
 * @note Free of ESP-IDF includes, like protocol.h.
 */
#include <cstdint>
#include "protocol.h"

namespace vmaas
{
    /// Largest table the sender takes. Matches Motorcontrol's MAX_SLOTS.
    constexpr uint8_t WIRING_MAX_ROWS = 32;

    /// One slot of the table: the slot number and its nENABLE pins.
    struct WiringRow
    {
        uint8_t slot;                     ///< Slot number, 1-255.
        uint8_t pin_count;                ///< Valid entries in pins, 1..WIRING_MAX_PINS.
        uint8_t pins[WIRING_MAX_PINS];    ///< nENABLE GPIOs.
    };

    /// The table to send. Its own type so this library does not depend on vmaas-config.
    struct WiringTable
    {
        uint16_t steps_per_vend;          ///< Sent in WIRING_COMMIT. Must not be 0.
        uint8_t row_count;                ///< Valid entries in rows, 1..WIRING_MAX_ROWS.
        WiringRow rows[WIRING_MAX_ROWS];  ///< Sent in this order.
    };

    /// Why a transfer failed.
    enum class WiringFailure : uint8_t
    {
        None,     ///< Not failed.
        BadTable, ///< start() refused the table; nothing was sent.
        NoReply,  ///< The last attempt ended with no reply within REPLY_TIMEOUT_MS.
        Nak,      ///< The last attempt ended with a NAK; see WiringStep::nak.
    };

    /// What the caller must do next.
    struct WiringStep
    {
        enum class Kind : uint8_t
        {
            Wait,   ///< Nothing to send now.
            Send,   ///< Send `frame`.
            Done,   ///< Motorcontrol ACKed WIRING_COMMIT: the table is written and applied.
            Failed, ///< Gave up; see `failure`.
        };

        Kind kind = Kind::Wait;
        Frame frame{};                              ///< Valid when kind == Send.
        WiringFailure failure = WiringFailure::None; ///< Valid when kind == Failed.
        ErrorCode nak = ErrorCode::UNKNOWN_CMD;      ///< Valid when failure == Nak.
    };

    /**
     * @brief Sends one wiring table, with retries.
     *
     * Usage: start(), send the frame it returns, then feed every ACK and NAK
     * into on_ack()/on_nak() and call tick() every loop pass; send each Send
     * step's frame; stop at Done or Failed. A reply for any command other
     * than the one awaited is ignored, so STATUS replies and a concurrent
     * RUN's ACK pass straight through. An attempt is one run from
     * WIRING_BEGIN; MAX_ATTEMPTS attempts are made before Failed.
     */
    class WiringSender
    {
    public:
        static constexpr uint32_t REPLY_TIMEOUT_MS = 500; ///< No reply this long ends the attempt.
        static constexpr uint32_t BUSY_RETRY_MS = 500;    ///< Gap before COMMIT is retried after NAK BUSY.
        static constexpr uint32_t BUSY_GIVE_UP_MS = 8000; ///< BUSY this long after the first one ends the attempt (Motorcontrol drops staging at 10 s).
        static constexpr uint8_t MAX_ATTEMPTS = 3;        ///< Attempts before Failed.

        /// Begin a transfer, replacing any in progress. Returns Send(WIRING_BEGIN), or Failed(BadTable).
        WiringStep start(const WiringTable& table, uint32_t now_ms);
        /// Feed an ACK reply.
        WiringStep on_ack(Cmd acked, uint32_t now_ms);
        /// Feed a NAK reply.
        WiringStep on_nak(Cmd rejected, ErrorCode err, uint32_t now_ms);
        /// Call every loop pass: reply timeouts and BUSY retries happen here.
        WiringStep tick(uint32_t now_ms);

        /// True from start() until Done or Failed.
        bool busy() const { return phase_ != Phase::Idle; }
        /// The current attempt, 1..MAX_ATTEMPTS; 0 before the first start().
        uint8_t attempt() const { return attempts_; }

    private:
        enum class Phase : uint8_t
        {
            Idle,     ///< Nothing in progress.
            Awaiting, ///< A frame is out; awaiting_ is its command.
            BusyWait, ///< COMMIT got NAK BUSY; waiting BUSY_RETRY_MS before retrying it.
        };

        WiringStep send(const Frame& f, uint32_t now_ms);
        WiringStep send_begin(uint32_t now_ms);
        WiringStep send_row(uint32_t now_ms);
        WiringStep send_commit(uint32_t now_ms);
        WiringStep restart(uint32_t now_ms, WiringFailure why, ErrorCode nak);
        static WiringStep wait() { return WiringStep{}; }

        WiringTable table_{};
        Phase phase_ = Phase::Idle;
        Cmd awaiting_ = Cmd::WIRING_BEGIN;
        uint8_t next_row_ = 0;
        uint8_t attempts_ = 0;
        uint32_t sent_at_ms_ = 0;
        uint32_t busy_wait_from_ms_ = 0;
        bool busy_seen_ = false;
        uint32_t busy_first_ms_ = 0;
    };
}
