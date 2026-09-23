#pragma once
/**
 * @file step_generator.h
 * @brief Emits a fixed number of STEP pulses on the shared line from a
 *        hardware timer, so the main loop and the UART stay free during a vend.
 */
#include <cstdint>
#include "driver/gpio.h"
#include "driver/gptimer.h"
#include "esp_err.h"

/**
 * @brief What CommandHandler needs from a pulse source. Split out so the
 *        handler can be exercised with a fake on the host later.
 */
class IStepGenerator
{
public:
    virtual ~IStepGenerator() = default;
    /// Begin emitting @p steps pulses. STEP is low on entry and after the last pulse.
    virtual void start(uint32_t steps) = 0;
    /// Stop now and drive STEP low. Safe in any state, including never started.
    virtual void stop() = 0;
    /// True once every pulse of the last start() has been emitted. Stays true until the next start().
    virtual bool done() const = 0;
};

/**
 * @brief gptimer-driven implementation of IStepGenerator.
 *
 * One general-purpose timer at 1 MHz fires an alarm every half period. The
 * ISR toggles STEP and counts edges down. When the count reaches zero STEP is
 * low (an even number of edges always ends low) and `done` is set; the ISR
 * then does nothing until stop() is called from task context, which is the
 * only place the timer is stopped. That keeps the ISR free of driver calls:
 * it writes two GPIO registers and three fields, nothing else.
 */
class StepGenerator : public IStepGenerator
{
public:
    /**
     * @param step_pin GPIO of the shared STEP line. Must be 0-31.
     * @param interval_us Full STEP period; the alarm fires every interval_us / 2.
     */
    StepGenerator(gpio_num_t step_pin, uint32_t interval_us);

    /**
     * @brief Configure the GPIO as output low and create, arm and enable the timer.
     * Call once. The timer is enabled but not running until start().
     */
    esp_err_t begin();

    void start(uint32_t steps) override;
    void stop() override;
    bool done() const override { return done_; }

private:
    static bool on_alarm(gptimer_handle_t timer, const gptimer_alarm_event_data_t* edata, void* ctx);

    gpio_num_t pin_;
    uint32_t pin_mask_; ///< 0 until begin() validates pin_ and computes 1u << pin_; unset before then.
    uint32_t half_period_us_;
    gptimer_handle_t timer_ = nullptr;
    bool running_ = false; ///< Task-side mirror of the timer state; gptimer_stop() on a stopped timer is an error.

    // Written by the ISR while the timer runs; written by start()/stop() only with it stopped.
    volatile uint32_t remaining_edges_ = 0;
    volatile bool level_ = false;
    volatile bool done_ = false;
};
