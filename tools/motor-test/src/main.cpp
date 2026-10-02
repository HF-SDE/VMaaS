/**
 * @file main.cpp
 * @brief Bench firmware that spins one DRV8825 on command, so a dead motor or
 *        a miswired driver can be told apart from a bug in the vend logic.
 *
 * It drives the same shared STEP line as the shipped firmware and enables
 * exactly one nENABLE pin at a time. Type commands into the serial monitor;
 * one line in, one line out:
 *
 *     run <pin> <steps>               enable nENABLE <pin>, emit <steps> pulses, disable
 *     slow <pin> <steps> <interval>   the same, at a step interval you choose
 *     stop                            abort now and disable every driver
 *     pins                            list the pins this firmware holds disabled
 *
 *     READY                           once every nENABLE is high
 *     RUN <pin> <steps>               accepted at the shipped speed
 *     SLOW <pin> <steps> <interval>   accepted at your speed
 *     DONE <pin> <steps> <ms>         pulse train finished
 *     STOPPED <pin>                   aborted by command
 *     ERR <reason>                    refused; nothing was driven
 *
 * `run` pulses through Motorcontrol's own StepGenerator, so it reproduces the
 * shipped timing exactly. `slow` cannot use it: that generator's period is
 * fixed when it is constructed. It therefore has its own gptimer here, built
 * the same way, whose period is set per run. Use `slow` to tell "the driver
 * receives no pulses" apart from "the motor cannot keep up", then go back to
 * `run` to test the real thing.
 *
 * The boot order matters and mirrors what Motorcontrol's main.cpp documents:
 * a DRV8825 pulls nENABLE low internally, so every driver is ON from power-on
 * until firmware drives its pin high. Every candidate pin is therefore raised
 * before the STEP line is even configured.
 *
 * Not part of the shipped firmware. Build with: pio run (from tools/motor-test)
 */
#include <cstdio>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "driver/gptimer.h"
#include "driver/uart.h"
#include "esp_attr.h"
#include "soc/gpio_struct.h"
#include "command_parser.h"
#include "config.h"
#include "pins.h"
#include "step_generator.h"

namespace
{
    /// Every ESP32 GPIO that can be driven as an output and is not reserved.
    /// 20, 24 and 28-31 do not exist on this package; 34-39 are input-only.
    constexpr int CANDIDATE_PINS[] = {0, 2, 5, 12, 13, 14, 15, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33};
    constexpr size_t CANDIDATE_COUNT = sizeof(CANDIDATE_PINS) / sizeof(CANDIDATE_PINS[0]);

    /// Matches VendSequencer::ENABLE_SETTLE_TICKS: let the driver wake before pulsing.
    constexpr TickType_t ENABLE_SETTLE = pdMS_TO_TICKS(10);

    constexpr uart_port_t CONSOLE = UART_NUM_0;
    constexpr size_t LINE_CAP = 64;
    constexpr uint32_t TIMER_RESOLUTION_HZ = 1000000; // 1 us per count
    constexpr uint32_t STEP_MASK = 1u << Pins::STEP;

    StepGenerator generator(static_cast<gpio_num_t>(Pins::STEP), Config::STEP_INTERVAL_US);

    int active_pin = -1;          ///< nENABLE pin currently held low, or -1 when idle.
    uint32_t active_steps = 0;
    TickType_t active_started = 0;
    bool active_is_slow = false;  ///< Which pulse source the running command uses.

    // ---- Bench-only variable-rate pulse source -----------------------------
    // Same shape as StepGenerator (1 MHz gptimer, ISR toggles STEP, no driver
    // calls in the ISR), but its period is set per run rather than at
    // construction. It exists only because that is the one thing the shipped
    // generator cannot do, and production must stay untouched.
    //
    // An earlier version pulsed from a task with esp_rom_delay_us and
    // taskYIELD between slices. That starved the idle task, because taskYIELD
    // only yields to equal or higher priority, and the task watchdog fired.
    gptimer_handle_t slow_timer = nullptr;
    bool slow_running = false;    ///< Task-side mirror; gptimer_stop() on a stopped timer errors.
    volatile uint32_t slow_edges = 0;
    volatile bool slow_level = false;
    volatile bool slow_done = true;

    bool IRAM_ATTR slow_alarm(gptimer_handle_t, const gptimer_alarm_event_data_t*, void*)
    {
        if (slow_edges == 0) return false;

        slow_level = !slow_level;
        if (slow_level) GPIO.out_w1ts = STEP_MASK;
        else GPIO.out_w1tc = STEP_MASK;

        const uint32_t remaining = slow_edges - 1;
        slow_edges = remaining;
        if (remaining == 0) slow_done = true;
        return false;
    }

    /// Create and enable the bench timer. STEP itself is configured by generator.begin().
    esp_err_t slow_begin()
    {
        gptimer_config_t cfg = {};
        cfg.clk_src = GPTIMER_CLK_SRC_DEFAULT;
        cfg.direction = GPTIMER_COUNT_UP;
        cfg.resolution_hz = TIMER_RESOLUTION_HZ;
        cfg.intr_priority = 0;
        esp_err_t err = gptimer_new_timer(&cfg, &slow_timer);
        if (err != ESP_OK) return err;

        gptimer_event_callbacks_t cbs = {};
        cbs.on_alarm = &slow_alarm;
        err = gptimer_register_event_callbacks(slow_timer, &cbs, nullptr);
        if (err != ESP_OK) return err;

        return gptimer_enable(slow_timer);
    }

    void slow_stop()
    {
        if (slow_running)
        {
            gptimer_stop(slow_timer);
            slow_running = false;
        }
        slow_edges = 0;
        slow_level = false;
        GPIO.out_w1tc = STEP_MASK;
    }

    void slow_start(uint32_t steps, uint32_t interval_us)
    {
        slow_stop();
        slow_done = (steps == 0);
        if (steps == 0) return;

        gptimer_alarm_config_t alarm = {};
        alarm.alarm_count = interval_us / 2;
        alarm.reload_count = 0;
        alarm.flags.auto_reload_on_alarm = true;
        if (gptimer_set_alarm_action(slow_timer, &alarm) != ESP_OK)
        {
            slow_done = true;
            return;
        }

        slow_edges = steps * 2;
        slow_level = false;
        gptimer_set_raw_count(slow_timer, 0);
        if (gptimer_start(slow_timer) == ESP_OK) slow_running = true;
        else slow_done = true;
    }
    // ------------------------------------------------------------------------

    /// Configure every candidate pin as an output driven HIGH, which is "driver off".
    void disable_all()
    {
        for (size_t i = 0; i < CANDIDATE_COUNT; ++i)
        {
            const gpio_num_t pin = static_cast<gpio_num_t>(CANDIDATE_PINS[i]);
            gpio_set_direction(pin, GPIO_MODE_OUTPUT);
            gpio_set_level(pin, 1);
        }
    }

    bool is_candidate(int pin)
    {
        for (size_t i = 0; i < CANDIDATE_COUNT; ++i)
        {
            if (CANDIDATE_PINS[i] == pin) return true;
        }
        return false;
    }

    /// Raise the running pin and forget it. Safe when nothing is running.
    void release_active()
    {
        if (active_pin < 0) return;
        gpio_set_level(static_cast<gpio_num_t>(active_pin), 1);
        active_pin = -1;
    }

    /// Shared guards for both run commands. Prints why if refused.
    bool may_start(int pin)
    {
        if (active_pin >= 0)
        {
            std::printf("ERR a run is already active on pin %d\n", active_pin);
            return false;
        }
        if (!is_candidate(pin))
        {
            std::printf("ERR GPIO %d is not usable as an output on this board\n", pin);
            return false;
        }
        return true;
    }

    /// Drive the slot's nENABLE low and let the driver wake before any pulse.
    void enable_and_settle(int pin)
    {
        active_pin = pin;
        gpio_set_level(static_cast<gpio_num_t>(pin), 0); // active LOW: driver on
        vTaskDelay(ENABLE_SETTLE);
        active_started = xTaskGetTickCount();
    }

    void do_run(int pin, uint32_t steps)
    {
        if (!may_start(pin)) return;

        active_steps = steps;
        active_is_slow = false;
        enable_and_settle(pin);
        generator.start(steps);
        std::printf("RUN %d %lu\n", pin, static_cast<unsigned long>(steps));
    }

    void do_slow(int pin, uint32_t steps, uint32_t interval_us)
    {
        if (!may_start(pin)) return;

        active_steps = steps;
        active_is_slow = true;
        enable_and_settle(pin);
        slow_start(steps, interval_us);
        std::printf("SLOW %d %lu %lu\n", pin, static_cast<unsigned long>(steps), static_cast<unsigned long>(interval_us));
    }

    void do_stop()
    {
        generator.stop();
        slow_stop();
        if (active_pin >= 0) std::printf("STOPPED %d\n", active_pin);
        else std::printf("STOPPED none\n");
        release_active();
        disable_all();
    }

    void do_pins()
    {
        std::printf("PINS");
        for (size_t i = 0; i < CANDIDATE_COUNT; ++i) std::printf(" %d", CANDIDATE_PINS[i]);
        std::printf("\n");
        std::printf("RESERVED %d %d %d 1 3 6 7 8 9 10 11\n", Pins::STEP, Pins::UART_TX, Pins::UART_RX);
    }

    void handle_line(const char* line)
    {
        const motortest::Command c = motortest::parse_command(line);
        switch (c.kind)
        {
        case motortest::CommandKind::Run:     do_run(c.pin, c.steps); break;
        case motortest::CommandKind::Slow:    do_slow(c.pin, c.steps, c.interval_us); break;
        case motortest::CommandKind::Stop:    do_stop(); break;
        case motortest::CommandKind::Pins:    do_pins(); break;
        case motortest::CommandKind::Empty:   break;
        case motortest::CommandKind::Invalid: std::printf("ERR %s\n", motortest::describe(c.error)); break;
        }
    }

    /// Raise the pin and report timing once the last pulse has gone out.
    void poll_completion()
    {
        if (active_pin < 0) return;
        if (active_is_slow ? !slow_done : !generator.done()) return;

        const uint32_t ms = (xTaskGetTickCount() - active_started) * portTICK_PERIOD_MS;
        const int pin = active_pin;
        release_active();
        if (active_is_slow) slow_stop();
        else generator.stop();
        std::printf("DONE %d %lu %lu\n", pin, static_cast<unsigned long>(active_steps), static_cast<unsigned long>(ms));
    }
}

extern "C" void app_main()
{
    // Before anything else: every driver is on until its pin is driven high.
    disable_all();

    const esp_err_t err = generator.begin();
    if (err != ESP_OK)
    {
        std::printf("ERR step generator failed to start (%d)\n", static_cast<int>(err));
        return;
    }

    const esp_err_t slow_err = slow_begin();
    if (slow_err != ESP_OK)
    {
        std::printf("ERR bench timer failed to start (%d)\n", static_cast<int>(slow_err));
        return;
    }

    uart_driver_install(CONSOLE, 256, 0, 0, nullptr, 0);
    std::printf("READY\n");

    char line[LINE_CAP];
    size_t len = 0;
    while (true)
    {
        uint8_t ch = 0;
        while (uart_read_bytes(CONSOLE, &ch, 1, 0) == 1)
        {
            if (ch == '\n' || ch == '\r')
            {
                line[len] = '\0';
                handle_line(line);
                len = 0;
            }
            else if (len + 1 < LINE_CAP)
            {
                line[len++] = static_cast<char>(ch);
            }
        }

        poll_completion();
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}
