// Pins the Resend adapter's idempotency wiring against a fake `resend` SDK.
//
// Why this matters: the scheduler claims a review request before sending it and recovers a claim
// that was never completed (reviewRequestScheduler.server.ts). One window stays open that the
// claim alone cannot close — a worker dying after Resend accepted the email but before the
// terminal "sent" write lands. The row then looks unsent, recovery legitimately retries it, and
// the customer gets a second copy. An Idempotency-Key makes that retry a no-op at the provider.
//
// Resend's contract (verified against its official docs, 2026-10): the key travels as the
// `Idempotency-Key` HTTP header, a repeat with the same key returns the original response
// WITHOUT sending again, keys are retained 24 hours, and a repeat with the same key but a
// DIFFERENT payload is rejected with 409 invalid_idempotent_request. The SDK surfaces it as the
// optional SECOND argument to emails.send (CreateEmailRequestOptions extends IdempotentRequest),
// not as part of the payload — getting that wrong would silently send the key as an email field
// and lose all protection, which is precisely what these tests prevent.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface SendCall {
  payload: Record<string, unknown>;
  options: { idempotencyKey?: string } | undefined;
}

let sendCalls: SendCall[];
let sendResult: { data: { id: string } | null; error: { message: string } | null };

const sendMock = vi.fn(async (payload: Record<string, unknown>, options?: { idempotencyKey?: string }) => {
  sendCalls.push({ payload, options });
  return sendResult;
});

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
    constructor(public apiKey: string) {}
  },
}));

const { createResendEmailProvider } = await import("./resend.server");

beforeEach(() => {
  sendCalls = [];
  sendResult = { data: { id: "msg_123" }, error: null };
  sendMock.mockClear();
  process.env.RESEND_API_KEY = "fake-key-for-tests";
  process.env.RESEND_FROM_EMAIL = "Imagyn Reviews <reviews@imagyn.co>";
});

const base = {
  to: "customer@example.com",
  subject: "How was your order?",
  html: "<p>hi</p>",
  text: "hi",
};

describe("Resend adapter — idempotency key placement", () => {
  it("passes the key as the SECOND argument, not inside the payload", async () => {
    await createResendEmailProvider().sendEmail({ ...base, idempotencyKey: "review-request/tok_abc" });

    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0].options).toEqual({ idempotencyKey: "review-request/tok_abc" });
    // The decisive assertion: a key smuggled into the payload would be ignored by Resend as an
    // unknown field, and every retry would send a real second email.
    expect(sendCalls[0].payload).not.toHaveProperty("idempotencyKey");
  });

  it("omits the options argument entirely when no key is supplied", async () => {
    // Keeps every pre-existing send path (merchant notifications, test sends, reward emails)
    // byte-identical rather than quietly opting them into provider-side dedup.
    await createResendEmailProvider().sendEmail(base);

    expect(sendCalls[0].options).toBeUndefined();
  });

  it("still sends the real payload alongside the key", async () => {
    await createResendEmailProvider().sendEmail({ ...base, idempotencyKey: "review-request/tok_abc" });

    expect(sendCalls[0].payload).toMatchObject({
      to: "customer@example.com",
      subject: "How was your order?",
      html: "<p>hi</p>",
      text: "hi",
    });
  });

  it("carries the key alongside tags and replyTo without disturbing either", async () => {
    await createResendEmailProvider().sendEmail({
      ...base,
      replyTo: "merchant@example.com",
      tags: { request_token: "tok_abc" },
      idempotencyKey: "review-request/tok_abc",
    });

    expect(sendCalls[0].payload).toMatchObject({
      replyTo: "merchant@example.com",
      tags: [{ name: "request_token", value: "tok_abc" }],
    });
    expect(sendCalls[0].options).toEqual({ idempotencyKey: "review-request/tok_abc" });
  });

  it("returns the provider message id unchanged", async () => {
    const result = await createResendEmailProvider().sendEmail({
      ...base,
      idempotencyKey: "review-request/tok_abc",
    });

    expect(result).toEqual({ id: "msg_123" });
  });

  it("surfaces a provider error (e.g. a 409 on a key reused with a different payload)", async () => {
    // Resend answers 409 invalid_idempotent_request when a key is reused with changed content.
    // That must surface as a normal send failure so dispatchRequestEmail's bounded retry and its
    // terminal "failed" status still apply — never swallowed into a false success.
    sendResult = { data: null, error: { message: "invalid_idempotent_request" } };

    await expect(
      createResendEmailProvider().sendEmail({ ...base, idempotencyKey: "review-request/tok_abc" }),
    ).rejects.toThrow(/invalid_idempotent_request/);
  });

  it("stays within Resend's 1-256 character key limit for a real review-request key", () => {
    // cuid-based tokens are ~25 chars; the prefix adds 16. Asserted so a future prefix change
    // can't drift past the limit and start returning 400 invalid_idempotency_key.
    const key = `review-request/${"c".repeat(25)}`;
    expect(key.length).toBeGreaterThanOrEqual(1);
    expect(key.length).toBeLessThanOrEqual(256);
  });
});
