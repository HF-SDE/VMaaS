#pragma once
// Receives protocol requests from Main-Controller, drives the motor pins,
// and sends replies. One motor may run at a time.
#include <cstddef>
#include <cstdint>
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "protocol.h"
#include "uart_bus.h"
#include "slot_map.h"

class CommandHandler
{
public:
    CommandHandler(vmaas::UartBus& bus, const SlotPin* slots, size_t count);

    void begin();

    void tick();

private:
    void handle(const vmaas::Frame& f);
    void handle_run(const vmaas::Frame& f);
    void handle_stop(const vmaas::Frame& f);
    void handle_status(const vmaas::Frame& f);
    void handle_config(const vmaas::Frame& f);

    // Returns the GPIO for slot, or GPIO_NUM_NC if the slot is unknown.
    gpio_num_t pin_for(uint8_t slot) const;
    void set_motor(gpio_num_t pin, bool on);

    vmaas::UartBus& bus_;
    const SlotPin* slots_;
    size_t slot_count_;

    vmaas::State state_ = vmaas::State::IDLE;
    uint8_t current_slot_ = 0;
    gpio_num_t current_pin_ = GPIO_NUM_NC;
    TickType_t run_started_ = 0;
    uint16_t run_time_ms_ = 500;
};
