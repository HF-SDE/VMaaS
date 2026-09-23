// Motorcontrol: receives RUN/STOP/STATUS/CONFIG from Main-Controller over
// UART1 and drives the slot motors: DRV8825 steppers on one shared STEP line
// (Pins::STEP) with one nENABLE GPIO per driver. The nENABLE wiring and the
// pulse count per vend come from /storage/config.json (schema v2, see
// shared/vmaas-config/README.md); there is no default in firmware. Without a
// valid file the board answers every request with NAK CONFIG_ERROR /
// STATUS_REPLY(ERROR) and restarts every 30 s (at most 100 times per
// power-on) to pick up a corrected file. See shared/vmaas-protocol/PROTOCOL.md.
//
// Boot order is deliberate: DRV8825 pulls nENABLE low internally, so every
// driver is ON from power-on until firmware drives its pin high. The config
// is therefore read and the pins raised BEFORE the UART is started or
// anything is logged that could wait on it. The reserved-pin check runs
// before any pin is touched, and the table is logged only after the pins
// are high. A step generator that fails to initialise is treated like a
// missing config: the board enters the config-error state rather than
// acknowledging vends it cannot perform.
#include <cstdio>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_attr.h"
#include "esp_log.h"
#include "esp_system.h"
#include "pins.h"
#include "config.h"
#include "config_store.h"
#include "storage.h"
#include "config_error_responder.h"
#include "command_handler.h"
#include "step_generator.h"
#include "uart_bus.h"

namespace
{
    constexpr const char* TAG = "Motorcontrol";
    constexpr TickType_t ERROR_RESTART_DELAY = pdMS_TO_TICKS(30000);
    constexpr uint32_t MAX_ERROR_RESTARTS = 100;

    // Survives esp_restart() but not a power cycle, so the restart budget is per power-on.
    RTC_NOINIT_ATTR uint32_t s_error_boots;

    vmaas::UartBus bus(UART_NUM_1, Pins::UART_TX, Pins::UART_RX);
    StepGenerator generator(static_cast<gpio_num_t>(Pins::STEP), Config::STEP_INTERVAL_US);

    [[noreturn]] void run_with_slots(const vmaas::SlotConfig& cfg)
    {
        CommandHandler handler(bus, cfg, generator);
        handler.begin();
        ESP_LOGI(TAG, "waiting for commands");

        while (true)
        {
            bus.poll(pdMS_TO_TICKS(10));
            handler.tick();
        }
    }

    [[noreturn]] void run_config_error(const char* reason)
    {
        ++s_error_boots;
        const bool restart_armed = s_error_boots < MAX_ERROR_RESTARTS;
        ESP_LOGE(TAG, "config error: %s (error boot %lu of %lu%s)", reason, (unsigned long)s_error_boots, (unsigned long)MAX_ERROR_RESTARTS, restart_armed ? ", restarting in 30 s" : ", restart budget spent, staying up");

        ConfigErrorResponder responder(bus);
        responder.begin();

        const TickType_t started = xTaskGetTickCount();
        while (true)
        {
            bus.poll(pdMS_TO_TICKS(10));
            if (restart_armed && static_cast<TickType_t>(xTaskGetTickCount() - started) >= ERROR_RESTART_DELAY)
            {
                ESP_LOGW(TAG, "restarting to retry config.json");
                esp_restart();
            }
        }
    }
}

extern "C" void app_main()
{
    if (esp_reset_reason() == ESP_RST_POWERON) {
        s_error_boots = 0; // Empty the RTC memory after power-on
    }

    // Config first, UART second: see the file comment.
    vmaas::fs::mount(config_store::PARTITION_LABEL, config_store::MOUNT_POINT);
    config_store::LoadResult cfg = config_store::load_config();
    if (cfg.ok)
    {
        if (config_store::uses_reserved_pin(cfg.config, cfg.reason, sizeof(cfg.reason))) {
            cfg.ok = false;
        }
        config_store::disable_all_motors(cfg.config);
        config_store::log_table(cfg.config);
    }

    bus.begin();

    if (cfg.ok)
    {
        const esp_err_t gen_err = generator.begin();
        if (gen_err != ESP_OK)
        {
            ESP_LOGE(TAG, "step generator failed: %s", esp_err_to_name(gen_err));
            std::snprintf(cfg.reason, sizeof(cfg.reason), "step generator failed");
            cfg.ok = false;
        }
    }

    if (cfg.ok)
    {
        s_error_boots = 0;
        run_with_slots(cfg.config);
    }
    run_config_error(cfg.reason);
}
