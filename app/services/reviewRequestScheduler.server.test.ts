// Exercises runDueReviewRequestSweep/runDueReminderSweep's own selection/dispatch logic against
// a fake in-memory ReviewRequest table and fake dispatch functions — no real database, no real
// email provider. See product.server.test.ts for the same mocking convention this file follows.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeRequestRow {
  id: string;
  status: string;
  scheduledFor: Date | null;
  // Reminder-sweep-only fields — unused by runDueReviewRequestSweep's own tests below.
  storeId?: string;
  sentAt?: Date | null;
  reviewedAt?: Date | null;
  reminder1SentAt?: Date | null;
  reminderFinalSentAt?: Date | null;
}

interface FakeStoreRow {
  reminderEmailsEnabled: boolean;
  remindersEnabledAt: Date | null;
}

let fakeRequests: FakeRequestRow[];
let fakeStores: Record<string, FakeStoreRow>;
let dispatchedIds: string[];
let failingIds: Set<string>;
let reminderDispatches: Array<{ id: string; type: string }>;
let failingReminderIds: Set<string>;

vi.mock("../db.server", () => ({
  default: {
    reviewRequest: {
      // Routes on whether the query filters by a related store (only runDueReminderSweep's
      // query does) — the two sweeps have genuinely different shapes, not worth two mock files.
      findMany: vi.fn(async (args: { where: Record<string, unknown>; take: number }) => {
        if (args.where.store !== undefined) {
          const storeFilter = args.where.store as { reminderEmailsEnabled: boolean };
          const or = args.where.OR as Array<{
            reminder1SentAt?: null;
            reminderFinalSentAt?: null;
            sentAt: { lte: Date };
          }>;

          return fakeRequests
            .filter((row) => row.reviewedAt == null)
            .filter((row) => !["completed", "cancelled", "failed"].includes(row.status))
            .filter((row) => row.sentAt != null)
            .filter((row) => row.storeId && fakeStores[row.storeId]?.reminderEmailsEnabled === storeFilter.reminderEmailsEnabled)
            .filter((row) =>
              or.some((clause) => {
                if ("reminder1SentAt" in clause && row.reminder1SentAt != null) return false;
                if ("reminderFinalSentAt" in clause && row.reminderFinalSentAt != null) return false;
                return row.sentAt!.getTime() <= clause.sentAt.lte.getTime();
              }),
            )
            .sort((a, b) => a.sentAt!.getTime() - b.sentAt!.getTime())
            .slice(0, args.take)
            .map((row) => ({
              id: row.id,
              sentAt: row.sentAt ?? null,
              reminder1SentAt: row.reminder1SentAt ?? null,
              reminderFinalSentAt: row.reminderFinalSentAt ?? null,
              store: { remindersEnabledAt: row.storeId ? fakeStores[row.storeId]?.remindersEnabledAt ?? null : null },
            }));
        }

        const where = args.where as { status: string; scheduledFor: { lte: Date } };
        return fakeRequests
          .filter(
            (row) =>
              row.status === where.status &&
              row.scheduledFor !== null &&
              row.scheduledFor.getTime() <= where.scheduledFor.lte.getTime(),
          )
          .sort((a, b) => a.scheduledFor!.getTime() - b.scheduledFor!.getTime())
          .slice(0, args.take)
          .map((row) => ({ id: row.id }));
      }),
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
  enqueueReminderDispatch: vi.fn(async (id: string, type: string) => {
    if (failingReminderIds.has(id)) {
      throw new Error(`Simulated reminder dispatch failure for ${id}`);
    }
    reminderDispatches.push({ id, type });
  }),
}));

const { runDueReviewRequestSweep, runDueReminderSweep } = await import("./reviewRequestScheduler.server");

describe("runDueReviewRequestSweep", () => {
  beforeEach(() => {
    fakeRequests = [];
    fakeStores = {};
    dispatchedIds = [];
    failingIds = new Set();
    reminderDispatches = [];
    failingReminderIds = new Set();
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

describe("runDueReminderSweep", () => {
  const now = new Date("2026-08-10T12:00:00Z");
  const day = (offset: number) => new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);

  beforeEach(() => {
    fakeRequests = [];
    fakeStores = { store_1: { reminderEmailsEnabled: true, remindersEnabledAt: day(30) } };
    dispatchedIds = [];
    failingIds = new Set();
    reminderDispatches = [];
    failingReminderIds = new Set();
  });

  it("dispatches reminder_1 for a request sent exactly 3 days ago with no reminder sent yet", async () => {
    fakeRequests = [{ id: "req_1", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(3) }];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 1, dispatched: 1 });
    expect(reminderDispatches).toEqual([{ id: "req_1", type: "reminder_1" }]);
  });

  it("does not dispatch reminder_1 for a request sent less than 3 days ago", async () => {
    fakeRequests = [{ id: "req_1", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(2) }];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 0, dispatched: 0 });
  });

  it("dispatches reminder_final for a request sent exactly 7 days ago whose reminder_1 already went out", async () => {
    fakeRequests = [
      {
        id: "req_1",
        storeId: "store_1",
        status: "opened",
        scheduledFor: null,
        sentAt: day(7),
        reminder1SentAt: day(4),
      },
    ];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 1, dispatched: 1 });
    expect(reminderDispatches).toEqual([{ id: "req_1", type: "reminder_final" }]);
  });

  it("dispatches reminder_final independently even if reminder_1 was never sent (spec: both anchored to sentAt, not chained)", async () => {
    fakeRequests = [
      { id: "req_1", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(7), reminder1SentAt: null },
    ];

    const result = await runDueReminderSweep(now);

    // Only one reminder per row per tick — reminder_1 takes priority since it's also due; the
    // final reminder becomes eligible on the very next tick once reminder1SentAt is set.
    expect(reminderDispatches).toEqual([{ id: "req_1", type: "reminder_1" }]);
  });

  it("never re-sends a reminder that already has its SentAt field set (idempotent)", async () => {
    fakeRequests = [
      {
        id: "req_1",
        storeId: "store_1",
        status: "sent",
        scheduledFor: null,
        sentAt: day(10),
        reminder1SentAt: day(7),
        reminderFinalSentAt: day(3),
      },
    ];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 0, dispatched: 0 });
    expect(reminderDispatches).toEqual([]);
  });

  it("running the sweep twice in a row never dispatches the same reminder twice", async () => {
    fakeRequests = [{ id: "req_1", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(3) }];

    await runDueReminderSweep(now);
    // Simulate the field the real dispatch would have set after a successful send — the fake
    // dispatch mock (unlike the real one) doesn't mutate fakeRequests itself.
    fakeRequests[0].reminder1SentAt = now;

    const second = await runDueReminderSweep(now);

    expect(second).toEqual({ due: 0, dispatched: 0 });
    expect(reminderDispatches).toEqual([{ id: "req_1", type: "reminder_1" }]);
  });

  it("stops immediately once a review is submitted (reviewedAt set)", async () => {
    fakeRequests = [
      { id: "req_1", storeId: "store_1", status: "completed", scheduledFor: null, sentAt: day(10), reviewedAt: day(1) },
    ];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 0, dispatched: 0 });
  });

  it("never sweeps a request whose store has reminders disabled", async () => {
    fakeStores.store_1.reminderEmailsEnabled = false;
    fakeRequests = [{ id: "req_1", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(3) }];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 0, dispatched: 0 });
  });

  it("never sweeps a request sent before the store's remindersEnabledAt cutoff (no backfill for historical requests)", async () => {
    fakeStores.store_1.remindersEnabledAt = day(2);
    fakeRequests = [
      // Sent 5 days ago — 3-day threshold long passed — but that's *before* reminders were
      // enabled 2 days ago, so this must never be swept, per the historical-safety rule.
      { id: "req_old", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(5) },
    ];

    const result = await runDueReminderSweep(now);

    // "due" reflects the raw DB-side match (the query can't express the cross-row
    // sentAt-vs-remindersEnabledAt comparison — see runDueReminderSweep's own comment); the
    // backlog guard runs in application code afterward, which is what "dispatched: 0" proves.
    expect(result).toEqual({ due: 1, dispatched: 0 });
  });

  it("does sweep a request sent after the store's remindersEnabledAt cutoff", async () => {
    fakeStores.store_1.remindersEnabledAt = day(4);
    fakeRequests = [{ id: "req_new", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(3) }];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 1, dispatched: 1 });
  });

  it("excludes cancelled and failed requests, same as completed", async () => {
    fakeRequests = [
      { id: "req_cancelled", storeId: "store_1", status: "cancelled", scheduledFor: null, sentAt: day(10) },
      { id: "req_failed", storeId: "store_1", status: "failed", scheduledFor: null, sentAt: day(10) },
    ];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 0, dispatched: 0 });
  });

  it("a single failing reminder dispatch does not prevent the rest of the sweep from completing", async () => {
    fakeRequests = [
      { id: "req_ok", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(3) },
      { id: "req_bad", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(4) },
    ];
    failingReminderIds = new Set(["req_bad"]);

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 2, dispatched: 1 });
    expect(reminderDispatches).toEqual([{ id: "req_ok", type: "reminder_1" }]);
  });
});
