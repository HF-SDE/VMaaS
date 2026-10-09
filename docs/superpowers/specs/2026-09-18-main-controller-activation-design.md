# Main-Controller Activation — Design (subsystem A)

**Date:** 2026-09-18
**Status:** Approved
**Scope:** Main-Controller firmware (ESP-IDF 6.1, ESP32-WROVER), `shared/vmaas-config`, `shared/vmaas-entry`
**Builds on:** `2026-09-17-main-controller-wifi-onboarding-design.md` (implemented, verified on hardware)

## 1. Goal

A technician sets a new machine on Wi-Fi, types a 12-character code off the
customer's screen, and the machine ends up holding a certificate that lets it
speak to the platform. Subsystems B (MQTT over mTLS) and C (configuration and
self-test) build on that certificate; neither is in scope here.

## 2. What the platform already does

Verified end to end by a throwaway spike on 2026-09-18, against the real backend
and a real EMQX. Not assumed — measured.

- Machines are **pre-registered** by the platform. A customer *claims* one, they
  do not create it: `claimMachineService` does `findUnique({ where: { serialNumber } })`
  and returns `MACHINE_NOT_FOUND` if the row is absent.
- `POST /api/machines/claim { serialNumber, siteId }` returns
  `{ machineId, oneTimeCode, expiresAt }`. The code is 12 characters, TTL 60 minutes.
- `POST /api/device/activate { machineId, code, csr }` returns:

```json
{ "certificate": "-----BEGIN CERTIFICATE-----…",
  "caCertificate": "-----BEGIN CERTIFICATE-----…",
  "machineId": "…", "tenantId": "…", "siteId": "…",
  "topicPrefix": "v1/{tenantId}/{siteId}/{machineId}",
  "mqtt": { "host": "localhost", "port": 8883 } }
```

- The issued certificate's subject is `CN=<machineId>, OU=<serial>, O=VMaaS`,
  built by the backend from the activation record — **not** from the CSR, so the
  CSR's own subject is ignored. Validity 90 days. EKU: TLS Web Client Authentication.
- EC P-256 CSRs are accepted. The measured CSR was 386 bytes against a schema
  limit of 8192.
- The device certificate completes a TLS 1.3 mTLS handshake against EMQX's
  device listener on 8883, verified against the returned `caCertificate`.

**The consequence that shaped this design:** the device needs only its
`machineId` and the typed code. Tenant, site, topic prefix, broker address and
the CA all come back from `/activate`, so none of them belong in `config.json`.

## 3. Identity: where `machineId` comes from

The machine row exists in the platform database **before the hardware ships** —
that is what makes claiming by serial number possible. So `machineId` is known at
flash time and is written into `config.json` per unit.

`Main-Controller/data/config.json` in git becomes a **template** with
`"machine_id": ""`. Empty means "not assigned yet", and the firmware says so
plainly rather than attempting an activation that cannot succeed. Filling it in
is one field before `uploadfs`, not a tool to be built.

This is the same shape as the BLE device name, with one difference: a name can
be derived from the MAC when empty, and a `machineId` cannot.

## 4. Where activation sits

Inside `onboarding::run()`, which now returns only once the machine is **both
online and activated**. The flow already owns the keypad and the display during
first-time setup, and activation is part of that setup — the technician is
standing there either way.

Rejected: a separate `activation::run()` after onboarding (two near-identical
loops and a twin of `OnboardingFlow`), and activating in the background while the
sales loop runs (an unactivated machine can neither report sales nor receive
commands, so it would sell blind and nobody would know).

## 5. Screens

```
        Wi-Fi connected
              │
              ▼
┌────────────────┐        ┌────────────────┐        ┌────────────────┐
│Setup code      │   #    │Activating...   │        │Activated       │
│AB3F_           │  ───►  │                │  ───►  │VM-DCD71696     │
│ B C D[E]F G H J│        │                │        └────────────────┘
└────────────────┘        └────────────────┘              │ 2 s, green
   white                     yellow                       ▼ sales screen
```

The failure screen mirrors the Wi-Fi one:

```
┌────────────────┐
│Code rejected   │   red
│5=retry         │
└────────────────┘
```

There is no `*=back`: there is nothing to go back to. Wi-Fi is already
configured, and the only way forward is a valid code.

## 6. The code alphabet

```
ABCDEFGHJKLMNPQRSTUVWXYZ23456789      32 characters, code length 12
```

`I`, `O`, `0` and `1` are deliberately absent — the characters people confuse
when reading them off a screen. There is exactly one character set, so the code
screen has **no charset cycling** and key `2` is unused there.

With the picker's ±1 and ±5 movement this is roughly 45-50 presses for twelve
characters. Slow, and done once in a machine's life.

## 7. Dependencies this adds

| | |
|---|---|
| **A clock** | TLS cannot check `notBefore`/`notAfter` without one. SNTP (`esp_netif_sntp.h`) must run **and succeed** before activation is attempted, or the handshake fails with an error that looks nothing like a time problem. |
| **`CONFIG_MBEDTLS_X509_CSR_WRITE_C=y`** | CSR writing is behind a Kconfig option. Without it the build succeeds and the function simply is not there — the same trap Bluetooth set in the previous subsystem. |
| **`CONFIG_MBEDTLS_CERTIFICATE_BUNDLE=y`** | Mozilla's root store, shipped with ESP-IDF, used to verify `https://vmaas.dk/api`. No pinning, no bundle to maintain. If the API ever moves behind a private CA this has to change. |
| **EC P-256** | Not RSA. RSA-2048 key generation on an ESP32 takes 30-60 seconds with the technician watching; P-256 takes milliseconds. The spike confirmed the backend accepts it. |

## 8. `config.json` schema v2

```json
{
  "version": 2,
  "device":  { "name": "", "machine_id": "" },
  "backend": { "api_base_url": "https://vmaas.dk/api" },
  "timings": { "keypad_debounce_ms": 20,
               "slot_entry_timeout_ms": 10000,
               "slot_entry_result_hold_ms": 2000 }
}
```

`mqtt_host`, `mqtt_port` and `client_id` are **removed**: the first two come back
from `/activate`, and the client id is the certificate's CN. Carrying them would
be three fields that can disagree with the platform.

`api_base_url` is the only thing the device must be told about the backend.

A v1 file still parses — `version` above `DEVICE_SCHEMA_VERSION` already yields
`NewerVersion` and keeps going — but its `backend` section is ignored, so a v1
file leaves `api_base_url` empty and activation reports that it has nowhere to go.

## 9. What is stored, and where

NVS, namespace `activation`:

| Key | |
|---|---|
| `key` | The EC P-256 private key, PEM. Written once; never leaves the device. |
| `cert` | The issued device certificate, PEM. |
| `ca` | `caCertificate` from the response — used in subsystem B to verify the **broker**. |
| `tenant`, `site`, `prefix` | Identity and topic prefix from the response. |
| `mqtt_host`, `mqtt_port` | Broker address from the response. |

`activation::has_certificate()` reading a non-empty `cert` is what makes the
machine "activated"; nothing else is consulted.

**Known and accepted:** NVS is not encrypted unless flash encryption is enabled.
Someone with physical access and a USB cable can read the private key out. Flash
encryption is a separate decision with its own consequences for debugging, and is
deliberately not part of this subsystem.

## 10. Failure handling

| Situation | Behaviour |
|---|---|
| `machine_id` empty in config | `No machine id` on the display, activation not attempted. The firmware says what is wrong rather than failing an HTTP call for an unknowable reason. |
| SNTP does not get the time | Retry with backoff; do not attempt activation. A TLS failure caused by a wrong clock is unreadable in the field. |
| `api_base_url` empty | `No API address` — same reasoning. |
| Code rejected (`ACTIVATION_CODE_INVALID`) | `Code rejected` / `5=retry`, back to the code screen with the field cleared. |
| Attempts exhausted, or code expired | `Code expired` / `Claim again`. The technician must have the customer claim the machine a second time — there is no path forward from the device. |
| HTTPS or network failure | `Cannot reach server` / `5=retry`. Distinguished from a rejection, because the fix is different. |
| **Activation never succeeds** | **The machine stays in setup and does not sell.** An unactivated machine cannot report a sale or receive a command, so selling would be selling blind with nobody the wiser. Decided by the user on 2026-09-18. |

## 11. Components

| File | |
|---|---|
| `shared/vmaas-entry/src/onboarding_flow.{h,cpp}` | MODIFY. Three screens: `CodeEntry`, `Activating`, `Activated`, plus the two failure screens. A second `TextEntry` for the code, with the fixed 32-character alphabet and no charset cycling. |
| `shared/vmaas-entry/src/text_entry.{h,cpp}` | MODIFY. A charset the caller supplies, so the code screen can use one fixed alphabet rather than the four-way cycle. |
| `shared/vmaas-config/src/device_config.{h,cpp}` | MODIFY. Schema v2: `api_base_url` in, the three MQTT fields out. |
| `Main-Controller/src/activation.{h,cpp}` | NEW. Key generation, CSR, the HTTPS call, response parsing, NVS storage. |
| `Main-Controller/src/onboarding.cpp` | MODIFY. Drive the new screens; call `activation`. |
| `Main-Controller/sdkconfig.defaults` | MODIFY. The two mbedtls options. |

## 12. Testing

**Host** — everything that can be tested without hardware:

| Suite | |
|---|---|
| `test_text_entry` | Extended: a caller-supplied charset, and that no cycling happens when only one is given. |
| `test_onboarding_flow` | Extended: the three new screens, the two failure screens, `5=retry` clearing the field, and that `done` is false until a certificate exists. |
| `test_device_parse` / `test_device_validate` | Schema v2: `api_base_url` parsed, the removed fields ignored, a v1 file still usable. |

**Hardware** — the parts that cannot be faked:

1. Empty `machine_id` shows `No machine id` and does not call out.
2. A real claim, a real code, a real certificate stored in NVS.
3. A wrong code shows `Code rejected` and `5=retry` returns with the field cleared.
4. A power cycle after success goes straight to the sales screen: `has_certificate()` is true.
5. The stored certificate completes an mTLS handshake — proven in subsystem B, but the bytes are checked here.

## 13. Decisions recorded

| Decision | Choice |
|---|---|
| Where activation lives | A phase inside `onboarding::run()` |
| `machineId` source | `config.json`, per unit, flashed at manufacture |
| API address | `https://vmaas.dk/api`, in `config.json` |
| Trust anchor | `esp_crt_bundle` (Mozilla roots) |
| Key type | EC P-256 |
| On permanent activation failure | Stay in setup; do not sell |
| Flash encryption | Out of scope, and explicitly noted as unresolved |
