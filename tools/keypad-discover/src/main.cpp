/**
 * @file keypad_discover_main.cpp
 * @brief Bench firmware that finds the keypad's row/column mapping.
 *
 * SparkFun changed the COM-14662 pinout between revisions, so which of the
 * seven header pins are rows and which are columns is not known from the
 * datasheet. This firmware does not need to know: it treats all seven pins
 * alike, drives each one low in turn and reads the other six. A closed switch
 * is the only thing that can pull one pin down from another, so a held key
 * reveals exactly one conducting pair.
 *
 * Output is one line per state change, read by tools/keypad_discover.py:
 *
 *     READY
 *     PAIR <low_pin> <sensed_pin>
 *     NONE
 *
 * Not part of the shipped firmware. Build with: pio run (from tools/keypad-discover)
 */
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <cstdio>
#include "driver/gpio.h"
#include "esp_rom_sys.h"

namespace
{
    // Every pin the keypad is wired to, header pin 1 to 7, left to right.
    constexpr int PINS[] = {14, 25, 26, 27, 18, 19, 23};
    constexpr size_t PIN_COUNT = sizeof(PINS) / sizeof(PINS[0]);

    // All pins idle as pulled-up inputs so nothing is driven until we probe.
    void idle_all()
    {
        for (size_t i = 0; i < PIN_COUNT; ++i)
        {
            gpio_config_t cfg = {};
            cfg.pin_bit_mask = (1ULL << PINS[i]);
            cfg.mode = GPIO_MODE_INPUT;
            cfg.pull_up_en = GPIO_PULLUP_ENABLE;
            cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
            cfg.intr_type = GPIO_INTR_DISABLE;
            gpio_config(&cfg);
        }
    }

    // Drive one pin low, sample the rest, restore. Returns the index of the
    // single pin pulled low with it, or -1 for none/ambiguous.
    int sense_from(size_t driver)
    {
        const gpio_num_t drv = static_cast<gpio_num_t>(PINS[driver]);
        gpio_set_direction(drv, GPIO_MODE_OUTPUT);
        gpio_set_level(drv, 0);

        esp_rom_delay_us(50);

        int found = -1;
        int count = 0;
        for (size_t i = 0; i < PIN_COUNT; ++i)
        {
            if (i == driver)
                continue;
            if (gpio_get_level(static_cast<gpio_num_t>(PINS[i])) == 0)
            {
                found = static_cast<int>(i);
                ++count;
            }
        }

        gpio_set_direction(drv, GPIO_MODE_INPUT);

        gpio_set_pull_mode(drv, GPIO_PULLUP_ONLY);
        return (count == 1) ? found : -1;
    }
}

extern "C" void app_main()
{
    idle_all();
    // The tool waits for this line before prompting, so a half-booted board
    printf("READY\n");
    fflush(stdout);

    int last_a = -1;
    int last_b = -1;

    while (true)
    {
        int a = -1;
        int b = -1;
        for (size_t d = 0; d < PIN_COUNT; ++d)
        {
            const int s = sense_from(d);
            if (s >= 0)
            {
                a = static_cast<int>(d);
                b = s;
                break;
            }
        }

        if (a != last_a || b != last_b)
        {
            if (a >= 0)
                printf("PAIR %d %d\n", PINS[a], PINS[b]);
            else
                printf("NONE\n");
            fflush(stdout);
            last_a = a;
            last_b = b;
        }

        vTaskDelay(pdMS_TO_TICKS(20));
    }
}
