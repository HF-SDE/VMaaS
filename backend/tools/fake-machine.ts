import "reflect-metadata";
import * as x509 from "@peculiar/x509";
import { Agent, fetch as undiciFetch } from "undici";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import mqtt from "mqtt";

/**
 * Stands in for the MachineController, which this project does not implement.
 * Drives the device side of activation: exchange a one-time code and a CSR
 * for a client certificate, connect to the broker over mTLS, subscribe to its
 * own `commands` topic, then fetch its configuration over HTTPS.
 *
 * MQTT now carries only `commands` and `command-results`. Configuration
 * delivery is an HTTP concern (`GET /api/device/configuration`,
 * mTLS-authenticated with the same certificate as the broker connection) —
 * nothing device-initiated happens on MQTT any more, so this script no
 * longer publishes a configuration request or waits for a command in
 * response to one.
 *
 * Usage, against a running compose stack:
 *   npm run fake-machine -- --machine <uuid> --code <one-time code> --ca ./ca.crt
 *
 * The CA certificate is a required input, not something this script skips. A
 * real machine ships with the CA as a trust anchor in firmware, which is what
 * stops an attacker on the network from impersonating the backend during
 * activation — the one moment the machine has no credential of its own. Export
 * it from the running stack first:
 *
 *   docker compose -f ./docker/docker-compose.yml cp emqx:/pki/ca.crt ./ca.crt
 */

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`missing --${name}`);
  }
  return process.argv[index + 1];
}

const ACTIVATE_URL = process.env.ACTIVATE_URL ?? "https://localhost:8443/api/device/activate";
const CONFIGURATION_URL = process.env.CONFIGURATION_URL ?? "https://localhost:8443/api/device/configuration";
const BROKER_URL = process.env.BROKER_URL ?? "mqtts://localhost:8883";

async function main() {
  const machineId = arg("machine");
  const code = arg("code");

  const keys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: `CN=${machineId}`,
    keys,
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
  });

  // The server certificate IS verified, against the CA this machine was given
  // out of band. nginx's :8443 certificate is issued by that CA for the names
  // in pki-init's SAN list, so `localhost` resolves.
  const caPem = await readFile(arg("ca"), "utf8");
  const activateAgent = new Agent({ connect: { ca: caPem, rejectUnauthorized: true } });

  const response = await undiciFetch(ACTIVATE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ machineId, code, csr: csr.toString("pem") }),
    dispatcher: activateAgent,
  });

  if (!response.ok) {
    throw new Error(`activate failed: ${response.status} ${await response.text()}`);
  }

  const activation = (await response.json()) as {
    certificate: string;
    caCertificate: string;
    topicPrefix: string;
    mqtt: { host: string; port: number };
  };

  console.log(`activated. topic prefix ${activation.topicPrefix}`);

  const privateKeyPem = Buffer.from(
    await webcrypto.subtle.exportKey("pkcs8", keys.privateKey),
  ).toString("base64");
  const clientKeyPem = `-----BEGIN PRIVATE KEY-----\n${privateKeyPem.replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;

  // Same client certificate and CA on the HTTPS path as on MQTT (spec D6):
  // one credential for both channels, verified in both directions — the
  // server cert against the CA, and this identity presented to nginx's
  // mTLS-only :8443 listener.
  const deviceAgent = new Agent({
    connect: {
      ca: caPem,
      cert: activation.certificate,
      key: clientKeyPem,
      rejectUnauthorized: true,
    },
  });

  const client = mqtt.connect(BROKER_URL, {
    clientId: machineId,
    cert: activation.certificate,
    key: clientKeyPem,
    ca: activation.caCertificate,
    // The broker's certificate is issued by the CA the backend just handed
    // back, for the name in pki-init's SAN list. Verified, never skipped.
    rejectUnauthorized: true,
    servername: "emqx",
    clean: true,
    // Empirically required (see docs/superpowers/plans/machine-activation-smoke.md):
    // EMQX's authentication chain is [password_based:built_in_database, http].
    // A CONNECT with NO username at all (what the brief's original script
    // sent) is hard-denied by the first entry — "bad_username_or_password" —
    // and never reaches the http entry that actually checks the client
    // certificate. Any non-empty username that the built-in table has no
    // record of makes that first entry answer "ignore" instead, so the chain
    // falls through to the http authenticator. The value carries no
    // authority: decideAuthn/decideAuthz (mqtt-auth.controller.ts) key off
    // `cert_subject` and never read `username`. This is a placeholder to
    // satisfy that chain quirk, not a credential.
    username: machineId,
    password: "unused-placeholder-see-comment-above",
  });

  client.on("error", (error) => {
    console.error("connect failed:", error.message);
    process.exit(1);
  });

  client.on("close", () => {
    console.log("connection closed");
  });

  client.on("connect", () => {
    console.log("connected over mTLS");

    // A literal, fully-qualified topic — never a wildcard. backend/src/mqtt/
    // acl.ts's authorizeTopic calls parseTopic, which returns null for any
    // topic containing "#" or "+" by design (see its docstring and the
    // passing test "denies a wildcard subscribe under its own prefix" in
    // mqtt/__tests__/acl.test.ts), and with `deny_action = disconnect` in
    // emqx.conf a denied subscribe drops the whole session, not just that one
    // packet. `apply-configuration` is used here as a fixed, plausible
    // command name; nothing in this architecture publishes to it today (see
    // the runbook), so this subscribe is only proof that the ACL allows a
    // machine's own literal `commands` topic — not a round trip.
    client.subscribe(`${activation.topicPrefix}/commands/apply-configuration`, { qos: 1 }, async (error) => {
      if (error) {
        console.error("subscribe rejected:", error.message);
        process.exit(1);
      }
      console.log("subscribed to own commands");

      // Configuration delivery is HTTP now, not MQTT: GET
      // /api/device/configuration, mTLS-authenticated with the same
      // certificate as the broker connection.
      try {
        const configResponse = await undiciFetch(CONFIGURATION_URL, { dispatcher: deviceAgent });
        if (configResponse.ok) {
          const configuration = (await configResponse.json()) as { version: number };
          console.log(`fetched configuration version ${configuration.version} over HTTP`);
        } else {
          console.log(`configuration fetch returned ${configResponse.status}: ${await configResponse.text()}`);
        }
      } catch (fetchError) {
        console.error("configuration fetch failed:", (fetchError as Error).message);
      }

      // Cross-tenant probe: proving the ACL still refuses cross-tenant
      // traffic is the most valuable thing this script does. `events` is
      // gone from the taxonomy, so the probe now targets `command-results` —
      // a channel that still exists — under a tenant this machine does not
      // belong to. Sent last, right before closing: `deny_action = disconnect`
      // means the denial tears down the whole session, so anything sent
      // after it would never arrive.
      client.publish(
        "v1/00000000-0000-4000-8000-000000000000/x/y/command-results/cmd-probe",
        JSON.stringify({ status: "completed" }),
        { qos: 1 },
      );
      console.log("sent cross-tenant probe (expected to be denied)");

      setTimeout(() => client.end(), 500);
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
