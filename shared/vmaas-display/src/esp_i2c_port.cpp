/**
 * @file esp_i2c_port.cpp
 * @brief ESP-IDF i2c_master transport implementation. See esp_i2c_port.h.
 */
#ifdef ESP_PLATFORM

#include "esp_i2c_port.h"
#include "esp_err.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

namespace
{
    constexpr const char* TAG = "EspI2cPort";
}

namespace vmaas
{
    EspI2cPort::EspI2cPort(i2c_port_num_t port, int sda_pin, int scl_pin, uint32_t clock_hz)
        : port_(port), sda_pin_(sda_pin), scl_pin_(scl_pin), clock_hz_(clock_hz)
    {
    }

    void EspI2cPort::begin()
    {
        i2c_master_bus_config_t config = {};
        config.i2c_port = port_;
        config.sda_io_num = static_cast<gpio_num_t>(sda_pin_);
        config.scl_io_num = static_cast<gpio_num_t>(scl_pin_);
        config.clk_source = I2C_CLK_SRC_DEFAULT;
        config.glitch_ignore_cnt = 7;
        config.flags.enable_internal_pullup = 1;

        ESP_ERROR_CHECK(i2c_new_master_bus(&config, &bus_));
        (void)i2c_master_probe(bus_, 0x7F, PROBE_TIMEOUT_MS);

        ESP_LOGI(TAG, "I2C%d ready, SDA=%d SCL=%d, %lu Hz", (int)port_, sda_pin_, scl_pin_, (unsigned long)clock_hz_);
    }

    i2c_master_dev_handle_t EspI2cPort::device_for(uint8_t addr)
    {
        for (size_t i = 0; i < device_count_; ++i) {
            if (addrs_[i] == addr)
            {
                return devices_[i];
            }
        }
        if (device_count_ >= MAX_DEVICES)
        {
            ESP_LOGE(TAG, "device table full, cannot add 0x%02X", addr);
            return nullptr;
        }

        i2c_device_config_t dev = {};
        dev.dev_addr_length = I2C_ADDR_BIT_LEN_7;
        dev.device_address = addr;
        dev.scl_speed_hz = clock_hz_;

        i2c_master_dev_handle_t handle = nullptr;
        const esp_err_t err = i2c_master_bus_add_device(bus_, &dev, &handle);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "add device 0x%02X failed: %s", addr, esp_err_to_name(err));
            return nullptr;
        }
        addrs_[device_count_] = addr;
        devices_[device_count_] = handle;
        ++device_count_;
        return handle;
    }

    bool EspI2cPort::write(uint8_t addr, const uint8_t* data, size_t len)
    {
        if (bus_ == nullptr) return false;
        i2c_master_dev_handle_t dev = device_for(addr);
        if (dev == nullptr) return false;
        const esp_err_t err = i2c_master_transmit(dev, data, len, XFER_TIMEOUT_MS);
        if (err != ESP_OK)
        {
            ESP_LOGD(TAG, "write to 0x%02X (%u bytes) failed: %s", addr, (unsigned)len, esp_err_to_name(err));
            return false;
        }
        return true;
    }

    void EspI2cPort::delay_ms(uint32_t ms)
    {
        // pdMS_TO_TICKS rounds down and vTaskDelay(n) can return after as
        // little as (n-1) ticks, so add one tick to guarantee at least ms.
        vTaskDelay(pdMS_TO_TICKS(ms) + 1);
    }
}

#endif // ESP_PLATFORM
