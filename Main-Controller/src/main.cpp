#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include <cstdio>
#include <cstring>
#include "pins.h"
#include "config.h"
#include "motor_client.h"
#include "uart_bus.h"
#include "esp_i2c_port.h"
#include "grove_lcd_rgb.h"
#include "esp_keypad_port.h"
#include "keypad.h"
#include "keypad_task.h"
#include "config_store.h"
#include "wifi_sta.h"
#include "slot_entry.h"
#include "activation.h"
#include "onboarding.h"
#include "broker_client.h"
#include "device_api.h"
#include "purchase_task.h"
#include "service_code.h"
#include "door_lock.h"
#include "event_reporter.h"

namespace
{
    constexpr const char *TAG = "MainController";
    constexpr TickType_t STATUS_INTERVAL = pdMS_TO_TICKS(2000);

    constexpr const char *PROMPT_ROW0 = "VMaaS: pick slot";   // exactly 16
    constexpr const char *ERROR_ROW0 = "MOTOR CONFIG ERR";
    constexpr const char *ERROR_ROW1 = "check slot config on Motorcontrol";

    vmaas::UartBus bus(UART_NUM_1, Pins::UART_TX, Pins::UART_RX, Config::baud_rate);
    MotorClient motor(bus);

    vmaas::EspI2cPort i2c(I2C_NUM_0, Pins::I2C_SDA, Pins::I2C_SCL, Config::i2c_clock_hz);
    vmaas::GroveLcdRgb lcd(i2c);

    vmaas::EspKeypadPort keypad_port;
    vmaas::Keypad keypad(keypad_port);
    vmaas::SlotEntry entry(vmaas::SLOT_ENTRY_MAX_DIGITS);
    vmaas::ServiceCode service;
    uint32_t door_unlock_ms = 500; // from config.json, set in app_main()

    bool display_ok = false;
    bool backlight_ok = false;
    bool motor_error_shown = false;
    char last_row1[17] = {};
    uint32_t result_hold_until_ms = 0; // see render()
    uint32_t result_hold_ms = 0;       // from config.json, set in app_main()

    uint32_t now_ms()
    {
        return static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS);
    }

    void log_lcd(const char *what, vmaas::LcdError err)
    {
        if (err != vmaas::LcdError::None)
            ESP_LOGW(TAG, "display %s: %s", what, vmaas::to_string(err));
    }

    void show_rows(const char *row0, const char *row1)
    {
        if (!display_ok)
            return;
        log_lcd("clear", lcd.clear());
        log_lcd("row 0", lcd.print_at(0, 0, row0));
        log_lcd("row 1", lcd.print_at(0, 1, row1, vmaas::Overflow::Scroll));
    }

    void show_row1(const char *text)
    {
        if (!display_ok) return;

        if (std::strncmp(text, last_row1, sizeof(last_row1)) == 0) return;

        std::snprintf(last_row1, sizeof(last_row1), "%s", text);
        log_lcd("clear row 1", lcd.clear_row(1));
        log_lcd("row 1", lcd.print_at(0, 1, text));
    }

    void show_prompt()
    {
        last_row1[0] = '\0';
        show_rows(PROMPT_ROW0, "");
        show_row1("> _");
    }

    // The typed digits are never shown or logged: ServiceState only ever
    // exposes them masked, and nothing here reads further.
    //
    // pulse_err is only meaningful for Accepted: it is door_lock::pulse()'s
    // result for this code, ESP_OK by default for every other status. A
    // code can be entirely correct while the relay still never moves -
    // e.g. door_lock::begin() failed at boot and left the release timer
    // unset - and showing "Door released" in that case sends a technician
    // chasing the wrong problem, because the one line that explains it was
    // logged weeks earlier at boot and is long gone from view.
    void render_service(const vmaas::ServiceState& st, esp_err_t pulse_err = ESP_OK)
    {
        if (motor_error_shown) return;

        char line[17];
        switch (st.status)
        {
        case vmaas::ServiceStatus::Collecting:
            std::snprintf(line, sizeof(line), "Code: %s_", st.masked);
            show_row1(line);
            break;
        case vmaas::ServiceStatus::Accepted:
            if (pulse_err == ESP_OK) {
                ESP_LOGI(TAG, "service code accepted, releasing the door");
                show_row1("Door released");
            } else {
                ESP_LOGE(TAG, "service code accepted but door pulse failed: %s, door NOT released", esp_err_to_name(pulse_err));
                show_row1("Door error");
            }
            result_hold_until_ms = now_ms() + result_hold_ms;
            break;
        case vmaas::ServiceStatus::Rejected:
            ESP_LOGW(TAG, "service code rejected");
            show_row1("Wrong code");
            result_hold_until_ms = now_ms() + result_hold_ms;
            break;
        case vmaas::ServiceStatus::TimedOut:
            ESP_LOGI(TAG, "service code entry timed out");
            result_hold_until_ms = 0;
            show_row1("> _");
            break;
        case vmaas::ServiceStatus::Idle:
            break;
        }
    }

    void show_motor_error()
    {
        if (motor_error_shown) return;

        motor_error_shown = true;
        purchase_task::set_motor_fault(true);
        ESP_LOGE(TAG, "Motorcontrol has no valid slot configuration, showing error screen");
        show_rows(ERROR_ROW0, ERROR_ROW1);
        if (backlight_ok) {
            log_lcd("set_rgb", lcd.set_rgb(255, 0, 0));
        }
    }

    void clear_motor_error()
    {
        if (!motor_error_shown) return;

        motor_error_shown = false;
        // purchase_task resynchronises its own display state on the next
        // tick() once this is cleared; see set_motor_fault()'s doc comment.
        purchase_task::set_motor_fault(false);
        ESP_LOGI(TAG, "Motorcontrol back to normal, restoring display");
        if (backlight_ok) {
            log_lcd("set_rgb", lcd.set_rgb(255, 255, 255));
        }
        show_prompt();
    }

    // A result line has to survive being immediately contradicted: SlotEntry
    // resets itself the moment it reports Confirmed, so the very next loop
    // run will call render() with an empty Editing state roughly 50 ms later.
    // Without the hold below, "Slot 12 chosen" would be overwritten by "> _"
    // long before anyone could read it.
    void render(const vmaas::EntryState &st)
    {
        if (motor_error_shown) return;

        char line[17];
        switch (st.status)
        {
        case vmaas::EntryStatus::Confirmed:
        {
            uint8_t slot = 0;
            if (vmaas::slot_number(st, slot))
            {
                std::snprintf(line, sizeof(line), "Slot %u chosen", (unsigned)slot);
                ESP_LOGI(TAG, "slot %u selected", (unsigned)slot);

                if (purchase_task::active())
                {
                    purchase_task::on_slot_confirmed(slot);
                    return;
                }
            }
            else
            {
                std::snprintf(line, sizeof(line), "Unknown slot");
            }
            show_row1(line);
            result_hold_until_ms = now_ms() + result_hold_ms;
            break;
        }
        case vmaas::EntryStatus::Cancelled:
            ESP_LOGI(TAG, "entry cancelled");
            show_row1("Cancelled");
            result_hold_until_ms = now_ms() + result_hold_ms;
            break;
        case vmaas::EntryStatus::TimedOut:
            ESP_LOGI(TAG, "entry timed out, clearing");
            result_hold_until_ms = 0;
            show_row1("> _");
            break;
        case vmaas::EntryStatus::Editing:
            if (st.buffer[0] == '\0' && now_ms() < result_hold_until_ms)
                return;
            result_hold_until_ms = 0;
            std::snprintf(line, sizeof(line), "> %s_", st.buffer);
            show_row1(line);
            break;
        }
    }
}

extern "C" void app_main()
{
    // FIRST, before anything else in this function. Until this runs, GPIO13 is
    // an undriven input with both internal pulls disabled, so whether the door
    // is held locked depends on the relay board's own pull-up rather than on
    // this firmware. Everything below it - config_store::load(), the event
    // journal's scan of up to 128 KB, wifi_sta::init() - stretched that window
    // from milliseconds to a second or more. door_lock::begin() depends on
    // nothing of ours: GPIO and esp_timer are both up before app_main is
    // called, so there is no ordering reason to place it any later.
    // Its failure stays non-fatal: the relay is fail-secure, so a pin that
    // could not be configured leaves the door shut.
    const esp_err_t door_err = door_lock::begin();
    if (door_err != ESP_OK) {
        ESP_LOGE(TAG, "door lock init failed: %s, the door stays locked", esp_err_to_name(door_err));
    }

    // Mounts LittleFS, so it runs before anything else touches storage.
    const vmaas::DeviceConfig cfg = config_store::load();

    if (device_api::begin(cfg.api_base_url) != ESP_OK) {
        ESP_LOGW(TAG, "no api_base_url in config.json; reporting is disabled");
    }

    keypad.set_debounce_ms(cfg.keypad_debounce_ms);
    entry.set_timeout_ms(cfg.slot_entry_timeout_ms);
    result_hold_ms = cfg.slot_entry_result_hold_ms;
    service.set_code(cfg.door_code);
    door_unlock_ms = cfg.door_unlock_ms;

    if (event_reporter::begin() != ESP_OK) {
        ESP_LOGW(TAG, "events will not be recorded on this boot");
    }

    const esp_err_t wifi_err = wifi_sta::init();
    if (wifi_err != ESP_OK) {
        ESP_LOGE(TAG, "wifi init failed: %s, continuing offline", esp_err_to_name(wifi_err));
    }
    else {
        wifi_sta::connect();
    }

    bus.begin();
    motor.begin();

    i2c.begin();
    const vmaas::LcdError lcd_err = lcd.begin();
    display_ok = lcd.ready();
    backlight_ok = (lcd_err == vmaas::LcdError::None);
    if (!display_ok) {
        ESP_LOGE(TAG, "display init failed: %s, continuing without display", vmaas::to_string(lcd_err));
    }
    else if (!backlight_ok) {
        ESP_LOGW(TAG, "display: backlight unavailable (%s), text only", vmaas::to_string(lcd_err));
    }

    const vmaas::KeypadError kp_err = keypad.begin(Pins::KEYPAD_ROWS, 4, Pins::KEYPAD_COLS, 3);
    if (kp_err != vmaas::KeypadError::None) {
        ESP_LOGE(TAG, "keypad init failed: %s, continuing without keypad", vmaas::to_string(kp_err));
    }
    else if (!keypad_task_start(keypad)) {
        ESP_LOGE(TAG, "keypad scan task did not start, continuing without keypad");
    }

    if (kp_err == vmaas::KeypadError::None)
    {
        for (size_t r = 0; r < 4; ++r)
        {
            keypad_port.drive_row(r, false);
            const int c0 = keypad_port.read_col(0) ? 1 : 0;
            const int c1 = keypad_port.read_col(1) ? 1 : 0;
            const int c2 = keypad_port.read_col(2) ? 1 : 0;
            keypad_port.drive_row(r, true);
            ESP_LOGI(TAG, "selftest row %u (GPIO%d): cols = %d %d %d", (unsigned)r, Pins::KEYPAD_ROWS[r], c0, c1, c2);
        }
    }

    const bool needs_setup = !wifi_sta::has_credentials() || !activation::has_certificate();
    if (wifi_err == ESP_OK && needs_setup)
    {
        if (!display_ok)
        {
            ESP_LOGE(TAG, "no display: onboarding is BLE-only, pin logged separately");
        }
        onboarding::run(cfg, lcd, backlight_ok);
    }
    else if (wifi_err != ESP_OK)
    {
        ESP_LOGE(TAG, "wifi init failed, skipping onboarding to avoid an unrecoverable hang");
    }

    broker_client::start();

    const bool cash_ok = purchase_task::begin(lcd, display_ok, motor);
    if (!cash_ok) {
        ESP_LOGW(TAG, "cash disabled; slot entry logs only, as before");
    }
    event_reporter::start(cfg.api_base_url);

    show_prompt();

    motor.on_ack([](vmaas::Cmd cmd) {
        ESP_LOGI(TAG, "ACK for cmd 0x%02X", (unsigned)cmd);
        clear_motor_error();
    });
    motor.on_nak([](vmaas::Cmd cmd, vmaas::ErrorCode err) {
        ESP_LOGW(TAG, "NAK for cmd 0x%02X, error %u", (unsigned)cmd, (unsigned)err);
        if (err == vmaas::ErrorCode::CONFIG_ERROR) {
            show_motor_error();
        }

        if (cmd == vmaas::Cmd::RUN) {
            purchase_task::on_dispense_failed();
        }
    });
    motor.on_done([](uint8_t slot){
        ESP_LOGI(TAG, "slot %u dispensed", slot);
        purchase_task::on_dispense_done();
    });
    motor.on_status([](vmaas::State state, uint8_t slot) {
        ESP_LOGI(TAG, "status: state=%u current_slot=%u", (unsigned)state, slot);
        if (state == vmaas::State::ERROR) {
            show_motor_error();
        }
        else {
            clear_motor_error();
        }
    });

    TickType_t last_status = xTaskGetTickCount();
    while (true)
    {
        bus.poll(pdMS_TO_TICKS(50));

        vmaas::KeyEvent ev{};
        while (keypad_task_next(ev))
        {
            if (ev.type == vmaas::KeyEventType::Pressed) {
                ESP_LOGI(TAG, "key '%c'", service.collecting() ? '*' : ev.key);
            }

            // '*' is shared between the two flows: SlotEntry treats it as
            // backspace (or cancel on an empty buffer), ServiceCode treats it
            // as "start a door code". A customer mid-purchase must keep their
            // backspace, so the recogniser is only offered an event when the
            // purchase entry is idle - unless it is already collecting, in
            // which case entry is guaranteed empty (it never got a chance to
            // fill while the recogniser was consuming keys) and the
            // recogniser must keep receiving keys until it finishes.
            const bool entry_busy = (entry.state().buffer[0] != '\0');
            if (!service.collecting() && entry_busy)
            {
                render(entry.handle(ev));
                continue;
            }

            const vmaas::ServiceState sv = service.handle(ev);
            if (sv.consumed)
            {
                const esp_err_t pulse_err = (sv.status == vmaas::ServiceStatus::Accepted)
                    ? door_lock::pulse(door_unlock_ms)
                    : ESP_OK;

                if (sv.status == vmaas::ServiceStatus::Accepted) {
                    const char* event_type =
                        (pulse_err == ESP_OK) ? "door-released" : "door-release-failed";
                    if (!event_reporter::record(event_type, "{\"source\":\"keypad\"}"))
                    {
                        ESP_LOGE(TAG, "'%s' was NOT recorded; the platform will not hear about it", event_type);
                    }
                }

                render_service(sv, pulse_err);
                continue;
            }

            const vmaas::EntryState es = entry.handle(ev);
            if (!service.collecting()) render(es);
        }

        render_service(service.tick(now_ms()));
        const vmaas::EntryState entry_tick_state = entry.tick(now_ms());
        if (!service.collecting()) {
        render(entry_tick_state);
        } 

        // A running purchase owns the LCD (see purchase_task::active), so it
        // gets the last word on the display each pass.
        purchase_task::tick(now_ms());
            

        if (display_ok) {
            lcd.tick(now_ms());
        }

        const TickType_t now = xTaskGetTickCount();
        if (static_cast<TickType_t>(now - last_status) >= STATUS_INTERVAL)
        {
            last_status = now;
            if (bus.dropped_frames() > 0) {
                ESP_LOGW(TAG, "dropped frames so far: %lu", (unsigned long)bus.dropped_frames());
            }
            if (keypad.dropped_events() > 0) {
                ESP_LOGW(TAG, "dropped key events so far: %lu", (unsigned long)keypad.dropped_events());
            }
            motor.request_status();
        }
    }
}
