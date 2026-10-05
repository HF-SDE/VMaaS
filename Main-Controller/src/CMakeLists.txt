# PlatformIO generates this file when it is absent. It is committed, and edited
# by hand, because the app needs REQUIRES that the generated version does not
# have: without them a component's headers are simply not on the include path
# and the build fails with "No such file or directory", not with a link error.

FILE(GLOB_RECURSE app_sources ${CMAKE_SOURCE_DIR}/src/*.*)

# Naming any REQUIRES replaces the implicit set, so everything the app includes
# has to be listed here - including what used to arrive transitively through
# network_provisioning.
idf_component_register(
    SRCS ${app_sources}
    REQUIRES
        # Wi-Fi, networking and the event loop.
        esp_wifi
        esp_netif          # also esp_netif_sntp.h: the clock TLS needs
        esp_event
        lwip
        nvs_flash

        # Activation: key generation, CSR writing, HTTPS and JSON.
        mbedtls            # ctr_drbg, entropy, ecp, pk, x509_csr
        esp-tls            # esp_crt_bundle.h - Mozilla's roots
        esp_http_client
        espressif__cjson   # cJSON (a managed component since ESP-IDF 6)

        # The broker connection the admin UI reads Online/Offline from.
        espressif__mqtt

        # esp_bt.h: main hands the controller's reserved RAM back when
        # onboarding did not leave Bluetooth running.
        bt

        # Storage and peripherals.
        esp_partition
        spi_flash
        driver
        esp_timer
)
