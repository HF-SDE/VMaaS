/**
 * @file purchase_task.cpp
 * @brief See purchase_task.h.
 */
#include "purchase_task.h"

#include <cstdio>
#include <cstring>

#include <ctime>         // time, gmtime_r, strftime

#include "esp_log.h"
#include "esp_timer.h"   // esp_timer_get_time
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "activation.h"  // load_identity, for the machine id in the event id
#include "coin_acceptor.h"
#include "config.h"
#include "device_api.h"
#include "esp_coin_port.h"
#include "outbox.h"
#include "pins.h"
#include "prices.h"
#include "purchase.h"
#include "sale_line.h"

namespace
{
    constexpr const char *TAG = "purchase";
    /// How long "Take your item", a failure notice, or the cosmetic "Slot
    /// not for sale" message stays readable.
    constexpr uint32_t SETTLED_HOLD_MS = 4000;
    constexpr TickType_t DRAIN_INTERVAL = pdMS_TO_TICKS(10000);

    vmaas::CoinConfig coin_cfg;
    vmaas::PurchaseConfig purchase_cfg;
    prices::Table table;

    /**
     * @brief Guards `table` alone, not the rest of this file's state.
     *
     * Everything else here belongs to the main task. `table` is the one piece
     * config_sync writes from its own task, and both of its readers matter:
     * on_slot_confirmed() decides a price from it, and settle() takes
     * `table.currency` as a *pointer* into the struct, so a swap partway
     * through formatting a sale line would splice two currencies together.
     * Both readers copy what they need out under the lock and release it
     * before doing anything slow.
     */
    SemaphoreHandle_t price_mutex = nullptr;

    vmaas::CoinAcceptor *acceptor = nullptr;
    vmaas::Purchase *machine = nullptr;
    vmaas::EspCoinPort port;

    vmaas::GroveLcdRgb *lcd_ = nullptr;
    bool display_ok_ = false;
    MotorClient *motor_ = nullptr;
    bool cash_enabled = false;

    /// Set only when Purchase is genuinely Settled (see apply()); never set
    /// by the price-0 "not for sale" path. Review fix C1/C2: this used to be
    /// reused for that cosmetic message too, so its expiry in tick() could
    /// force machine->reset() on a purchase that was actually Dispensing or
    /// AwaitingPayment - discarding a real DONE/NAK settlement, or forfeiting
    /// real coin credit outside the intentional payment_timeout_ms window.
    ///
    /// Review fix round 2: armed ONLY on the transition into Settled (see
    /// prev_state_ below and apply()), never merely because the machine
    /// currently IS Settled. apply() runs on every tick() pass as well as on
    /// every real event, so arming it unconditionally whenever o.state ==
    /// Settled pushed this deadline out again on every single pass once a
    /// purchase settled - it never expired, machine->reset() in tick() was
    /// never reached, and the machine stayed Settled (locking out the next
    /// sale) until power-cycled. Found by the owner hand-testing the board.
    uint32_t settled_until_ms = 0;
    /// The PurchaseState of the last PurchaseOutput apply() processed, kept
    /// only to detect the transition into Settled (see apply()). Every
    /// PurchaseOutput in this file flows through apply(), including nested/
    /// recursive calls (e.g. the run-not-sent path below), so a single
    /// variable updated at the top of every apply() call is a complete
    /// record - there is no other path a PurchaseOutput can reach the rest
    /// of this file by.
    vmaas::PurchaseState prev_state_ = vmaas::PurchaseState::Idle;
    /// Hold timer for the cosmetic "Slot not for sale" notice ONLY. It never
    /// touches `machine` and its expiry never calls reset() - see tick().
    uint32_t notice_until_ms = 0;
    uint32_t last_dropped_edges = 0;
    char last_row0[17] = {};
    char last_row1[17] = {};

    /// Review fix I2: true while main.cpp's persistent motor-fault banner
    /// (show_motor_error()) is on screen. That banner is operator-facing and
    /// must win over anything purchase_task would draw, so every LCD write
    /// below is suppressed while this is set - state transitions, motor
    /// commands and settlement all still happen normally, only the display
    /// write is deferred.
    bool motor_fault_active_ = false;

    void show(const char *row0, const char *row1)
    {
        if (!display_ok_ || lcd_ == nullptr || motor_fault_active_) return;

        if (row0 != nullptr && std::strncmp(row0, last_row0, sizeof(last_row0)) != 0)
        {
            std::snprintf(last_row0, sizeof(last_row0), "%s", row0);
            lcd_->clear_row(0);
            lcd_->print_at(0, 0, row0);
        }
        if (row1 != nullptr && std::strncmp(row1, last_row1, sizeof(last_row1)) != 0)
        {
            std::snprintf(last_row1, sizeof(last_row1), "%s", row1);
            lcd_->clear_row(1);
            lcd_->print_at(0, 1, row1);
        }
    }

    /// Minor units as "15.00kr", which fits the 16-column rows.
    void money(char *buf, size_t len, uint32_t minor)
    {
        std::snprintf(buf, len, "%lu.%02lukr", static_cast<unsigned long>(minor / 100), static_cast<unsigned long>(minor % 100));
    }

    // GCC 15's -Wformat-truncation=-Werror correctly notices that "Credit
    // %9s" et al. can in theory produce more than 16 columns from an
    // 11-character amount[] and calls that an error. In practice the row
    // buffers are 16 columns on purpose: overlong text is meant to be
    // truncated (the LCD has 16 columns; this is the same intentional
    // truncation print_at()'s default Overflow::Truncate performs
    // elsewhere), not a bug to fix by growing the buffers. Silenced locally
    // rather than project-wide so the warning still fires anywhere else.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wformat-truncation"
    void render(const vmaas::PurchaseOutput &o)
    {
        char amount[12];
        char row0[17];
        char row1[17];

        switch (o.state)
        {
        case vmaas::PurchaseState::Idle:
            show("VMaaS: pick slot", "> _");
            break;

        case vmaas::PurchaseState::AwaitingPayment:
            if (o.price_minor == 0)
            {
                money(amount, sizeof(amount), o.credit_minor);
                std::snprintf(row0, sizeof(row0), "Credit %9s", amount);
                show(row0, "Pick a slot");
            }
            else
            {
                money(amount, sizeof(amount), o.price_minor);
                std::snprintf(row0, sizeof(row0), "Slot %-3u%8s", static_cast<unsigned>(o.slot), amount);
                money(amount, sizeof(amount), o.missing_minor);
                std::snprintf(row1, sizeof(row1), "Insert %8s", amount);
                show(row0, row1);
            }
            break;

        case vmaas::PurchaseState::Dispensing:
            show(nullptr, "Paid, dispensing");
            break;

        case vmaas::PurchaseState::Settled:
            if (o.sale_status == vmaas::SaleStatus::Failed)
            {
                std::snprintf(row0, sizeof(row0), "SLOT %u FAILED", static_cast<unsigned>(o.slot));
                show(row0, "contact operator");
            }
            else if (o.sale_status == vmaas::SaleStatus::Completed)
            {
                show(nullptr, "Take your item");
            }
            else
            {
                show(nullptr, "Timed out");
            }
            break;
        }
    }
#pragma GCC diagnostic pop

    /**
     * @brief Write one settlement to the outbox, durably.
     * @return True when the line is on flash.
     *
     * Called from apply() only once RUN has already been sent and the motor
     * has answered with DONE or NAK — never before RUN, and settle-before-run
     * would in fact be wrong: the sale's status (Completed vs. Failed) is not
     * known until the motor answers. What must never happen is the other
     * direction: settle() returning true is what apply() requires before it
     * will treat the vend as recorded. A power cut between a delivered
     * product and a recorded sale is the one failure nobody can reconcile
     * afterwards.
     *
     * @note This calls outbox::append() (and outbox::next_sequence()), which
     *       takes outbox's own mutex internally, and nothing else here. It
     *       must never also hold device_api's lock while doing so — the two
     *       mutexes are never nested in either order (see the drain task
     *       below), or an AB-BA deadlock with the drain task would silently
     *       stop the machine from selling.
     */
    bool settle(const vmaas::PurchaseOutput &o, const char *reason)
    {
        // Review fix C3: sized to activation::ID_MAX, and reading
        // id.machine_id below rather than id.topic_prefix. topic_prefix is
        // fixed-format "v1/{tenantId}/{siteId}/{machineId}" - three 36-char
        // UUIDs, always ~113 chars - so a 48-byte buffer always truncated it
        // to "v1/" + tenantId + "/" + 7 chars of siteId, DROPPING the one
        // field (machineId) that actually distinguishes machines. Any two
        // machines sharing a tenant and site (the normal case for a
        // multi-machine location) then produced byte-identical machine_id,
        // and since each device's next_sequence() counter starts
        // independently near 0/1, their event_ids collided almost
        // immediately - the backend dedupes on event_id, so one machine's
        // legitimate sale was silently dropped as a duplicate of another's.
        // id.machine_id is the actual unique id, and sizing the local buffer
        // to match ID_MAX removes any possibility of truncating it, rather
        // than just making truncation less likely.
        char machine_id[activation::ID_MAX] = "VM-UNKNOWN";
        activation::Identity id{};
        if (activation::load_identity(id) == ESP_OK) {
            std::snprintf(machine_id, sizeof(machine_id), "%s", id.machine_id);
        }

        const uint32_t seq = outbox::next_sequence();

        char event_id[72];
        std::snprintf(event_id, sizeof(event_id), "%s-%06lu", machine_id, static_cast<unsigned long>(seq));

        // A real timestamp when the clock is known, uptime otherwise.
        char stamp[32];
        const bool clock_ok = std::time(nullptr) > 1700000000;
        if (clock_ok)
        {
            const std::time_t now = std::time(nullptr);
            std::tm utc{};
            gmtime_r(&now, &utc);
            std::strftime(stamp, sizeof(stamp), "%Y-%m-%dT%H:%M:%SZ", &utc);
        }

        vmaas::SaleLine line;
        line.event_id = event_id;
        line.sequence_number = seq;
        line.slot = o.slot;
        line.price_minor = o.price_minor;
        line.received_minor = o.credit_minor;
        line.status = o.sale_status;
        line.reason = reason;
        line.occurred_at = clock_ok ? stamp : nullptr;
        line.uptime_ms = static_cast<uint32_t>(esp_timer_get_time() / 1000);
        // Copied, not pointed at: config_sync may swap the table mid-format.
        char currency[sizeof(table.currency)] = {};
        if (price_mutex != nullptr && xSemaphoreTake(price_mutex, portMAX_DELAY) == pdTRUE)
        {
            std::snprintf(currency, sizeof(currency), "%s", table.currency);
            xSemaphoreGive(price_mutex);
        }
        line.currency = currency;

        char text[outbox::MAX_LINE];
        if (vmaas::format_sale_line(line, text, sizeof(text)) == 0)
        {
            ESP_LOGE(TAG, "could not format the sale line");
            return false;
        }

        const esp_err_t err = outbox::append(text);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "outbox append failed: %s", esp_err_to_name(err));
            return false;
        }

        ESP_LOGI(TAG, "settled %s", text);
        return true;
    }

    /// Apply one machine output: settle first, then act.
    void apply(const vmaas::PurchaseOutput &o, const char *reason)
    {
        const bool was_already_settled = (prev_state_ == vmaas::PurchaseState::Settled);
        prev_state_ = o.state;

        port.set_inhibit(o.inhibit_coins);

        if (o.stop_motor && motor_ != nullptr)
        {
            ESP_LOGW(TAG, "no DONE for slot %u within the dispense timeout; sending STOP", static_cast<unsigned>(o.slot));
            if (!motor_->stop()) {
                ESP_LOGE(TAG, "STOP was not sent");
            }
        }

        if (o.settle_sale && !settle(o, reason))
        {
            notice_until_ms = 0;
            show("MACHINE FAULT", "no sale recorded");
            settled_until_ms = static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS) + SETTLED_HOLD_MS;
            machine->reset();
            return;
        }

        if (o.run_slot && motor_ != nullptr)
        {
            ESP_LOGI(TAG, "paid: running slot %u", static_cast<unsigned>(o.slot));

            if (!motor_->run(o.slot))
            {
                ESP_LOGE(TAG, "RUN for slot %u was not sent", static_cast<unsigned>(o.slot));
                apply(machine->dispense_failed(static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS)), "run_not_sent");
                return;
            }
        }

        if (notice_until_ms == 0) render(o);

        if (o.state == vmaas::PurchaseState::Settled && !was_already_settled) {
            settled_until_ms = static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS) + SETTLED_HOLD_MS;
        }
    }

    /**
     * @brief The outbox drain task: its own FreeRTOS task because an HTTPS
     *        POST takes seconds and must never stall a customer mid-payment.
     *
     * @note Mutex ordering: device_api::drain_outbox_once() takes and
     *       releases outbox's mutex and then device_api's mutex in turn, one
     *       at a time, never both together — that is what makes it
     *       deadlock-proof by construction against the main loop's
     *       apply()/settle() path, which only ever takes outbox's mutex.
     *       Both mutexes use portMAX_DELAY, so nesting them in opposite
     *       orders anywhere would be a permanent, silent deadlock (the
     *       machine would simply stop selling), not a crash. Never call into
     *       outbox while holding device_api's lock, or the reverse — keep
     *       every acquisition of the two mutexes on this task and the main
     *       loop's task strictly one-at-a-time.
     */
    void drain_task(void *)
    {
        while (true)
        {
            if (outbox::pending() > 0)
            {
                device_api::drain_outbox_once();
            }
            vTaskDelay(DRAIN_INTERVAL);
        }
    }
}

namespace purchase_task
{
    bool begin(vmaas::GroveLcdRgb &lcd, bool display_ok, MotorClient &motor, uint32_t dispense_timeout_ms)
    {
        lcd_ = &lcd;
        display_ok_ = display_ok;
        motor_ = &motor;

        if (price_mutex == nullptr) price_mutex = xSemaphoreCreateMutex();
        if (price_mutex == nullptr)
        {
            ESP_LOGE(TAG, "could not create the price lock; cash sales disabled");
            return false;
        }

        if (!prices::load(coin_cfg, purchase_cfg, table))
        {
            ESP_LOGE(TAG, "no price table: cash sales disabled");
            return false;
        }

        purchase_cfg.dispense_timeout_ms = dispense_timeout_ms;

        outbox::begin();

        static vmaas::CoinAcceptor acc(coin_cfg);
        static vmaas::Purchase mac(purchase_cfg);
        acceptor = &acc;
        machine = &mac;

        const int inhibit = purchase_cfg.has_inhibit ? Pins::INHIBIT_OUT : -1;
        const esp_err_t err = port.begin(Pins::COIN_IN, inhibit);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "coin port failed: %s; cash sales disabled", esp_err_to_name(err));
            return false;
        }

        if (xTaskCreate(drain_task, "outbox_drain", Config::drain_task_stack, nullptr, Config::drain_task_priority, nullptr) != pdPASS){
            ESP_LOGE(TAG, "drain task did not start; sales will queue only");
        }

        cash_enabled = true;
        ESP_LOGI(TAG, "cash enabled: COIN on GPIO%d, inhibit %s, dispense timeout %lu ms", Pins::COIN_IN, inhibit >= 0 ? "wired" : "absent", static_cast<unsigned long>(purchase_cfg.dispense_timeout_ms));

        apply(machine->reset(), nullptr);
        return true;
    }

    void set_prices(const prices::Table &fresh)
    {
        if (price_mutex == nullptr)
        {
            ESP_LOGE(TAG, "set_prices before begin(); the new prices are on flash but not live");
            return;
        }

        if (xSemaphoreTake(price_mutex, portMAX_DELAY) != pdTRUE) return;
        table = fresh;
        xSemaphoreGive(price_mutex);

        if (cash_enabled) {
            ESP_LOGI(TAG, "prices updated live");
        }
        else {
            // begin() never reached the coin port, so nothing counts pulses yet.
            ESP_LOGW(TAG, "prices updated, but cash was disabled at boot; a restart is needed to sell");
        }
    }

    void on_slot_confirmed(uint8_t slot)
    {
        if (!cash_enabled) return;

        uint32_t price = 0;
        if (price_mutex != nullptr && xSemaphoreTake(price_mutex, portMAX_DELAY) == pdTRUE)
        {
            price = prices::for_slot(table, slot);
            xSemaphoreGive(price_mutex);
        }

        if (price == 0)
        {
            ESP_LOGW(TAG, "slot %u has no price", static_cast<unsigned>(slot));
            show(nullptr, "Slot not for sale");
            notice_until_ms = static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS) + SETTLED_HOLD_MS;
            return;
        }

        const uint32_t now = static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS);
        apply(machine->slot_chosen(slot, price, now), nullptr);
    }

    void on_dispense_done()
    {
        if (!cash_enabled) return;
        const uint32_t now = static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS);
        const vmaas::PurchaseOutput o = machine->dispense_done(now);
        if (!(o.state == vmaas::PurchaseState::Settled && o.sale_status == vmaas::SaleStatus::Completed))
        {
            ESP_LOGW(TAG, "DONE with no vend in progress (late after timeout?); sale record unchanged");
        }
        apply(o, nullptr);
    }

    void on_dispense_failed()
    {
        if (!cash_enabled) return;
        const uint32_t now = static_cast<uint32_t>(xTaskGetTickCount() * portTICK_PERIOD_MS);
        apply(machine->dispense_failed(now), "motor_nak");
    }

    void tick(uint32_t now_ms)
    {
        if (!cash_enabled) return;

        vmaas::CoinEdge edge;
        while (port.next(edge)) {
            acceptor->on_edge(edge.at_ms, edge.level);
        }

        vmaas::CoinEvent ev;
        while (acceptor->tick(now_ms, ev))
        {
            ESP_LOGI(TAG, "coin: %u pulses = %lu minor", static_cast<unsigned>(ev.pulses), static_cast<unsigned long>(ev.value_minor));
            apply(machine->coin(ev.value_minor, now_ms), nullptr);
        }

        const uint32_t drops = port.dropped_edges();
        if (drops != last_dropped_edges)
        {
            ESP_LOGE(TAG, "coin edges dropped: %lu total — a coin value may be wrong; check the loop is not being starved", static_cast<unsigned long>(drops));
            last_dropped_edges = drops;
        }

        const vmaas::PurchaseOutput tick_out = machine->tick(now_ms);
        apply(tick_out, tick_out.stop_motor ? "done_timeout" : nullptr);
        if (settled_until_ms != 0 && now_ms >= settled_until_ms)
        {
            settled_until_ms = 0;
            if (tick_out.state == vmaas::PurchaseState::Settled) {
                apply(machine->reset(), nullptr);
            }
        }

        if (notice_until_ms != 0 && now_ms >= notice_until_ms)
        {
            notice_until_ms = 0;
            render(tick_out);
        }
    }

    bool active() { return cash_enabled; }

    bool idle() { return !cash_enabled || prev_state_ == vmaas::PurchaseState::Idle; }

    void set_motor_fault(bool fault_on)
    {
        if (fault_on == motor_fault_active_) return;

        motor_fault_active_ = fault_on;
        if (!fault_on)
        {
            last_row0[0] = '\0';
            last_row1[0] = '\0';
        }
    }
}
