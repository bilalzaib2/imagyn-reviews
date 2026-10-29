// Pins the Resend adapter's From-header composition against a fake `resend` SDK.
//
// The sender identity resolver decides WHAT the From address should be; this adapter is the only
// place that turns it into an actual header. A merchant-scoped local part that the resolver
// produced but the adapter ignored would be invisible in every unit test of the resolver and
// still wrong in every real inbox — which is exactly what these tests prevent.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface SendCall {
  payload: Record<string, unknown>;
}

let sendCalls: SendCall[];

const sendMock = vi.fn(async (payload: Record<string, unknown>) => {
  sendCalls.push({ payload });
  return { data: { id: "msg_1" }, error: null };
});

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
    constructor(public apiKey: string) {}
  },
}));

const { createResendEmailProvider } = await import("./resend.server");

const base = { to: "customer@example.com", subject: "s", html: "<p>h</p>", text: "t" };

beforeEach(() => {
  sendCalls = [];
  sendMock.mockClear();
  process.env.RESEND_API_KEY = "test-key";
  process.env.RESEND_FROM_EMAIL = "Imagyn Reviews <reviews@notifications.imagyn.co>";
});

async function sendWith(extra: Record<string, unknown>) {
  await createResendEmailProvider().sendEmail({ ...base, ...extra } as never);
  return String(sendCalls[0].payload.from);
}

describe("From header composition", () => {
  it("uses the caller's resolved merchant-scoped address", async () => {
    const from = await sendWith({
      fromName: "Grace Store",
      fromAddress: "requests+gracestoreofficial.myshopify.com@notifications.imagyn.co",
    });

    expect(from).toBe("Grace Store <requests+gracestoreofficial.myshopify.com@notifications.imagyn.co>");
  });

  it("falls back to the env address when the caller supplies none", async () => {
    expect(await sendWith({ fromName: "Grace Store" })).toBe("Grace Store <reviews@notifications.imagyn.co>");
  });

  it("keeps the platform's own display name for untagged internal notifications", async () => {
    expect(await sendWith({})).toBe("Imagyn Reviews <reviews@notifications.imagyn.co>");
  });

  it("rejects a malformed address rather than emitting a broken header", async () => {
    for (const bad of [
      "not-an-address",
      "a b@x.test",
      "a,b@x.test",
      "a;b@x.test",
      'a"b@x.test',
      "a<b@x.test",
      "a>b@x.test",
      "a@b@x.test",
    ]) {
      sendCalls = [];
      const from = await sendWith({ fromName: "Grace Store", fromAddress: bad });

      // Falls back to the verified env address; the hostile value never reaches the header.
      expect(from).toBe("Grace Store <reviews@notifications.imagyn.co>");
      expect(from).not.toContain(bad);
    }
  });

  it("strips header-injection characters from the display name", async () => {
    const from = await sendWith({
      fromName: 'Grace" <evil@attacker.com>',
      fromAddress: "requests+grace@notifications.imagyn.co",
    });

    expect(from).toBe("Grace evil@attacker.com <requests+grace@notifications.imagyn.co>");
    expect(from.match(/</g) ?? []).toHaveLength(1);
    expect(from.match(/>/g) ?? []).toHaveLength(1);
  });
});
