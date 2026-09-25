// The in-app support form's server half: validation, sanitization, rate limiting, and the
// send itself. The security properties under test are the ones that matter for an
// authenticated endpoint that sends mail from IMAGYN's own verified domain — a fixed
// recipient, no header injection through the subject, and no session parameters leaking into
// the email through the "current page" field.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

const sendEmail = vi.fn(async () => ({ id: "fake-message-id" }));

vi.mock("./notifications/provider.server", () => ({
  getEmailProvider: () => ({ name: "fake", sendEmail }),
}));

const {
  MESSAGE_MAX_LENGTH,
  SUBJECT_MAX_LENGTH,
  SUPPORT_INBOX,
  SupportRequestError,
  assertWithinRateLimit,
  getShopContactEmail,
  sendSupportRequest,
  validateSupportRequest,
} = await import("./supportRequest.server");

function lastSend(): { to: string; subject: string; html: string; text: string; replyTo?: string } {
  const calls = sendEmail.mock.calls as unknown as Array<
    [{ to: string; subject: string; html: string; text: string; replyTo?: string }]
  >;
  const last = calls[calls.length - 1];
  if (!last) {
    throw new Error("Expected sendEmail to have been called.");
  }
  return last[0];
}

const baseSend = {
  storeId: "store_1",
  storeName: "Coastal Threads",
  shopDomain: "coastal-threads.myshopify.com",
  planName: "Pro",
  merchantEmail: "owner@coastal.test",
  now: new Date("2026-09-25T09:15:00Z"),
};

beforeEach(() => {
  sendEmail.mockClear();
  sendEmail.mockResolvedValue({ id: "fake-message-id" });
  // The rate limiter is a module-level map on globalThis; clear it so tests don't bleed.
  (globalThis as { supportRequestRateLimit?: Map<string, number[]> }).supportRequestRateLimit = new Map();
});

describe("validation", () => {
  it("accepts a normal request", () => {
    const result = validateSupportRequest({
      subject: "Widgets aren't showing",
      message: "The rating badge is missing on product pages.",
      category: "Widgets",
      appSection: "/app/widgets",
    });

    expect(result).toEqual({
      subject: "Widgets aren't showing",
      message: "The rating badge is missing on product pages.",
      category: "Widgets",
      appSection: "/app/widgets",
    });
  });

  it("rejects a missing or whitespace-only subject", () => {
    expect(() => validateSupportRequest({ subject: "", message: "hi" })).toThrow("Enter a subject.");
    expect(() => validateSupportRequest({ subject: "   ", message: "hi" })).toThrow("Enter a subject.");
  });

  it("rejects a missing or whitespace-only message", () => {
    expect(() => validateSupportRequest({ subject: "Help", message: "" })).toThrow("Enter a message.");
    expect(() => validateSupportRequest({ subject: "Help", message: "  \n " })).toThrow("Enter a message.");
  });

  it("rejects an over-long subject or message", () => {
    expect(() =>
      validateSupportRequest({ subject: "a".repeat(SUBJECT_MAX_LENGTH + 1), message: "hi" }),
    ).toThrow(/subject under/);
    expect(() =>
      validateSupportRequest({ subject: "Help", message: "a".repeat(MESSAGE_MAX_LENGTH + 1) }),
    ).toThrow(/message under/);
  });

  it("marks validation failures as the validation kind, so the route answers 400", () => {
    try {
      validateSupportRequest({ subject: "", message: "hi" });
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SupportRequestError);
      expect((error as InstanceType<typeof SupportRequestError>).kind).toBe("validation");
    }
  });

  it("keeps the merchant's own line breaks in the message", () => {
    const result = validateSupportRequest({ subject: "Help", message: "Line one\r\nLine two\n\nLine four" });
    expect(result.message).toBe("Line one\nLine two\n\nLine four");
  });
});

describe("header injection and control characters", () => {
  it("collapses newlines in the subject, so extra mail headers can't be smuggled in", () => {
    const result = validateSupportRequest({
      subject: "Hello\r\nBcc: attacker@evil.test",
      message: "body",
    });

    expect(result.subject).not.toContain("\n");
    expect(result.subject).not.toContain("\r");
    expect(result.subject).toBe("Hello Bcc: attacker@evil.test");
  });

  it("strips control characters from both fields", () => {
    const withControls = `Hi${String.fromCharCode(0)}there${String.fromCharCode(7)}`;
    const result = validateSupportRequest({ subject: withControls, message: withControls });

    expect(result.subject).toBe("Hithere");
    expect(result.message).toBe("Hithere");
  });

  it("leaves ordinary punctuation and non-Latin text untouched", () => {
    const result = validateSupportRequest({
      subject: "Café — issue #42 (urgent)",
      message: "日本語のテキストも大丈夫です。",
    });

    expect(result.subject).toBe("Café — issue #42 (urgent)");
    expect(result.message).toBe("日本語のテキストも大丈夫です。");
  });
});

describe("category is an allow-list, never passed through", () => {
  it("accepts only an exact match from the fixed list", () => {
    expect(validateSupportRequest({ subject: "s", message: "m", category: "Billing" }).category).toBe("Billing");
  });

  it("drops anything not on the list rather than echoing it into the email", () => {
    // Case-sensitive and exact: "billing" is not "Billing", and free text is never passed
    // through into the email body.
    for (const bogus of ["", "Anything", "<script>alert(1)</script>", "billing", "General question"]) {
      expect(validateSupportRequest({ subject: "s", message: "m", category: bogus }).category).toBeNull();
    }
  });

  it("trims surrounding whitespace before matching, so a padded value still resolves", () => {
    expect(validateSupportRequest({ subject: "s", message: "m", category: "  Other  " }).category).toBe("Other");
  });
});

describe("appSection can never carry session parameters", () => {
  it("accepts a plain in-app path", () => {
    expect(validateSupportRequest({ subject: "s", message: "m", appSection: "/app/settings/requests" }).appSection).toBe(
      "/app/settings/requests",
    );
  });

  it("rejects anything carrying a query string", () => {
    expect(
      validateSupportRequest({ subject: "s", message: "m", appSection: "/app?host=abc&id_token=xyz" }).appSection,
    ).toBeNull();
  });

  it("rejects an absolute URL", () => {
    expect(
      validateSupportRequest({ subject: "s", message: "m", appSection: "https://admin.shopify.com/store/x" })
        .appSection,
    ).toBeNull();
  });

  it("rejects a path that doesn't start at the root", () => {
    expect(validateSupportRequest({ subject: "s", message: "m", appSection: "app/widgets" }).appSection).toBeNull();
  });
});

describe("rate limiting", () => {
  it("allows five requests per store per hour", () => {
    for (let i = 0; i < 5; i += 1) {
      expect(() => assertWithinRateLimit("store_1")).not.toThrow();
    }
  });

  it("blocks the sixth, as a rate_limit error", () => {
    for (let i = 0; i < 5; i += 1) {
      assertWithinRateLimit("store_1");
    }

    try {
      assertWithinRateLimit("store_1");
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SupportRequestError);
      expect((error as InstanceType<typeof SupportRequestError>).kind).toBe("rate_limit");
    }
  });

  it("is keyed per store — one store's limit never blocks another", () => {
    for (let i = 0; i < 5; i += 1) {
      assertWithinRateLimit("store_1");
    }

    expect(() => assertWithinRateLimit("store_2")).not.toThrow();
  });

  it("lets the store through again once the window has passed", () => {
    const start = Date.now();
    for (let i = 0; i < 5; i += 1) {
      assertWithinRateLimit("store_1", start);
    }
    expect(() => assertWithinRateLimit("store_1", start)).toThrow();

    // One hour and a second later.
    expect(() => assertWithinRateLimit("store_1", start + 60 * 60 * 1000 + 1000)).not.toThrow();
  });
});

describe("sending", () => {
  it("always sends to the fixed support inbox", async () => {
    await sendSupportRequest({ ...baseSend, subject: "Help", message: "Something broke", category: null, appSection: null });

    expect(SUPPORT_INBOX).toBe("support@reviews.imagyn.co");
    expect(lastSend().to).toBe("support@reviews.imagyn.co");
  });

  it("prefixes the subject with [IMAGYN Support]", async () => {
    await sendSupportRequest({ ...baseSend, subject: "Widgets aren't showing", message: "m", category: null, appSection: null });

    expect(lastSend().subject).toBe("[IMAGYN Support] Widgets aren't showing");
  });

  it("sets Reply-To to the store's own contact email", async () => {
    await sendSupportRequest({ ...baseSend, subject: "s", message: "m", category: null, appSection: null });

    expect(lastSend().replyTo).toBe("owner@coastal.test");
  });

  it("omits Reply-To entirely when the shop has no resolvable contact email", async () => {
    await sendSupportRequest({
      ...baseSend,
      merchantEmail: null,
      subject: "s",
      message: "m",
      category: null,
      appSection: null,
    });

    expect(lastSend().replyTo).toBeUndefined();
  });

  it("includes the store context support needs to answer", async () => {
    await sendSupportRequest({
      ...baseSend,
      subject: "Reviews not sending",
      message: "No request emails since Tuesday.",
      category: "Review Requests",
      appSection: "/app/settings/requests",
    });

    const { text } = lastSend();
    expect(text).toContain("Coastal Threads");
    expect(text).toContain("coastal-threads.myshopify.com");
    expect(text).toContain("Pro");
    expect(text).toContain("Review Requests");
    expect(text).toContain("/app/settings/requests");
    expect(text).toContain("No request emails since Tuesday.");
    expect(text).toContain("Sep 25, 2026");
    expect(text).toContain("UTC");
  });

  it("never includes a token, key or App Bridge session parameter", async () => {
    await sendSupportRequest({ ...baseSend, subject: "s", message: "m", category: null, appSection: "/app/reviews" });

    const { html, text } = lastSend();
    for (const forbidden of ["id_token", "hmac", "access_token", "api_key", "apiKey", "password"]) {
      expect(html.toLowerCase()).not.toContain(forbidden.toLowerCase());
      expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("raises a send_failed error when the provider fails, so the merchant can retry", async () => {
    sendEmail.mockRejectedValueOnce(new Error("provider down"));

    try {
      await sendSupportRequest({ ...baseSend, subject: "s", message: "m", category: null, appSection: null });
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SupportRequestError);
      expect((error as InstanceType<typeof SupportRequestError>).kind).toBe("send_failed");
    }
  });
});

describe("shop contact email lookup", () => {
  function adminReturning(body: unknown): AdminApiContext {
    return { graphql: vi.fn(async () => ({ json: async () => body })) } as unknown as AdminApiContext;
  }

  it("returns the shop's email", async () => {
    const admin = adminReturning({ data: { shop: { email: "owner@coastal.test" } } });
    await expect(getShopContactEmail(admin)).resolves.toBe("owner@coastal.test");
  });

  it("returns null when the shop has no email", async () => {
    await expect(getShopContactEmail(adminReturning({ data: { shop: { email: null } } }))).resolves.toBeNull();
    await expect(getShopContactEmail(adminReturning({ data: { shop: null } }))).resolves.toBeNull();
  });

  it("returns null instead of throwing when the Admin API call fails — Reply-To is optional", async () => {
    const admin = {
      graphql: vi.fn(async () => {
        throw new Error("network down");
      }),
    } as unknown as AdminApiContext;

    await expect(getShopContactEmail(admin)).resolves.toBeNull();
  });
});
