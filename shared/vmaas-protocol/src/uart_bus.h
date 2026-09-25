#pragma once
/**
 * @file uart_bus.h
 * @brief ESP-IDF UART transport for the VMaaS protocol.
 *
 * Only compiled on ESP targets; the host test build never sees the contents.
 */
#ifdef ESP_PLATFORM

#include <functional>
#include "driver/uart.h"
#include "freertos/FreeRTOS.h"
#include "frame_codec.h"
#include "protocol.h"

namespace vmaas
{
    /**
     * @brief Sends and receives protocol frames over one ESP-IDF UART port.
     *
     * Owns a FrameParser and a single frame handler. The owner drives it by
     * calling poll() from its main loop; received frames are delivered to the
     * handler from inside that call.
     */
    class UartBus
    {
    public:
        /// Callback invoked for every complete, CRC-valid frame received.
        using FrameHandler = std::function<void(const Frame&)>;

        /**
         * @brief Store the port configuration. Nothing is touched until begin().
         * @param port ESP-IDF UART port number.
         * @param tx_pin GPIO used for TX.
         * @param rx_pin GPIO used for RX.
         * @param baud_rate Line speed in bit/s. Both ends must agree.
         */
        UartBus(uart_port_t port, int tx_pin, int rx_pin, int baud_rate = 115200);

        /**
         * @brief Install the UART driver and configure the pins.
         *
         * Call once from app_main.
         * @warning Uses ESP_ERROR_CHECK, so a failure aborts the board.
         */
        void begin();

        /**
         * @brief Register the callback that receives decoded frames.
         *
         * There is exactly one handler slot: calling on_frame() again replaces
         * the previous handler rather than adding a second one. MotorClient and
         * CommandHandler register themselves here in their begin(), so calling
         * on_frame() yourself afterwards would silently disconnect them.
         *
         * The handler may call send() from inside the callback.
         * @warning The handler must NOT call poll(). poll() is not re-entrant
         *          and the parser state would be corrupted.
         * @param handler Callable taking the received frame.
         */
        void on_frame(FrameHandler handler) { handler_ = std::move(handler); }

        /**
         * @brief Encode and write a frame to the UART.
         * @param f Frame to send.
         * @return false if the frame is invalid or the driver accepted fewer
         *         bytes than expected. Failures are logged.
         */
        bool send(const Frame& f);

        /**
         * @brief Read available bytes, parse them and dispatch complete frames.
         *
         * Blocks up to @p timeout for the first byte, then reads whatever is
         * available and invokes the handler once per frame. Reads at most 256
         * bytes per call so the caller's loop keeps its timing. Dropped frames
         * are counted in dropped_frames() and logged at debug level only.
         * @param timeout Maximum FreeRTOS ticks to wait for the first byte.
         */
        void poll(TickType_t timeout);

        /// @brief Frames discarded by the parser because of a bad LEN or CRC.
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
