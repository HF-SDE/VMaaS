import { config } from "./config";

/**
 * An established MQTT session is never re-authenticated, so revoking a
 * certificate in the database does not disconnect a machine that is already
 * connected. This is what makes a disable take effect immediately (spec §9).
 *
 * The client id is the machine id: EMQX derives it from the certificate's
 * common name, and the authn webhook refuses any connection where the two
 * disagree, so this can only ever reach the intended machine.
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

    // A 404 is ambiguous by status alone: EMQX answers it both for "this
    // client id is not connected" (the state we wanted — success) AND for a
    // URL that does not exist on this API surface (a bug here — failure).
    // Only the body tells them apart, and it must be read defensively: a
    // missing endpoint answers HTML, not JSON, and none of that may throw.
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
    // The disable itself already succeeded in the database; a broker that
    // cannot be reached must not turn that into a failed request.
    return false;
  }
}
