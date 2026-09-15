#pragma once
// ESP-IDF UART transport for the VMaaS protocol. Only compiled on ESP
// targets; the host test build never sees the contents.
#ifdef ESP_PLATFORM

#include <functional>
#include "driver/uart.h"
#include "freertos/FreeRTOS.h"
#include "frame_codec.h"
#include "protocol.h"

namespace vmaas
{
    class UartBus
    {
    public:
        using FrameHandler = std::function<void(const Frame&)>;

        UartBus(uart_port_t port, int tx_pin, int rx_pin, int baud_rate = 115200);

        // Installs the UART driver and configures pins. Calls ESP_ERROR_CHECK,
        // so a failure aborts the board. Call once from app_main.
        void begin();

        // The handler may call send() from inside the callback. It must NOT call poll(): poll() is not re-entrant and the parser state would be corrupted.
        void on_frame(FrameHandler handler) { handler_ = std::move(handler); }

        // Encodes and writes f. Returns false if the frame is invalid or the
        // driver accepted fewer bytes than expected. Logs on failure.
        bool send(const Frame& f);

        // Reads whatever is available (blocking up to timeout for the first
        // byte), feeds the parser, and invokes the handler for each frame.
        // Reads at most 256 bytes per call so the caller's loop keeps its
        // timing. Dropped frames are counted in dropped_frames() and logged
        // at debug level only.
        void poll(TickType_t timeout);

        uint32_t dropped_frames() const { return parser_.dropped_frames(); }

    private:
        uart_port_t port_;
        int tx_pin_;
        int rx_pin_;
        int baud_rate_;
        FrameParser parser_;
        FrameHandler handler_;
    };
}

#endif // ESP_PLATFORM
