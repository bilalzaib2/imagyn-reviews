// Exercises getSetupGuideItems' real completion signals against a fake in-memory Prisma
// client — no real database. Each item's "done" state must reflect the exact real condition
// described in its own comment, not a placeholder.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeStore {
  id: string;
  planStatus: string;
}

let store: FakeStore;
let reviewCount: number;
let requestCount: number;
let activeAppearance: { id: string } | null;

vi.mock("../db.server", () => ({
  default: {
    store: {
      findUniqueOrThrow: vi.fn(async () => store),
    },
    review: {
      count: vi.fn(async () => reviewCount),
    },
    reviewRequest: {
      count: vi.fn(async () => requestCount),
    },
  },
}));

vi.mock("./appearance.server", () => ({
  appearanceService: {
    getActive: vi.fn(async () => activeAppearance),
  },
}));

const { getSetupGuideItems } = await import("./setupGuide.server");

beforeEach(() => {
  store = { id: "store_1", planStatus: "pending" };
  reviewCount = 0;
  requestCount = 0;
  activeAppearance = null;
});

describe("getSetupGuideItems", () => {
  it("marks everything incomplete for a brand-new store", async () => {
    const items = await getSetupGuideItems("store_1");
    expect(items.every((item) => !item.done)).toBe(true);
  });

  it("marks the plan item done once planStatus leaves pending", async () => {
    store.planStatus = "active";
    const items = await getSetupGuideItems("store_1");
    expect(items.find((i) => i.key === "plan")?.done).toBe(true);
  });

  it("marks the reviews item done once at least one review exists", async () => {
    reviewCount = 1;
    const items = await getSetupGuideItems("store_1");
    expect(items.find((i) => i.key === "reviews")?.done).toBe(true);
  });

  it("marks the requests item done once at least one request exists", async () => {
    requestCount = 1;
    const items = await getSetupGuideItems("store_1");
    expect(items.find((i) => i.key === "requests")?.done).toBe(true);
  });

  it("marks the brand item done only once an appearance theme has actually been saved", async () => {
    activeAppearance = { id: "appearance_1" };
    const items = await getSetupGuideItems("store_1");
    expect(items.find((i) => i.key === "brand")?.done).toBe(true);
  });

  it("marks everything done once every real signal is present", async () => {
    store.planStatus = "active";
    reviewCount = 5;
    requestCount = 2;
    activeAppearance = { id: "appearance_1" };

    const items = await getSetupGuideItems("store_1");
    expect(items.every((item) => item.done)).toBe(true);
  });
});
