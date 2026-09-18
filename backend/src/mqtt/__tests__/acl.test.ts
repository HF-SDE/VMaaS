import { describe, expect, it } from "vitest";

import { authorizeTopic } from "@/mqtt/acl";
import { buildTopicPrefix } from "@/mqtt/topics";

const acme = {
  id: "33333333-3333-4333-8333-333333333333",
  tenantId: "11111111-1111-4111-8111-111111111111",
  siteId: "22222222-2222-4222-8222-222222222222",
};

const otherTenant = { ...acme, tenantId: "99999999-9999-4999-8999-999999999999" };
const otherSite = { ...acme, siteId: "88888888-8888-4888-8888-888888888888" };
const otherMachine = { ...acme, id: "77777777-7777-4777-8777-777777777777" };

const own = buildTopicPrefix(acme);

describe("authorizeTopic", () => {
  it("allows a machine to publish its own command results", () => {
    expect(authorizeTopic(acme, "publish", `${own}/command-results/cmd-1`)).toBe(true);
  });

  it("denies publishing to another tenant's topic", () => {
    const foreign = buildTopicPrefix(otherTenant);
    expect(authorizeTopic(acme, "publish", `${foreign}/command-results/cmd-1`)).toBe(false);
  });

  it("denies publishing to another site under the same tenant", () => {
    const foreign = buildTopicPrefix(otherSite);
    expect(authorizeTopic(acme, "publish", `${foreign}/command-results/cmd-1`)).toBe(false);
  });

  it("denies publishing to another machine at the same site", () => {
    const foreign = buildTopicPrefix(otherMachine);
    expect(authorizeTopic(acme, "publish", `${foreign}/command-results/cmd-1`)).toBe(false);
  });

  it("denies publishing to its own command channel", () => {
    expect(authorizeTopic(acme, "publish", `${own}/commands/apply-configuration`)).toBe(false);
  });

  it("denies publishing on every channel removed from the taxonomy", () => {
    for (const channel of ["properties", "events", "inventory", "sales", "status"]) {
      expect(authorizeTopic(acme, "publish", `${own}/${channel}/x`)).toBe(false);
    }
  });

  it("allows subscribing to its own commands", () => {
    expect(authorizeTopic(acme, "subscribe", `${own}/commands/apply-configuration`)).toBe(true);
  });

  it("denies subscribing to its own command-results channel", () => {
    expect(authorizeTopic(acme, "subscribe", `${own}/command-results/cmd-1`)).toBe(false);
  });

  it("denies subscribing on every channel removed from the taxonomy", () => {
    for (const channel of ["properties", "events", "inventory", "sales", "status"]) {
      expect(authorizeTopic(acme, "subscribe", `${own}/${channel}/x`)).toBe(false);
    }
  });

  it("denies a wildcard subscribe across tenants", () => {
    expect(authorizeTopic(acme, "subscribe", "v1/+/+/+/commands/#")).toBe(false);
  });

  it("denies a wildcard subscribe under its own prefix", () => {
    expect(authorizeTopic(acme, "subscribe", `${own}/commands/#`)).toBe(false);
  });

  it("denies an unparseable topic", () => {
    expect(authorizeTopic(acme, "publish", "nonsense")).toBe(false);
    expect(authorizeTopic(acme, "publish", "")).toBe(false);
  });

  it("denies a topic that merely starts with the right uuid", () => {
    const lookalike = `v1/${acme.tenantId}x/${acme.siteId}/${acme.id}/command-results/x`;
    expect(authorizeTopic(acme, "publish", lookalike)).toBe(false);
  });
});
