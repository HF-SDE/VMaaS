#pragma once
/**
 * @file command_handler.h
 * @brief Motorcontrol's request handler: receives protocol requests from
 *        Main-Controller, drives the motor pins, and sends replies.
 */
#include <cstddef>
#include <cstdint>
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "protocol.h"
#include "uart_bus.h"
#include "slot_map.h"

/**
 * @brief Executes RUN/STOP/STATUS/CONFIG requests against the slot pins.
 *
 * One motor may run at a time. A RUN drives the slot's GPIO high, replies
 * ACK, and after run_time_ms the pin goes low again and a DONE is sent.
 * Every request is answered with ACK, NAK or STATUS_REPLY as specified in
 * PROTOCOL.md.
 */
class CommandHandler
{
public:
    /**
     * @brief Bind the handler to a bus and a slot map. Both must outlive the handler.
     * @param bus Transport shared with Main-Controller.
     * @param slots Table mapping slot numbers to GPIOs.
     * @param count Number of entries in @p slots.
     */
    CommandHandler(vmaas::UartBus& bus, const SlotPin* slots, size_t count);

    /**
     * @brief Configure every slot pin as an output driven low and register
     *        the frame handler on the bus.
     *
     * Call once after bus.begin().
     */
    void begin();

    /**
     * @brief Advance the run timer.
     *
     * Call regularly from the main loop. When a running motor has reached
     * its run time this turns the pin off, returns to IDLE and sends DONE.
     * Does nothing while idle.
     */
    void tick();

private:
    void handle(const vmaas::Frame& f);
    void handle_run(const vmaas::Frame& f);
    void handle_stop(const vmaas::Frame& f);
    void handle_status(const vmaas::Frame& f);
    void handle_config(const vmaas::Frame& f);

    /** @brief Get the GPIO for a slot, or GPIO_NUM_NC if the slot is unknown. */
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
