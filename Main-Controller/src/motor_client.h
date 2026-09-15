#pragma once
// Typed client for talking to Motorcontrol. Wraps frame building and reply
// dispatch so the rest of Main-Controller never touches raw frames.
#include <cstdint>
#include <functional>
#include "protocol.h"
#include "uart_bus.h"

class MotorClient
{
public:
    using DoneHandler = std::function<void(uint8_t slot)>;
    using NakHandler = std::function<void(vmaas::Cmd rejected, vmaas::ErrorCode error)>;
    using AckHandler = std::function<void(vmaas::Cmd acknowledged)>;
    using StatusHandler = std::function<void(vmaas::State state, uint8_t current_slot)>;

    explicit MotorClient(vmaas::UartBus& bus);

    // Registers the reply handler on the bus. Call once after bus.begin().
    void begin();

    // Each returns false if the frame could not be written to the UART.
    // Replies arrive later through the handlers during bus.poll().
    bool run(uint8_t slot);
    bool stop();
    bool request_status();
    bool config(vmaas::ConfigParam param, uint16_t value);

    void on_done(DoneHandler h) { on_done_ = std::move(h); }
    void on_nak(NakHandler h) { on_nak_ = std::move(h); }
    void on_ack(AckHandler h) { on_ack_ = std::move(h); }
    void on_status(StatusHandler h) { on_status_ = std::move(h); }

private:
    void handle(const vmaas::Frame& f);

    vmaas::UartBus& bus_;
    DoneHandler on_done_;
    NakHandler on_nak_;
    AckHandler on_ack_;
    StatusHandler on_status_;
};
