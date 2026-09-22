#pragma once
/**
 * @file service_code.h
 * @brief Recognises the service code that releases the front door.
 *
 * Sits in front of SlotEntry in the key path. While it is idle it claims
 * nothing, so the purchase flow behaves exactly as it does without it. A
 * leading '*' starts collection; digits accumulate in a private buffer; '#'
 * submits; '*' backspaces and, on an empty buffer, gives up.
 *
 * The buffer is only ever readable masked. The typed digits never leave this
 * object, so no caller can put them on the display or in a log line.
 *
 * Knows nothing about GPIO or FreeRTOS: the door itself is somebody else's job.
 */
#include <cstdint>
#include "key_event.h"

namespace vmaas
{
    /// Digits a service code may have.
    inline constexpr uint8_t SERVICE_CODE_MAX_DIGITS = 8;

    /// Inactivity before a half-typed code is discarded, in milliseconds.
    inline constexpr uint32_t SERVICE_CODE_TIMEOUT_MS = 15000;

    /// What the recogniser is doing, in the terms the display cares about.
    enum class ServiceStatus : uint8_t
    {
        Idle,       ///< Not collecting. Keys belong to the purchase flow.
        Collecting, ///< A code is being typed.
        Accepted,   ///< The submitted code matched. Reported once.
        Rejected,   ///< The submitted code did not match. Reported once.
        TimedOut,   ///< A half-typed code was discarded. Reported once.
    };

    /// Result of feeding one key event.
    struct ServiceState
    {
        ServiceStatus status;
        /**
         * @brief Whether this event belonged to the service flow.
         *
         * false means the caller must forward the event to SlotEntry, which is
         * how a purchase stays untouched. Released events are never consumed.
         */
        bool consumed;
        uint8_t length;                          ///< Digits typed so far.
        char masked[SERVICE_CODE_MAX_DIGITS + 1]; ///< One '*' per digit, NUL-terminated.
    };

    /// Recognises '*' digits '#' and compares the result against a configured code.
    class ServiceCode
    {
    public:
        explicit ServiceCode(uint32_t timeout_ms = SERVICE_CODE_TIMEOUT_MS);

        /**
         * @brief Set the code that opens the door.
         * @param code NUL-terminated digits. "" disables the recogniser entirely:
         *             it then consumes nothing and always reports Idle.
         */
        void set_code(const char* code);

        /// @brief Change the inactivity timeout. 0 disables it.
        void set_timeout_ms(uint32_t timeout_ms) { timeout_ms_ = timeout_ms; }

        /// @brief Feed one key event. Released events are accepted and ignored.
        ServiceState handle(const KeyEvent& ev);

        /// @brief Advance the timeout. Reports TimedOut once when it expires.
        ServiceState tick(uint32_t now_ms);

        /// @brief Empty the buffer and stop collecting.
        void reset();

        /// @return true while a code is being typed. For callers that must not log keys.
        bool collecting() const { return collecting_; }

    private:
        ServiceState snapshot(ServiceStatus status, bool consumed) const;

        char code_[SERVICE_CODE_MAX_DIGITS + 1] = {};
        char buffer_[SERVICE_CODE_MAX_DIGITS + 1] = {};
        uint8_t length_ = 0;
        bool collecting_ = false;
        uint32_t timeout_ms_;
        uint32_t last_key_ms_ = 0;
    };
}
