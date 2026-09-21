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

    /// MQTT keepalive towards the broker, in seconds.
    ///
    /// esp-mqtt's default is 120, and EMQX declares a client dead at 1.5x the
    /// keepalive. That is the detection window for an ungraceful drop - a
    /// yanked power cable or a dead access point, where nothing gets to send a
    /// DISCONNECT - and so it is how long a dead machine keeps reading Online
    /// in the admin UI. 30 s puts that at roughly 45 s instead of three
    /// minutes, for one small packet every 15 s (the client talks at half the
    /// interval it is given).
    constexpr int broker_keepalive_s = 30;

    /// Stack for the one-shot broker connect task in bytes. It runs SNTP and
    /// the esp-mqtt setup, then exits; the TLS handshake itself happens on
    /// esp-mqtt's own task, not this one.
    constexpr int broker_task_stack = 4096;

    /// Priority of the broker connect task. Below the keypad: it spends its
    /// life in vTaskDelay and must never delay a key press.
    constexpr int broker_task_priority = 4;

    /// How long to wait for the first SNTP answer, in milliseconds.
    constexpr uint32_t broker_sntp_timeout_ms = 10000;

    /// Gap before retrying the clock when SNTP did not answer, in milliseconds.
    constexpr uint32_t broker_clock_retry_ms = 30000;
}
