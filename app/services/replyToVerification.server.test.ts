// Verified Reply-To (Pro).
//
// The security-relevant assertions are the point: a saved address is not a verified one, a
// token is single use and expiring, only a digest is stored, and changing the address drops
// any previous proof. Runs against the real Prisma client with a per-test fake store.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeStore {
  id: string;
  replyToEmail: string | null;
  replyToVerifiedAt: Date | null;
  replyToTokenHash: string | null;
  replyToTokenExpiresAt: Date | null;
  replyToTokenSentAt: Date | null;
}

let stores: FakeStore[] = [];

vi.mock("../db.server", () => ({
  default: {
    store: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return stores.find((s) => s.id === where.id) ?? null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeStore> }) => {
        const store = stores.find((s) => s.id === where.id);
        if (!store) throw new Error("Store not found");
        Object.assign(store, data);
        return store;
      }),
    },
  },
}));

const {
  RESEND_COOLDOWN_MS,
  VERIFICATION_TTL_MS,
  clearReplyTo,
  completeReplyToVerification,
  describeReplyTo,
  hashVerificationToken,
  isValidReplyToEmail,
  startReplyToVerification,
  tokenMatchesHash,
} = await import("./replyToVerification.server");

const NOW = new Date("2026-10-19T12:00:00.000Z");

function store(overrides: Partial<FakeStore> = {}): FakeStore {
  return {
    id: "store_1",
    replyToEmail: null,
    replyToVerifiedAt: null,
    replyToTokenHash: null,
    replyToTokenExpiresAt: null,
    replyToTokenSentAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  stores = [store()];
});

describe("email validation", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidReplyToEmail("support@grace.test")).toBe(true);
    expect(isValidReplyToEmail("  hello+reviews@shop.co.uk  ")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["", "   ", "nope", "a@b", "@grace.test", "a b@grace.test", "a@grace"]) {
      expect(isValidReplyToEmail(bad)).toBe(false);
    }
  });

  it("rejects an address carrying header-injection characters", () => {
    expect(isValidReplyToEmail('a@b.com, victim@evil.test')).toBe(false);
    expect(isValidReplyToEmail("a@b.com<x@y.test>")).toBe(false);
  });
});

describe("starting verification", () => {
  it("saves the address but does NOT mark it verified", async () => {
    const result = await startReplyToVerification("store_1", "support@grace.test", NOW);

    expect(result.ok).toBe(true);
    expect(stores[0].replyToEmail).toBe("support@grace.test");
    expect(stores[0].replyToVerifiedAt).toBeNull();
  });

  it("stores only a digest, never the token itself", async () => {
    const result = await startReplyToVerification("store_1", "support@grace.test", NOW);

    expect(result.token).toBeTruthy();
    expect(stores[0].replyToTokenHash).not.toBe(result.token);
    expect(stores[0].replyToTokenHash).toBe(hashVerificationToken(result.token!));
  });

  it("sets an expiry", async () => {
    await startReplyToVerification("store_1", "support@grace.test", NOW);

    expect(stores[0].replyToTokenExpiresAt?.getTime()).toBe(NOW.getTime() + VERIFICATION_TTL_MS);
  });

  it("refuses an invalid address without touching stored state", async () => {
    const result = await startReplyToVerification("store_1", "not-an-email", NOW);

    expect(result.ok).toBe(false);
    expect(stores[0].replyToEmail).toBeNull();
  });

  it("issues a different token each time", async () => {
    const a = await startReplyToVerification("store_1", "support@grace.test", NOW);
    const later = new Date(NOW.getTime() + RESEND_COOLDOWN_MS);
    const b = await startReplyToVerification("store_1", "support@grace.test", later);

    expect(a.token).not.toBe(b.token);
  });
});

describe("rate limiting", () => {
  it("throttles an immediate resend of the same address", async () => {
    await startReplyToVerification("store_1", "support@grace.test", NOW);
    const again = await startReplyToVerification("store_1", "support@grace.test", new Date(NOW.getTime() + 5_000));

    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/wait/i);
  });

  it("allows a resend once the cooldown has passed", async () => {
    await startReplyToVerification("store_1", "support@grace.test", NOW);
    const again = await startReplyToVerification(
      "store_1",
      "support@grace.test",
      new Date(NOW.getTime() + RESEND_COOLDOWN_MS),
    );

    expect(again.ok).toBe(true);
  });

  it("does not throttle a genuinely different address", async () => {
    // Switching address is a new intent, not a resend.
    await startReplyToVerification("store_1", "support@grace.test", NOW);
    const other = await startReplyToVerification("store_1", "hello@grace.test", new Date(NOW.getTime() + 1_000));

    expect(other.ok).toBe(true);
  });
});

describe("completing verification", () => {
  it("verifies with a valid token", async () => {
    const { token } = await startReplyToVerification("store_1", "support@grace.test", NOW);
    const outcome = await completeReplyToVerification("store_1", token!, NOW);

    expect(outcome).toBe("verified");
    expect(stores[0].replyToVerifiedAt).toEqual(NOW);
  });

  it("is single use — the same link cannot be replayed", async () => {
    const { token } = await startReplyToVerification("store_1", "support@grace.test", NOW);
    await completeReplyToVerification("store_1", token!, NOW);

    expect(stores[0].replyToTokenHash).toBeNull();
    expect(await completeReplyToVerification("store_1", token!, NOW)).toBe("already-verified");
  });

  it("rejects a wrong token", async () => {
    await startReplyToVerification("store_1", "support@grace.test", NOW);

    expect(await completeReplyToVerification("store_1", "not-the-token", NOW)).toBe("invalid");
    expect(stores[0].replyToVerifiedAt).toBeNull();
  });

  it("rejects an expired token and burns it", async () => {
    const { token } = await startReplyToVerification("store_1", "support@grace.test", NOW);
    const tooLate = new Date(NOW.getTime() + VERIFICATION_TTL_MS + 1);

    expect(await completeReplyToVerification("store_1", token!, tooLate)).toBe("expired");
    expect(stores[0].replyToVerifiedAt).toBeNull();
    // Burned, so it cannot be retried into working.
    expect(stores[0].replyToTokenHash).toBeNull();
  });

  it("reports invalid when nothing is pending", async () => {
    expect(await completeReplyToVerification("store_1", "anything", NOW)).toBe("invalid");
  });

  it("does not verify an unknown store", async () => {
    expect(await completeReplyToVerification("store_404", "anything", NOW)).toBe("invalid");
  });
});

describe("changing the address drops the proof", () => {
  it("clears verification when a different address is submitted", async () => {
    const { token } = await startReplyToVerification("store_1", "support@grace.test", NOW);
    await completeReplyToVerification("store_1", token!, NOW);
    expect(stores[0].replyToVerifiedAt).not.toBeNull();

    await startReplyToVerification("store_1", "new@grace.test", new Date(NOW.getTime() + 1_000));

    expect(stores[0].replyToEmail).toBe("new@grace.test");
    expect(stores[0].replyToVerifiedAt).toBeNull();
  });
});

describe("token hashing", () => {
  it("matches only the right token", () => {
    const hash = hashVerificationToken("abc");

    expect(tokenMatchesHash("abc", hash)).toBe(true);
    expect(tokenMatchesHash("abd", hash)).toBe(false);
  });

  it("never matches when nothing is stored", () => {
    expect(tokenMatchesHash("abc", null)).toBe(false);
  });

  it("handles a length mismatch without throwing", () => {
    expect(tokenMatchesHash("abc", "short")).toBe(false);
  });
});

describe("status reporting", () => {
  it("reports none, pending and verified distinctly", () => {
    expect(describeReplyTo(store(), NOW).state).toBe("none");
    expect(describeReplyTo(store({ replyToEmail: "a@b.test" }), NOW).state).toBe("pending");
    expect(
      describeReplyTo(store({ replyToEmail: "a@b.test", replyToVerifiedAt: NOW }), NOW).state,
    ).toBe("verified");
  });

  it("reports how long until a resend is allowed", () => {
    const status = describeReplyTo(
      store({ replyToEmail: "a@b.test", replyToTokenSentAt: new Date(NOW.getTime() - 10_000) }),
      NOW,
    );

    expect(status.canResend).toBe(false);
    expect(status.resendAvailableInSeconds).toBe(50);
  });
});

describe("clearing", () => {
  it("removes the address and every trace of verification", async () => {
    const { token } = await startReplyToVerification("store_1", "support@grace.test", NOW);
    await completeReplyToVerification("store_1", token!, NOW);

    await clearReplyTo("store_1");

    expect(stores[0].replyToEmail).toBeNull();
    expect(stores[0].replyToVerifiedAt).toBeNull();
    expect(stores[0].replyToTokenHash).toBeNull();
  });
});
