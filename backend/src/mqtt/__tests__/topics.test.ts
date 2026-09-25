import { describe, expect, it } from "vitest";

import { buildTopicPrefix, parseTopic } from "@/mqtt/topics";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const MACHINE = "33333333-3333-4333-8333-333333333333";
const PREFIX = `v1/${TENANT}/${SITE}/${MACHINE}`;

describe("buildTopicPrefix", () => {
  it("joins the version and the three identifiers", () => {
    expect(buildTopicPrefix({ tenantId: TENANT, siteId: SITE, id: MACHINE })).toBe(PREFIX);
  });
});

describe("parseTopic", () => {
  it("reads a commands topic", () => {
    expect(parseTopic(`${PREFIX}/commands/apply-configuration`)).toEqual({
      tenantId: TENANT,
      siteId: SITE,
      machineId: MACHINE,
      channel: "commands",
      rest: ["apply-configuration"],
    });
  });

  it("reads a command-result topic and keeps the command id", () => {
    const parsed = parseTopic(`${PREFIX}/command-results/cmd-9281`);
    expect(parsed?.channel).toBe("command-results");
    expect(parsed?.rest).toEqual(["cmd-9281"]);
  });

  it("accepts a channel with no trailing segments", () => {
    expect(parseTopic(`${PREFIX}/commands`)?.rest).toEqual([]);
  });

  it("rejects a wrong version root", () => {
    expect(parseTopic(`v2/${TENANT}/${SITE}/${MACHINE}/commands/x`)).toBeNull();
  });

  it("rejects an unknown channel", () => {
    expect(parseTopic(`${PREFIX}/firmware/push`)).toBeNull();
  });

  it("rejects each channel removed from the taxonomy", () => {
    for (const channel of ["properties", "events", "inventory", "sales", "status"]) {
      expect(parseTopic(`${PREFIX}/${channel}/x`)).toBeNull();
    }
  });

  it("rejects a topic that stops short of a channel", () => {
    expect(parseTopic(`v1/${TENANT}/${SITE}/${MACHINE}`)).toBeNull();
  });

  it("rejects an identifier that is not a uuid", () => {
    expect(parseTopic(`v1/acme/${SITE}/${MACHINE}/commands/x`)).toBeNull();
  });

  it("rejects single-level wildcards in the identifiers", () => {
    expect(parseTopic(`v1/+/+/+/commands/apply-configuration`)).toBeNull();
  });

  it("rejects a multi-level wildcard anywhere", () => {
    expect(parseTopic(`${PREFIX}/commands/#`)).toBeNull();
    expect(parseTopic(`${PREFIX}/#`)).toBeNull();
  });

  it("rejects an empty segment", () => {
    expect(parseTopic(`v1//${SITE}/${MACHINE}/commands/x`)).toBeNull();
  });
});
