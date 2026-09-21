import { invitationUrl } from "@/lib/emails";

import { describe, expect, it } from "vitest";

describe("invitationUrl", () => {
  // `FRONTEND_URL` holds every allowed browser origin, so it is a list. An
  // invitation email is a link: interpolating the list joins it with commas
  // and mails out an address nobody can open.
  it("links to a single origin, not the whole allow-list", () => {
    expect(invitationUrl("abc123")).toBe("http://localhost:3000/invite/abc123");
  });
});
