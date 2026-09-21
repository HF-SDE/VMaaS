// @peculiar/x509 uses tsyringe internally, which needs this polyfill loaded
// before the module is evaluated — without it, importing x509 throws.
import "reflect-metadata";

import * as x509 from "@peculiar/x509";
import { webcrypto } from "node:crypto";

/**
 * The backend is its own CA. It signs a device CSR only after the activation
 * record has been validated, which is why this lives next to the services
 * rather than behind a separate CA service.
 *
 * The subject is the contract with both proxies:
 *
 *   CN=<machineId>, OU=<certificate serial>, O=VMaaS
 *
 * nginx hands Express `$ssl_client_serial`, EMQX hands the webhook the peer
 * DN. The serial is the one identifier both can produce, so it is the lookup
 * key; the CN is what EMQX derives the MQTT client id from.
 */

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGNING = { name: "ECDSA", hash: "SHA-256" } as const;
const DAY_MS = 86_400_000;
/** Backdate `notBefore` by this much so a device whose clock runs a few minutes fast doesn't see a not-yet-valid certificate on first connect. */
const CLOCK_SKEW_MS = 5 * 60_000;
/** Characters that would let a DN attribute value be read as more than one RDN — see `buildDeviceSubject`. */
const FORBIDDEN_DN_CHARS = /[,+=<>#;"\\\r\n]/;

export type CertificateAuthority = {
  certificate: x509.X509Certificate;
  privateKey: CryptoKey;
};

export type IssuedCertificate = {
  pem: string;
  /** Lowercase hex, no separators. Matches nginx's `$ssl_client_serial` after normalising. */
  serial: string;
  /** SHA-256, lowercase hex. Stored for display and audit only. */
  fingerprint: string;
  subject: string;
  notBefore: Date;
  notAfter: Date;
};

function toPem(der: ArrayBuffer, label: string): string {
  const body = Buffer.from(der).toString("base64").replace(/(.{64})/g, "$1\n").trimEnd();
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

function fromPem(pem: string): ArrayBuffer {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const buffer = Buffer.from(body, "base64");
  // Node pools small Buffers, so `.buffer` can be a larger, shared
  // ArrayBuffer at a nonzero offset — slice out exactly this data.
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function randomSerial(): string {
  const bytes = webcrypto.getRandomValues(new Uint8Array(16));
  // DER strips a leading 0x00 byte (the certificate's real serial would come
  // back shorter than what we generated and embedded in OU=) and prepends a
  // 0x00 sign byte when the top bit is set (harmless — the library strips it
  // straight back off on read). Keeping the first byte in 0x01..0x7f makes
  // both cases a no-op, so the serial we generate, store, and put in OU= is
  // byte-for-byte identical to what the certificate reports.
  bytes[0] = (bytes[0] % 0x7f) + 1;
  return Buffer.from(bytes).toString("hex");
}

async function fingerprintOf(certificate: x509.X509Certificate): Promise<string> {
  const digest = await webcrypto.subtle.digest("SHA-256", certificate.rawData);
  return Buffer.from(digest).toString("hex");
}

export function buildDeviceSubject(machineId: string, serial: string): string {
  // A machineId or serial containing an RDN separator would let its value be
  // read back as extra attributes (e.g. an injected OU= landing ahead of the
  // real one) — reject rather than escape, since a legitimate value never
  // needs one of these characters.
  if (FORBIDDEN_DN_CHARS.test(machineId) || FORBIDDEN_DN_CHARS.test(serial)) {
    throw new Error(
      'Invalid machineId or serial: must not contain , + = < > # ; " \\ or a line break',
    );
  }
  return `CN=${machineId}, OU=${serial}, O=VMaaS`;
}

/** Reads the two fields the proxies need back out of a distinguished name. */
export function parseSubject(dn: string): { machineId: string | null; serial: string | null } {
  const count = (key: string) => (dn.match(new RegExp(`(?:^|,)\\s*${key}=`, "gi")) ?? []).length;
  // A DN carrying a repeated CN= or OU= is either malformed or has been
  // tampered with (an injected attribute ahead of the genuine one). Either
  // way, a first-match read can't tell which one is real, so refuse to guess.
  if (count("CN") > 1 || count("OU") > 1) {
    return { machineId: null, serial: null };
  }

  const read = (key: string) => {
    const match = dn.match(new RegExp(`(?:^|,)\\s*${key}=([^,]+)`, "i"));
    return match ? match[1].trim() : null;
  };
  return { machineId: read("CN"), serial: read("OU") };
}

export async function createCertificateAuthority(): Promise<{
  ca: CertificateAuthority;
  certificatePem: string;
  privateKeyPem: string;
}> {
  const keys = await webcrypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"]);
  const notBefore = new Date();
  const notAfter = new Date(notBefore.getTime() + 3650 * DAY_MS);

  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomSerial(),
    name: "CN=VMaaS Development CA, O=VMaaS",
    notBefore,
    notAfter,
    signingAlgorithm: SIGNING,
    keys,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
    ],
  });

  const privateKeyPem = toPem(await webcrypto.subtle.exportKey("pkcs8", keys.privateKey), "PRIVATE KEY");

  return {
    ca: { certificate, privateKey: keys.privateKey },
    certificatePem: certificate.toString("pem"),
    privateKeyPem,
  };
}

export async function loadCertificateAuthority(
  certificatePem: string,
  privateKeyPem: string,
): Promise<CertificateAuthority> {
  const privateKey = await webcrypto.subtle.importKey(
    "pkcs8",
    fromPem(privateKeyPem),
    ALGORITHM,
    false,
    ["sign"],
  );
  return { certificate: new x509.X509Certificate(certificatePem), privateKey };
}

/**
 * Signs a device CSR. The subject is built from `machineId` — the identity the
 * activation record proved — not from whatever the CSR asked to be called, so
 * a device cannot name itself.
 */
export async function signDeviceCsr(ca: CertificateAuthority, csrPem: string, machineId: string, days: number): Promise<IssuedCertificate> {
  let csr: x509.Pkcs10CertificateRequest;
  try {
    csr = new x509.Pkcs10CertificateRequest(csrPem);
    // Proof of possession: the request must be signed by the key it carries.
    if (!(await csr.verify())) throw new Error("signature does not verify");
  } catch (cause) {
    throw new Error(`CSR_REJECTED: ${cause instanceof Error ? cause.message : "unreadable"}`);
  }

  const serial = randomSerial();
  // Backdated for clock skew; notAfter is computed from notBefore, not "now",
  // so the requested lifetime (days) stays exact — see CLOCK_SKEW_MS.
  const notBefore = new Date(Date.now() - CLOCK_SKEW_MS);
  const notAfter = new Date(notBefore.getTime() + days * DAY_MS);

  const certificate = await x509.X509CertificateGenerator.create({
    serialNumber: serial,
    subject: buildDeviceSubject(machineId, serial),
    issuer: ca.certificate.subject,
    notBefore,
    notAfter,
    signingAlgorithm: SIGNING,
    publicKey: csr.publicKey,
    signingKey: ca.privateKey,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyAgreement,
        true,
      ),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.clientAuth], false),
    ],
  });

  return {
    pem: certificate.toString("pem"),
    serial,
    fingerprint: await fingerprintOf(certificate),
    subject: certificate.subject,
    notBefore,
    notAfter,
  };
}

/** Server certificates for EMQX and nginx. Used only by tools/pki-init.ts. */
export async function createServerCertificate(
  ca: CertificateAuthority,
  commonName: string,
  sans: string[],
  days: number,
): Promise<{ certificatePem: string; privateKeyPem: string }> {
  const keys = await webcrypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"]);
  // Backdated for clock skew — see CLOCK_SKEW_MS.
  const notBefore = new Date(Date.now() - CLOCK_SKEW_MS);
  const notAfter = new Date(notBefore.getTime() + days * DAY_MS);

  const certificate = await x509.X509CertificateGenerator.create({
    serialNumber: randomSerial(),
    subject: `CN=${commonName}, O=VMaaS`,
    issuer: ca.certificate.subject,
    notBefore,
    notAfter,
    signingAlgorithm: SIGNING,
    publicKey: keys.publicKey,
    signingKey: ca.privateKey,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth], false),
      new x509.SubjectAlternativeNameExtension(
        sans.map((name) => ({ type: /^[\d.]+$/.test(name) ? "ip" : "dns", value: name }) as const),
      ),
    ],
  });

  return {
    certificatePem: certificate.toString("pem"),
    privateKeyPem: toPem(await webcrypto.subtle.exportKey("pkcs8", keys.privateKey), "PRIVATE KEY"),
  };
}
