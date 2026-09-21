import { chmod, chown, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  createCertificateAuthority,
  createServerCertificate,
  loadCertificateAuthority,
} from "../src/lib/pki";

/**
 * Generates the development PKI into the shared `pki` volume. Idempotent: a
 * file's *content* that already exists is left alone, so restarting the
 * stack does not invalidate every certificate already issued to a machine.
 *
 * Ownership and mode are re-applied on EVERY run, independent of whether the
 * content was just written or has existed since an earlier run. That is
 * deliberate: this container runs as root and is the only one with the
 * standing to `chown` these files, so it is also the only place that can
 * durably repair a permission mistake made in the past — a one-off manual
 * `chown` on a running host does not survive the volume being reused by a
 * fresh container, but pki-init running again does.
 *
 * Development only. A real deployment needs the CA key somewhere it can be
 * backed up and access-controlled, which this does not provide.
 */
const DIR = process.env.PKI_DIR ?? "/pki";

/**
 * uid the EMQX container runs as (docker/docker-compose.yml: the
 * `emqx/emqx` image runs its process as this uid, not root — unlike nginx's
 * master process and the backend, which both run as root and so can read a
 * root-owned file regardless of its mode). emqx.key must be owned by exactly
 * this uid: it is the one file in this volume that root's default ownership
 * does not already satisfy. Configurable rather than hardcoded so a change to
 * the emqx image's uid is a one env var edit, not a code change.
 */
const EMQX_UID = Number(process.env.EMQX_UID ?? 1000);

/**
 * Extra names to put in the nginx and EMQX server certificates, comma
 * separated. Empty by default, which is right for a stack reached only from
 * the host and from inside the Docker network.
 *
 * A physical device on the LAN is neither. It reaches nginx and EMQX at the
 * developer's host address, and TLS checks that address against the
 * certificate, so without it here an ESP32 fails the handshake with an error
 * that says nothing about why. That address differs per developer, which is
 * why this is an environment variable and not a line in the list below.
 *
 * Changing it does NOT reissue a certificate that already exists: delete
 * /pki/nginx.crt and /pki/nginx.key (never ca.crt - that would invalidate
 * every certificate already issued to a machine) and let pki-init run again.
 */
const EXTRA_HOSTS = (process.env.PKI_EXTRA_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter((host) => host.length > 0);

/** Certificates: every consumer needs to read them; a public certificate leaking is not a concern. */
const MODE_PUBLIC = 0o644;
/** Private keys: owner-only. Combined with the right owner below, this is what keeps ca.key out of reach of anything but the backend/root. */
const MODE_PRIVATE = 0o600;

async function write(name: string, contents: string, mode: number) {
  await writeFile(path.join(DIR, name), contents, { mode });
  console.log(`pki-init: wrote ${name}`);
}

/**
 * Enforces ownership and mode on a file that already exists, regardless of
 * whether this run created it or a previous one did. Runs as root, so it can
 * `chown` to any uid.
 */
async function fixPerms(name: string, mode: number, uid?: number) {
  const filePath = path.join(DIR, name);
  await chmod(filePath, mode);
  if (uid !== undefined) {
    await chown(filePath, uid, uid);
  }
}

async function main() {
  await mkdir(DIR, { recursive: true });

  if (!existsSync(path.join(DIR, "ca.crt"))) {
    const created = await createCertificateAuthority();
    await write("ca.crt", created.certificatePem, MODE_PUBLIC);
    await write("ca.key", created.privateKeyPem, MODE_PRIVATE);
  } else {
    console.log("pki-init: CA already present, leaving it alone");
  }
  // ca.crt: every consumer (emqx, nginx, backend) verifies peers against it —
  // world-readable is correct, not just tolerable.
  // ca.key: signs every device CSR (backend/src/lib/pki.ts). Only the
  // backend needs it, and the backend runs as root (see
  // docker/docker-compose.yml), so root-only (default owner, since this
  // script also runs as root) already excludes emqx (uid 1000) and nginx's
  // workers (uid nginx) without needing an explicit chown here.
  await fixPerms("ca.crt", MODE_PUBLIC);
  await fixPerms("ca.key", MODE_PRIVATE);

  const ca = await loadCertificateAuthority(
    await readFile(path.join(DIR, "ca.crt"), "utf8"),
    await readFile(path.join(DIR, "ca.key"), "utf8"),
  );

  // keyOwner is set only where the consumer's process does NOT run as root —
  // see EMQX_UID above. nginx's master process (which is what reads
  // ssl_certificate/ssl_certificate_key) runs as root, so root's default
  // ownership already suffices for it, same as ca.key/backend.key below.
  const servers: { name: string; hosts: string[]; keyOwner?: number }[] = [
    { name: "emqx", hosts: ["emqx", "localhost", "127.0.0.1", ...EXTRA_HOSTS], keyOwner: EMQX_UID },
    { name: "nginx", hosts: ["nginx", "reverse-proxy", "localhost", "127.0.0.1", ...EXTRA_HOSTS] },
  ];

  if (EXTRA_HOSTS.length > 0) {
    console.log(`pki-init: PKI_EXTRA_HOSTS adds ${EXTRA_HOSTS.join(", ")} to the server certificates`);
  }

  for (const server of servers) {
    if (!existsSync(path.join(DIR, `${server.name}.crt`))) {
      const issued = await createServerCertificate(ca, server.name, server.hosts, 825);
      await write(`${server.name}.crt`, issued.certificatePem, MODE_PUBLIC);
      await write(`${server.name}.key`, issued.privateKeyPem, MODE_PRIVATE);
    } else {
      console.log(`pki-init: ${server.name} certificate already present`);
    }
    await fixPerms(`${server.name}.crt`, MODE_PUBLIC);
    await fixPerms(`${server.name}.key`, MODE_PRIVATE, server.keyOwner);
  }

  // The platform's own MQTT client. It is authenticated by EMQX's built-in
  // database rather than by the webhook, so the backend can connect while it
  // is itself starting (spec §4.2); the certificate satisfies the listener.
  if (!existsSync(path.join(DIR, "backend.crt"))) {
    const issued = await createServerCertificate(ca, "vmaas-platform", ["backend", "localhost"], 825);
    await write("backend.crt", issued.certificatePem, MODE_PUBLIC);
    await write("backend.key", issued.privateKeyPem, MODE_PRIVATE);
  }
  // The backend runs as root (docker/docker-compose.yml), so — like ca.key —
  // root's default ownership already restricts this to it.
  await fixPerms("backend.crt", MODE_PUBLIC);
  await fixPerms("backend.key", MODE_PRIVATE);

  console.log("pki-init: done");
}

main().catch((error) => {
  console.error("pki-init failed:", error);
  process.exit(1);
});
