// Syncing the merchant's public-facing contact email from Shopify.
//
// The value is the default Reply-To on every customer-facing review email, so the two things
// that matter are: it must stay current when a merchant edits it in Shopify, and a Shopify
// outage must never break a page load or clear a good stored value.
import { beforeEach, describe, expect, it, vi } from "vitest";

const setShopContactEmail = vi.fn(async () => ({}) as never);
vi.mock("./store.server", () => ({ setShopContactEmail }));

const { CONTACT_EMAIL_TTL_MS, ensureShopContactEmail, fetchShopContactEmail, isUsableReplyToAddress } = await import(
  "./shopContactEmail.server"
);

const NOW = new Date("2026-10-29T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60 * 1000);

function admin(contactEmail: unknown) {
  return {
    graphql: vi.fn(async () => ({ json: async () => ({ data: { shop: { contactEmail } } }) })),
  } as never;
}

function throwingAdmin() {
  return {
    graphql: vi.fn(async () => {
      throw new Error("Simulated Shopify throttle");
    }),
  } as never;
}

beforeEach(() => {
  setShopContactEmail.mockClear();
});

describe("isUsableReplyToAddress", () => {
  it("accepts an ordinary address", () => {
    expect(isUsableReplyToAddress("hello@gracestore.com")).toBe(true);
  });

  it("rejects anything that could terminate the header or add a recipient", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "   ",
      "not-an-address",
      "no-at-sign.test",
      "a@b@c.test",
      "a b@c.test",
      "x@y.test, evil@attacker.com",
      "x@y.test; evil@attacker.com",
      'x@y.test" <evil@attacker.com>',
      "<evil@attacker.com>",
      "a@b",
      `${"a".repeat(300)}@x.test`,
    ]) {
      expect(isUsableReplyToAddress(bad as string)).toBe(false);
    }
  });
});

describe("fetchShopContactEmail", () => {
  it("reads shop.contactEmail", async () => {
    expect(await fetchShopContactEmail(admin("hello@gracestore.com"))).toBe("hello@gracestore.com");
  });

  it("returns null for an unusable value rather than passing it on", async () => {
    for (const bad of [null, "", "   ", "not-an-address", "x@y.test, evil@attacker.com"]) {
      expect(await fetchShopContactEmail(admin(bad))).toBeNull();
    }
  });
});

describe("ensureShopContactEmail", () => {
  it("fetches and persists on a store that has never synced", async () => {
    const result = await ensureShopContactEmail(
      admin("hello@gracestore.com"),
      { id: "store_1", contactEmail: null, contactEmailSyncedAt: null },
      NOW,
    );

    expect(result).toBe("hello@gracestore.com");
    expect(setShopContactEmail).toHaveBeenCalledWith("store_1", "hello@gracestore.com", NOW);
  });

  it("uses the cached value without calling Shopify while it is fresh", async () => {
    const client = admin("ignored@gracestore.com");

    const result = await ensureShopContactEmail(
      client,
      { id: "store_1", contactEmail: "cached@gracestore.com", contactEmailSyncedAt: minutesAgo(5) },
      NOW,
    );

    expect(result).toBe("cached@gracestore.com");
    expect((client as unknown as { graphql: ReturnType<typeof vi.fn> }).graphql).not.toHaveBeenCalled();
    expect(setShopContactEmail).not.toHaveBeenCalled();
  });

  it("re-syncs once the cached value is stale, picking up a changed address", async () => {
    const stale = new Date(NOW.getTime() - CONTACT_EMAIL_TTL_MS - 1000);

    const result = await ensureShopContactEmail(
      admin("new@gracestore.com"),
      { id: "store_1", contactEmail: "old@gracestore.com", contactEmailSyncedAt: stale },
      NOW,
    );

    expect(result).toBe("new@gracestore.com");
    expect(setShopContactEmail).toHaveBeenCalledWith("store_1", "new@gracestore.com", NOW);
  });

  it("persists null when the merchant clears their contact email in Shopify", async () => {
    const stale = new Date(NOW.getTime() - CONTACT_EMAIL_TTL_MS - 1000);

    const result = await ensureShopContactEmail(
      admin(null),
      { id: "store_1", contactEmail: "old@gracestore.com", contactEmailSyncedAt: stale },
      NOW,
    );

    // The stale address must stop being used, not linger.
    expect(result).toBeNull();
    expect(setShopContactEmail).toHaveBeenCalledWith("store_1", null, NOW);
  });

  it("degrades to the stored value when Shopify throws, without persisting", async () => {
    const stale = new Date(NOW.getTime() - CONTACT_EMAIL_TTL_MS - 1000);

    const result = await ensureShopContactEmail(
      throwingAdmin(),
      { id: "store_1", contactEmail: "kept@gracestore.com", contactEmailSyncedAt: stale },
      NOW,
    );

    // Not cleared, and not persisted — so the very next load retries instead of waiting a day.
    expect(result).toBe("kept@gracestore.com");
    expect(setShopContactEmail).not.toHaveBeenCalled();
  });

  it("returns null rather than throwing when Shopify fails and nothing is stored", async () => {
    const result = await ensureShopContactEmail(
      throwingAdmin(),
      { id: "store_1", contactEmail: null, contactEmailSyncedAt: null },
      NOW,
    );

    expect(result).toBeNull();
    expect(setShopContactEmail).not.toHaveBeenCalled();
  });

  it("never returns a stored value that would be unsafe in a header", async () => {
    const result = await ensureShopContactEmail(
      throwingAdmin(),
      { id: "store_1", contactEmail: "x@y.test, evil@attacker.com", contactEmailSyncedAt: minutesAgo(5) },
      NOW,
    );

    expect(result).toBeNull();
  });
});
