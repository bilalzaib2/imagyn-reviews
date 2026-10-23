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

const xff = (value: string) => new Request("https://example.com", { headers: { "x-forwarded-for": value } });

describe("extractClientIp", () => {
  it("resolves the real client through a single private infrastructure hop", () => {
    // Unchanged result from before this function read the chain right-to-left, but now for the
    // right reason: 10.0.0.1 is skipped as infrastructure, not simply ignored as "not first".
    expect(extractClientIp(xff("1.2.3.4, 10.0.0.1"))).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const request = new Request("https://example.com", { headers: { "x-real-ip": "5.6.7.8" } });
    expect(extractClientIp(request)).toBe("5.6.7.8");
  });

  it("returns null when neither header is present — never fabricated", () => {
    const request = new Request("https://example.com");
    expect(extractClientIp(request)).toBeNull();
  });

  // The regression this function existed to have and didn't. A proxy APPENDS the address it
  // received the connection from, so the leftmost entry is whatever the client claimed. Reading
  // it made every throttle below bypassable with one header.
  describe("spoof resistance", () => {
    it("ignores a client-supplied leftmost address and uses the proxy-observed one", () => {
      expect(extractClientIp(xff("203.0.113.9, 198.51.100.7"))).toBe("198.51.100.7");
    });

    it("gives a spoofing client the SAME bucket no matter what it claims", () => {
      const a = extractClientIp(xff("1.1.1.1, 198.51.100.7"));
      const b = extractClientIp(xff("2.2.2.2, 198.51.100.7"));
      const c = extractClientIp(xff("9.9.9.9, 9.8.7.6, 198.51.100.7"));
      expect(a).toBe("198.51.100.7");
      expect(b).toBe("198.51.100.7");
      expect(c).toBe("198.51.100.7");
      expect(new Set([a, b, c]).size).toBe(1);
    });

    it("is not fooled by a forged chain that mimics infrastructure hops", () => {
      // Claiming private hops on the right cannot push resolution back onto the forged left.
      expect(extractClientIp(xff("1.1.1.1, 10.0.0.5, 192.168.1.1, 198.51.100.7"))).toBe("198.51.100.7");
    });
  });

  // Railway's edge/router hops are private; the real client is public. The walk must tolerate
  // however many of them there are rather than assuming a fixed trusted-hop count.
  describe("private-hop skipping", () => {
    it.each([
      ["10.0.0.1", "10/8"],
      ["172.16.0.1", "172.16/12"],
      ["172.31.255.254", "172.31 upper bound"],
      ["192.168.1.1", "192.168/16"],
      ["127.0.0.1", "loopback"],
      ["169.254.1.1", "link-local"],
      ["100.64.0.1", "CGNAT 100.64/10"],
      ["::1", "IPv6 loopback"],
      ["fd00::1", "IPv6 unique-local"],
      ["fe80::1", "IPv6 link-local"],
      ["::ffff:10.0.0.1", "IPv4-mapped private"],
    ])("skips %s (%s)", (privateHop) => {
      expect(extractClientIp(xff(`198.51.100.7, ${privateHop}`))).toBe("198.51.100.7");
    });

    it("skips several private hops in a row", () => {
      expect(extractClientIp(xff("198.51.100.7, 10.0.0.1, 172.20.0.1, 192.168.0.1"))).toBe("198.51.100.7");
    });

    it("does NOT treat a public address in a private-looking range as private", () => {
      // 172.32/12 and 100.128/9 sit just outside the private/CGNAT blocks.
      expect(extractClientIp(xff("10.0.0.1, 172.32.0.1"))).toBe("172.32.0.1");
      expect(extractClientIp(xff("10.0.0.1, 100.128.0.1"))).toBe("100.128.0.1");
    });

    it("falls back to the rightmost hop when every address is private", () => {
      // An all-private deployment still needs a stable bucket rather than no throttling at all.
      expect(extractClientIp(xff("10.0.0.1, 192.168.1.1"))).toBe("192.168.1.1");
    });
  });

  it("tolerates whitespace and empty entries in the chain", () => {
    expect(extractClientIp(xff("  198.51.100.7 ,, 10.0.0.1  "))).toBe("198.51.100.7");
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

// Votes and submissions must not share a counting bucket: one shopper marking a page full of
// reviews helpful is ordinary browsing, and must never consume their ability to submit a review.
describe("throttle scopes", () => {
  it("defaults to the submission scope, preserving the 5-per-window limit", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await checkAndRecordSubmission("store_1", requestWithIp("1.2.3.4"))).allowed).toBe(true);
    }
    expect((await checkAndRecordSubmission("store_1", requestWithIp("1.2.3.4"))).allowed).toBe(false);
  });

  it("hashes the submission scope identically to the pre-scope implementation", async () => {
    // Guards the migration-free bucketing: "submission" must hash the bare IP, or every throttle
    // row already in the production database silently stops counting.
    const expected = (await import("node:crypto"))
      .createHash("sha256")
      .update("1.2.3.4")
      .digest("hex");
    await checkAndRecordSubmission("store_1", requestWithIp("1.2.3.4"));
    expect(rows[0].ipHash).toBe(expected);
  });

  it("exhausting the submission budget leaves voting unaffected", async () => {
    for (let i = 0; i < 5; i++) {
      await checkAndRecordSubmission("store_1", requestWithIp("1.2.3.4"));
    }
    expect((await checkAndRecordSubmission("store_1", requestWithIp("1.2.3.4"))).allowed).toBe(false);
    expect((await checkAndRecordSubmission("store_1", requestWithIp("1.2.3.4"), "vote")).allowed).toBe(true);
  });

  it("exhausting the vote budget leaves submission unaffected", async () => {
    for (let i = 0; i < 60; i++) {
      await checkAndRecordSubmission("store_1", requestWithIp("1.2.3.4"), "vote");
    }
    expect((await checkAndRecordSubmission("store_1", requestWithIp("1.2.3.4"), "vote")).allowed).toBe(false);
    expect((await checkAndRecordSubmission("store_1", requestWithIp("1.2.3.4"), "submission")).allowed).toBe(true);
  });

  it("allows a realistic page of voting (a dozen reviews) without throttling", async () => {
    for (let i = 0; i < 12; i++) {
      expect((await checkAndRecordSubmission("store_1", requestWithIp("1.2.3.4"), "vote")).allowed).toBe(true);
    }
  });

  it("still bounds a vote flood from one connection", async () => {
    let allowed = 0;
    for (let i = 0; i < 200; i++) {
      if ((await checkAndRecordSubmission("store_1", requestWithIp("1.2.3.4"), "vote")).allowed) allowed += 1;
    }
    expect(allowed).toBe(60);
  });

  it("keeps vote buckets per-store", async () => {
    for (let i = 0; i < 60; i++) {
      await checkAndRecordSubmission("store_1", requestWithIp("1.2.3.4"), "vote");
    }
    expect((await checkAndRecordSubmission("store_2", requestWithIp("1.2.3.4"), "vote")).allowed).toBe(true);
  });

  it("a vote flood cannot be reset by spoofing X-Forwarded-For", async () => {
    // The whole point of reading the chain right-to-left: rotating the claimed address must not
    // mint a fresh bucket.
    const spoof = (claimed: string) =>
      new Request("https://example.com/apps/reviews", {
        method: "POST",
        headers: { "x-forwarded-for": `${claimed}, 198.51.100.7` },
      });

    let allowed = 0;
    for (let i = 0; i < 200; i++) {
      if ((await checkAndRecordSubmission("store_1", spoof(`10.9.8.${i % 256}`), "vote")).allowed) allowed += 1;
    }
    expect(allowed).toBe(60);
  });
});
