import { describe, expect, it, vi } from "vitest";

import { createPublish } from "@/mqtt/client";

/**
 * Unit-tests the one property of the real MQTT wiring that matters and can be
 * tested without a broker: a command is never published retained (§5). A
 * retained command would be replayed to a machine at every reconnect.
 */
describe("createPublish", () => {
  it("publishes at qos 1 and never retained", async () => {
    const publishAsync = vi.fn(async () => {});
    const fakeClient = { publishAsync } as unknown as import("mqtt").MqttClient;

    const publish = createPublish(fakeClient);
    await publish("v1/tenant/site/machine/commands/apply-configuration", { commandId: "cmd-1" });

    expect(publishAsync).toHaveBeenCalledWith(
      "v1/tenant/site/machine/commands/apply-configuration",
      JSON.stringify({ commandId: "cmd-1" }),
      { qos: 1, retain: false },
    );
  });
});
