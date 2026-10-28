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
  /** Basis of the Day-0 idempotency key (`review-request/<token>`), stable across recovery. */
  requestToken?: string;
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
/** Every idempotency key handed to the provider, including deduplicated repeats. */
let providerAttempts: string[];
/** Keys that resulted in a REAL email. A duplicate customer email = two entries for one key. */
let providerDeliveries: string[];
/** key -> logical time it was stored, modelling Resend's 24h key retention. */
let providerRetention: Map<string, number>;
/** Logical clock; retention entries older than providerRetentionFloor have expired. */
let providerClock: number;
let providerRetentionFloor: number;
/** Ids whose dispatch sends successfully and THEN throws, as a crash would. */
let crashAfterSendIds: Set<string>;
/** Reminder ids whose dispatch returns false (no email sent) instead of throwing. */
let notSendingReminderIds: Set<string>;
let suppressedPairs: Set<string>;

/**
 * A fixture that omits `email` means "an ordinary recipient with a working address" — most
 * reminder fixtures predate the sweep caring about the column. An explicit `email: null` models
 * a row whose address the 90-day retention purge has redacted, which can never be emailed.
 */
const rowEmail = (row: FakeRequestRow): string | null =>
  row.email === undefined ? `${row.id}@example.com` : row.email;

vi.mock("../db.server", () => ({
  default: {
    // Two callers, two shapes. runRetentionPurgeSweep asks for every store and passes no `where`;
    // runDueReminderSweep asks only for stores with reminders switched on AND an actual enablement
    // date, because it needs each store's remindersEnabledAt as a value for its candidate query.
    // The actual purge mechanics are reviewRequestService.purgeStaleContactInfo's job (mocked
    // separately below), already independently tested in review-request.server.test.ts.
    store: {
      findMany: vi.fn(
        async (args?: { where?: { reminderEmailsEnabled?: boolean; remindersEnabledAt?: { not: null } } }) => {
          const ids = Object.keys(fakeStores);

          if (!args?.where) {
            return ids.map((id) => ({ id }));
          }

          return ids
            .filter((id) => fakeStores[id].reminderEmailsEnabled === args.where!.reminderEmailsEnabled)
            .filter((id) => fakeStores[id].remindersEnabledAt != null)
            .map((id) => ({
              id,
              remindersEnabledAt: fakeStores[id].remindersEnabledAt,
              reminder1DelayDays: fakeStores[id].reminder1DelayDays,
              reminderFinalDelayDays: fakeStores[id].reminderFinalDelayDays,
            }));
        },
      ),
    },
    reviewRequest: {
      // Routes on whether the query is scoped to one store (only runDueReminderSweep's is) — the
      // two sweeps have genuinely different shapes, not worth two mock files.
      findMany: vi.fn(async (args: { where: Record<string, unknown>; take: number }) => {
        if (args.where.storeId !== undefined) {
          const storeId = args.where.storeId as string;
          const sentAtFilter = args.where.sentAt as { not: null; gte: Date };
          const emailFilter = args.where.email as { not: null; notIn?: string[] };
          const or = args.where.OR as Array<{
            reminder1SentAt?: null;
            reminderFinalSentAt?: null;
            sentAt?: { lte: Date };
          }>;

          return fakeRequests
            .filter((row) => row.storeId === storeId)
            .filter((row) => row.reviewedAt == null)
            .filter((row) => !["completed", "cancelled", "failed"].includes(row.status))
            .filter((row) => row.sentAt != null)
            // THE FIXES UNDER TEST, all three modelled faithfully and deliberately: if any of
            // these is wrong or missing, the PROOF/regression tests below prove nothing.
            // (1) rows sent before this store's remindersEnabledAt never reach the batch.
            .filter((row) => row.sentAt!.getTime() >= sentAtFilter.gte.getTime())
            // (2) a reminder needs an address, and this store's suppressed addresses are excluded
            //     in SQL. Matches on the stored value exactly as Postgres would — deliberately
            //     NOT normalising, so the casing gap the JS backstop covers stays visible here.
            //     A fixture that omits `email` means "an ordinary recipient"; only an explicit
            //     `email: null` models a row whose address retention has redacted.
            //     Both predicates are READ FROM THE QUERY, never assumed — a mock that drops
            //     null emails unconditionally would make the redacted-row test pass even with
            //     the production filter removed, which is precisely what it must not do.
            .filter((row) => (emailFilter?.not === null ? rowEmail(row) != null : true))
            .filter((row) => !(emailFilter?.notIn ?? []).includes(rowEmail(row)!))
            // (3) each OR branch now carries this store's own delay cutoff, so a row not yet due
            //     for either reminder never reaches the batch.
            .filter((row) =>
              or.some((clause) => {
                if ("reminder1SentAt" in clause && row.reminder1SentAt != null) return false;
                if ("reminderFinalSentAt" in clause && row.reminderFinalSentAt != null) return false;
                if (clause.sentAt && row.sentAt!.getTime() > clause.sentAt.lte.getTime()) return false;
                return true;
              }),
            )
            .sort((a, b) => a.sentAt!.getTime() - b.sentAt!.getTime())
            .slice(0, args.take)
            .map((row) => ({
              id: row.id,
              email: rowEmail(row),
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

    // --- provider model -------------------------------------------------------------------
    // Mirrors Resend: the key is derived from requestToken exactly as review-request.server.ts
    // builds it, and a repeat within the retention window returns the original response WITHOUT
    // sending again. Only `providerDeliveries` counts real emails leaving the building.
    const row = fakeRequests.find((r) => r.id === id);
    if (row?.requestToken) {
      const key = `review-request/${row.requestToken}`;
      providerAttempts.push(key);
      const seen = providerRetention.get(key);
      if (seen !== undefined && seen >= providerRetentionFloor) {
        // Deduplicated at the provider — no second email.
        dispatchedIds.push(id);
        return;
      }
      providerRetention.set(key, providerClock);
      providerDeliveries.push(key);
    }

    // Models the process dying after the provider accepted the email but before the terminal
    // "sent" write lands: the email is out, the row is left on "sending".
    if (crashAfterSendIds.has(id)) {
      crashAfterSendIds.delete(id);
      throw new Error(`Simulated crash after provider accepted, before status write (${id})`);
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
    // Backs the reminder sweep's per-store SQL exclusion. Derived from the same `suppressedPairs`
    // the per-row check uses, so a test cannot accidentally make the two disagree.
    listSuppressedEmails: vi.fn(async (storeId: string) =>
      [...suppressedPairs]
        .filter((pair) => pair.startsWith(`${storeId}:`))
        .map((pair) => pair.slice(storeId.length + 1)),
    ),
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
    providerAttempts = [];
    providerDeliveries = [];
    providerRetention = new Map();
    providerClock = 0;
    providerRetentionFloor = 0;
    crashAfterSendIds = new Set();
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
    providerAttempts = [];
    providerDeliveries = [];
    providerRetention = new Map();
    providerClock = 0;
    providerRetentionFloor = 0;
    crashAfterSendIds = new Set();
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

    // REVISED SEMANTICS. This used to assert `due: 1` — the row matched the DB query and was
    // rejected afterward in JS, so it counted as "due but not sent". The candidate query now
    // excludes it per store, so it is never a candidate and never due. "dispatched: 0" still
    // proves the historical-safety rule holds; "due: 0" additionally proves the row no longer
    // occupies a slot in the batch, which is what the reachability tests below depend on.
    expect(result).toEqual({ due: 0, dispatched: 0, claimLeaks: 0 });
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

    // REVISED SEMANTICS. This used to assert `due: 1` — the row was fetched, then rejected in JS.
    // The store's suppressed addresses are now excluded by the candidate query, so the row is
    // never a candidate. "dispatched: 0" still proves no suppressed recipient is emailed; "due: 0"
    // additionally proves the row no longer holds a slot, which is what stopped newer deliverable
    // reminders being starved behind an unsubscribe list that only ever grows.
    expect(result).toEqual({ due: 0, dispatched: 0, claimLeaks: 0 });
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

      // REVISED SEMANTICS. This used to assert `due: 1` — the row was fetched, then rejected in
      // JS. Plan entitlement is now resolved before the store is queried at all, so the row is
      // never a candidate. `due` means actionable reminders, and a Free store has none.
      expect(result).toEqual({ due: 0, dispatched: 0, claimLeaks: 0 });
      expect(reminderDispatches).toEqual([]);
    });

    it("does not dispatch the final reminder for a Free store either", async () => {
      fakeStores.store_1.canUseEmailReminders = false;
      fakeRequests = [
        { id: "req_1", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(7), reminder1SentAt: day(4) },
      ];

      const result = await runDueReminderSweep(now);

      expect(result).toEqual({ due: 0, dispatched: 0, claimLeaks: 0 });
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

      // due: 1, not 2 — the Free store's row is never fetched, so it is not actionable work.
      // Nothing about the Pro store's outcome changes.
      expect(result).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
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
    providerAttempts = [];
    providerDeliveries = [];
    providerRetention = new Map();
    providerClock = 0;
    providerRetentionFloor = 0;
    crashAfterSendIds = new Set();
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
    providerAttempts = [];
    providerDeliveries = [];
    providerRetention = new Map();
    providerClock = 0;
    providerRetentionFloor = 0;
    crashAfterSendIds = new Set();
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
    providerAttempts = [];
    providerDeliveries = [];
    providerRetention = new Map();
    providerClock = 0;
    providerRetentionFloor = 0;
    crashAfterSendIds = new Set();
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
    providerAttempts = [];
    providerDeliveries = [];
    providerRetention = new Map();
    providerClock = 0;
    providerRetentionFloor = 0;
    crashAfterSendIds = new Set();
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
    providerAttempts = [];
    providerDeliveries = [];
    providerRetention = new Map();
    providerClock = 0;
    providerRetentionFloor = 0;
    crashAfterSendIds = new Set();
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// END-TO-END: provider accepted the email, the app died before recording success.
//
// This is the one window no database claim can close, and it was previously covered only as two
// disconnected halves — the stale-claim recovery here, the idempotency key over in
// review-request.server.test.ts. The seam between them was untested. These tests close it.
//
// Sequence modelled, in order:
//   1. the sweep claims the row (scheduled -> sending)
//   2. the provider ACCEPTS the email — a real send; the customer has it
//   3. the process dies before the terminal "sent" write, leaving the row on "sending"
//   4. no delivery webhook arrives (the crashed process's endpoint was down too)
//   5. the lease expires and recoverStaleClaims returns the row to "scheduled"
//   6. a later sweep re-dispatches it
//
// The provider model mirrors Resend's documented contract: the key is `review-request/<token>`,
// a repeat within the retention window returns the original response WITHOUT sending again, and
// keys are retained 24 hours. `providerDeliveries` counts only real emails, so a duplicate
// customer email shows up as the same key appearing twice.
//
// NOTE ON COMPOSITION: the claim and recovery here are the REAL scheduler functions. The key's
// derivation from requestToken is pinned separately by review-request.server.test.ts's
// "the Day-0 request send is keyed on its request token", which asserts the production code
// emits exactly this string. Together those cover the chain end to end.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("crash after provider acceptance — recovery must not duplicate the email", () => {
  beforeEach(() => {
    fakeRequests = [];
    fakeStores = {};
    dispatchedIds = [];
    failingIds = new Set();
    reminderDispatches = [];
    failingReminderIds = new Set();
    notSendingReminderIds = new Set();
    providerAttempts = [];
    providerDeliveries = [];
    providerRetention = new Map();
    providerClock = 0;
    providerRetentionFloor = 0;
    crashAfterSendIds = new Set();
    suppressedPairs = new Set();
  });

  const NOW = new Date("2026-08-20T12:00:00Z");
  const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60 * 1000);

  function dueRow(id: string, token: string): FakeRequestRow {
    return {
      id,
      status: "scheduled",
      scheduledFor: minutesAgo(60),
      updatedAt: minutesAgo(60),
      requestToken: token,
    };
  }

  /** Steps 1-3: claim, provider accepts, process dies before the status write. */
  async function sendThenCrash(id: string) {
    crashAfterSendIds.add(id);
    await runDueReviewRequestSweep(NOW);
  }

  it("the crash leaves the row on 'sending' with the email already delivered", async () => {
    fakeRequests = [dueRow("req_1", "tok_abc")];

    await sendThenCrash("req_1");

    expect(providerDeliveries).toEqual(["review-request/tok_abc"]);
    // Claimed, never completed — exactly the state recovery exists to repair.
    expect(fakeRequests[0].status).toBe("sending");
  });

  it("recovery retries with the IDENTICAL key and the provider sends nothing further", async () => {
    fakeRequests = [dueRow("req_1", "tok_abc")];
    await sendThenCrash("req_1");

    // Step 5: lease expires (STALE_CLAIM_MS = 15 min).
    fakeRequests[0].updatedAt = minutesAgo(20);
    expect((await recoverStaleClaims(NOW)).recovered).toBe(1);

    // Step 6: re-dispatch.
    await runDueReviewRequestSweep(NOW);

    // The provider was asked twice...
    expect(providerAttempts).toEqual(["review-request/tok_abc", "review-request/tok_abc"]);
    // ...but only ONE email ever left. This is the whole point.
    expect(providerDeliveries).toEqual(["review-request/tok_abc"]);
  });

  it("the retry key is byte-identical — recovery never rotates requestToken", async () => {
    fakeRequests = [dueRow("req_1", "tok_abc")];
    await sendThenCrash("req_1");

    const tokenAfterCrash = fakeRequests[0].requestToken;
    fakeRequests[0].updatedAt = minutesAgo(20);
    await recoverStaleClaims(NOW);

    // A rotated token would mint a NEW key and defeat provider dedup entirely.
    expect(fakeRequests[0].requestToken).toBe(tokenAfterCrash);
    expect(new Set(providerAttempts).size).toBe(1);
  });

  it("concurrent workers racing the recovered row still produce exactly one email", async () => {
    fakeRequests = [dueRow("req_1", "tok_abc")];
    await sendThenCrash("req_1");
    fakeRequests[0].updatedAt = minutesAgo(20);
    await recoverStaleClaims(NOW);

    await Promise.all([runDueReviewRequestSweep(NOW), runDueReviewRequestSweep(NOW)]);

    // The claim stops the second worker before it ever reaches the provider.
    expect(providerAttempts).toHaveLength(2); // original + one retry
    expect(providerDeliveries).toEqual(["review-request/tok_abc"]);
  });

  it("several crashed rows each recover to exactly one email apiece", async () => {
    fakeRequests = [dueRow("a", "tok_a"), dueRow("b", "tok_b"), dueRow("c", "tok_c")];
    crashAfterSendIds = new Set(["a", "b", "c"]);

    await runDueReviewRequestSweep(NOW);
    for (const r of fakeRequests) r.updatedAt = minutesAgo(20);
    await recoverStaleClaims(NOW);
    await Promise.all([runDueReviewRequestSweep(NOW), runDueReviewRequestSweep(NOW)]);

    expect(providerDeliveries.sort()).toEqual([
      "review-request/tok_a",
      "review-request/tok_b",
      "review-request/tok_c",
    ]);
  });

  // ── The residual risk, pinned as a KNOWN behaviour rather than left implicit ────────────────
  it("RESIDUAL RISK: past the retention window the same key DOES send a second email", async () => {
    fakeRequests = [dueRow("req_1", "tok_abc")];
    await sendThenCrash("req_1");
    expect(providerDeliveries).toHaveLength(1);

    // More than 24h pass: Resend has forgotten the key, so it can no longer deduplicate.
    providerClock = 1;
    providerRetentionFloor = 1;

    fakeRequests[0].updatedAt = minutesAgo(20);
    await recoverStaleClaims(NOW);
    await runDueReviewRequestSweep(NOW);

    // Two real emails for one request. This is the documented residual risk and CANNOT be
    // eliminated by the idempotency key alone — past retention the provider has no memory, and
    // the app has no independent way to establish whether delivery occurred. It requires a
    // delivery signal (the Resend webhook, which normally moves the row off "sending" within
    // seconds) or a stored provider message id to resolve.
    expect(providerDeliveries).toEqual(["review-request/tok_abc", "review-request/tok_abc"]);
  });

  it("a delivery webhook makes the residual risk unreachable — the row leaves 'sending'", async () => {
    fakeRequests = [dueRow("req_1", "tok_abc")];
    await sendThenCrash("req_1");

    // webhooks.resend.tsx -> applyForwardOnlyStatus promotes sending(1) -> delivered(3).
    fakeRequests[0].status = "delivered";
    fakeRequests[0].updatedAt = minutesAgo(20);

    // Even with the retention window fully expired, recovery cannot see a delivered row.
    providerClock = 1;
    providerRetentionFloor = 1;

    expect((await recoverStaleClaims(NOW)).recovered).toBe(0);
    await runDueReviewRequestSweep(NOW);
    expect(providerDeliveries).toEqual(["review-request/tok_abc"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// REACHABILITY. Found in production: a sweep heartbeat read `reminders due=25 sent=0` with
// SWEEP_BATCH_SIZE = 25, i.e. the batch was exactly full and nothing came out of it. The cause
// was not the gate itself — requests sent before their store switched reminders on are correctly
// and permanently ineligible — but WHERE the gate ran. It ran in JS, after the fetch, and it
// `continue`s before the claim, so those rows were never stamped and stayed candidates forever.
// Ordered oldest-first under `take: SWEEP_BATCH_SIZE`, a backlog bigger than the batch filled
// every slot permanently, and a newer genuinely-eligible request could never be reached.
//
// The real backlog was 182 rows against a cap of 25. These tests use 30-vs-25 for speed; the
// property under test is only "backlog > batch size", not the specific number.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("reminder reachability — a historical backlog must never starve a newer request", () => {
  const now = new Date("2026-08-10T12:00:00Z");
  const day = (offset: number) => new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);

  beforeEach(() => {
    fakeRequests = [];
    fakeStores = {};
    dispatchedIds = [];
    failingIds = new Set();
    reminderDispatches = [];
    failingReminderIds = new Set();
    notSendingReminderIds = new Set();
    providerAttempts = [];
    providerDeliveries = [];
    providerRetention = new Map();
    providerClock = 0;
    providerRetentionFloor = 0;
    crashAfterSendIds = new Set();
    suppressedPairs = new Set();
  });

  /** `count` rows all sent well before the store turned reminders on — permanently ineligible. */
  function historicalBacklog(storeId: string, count: number): FakeRequestRow[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `${storeId}_historical_${i}`,
      storeId,
      status: "sent",
      scheduledFor: null,
      // day(100) .. day(71): all older than the day(30) enablement below, and all older than any
      // eligible row, so under oldest-first ordering they sort ahead of everything that matters.
      sentAt: day(100 - i),
    }));
  }

  it("THE REGRESSION: a newer eligible request is dispatched despite a backlog larger than the batch", async () => {
    fakeStores = {
      store_1: { reminderEmailsEnabled: true, remindersEnabledAt: day(30), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    fakeRequests = [
      ...historicalBacklog("store_1", 30),
      { id: "req_eligible", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(5) },
    ];

    const result = await runDueReminderSweep(now);

    // Before the fix: the 30 historical rows filled all 25 slots, req_eligible was never fetched,
    // and this read { due: 25, dispatched: 0 }.
    expect(result).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([{ id: "req_eligible", type: "reminder_1" }]);
  });

  it("the historical rows are not merely deprioritised — they never enter the batch at all", async () => {
    fakeStores = {
      store_1: { reminderEmailsEnabled: true, remindersEnabledAt: day(30), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    fakeRequests = historicalBacklog("store_1", 30);

    const result = await runDueReminderSweep(now);

    // due: 0, not "due: 25, dispatched: 0". A row that cannot ever be sent is not pending work,
    // and counting it as due is what made the production heartbeat read full-but-idle.
    expect(result).toEqual({ due: 0, dispatched: 0, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([]);
  });

  it("stays fixed on the next tick — the backlog cannot silently re-fill the batch", async () => {
    fakeStores = {
      store_1: { reminderEmailsEnabled: true, remindersEnabledAt: day(30), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    fakeRequests = [
      ...historicalBacklog("store_1", 30),
      { id: "req_a", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(5) },
      { id: "req_b", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(4) },
    ];

    const first = await runDueReminderSweep(now);
    const second = await runDueReminderSweep(now);

    expect(first).toEqual({ due: 2, dispatched: 2, claimLeaks: 0 });
    // Both are claimed now, so the second tick has nothing left — and still no historical row.
    expect(second).toEqual({ due: 0, dispatched: 0, claimLeaks: 0 });
    expect(reminderDispatches.map((d) => d.id).sort()).toEqual(["req_a", "req_b"]);
  });

  it("each store's own enablement date is applied to its own rows (different dates, one sweep)", async () => {
    fakeStores = {
      // Enabled recently: its day(20) row predates enablement and must stay out.
      store_early: { reminderEmailsEnabled: true, remindersEnabledAt: day(10), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
      // Enabled long ago: its day(20) row postdates enablement and must go out.
      store_late: { reminderEmailsEnabled: true, remindersEnabledAt: day(60), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    fakeRequests = [
      { id: "req_early_blocked", storeId: "store_early", status: "sent", scheduledFor: null, sentAt: day(20) },
      { id: "req_late_eligible", storeId: "store_late", status: "sent", scheduledFor: null, sentAt: day(20) },
    ];

    const result = await runDueReminderSweep(now);

    // Identical sentAt, opposite outcomes — proving the cutoff is per store, not global.
    expect(result).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([{ id: "req_late_eligible", type: "reminder_1" }]);
  });

  it("one store's historical backlog never starves a DIFFERENT store's eligible request", async () => {
    fakeStores = {
      store_blocked: { reminderEmailsEnabled: true, remindersEnabledAt: day(30), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
      store_ok: { reminderEmailsEnabled: true, remindersEnabledAt: day(30), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    fakeRequests = [
      ...historicalBacklog("store_blocked", 30),
      { id: "req_other_store", storeId: "store_ok", status: "sent", scheduledFor: null, sentAt: day(5) },
    ];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([{ id: "req_other_store", type: "reminder_1" }]);
  });

  it("a store with a null remindersEnabledAt is skipped entirely, and never consumes the batch", async () => {
    fakeStores = {
      store_never_enabled: { reminderEmailsEnabled: true, remindersEnabledAt: null, reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
      store_ok: { reminderEmailsEnabled: true, remindersEnabledAt: day(30), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    fakeRequests = [
      // reminderEmailsEnabled true but no enablement date — the preference was never actually
      // switched on, so these are ineligible and must not occupy slots either.
      ...historicalBacklog("store_never_enabled", 30).map((row) => ({ ...row, sentAt: day(5) })),
      { id: "req_ok", storeId: "store_ok", status: "sent", scheduledFor: null, sentAt: day(5) },
    ];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([{ id: "req_ok", type: "reminder_1" }]);
  });

  it("already-sent reminders leave the batch, so they cannot starve it either", async () => {
    fakeStores = {
      store_1: { reminderEmailsEnabled: true, remindersEnabledAt: day(30), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    fakeRequests = [
      // 26 rows (> batch) that are eligible by date but have BOTH reminders already sent, so the
      // OR clause drops them in SQL — the pre-existing idempotency path, re-checked here because
      // it is the other way a batch could fill with rows that can never produce an email.
      ...Array.from({ length: 26 }, (_, i) => ({
        id: `req_done_${i}`,
        storeId: "store_1",
        status: "sent",
        scheduledFor: null,
        sentAt: day(20 - (i % 10)),
        reminder1SentAt: day(15),
        reminderFinalSentAt: day(12),
      })),
      { id: "req_fresh", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(5) },
    ];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([{ id: "req_fresh", type: "reminder_1" }]);
  });

  it("the shared batch budget still caps dispatches per sweep across all stores", async () => {
    // reminderFinalDelayDays is pushed far out so that only reminder_1 is ever in play here.
    // Otherwise the 25 rows reminded on the first tick become due for reminder_final on the
    // second, and the "remainder" assertion below would be measuring both types at once.
    fakeStores = {
      store_a: { reminderEmailsEnabled: true, remindersEnabledAt: day(60), reminder1DelayDays: 3, reminderFinalDelayDays: 365 },
      store_b: { reminderEmailsEnabled: true, remindersEnabledAt: day(60), reminder1DelayDays: 3, reminderFinalDelayDays: 365 },
    };
    // 20 eligible rows in each of two stores = 40 eligible, against a batch size of 25.
    fakeRequests = ["store_a", "store_b"].flatMap((storeId) =>
      Array.from({ length: 20 }, (_, i) => ({
        id: `${storeId}_req_${i}`,
        storeId,
        status: "sent",
        scheduledFor: null,
        sentAt: day(30 - i),
      })),
    );

    const result = await runDueReminderSweep(now);

    // Per-sweep cost is unchanged by the per-store fan-out: still one shared 25-row budget.
    expect(result.dispatched).toBe(25);
    expect(result.due).toBe(25);
    expect(result.claimLeaks).toBe(0);
    expect(reminderDispatches).toHaveLength(25);
  });

  // This test previously pinned the awaiting-final case as an accepted residual risk. It is no
  // longer residual: the candidate query carries each store's delay cutoffs, so a row that is not
  // yet due for either reminder is not a candidate. Kept, inverted, as the regression test.
  it("a full batch of rows awaiting their final reminder no longer blocks a newer one", async () => {
    fakeStores = {
      // A long final delay holds the reminded rows in the "not yet due" state for the whole window.
      store_1: { reminderEmailsEnabled: true, remindersEnabledAt: day(90), reminder1DelayDays: 3, reminderFinalDelayDays: 365 },
    };
    fakeRequests = [
      // 25 rows (a full batch) already given reminder_1, not yet due for reminder_final.
      ...Array.from({ length: 25 }, (_, i) => ({
        id: `req_awaiting_final_${i}`,
        storeId: "store_1",
        status: "sent",
        scheduledFor: null,
        sentAt: day(60 - i),
        reminder1SentAt: day(50),
      })),
      // Genuinely due for reminder_1, and newer, so it sorts behind all 25.
      { id: "req_newer", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(5) },
    ];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([{ id: "req_newer", type: "reminder_1" }]);
  });

  it("a redacted (null email) request is not a candidate — it can never be emailed", async () => {
    fakeStores = {
      store_1: { reminderEmailsEnabled: true, remindersEnabledAt: day(90), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    fakeRequests = [
      // 26 rows whose address the 90-day retention purge has redacted. Timing-due, permanently
      // undeliverable, and previously claimed-then-rolled-back on every single tick.
      ...Array.from({ length: 26 }, (_, i) => ({
        id: `req_redacted_${i}`,
        storeId: "store_1",
        status: "sent",
        scheduledFor: null,
        email: null,
        sentAt: day(40 + i),
      })),
      { id: "req_has_email", storeId: "store_1", status: "sent", scheduledFor: null, email: "ok@example.com", sentAt: day(5) },
    ];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([{ id: "req_has_email", type: "reminder_1" }]);
  });

  it("suppressing one recipient never excludes another store's identical address", async () => {
    fakeStores = {
      store_a: { reminderEmailsEnabled: true, remindersEnabledAt: day(90), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
      store_b: { reminderEmailsEnabled: true, remindersEnabledAt: day(90), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    fakeRequests = [
      { id: "req_a", storeId: "store_a", status: "sent", scheduledFor: null, email: "same@example.com", sentAt: day(5) },
      { id: "req_b", storeId: "store_b", status: "sent", scheduledFor: null, email: "same@example.com", sentAt: day(5) },
    ];
    // Unsubscribed from store_a only. The per-store list must not leak across the fan-out.
    suppressedPairs.add("store_a:same@example.com");

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([{ id: "req_b", type: "reminder_1" }]);
  });

  it("a row still inside its reminder_1 delay is not a candidate, and its final reminder still lands later", async () => {
    fakeStores = {
      store_1: { reminderEmailsEnabled: true, remindersEnabledAt: day(90), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    fakeRequests = [{ id: "req_fresh", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(1) }];

    // Day 1: too new for either reminder.
    expect(await runDueReminderSweep(now)).toEqual({ due: 0, dispatched: 0, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([]);

    // Day 4 (3 days later): reminder_1 is due. Timing is unchanged by moving the test into SQL.
    const atDay4 = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    expect(await runDueReminderSweep(atDay4)).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });

    // Day 8: reminder_final is due, and is sent exactly once.
    const atDay8 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    expect(await runDueReminderSweep(atDay8)).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([
      { id: "req_fresh", type: "reminder_1" },
      { id: "req_fresh", type: "reminder_final" },
    ]);
  });

  it("oldest-first ordering is preserved across the per-store merge", async () => {
    fakeStores = {
      store_a: { reminderEmailsEnabled: true, remindersEnabledAt: day(60), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
      store_b: { reminderEmailsEnabled: true, remindersEnabledAt: day(60), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    // Interleaved by age across two stores; the merged batch must come out globally oldest-first,
    // exactly as the single-query version did.
    fakeRequests = [
      { id: "req_b_oldest", storeId: "store_b", status: "sent", scheduledFor: null, sentAt: day(40) },
      { id: "req_a_mid", storeId: "store_a", status: "sent", scheduledFor: null, sentAt: day(30) },
      { id: "req_b_newer", storeId: "store_b", status: "sent", scheduledFor: null, sentAt: day(20) },
      { id: "req_a_newest", storeId: "store_a", status: "sent", scheduledFor: null, sentAt: day(10) },
    ];

    await runDueReminderSweep(now);

    expect(reminderDispatches.map((d) => d.id)).toEqual([
      "req_b_oldest",
      "req_a_mid",
      "req_b_newer",
      "req_a_newest",
    ]);
  });

  it("a store with reminders switched off is still never queried, backlog or not", async () => {
    fakeStores = {
      store_off: { reminderEmailsEnabled: false, remindersEnabledAt: day(30), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    fakeRequests = [{ id: "req_off", storeId: "store_off", status: "sent", scheduledFor: null, sentAt: day(5) }];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 0, dispatched: 0, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([]);
  });

  // ── PROOF TESTS for the two residual risks, written before any fix. If either of these
  // ── passes against the current code, the risk is not real and must not be "fixed".
  it("PROOF risk 1: a full band of awaiting-final rows starves a newer reminder_1 (production 3/7 delays)", async () => {
    fakeStores = {
      store_1: { reminderEmailsEnabled: true, remindersEnabledAt: day(90), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);
    fakeRequests = [
      // 26 rows sent 5-6 days ago: reminder_1 already went out, reminder_final not due until
      // day 7, so each produces no dispatch — yet each still matches the OR and still sorts
      // ahead of anything newer. A store sending ~7 requests/day fills this band naturally.
      ...Array.from({ length: 26 }, (_, i) => ({
        id: `req_awaiting_${i}`,
        storeId: "store_1",
        status: "sent",
        scheduledFor: null,
        sentAt: hoursAgo(144 - i),
        reminder1SentAt: hoursAgo(72),
      })),
      // Genuinely due for reminder_1 (3.5 days old), and newer, so it sorts last.
      { id: "req_needs_r1", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: hoursAgo(84) },
    ];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([{ id: "req_needs_r1", type: "reminder_1" }]);
  });

  it("PROOF risk 2: a full batch of suppressed recipients starves a newer deliverable reminder", async () => {
    fakeStores = {
      store_1: { reminderEmailsEnabled: true, remindersEnabledAt: day(90), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    fakeRequests = [
      // 26 unsubscribed recipients, all timing-due, none ever dispatchable. Suppression skips
      // before the claim, so none is ever stamped and none ever leaves the candidate set.
      ...Array.from({ length: 26 }, (_, i) => ({
        id: `req_suppressed_${i}`,
        storeId: "store_1",
        status: "sent",
        scheduledFor: null,
        email: `blocked${i}@example.com`,
        sentAt: day(20 + i),
      })),
      { id: "req_deliverable", storeId: "store_1", status: "sent", scheduledFor: null, email: "ok@example.com", sentAt: day(5) },
    ];
    suppressedPairs = new Set(Array.from({ length: 26 }, (_, i) => `store_1:blocked${i}@example.com`));

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([{ id: "req_deliverable", type: "reminder_1" }]);
  });

  it("PROOF risk 4: a Free store's stale-due rows starve a PAYING store's reminders", async () => {
    fakeStores = {
      // Downgraded to Free, but reminderEmailsEnabled is still stuck on — the exact scenario
      // canUseRemindersCached exists for. Its rows are timing-due and never dispatchable.
      store_free: { reminderEmailsEnabled: true, remindersEnabledAt: day(90), reminder1DelayDays: 3, reminderFinalDelayDays: 7, canUseEmailReminders: false },
      store_paying: { reminderEmailsEnabled: true, remindersEnabledAt: day(90), reminder1DelayDays: 3, reminderFinalDelayDays: 7, canUseEmailReminders: true },
    };
    fakeRequests = [
      ...Array.from({ length: 26 }, (_, i) => ({
        id: `req_free_${i}`,
        storeId: "store_free",
        status: "sent",
        scheduledFor: null,
        sentAt: day(40 + i),
      })),
      // The batch is merged across stores and then sliced, so the Free store's older rows take
      // every slot and this paying store's reminder is never reached.
      { id: "req_paying", storeId: "store_paying", status: "sent", scheduledFor: null, sentAt: day(5) },
    ];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([{ id: "req_paying", type: "reminder_1" }]);
  });

  // ── REVERSIBILITY. Both new store-level exclusions must gate, never consume. A blocked row is
  // ── not stamped, so the moment the reason disappears the reminder becomes eligible again.
  it("plan entitlement is re-resolved every sweep — upgrading restores the store's reminders", async () => {
    fakeStores = {
      store_1: { reminderEmailsEnabled: true, remindersEnabledAt: day(90), reminder1DelayDays: 3, reminderFinalDelayDays: 7, canUseEmailReminders: false },
    };
    fakeRequests = [{ id: "req_1", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(5) }];

    // On Free: gated, and crucially NOT consumed — reminder1SentAt stays null.
    expect(await runDueReminderSweep(now)).toEqual({ due: 0, dispatched: 0, claimLeaks: 0 });
    expect(fakeRequests[0].reminder1SentAt ?? null).toBeNull();

    // Upgrades. No persistent entitlement cache, so the very next tick sends it.
    fakeStores.store_1.canUseEmailReminders = true;

    expect(await runDueReminderSweep(now)).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([{ id: "req_1", type: "reminder_1" }]);
  });

  it("suppression gates without consuming — resubscribing restores the pending reminder", async () => {
    fakeStores = {
      store_1: { reminderEmailsEnabled: true, remindersEnabledAt: day(90), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    fakeRequests = [
      { id: "req_1", storeId: "store_1", status: "sent", scheduledFor: null, email: "jo@example.com", sentAt: day(5) },
    ];
    suppressedPairs.add("store_1:jo@example.com");

    expect(await runDueReminderSweep(now)).toEqual({ due: 0, dispatched: 0, claimLeaks: 0 });
    // Never stamped — the reminder is withheld, not spent.
    expect(fakeRequests[0].reminder1SentAt ?? null).toBeNull();

    suppressedPairs.delete("store_1:jo@example.com");

    expect(await runDueReminderSweep(now)).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([{ id: "req_1", type: "reminder_1" }]);
  });

  it("one store's suppression list is never applied to another store's query", async () => {
    fakeStores = {
      store_a: { reminderEmailsEnabled: true, remindersEnabledAt: day(90), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
      store_b: { reminderEmailsEnabled: true, remindersEnabledAt: day(90), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    // store_a suppresses three addresses; store_b has pending reminders to all three.
    fakeRequests = ["x", "y", "z"].map((k, i) => ({
      id: `req_b_${k}`,
      storeId: "store_b",
      status: "sent",
      scheduledFor: null,
      email: `${k}@example.com`,
      sentAt: day(5 + i),
    }));
    for (const k of ["x", "y", "z"]) suppressedPairs.add(`store_a:${k}@example.com`);

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 3, dispatched: 3, claimLeaks: 0 });
    expect(reminderDispatches.map((d) => d.id).sort()).toEqual(["req_b_x", "req_b_y", "req_b_z"]);
  });

  it("a request sent exactly AT the enablement instant is eligible (boundary is inclusive)", async () => {
    fakeStores = {
      store_1: { reminderEmailsEnabled: true, remindersEnabledAt: day(5), reminder1DelayDays: 3, reminderFinalDelayDays: 7 },
    };
    // sentAt === remindersEnabledAt. The old JS guard rejected on `<`, so equality passed; the
    // new SQL filter uses `gte`. This pins the two as the same boundary, not an off-by-one.
    fakeRequests = [{ id: "req_boundary", storeId: "store_1", status: "sent", scheduledFor: null, sentAt: day(5) }];

    const result = await runDueReminderSweep(now);

    expect(result).toEqual({ due: 1, dispatched: 1, claimLeaks: 0 });
    expect(reminderDispatches).toEqual([{ id: "req_boundary", type: "reminder_1" }]);
  });
});
