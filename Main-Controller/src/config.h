#pragma once
/**
 * @file config.h
 * @brief Compile-time settings for the Main-Controller firmware.
 */
#include <cstddef>
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
    /// EMQX declares a client dead at 1.5x the keepalive, which is how long a
    /// machine that dropped ungracefully - yanked power, dead access point,
    /// no DISCONNECT sent - keeps reading Online in the admin UI. 30 s puts
    /// that at roughly 45 s instead of the three minutes esp-mqtt's default of
    /// 120 would give, and costs one small packet every 15 s, since the client
    /// talks at half the interval it is given.
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

    /// Relay modules of this kind energise the coil when their input is pulled
    /// LOW. With fail-secure wiring the de-energised state is "locked", so a
    /// floating pin during boot, a reset and a brown-out all leave the door shut.
    constexpr bool door_relay_active_low = true;

    /// Bounds on the configured unlock pulse, in milliseconds. The solenoid is
    /// pulse-to-release and is not rated to be held energised.
    constexpr uint32_t door_unlock_min_ms = 100;
    constexpr uint32_t door_unlock_max_ms = 2000;

    /// Stack for the event sender task in bytes. Larger than the broker task
    /// because the TLS handshake runs on this task, not on esp-mqtt's, and
    /// mbedTLS wants several KB of its own while that handshake is live.
    /// event_reporter.cpp keeps its own batch buffers off this stack (they
    /// are module-scope statics, not locals) for the same reason: at 8192
    /// bytes, a live handshake plus a stack-resident batch left too little
    /// margin. Raised to 12288 as a working number; event_reporter.cpp logs
    /// its own high-water mark on every empty drain, so this can be tuned
    /// down again once that number is known from the bench, not guessed at.
    constexpr int reporter_task_stack = 12288;

    /// Priority of the event sender. Below the keypad: it must never delay a key press.
    constexpr int reporter_task_priority = 4;

    /// Events per request. The endpoint takes 50; 20 keeps a typical batch of
    /// small payloads (e.g. "door-released") to a few KB. The shared send
    /// buffer in event_reporter.cpp is sized for the worst case instead - a
    /// full batch of maximum-size records - which comes to roughly 8.4 KB,
    /// not "near 4 KB": see BODY_CAP there.
    constexpr int reporter_batch_size = 20;

    /// Gap before retrying api_client::begin() when it did not come up, in
    /// milliseconds. Its failures are not necessarily permanent - an NVS read
    /// can fail transiently, and a certificate written by a concurrent
    /// activation appears after the first attempt - so the sender task waits
    /// and tries again rather than giving up for the rest of uptime. Same
    /// value and same reasoning as broker_clock_retry_ms; kept separate so
    /// either can be tuned without moving the other.
    constexpr uint32_t reporter_api_retry_ms = 30000;

    /// Retry backoff bounds for a failed drain, in milliseconds.
    constexpr uint32_t reporter_backoff_min_ms = 5000;
    constexpr uint32_t reporter_backoff_max_ms = 300000;

    /// Size at which the journal is compacted, in bytes.
    constexpr size_t reporter_journal_cap = 128 * 1024;
}
