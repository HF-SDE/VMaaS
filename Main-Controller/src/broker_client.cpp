/**
 * @file broker_client.cpp
 * @brief mTLS MQTT connection to the platform broker.
 */
#include "broker_client.h"

#include <cstdio>
#include <cstring>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "activation.h"
#include "broker_endpoint.h"
#include "config.h"
#include "config_sync.h"
#include "esp_log.h"
#include "mqtt_client.h"
#include "wifi_sta.h"

namespace
{
    constexpr const char* TAG = "BrokerClient";

    /**
     * esp-mqtt does not copy the PEMs it is handed ("not copied nor freed by
     * the client"), so every buffer below has to outlive the client, which
     * lives for the rest of uptime. Statics rather than a heap block freed
     * after start(), which would leave the TLS layer reading freed memory on
     * its first reconnect.
     *
     * An EC P-256 key in PEM is about 240 bytes and a certificate under a
     * kilobyte, so there is room for a longer chain.
     */
    constexpr size_t CERT_PEM_LEN = 2048;
    constexpr size_t KEY_PEM_LEN  = 512;
    constexpr size_t CA_PEM_LEN   = 2560;

    char cert_pem[CERT_PEM_LEN];
    char key_pem[KEY_PEM_LEN];
    char ca_pem[CA_PEM_LEN];

    /// Host and client id are handed to esp-mqtt by pointer too, so this stays put.
    activation::Identity identity;
    /// Where we actually dial: activation's value unless config.json overrode it.
    /// Resolved once in load_credentials(), read by the event handler and connect_now().
    vmaas::BrokerEndpoint endpoint{};

    esp_mqtt_client_handle_t client = nullptr;
    volatile bool connected = false;

    /// Guards start(). Not `client != nullptr`: the connect task assigns that
    /// minutes later if Wi-Fi is slow, so a second start() would still see null.
    bool started = false;

    /// The one topic the platform sends commands on, built once from the
    /// identity. `{topic_prefix}/commands` with no per-command segment: the
    /// command id travels in the payload precisely so this string is constant
    /// and can be subscribed to. The backend's ACL refuses every wildcard, so a
    /// per-command topic would be unsubscribable.
    char commands_topic[activation::TOPIC_PREFIX_MAX + sizeof("/commands")] = {};

    /// QoS 1, matching the publisher. The platform sends at-least-once because
    /// a missed configuration command is a machine left on stale wiring.
    constexpr int COMMANDS_QOS = 1;

    /// Largest command payload accepted, matching config_sync's own limit.
    /// Today's commands are under 200 bytes.
    constexpr size_t COMMAND_JSON_MAX = 512;

    /// Gap between polls while waiting for the first IP address.
    constexpr TickType_t WIFI_POLL = pdMS_TO_TICKS(1000);

    /// How often the "still waiting" line is logged, so the wait is visible but not noisy.
    constexpr int WIFI_LOG_EVERY = 30;

    void on_event(void*, esp_event_base_t, int32_t id, void* data)
    {
        const auto* ev = static_cast<esp_mqtt_event_handle_t>(data);

        switch (static_cast<esp_mqtt_event_id_t>(id))
        {
        case MQTT_EVENT_CONNECTED:
            connected = true;
            ESP_LOGI(TAG, "connected to %s:%u, machine reads Online from here", endpoint.host, static_cast<unsigned>(endpoint.port));

            if (commands_topic[0] != '\0')
            {
                const int id = esp_mqtt_client_subscribe(client, commands_topic, COMMANDS_QOS);
                if (id < 0)
                {
                    ESP_LOGE(TAG, "subscribe to %s failed to enqueue", commands_topic);
                }
            }
            break;

        case MQTT_EVENT_SUBSCRIBED:
            ESP_LOGI(TAG, "subscribed to %s", commands_topic);
            break;

        case MQTT_EVENT_DATA:
            if (ev != nullptr && ev->data != nullptr)
            {
                ESP_LOGI(TAG, "command received on %.*s: %.*s", ev->topic_len, ev->topic ? ev->topic : "", ev->data_len, ev->data);

                char json[COMMAND_JSON_MAX] = {};
                if (ev->data_len > 0 && static_cast<size_t>(ev->data_len) < sizeof(json))
                {
                    std::memcpy(json, ev->data, static_cast<size_t>(ev->data_len));

                    config_sync::on_command(json);
                }
                else
                {
                    ESP_LOGE(TAG, "command payload is %d bytes, over the %u-byte limit; dropping it", ev->data_len, static_cast<unsigned>(sizeof(json) - 1));
                }
            }
            break;

        case MQTT_EVENT_DISCONNECTED:
            connected = false;
            ESP_LOGW(TAG, "disconnected, retrying; machine reads Offline until it is back");
            break;

        case MQTT_EVENT_ERROR:
            if (ev != nullptr && ev->error_handle != nullptr)
            {
                ESP_LOGE(TAG, "mqtt error: type %d, connect rc %d, tls esp_err 0x%x, tls stack 0x%x, cert verify flags 0x%x, socket errno %d", static_cast<int>(ev->error_handle->error_type), static_cast<int>(ev->error_handle->connect_return_code), static_cast<int>(ev->error_handle->esp_tls_last_esp_err), ev->error_handle->esp_tls_stack_err, ev->error_handle->esp_tls_cert_verify_flags, ev->error_handle->esp_transport_sock_errno);
            }
            else
            {
                ESP_LOGE(TAG, "mqtt error with no detail attached");
            }
            break;

        default:
            break;
        }
    }

    /// Load the identity and the three PEMs out of NVS. All or nothing.

    esp_err_t load_credentials(const vmaas::DeviceConfig& cfg)
    {
        esp_err_t err = activation::load_identity(identity);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "no stored identity: %s", esp_err_to_name(err));
            return err;
        }

        const int written = std::snprintf(commands_topic, sizeof(commands_topic), "%s/commands", identity.topic_prefix);
        if (written < 0 || static_cast<size_t>(written) >= sizeof(commands_topic))
        {
            commands_topic[0] = '\0';
            ESP_LOGE(TAG, "topic prefix does not fit the commands topic buffer; no commands will be received");
        }

        if ((err = activation::load_certificate(cert_pem, sizeof(cert_pem))) != ESP_OK)
        {
            ESP_LOGE(TAG, "cannot read the device certificate: %s", esp_err_to_name(err));
            return err;
        }

        if ((err = activation::load_private_key(key_pem, sizeof(key_pem))) != ESP_OK)
        {
            ESP_LOGE(TAG, "cannot read the private key: %s", esp_err_to_name(err));
            return err;
        }

        if ((err = activation::load_broker_ca(ca_pem, sizeof(ca_pem))) != ESP_OK)
        {
            ESP_LOGE(TAG, "cannot read the broker CA: %s", esp_err_to_name(err));
            return err;
        }

        endpoint = vmaas::broker_endpoint(cfg.broker_host, cfg.broker_port, identity.mqtt_host, identity.mqtt_port);

        ESP_LOGI(TAG, "broker %s:%u (host from %s, port from %s)",
                 endpoint.host, static_cast<unsigned>(endpoint.port),
                 endpoint.host_overridden ? "config.json" : "activation",
                 endpoint.port_overridden ? "config.json" : "activation");

        if (!endpoint.usable)
        {
            ESP_LOGE(TAG, "no broker address from either source; machine stays Offline");
            return ESP_ERR_INVALID_STATE;
        }

        return ESP_OK;
    }

    esp_err_t connect_now()
    {
        esp_mqtt_client_config_t cfg = {};

        cfg.broker.address.hostname  = endpoint.host;
        cfg.broker.address.port      = endpoint.port;
        cfg.broker.address.transport = MQTT_TRANSPORT_OVER_SSL;

        // The broker server certificate is verified against the CA the
        // platform returned at activation, not against the Mozilla bundle:
        // this is a private PKI.
        cfg.broker.verification.certificate = ca_pem;

        // The same client certificate the HTTP device API uses.
        cfg.credentials.authentication.certificate = cert_pem;
        cfg.credentials.authentication.key         = key_pem;

        // EMQX overrides this from the certificate CN (peer_cert_as_clientid =
        // cn), which is why connection.service.ts can trust the reported
        // clientid as a machine id. Set anyway so the two agree in the broker
        // client list and in a packet capture.
        cfg.credentials.client_id = identity.machine_id;

        // Not a credential: decideAuthn in mqtt-auth.controller.ts resolves the
        // machine from `cert_subject` and never reads `username`. It is set
        // because a CONNECT with no username at all can be refused by a
        // `password_based` authenticator before the certificate webhook behind
        // it is reached, with an error that reads as a credential problem.
        cfg.credentials.username                = identity.machine_id;
        cfg.credentials.authentication.password = "unused-see-comment-above";

        cfg.session.keepalive = Config::broker_keepalive_s;

        client = esp_mqtt_client_init(&cfg);
        if (client == nullptr)
        {
            ESP_LOGE(TAG, "esp_mqtt_client_init failed");
            return ESP_FAIL;
        }

        esp_err_t err = esp_mqtt_client_register_event(client, MQTT_EVENT_ANY, on_event, nullptr);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "register_event failed: %s", esp_err_to_name(err));
            esp_mqtt_client_destroy(client);
            client = nullptr;
            return err;
        }

        err = esp_mqtt_client_start(client);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "esp_mqtt_client_start failed: %s", esp_err_to_name(err));
            esp_mqtt_client_destroy(client);
            client = nullptr;
            return err;
        }

        return ESP_OK;
    }

    /**
     * The first connect, and only the first: esp-mqtt reconnects on its own
     * afterwards, including across a Wi-Fi drop, so this task starts the client
     * once and then exits.
     *
     * It waits for the network without a deadline. A machine whose Wi-Fi never
     * comes up reads Offline anyway; giving up after a timeout would leave one
     * that gets its network back an hour later stuck Offline until someone
     * power-cycles it.
     */
    void connect_task(void*)
    {
        for (int waited = 0; !wifi_sta::is_connected(); ++waited)
        {
            if (waited % WIFI_LOG_EVERY == 0){
                ESP_LOGI(TAG, "waiting for Wi-Fi before connecting to the broker");
            }
            vTaskDelay(WIFI_POLL);
        }

        while (activation::sync_time(Config::broker_sntp_timeout_ms) != ESP_OK)
        {
            ESP_LOGE(TAG, "no clock yet, cannot verify the broker certificate; retrying");
            vTaskDelay(pdMS_TO_TICKS(Config::broker_clock_retry_ms));
        }

        if (connect_now() != ESP_OK) {
            ESP_LOGE(TAG, "broker connection could not be started; machine stays Offline until reboot");
        }

        ESP_LOGI(TAG, "stack headroom in the connect task: %u bytes", static_cast<unsigned>(uxTaskGetStackHighWaterMark(nullptr)));

        vTaskDelete(nullptr);
    }
}

namespace broker_client
{
    esp_err_t start(const vmaas::DeviceConfig& cfg)
    {
        if (started)
        {
            ESP_LOGW(TAG, "already started");
            return ESP_OK;
        }

        if (!activation::has_certificate())
        {
            ESP_LOGW(TAG, "not activated, no broker connection; machine reads Offline");
            return ESP_ERR_INVALID_STATE;
        }
        
        const esp_err_t err = load_credentials(cfg);
        if (err != ESP_OK) return err;

        const BaseType_t ok = xTaskCreate(connect_task, "broker", Config::broker_task_stack, nullptr, Config::broker_task_priority, nullptr);
        if (ok != pdPASS)
        {
            ESP_LOGE(TAG, "could not start the broker connect task");
            return ESP_ERR_NO_MEM;
        }

        started = true;
        return ESP_OK;
    }

    bool is_connected()
    {
        return connected;
    }
}
