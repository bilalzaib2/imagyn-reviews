// Exercises checkAndRecordSubmission's real bucketing/threshold logic against a fake
// in-memory Prisma client — no real database.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeThrottleRow {
  storeId: string;
  ipHash: string;
  createdAt: Date;
}

let rows: FakeThrottleRow[];

vi.mock("../db.server", () => ({
  default: {
    reviewSubmissionThrottle: {
      count: vi.fn(async ({ where }: { where: { storeId: string; ipHash: string; createdAt: { gte: Date } } }) =>
        rows.filter(
          (r) => r.storeId === where.storeId && r.ipHash === where.ipHash && r.createdAt >= where.createdAt.gte,
        ).length,
      ),
      create: vi.fn(async ({ data }: { data: { storeId: string; ipHash: string } }) => {
        const row = { ...data, createdAt: new Date() };
        rows.push(row);
        return row;
      }),
    },
  },
}));

const { checkAndRecordSubmission, extractClientIp } = await import("./reviewSubmissionThrottle.server");

function requestWithIp(ip: string | null): Request {
  return new Request("https://example.com/apps/reviews", {
    method: "POST",
    headers: ip ? { "x-forwarded-for": ip } : {},
  });
}

beforeEach(() => {
  rows = [];
});

describe("extractClientIp", () => {
  it("takes the leftmost address from a proxy chain", () => {
    const request = new Request("https://example.com", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } });
    expect(extractClientIp(request)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const request = new Request("https://example.com", { headers: { "x-real-ip": "5.6.7.8" } });
    expect(extractClientIp(request)).toBe("5.6.7.8");
  });

  it("returns null when neither header is present — never fabricated", () => {
    const request = new Request("https://example.com");
    expect(extractClientIp(request)).toBeNull();
  });
});

describe("checkAndRecordSubmission", () => {
  it("allows the first several submissions from the same IP", async () => {
    for (let i = 0; i < 5; i++) {
      const result = await checkAndRecordSubmission("store_1", requestWithIp("1.2.3.4"));
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks once the same store+IP bucket exceeds the threshold within the window", async () => {
    for (let i = 0; i < 5; i++) {
      await checkAndRecordSubmission("store_1", requestWithIp("1.2.3.4"));
    }
    const sixth = await checkAndRecordSubmission("store_1", requestWithIp("1.2.3.4"));
    expect(sixth.allowed).toBe(false);
  });

  it("never records an attempt once already over the limit", async () => {
    for (let i = 0; i < 6; i++) {
      await checkAndRecordSubmission("store_1", requestWithIp("1.2.3.4"));
    }
    expect(rows.length).toBe(5);
  });

  it("keeps a different IP's bucket independent, even for the same store", async () => {
    for (let i = 0; i < 5; i++) {
      await checkAndRecordSubmission("store_1", requestWithIp("1.2.3.4"));
    }
    const otherIp = await checkAndRecordSubmission("store_1", requestWithIp("9.9.9.9"));
    expect(otherIp.allowed).toBe(true);
  });

  it("keeps a different store's bucket independent, even for the same IP", async () => {
    for (let i = 0; i < 5; i++) {
      await checkAndRecordSubmission("store_1", requestWithIp("1.2.3.4"));
    }
    const otherStore = await checkAndRecordSubmission("store_2", requestWithIp("1.2.3.4"));
    expect(otherStore.allowed).toBe(true);
  });

  it("never throttles a request with no discoverable IP", async () => {
    const result = await checkAndRecordSubmission("store_1", requestWithIp(null));
    expect(result.allowed).toBe(true);
    expect(rows.length).toBe(0);
  });
});
