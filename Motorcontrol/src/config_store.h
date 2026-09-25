#pragma once
/**
 * @file config_store.h
 * @brief LittleFS mount and slot-config loading for Motorcontrol.
 */
#include <cstddef>
#include "driver/gpio.h"
#include "slot_config.h"

namespace config_store
{
    constexpr const char* MOUNT_POINT = "/storage";               ///< VFS mount point.
    constexpr const char* PARTITION_LABEL = "storage";            ///< Name in partitions.csv.
    constexpr const char* CONFIG_PATH = "/storage/config.json";   ///< Slot wiring file.

    /// Largest config.json accepted, in bytes including the NUL. Bigger files are rejected.
    constexpr size_t MAX_CONFIG_BYTES = 2048;

    /// Outcome of load_config().
    struct LoadResult
    {
        vmaas::SlotConfig config; ///< Validated slot table. Only meaningful when ok.
        bool ok;              ///< true: the table may drive motors. false: see reason.
        char reason[40];      ///< Short cause for logs, e.g. "config.json missing" or "slots[2].pin OutOfRange".
    };

    /**
     * @brief Read, parse and log the slot configuration.
     *
     * Reads CONFIG_PATH and runs vmaas::parse_slot_config(). Logs one warning per
     * issue and, on success, one summary line at INFO level; call log_table()
     * separately for the per-slot lines. There is no default wiring: when the
     * file is missing or invalid, ok is false and the caller must not drive
     * any motor.
     *
     * @return Slot table and verdict.
     */
    LoadResult load_config();

    /**
     * @brief Check the table against the board's fixed wiring.
     *
     * The parser is pure and does not know which GPIOs this board already
     * uses. A slot pin equal to Pins::STEP or the UART pins would drive the
     * shared STEP line or the link as a motor enable; GPIO 1/3 is the console
     * UART0 and GPIO 6-11 is the SPI flash, and driving either can hang or
     * corrupt the board.
     *
     * @param cfg A table with ok == true.
     * @param reason Receives e.g. "slots[2].pins[0] reserved" when true is returned.
     * @param cap Size of @p reason.
     * @return true if any pin is reserved; the table must not drive motors.
     */
    bool uses_reserved_pin(const vmaas::SlotConfig& cfg, char* reason, size_t cap);

    /**
     * @brief Configure one nENABLE GPIO as an output driven HIGH (driver disabled).
     * Shared by disable_all_motors() and CommandHandler::begin() so the polarity
     * and the reset/level/direction/level sequence live in one place.
     */
    void raise_enable_pin(gpio_num_t pin);

    /**
     * @brief Drive every non-reserved nENABLE pin in the table HIGH (disabled) as an output.
     *
     * Called from app_main as early as the table is known, before the UART
     * is up: DRV8825 pulls nENABLE down internally, so every driver is on
     * from power-on until this runs. CommandHandler::begin() repeats it when
     * it takes ownership of the pins. Reserved pins are skipped: the board
     * already uses them for something else, so this must never drive them,
     * not even to a "safe" level. The caller separately puts a table with a
     * reserved pin into config-error via uses_reserved_pin(); this function
     * still runs in that case to switch off the table's legitimate drivers.
     */
    void disable_all_motors(const vmaas::SlotConfig& cfg);

    /**
     * @brief Log the slot table at INFO level, one "slot X -> nENABLE GPIO ..."
     * line per slot, same format load_config() used to print inline.
     */
    void log_table(const vmaas::SlotConfig& cfg);
}
