#pragma once
/**
 * @file esp_i2c_port.h
 * @brief LcdPort implementation on ESP-IDF's i2c_master driver.
 *
 * Only compiled on ESP targets; the host test build never sees the contents.
 */
#ifdef ESP_PLATFORM

#include <cstddef>
#include <cstdint>
#include "driver/i2c_master.h"
#include "lcd_port.h"

namespace vmaas
{
    /**
     * @brief One I2C master bus with lazily created device handles.
     *
     * The Grove display uses at most three addresses (LCD, v4 RGB, v5 RGB),
     * so a small fixed table of device handles is enough. Failed transfers
     * return false instead of aborting, so an unplugged display never
     * resets the board.
     */
    class EspI2cPort : public LcdPort
    {
    public:
        /**
         * @brief Store the bus configuration. Nothing is touched until begin().
         * @param port I2C controller number, normally I2C_NUM_0.
         * @param sda_pin GPIO for SDA.
         * @param scl_pin GPIO for SCL.
         * @param clock_hz SCL frequency. 100000 (standard mode) for the Grove display.
         */
        EspI2cPort(i2c_port_num_t port, int sda_pin, int scl_pin, uint32_t clock_hz = 100000);

        /**
         * @brief Create the master bus with internal pull-ups enabled.
         *
         * Call once from app_main, before GroveLcdRgb::begin().
         * @warning Uses ESP_ERROR_CHECK, so a misconfigured bus aborts the board.
         */
        void begin();

        /// @copydoc LcdPort::write
        bool write(uint8_t addr, const uint8_t* data, size_t len) override;

        /// @copydoc LcdPort::delay_ms
        /// @note Blocks for at least @p ms; with a 10 ms FreeRTOS tick this means up to ms + 20 ms.
        void delay_ms(uint32_t ms) override;

    private:
        static constexpr size_t MAX_DEVICES = 4;
        static constexpr int XFER_TIMEOUT_MS = 50;
        /// Timeout for the throwaway probe that primes the bus in begin().
        static constexpr int PROBE_TIMEOUT_MS = 10;

        i2c_master_dev_handle_t device_for(uint8_t addr);

        i2c_port_num_t port_;
        int sda_pin_;
        int scl_pin_;
        uint32_t clock_hz_;
        i2c_master_bus_handle_t bus_ = nullptr;
        uint8_t addrs_[MAX_DEVICES] = {};
        i2c_master_dev_handle_t devices_[MAX_DEVICES] = {};
        size_t device_count_ = 0;
    };
}

#endif // ESP_PLATFORM
