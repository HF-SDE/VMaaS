import { readFile } from "node:fs/promises";

import { config } from "@/lib/config";
import { type CertificateAuthority, loadCertificateAuthority } from "@/lib/pki";

/**
 * The CA is read once and kept in memory: signing happens on the activation
 * path, which must not touch the filesystem per request. pki-init writes these
 * files into the `pki` volume before the backend starts.
 *
 * The promise itself is cached (not just its resolved value), so concurrent
 * callers during startup all await the same in-flight read instead of each
 * issuing their own.
 *
 * A REJECTED load must not stick: pki-init and the backend can start in
 * either order, so the first request or two may land before the volume is
 * populated. If a failed promise were cached forever, every activation would
 * fail permanently until the process restarted, even after the files
 * appeared. The `.catch` below clears `cached` back to null on failure, so
 * the next call retries the read instead of replaying the old rejection.
 */
let cached: Promise<CertificateAuthority> | null = null;

async function loadFromDisk(): Promise<CertificateAuthority> {
  const [certificatePem, privateKeyPem] = await Promise.all([
    readFile(config.CA_CERT_PATH, "utf8"),
    readFile(config.CA_KEY_PATH, "utf8"),
  ]);
  return loadCertificateAuthority(certificatePem, privateKeyPem);
}

export function getCertificateAuthority(): Promise<CertificateAuthority> {
  cached ??= loadFromDisk().catch((error: unknown) => {
    cached = null;
    throw error;
  });

  return cached;
}
