import { afterEach, describe, expect, it, vi } from "vitest";

const readFileMock = vi.fn();
vi.mock("node:fs/promises", () => ({ readFile: readFileMock }));

const loadCertificateAuthorityMock = vi.fn();
vi.mock("@/lib/pki", () => ({ loadCertificateAuthority: loadCertificateAuthorityMock }));

/**
 * `getCertificateAuthority` caches its result at module scope, so this suite
 * must reset that module between tests to get a fresh `cached` for each one.
 */
afterEach(() => {
  vi.resetModules();
  readFileMock.mockReset();
  loadCertificateAuthorityMock.mockReset();
});

describe("getCertificateAuthority", () => {
  it("does not cache a rejected load: a failed read is retried on the next call", async () => {
    const { getCertificateAuthority } = await import("@/lib/ca");
    const ca = { certificate: {}, privateKey: {} };

    readFileMock.mockRejectedValueOnce(new Error("ENOENT: /pki/ca.crt not found"));

    await expect(getCertificateAuthority()).rejects.toThrow("ENOENT");

    readFileMock.mockResolvedValue("pem-contents");
    loadCertificateAuthorityMock.mockResolvedValue(ca);

    await expect(getCertificateAuthority()).resolves.toBe(ca);
  });

  it("caches a successful load: a second call does not read the files again", async () => {
    const { getCertificateAuthority } = await import("@/lib/ca");
    const ca = { certificate: {}, privateKey: {} };

    readFileMock.mockResolvedValue("pem-contents");
    loadCertificateAuthorityMock.mockResolvedValue(ca);

    const first = await getCertificateAuthority();
    const second = await getCertificateAuthority();

    expect(first).toBe(ca);
    expect(second).toBe(ca);
    expect(loadCertificateAuthorityMock).toHaveBeenCalledTimes(1);
  });
});
