#pragma once
/**
 * @file config_error_responder.h
 * @brief Motorcontrol's request handler while it has no valid slot configuration.
 *
 * Takes CommandHandler's place on the bus when /storage/config.json is
 * missing or invalid. It never touches a GPIO. Every RUN, STOP and CONFIG
 * is refused with NAK CONFIG_ERROR and STATUS is answered with
 * STATUS_REPLY(ERROR, 0), so Main-Controller can show the fault on its
 * display. See PROTOCOL.md, "Motorcontrol without a valid slot configuration".
 */
#include "protocol.h"
#include "uart_bus.h"

/**
 * @brief Answers protocol requests while no valid slot configuration exists.
 *
 * Stands in for CommandHandler: refuses RUN/STOP/CONFIG with NAK CONFIG_ERROR,
 * answers STATUS with STATUS_REPLY(ERROR, 0), keeps BAD_PAYLOAD/UNKNOWN_CMD
 * behaviour identical to the normal handler, and never touches a GPIO.
 */
class ConfigErrorResponder
{
public:
    /**
     * @brief Bind the responder to a bus. The bus must outlive the responder.
     * @param bus Transport shared with Main-Controller.
     */
    explicit ConfigErrorResponder(vmaas::UartBus& bus);

    /// @brief Register the frame handler on the bus. Call once after bus.begin().
    void begin();

private:
    void handle(const vmaas::Frame& f);

    vmaas::UartBus& bus_;
};
