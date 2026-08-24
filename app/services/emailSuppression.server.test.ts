// Exercises emailSuppressionService and the HMAC unsubscribe token against a fake in-memory
// EmailSuppression table — no real database. See emailTemplate.server.test.ts for the same
// mocking convention this file follows.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeRow {
  id: string;
  storeId: string;
  email: string;
  source: string;
  suppressedAt: Date;
}

let rows: FakeRow[];
let nextId: number;

vi.mock("../db.server", () => ({
  default: {
    emailSuppression: {
      findUnique: vi.fn(async (args: { where: { storeId_email: { storeId: string; email: string } } }) => {
        const { storeId, email } = args.where.storeId_email;
        return rows.find((row) => row.storeId === storeId && row.email === email) ?? null;
      }),
      upsert: vi.fn(
        async (args: {
          where: { storeId_email: { storeId: string; email: string } };
          update: Partial<FakeRow>;
          create: { storeId: string; email: string; source: string };
        }) => {
          const { storeId, email } = args.where.storeId_email;
          const existing = rows.find((row) => row.storeId === storeId && row.email === email);

          if (existing) {
            Object.assign(existing, args.update);
            return existing;
          }

          const row: FakeRow = {
            id: `sup_${nextId++}`,
            suppressedAt: new Date(),
            ...args.create,
          };
          rows.push(row);
          return row;
        },
      ),
    },
  },
}));

// Set once, at module scope — every test in this file needs a real secret for the HMAC
// functions to work, and none of them depend on a specific value, so there's no need to vary
// or restore it per test.
process.env.SHOPIFY_API_SECRET ||= "test-secret-for-unsubscribe-hmac";

beforeEach(() => {
  rows = [];
  nextId = 1;
  vi.clearAllMocks();
});

const { emailSuppressionService, generateUnsubscribeToken, verifyUnsubscribeToken, buildUnsubscribeUrl } = await import(
  "./emailSuppression.server"
);

describe("emailSuppressionService", () => {
  it("isSuppressed is false for an email that was never suppressed", async () => {
    expect(await emailSuppressionService.isSuppressed("store_1", "jordan@example.com")).toBe(false);
  });

  it("isSuppressed is true immediately after suppress", async () => {
    await emailSuppressionService.suppress("store_1", "jordan@example.com");
    expect(await emailSuppressionService.isSuppressed("store_1", "jordan@example.com")).toBe(true);
  });

  it("isSuppressed is case-insensitive — a differently-cased resend can't bypass suppression", async () => {
    await emailSuppressionService.suppress("store_1", "Jordan@Example.com");
    expect(await emailSuppressionService.isSuppressed("store_1", "jordan@example.com")).toBe(true);
    expect(await emailSuppressionService.isSuppressed("store_1", "JORDAN@EXAMPLE.COM")).toBe(true);
  });

  it("isSuppressed is false for a null email (no email to check)", async () => {
    expect(await emailSuppressionService.isSuppressed("store_1", null)).toBe(false);
  });

  it("suppress is idempotent — suppressing the same (store, email) twice never errors or duplicates", async () => {
    await emailSuppressionService.suppress("store_1", "jordan@example.com");
    await emailSuppressionService.suppress("store_1", "jordan@example.com");

    expect(rows).toHaveLength(1);
  });

  it("suppression is scoped per store — one store's suppression never affects another", async () => {
    await emailSuppressionService.suppress("store_1", "jordan@example.com");

    expect(await emailSuppressionService.isSuppressed("store_1", "jordan@example.com")).toBe(true);
    expect(await emailSuppressionService.isSuppressed("store_2", "jordan@example.com")).toBe(false);
  });
});

describe("unsubscribe token — generation and verification", () => {
  it("a freshly generated token verifies successfully for the same (store, email)", () => {
    const token = generateUnsubscribeToken("store_1", "jordan@example.com");
    expect(verifyUnsubscribeToken("store_1", "jordan@example.com", token)).toBe(true);
  });

  it("verification is case-insensitive on the email, matching how the token was generated", () => {
    const token = generateUnsubscribeToken("store_1", "Jordan@Example.com");
    expect(verifyUnsubscribeToken("store_1", "jordan@example.com", token)).toBe(true);
  });

  it("rejects a token generated for a different email", () => {
    const token = generateUnsubscribeToken("store_1", "jordan@example.com");
    expect(verifyUnsubscribeToken("store_1", "someone-else@example.com", token)).toBe(false);
  });

  it("rejects a token generated for a different store (cross-tenant forgery)", () => {
    const token = generateUnsubscribeToken("store_1", "jordan@example.com");
    expect(verifyUnsubscribeToken("store_2", "jordan@example.com", token)).toBe(false);
  });

  it("rejects a tampered/garbage token", () => {
    expect(verifyUnsubscribeToken("store_1", "jordan@example.com", "not-a-real-token")).toBe(false);
  });

  it("rejects an empty token", () => {
    expect(verifyUnsubscribeToken("store_1", "jordan@example.com", "")).toBe(false);
  });

  it("buildUnsubscribeUrl embeds a token that verifies for the same store/email", () => {
    const url = buildUnsubscribeUrl("store_1", "jordan@example.com");
    const parsed = new URL(url);

    expect(parsed.pathname).toBe("/unsubscribe");
    expect(parsed.searchParams.get("store")).toBe("store_1");
    expect(parsed.searchParams.get("email")).toBe("jordan@example.com");

    const token = parsed.searchParams.get("token")!;
    expect(verifyUnsubscribeToken("store_1", "jordan@example.com", token)).toBe(true);
  });
});
