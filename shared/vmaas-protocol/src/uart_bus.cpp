#ifdef ESP_PLATFORM

#include "uart_bus.h"
#include "esp_err.h"
#include "esp_log.h"

namespace
{
    constexpr const char* TAG = "UartBus";
    constexpr int RX_BUFFER_BYTES = 1024;
    constexpr int MAX_BYTES_PER_POLL = 256;
}

namespace vmaas
{
    UartBus::UartBus(uart_port_t port, int tx_pin, int rx_pin, int baud_rate)
        : port_(port), tx_pin_(tx_pin), rx_pin_(rx_pin), baud_rate_(baud_rate)
    {
    }

    void UartBus::begin()
    {
        uart_config_t config = {};
        config.baud_rate = baud_rate_;
        config.data_bits = UART_DATA_8_BITS;
        config.parity = UART_PARITY_DISABLE;
        config.stop_bits = UART_STOP_BITS_1;
        config.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
        config.source_clk = UART_SCLK_DEFAULT;

        ESP_ERROR_CHECK(uart_driver_install(port_, RX_BUFFER_BYTES, 0, 0, nullptr, 0));
        ESP_ERROR_CHECK(uart_param_config(port_, &config));
        ESP_ERROR_CHECK(uart_set_pin(port_, tx_pin_, rx_pin_,
                                     UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));
        ESP_LOGI(TAG, "UART%d ready, TX=%d RX=%d, %d baud", (int)port_, tx_pin_, rx_pin_, baud_rate_);
    }

    bool UartBus::send(const Frame& f)
    {
        uint8_t buf[MAX_FRAME_SIZE];
        const size_t n = encode(f, buf, sizeof(buf));
        if (n == 0)
        {
            ESP_LOGE(TAG, "send: invalid frame (cmd=0x%02X len=%u)", (unsigned)f.cmd, f.len);
            return false;
        }
        const int written = uart_write_bytes(port_, buf, n);
        if (written != static_cast<int>(n))
        {
            ESP_LOGE(TAG, "send: wrote %d of %u bytes", written, (unsigned)n);
            return false;
        }
        ESP_LOGD(TAG, "TX cmd=0x%02X len=%u", (unsigned)f.cmd, f.len);
        return true;
    }

    void UartBus::poll(TickType_t timeout)
    {
        uint8_t byte;
        // First read may block up to timeout; subsequent reads drain what is there.
        int got = uart_read_bytes(port_, &byte, 1, timeout);
        int read_count = 0;
        while (got == 1)
        {
            Frame f;
            const uint32_t dropped_before = parser_.dropped_frames();
            if (parser_.feed(byte, f))
            {
                ESP_LOGD(TAG, "RX cmd=0x%02X len=%u", (unsigned)f.cmd, f.len);
                if (handler_)
                    handler_(f);
            }
            else if (parser_.dropped_frames() != dropped_before)
            {
                ESP_LOGD(TAG, "dropped invalid frame (total %lu)", (unsigned long)parser_.dropped_frames());
            }
            if (++read_count >= MAX_BYTES_PER_POLL)
                break; // Leave the rest in the driver buffer for the next poll().
            got = uart_read_bytes(port_, &byte, 1, 0);
        }
    }
}

#endif // ESP_PLATFORM
