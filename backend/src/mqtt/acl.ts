import { type MachineIdentity, type TopicChannel, parseTopic } from "./topics";

/**
 * Deny by default, per docs/VMaaS-MQTT-arkitektur.html §7.2. EMQX is also
 * configured with `no_match = deny`, so a topic this function does not reach
 * is refused by the broker anyway; this is the layer that decides the ones it
 * does reach.
 *
 * The rule is the whole tenant boundary: the three identifiers in the topic
 * must equal the three on the machine behind the verified certificate. A
 * tenant id in the payload grants nothing (§6).
 */

export type MqttAction = "publish" | "subscribe";

/** Channels a machine reports on. */
const PUBLISH_CHANNELS: readonly TopicChannel[] = ["command-results"];

/** Channels a machine listens on. */
const SUBSCRIBE_CHANNELS: readonly TopicChannel[] = ["commands"];

export function authorizeTopic(machine: MachineIdentity, action: MqttAction, topic: string): boolean {
  const parsed = parseTopic(topic);
  if (!parsed) return false;

  if (
    parsed.tenantId !== machine.tenantId ||
    parsed.siteId !== machine.siteId ||
    parsed.machineId !== machine.id
  ) {
    return false;
  }

  const allowed = action === "publish" ? PUBLISH_CHANNELS : SUBSCRIBE_CHANNELS;
  return allowed.includes(parsed.channel);
}
