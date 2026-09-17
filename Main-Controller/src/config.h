#pragma once
/**
 * @file config.h
 * @brief Compile-time settings for the Main-Controller firmware.
 */
#include <cstdint>

/// Main-Controller configuration.
namespace Config
{
    /// UART speed towards Motorcontrol in bit/s. Must match Motorcontrol.
    constexpr int baud_rate = 115200;

    /// I2C SCL frequency for the Grove-LCD in Hz. Standard mode; the module is not rated for 400 kHz.
    constexpr uint32_t i2c_clock_hz = 100000;

    /// Gap between keypad scans in milliseconds. Must be well under the
    /// debounce window, and must be a whole number of FreeRTOS ticks: with
    /// CONFIG_FREERTOS_HZ=100 a tick is 10 ms, so anything smaller rounds to
    /// zero in pdMS_TO_TICKS and xTaskDelayUntil asserts. 10 ms still leaves
    /// the scan five times faster than the 50 ms bus.poll() it exists to
    /// outrun.
    constexpr uint32_t keypad_scan_interval_ms = 10;

    /// Depth of the queue between the keypad task and the main loop.
    constexpr int keypad_queue_depth = 16;

    /// Stack for the keypad scan task in bytes. It only touches GPIO and a ring buffer.
    constexpr int keypad_task_stack = 2560;

    /// Priority of the keypad scan task. Above the idle work, below the UART.
    constexpr int keypad_task_priority = 5;
}
