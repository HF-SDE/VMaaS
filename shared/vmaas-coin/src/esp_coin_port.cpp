/**
 * @file esp_coin_port.cpp
 * @brief See esp_coin_port.h. ESP-IDF only.
 */
#ifdef ESP_PLATFORM

#include "esp_coin_port.h"

#include "driver/gpio.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"

namespace
{
    /// 64 edges is eight coins' worth of a three-pulse train at two edges per
    /// pulse, with room to spare. Coins arrive by hand; this cannot fill in
    /// normal use, so a non-zero dropped_edges() means something is wrong.
    constexpr size_t EDGE_QUEUE_LEN = 64;

    QueueHandle_t edge_queue = nullptr;
    volatile uint32_t dropped = 0;
    int isr_pin = -1;

    /// Kept to the bare minimum: one clock read, one non-blocking send.
    void IRAM_ATTR coin_isr(void *)
    {
        vmaas::CoinEdge edge;
        edge.at_ms = static_cast<uint32_t>(esp_timer_get_time() / 1000);
        edge.level = gpio_get_level(static_cast<gpio_num_t>(isr_pin)) != 0;

        if (xQueueSendFromISR(edge_queue, &edge, nullptr) != pdTRUE){
            dropped = dropped + 1;
        }
    }
}

namespace vmaas
{
    esp_err_t EspCoinPort::begin(int coin_pin, int inhibit_pin)
    {
        coin_pin_ = coin_pin;
        inhibit_pin_ = inhibit_pin;
        isr_pin = coin_pin;

        if (edge_queue == nullptr)
        {
            edge_queue = xQueueCreate(EDGE_QUEUE_LEN, sizeof(CoinEdge));
            if (edge_queue == nullptr) return ESP_ERR_NO_MEM;
        }

        if (inhibit_pin_ >= 0)
        {
            gpio_config_t out_cfg = {};
            out_cfg.pin_bit_mask = 1ULL << inhibit_pin_;
            out_cfg.mode = GPIO_MODE_OUTPUT;
            out_cfg.intr_type = GPIO_INTR_DISABLE;
            esp_err_t out_err = gpio_config(&out_cfg);
            if (out_err != ESP_OK) return out_err;

            set_inhibit(true);
        }

        gpio_config_t in_cfg = {};
        in_cfg.pin_bit_mask = 1ULL << coin_pin;
        in_cfg.mode = GPIO_MODE_INPUT;
        // GPIO34-39 have no internal pull resistors at all; the 10k on the
        // optocoupler's collector is what holds the line. Asking for an
        // internal pull-up here would be silently ignored, so do not.
        in_cfg.pull_up_en = GPIO_PULLUP_DISABLE;
        in_cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
        in_cfg.intr_type = GPIO_INTR_ANYEDGE;

        esp_err_t err = gpio_config(&in_cfg);
        if (err != ESP_OK) return err;

        err = gpio_install_isr_service(ESP_INTR_FLAG_IRAM);
        if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) return err;

        return gpio_isr_handler_add(static_cast<gpio_num_t>(coin_pin), coin_isr, nullptr);
    }

    bool EspCoinPort::next(CoinEdge &out)
    {
        if (edge_queue == nullptr) return false;
        return xQueueReceive(edge_queue, &out, 0) == pdTRUE;
    }

    void EspCoinPort::set_inhibit(bool on)
    {
        if (inhibit_pin_ < 0) return;
        gpio_set_level(static_cast<gpio_num_t>(inhibit_pin_), on ? 1 : 0);
    }

    uint32_t EspCoinPort::dropped_edges() const { return dropped; }
}

#endif // ESP_PLATFORM
