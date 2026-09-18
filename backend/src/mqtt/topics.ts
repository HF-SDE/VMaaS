/**
 * The topic tree:
 *
 *   v1/{tenantId}/{siteId}/{machineId}/{channel}/...
 *
 * Identifiers are the database uuids, not slugs, so a parsed topic can be
 * compared directly against the machine row the caller already loaded.
 *
 * MQTT now carries exactly two channels: `commands` (platform to machine) and
 * `command-results` (machine to platform). Configuration delivery and every
 * other device-initiated exchange happens over HTTP (`GET
 * /api/device/configuration`, mTLS-authenticated), not on the broker.
 *
 * `parseTopic` is deliberately total and strict: it answers null for anything
 * it does not fully understand, including wildcards. A subscribe request for
 * `v1/+/+/+/commands/#` would otherwise reach the ACL as three wildcards to
 * compare against three uuids, which cannot be decided safely — so it is not
 * parsed at all, and the ACL denies it.
 */

export const TOPIC_VERSION = "v1";

export const TOPIC_CHANNELS = ["commands", "command-results"] as const;

export type TopicChannel = (typeof TOPIC_CHANNELS)[number];

export type MachineIdentity = {
  id: string;
  tenantId: string;
  siteId: string;
};

export type ParsedTopic = {
  tenantId: string;
  siteId: string;
  machineId: string;
  channel: TopicChannel;
  /** Segments after the channel. Empty when the topic ends at the channel. */
  rest: string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isChannel(value: string): value is TopicChannel {
  return (TOPIC_CHANNELS as readonly string[]).includes(value);
}

export function buildTopicPrefix(identity: MachineIdentity): string {
  return [TOPIC_VERSION, identity.tenantId, identity.siteId, identity.id].join("/");
}

export function parseTopic(topic: string): ParsedTopic | null {
  if (topic.includes("#") || topic.includes("+")) return null;

  const segments = topic.split("/");
  if (segments.length < 5) return null;

  const [version, tenantId, siteId, machineId, channel, ...rest] = segments;

  if (version !== TOPIC_VERSION) return null;
  if (!UUID.test(tenantId) || !UUID.test(siteId) || !UUID.test(machineId)) return null;
  if (!isChannel(channel)) return null;
  if (rest.some((segment) => segment === "")) return null;

  return { tenantId, siteId, machineId, channel, rest };
}
