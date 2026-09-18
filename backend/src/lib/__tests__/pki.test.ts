import * as x509 from "@peculiar/x509";
import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  type CertificateAuthority,
  buildDeviceSubject,
  createCertificateAuthority,
  loadCertificateAuthority,
  parseSubject,
  signDeviceCsr,
} from "@/lib/pki";

const MACHINE = "33333333-3333-4333-8333-333333333333";

/** A device-side CSR, standing in for what the firmware would send. */
async function makeCsr(commonName = MACHINE) {
  const keys = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: `CN=${commonName}`,
    keys,
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
  });
  return csr.toString("pem");
}

let ca: CertificateAuthority;

beforeAll(async () => {
  const created = await createCertificateAuthority();
  // Round-trips through PEM, which is how the backend loads it from /pki.
  ca = await loadCertificateAuthority(created.certificatePem, created.privateKeyPem);
});

describe("buildDeviceSubject / parseSubject", () => {
  it("round-trips the machine id and the serial", () => {
    const dn = buildDeviceSubject(MACHINE, "0a1b2c");
    expect(parseSubject(dn)).toEqual({ machineId: MACHINE, serial: "0a1b2c" });
  });

  it("reads a distinguished name whose parts are reordered and spaced", () => {
    expect(parseSubject(`O=VMaaS, OU=0a1b2c, CN=${MACHINE}`)).toEqual({
      machineId: MACHINE,
      serial: "0a1b2c",
    });
  });

  it("answers nulls for a name missing the parts", () => {
    expect(parseSubject("O=VMaaS")).toEqual({ machineId: null, serial: null });
  });

  it("rejects a machineId or serial that could inject an extra RDN", () => {
    // A comma would let the value be read back as more than one attribute —
    // e.g. `CN=m1, OU=deadbeef` landing ahead of the genuine OU.
    expect(() => buildDeviceSubject("m1, OU=deadbeef", "0a1b2c")).toThrow();
    expect(() => buildDeviceSubject(MACHINE, "0a1b2c, OU=deadbeef")).toThrow();
  });

  it("answers nulls for a distinguished name with a duplicated attribute", () => {
    // Same shape an injected machineId would produce: the forged OU lands
    // ahead of the genuine one, so a first-match read would return it instead.
    expect(parseSubject(`CN=m1, OU=deadbeef, OU=${"a".repeat(32)}, O=VMaaS`)).toEqual({
      machineId: null,
      serial: null,
    });
    expect(parseSubject(`CN=${MACHINE}, CN=someone-else, OU=0a1b2c, O=VMaaS`)).toEqual({
      machineId: null,
      serial: null,
    });
  });
});

describe("signDeviceCsr", () => {
  it("issues a certificate that chains to the CA", async () => {
    const issued = await signDeviceCsr(ca, await makeCsr(), MACHINE, 90);
    const certificate = new x509.X509Certificate(issued.pem);

    expect(await certificate.verify({ publicKey: ca.certificate.publicKey })).toBe(true);
  });

  it("puts the machine id in the CN and the serial in the OU", async () => {
    const issued = await signDeviceCsr(ca, await makeCsr(), MACHINE, 90);

    expect(parseSubject(issued.subject)).toEqual({ machineId: MACHINE, serial: issued.serial });
  });

  it("honours the requested lifetime", async () => {
    const issued = await signDeviceCsr(ca, await makeCsr(), MACHINE, 90);
    const days = (issued.notAfter.getTime() - issued.notBefore.getTime()) / 86_400_000;

    expect(Math.round(days)).toBe(90);
  });

  it("gives each certificate a distinct serial and fingerprint", async () => {
    const first = await signDeviceCsr(ca, await makeCsr(), MACHINE, 90);
    const second = await signDeviceCsr(ca, await makeCsr(), MACHINE, 90);

    expect(first.serial).not.toBe(second.serial);
    expect(first.fingerprint).not.toBe(second.fingerprint);
  });

  it("ignores the subject the device asked for and uses the machine id it was activated as", async () => {
    const issued = await signDeviceCsr(ca, await makeCsr("someone-else"), MACHINE, 90);

    expect(parseSubject(issued.subject).machineId).toBe(MACHINE);
  });

  it("rejects a CSR that is not a CSR", async () => {
    await expect(signDeviceCsr(ca, "-----BEGIN CERTIFICATE REQUEST-----\nnope\n-----END CERTIFICATE REQUEST-----", MACHINE, 90))
      .rejects.toThrow(/^CSR_REJECTED/);
  });

  it("keeps the stored serial identical to the certificate's real serial even when DER would otherwise truncate it", async () => {
    // DER strips a leading 0x00 byte from an INTEGER. If the serial we
    // generate happens to start with one, the certificate's actual serial
    // comes back shorter than the string we stored and put in OU= — forcing
    // that here reproduces the exact case a 1-in-256 random draw would hit.
    const csrPem = await makeCsr();
    const spy = vi.spyOn(webcrypto, "getRandomValues").mockImplementationOnce((array) => {
      const bytes = array as Uint8Array;
      bytes.fill(0xaa);
      bytes[0] = 0x00;
      return array;
    });

    try {
      const issued = await signDeviceCsr(ca, csrPem, MACHINE, 90);
      const certificate = new x509.X509Certificate(issued.pem);

      expect(issued.serial).toBe(certificate.serialNumber);
      expect(parseSubject(issued.subject)).toEqual({ machineId: MACHINE, serial: issued.serial });
    } finally {
      spy.mockRestore();
    }
  });
});
