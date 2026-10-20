/**
 * @file main.cpp
 * @brief Bench firmware that diagnoses the Main-Controller I2C bus.
 *
 * Answers, in order:
 *
 *   1. Idle line levels, read as plain inputs with pull-ups before I2C is
 *      started. Both must read high. A line stuck low means a jammed bus or a
 *      short, and no amount of driver work will help.
 *   2. A full probe of every 7-bit address, so we learn whether anything at
 *      all acknowledges.
 *   3. Which display is on the bus:
 *      - Grove-LCD RGB: 0x3E is the AiP31068L LCD controller, 0x62 the
 *        PCA9633 RGB backlight (v4.0) and 0x30 the SGM31323 (v5.0).
 *      - 1602A behind a PCF8574 backpack: 0x20-0x27 (PCF8574) or 0x38-0x3F
 *        (PCF8574A), normally 0x27 / 0x3F with A0-A2 left open.
 *   4. For a PCF8574 backpack: blink the backlight three times, then run the
 *      HD44780 4-bit init and write two lines. This checks the common pin
 *      mapping (P0=RS, P1=RW, P2=EN, P3=backlight, P4-P7=D4-D7) and the
 *      contrast pot, neither of which a probe can see.
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

    constexpr uint8_t ADDR_LCD = 0x3E;    // AiP31068L character controller
    constexpr uint8_t ADDR_RGB_V4 = 0x62; // PCA9633
    constexpr uint8_t ADDR_RGB_V5 = 0x30; // SGM31323

    // PCF8574 output bits on the usual 1602 backpack.
    constexpr uint8_t PCF_RS = 0x01;
    constexpr uint8_t PCF_EN = 0x04;
    constexpr uint8_t PCF_BL = 0x08;

    bool is_pcf8574(uint8_t addr) { return addr >= 0x20 && addr <= 0x27; }
    bool is_pcf8574a(uint8_t addr) { return addr >= 0x38 && addr <= 0x3F; }

    void delay_ms(uint32_t ms) { vTaskDelay(pdMS_TO_TICKS(ms) + 1); }

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
        if (sda == 0 || scl == 0) {
            printf("IDLE VERDICT: a line is stuck low - jammed bus, short, or a device holding it\n");
        } else {
            printf("IDLE VERDICT: both lines idle high, bus is electrically free\n");
        }
    }

    // Send one HD44780 nibble (in the high four bits of @p bits) through the
    // PCF8574: set data, raise EN, drop EN. One transaction of three bytes;
    // at 100 kHz each byte takes ~90 us, which covers every HD44780 setup,
    // pulse-width and command-execution time except clear/home.
    esp_err_t pcf_nibble(i2c_master_dev_handle_t dev, uint8_t bits)
    {
        const uint8_t seq[3] = {
            static_cast<uint8_t>(bits | PCF_BL),
            static_cast<uint8_t>(bits | PCF_BL | PCF_EN),
            static_cast<uint8_t>(bits | PCF_BL),
        };
        return i2c_master_transmit(dev, seq, sizeof(seq), 50);
    }

    esp_err_t pcf_byte(i2c_master_dev_handle_t dev, uint8_t value, uint8_t rs)
    {
        esp_err_t err = pcf_nibble(dev, (value & 0xF0) | rs);
        if (err == ESP_OK) {
            err = pcf_nibble(dev, static_cast<uint8_t>(value << 4) | rs);
        }
        return err;
    }

    esp_err_t pcf_text(i2c_master_dev_handle_t dev, const char *text)
    {
        for (; *text; ++text)
        {
            const esp_err_t err = pcf_byte(dev, static_cast<uint8_t>(*text), PCF_RS);
            if (err != ESP_OK) return err;
        }
        return ESP_OK;
    }

    // Blink the backlight, then init the HD44780 in 4-bit mode and write two
    // lines. Every step is printed so a failure says exactly where it stopped.
    void test_pcf8574_lcd(i2c_master_bus_handle_t bus, uint8_t addr)
    {
        printf("--- PCF8574 test at 0x%02X ---\n", addr);

        i2c_device_config_t dev_cfg = {};
        dev_cfg.dev_addr_length = I2C_ADDR_BIT_LEN_7;
        dev_cfg.device_address = addr;
        dev_cfg.scl_speed_hz = CLOCK_HZ;

        i2c_master_dev_handle_t dev = nullptr;
        const esp_err_t add_err = i2c_master_bus_add_device(bus, &dev_cfg, &dev);
        if (add_err != ESP_OK) {
            printf("PCF ADD: %s\n", esp_err_to_name(add_err));
            return;
        }

        uint8_t port = 0;
        const esp_err_t r = i2c_master_receive(dev, &port, 1, 50);
        printf("PCF READ port: %s, value 0x%02X\n", esp_err_to_name(r), port);

        printf("PCF BLINK: backlight off/on x3 - watch the display\n");
        esp_err_t err = ESP_OK;
        for (int i = 0; i < 3 && err == ESP_OK; ++i)
        {
            const uint8_t off = 0x00;
            const uint8_t on = PCF_BL;
            err = i2c_master_transmit(dev, &off, 1, 50);
            delay_ms(400);
            if (err == ESP_OK) {
                err = i2c_master_transmit(dev, &on, 1, 50);
            }
            delay_ms(400);
        }
        printf("PCF BLINK: %s\n", esp_err_to_name(err));

        // HD44780 datasheet fig. 24: three 0x3 nibbles force 8-bit mode from
        // any state, then 0x2 switches to 4-bit.
        delay_ms(50);
        err = pcf_nibble(dev, 0x30);
        delay_ms(5);
        if (err == ESP_OK) {
            err = pcf_nibble(dev, 0x30);
        }
        delay_ms(1);
        if (err == ESP_OK) {
            err = pcf_nibble(dev, 0x30);
        }
        delay_ms(1);
        if (err == ESP_OK) {
            err = pcf_nibble(dev, 0x20);
        }
        if (err == ESP_OK) {
            err = pcf_byte(dev, 0x28, 0); // 4-bit, 2 lines, 5x8
        }
        if (err == ESP_OK) {
            err = pcf_byte(dev, 0x0C, 0); // display on, cursor off
        }
        if (err == ESP_OK) {
            err = pcf_byte(dev, 0x01, 0); // clear
        }
        delay_ms(2);
        if (err == ESP_OK) {
            err = pcf_byte(dev, 0x06, 0); // entry: increment
        }
        printf("LCD INIT: %s\n", esp_err_to_name(err));

        if (err == ESP_OK) {
            err = pcf_text(dev, "VMaaS I2C test");
        }
        if (err == ESP_OK) {
            err = pcf_byte(dev, 0x80 | 0x40, 0); // row 1, col 0
        }
        char row1[17];
        snprintf(row1, sizeof(row1), "PCF8574 @ 0x%02X", addr);
        if (err == ESP_OK) {
            err = pcf_text(dev, row1);
        }
        printf("LCD TEXT: %s\n", esp_err_to_name(err));

        if (err == ESP_OK) {
            printf("PCF VERDICT: writes OK. Text visible -> standard pin mapping works. "
                   "Backlight blinked but no text, or only black boxes on row 0 -> turn "
                   "the contrast pot on the backpack.\n");
        } else {
            printf("PCF VERDICT: the backpack acknowledged the probe but a write failed - "
                   "check the wires and the 5V supply.\n");
        }
        i2c_master_bus_rm_device(dev);
    }
}

extern "C" void app_main()
{
    printf("\n=== VMaaS I2C bus scan, SDA=%d SCL=%d, %lu Hz ===\n", SDA_PIN, SCL_PIN, (unsigned long)CLOCK_HZ);

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
    if (bus_err != ESP_OK) {
        printf("BUS INIT FAILED: %s\n", esp_err_to_name(bus_err));
        while (true)
            vTaskDelay(pdMS_TO_TICKS(1000));
    }
    printf("BUS INIT OK\n");

    int found = 0;
    uint8_t pcf_addr = 0;
    for (uint8_t addr = 0x08; addr <= 0x77; ++addr)
    {
        const esp_err_t err = i2c_master_probe(bus, addr, 50);
        if (err == ESP_OK) {
            const char *what = "";
            if (addr == ADDR_LCD) {
                what = " (Grove AiP31068L LCD controller)";
            } else if (addr == ADDR_RGB_V4) {
                what = " (Grove PCA9633 RGB, v4.0)";
            } else if (addr == ADDR_RGB_V5) {
                what = " (Grove SGM31323 RGB, v5.0)";
            } else if (is_pcf8574(addr)) {
                what = " (PCF8574 LCD backpack)";
            } else if (is_pcf8574a(addr)) {
                what = " (PCF8574A LCD backpack)";
            }
            printf("FOUND 0x%02X%s\n", addr, what);
            ++found;
            if (pcf_addr == 0 && (is_pcf8574(addr) || is_pcf8574a(addr))) {
                pcf_addr = addr;
            }
        } else if (err != ESP_ERR_NOT_FOUND && err != ESP_ERR_TIMEOUT) {
            printf("PROBE 0x%02X unusual result: %s\n", addr, esp_err_to_name(err));
        }
    }
    printf("SCAN DONE: %d device(s)\n", found);

    const bool grove_lcd = (i2c_master_probe(bus, ADDR_LCD, 50) == ESP_OK);
    const bool grove_rgb = (i2c_master_probe(bus, ADDR_RGB_V4, 50) == ESP_OK) ||
                           (i2c_master_probe(bus, ADDR_RGB_V5, 50) == ESP_OK);

    if (pcf_addr != 0) {
        test_pcf8574_lcd(bus, pcf_addr);
    }

    if (found == 0) {
        printf("VERDICT: nothing on the bus. Check SDA->GPIO21, SCL->GPIO22, GND and that VCC is 5V.\n");
    } else if (pcf_addr != 0) {
        printf("VERDICT: PCF8574 backpack at 0x%02X - see PCF VERDICT above.\n", pcf_addr);
    } else if (grove_lcd) {
        printf("VERDICT: Grove-LCD controller answers at 0x3E.\n");
    } else if (grove_rgb) {
        printf("VERDICT: Grove backlight chip answers but the LCD controller does not. "
               "The RGB chip runs at 3.3V, the controller needs 5V - check VCC.\n");
    } else {
        printf("VERDICT: something answers, but no known display address. See FOUND lines.\n");
    }

    while (true)
        vTaskDelay(pdMS_TO_TICKS(5000));
}
