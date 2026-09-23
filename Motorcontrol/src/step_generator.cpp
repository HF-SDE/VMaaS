/**
 * @file step_generator.cpp
 * @brief gptimer ISR pulse source. See step_generator.h.
 */
#include "step_generator.h"

#include "esp_attr.h"
#include "esp_log.h"
#include "soc/gpio_struct.h"

namespace
{
    constexpr const char* TAG = "StepGen";
    constexpr uint32_t TIMER_RESOLUTION_HZ = 1000000; // 1 us per count
}

StepGenerator::StepGenerator(gpio_num_t step_pin, uint32_t interval_us)
    : pin_(step_pin), pin_mask_(0), half_period_us_(interval_us / 2)
{
}

esp_err_t StepGenerator::begin()
{
    if (static_cast<int>(pin_) < 0 || static_cast<int>(pin_) > 31)
    {
        ESP_LOGE(TAG, "STEP pin %d must be 0-31 for direct register writes", static_cast<int>(pin_));
        return ESP_ERR_INVALID_ARG;
    }
    if (half_period_us_ < 2)
    {
        ESP_LOGE(TAG, "interval too short: DRV8825 needs >= 1.9 us per level");
        return ESP_ERR_INVALID_ARG;
    }
    pin_mask_ = 1u << static_cast<uint32_t>(pin_);

    // gpio_config, not gpio_reset_pin: reset restores the pin's default state,
    // which for STEP enables the internal pull-up and gives the driver one
    // spurious rising edge before we can drive the level ourselves.
    gpio_config_t io_conf = {};
    io_conf.pin_bit_mask = 1ULL << static_cast<uint32_t>(pin_);
    io_conf.mode = GPIO_MODE_OUTPUT;
    io_conf.pull_up_en = GPIO_PULLUP_DISABLE;
    io_conf.pull_down_en = GPIO_PULLDOWN_DISABLE;
    io_conf.intr_type = GPIO_INTR_DISABLE;
    esp_err_t io_err = gpio_config(&io_conf);
    if (io_err != ESP_OK) return io_err;
    GPIO.out_w1tc = pin_mask_;

    gptimer_config_t cfg = {};
    cfg.clk_src = GPTIMER_CLK_SRC_DEFAULT;
    cfg.direction = GPTIMER_COUNT_UP;
    cfg.resolution_hz = TIMER_RESOLUTION_HZ;
    cfg.intr_priority = 0;
    esp_err_t err = gptimer_new_timer(&cfg, &timer_);
    if (err != ESP_OK) return err;

    gptimer_event_callbacks_t cbs = {};
    cbs.on_alarm = &StepGenerator::on_alarm;
    err = gptimer_register_event_callbacks(timer_, &cbs, this);
    if (err != ESP_OK) return err;

    gptimer_alarm_config_t alarm = {};
    alarm.alarm_count = half_period_us_;
    alarm.reload_count = 0;
    alarm.flags.auto_reload_on_alarm = true;
    err = gptimer_set_alarm_action(timer_, &alarm);
    if (err != ESP_OK) return err;

    err = gptimer_enable(timer_);
    if (err != ESP_OK) return err;

    ESP_LOGI(TAG, "STEP on GPIO %d, %lu us period (%lu us alarm)", static_cast<int>(pin_), static_cast<unsigned long>(half_period_us_ * 2), static_cast<unsigned long>(half_period_us_));
    return ESP_OK;
}

void StepGenerator::start(uint32_t steps)
{
    stop();
    remaining_edges_ = steps * 2;
    level_ = false;
    done_ = (steps == 0);
    if (steps == 0) return;

    gptimer_set_raw_count(timer_, 0);
    if (gptimer_start(timer_) == ESP_OK) {
        running_ = true;
    }
    else {
        ESP_LOGE(TAG, "timer did not start");
        done_ = true;
    }
}

void StepGenerator::stop()
{
    if (running_)
    {
        gptimer_stop(timer_);
        running_ = false;
    }
    remaining_edges_ = 0;
    level_ = false;
    GPIO.out_w1tc = pin_mask_;
}

// ISR context. No driver calls, no logging, no allocation.
bool IRAM_ATTR StepGenerator::on_alarm(gptimer_handle_t, const gptimer_alarm_event_data_t*, void* ctx)
{
    StepGenerator* self = static_cast<StepGenerator*>(ctx);
    if (self->remaining_edges_ == 0) return false;

    self->level_ = !self->level_;
    if (self->level_) {
        GPIO.out_w1ts = self->pin_mask_;
    }
    else {
        GPIO.out_w1tc = self->pin_mask_;
    }

    uint32_t remaining = self->remaining_edges_ - 1;
    self->remaining_edges_ = remaining;
    if (remaining == 0) {
        self->done_ = true;
    }
    return false;
}
