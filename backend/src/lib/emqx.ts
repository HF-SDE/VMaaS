import { config } from "./config";

/**
 * EMQX never re-authenticates an established session, so revoking a
 * certificate does not disconnect a machine that is already connected. This
 * does, which is what makes a disable take effect immediately.
 *
 * The client id is the machine id: EMQX takes it from the certificate CN, and
 * the authn webhook rejects any connection where the two disagree.
 */
export async function kickMqttClient(
  machineId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const credentials = Buffer.from(`${config.EMQX_API_KEY}:${config.EMQX_API_SECRET}`).toString("base64");

  try {
    const response = await fetchImpl(
      `${config.EMQX_API_URL}/api/v5/clients/${encodeURIComponent(machineId)}`,
      { method: "DELETE", headers: { Authorization: `Basic ${credentials}` } },
    );

    if (response.ok) return true;

    if (response.status === 404) {
      const body = await response.text().catch(() => "");
      let code: unknown;
      try {
        code = JSON.parse(body)?.code;
      } catch {
        code = undefined;
      }

      if (code === "CLIENTID_NOT_FOUND") return true;

      console.error(
        `[emqx] DELETE /clients/${machineId} answered 404 without CLIENTID_NOT_FOUND ` +
          `— the EMQX API surface may not be what this code assumes. Body: ${body.slice(0, 500)}`,
      );
      return false;
    }

    return false;
  } catch {
    return false;
  }
}
