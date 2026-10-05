#pragma once
/**
 * @file motor_client.h
 * @brief Typed client for talking to Motorcontrol from Main-Controller.
 *
 * Wraps frame building and reply dispatch so the rest of Main-Controller
 * never touches raw vmaas::Frame objects.
 */
#include <cstdint>
#include <functional>
#include "protocol.h"
#include "uart_bus.h"

/**
 * @brief Request/reply facade over a vmaas::UartBus.
 *
 * Requests are fire-and-forget: each send method returns as soon as the
 * frame is written. Replies arrive asynchronously through the registered
 * handlers while the owner calls bus.poll(). Frames with a payload length
 * that does not match PROTOCOL.md are logged and ignored.
 *
 * @section motorclient_handlers Handlers
 *
 * Each reply type has exactly one handler slot. Registering a handler
 * replaces whatever was registered before; handlers are not chained the way
 * `addEventListener` or C# `event +=` would chain them. In the example below
 * only the MQTT publish runs, the log line is silently dropped:
 *
 * @code
 * motor.on_done([](uint8_t slot) { ESP_LOGI(TAG, "slot %u done", slot); });
 * motor.on_done([](uint8_t slot) { publish_mqtt(slot); });   // replaces the first
 * @endcode
 *
 * To do more than one thing at a time, do it inside a single handler:
 *
 * @code
 * motor.on_done([](uint8_t slot) {
 *     ESP_LOGI(TAG, "slot %u done", slot);
 *     publish_mqtt(slot);
 * });
 * @endcode
 *
 * A reply with no handler registered is ignored. Handlers run on the task
 * that calls bus.poll(), so keep them short and do not call poll() from
 * inside one.
 */
class MotorClient
{
public:
    /// Used when Motorcontrol reports that a slot's motor run has finished.
    using DoneHandler = std::function<void(uint8_t slot)>;
    /// Used when Motorcontrol rejects a request, with the reason.
    using NakHandler = std::function<void(vmaas::Cmd rejected, vmaas::ErrorCode error)>;
    /// Used when Motorcontrol accepts a request.
    using AckHandler = std::function<void(vmaas::Cmd acknowledged)>;
    /// Used with the answer to request_status().
    using StatusHandler = std::function<void(vmaas::State state, uint8_t current_slot)>;

    /**
     * @brief Bind the client to a bus. The bus must outlive the client.
     * @param bus Transport shared with Motorcontrol.
     */
    explicit MotorClient(vmaas::UartBus& bus);

    /// @brief Register the reply handler on the bus. Call once after bus.begin().
    void begin();

    /**
     * @brief Ask Motorcontrol to run one slot's motor.
     * @param slot Slot number as defined in Motorcontrol's slot map.
     * @return false if the frame could not be written to the UART.
     */
    bool run(uint8_t slot);

    /**
     * @brief Ask Motorcontrol to stop the running motor, if any.
     * @return false if the frame could not be written to the UART.
     */
    bool stop();

    /**
     * @brief Ask Motorcontrol for its state. The answer arrives via on_status().
     * @return false if the frame could not be written to the UART.
     */
    bool request_status();

    /**
     * @brief Send an already built request frame, for the WIRING_* transfer.
     * @param f Frame from vmaas::frames.
     * @return false if the frame could not be written to the UART.
     */
    bool send(const vmaas::Frame& f);

    /// @brief Register the DONE handler. Replaces any previous one, see @ref motorclient_handlers "motorclient_handlers".
    void on_done(DoneHandler h) { on_done_ = std::move(h); }
    /// @brief Register the NAK handler. Replaces any previous one, see @ref motorclient_handlers "motorclient_handlers".
    void on_nak(NakHandler h) { on_nak_ = std::move(h); }
    /// @brief Register the ACK handler. Replaces any previous one, see @ref motorclient_handlers "motorclient_handlers".
    void on_ack(AckHandler h) { on_ack_ = std::move(h); }
    /// @brief Register the STATUS_REPLY handler. Replaces any previous one, see @ref motorclient_handlers "motorclient_handlers".
    void on_status(StatusHandler h) { on_status_ = std::move(h); }

private:
    void handle(const vmaas::Frame& f);

    vmaas::UartBus& bus_;
    DoneHandler on_done_;
    NakHandler on_nak_;
    AckHandler on_ack_;
    StatusHandler on_status_;
};
