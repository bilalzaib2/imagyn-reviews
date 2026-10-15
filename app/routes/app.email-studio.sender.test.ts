// Exercises app.email-studio.tsx's action for the Branded Email Sender Identity intent.
//
// The entitlement assertions are the point. The Pro tag in the UI is cosmetic; this action
// is the write path, so if it ever persists a sender name for a Free store the feature is
// free in practice regardless of what the page renders.
import { beforeEach, describe, expect, it, vi } from "vitest";

let canUseBrandedEmailSender = true;

vi.mock("../services/auth-dedupe.server", () => ({
  authenticateAdminDeduped: vi.fn(async () => ({ session: { shop: "grace.myshopify.com" }, admin: {} })),
}));

let storeRecord = { id: "store_1", name: "gracestoreofficial", emailSenderName: null as string | null };
vi.mock("../services/store.server", () => ({
  getOrCreateStore: vi.fn(async () => storeRecord),
  updateEmailSenderName: vi.fn(async (id: string, emailSenderName: string | null) => {
    updatedWith.push({ id, emailSenderName });
    storeRecord = { ...storeRecord, emailSenderName };
    return storeRecord;
  }),
}));

const updatedWith: Array<{ id: string; emailSenderName: string | null }> = [];

vi.mock("../services/permissions", () => ({
  getStorePermissions: vi.fn(async () => ({ canUseBrandedEmailSender, canUseCustomBranding: true })),
}));

vi.mock("../services/emailTemplate.server", () => ({
  emailTemplateService: {
    getActiveContent: vi.fn(async () => ({ replyToEmail: "hello@grace.test" })),
    saveContent: vi.fn(async () => ({})),
    resetToDefault: vi.fn(async () => ({})),
  },
}));

vi.mock("../services/notifications/templates.server", () => ({ buildReviewRequestEmail: vi.fn() }));
vi.mock("../services/notifications/testEmail.server", () => ({ sendTestReviewRequestEmail: vi.fn() }));
vi.mock("../services/storage/provider.server", () => ({ getStorageProvider: vi.fn() }));
vi.mock("../services/emailSanitize.server", () => ({
  sanitizeEmailHtml: vi.fn((html: string) => html),
  sanitizeSvgMarkup: vi.fn((svg: string) => svg),
  validateSvgLogo: vi.fn(),
}));

const { action } = await import("./app.email-studio");

function post(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return action({
    request: new Request("https://example.com/app/email-studio", { method: "POST", body }),
  } as never);
}

beforeEach(() => {
  canUseBrandedEmailSender = true;
  storeRecord = { id: "store_1", name: "gracestoreofficial", emailSenderName: null };
  updatedWith.length = 0;
  process.env.RESEND_FROM_EMAIL = "Imagyn Reviews <reviews@notifications.imagyn.co>";
});

describe("Pro entitlement on the write path", () => {
  it("saves a sender name for a Pro store", async () => {
    const result = (await post({ _intent: "save-sender-identity", emailSenderName: "Grace Store" })) as {
      ok: boolean;
      emailSenderName: string | null;
    };

    expect(result.ok).toBe(true);
    expect(result.emailSenderName).toBe("Grace Store");
    expect(updatedWith).toEqual([{ id: "store_1", emailSenderName: "Grace Store" }]);
  });

  it("refuses a Free store, even by direct POST", async () => {
    canUseBrandedEmailSender = false;
    const result = (await post({ _intent: "save-sender-identity", emailSenderName: "Grace Store" })) as {
      ok: boolean;
      error: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Pro");
  });

  it("writes nothing at all when refused", async () => {
    canUseBrandedEmailSender = false;
    await post({ _intent: "save-sender-identity", emailSenderName: "Grace Store" });

    expect(updatedWith).toEqual([]);
  });
});

describe("validation and sanitisation", () => {
  it("strips header-injection characters before persisting", async () => {
    await post({
      _intent: "save-sender-identity",
      emailSenderName: "Grace" + String.fromCharCode(13) + String.fromCharCode(10) + "Bcc: victim@example.com",
    });

    const saved = updatedWith[0].emailSenderName!;
    expect(saved).not.toContain(String.fromCharCode(13));
    expect(saved).not.toContain(String.fromCharCode(10));
  });

  it("treats an empty name as clearing the setting rather than an error", async () => {
    const result = (await post({ _intent: "save-sender-identity", emailSenderName: "" })) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(updatedWith).toEqual([{ id: "store_1", emailSenderName: null }]);
  });

  it("rejects a name that is only unusable characters instead of silently clearing it", async () => {
    const result = (await post({
      _intent: "save-sender-identity",
      emailSenderName: '"<>"',
    })) as { ok: boolean; error: string };

    expect(result.ok).toBe(false);
    expect(updatedWith).toEqual([]);
  });
});

describe("the resolved identity returned to the client", () => {
  it("reports the verified platform From address, never a merchant one", async () => {
    const result = (await post({ _intent: "save-sender-identity", emailSenderName: "Grace Store" })) as {
      senderIdentity: { fromAddress: string; displayName: string; replyTo: string | null };
    };

    expect(result.senderIdentity.fromAddress).toBe("reviews@notifications.imagyn.co");
    expect(result.senderIdentity.displayName).toBe("Grace Store");
    expect(result.senderIdentity.replyTo).toBe("hello@grace.test");
  });

  it("scopes the write to the authenticated store", async () => {
    await post({ _intent: "save-sender-identity", emailSenderName: "Grace Store" });
    expect(updatedWith.every((call) => call.id === "store_1")).toBe(true);
  });
});
