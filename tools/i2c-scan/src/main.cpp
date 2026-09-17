/**
 * @file main.cpp
 * @brief Bench firmware that diagnoses the Main-Controller I2C bus.
 *
 * The Grove-LCD fails with LcdError::I2cWrite on the very first write to the
 * LCD controller at 0x3E, and the underlying esp_err is only logged at debug
 * level, so the shipped firmware cannot say whether that is a NACK (nobody
 * home) or a timeout (bus held low). This firmware answers that, in order:
 *
 *   1. Idle line levels, read as plain inputs with pull-ups before I2C is
 *      started. Both must read high. A line stuck low means a jammed bus or a
 *      short, and no amount of driver work will help.
 *   2. A full probe of every 7-bit address, so we learn whether anything at
 *      all acknowledges.
 *   3. A named verdict for the three addresses this module can use:
 *      0x3E is the AiP31068L LCD controller, 0x62 the PCA9633 RGB backlight
 *      (v4.0) and 0x30 the SGM31323 (v5.0).
 *
 * The 0x3E / 0x62 split matters: the RGB chip runs happily at 3.3 V while the
 * LCD controller needs 5 V, so "backlight answers, controller does not" is a
 * specific, checkable power fault rather than a mystery.
 *
 * Not part of the shipped firmware.
 */
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <cstdio>
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "esp_err.h"

namespace
{
    constexpr int SDA_PIN = 21;
    constexpr int SCL_PIN = 22;
    constexpr uint32_t CLOCK_HZ = 100000;

    constexpr uint8_t ADDR_LCD = 0x3E;   // AiP31068L character controller
    constexpr uint8_t ADDR_RGB_V4 = 0x62; // PCA9633
    constexpr uint8_t ADDR_RGB_V5 = 0x30; // SGM31323

    // Read both lines as inputs with pull-ups, before I2C claims them.
    void report_idle_levels()
    {
        gpio_config_t cfg = {};
        cfg.pin_bit_mask = (1ULL << SDA_PIN) | (1ULL << SCL_PIN);
        cfg.mode = GPIO_MODE_INPUT;
        cfg.pull_up_en = GPIO_PULLUP_ENABLE;
        cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
        cfg.intr_type = GPIO_INTR_DISABLE;
        gpio_config(&cfg);
        vTaskDelay(pdMS_TO_TICKS(10));

        const int sda = gpio_get_level(static_cast<gpio_num_t>(SDA_PIN));
        const int scl = gpio_get_level(static_cast<gpio_num_t>(SCL_PIN));
        printf("IDLE SDA(GPIO%d)=%d SCL(GPIO%d)=%d\n", SDA_PIN, sda, SCL_PIN, scl);
        if (sda == 0 || scl == 0)
            printf("IDLE VERDICT: a line is stuck low - jammed bus, short, or a device holding it\n");
        else
            printf("IDLE VERDICT: both lines idle high, bus is electrically free\n");
    }
}

extern "C" void app_main()
{
    printf("\n=== VMaaS I2C bus scan, SDA=%d SCL=%d, %lu Hz ===\n",
           SDA_PIN, SCL_PIN, (unsigned long)CLOCK_HZ);

    report_idle_levels();

    i2c_master_bus_config_t config = {};
    config.i2c_port = I2C_NUM_0;
    config.sda_io_num = static_cast<gpio_num_t>(SDA_PIN);
    config.scl_io_num = static_cast<gpio_num_t>(SCL_PIN);
    config.clk_source = I2C_CLK_SRC_DEFAULT;
    config.glitch_ignore_cnt = 7;
    config.flags.enable_internal_pullup = 1;

    i2c_master_bus_handle_t bus = nullptr;
    const esp_err_t bus_err = i2c_new_master_bus(&config, &bus);
    if (bus_err != ESP_OK)
    {
        printf("BUS INIT FAILED: %s\n", esp_err_to_name(bus_err));
        while (true)
            vTaskDelay(pdMS_TO_TICKS(1000));
    }
    printf("BUS INIT OK\n");

    // Before anything else touches the bus, reproduce Main-Controller's exact
    // opening move: wait 50 ms, then write CMD_FUNCTION_SET to 0x3E. In the
    // firmware this is the bus's very first transaction and it fails; here the
    // earlier version of this tool only reached it after 112 probes, and it
    // succeeded. Running it first is the one variable that separates those.
    {
        i2c_device_config_t first_cfg = {};
        first_cfg.dev_addr_length = I2C_ADDR_BIT_LEN_7;
        first_cfg.device_address = ADDR_LCD;
        first_cfg.scl_speed_hz = CLOCK_HZ;

        i2c_master_dev_handle_t first_dev = nullptr;
        const esp_err_t add_err = i2c_master_bus_add_device(bus, &first_cfg, &first_dev);
        printf("FIRST ADD 0x3E: %s\n", esp_err_to_name(add_err));
        if (add_err == ESP_OK)
        {
            vTaskDelay(pdMS_TO_TICKS(50) + 1);
            const uint8_t function_set[2] = {0x80, 0x28};
            const esp_err_t w = i2c_master_transmit(first_dev, function_set, 2, 50);
            printf("FIRST WRITE (bus's first transaction): %s\n", esp_err_to_name(w));

            const esp_err_t w2 = i2c_master_transmit(first_dev, function_set, 2, 50);
            printf("SECOND WRITE (same device): %s\n", esp_err_to_name(w2));

            i2c_master_bus_rm_device(first_dev);
        }
    }

    int found = 0;
    for (uint8_t addr = 0x08; addr <= 0x77; ++addr)
    {
        const esp_err_t err = i2c_master_probe(bus, addr, 50);
        if (err == ESP_OK)
        {
            printf("FOUND 0x%02X\n", addr);
            ++found;
        }
        else if (err != ESP_ERR_NOT_FOUND && err != ESP_ERR_TIMEOUT)
        {
            printf("PROBE 0x%02X unusual result: %s\n", addr, esp_err_to_name(err));
        }
    }
    printf("SCAN DONE: %d device(s)\n", found);

    const bool lcd = (i2c_master_probe(bus, ADDR_LCD, 50) == ESP_OK);
    const bool v4 = (i2c_master_probe(bus, ADDR_RGB_V4, 50) == ESP_OK);
    const bool v5 = (i2c_master_probe(bus, ADDR_RGB_V5, 50) == ESP_OK);
    printf("LCD 0x3E: %s | RGB v4.0 0x62: %s | RGB v5.0 0x30: %s\n",
           lcd ? "present" : "absent", v4 ? "present" : "absent",
           v5 ? "present" : "absent");

    // Replicate the exact write GroveLcdRgb::begin() fails on, in isolation.
    // A probe only sends an address; this sends address plus two data bytes,
    // which is the only thing that differs between "the chip answers" and
    // "the driver cannot talk to it".
    if (lcd)
    {
        i2c_device_config_t dev_cfg = {};
        dev_cfg.dev_addr_length = I2C_ADDR_BIT_LEN_7;
        dev_cfg.device_address = ADDR_LCD;
        dev_cfg.scl_speed_hz = CLOCK_HZ;

        i2c_master_dev_handle_t dev = nullptr;
        const esp_err_t add_err = i2c_master_bus_add_device(bus, &dev_cfg, &dev);
        printf("ADD 0x3E: %s\n", esp_err_to_name(add_err));

        if (add_err == ESP_OK)
        {
            // CMD_FUNCTION_SET: control byte 0x80 (command, last) then 0x28.
            const uint8_t function_set[2] = {0x80, 0x28};
            const esp_err_t w1 = i2c_master_transmit(dev, function_set, 2, 50);
            printf("WRITE {0x80,0x28} len=2: %s\n", esp_err_to_name(w1));

            vTaskDelay(pdMS_TO_TICKS(60));
            const esp_err_t w2 = i2c_master_transmit(dev, function_set, 2, 1000);
            printf("WRITE again, timeout 1000ms: %s\n", esp_err_to_name(w2));

            const uint8_t one = 0x80;
            const esp_err_t w3 = i2c_master_transmit(dev, &one, 1, 1000);
            printf("WRITE {0x80} len=1: %s\n", esp_err_to_name(w3));
        }
    }

    if (!lcd && !v4 && !v5)
        printf("VERDICT: nothing on the bus. Check the four Grove wires and that VCC is 5V.\n");
    else if (!lcd && (v4 || v5))
        printf("VERDICT: backlight chip answers but the LCD controller does not. "
               "The RGB chip runs at 3.3V, the controller needs 5V - check VCC.\n");
    else if (lcd)
        printf("VERDICT: the LCD controller answers. The fault is in the driver or "
               "the transfer, not the wiring.\n");

    while (true)
        vTaskDelay(pdMS_TO_TICKS(5000));
}
