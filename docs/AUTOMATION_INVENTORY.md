# Automation Inventory (2026-10-19)

Every automated/scheduled process in IMAGYN Reviews, traced through the actual execution
path — not inferred from dashboard labels. Companion to docs/EMAIL_EXPERIENCE_AUDIT.md.

## Execution engine

All scheduled work runs from **one in-process loop**: `startReviewRequestScheduler()` in
`app/services/reviewRequestScheduler.server.ts`, called once at module scope from
`app/entry.server.tsx`, guarded by a `globalThis` flag so HMR cannot register a second
interval. There is no external cron, queue or worker.

- Interval: **5 minutes** (`SWEEP_INTERVAL_MS`).
- A boot pass runs **10 seconds** after start, so a deploy restart delays due work by
  seconds rather than a full interval.
- **Durability:** due work is derived from database state on every tick, never held in
  process memory. A restart therefore cannot lose a scheduled send — it can only delay it.
- Batch cap: **25** requests per tick (`SWEEP_BATCH_SIZE`), so a backlog cannot monopolise a
  tick or burst the email provider. The remainder is picked up next tick.

## Inventory

| # | Automation | Trigger | Timing | Eligibility (actual query/guards) | Duplicate prevention | Retry | Status |
|---|---|---|---|---|---|---|---|
| 1 | **Initial review request** | `fulfillments/create` webhook → `createFromOrder`; also manual | `autoRequestDelayDays` after fulfillment (**default 7**), stored as `scheduledFor` | `status: "scheduled"` AND `scheduledFor <= now` | `(shopifyOrderId, productId)` unique constraint — a replayed webhook is a no-op | Up to `MAX_SEND_ATTEMPTS` = **3** within one dispatch | **Off by default** (`autoRequestEnabled` default `false`) |
| 2 | **Reminder #1** | Same sweep loop | `reminder1DelayDays` (**default 3**) after the **initial request's `sentAt`** | `reviewedAt: null`, `status notIn [completed,cancelled,failed]`, `sentAt != null`, `store.reminderEmailsEnabled`, `reminder1SentAt: null`, and `sentAt >= store.remindersEnabledAt` | `reminder1SentAt` stamped on send | Next tick retries | **Off by default** (`reminderEmailsEnabled` default `false`) |
| 3 | **Final reminder** | Same sweep loop | `reminderFinalDelayDays` (**default 7**) after the **initial request's `sentAt`** — *not* chained off reminder #1 | Same as #2 with `reminderFinalSentAt: null` | `reminderFinalSentAt` stamped on send | Next tick retries | **Off by default** |
| 4 | **Review reward + Shopify discount** | Review submission → `issueRewardIfEligible` (fire-and-forget) | Immediate, after the discount exists | `evaluateEligibility`: enabled, status, `rewardMinRating` (4), `rewardRequireVerified` (true), optional photo/video | One `Reward` row per `reviewId` (**unique**), checked up front and again via a caught constraint race | None — a failure is recorded as `failed` with a reason | **Off by default** (`rewardsEnabled` default `false`) |
| 5 | **Retention purge (90-day contact info)** | Same sweep loop | Every tick; redacts contact info older than `RETENTION_DAYS` | Per store, via `reviewRequestService.purgeStaleContactInfo` | Idempotent — already-redacted rows are not re-redacted | Errors logged per store; other stores continue | **Active** |
| 6 | **Manual review request** | Merchant action in admin | Immediate | Same eligibility helper as the automatic path | Same unique constraint | Same 3 attempts | Active (merchant-initiated) |
| 7 | **Delivery tracking** | `webhooks.resend.tsx` | On provider event | Correlated by the `request_token` tag echoed back by Resend | Keyed to an existing row | n/a | Active |

## Guarantees verified in code

- **A submitted review stops reminders.** `reviewedAt: null` is in the sweep's `where`, so a
  reviewed request is never even a candidate.
- **A disabled store is excluded at the query level** (`store.reminderEmailsEnabled`), not
  filtered afterwards.
- **Re-enabling reminders does not resurrect a backlog.** `remindersEnabledAt` is bumped only
  on an off→on transition, and the sweep ignores requests sent before it.
- **Suppression/unsubscribe** is enforced in the dispatch path via `emailSuppressionService`.
- **Entitlements** are resolved server-side per send (`getStorePermissions`), so a downgrade
  takes effect on already-queued work.
- **No reward email without a real discount.** Creation failure records `failed` and returns
  before any send.

## Known gaps / limitations (not changed tonight)

1. **Retries are immediate, not backed off.** `MAX_SEND_ATTEMPTS` loops within one dispatch
   with no delay between attempts. A provider blip lasting seconds burns all three.
   *Risk: low* — the next tick re-queues nothing, because the row is marked failed. Worth a
   backoff + retry-after column later.
2. **Single-process scheduler.** Running two app instances would double-sweep. The batch cap
   and per-row stamps make a duplicate send unlikely but not impossible. A real queue is the
   documented future path.
3. **Status is in-process.** `getSchedulerStatus()` resets on deploy; it is observability
   only and nothing schedules off it.
