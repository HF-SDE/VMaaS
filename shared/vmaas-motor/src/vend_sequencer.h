#pragma once
/**
 * @file vend_sequencer.h
 * @brief The dispense state machine for Motorcontrol: one RUN in, a fixed
 *        sequence of pin and pulse actions out.
 *
 * Hardware-free. It knows nothing about GPIO, timers or the UART. Same cut as
 * vmaas-purchase: events in, actions out, so the whole sequence is host-tested
 * and Motorcontrol's CommandHandler only has to execute the actions.
 *
 * The motors are steppers on DRV8825 drivers sharing one STEP line, with one
 * nENABLE line per driver. A vend is: enable the slot's drivers, wait one
 * tick so they are awake, emit a fixed number of STEP pulses, disable, DONE.
 */
#include <cstdint>

namespace vmaas
{
    enum class VendState : uint8_t
    {
        Idle,     ///< Nothing running. Every nENABLE is high (disabled).
        Enabling, ///< The slot's drivers are enabled; waiting for the tick counter to advance before the first pulse.
        Stepping, ///< Pulses are being emitted; waiting for the generator to finish.
    };

    /**
     * @brief What the caller must do after handing the sequencer an event.
     *
     * Several fields can be set at once: finishing a vend both stops the
     * generator, disables the drivers and sends DONE.
     */
    struct VendActions
    {
        bool enable_pins = false;  ///< Drive every nENABLE pin of `slot` LOW.
        bool disable_pins = false; ///< Drive every nENABLE pin of `slot` HIGH.
        bool start_steps = false;  ///< Start the step generator for `steps` pulses.
        bool stop_steps = false;   ///< Stop the step generator, whatever it is doing.
        bool send_done = false;    ///< Send DONE for `slot`. Exactly once per run().
        uint8_t slot = 0;          ///< The slot the pin actions refer to.
        uint32_t steps = 0;        ///< Pulses to emit when start_steps is set.
    };

    class VendSequencer
    {
    public:
        /// Ticks the drivers get between enable and the first pulse. The
        /// settle lasts until the tick counter has advanced by one: 0-10 ms
        /// depending on where in the tick RUN arrived. Enough for DRV8825's
        /// nENABLE, which acts in microseconds (the 1.7 ms wake-up applies to
        /// nSLEEP, which is hardwired); the first STEP edge follows another
        /// 156 microseconds after start.
        static constexpr uint32_t ENABLE_SETTLE_TICKS = 1;

        VendState state() const { return state_; }

        /// The slot being vended, or 0 when Idle.
        uint8_t current_slot() const { return state_ == VendState::Idle ? 0 : slot_; }

        /**
         * @brief Begin a vend.
         *
         * The caller has already answered BUSY and UNKNOWN_SLOT, so this is
         * only meaningful in Idle. In any other state it does nothing and
         * returns no actions.
         *
         * @param slot Slot number as sent in RUN.
         * @param steps Pulses to emit (config.json motor.stepsPerVend).
         * @param now_tick Current tick count; the settle delay counts from here.
         */
        VendActions run(uint8_t slot, uint32_t steps, uint32_t now_tick);

        /// STOP from Main-Controller. Idle: no actions. Otherwise: everything off, no DONE.
        VendActions stop();

        /**
         * @brief Call every loop pass.
         * @param now_tick Current tick count. Wrap-around is handled.
         * @param step_done Whether the generator has emitted every pulse since
         *        its last start. Ignored outside Stepping, so a stale flag
         *        from the previous vend cannot finish this one early.
         */
        VendActions tick(uint32_t now_tick, bool step_done);

    private:
        VendActions finish(bool with_done);

        VendState state_ = VendState::Idle;
        uint8_t slot_ = 0;
        uint32_t steps_ = 0;
        uint32_t enabled_at_tick_ = 0;
    };
}
