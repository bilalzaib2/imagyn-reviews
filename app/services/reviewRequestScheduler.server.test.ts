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
  email?: string | null;
  sentAt?: Date | null;
  reviewedAt?: Date | null;
  reminder1SentAt?: Date | null;
  reminderFinalSentAt?: Date | null;
  /** Prisma maintains this via @updatedAt; the claim uses it as the lease timestamp. */
  updatedAt?: Date;
}

interface FakeStoreRow {
  reminderEmailsEnabled: boolean;
  remindersEnabledAt: Date | null;
  reminder1DelayDays: number;
  reminderFinalDelayDays: number;
  /** Plan entitlement, as permissions.ts would resolve it. Defaults to true in the helper
   *  below so every pre-existing reminder test keeps describing a Pro store, which is what
   *  they were always written against. */
  canUseEmailReminders?: boolean;
}

let fakeRequests: FakeRequestRow[];
let fakeStores: Record<string, FakeStoreRow>;
let dispatchedIds: string[];
let failingIds: Set<string>;
let reminderDispatches: Array<{ id: string; type: string }>;
let failingReminderIds: Set<string>;
/** Reminder ids whose dispatch returns false (no email sent) instead of throwing. */
let notSendingReminderIds: Set<string>;
let suppressedPairs: Set<string>;

vi.mock("../db.server", () => ({
  default: {
    // Backs runRetentionPurgeSweep's own "which stores exist" query — the actual purge
    // mechanics are reviewRequestService.purgeStaleContactInfo's job (mocked separately
    // below), already independently tested in review-request.server.test.ts.
    store: {
      findMany: vi.fn(async () => Object.keys(fakeStores).map((id) => ({ id }))),
    },
    reviewRequest: {
      // Routes on whether the query filters by a related store (only runDueReminderSweep's
      // query does) — the two sweeps have genuinely different shapes, not worth two mock files.
      findMany: vi.fn(async (args: { where: Record<string, unknown>; take: number }) => {
        if (args.where.store !== undefined) {
          const storeFilter = args.where.store as { reminderEmailsEnabled: boolean };
          const or = args.where.OR as Array<{ reminder1SentAt?: null; reminderFinalSentAt?: null }>;

          return fakeRequests
            .filter((row) => row.reviewedAt == null)
            .filter((row) => !["completed", "cancelled", "failed"].includes(row.status))
            .filter((row) => row.sentAt != null)
            .filter((row) => row.storeId && fakeStores[row.storeId]?.reminderEmailsEnabled === storeFilter.reminderEmailsEnabled)
            .filter((row) =>
              or.some((clause) => {
                if ("reminder1SentAt" in clause && row.reminder1SentAt != null) return false;
                if ("reminderFinalSentAt" in clause && row.reminderFinalSentAt != null) return false;
                return true;
              }),
            )
            .sort((a, b) => a.sentAt!.getTime() - b.sentAt!.getTime())
            .slice(0, args.take)
            .map((row) => ({
              id: row.id,
              email: row.email ?? null,
              sentAt: row.sentAt ?? null,
              reminder1SentAt: row.reminder1SentAt ?? null,
              reminderFinalSentAt: row.reminderFinalSentAt ?? null,
              store: {
                id: row.storeId ?? null,
                remindersEnabledAt: row.storeId ? fakeStores[row.storeId]?.remindersEnabledAt ?? null : null,
                reminder1DelayDays: row.storeId ? fakeStores[row.storeId]?.reminder1DelayDays ?? 3 : 3,
                reminderFinalDelayDays: row.storeId ? fakeStores[row.storeId]?.reminderFinalDelayDays ?? 7 : 7,
              },
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

      // Models Prisma/Postgres conditional-update semantics, which is what the atomic claim
      // relies on: the predicate and the write are one indivisible step, and `count` reports how
      // many rows actually matched. Returning count 0 is how a losing worker learns it lost.
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const { where, data } = args;
        let count = 0;

        for (const row of fakeRequests) {
          if (where.id !== undefined && row.id !== where.id) continue;
          if (where.status !== undefined && row.status !== where.status) continue;
          if ("reminder1SentAt" in where && where.reminder1SentAt === null && row.reminder1SentAt != null) continue;
          if ("reminderFinalSentAt" in where && where.reminderFinalSentAt === null && row.reminderFinalSentAt != null)
            continue;
          if (where.updatedAt !== undefined) {
            const lt = (where.updatedAt as { lt: Date }).lt;
            if (!row.updatedAt || row.updatedAt.getTime() >= lt.getTime()) continue;
          }

          Object.assign(row, data);
          row.updatedAt = new Date();
          count += 1;
        }

        return { count };
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
    if (notSendingReminderIds.has(id)) {
      // Reached the dispatch layer but sent nothing (provider error, suppression discovered
      // there). Returns false rather than throwing — the sweep must roll its claim back either
      // way, and both routes are covered below.
      return false;
    }
    reminderDispatches.push({ id, type });
    return true;
  }),
}));

// Plan entitlement, as runDueReminderSweep now checks it before dispatching any reminder.
// Defaults to true for any store the test didn't explicitly mark as Free, so every
// pre-existing reminder test in this file continues to describe a Pro store.
const getStorePermissionsMock = vi.fn(async (storeId: string) => ({
  canUseEmailReminders: fakeStores[storeId]?.canUseEmailReminders ?? true,
}));

vi.mock("./permissions", () => ({
  getStorePermissions: (storeId: string) => getStorePermissionsMock(storeId),
}));

vi.mock("./emailSuppression.server", () => ({
  emailSuppressionService: {
    isSuppressed: vi.fn(async (storeId: string, email: string | null) => {
      if (!email) return false;
      return suppressedPairs.has(`${storeId}:${email}`);
    }),
  },
}));

// The scheduler's retention sweep is tested as pure orchestration (does it call the real
// mechanism for the right stores, with the right args, isolating one store's failure from
// the rest?) — the actual redaction/audit-logging mechanics of purgeStaleContactInfo already
// have their own 14 tests in review-request.server.test.ts, not re-verified here.
const purgeStaleContactInfoMock = vi.fn<
  (storeId: string, options: { retentionDays: number; now?: Date }) => Promise<{ redacted: number }>
>(async () => ({ redacted: 0 }));

vi.mock("./review-request.server", () => ({
  reviewRequestService: {
    purgeStaleContactInfo: purgeStaleContactInfoMock,
  },
}));

const {
  runDueReviewRequestSweep,
  runDueReminderSweep,
  runRetentionPurgeSweep,
  recoverStaleClaims,
  getSchedulerStatus,
} = await import("./reviewRequestScheduler.server");

describe("runDueReviewRequestSweep", () => {
  beforeEach(() => {
    fakeRequests = [];
    fakeStores = {};
    dispatchedIds = [];
    failingIds = new Set();
    reminderDispatches = [];
    failingReminderIds = new Set();
    notSendingReminderIds = new Set();
    suppressedPairs = new Set();
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
    fakeStores = {
      store_1: { reminderEmailsEnabled: true, remindersEnabledAt: day(30), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    dispatchedIds = [];
    failingIds = new Set();
    reminderDispatches = [];
    failingReminderIds = new Set();
    notSendingReminderIds = new Set();
    suppressedPairs = new Set();
  });

  it("dispatches reminder_1 for a request sent exactly 3 days ago with no reminder sent yet", async () => {
    fakeRequests = [{ id: "req_1", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(3) }];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([{ id: "req_1", type: "reminder_1" }]);
  });

  it("does not dispatch reminder_1 for a request sent less than 3 days ago", async () => {
    fakeRequests = [{ id: "req_1", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(2) }];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 0, dispatched: 0, claimLeaks: 0 });
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

    expect(result).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([{ id: "req_1", type: "reminder_final" }]);
  });

  it("dispatches reminder_final independently even if reminder_1 was never sent (spec: both anchored to sentAt, not chained)", async () => {
    fakeRequests = [
      { id: "req_1", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(7), reminder1SentAt: null },
    ];

    await runDueReminderSweep(now);

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

    expect(result).toEqual({ due: 0, dispatched: 0, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([]);
  });

  it("running the sweep twice in a row never dispatches the same reminder twice", async () => {
    fakeRequests = [{ id: "req_1", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(3) }];

    await runDueReminderSweep(now);
    // Simulate the field the real dispatch would have set after a successful send — the fake
    // dispatch mock (unlike the real one) doesn't mutate fakeRequests itself.
    fakeRequests[0].reminder1SentAt = now;

    const second = await runDueReminderSweep(now);

    expect(second).toEqual({ due: 0, dispatched: 0, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([{ id: "req_1", type: "reminder_1" }]);
  });

  it("stops immediately once a review is submitted (reviewedAt set)", async () => {
    fakeRequests = [
      { id: "req_1", storeId: "store_1", status: "completed", scheduledFor: null, sentAt: day(10), reviewedAt: day(1) },
    ];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 0, dispatched: 0, claimLeaks: 0 });
  });

  it("never sweeps a request whose store has reminders disabled", async () => {
    fakeStores.store_1.reminderEmailsEnabled = false;
    fakeRequests = [{ id: "req_1", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(3) }];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 0, dispatched: 0, claimLeaks: 0 });
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
    expect(result).toEqual({ due: 1, dispatched: 0, claimLeaks: 0 });
  });

  it("does sweep a request sent after the store's remindersEnabledAt cutoff", async () => {
    fakeStores.store_1.remindersEnabledAt = day(4);
    fakeRequests = [{ id: "req_new", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(3) }];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
  });

  it("excludes cancelled and failed requests, same as completed", async () => {
    fakeRequests = [
      { id: "req_cancelled", storeId: "store_1", status: "cancelled", scheduledFor: null, sentAt: day(10) },
      { id: "req_failed", storeId: "store_1", status: "failed", scheduledFor: null, sentAt: day(10) },
    ];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 0, dispatched: 0, claimLeaks: 0 });
  });

  it("a single failing reminder dispatch does not prevent the rest of the sweep from completing", async () => {
    fakeRequests = [
      { id: "req_ok", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(3) },
      { id: "req_bad", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(4) },
    ];
    failingReminderIds = new Set(["req_bad"]);

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 2, dispatched: 1, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([{ id: "req_ok", type: "reminder_1" }]);
  });

  it("never dispatches a reminder to a suppressed recipient — excluded before the dispatch layer, not just no-op'd there", async () => {
    fakeRequests = [
      { id: "req_suppressed", storeId: "store_1", email: "jordan@example.com", status: "sent", scheduledFor: null, sentAt: day(3) },
    ];
    suppressedPairs.add("store_1:jordan@example.com");

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 1, dispatched: 0, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([]);
  });

  it("a suppression on a different store never blocks this store's reminder", async () => {
    fakeRequests = [
      { id: "req_1", storeId: "store_1", email: "jordan@example.com", status: "sent", scheduledFor: null, sentAt: day(3) },
    ];
    suppressedPairs.add("store_2:jordan@example.com");

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([{ id: "req_1", type: "reminder_1" }]);
  });

  describe("merchant-configurable reminder delays (Settings → Request Scheduling)", () => {
    it("honors a store's own reminder1DelayDays instead of the old fixed 3-day default", async () => {
      fakeStores.store_1.reminder1DelayDays = 5;
      // Sent 3 days ago — due under the old fixed default, but not yet due under this store's
      // own 5-day configuration.
      fakeRequests = [{ id: "req_1", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(3) }];

      const result = await runDueReminderSweep(now);

      expect(result).toEqual({ due: 0, dispatched: 0, claimLeaks: 0 });
    });

    it("dispatches reminder_1 once a request crosses this store's own configured delay", async () => {
      fakeStores.store_1.reminder1DelayDays = 5;
      fakeRequests = [{ id: "req_1", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(5) }];

      const result = await runDueReminderSweep(now);

      expect(result).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
      expect(reminderDispatches).toEqual([{ id: "req_1", type: "reminder_1" }]);
    });

    it("honors a store's own reminderFinalDelayDays independently of reminder1DelayDays", async () => {
      fakeStores.store_1.reminder1DelayDays = 2;
      fakeStores.store_1.reminderFinalDelayDays = 10;
      fakeRequests = [
        {
          id: "req_1",
          storeId: "store_1",
          status: "opened",
          scheduledFor: null,
          sentAt: day(9),
          reminder1SentAt: day(7),
        },
      ];

      // Final reminder configured for 10 days — 9 days in, not yet due.
      const notYetDue = await runDueReminderSweep(now);
      expect(notYetDue).toEqual({ due: 0, dispatched: 0, claimLeaks: 0 });

      fakeRequests[0].sentAt = day(10);
      const due = await runDueReminderSweep(now);
      expect(due).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
      expect(reminderDispatches).toEqual([{ id: "req_1", type: "reminder_final" }]);
    });

    it("two stores with different configured delays are evaluated independently in the same sweep", async () => {
      fakeStores.store_1.reminder1DelayDays = 2;
      fakeStores.store_2 = { reminderEmailsEnabled: true, remindersEnabledAt: day(30), reminder1DelayDays: 8, reminderFinalDelayDays: 14 };
      fakeRequests = [
        { id: "req_fast_store", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(2) },
        { id: "req_slow_store", storeId: "store_2", status: "sent", scheduledFor: null, sentAt: day(2) },
      ];

      const result = await runDueReminderSweep(now);

      // store_1's 2-day delay makes req_fast_store due; store_2's 8-day delay does not.
      expect(result).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
      expect(reminderDispatches).toEqual([{ id: "req_fast_store", type: "reminder_1" }]);
    });
  });

  // The Free/Pro product rule: Free gets exactly one initial review-request email per
  // eligible order (dispatched by runDueReviewRequestSweep, tested in its own describe block
  // above — entirely independent of this sweep) and NO automated reminder sequence. Pro keeps
  // both. The store-level reminderEmailsEnabled preference is not sufficient on its own: it
  // survives a downgrade, so the plan itself has to be checked at dispatch time.
  describe("plan gating (Free never receives automated reminders)", () => {
    it("does not dispatch a reminder for a Free store, even with reminderEmailsEnabled stuck on after a downgrade", async () => {
      fakeStores.store_1.canUseEmailReminders = false;
      fakeRequests = [{ id: "req_1", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(3) }];

      const result = await runDueReminderSweep(now);

      // Still counted as "due" (its date condition is genuinely met) — but never sent, the
      // same way the remindersEnabledAt and suppression guards behave.
      expect(result).toEqual({ due: 1, dispatched: 0, claimLeaks: 0 });
      expect(reminderDispatches).toEqual([]);
    });

    it("does not dispatch the final reminder for a Free store either", async () => {
      fakeStores.store_1.canUseEmailReminders = false;
      fakeRequests = [
        { id: "req_1", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(7), reminder1SentAt: day(4) },
      ];

      const result = await runDueReminderSweep(now);

      expect(result).toEqual({ due: 1, dispatched: 0, claimLeaks: 0 });
      expect(reminderDispatches).toEqual([]);
    });

    it("still dispatches reminders for a Pro store in the same sweep as a Free one", async () => {
      fakeStores.store_1.canUseEmailReminders = false;
      fakeStores.store_2 = {
        reminderEmailsEnabled: true,
        remindersEnabledAt: day(30),
        reminder1DelayDays: 3,
        reminderFinalDelayDays: 7,
        canUseEmailReminders: true,
      };
      fakeRequests = [
        { id: "req_free", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(3) },
        { id: "req_pro", storeId: "store_2", status: "sent", scheduledFor: null, sentAt: day(3) },
      ];

      const result = await runDueReminderSweep(now);

      expect(result).toEqual({ due: 2, dispatched: 1, claimLeaks: 0 });
      expect(reminderDispatches).toEqual([{ id: "req_pro", type: "reminder_1" }]);
    });

    it("resolves plan entitlement once per store per sweep, not once per due request", async () => {
      getStorePermissionsMock.mockClear();
      fakeRequests = [
        { id: "req_1", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(3) },
        { id: "req_2", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(4) },
        { id: "req_3", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(5) },
      ];

      await runDueReminderSweep(now);

      expect(reminderDispatches).toHaveLength(3);
      expect(getStorePermissionsMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe("runRetentionPurgeSweep", () => {
  beforeEach(() => {
    fakeStores = {};
    purgeStaleContactInfoMock.mockClear();
    purgeStaleContactInfoMock.mockImplementation(async () => ({ redacted: 0 }));
  });

  it("calls purgeStaleContactInfo once per existing store, with the 90-day retention window", async () => {
    fakeStores = {
      store_1: { reminderEmailsEnabled: false, remindersEnabledAt: null, reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
      store_2: { reminderEmailsEnabled: false, remindersEnabledAt: null, reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    const now = new Date("2026-09-08T00:00:00Z");

    await runRetentionPurgeSweep(now);

    expect(purgeStaleContactInfoMock).toHaveBeenCalledTimes(2);
    expect(purgeStaleContactInfoMock).toHaveBeenCalledWith("store_1", { retentionDays: 90, now });
    expect(purgeStaleContactInfoMock).toHaveBeenCalledWith("store_2", { retentionDays: 90, now });
  });

  it("sums the redacted count across every store", async () => {
    fakeStores = {
      store_1: { reminderEmailsEnabled: false, remindersEnabledAt: null, reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
      store_2: { reminderEmailsEnabled: false, remindersEnabledAt: null, reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    purgeStaleContactInfoMock.mockImplementationOnce(async () => ({ redacted: 3 }));
    purgeStaleContactInfoMock.mockImplementationOnce(async () => ({ redacted: 5 }));

    const result = await runRetentionPurgeSweep(new Date());

    expect(result).toEqual({ storesProcessed: 2, redacted: 8 });
  });

  it("one store's failure never aborts the rest of the sweep — same isolation as the other two sweeps", async () => {
    fakeStores = {
      store_1: { reminderEmailsEnabled: false, remindersEnabledAt: null, reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
      store_2: { reminderEmailsEnabled: false, remindersEnabledAt: null, reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    purgeStaleContactInfoMock.mockImplementationOnce(async () => {
      throw new Error("Connection reset");
    });
    purgeStaleContactInfoMock.mockImplementationOnce(async () => ({ redacted: 2 }));

    const result = await runRetentionPurgeSweep(new Date());

    expect(result).toEqual({ storesProcessed: 2, redacted: 2 });
  });

  it("returns zero cleanly when there are no stores at all", async () => {
    fakeStores = {};

    const result = await runRetentionPurgeSweep(new Date());

    expect(result).toEqual({ storesProcessed: 0, redacted: 0 });
    expect(purgeStaleContactInfoMock).not.toHaveBeenCalled();
  });
});

// Observability. The scheduler previously logged only failures, so an empty log could not be
// told apart from a loop that was never running. These assertions pin the shape operators
// and any future status UI read.
describe("getSchedulerStatus", () => {
  it("reports the real sweep interval rather than a hardcoded guess", () => {
    expect(getSchedulerStatus().intervalMinutes).toBe(5);
  });

  it("reports not-running before the scheduler is started in this process", () => {
    // The module under test never calls startReviewRequestScheduler, so this is the honest
    // answer — and it is what makes "running" a meaningful signal rather than always true.
    expect(getSchedulerStatus().running).toBe(false);
  });

  it("has no last run until a sweep has actually completed", () => {
    // Never a fabricated timestamp: a process that has not swept yet says so.
    expect(getSchedulerStatus().lastRun).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Atomic claim: duplicate-send prevention across concurrent workers.
//
// The bug these pin: both sweeps used to select candidate rows and then send, with the terminal
// write (status "sent" / reminder timestamp) happening AFTER the email left. Two Railway replicas
// ticking in the same window therefore both selected the same rows and both emailed the same
// customer. Nothing in the codebase locked anything — a repo-wide grep for advisory locks,
// FOR UPDATE and SKIP LOCKED found nothing.
//
// The fake updateMany above models Prisma/Postgres conditional-update semantics (predicate and
// write as one indivisible step, `count` reporting matches), which is the exact primitive the fix
// relies on. Concurrency is driven with Promise.all: the sweeps interleave at their real await
// points, so a claim taken by one worker is visible to the other mid-flight.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("atomic claim — concurrent workers", () => {
  beforeEach(() => {
    fakeRequests = [];
    fakeStores = {};
    dispatchedIds = [];
    failingIds = new Set();
    reminderDispatches = [];
    failingReminderIds = new Set();
    notSendingReminderIds = new Set();
    suppressedPairs = new Set();
  });

  const NOW = new Date("2026-08-10T12:00:00Z");
  const dueRow = (id: string): FakeRequestRow => ({
    id,
    status: "scheduled",
    scheduledFor: new Date("2026-08-09T12:00:00Z"),
    updatedAt: new Date("2026-08-09T12:00:00Z"),
  });

  it("two workers sweeping the same due row send it exactly once", async () => {
    fakeRequests = [dueRow("req_1")];

    const [a, b] = await Promise.all([runDueReviewRequestSweep(NOW), runDueReviewRequestSweep(NOW)]);

    expect(dispatchedIds).toEqual(["req_1"]);
    expect(a.dispatched + b.dispatched).toBe(1);
  });

  it("both workers still SEE the row — the claim, not the query, is what dedupes", async () => {
    // Guards against a future refactor "fixing" this by narrowing the select instead: `due`
    // legitimately reports 1 for both, because both observed an eligible row.
    fakeRequests = [dueRow("req_1")];

    const [a, b] = await Promise.all([runDueReviewRequestSweep(NOW), runDueReviewRequestSweep(NOW)]);

    expect(a.due).toBe(1);
    expect(b.due).toBe(1);
    expect(dispatchedIds).toHaveLength(1);
  });

  it("a batch of due rows is dispatched once each across four workers", async () => {
    fakeRequests = Array.from({ length: 12 }, (_, i) => dueRow(`req_${i}`));

    const results = await Promise.all([
      runDueReviewRequestSweep(NOW),
      runDueReviewRequestSweep(NOW),
      runDueReviewRequestSweep(NOW),
      runDueReviewRequestSweep(NOW),
    ]);

    expect(dispatchedIds).toHaveLength(12);
    expect(new Set(dispatchedIds).size).toBe(12);
    expect(results.reduce((n, r) => n + r.dispatched, 0)).toBe(12);
  });

  it("a claimed row leaves 'scheduled' so a later sweep cannot re-send it", async () => {
    fakeRequests = [dueRow("req_1")];

    await runDueReviewRequestSweep(NOW);
    expect(dispatchedIds).toEqual(["req_1"]);

    // The dispatch layer is faked, so nothing moved the row to "sent" — it is still "sending".
    // A subsequent sweep must not pick it up regardless.
    await runDueReviewRequestSweep(NOW);
    expect(dispatchedIds).toEqual(["req_1"]);
  });

  it("claims via a conditional update predicated on status, not an unconditional write", async () => {
    const prisma = (await import("../db.server")).default as unknown as {
      reviewRequest: {
        updateMany: {
          mock: { calls: Array<[{ where: Record<string, unknown>; data: Record<string, unknown> }]> };
          mockClear: () => void;
        };
      };
    };
    // Mock calls accumulate across tests in this file, so start from a clean slate.
    prisma.reviewRequest.updateMany.mockClear();

    fakeRequests = [dueRow("req_1")];
    await runDueReviewRequestSweep(NOW);

    const claimCall = prisma.reviewRequest.updateMany.mock.calls.find(
      (c) => (c[0].where as { id?: string }).id === "req_1" && "status" in c[0].where,
    );
    expect(claimCall).toBeDefined();
    // The predicate is what makes it a claim: an unconditional `where: { id }` would let both
    // workers "win" and send twice.
    expect(claimCall![0].where).toMatchObject({ id: "req_1", status: "scheduled" });
    expect(claimCall![0].data).toMatchObject({ status: "sending" });
  });

  it("a row cancelled between select and claim is never sent", async () => {
    fakeRequests = [dueRow("req_1")];
    const row = fakeRequests[0];

    // Models the admin cancelling it in the gap: the select already returned it, but the claim's
    // `status: "scheduled"` predicate no longer matches.
    const { default: prisma } = (await import("../db.server")) as unknown as {
      default: { reviewRequest: { findMany: { mockImplementationOnce: (f: () => unknown) => void } } };
    };
    prisma.reviewRequest.findMany.mockImplementationOnce(async () => {
      row.status = "cancelled";
      return [{ id: "req_1" }];
    });

    const result = await runDueReviewRequestSweep(NOW);

    expect(dispatchedIds).toEqual([]);
    expect(result.dispatched).toBe(0);
  });
});

describe("atomic claim — reminders, concurrent workers", () => {
  beforeEach(() => {
    fakeRequests = [];
    fakeStores = {};
    dispatchedIds = [];
    failingIds = new Set();
    reminderDispatches = [];
    failingReminderIds = new Set();
    notSendingReminderIds = new Set();
    suppressedPairs = new Set();
  });

  const NOW = new Date("2026-08-20T12:00:00Z");

  function proStoreWithDueReminder(id: string) {
    fakeStores = {
      store_1: {
        reminderEmailsEnabled: true,
        remindersEnabledAt: new Date("2026-01-01T00:00:00Z"),
        reminder1DelayDays: 3,
        reminderFinalDelayDays: 7,
      },
    };
    fakeRequests = [
      {
        id,
        status: "sent",
        scheduledFor: null,
        storeId: "store_1",
        email: "customer@example.com",
        sentAt: new Date("2026-08-10T12:00:00Z"),
        reviewedAt: null,
        reminder1SentAt: null,
        reminderFinalSentAt: null,
        updatedAt: new Date("2026-08-10T12:00:00Z"),
      },
    ];
  }

  it("two workers send a due reminder exactly once", async () => {
    proStoreWithDueReminder("req_1");

    const [a, b] = await Promise.all([runDueReminderSweep(NOW), runDueReminderSweep(NOW)]);

    expect(reminderDispatches).toEqual([{ id: "req_1", type: "reminder_1" }]);
    expect(a.dispatched + b.dispatched).toBe(1);
  });

  it("claims the reminder field BEFORE sending, not after", async () => {
    proStoreWithDueReminder("req_1");
    await runDueReminderSweep(NOW);

    const prisma = (await import("../db.server")).default as unknown as {
      reviewRequest: { updateMany: { mock: { calls: Array<[{ where: Record<string, unknown> }]> } } };
    };
    const claim = prisma.reviewRequest.updateMany.mock.calls.find(
      (c) => "reminder1SentAt" in (c[0].where as Record<string, unknown>),
    );
    expect(claim).toBeDefined();
    expect(claim![0].where).toMatchObject({ id: "req_1", reminder1SentAt: null });
  });

  it("a claimed reminder is not re-sent by a later sweep", async () => {
    proStoreWithDueReminder("req_1");

    await runDueReminderSweep(NOW);
    await runDueReminderSweep(NOW);

    // reminder_1 exactly once — that is the duplicate-send guarantee.
    expect(reminderDispatches.filter((d) => d.type === "reminder_1")).toHaveLength(1);

    // The second sweep legitimately sends reminder_final: this row was sent 10 days before NOW
    // and the store's reminderFinalDelayDays is 7, so once reminder_1 is claimed the final
    // reminder is genuinely due. Each reminder is claimed on its own field, so they never
    // contend with each other — asserted explicitly so this is never mistaken for a duplicate.
    expect(reminderDispatches.filter((d) => d.type === "reminder_final")).toHaveLength(1);
    expect(reminderDispatches.map((d) => d.id)).toEqual(["req_1", "req_1"]);
  });

  it("eight workers over four due reminders send four emails total", async () => {
    proStoreWithDueReminder("req_0");
    for (let i = 1; i < 4; i++) {
      fakeRequests.push({ ...fakeRequests[0], id: `req_${i}` });
    }

    await Promise.all(Array.from({ length: 8 }, () => runDueReminderSweep(NOW)));

    expect(reminderDispatches).toHaveLength(4);
    expect(new Set(reminderDispatches.map((d) => d.id)).size).toBe(4);
  });
});

describe("claim rollback — retries and failure recovery", () => {
  beforeEach(() => {
    fakeRequests = [];
    fakeStores = {};
    dispatchedIds = [];
    failingIds = new Set();
    reminderDispatches = [];
    failingReminderIds = new Set();
    notSendingReminderIds = new Set();
    suppressedPairs = new Set();
  });

  const NOW = new Date("2026-08-20T12:00:00Z");

  function dueReminder(id: string) {
    fakeStores = {
      store_1: {
        reminderEmailsEnabled: true,
        remindersEnabledAt: new Date("2026-01-01T00:00:00Z"),
        reminder1DelayDays: 3,
        reminderFinalDelayDays: 7,
      },
    };
    fakeRequests = [
      {
        id,
        status: "sent",
        scheduledFor: null,
        storeId: "store_1",
        email: "customer@example.com",
        sentAt: new Date("2026-08-10T12:00:00Z"),
        reviewedAt: null,
        reminder1SentAt: null,
        reminderFinalSentAt: null,
        updatedAt: new Date("2026-08-10T12:00:00Z"),
      },
    ];
  }

  // The behaviour the pre-send claim could easily have destroyed: a reminder whose send fails
  // must stay eligible, exactly as it did when the field was written only after a success.
  it("a reminder whose dispatch sends nothing has its claim rolled back", async () => {
    dueReminder("req_1");
    notSendingReminderIds = new Set(["req_1"]);

    const result = await runDueReminderSweep(NOW);

    expect(result.dispatched).toBe(0);
    expect(fakeRequests[0].reminder1SentAt).toBeNull();
  });

  it("a reminder whose dispatch THROWS also has its claim rolled back", async () => {
    dueReminder("req_1");
    failingReminderIds = new Set(["req_1"]);

    const result = await runDueReminderSweep(NOW);

    expect(result.dispatched).toBe(0);
    expect(fakeRequests[0].reminder1SentAt).toBeNull();
  });

  it("a rolled-back reminder is retried on the next tick and then succeeds", async () => {
    dueReminder("req_1");
    notSendingReminderIds = new Set(["req_1"]);

    await runDueReminderSweep(NOW);
    expect(reminderDispatches).toHaveLength(0);
    expect(fakeRequests[0].reminder1SentAt).toBeNull();

    // Provider recovers.
    notSendingReminderIds = new Set();
    const second = await runDueReminderSweep(NOW);

    expect(second.dispatched).toBe(1);
    expect(reminderDispatches).toEqual([{ id: "req_1", type: "reminder_1" }]);
  });

  it("one failing reminder never blocks another store's reminder in the same batch", async () => {
    dueReminder("req_bad");
    fakeRequests.push({ ...fakeRequests[0], id: "req_good" });
    failingReminderIds = new Set(["req_bad"]);

    const result = await runDueReminderSweep(NOW);

    expect(result.dispatched).toBe(1);
    expect(reminderDispatches).toEqual([{ id: "req_good", type: "reminder_1" }]);
    expect(fakeRequests.find((r) => r.id === "req_bad")!.reminder1SentAt).toBeNull();
  });
});

describe("recoverStaleClaims — crash between claim and send", () => {
  beforeEach(() => {
    fakeRequests = [];
    fakeStores = {};
    dispatchedIds = [];
    failingIds = new Set();
    reminderDispatches = [];
    failingReminderIds = new Set();
    notSendingReminderIds = new Set();
    suppressedPairs = new Set();
  });

  const NOW = new Date("2026-08-20T12:00:00Z");
  const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60 * 1000);

  it("returns a long-stranded 'sending' row to 'scheduled'", async () => {
    // 20 minutes > STALE_CLAIM_MS (3 x 5min). Models a worker killed mid-send.
    fakeRequests = [{ id: "req_1", status: "sending", scheduledFor: minutesAgo(60), updatedAt: minutesAgo(20) }];

    const result = await recoverStaleClaims(NOW);

    expect(result.recovered).toBe(1);
    expect(fakeRequests[0].status).toBe("scheduled");
  });

  it("leaves a freshly claimed row alone — an in-flight send is not stolen", async () => {
    fakeRequests = [{ id: "req_1", status: "sending", scheduledFor: minutesAgo(60), updatedAt: minutesAgo(1) }];

    const result = await recoverStaleClaims(NOW);

    expect(result.recovered).toBe(0);
    expect(fakeRequests[0].status).toBe("sending");
  });

  it("does not touch a row still inside the lease window (14 min < 15 min)", async () => {
    fakeRequests = [{ id: "req_1", status: "sending", scheduledFor: minutesAgo(60), updatedAt: minutesAgo(14) }];

    expect((await recoverStaleClaims(NOW)).recovered).toBe(0);
    expect(fakeRequests[0].status).toBe("sending");
  });

  it("never touches terminal or pre-claim rows", async () => {
    fakeRequests = [
      { id: "sent", status: "sent", scheduledFor: null, updatedAt: minutesAgo(600) },
      { id: "failed", status: "failed", scheduledFor: null, updatedAt: minutesAgo(600) },
      { id: "cancelled", status: "cancelled", scheduledFor: null, updatedAt: minutesAgo(600) },
      { id: "completed", status: "completed", scheduledFor: null, updatedAt: minutesAgo(600) },
      { id: "scheduled", status: "scheduled", scheduledFor: minutesAgo(10), updatedAt: minutesAgo(600) },
    ];

    expect((await recoverStaleClaims(NOW)).recovered).toBe(0);
    expect(fakeRequests.map((r) => r.status)).toEqual(["sent", "failed", "cancelled", "completed", "scheduled"]);
  });

  it("a recovered row is picked up and sent by the following sweep", async () => {
    fakeRequests = [{ id: "req_1", status: "sending", scheduledFor: minutesAgo(60), updatedAt: minutesAgo(20) }];

    await recoverStaleClaims(NOW);
    const sweep = await runDueReviewRequestSweep(NOW);

    expect(sweep.dispatched).toBe(1);
    expect(dispatchedIds).toEqual(["req_1"]);
  });

  it("recovery is idempotent — a second pass finds nothing left to do", async () => {
    fakeRequests = [{ id: "req_1", status: "sending", scheduledFor: minutesAgo(60), updatedAt: minutesAgo(20) }];

    expect((await recoverStaleClaims(NOW)).recovered).toBe(1);
    expect((await recoverStaleClaims(NOW)).recovered).toBe(0);
  });

  it("recovery plus two concurrent workers still yields exactly one send", async () => {
    // The full crash-recovery path under contention: the end-to-end guarantee, not just a claim.
    fakeRequests = [{ id: "req_1", status: "sending", scheduledFor: minutesAgo(60), updatedAt: minutesAgo(20) }];

    await recoverStaleClaims(NOW);
    await Promise.all([runDueReviewRequestSweep(NOW), runDueReviewRequestSweep(NOW)]);

    expect(dispatchedIds).toEqual(["req_1"]);
  });
});

// A claim that is taken but neither sent nor released is the one path in the whole sweep that
// can lose a reminder. It must never be silent — releaseReminderClaim swallows the error so one
// bad row can't abort the batch, so the count is what makes it visible.
describe("leaked reminder claims are counted, not silently swallowed", () => {
  beforeEach(() => {
    fakeRequests = [];
    fakeStores = {};
    dispatchedIds = [];
    failingIds = new Set();
    reminderDispatches = [];
    failingReminderIds = new Set();
    notSendingReminderIds = new Set();
    suppressedPairs = new Set();
  });

  const NOW = new Date("2026-08-20T12:00:00Z");

  function dueReminder(id: string) {
    fakeStores = {
      store_1: {
        reminderEmailsEnabled: true,
        remindersEnabledAt: new Date("2026-01-01T00:00:00Z"),
        reminder1DelayDays: 3,
        reminderFinalDelayDays: 7,
      },
    };
    fakeRequests = [
      {
        id,
        status: "sent",
        scheduledFor: null,
        storeId: "store_1",
        email: "customer@example.com",
        sentAt: new Date("2026-08-10T12:00:00Z"),
        reviewedAt: null,
        reminder1SentAt: null,
        reminderFinalSentAt: null,
        updatedAt: new Date("2026-08-10T12:00:00Z"),
      },
    ];
  }

  type UpdateManyFn = (args: unknown) => Promise<{ count: number }>;
  type UpdateManyMock = {
    getMockImplementation: () => UpdateManyFn | undefined;
    mockImplementation: (f: UpdateManyFn) => void;
  };

  // Captured once, before any test swaps it out — mockReset() would discard the fake table's
  // real behaviour for every later test in this block, which is exactly the bug the first
  // version of this helper had.
  let originalUpdateMany: UpdateManyFn;

  async function updateManyMock(): Promise<UpdateManyMock> {
    const prisma = (await import("../db.server")).default as unknown as {
      reviewRequest: { updateMany: UpdateManyMock };
    };
    return prisma.reviewRequest.updateMany;
  }

  /** Lets the claim succeed, then makes only the rollback write fail. Returns a restore fn. */
  async function failOnlyTheRollback(): Promise<() => void> {
    const mock = await updateManyMock();
    if (!originalUpdateMany) {
      const captured = mock.getMockImplementation();
      if (!captured) throw new Error("fake updateMany implementation missing");
      originalUpdateMany = captured;
    }

    mock.mockImplementation(async (args: unknown) => {
      const a = args as { data: Record<string, unknown> };
      // A release sets the field back to null; a claim sets it to a Date.
      const isRelease = Object.values(a.data).some((v) => v === null);
      if (isRelease) throw new Error("simulated DB failure during rollback");
      return originalUpdateMany(args);
    });

    return () => mock.mockImplementation(originalUpdateMany);
  }

  it("reports claimLeaks when the rollback write fails", async () => {
    dueReminder("req_1");
    notSendingReminderIds = new Set(["req_1"]);
    const restore = await failOnlyTheRollback();

    const result = await runDueReminderSweep(NOW);

    expect(result.dispatched).toBe(0);
    expect(result.claimLeaks).toBe(1);
    // The claim is still stamped — that IS the loss being reported.
    expect(fakeRequests[0].reminder1SentAt).not.toBeNull();

    restore();
  });

  it("reports zero leaks on a clean rollback", async () => {
    dueReminder("req_1");
    notSendingReminderIds = new Set(["req_1"]);

    const result = await runDueReminderSweep(NOW);

    expect(result.claimLeaks).toBe(0);
    expect(fakeRequests[0].reminder1SentAt).toBeNull();
  });

  it("a rollback failure never aborts the rest of the batch", async () => {
    dueReminder("req_leak");
    fakeRequests.push({ ...fakeRequests[0], id: "req_ok" });
    notSendingReminderIds = new Set(["req_leak"]);
    const restore = await failOnlyTheRollback();

    const result = await runDueReminderSweep(NOW);

    // req_ok still got its email even though req_leak's rollback blew up.
    expect(reminderDispatches.map((d) => d.id)).toContain("req_ok");
    expect(result.claimLeaks).toBe(1);

    restore();
  });
});
