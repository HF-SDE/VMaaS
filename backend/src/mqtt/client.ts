import { readFile } from "node:fs/promises";

import mqtt, { type MqttClient } from "mqtt";

import { config } from "@/lib/config";
import { prisma } from "@/lib/prisma";

import { handleCommandResult } from "./handlers";
import { parseTopic } from "./topics";

/**
 * The platform's own MQTT connection.
 *
 * Failures are logged and retried, never thrown: the HTTP API must keep serving
 * when the broker is down.
 */

const SUBSCRIPTIONS = ["v1/+/+/+/command-results/#"];

let client: MqttClient | null = null;

/**
 * Extracted so the never-retained invariant is unit-testable against a fake
 * MqttClient, without needing a live broker.
 */
export function createPublish(mqttClient: MqttClient): (topic: string, payload: Record<string, unknown>) => Promise<void> {
  return async (topic, payload) => {
    // Commands are never retained: a restarting machine must not replay one (§5).
    await mqttClient.publishAsync(topic, JSON.stringify(payload), { qos: 1, retain: false });
  };
}

async function onMessage(topic: string, buffer: Buffer): Promise<void> {
  const parsed = parseTopic(topic);
  if (!parsed) {
    console.warn(`mqtt: dropping message on unparseable topic ${topic}`);
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(buffer.toString("utf8")) as Record<string, unknown>;
  } catch {
    console.warn(`mqtt: dropping message with invalid JSON on ${topic}`);
    return;
  }

  try {
    if (parsed.channel === "command-results") {
      await handleCommandResult(prisma, parsed, payload);
      return;
    }
  } catch (error) {
    console.error(`mqtt: handler failed for ${topic}:`, error);
  }
}

export async function startMqttClient(): Promise<void> {
  const [cert, key, ca] = await Promise.all([
    readFile(config.MQTT_CLIENT_CERT, "utf8"),
    readFile(config.MQTT_CLIENT_KEY, "utf8"),
    readFile(config.CA_CERT_PATH, "utf8"),
  ]);

  client = mqtt.connect(config.MQTT_URL, {
    clientId: "vmaas-platform",
    username: config.MQTT_USERNAME,
    password: config.MQTT_PASSWORD,
    cert,
    key,
    ca,
    rejectUnauthorized: true,
    reconnectPeriod: 5000,
    clean: true,
  });

  client.on("connect", () => {
    console.log("mqtt: connected");
    client?.subscribe(SUBSCRIPTIONS, { qos: 1 }, (error) => {
      if (error) console.error("mqtt: subscribe failed:", error);
      else console.log(`mqtt: subscribed to ${SUBSCRIPTIONS.length} topic filters`);
    });
  });

  client.on("message", (topic, buffer) => void onMessage(topic, buffer));
  client.on("error", (error) => console.error("mqtt: connection error:", error.message));
  client.on("reconnect", () => console.log("mqtt: reconnecting"));
}
