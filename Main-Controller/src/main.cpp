// Main-Controller: smoke test for the UART command protocol and the Grove-LCD.
// Sends RUN 1 every 2 seconds, logs every reply from Motorcontrol, shows a
// static and a scrolling line on the display and cycles the backlight.
// See shared/vmaas-protocol/PROTOCOL.md and shared/vmaas-display/README.md.
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "pins.h"
#include "config.h"
#include "motor_client.h"
#include "uart_bus.h"
#include "esp_i2c_port.h"
#include "grove_lcd_rgb.h"

namespace
{
    constexpr const char* TAG = "MainController";
    constexpr uint8_t SMOKE_TEST_SLOT = 1;
    constexpr TickType_t SMOKE_TEST_INTERVAL = pdMS_TO_TICKS(2000);

    vmaas::UartBus bus(UART_NUM_1, Pins::UART_TX, Pins::UART_RX, Config::baud_rate);
    MotorClient motor(bus);

    vmaas::EspI2cPort i2c(I2C_NUM_0, Pins::I2C_SDA, Pins::I2C_SCL, Config::i2c_clock_hz);
    vmaas::GroveLcdRgb lcd(i2c);

    struct Rgb { uint8_t r, g, b; };
    constexpr Rgb BACKLIGHT_CYCLE[] = {
        {255, 0, 0}, {0, 255, 0}, {0, 0, 255}, {255, 255, 255},
    };
    constexpr size_t BACKLIGHT_COUNT = sizeof(BACKLIGHT_CYCLE) / sizeof(BACKLIGHT_CYCLE[0]);

    uint32_t now_ms()
    {
        return static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS);
    }

    void log_lcd(const char* what, vmaas::LcdError err)
    {
        if (err != vmaas::LcdError::None)
            ESP_LOGW(TAG, "display %s: %s", what, vmaas::to_string(err));
    }
}

extern "C" void app_main()
{
    bus.begin();
    motor.begin();

    i2c.begin();
    const vmaas::LcdError lcd_err = lcd.begin();
    const bool display_ok = lcd.ready();
    const bool backlight_ok = (lcd_err == vmaas::LcdError::None);
    if (!display_ok)
        ESP_LOGE(TAG, "display init failed: %s, continuing without display",
                 vmaas::to_string(lcd_err));
    else if (!backlight_ok)
        ESP_LOGW(TAG, "display: backlight unavailable (%s), text only",
                 vmaas::to_string(lcd_err));

    if (display_ok)
    {
        log_lcd("row 0", lcd.print_at(0, 0, "VMaaS"));
        log_lcd("row 1", lcd.print_at(0, 1, "Display smoke test - UART link to Motorcontrol",
                                      vmaas::Overflow::Scroll));
    }

    motor.on_ack([](vmaas::Cmd cmd) {
        ESP_LOGI(TAG, "ACK for cmd 0x%02X", (unsigned)cmd);
    });
    motor.on_nak([](vmaas::Cmd cmd, vmaas::ErrorCode err) {
        ESP_LOGW(TAG, "NAK for cmd 0x%02X, error %u", (unsigned)cmd, (unsigned)err);
    });
    motor.on_done([](uint8_t slot) {
        ESP_LOGI(TAG, "slot %u dispensed", slot);
    });
    motor.on_status([](vmaas::State state, uint8_t slot) {
        ESP_LOGI(TAG, "status: state=%u current_slot=%u", (unsigned)state, slot);
    });

    TickType_t last_send = xTaskGetTickCount();
    size_t colour_index = 0;
    while (true)
    {
        bus.poll(pdMS_TO_TICKS(50));

        if (display_ok)
            lcd.tick(now_ms());

        const TickType_t now = xTaskGetTickCount();
        if (static_cast<TickType_t>(now - last_send) >= SMOKE_TEST_INTERVAL)
        {
            last_send = now;
            if (bus.dropped_frames() > 0)
                ESP_LOGW(TAG, "dropped frames so far: %lu", (unsigned long)bus.dropped_frames());
            if (motor.run(SMOKE_TEST_SLOT))
                ESP_LOGI(TAG, "sent RUN %u", SMOKE_TEST_SLOT);

            if (backlight_ok)
            {
                const Rgb& c = BACKLIGHT_CYCLE[colour_index];
                log_lcd("set_rgb", lcd.set_rgb(c.r, c.g, c.b));
                colour_index = (colour_index + 1) % BACKLIGHT_COUNT;
            }
        }
    }
}
