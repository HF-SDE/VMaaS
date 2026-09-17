/**
 * @file keypad_task.cpp
 * @brief Scan task and the queue between it and the main loop.
 */
#include "keypad_task.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "esp_log.h"
#include "config.h"

namespace
{
    constexpr const char* TAG = "KeypadTask";

    QueueHandle_t queue = nullptr;
    vmaas::Keypad* driver = nullptr;

    uint32_t now_ms()
    {
        return static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS);
    }

    void keypad_task(void*)
    {
        TickType_t last_wake = xTaskGetTickCount();
        TickType_t period = pdMS_TO_TICKS(Config::keypad_scan_interval_ms);
        if (period == 0)
        {
            period = 1;
            ESP_LOGW(TAG, "scan interval %ums is below one FreeRTOS tick, using one tick", (unsigned)Config::keypad_scan_interval_ms);
        }

        while (true)
        {
            driver->tick(now_ms());

            vmaas::KeyEvent ev{};
            while (driver->next_event(ev))
            {
                if (xQueueSend(queue, &ev, 0) != pdTRUE)
                    ESP_LOGW(TAG, "queue full, dropped key '%c'", ev.key);
            }

            vTaskDelayUntil(&last_wake, period);
        }
    }
}

bool keypad_task_start(vmaas::Keypad& keypad)
{
    driver = &keypad;
    queue = xQueueCreate(Config::keypad_queue_depth, sizeof(vmaas::KeyEvent));
    if (queue == nullptr)
    {
        ESP_LOGE(TAG, "could not create the key queue");
        return false;
    }

    const BaseType_t ok = xTaskCreate(keypad_task, "keypad",
                                      Config::keypad_task_stack, nullptr,
                                      Config::keypad_task_priority, nullptr);
    if (ok != pdPASS)
    {
        ESP_LOGE(TAG, "could not start the keypad task");
        vQueueDelete(queue);
        queue = nullptr;
        return false;
    }
    return true;
}

bool keypad_task_next(vmaas::KeyEvent& out)
{
    if (queue == nullptr)
        return false;
    return xQueueReceive(queue, &out, 0) == pdTRUE;
}
