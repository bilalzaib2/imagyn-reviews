// Exercises runDueReviewRequestSweep's own selection/dispatch logic against a fake in-memory
// ReviewRequest table and a fake dispatch function — no real database, no real email provider.
// See product.server.test.ts for the same mocking convention this file follows.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeRequestRow {
  id: string;
  status: string;
  scheduledFor: Date | null;
}

let fakeRequests: FakeRequestRow[];
let dispatchedIds: string[];
let failingIds: Set<string>;

vi.mock("../db.server", () => ({
  default: {
    reviewRequest: {
      findMany: vi.fn(
        async (args: { where: { status: string; scheduledFor: { lte: Date } }; take: number }) => {
          return fakeRequests
            .filter(
              (row) =>
                row.status === args.where.status &&
                row.scheduledFor !== null &&
                row.scheduledFor.getTime() <= args.where.scheduledFor.lte.getTime(),
            )
            .sort((a, b) => a.scheduledFor!.getTime() - b.scheduledFor!.getTime())
            .slice(0, args.take)
            .map((row) => ({ id: row.id }));
        },
      ),
    },
  },
}));

vi.mock("./reviewRequestDispatch.server", () => ({
  enqueueReviewRequestDispatch: vi.fn(async (id: string) => {
    if (failingIds.has(id)) {
      throw new Error(`Simulated dispatch failure for ${id}`);
    }
    dispatchedIds.push(id);
  }),
}));

const { runDueReviewRequestSweep } = await import("./reviewRequestScheduler.server");

describe("runDueReviewRequestSweep", () => {
  beforeEach(() => {
    fakeRequests = [];
    dispatchedIds = [];
    failingIds = new Set();
  });

  it("dispatches every scheduled request whose scheduledFor has arrived", async () => {
    const now = new Date("2026-08-10T12:00:00Z");
    fakeRequests = [
      { id: "req_due_1", status: "scheduled", scheduledFor: new Date("2026-08-09T12:00:00Z") },
      { id: "req_due_2", status: "scheduled", scheduledFor: new Date("2026-08-10T11:59:00Z") },
    ];

    const result = await runDueReviewRequestSweep(now);

    expect(result).toEqual({ due: 2, dispatched: 2 });
    expect(dispatchedIds.slice().sort()).toEqual(["req_due_1", "req_due_2"]);
  });

  it("does not dispatch a scheduled request whose scheduledFor is still in the future", async () => {
    const now = new Date("2026-08-10T12:00:00Z");
    fakeRequests = [{ id: "req_future", status: "scheduled", scheduledFor: new Date("2026-08-11T00:00:00Z") }];

    const result = await runDueReviewRequestSweep(now);

    expect(result).toEqual({ due: 0, dispatched: 0 });
    expect(dispatchedIds).toEqual([]);
  });

  it("does not touch requests in any status other than 'scheduled' (sent/failed/completed/cancelled)", async () => {
    const now = new Date("2026-08-10T12:00:00Z");
    fakeRequests = [
      { id: "req_sent", status: "sent", scheduledFor: new Date("2026-08-09T00:00:00Z") },
      { id: "req_failed", status: "failed", scheduledFor: new Date("2026-08-09T00:00:00Z") },
      { id: "req_completed", status: "completed", scheduledFor: new Date("2026-08-09T00:00:00Z") },
      { id: "req_cancelled", status: "cancelled", scheduledFor: new Date("2026-08-09T00:00:00Z") },
    ];

    const result = await runDueReviewRequestSweep(now);

    expect(result).toEqual({ due: 0, dispatched: 0 });
    expect(dispatchedIds).toEqual([]);
  });

  it("a single failing dispatch does not prevent the rest of the sweep from completing", async () => {
    const now = new Date("2026-08-10T12:00:00Z");
    fakeRequests = [
      { id: "req_ok_1", status: "scheduled", scheduledFor: new Date("2026-08-09T00:00:00Z") },
      { id: "req_bad", status: "scheduled", scheduledFor: new Date("2026-08-09T01:00:00Z") },
      { id: "req_ok_2", status: "scheduled", scheduledFor: new Date("2026-08-09T02:00:00Z") },
    ];
    failingIds = new Set(["req_bad"]);

    const result = await runDueReviewRequestSweep(now);

    expect(result).toEqual({ due: 3, dispatched: 2 });
    expect(dispatchedIds.slice().sort()).toEqual(["req_ok_1", "req_ok_2"]);
  });

  it("defaults to the current time when no 'now' is passed", async () => {
    fakeRequests = [{ id: "req_past", status: "scheduled", scheduledFor: new Date(Date.now() - 60_000) }];

    const result = await runDueReviewRequestSweep();

    expect(result).toEqual({ due: 1, dispatched: 1 });
  });
});
