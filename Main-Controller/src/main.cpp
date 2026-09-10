#include "pins.h"
#include "config.h"
#include <string>
#include "driver/uart.h"
#include "esp_err.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

constexpr bool IS_BOARD_A = true; // true på A, false på B
constexpr uart_port_t UART_PORT = UART_NUM_1;

void app_main()
{
    uart_config_t config = Config::uart_config;

    ESP_ERROR_CHECK(uart_driver_install(UART_PORT, 1024, 0, 0, nullptr, 0));
    ESP_ERROR_CHECK(uart_param_config(UART_PORT, &config));
    ESP_ERROR_CHECK(uart_set_pin(UART_PORT, Pins::UART_TX, Pins::UART_RX,
                                 UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));

    std::string message;
    bool too_long = false;
    TickType_t last_send = xTaskGetTickCount();

    while (true)
    {
        const TickType_t now = xTaskGetTickCount();
        if (IS_BOARD_A && static_cast<TickType_t>(now - last_send) >= pdMS_TO_TICKS(2000))
        {
            uart_write_bytes(UART_PORT, "PING\n", 5);
            ESP_LOGI("UART", "Sendt: PING");
            last_send = now;
        }

        char c;
        if (uart_read_bytes(UART_PORT, &c, 1, pdMS_TO_TICKS(100)) != 1)
        {
            continue;
        }
        if (c == '\r')
            continue;

        if (c == '\n')
        {
            if (too_long)
            {
                ESP_LOGW("UART", "Besked afvist: maks. 255 bytes");
            }
            else
            {
                ESP_LOGI("UART", "Modtaget: %s", message.c_str());
                if (!IS_BOARD_A && message == "PING")
                {
                    uart_write_bytes(UART_PORT, "PONG\n", 5);
                    ESP_LOGI("UART", "Sendt: PONG");
                }
            }
            message.clear();
            too_long = false;
        }
        else if (message.size() < 255)
        {
            message += c;
        }
        else
        {
            too_long = true;
        }
    }
}
