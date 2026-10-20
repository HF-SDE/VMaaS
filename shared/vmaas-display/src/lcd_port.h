#pragma once
/**
 * @file lcd_port.h
 * @brief Hardware seam between the display drivers and the I2C bus.
 *
 * The driver never touches I2C directly. It writes through this interface,
 * which also provides the blocking delays the LCD init sequence needs.
 * EspI2cPort implements it on ESP-IDF; tests use a recording fake.
 */
#include <cstddef>
#include <cstdint>

namespace vmaas
{
    /// Minimal I2C master + delay abstraction used by the display drivers and detect_lcd().
    class LcdPort
    {
    public:
        virtual ~LcdPort() = default;

        /**
         * @brief Write bytes to one I2C device.
         * @param addr 7-bit device address.
         * @param data Bytes to send after the address byte.
         * @param len Number of bytes in @p data.
         * @return false if the device did not acknowledge or the transfer timed out.
         */
        virtual bool write(uint8_t addr, const uint8_t* data, size_t len) = 0;

        /**
         * @brief Check whether a device acknowledges its address, sending no data.
         * @param addr 7-bit device address.
         * @return true if something answered at @p addr.
         */
        virtual bool probe(uint8_t addr) = 0;

        /**
         * @brief Block the caller for @p ms milliseconds.
         * @param ms Delay length. Implementations may round up to their tick.
         */
        virtual void delay_ms(uint32_t ms) = 0;
    };
}
