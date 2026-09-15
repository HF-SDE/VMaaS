// Motorcontrol: receives RUN/STOP/STATUS/CONFIG from Main-Controller over
// UART1 and drives the slot motors. See shared/vmaas-protocol/PROTOCOL.md.
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "pins.h"
#include "slot_map.h"
#include "command_handler.h"
#include "uart_bus.h"

namespace
{
    vmaas::UartBus bus(UART_NUM_1, Pins::UART_TX, Pins::UART_RX);
    CommandHandler handler(bus, SlotMap::pins, SlotMap::count);
}

extern "C" void app_main()
{
    bus.begin();
    handler.begin();
    ESP_LOGI("Motorcontrol", "waiting for commands");

    while (true)
    {
        // One FreeRTOS tick (CONFIG_FREERTOS_HZ=100, so 10 ms). With no UART
        // traffic this timeout sets how late handler.tick() can end a RUN, so
        // keeping it at one tick bounds the motor pulse overrun to one tick.
        bus.poll(pdMS_TO_TICKS(10));
        handler.tick();
    }
}
