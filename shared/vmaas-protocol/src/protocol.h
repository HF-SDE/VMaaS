#pragma once
/**
 * @file protocol.h
 * @brief Wire-level definitions for the VMaaS UART command protocol.
 *
 * Shared by Main-Controller and Motorcontrol so both ends compile the same
 * command ids, payload layouts and frame constructors. See PROTOCOL.md in
 * this folder for the byte-level specification and message flows.
 *
 * @note This header must stay free of any ESP-IDF or FreeRTOS include so it
 *       can be unit-tested on the host.
 */

#include <cstddef>
#include <cstdint>

/// Everything shared between the two ESP32 firmwares lives in this namespace.
namespace vmaas
{
    /// First byte of every frame. May also appear inside a payload; resync relies on the CRC.
    constexpr uint8_t FRAME_START = 0xAA;

    /// Maximum number of payload bytes a frame may carry.
    constexpr uint8_t MAX_PAYLOAD = 8;

    /// Largest possible encoded frame: START + LEN + CMD + CRC (4 fixed bytes) plus the payload.
    constexpr size_t MAX_FRAME_SIZE = 4 + MAX_PAYLOAD;

    constexpr uint8_t WIRING_MAX_PINS = 6; ///< Pins per WIRING_SLOT: 8 payload bytes minus slot and pin_count.

    /**
     * @brief Command id carried in the CMD byte of a frame.
     *
     * Requests are sent by Main-Controller and have ids below 0x80. Replies
     * are sent by Motorcontrol and have ids of 0x80 or above; see is_reply().
     */
    enum class Cmd : uint8_t
    {
        // Requests, Main-Controller -> Motorcontrol

        // TODO(pgu): Write one @brief per value below. Describe what the command
        // asks Motorcontrol to do and name the payload (from the tables in
        // PROTOCOL.md). One line each, e.g.:
        //   /// @brief Start the motor for one slot. Payload: slot u8.
        RUN = 0x10,
        STOP = 0x11,
        STATUS = 0x12,
        CONFIG = 0x13,
        WIRING_BEGIN = 0x14,  ///< Start a wiring transfer; clears the staging buffer. No payload.
        WIRING_SLOT = 0x15,   ///< One slot: slot u8, pin_count u8, pins u8[pin_count] (pin_count <= WIRING_MAX_PINS).
        WIRING_COMMIT = 0x16, ///< Finish: count u8 (slots sent), steps_per_vend u16 LE. Validates, writes config.json, applies.

        // Replies, Motorcontrol -> Main-Controller
        ACK = 0x80,
        NAK = 0x81,
        DONE = 0x82,
        STATUS_REPLY = 0x83,
    };

    /**
     * @brief Reason code carried in the second payload byte of a NAK reply.
     */
    enum class ErrorCode : uint8_t
    {
        UNKNOWN_CMD = 1,  ///< CMD byte is not a known request.
        BAD_PAYLOAD = 2,  ///< LEN does not match what the CMD requires.
        BUSY = 3,         ///< RUN, or WIRING_COMMIT, received while a vend is in progress.
        UNKNOWN_SLOT = 4, ///< Slot is not present in Motorcontrol's slot map.
        BAD_PARAM = 5,    ///< CONFIG param id is not recognised (no params are defined).
        CONFIG_ERROR = 6, ///< Motorcontrol has no valid slot configuration (config.json) and refuses RUN/STOP/CONFIG.
        WIRING_STATE = 7, ///< WIRING_SLOT or WIRING_COMMIT without a preceding WIRING_BEGIN, or after the 10 s staging timeout.
        WIRING_FULL = 8,  ///< More than MAX_SLOTS slots staged.
        WRITE_FAILED = 9, ///< The staged table did not validate, uses a reserved pin, or config.json could not be written.
    };

    /**
     * @brief Motorcontrol run state, reported in STATUS_REPLY.
     */
    enum class State : uint8_t
    {
        IDLE = 0,  ///< No motor running. STATUS_REPLY reports current_slot 0.
        BUSY = 1,  ///< A vend is in progress; current_slot names it.
        ERROR = 2, ///< Motorcontrol has no valid slot configuration. current_slot is 0. Every RUN/STOP/CONFIG is answered NAK CONFIG_ERROR; WIRING_* is accepted so the table can be repaired without a reflash.
    };

    /**
     * @brief Parameter id in the first payload byte of a CONFIG request.
     *
     * Empty since the stepper redesign: the only parameter, RUN_TIME_MS, was
     * replaced by motor.stepsPerVend in Motorcontrol's config.json, which the
     * backend publishes. The CONFIG opcode and its 3-byte layout (param u8,
     * value u16 LE) are kept reserved; Motorcontrol answers every param with
     * NAK BAD_PARAM.
     */
    enum class ConfigParam : uint8_t
    {
    };

    /**
     * @brief A decoded protocol frame.
     *
     * START and CRC are handled by the codec (see frame_codec.h); a Frame
     * only carries the command and its payload. Use the constructors in
     * vmaas::frames instead of filling the fields by hand.
     */
    struct Frame
    {
        Cmd cmd = Cmd::STATUS;            ///< Command id.
        uint8_t len = 0;                  ///< Number of valid bytes in payload, 0..MAX_PAYLOAD.
        uint8_t payload[MAX_PAYLOAD] = {}; ///< Command-specific bytes. Multi-byte values are little-endian.
    };

    /**
     * @brief Tell whether a command id is a reply (Motorcontrol -> Main-Controller).
     * @param c Command id to classify.
     * @return true for replies (id >= 0x80), false for requests.
     */
    constexpr bool is_reply(Cmd c)
    {
        return static_cast<uint8_t>(c) >= 0x80;
    }

    /**
     * @brief Constructors for every frame in the protocol.
     *
     * Each function returns a fully populated Frame with the correct cmd,
     * len and payload layout, so callers never touch payload bytes directly.
     */
    namespace frames
    {
        /**
         * @brief Build a RUN request.
         * @param slot Slot whose motor should run.
         */
        inline Frame run(uint8_t slot)
        {
            Frame f;
            f.cmd = Cmd::RUN;
            f.len = 1;
            f.payload[0] = slot;
            return f;
        }

        /// @brief Build a STOP request. No payload.
        inline Frame stop()
        {
            Frame f;
            f.cmd = Cmd::STOP;
            return f;
        }

        /// @brief Build a STATUS request. No payload.
        inline Frame status()
        {
            Frame f;
            f.cmd = Cmd::STATUS;
            return f;
        }

        /// @brief Build a WIRING_BEGIN request. No payload.
        inline Frame wiring_begin()
        {
            Frame f;
            f.cmd = Cmd::WIRING_BEGIN;
            return f;
        }

        /**
         * @brief Build a WIRING_SLOT request.
         * @param slot Slot number, 1-255.
         * @param pins nENABLE GPIOs of the slot's drivers.
         * @param pin_count Entries in @p pins; more than WIRING_MAX_PINS are dropped.
         *        Callers must check pin_count <= WIRING_MAX_PINS first: extra pins are dropped silently.
         */
        inline Frame wiring_slot(uint8_t slot, const uint8_t* pins, uint8_t pin_count)
        {
            Frame f;
            f.cmd = Cmd::WIRING_SLOT;
            const uint8_t n = pin_count > WIRING_MAX_PINS ? WIRING_MAX_PINS : pin_count;
            f.len = static_cast<uint8_t>(2 + n);
            f.payload[0] = slot;
            f.payload[1] = n;
            for (uint8_t i = 0; i < n; ++i) f.payload[2 + i] = pins[i];
            return f;
        }

        /**
         * @brief Build a WIRING_COMMIT request.
         * @param count Number of slots in the table, each sent once in a WIRING_SLOT.
         * @param steps_per_vend STEP pulses per vend, 1-65535 (config.json motor.stepsPerVend).
         */
        inline Frame wiring_commit(uint8_t count, uint16_t steps_per_vend)
        {
            Frame f;
            f.cmd = Cmd::WIRING_COMMIT;
            f.len = 3;
            f.payload[0] = count;
            f.payload[1] = static_cast<uint8_t>(steps_per_vend & 0xFF);
            f.payload[2] = static_cast<uint8_t>(steps_per_vend >> 8);
            return f;
        }

        /**
         * @brief Build an ACK reply.
         * @param acknowledged The request being accepted.
         */
        inline Frame ack(Cmd acknowledged)
        {
            Frame f;
            f.cmd = Cmd::ACK;
            f.len = 1;
            f.payload[0] = static_cast<uint8_t>(acknowledged);
            return f;
        }

        /**
         * @brief Build a NAK reply.
         * @param rejected The request being refused.
         * @param error Why it was refused.
         */
        inline Frame nak(Cmd rejected, ErrorCode error)
        {
            Frame f;
            f.cmd = Cmd::NAK;
            f.len = 2;
            f.payload[0] = static_cast<uint8_t>(rejected);
            f.payload[1] = static_cast<uint8_t>(error);
            return f;
        }

        /**
         * @brief Build a DONE reply.
         * @param slot Slot whose motor has finished its run.
         */
        inline Frame done(uint8_t slot)
        {
            Frame f;
            f.cmd = Cmd::DONE;
            f.len = 1;
            f.payload[0] = slot;
            return f;
        }

        /**
         * @brief Build a STATUS_REPLY.
         * @param state Current run state.
         * @param current_slot Slot currently running, or 0 when idle.
         */
        inline Frame status_reply(State state, uint8_t current_slot)
        {
            Frame f;
            f.cmd = Cmd::STATUS_REPLY;
            f.len = 2;
            f.payload[0] = static_cast<uint8_t>(state);
            f.payload[1] = current_slot;
            return f;
        }
    } // namespace frames
} // namespace vmaas
