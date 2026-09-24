#pragma once
/**
 * @file command_handler.h
 * @brief Motorcontrol's request handler: receives protocol requests from
 *        Main-Controller, runs the dispense sequence, and sends replies.
 */
#include <cstddef>
#include <cstdint>
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "protocol.h"
#include "slot_config.h"
#include "step_generator.h"
#include "uart_bus.h"
#include "vend_sequencer.h"
#include "wiring_stager.h"

/**
 * @brief Executes RUN/STOP/STATUS/CONFIG requests against the slot table.
 *
 * The motors are DRV8825 steppers on one shared STEP line with one nENABLE
 * GPIO per driver (active LOW). One vend runs at a time. A RUN replies ACK
 * and hands the slot to a VendSequencer, which decides when to enable the
 * slot's drivers, start the pulse generator, disable them again and send
 * DONE; this class only executes those actions. Every request is answered
 * with ACK, NAK or STATUS_REPLY as specified in PROTOCOL.md.
 *
 * A `WIRING_*` transfer replaces the table at runtime: `COMMIT` is refused
 * with `NAK BUSY` during a vend, otherwise the staged table is validated,
 * written and applied, and the new pins are raised before they become live.
 */
class CommandHandler
{
public:
    /**
     * @brief Bind the handler to a bus, a validated slot table and a pulse source. All must outlive the handler.
     * @param bus Transport shared with Main-Controller.
     * @param cfg Slot table and pulse count from config.json.
     * @param gen The STEP pulse source.
     */
    CommandHandler(vmaas::UartBus& bus, const vmaas::SlotConfig& cfg, IStepGenerator& gen);

    /**
     * @brief Configure every nENABLE pin as an output driven HIGH (disabled)
     *        and register the frame handler on the bus.
     *
     * Call once after bus.begin().
     */
    void begin();

    /**
     * @brief Advance the vend.
     *
     * Call regularly from the main loop. Moves the sequencer through its
     * settle delay, starts the pulses, and when the generator reports done
     * disables the drivers and sends DONE. Does nothing while idle.
     */
    void tick();

private:
    void handle(const vmaas::Frame& f);
    void handle_run(const vmaas::Frame& f);
    void handle_stop(const vmaas::Frame& f);
    void handle_status(const vmaas::Frame& f);
    void handle_config(const vmaas::Frame& f);
    void handle_wiring_begin(const vmaas::Frame& f);
    void handle_wiring_slot(const vmaas::Frame& f);
    void handle_wiring_commit(const vmaas::Frame& f);

    /** @brief Find a slot's table entry, or nullptr if the slot is unknown. */
    const vmaas::SlotEntry* entry_for(uint8_t slot) const;
    /** @brief Drive every nENABLE pin of a slot. enabled == true means LOW. */
    void set_enabled(const vmaas::SlotEntry& e, bool enabled);
    /** @brief Execute what the sequencer asked for. */
    void act(const vmaas::VendActions& a);
    /** @brief Raise every pin of the new table, then swap it in as cfg_. */
    void apply_table(const vmaas::SlotConfig& next);
    vmaas::State state() const;
    uint32_t now_ms() const;

    vmaas::UartBus& bus_;
    vmaas::SlotConfig cfg_;
    IStepGenerator& gen_;
    vmaas::VendSequencer seq_;
    vmaas::WiringStager stager_;
};
