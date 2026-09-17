// Motorcontrol: receives RUN/STOP/STATUS/CONFIG from Main-Controller over
// UART1 and drives the slot motors. The slot-to-GPIO wiring comes from
// /storage/config.json (see shared/vmaas-config/README.md); there is no
// default wiring in firmware. Without a valid file the board answers every
// request with NAK CONFIG_ERROR / STATUS_REPLY(ERROR) and restarts every
// 30 s (at most 100 times per power-on) to pick up a corrected file.
// See shared/vmaas-protocol/PROTOCOL.md.
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_attr.h"
#include "esp_log.h"
#include "esp_system.h"
#include "pins.h"
#include "config_store.h"
#include "storage.h"
#include "config_error_responder.h"
#include "command_handler.h"
#include "uart_bus.h"

namespace
{
    constexpr const char* TAG = "Motorcontrol";
    constexpr TickType_t ERROR_RESTART_DELAY = pdMS_TO_TICKS(30000);
    constexpr uint32_t MAX_ERROR_RESTARTS = 100;

    // Survives esp_restart() but not a power cycle, so the restart budget is per power-on.
    RTC_NOINIT_ATTR uint32_t s_error_boots;

    vmaas::UartBus bus(UART_NUM_1, Pins::UART_TX, Pins::UART_RX);

    [[noreturn]] void run_with_slots(const vmaas::SlotConfig& cfg)
    {
        SlotPin table[vmaas::MAX_SLOTS];
        for (size_t i = 0; i < cfg.slot_count; ++i)
        {
            table[i] = SlotPin{cfg.slots[i].slot, static_cast<gpio_num_t>(cfg.slots[i].pin)};
        }

        CommandHandler handler(bus, table, cfg.slot_count);
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

    bus.begin();
    vmaas::fs::mount(config_store::PARTITION_LABEL, config_store::MOUNT_POINT);
    const config_store::LoadResult cfg = config_store::load_config();

    if (cfg.ok)
    {
        s_error_boots = 0;
        run_with_slots(cfg.config);
    }
    run_config_error(cfg.reason);
}
