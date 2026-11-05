// The Free/Pro entitlement contract, asserted directly against permissions.ts's own tables.
// permissions.ts is the single source of truth every gate in the app reads (see its header
// comment), which also makes it the single place a one-line edit could silently change what a
// paying — or non-paying — merchant is entitled to. These tests exist so that can't happen
// unnoticed.
//
// Deliberately narrow: only the entitlements the product rules actually pin down are asserted,
// not every field on Permissions. A flag with no product rule behind it (e.g. the
// not-yet-built Scale-only capabilities) is free to change without breaking this file.
import { describe, expect, it } from "vitest";
import { getPermissions } from "./permissions";

const FREE = getPermissions("starter");
const PRO = getPermissions("growth");

describe("Free plan — automatic review requests", () => {
  // The Phase-1 product rule: Free sends one initial review-request email per eligible order.
  // The order-triggered creation path (webhooks.fulfillments.create.tsx) reads exactly this
  // flag before creating anything, so flipping it to false would silently remove Free's
  // automatic review requests entirely.
  it("includes automatic (order-triggered) review requests", () => {
    expect(FREE.canUseAutomaticReviewRequests).toBe(true);
  });

  it("includes manual review requests", () => {
    expect(FREE.canUseManualReviewRequests).toBe(true);
  });

  // The other half of the same rule: no automated reminder sequence on Free. Read by
  // app.settings.requests.tsx (which refuses to turn the preference on) and, more importantly,
  // by reviewRequestScheduler.server.ts's runDueReminderSweep, which re-checks it at dispatch
  // time so a store that downgrades while the preference is on stops receiving reminders.
  it("excludes automated reminder emails", () => {
    expect(FREE.canUseEmailReminders).toBe(false);
  });

  it("has no published-review ceiling", () => {
    expect(FREE.maxPublishedReviews).toBeNull();
  });
});

describe("Pro plan — keeps everything Free has, adds the automation tier", () => {
  it("keeps the initial automatic review request", () => {
    expect(PRO.canUseAutomaticReviewRequests).toBe(true);
  });

  it("adds automated reminder emails", () => {
    expect(PRO.canUseEmailReminders).toBe(true);
  });

  it("is a strict superset of Free for every boolean entitlement", () => {
    const booleanKeys = (Object.keys(FREE) as Array<keyof typeof FREE>).filter(
      (key) => typeof FREE[key] === "boolean",
    );

    for (const key of booleanKeys) {
      if (FREE[key] === true) {
        expect(PRO[key], `Pro must not lose Free's ${String(key)}`).toBe(true);
      }
    }
  });
});

describe("owner plan — internal, every capability", () => {
  it("grants both review-request capabilities and reminders", () => {
    const owner = getPermissions("owner");
    expect(owner.canUseAutomaticReviewRequests).toBe(true);
    expect(owner.canUseEmailReminders).toBe(true);
  });
});

// The regression that motivated this block: canUseBrandedEmailSender shipped granted only on
// SCALE. Pro inherited `false` from STARTER, SCALE is retired and unpurchasable, and "owner"
// is internal — so the Email Studio advertised a Pro feature that no real paying merchant
// could ever receive. Every capability Pro is sold on is now pinned here BY NAME. A new flag
// added to the wrong tier block fails this list rather than shipping silently.
describe("Pro entitlements that a paying merchant is actually sold", () => {
  const PRO_CAPABILITIES = [
    "canUseEmailReminders",
    "canUseAdvancedEmailStudio",
    "canUseAI",
    "canUseCustomBranding",
    "canUseBrandStudio",
    "canUseMultipleWidgetThemes",
    "canUseVideoReviewsCarousel",
    "canUseBrandedEmailSender",
    "hasPrioritySupport",
  ] as const;

  it.each(PRO_CAPABILITIES)("Pro grants %s", (capability) => {
    expect(PRO[capability]).toBe(true);
  });

  it.each(PRO_CAPABILITIES)("Free does not grant %s", (capability) => {
    expect(FREE[capability]).toBe(false);
  });

  // A legacy Scale subscriber must never lose a capability that moved up into Pro. SCALE
  // spreads GROWTH, so this holds by inheritance — asserted so a future refactor that
  // reorders those blocks cannot silently downgrade an existing paying subscriber.
  it.each(PRO_CAPABILITIES)("the retired Scale tier still inherits %s", (capability) => {
    expect(getPermissions("scale")[capability]).toBe(true);
  });
});

// Capabilities with no enforcement point built anywhere in the codebase. They are entitlement-
// true on retired/internal plans only, and plans.ts marks each "Coming soon" wherever it is
// listed. Pinned here so none of them is ever quietly advertised to Pro as though it worked.
describe("unbuilt capabilities are never granted to a purchasable plan", () => {
  const UNBUILT = ["canUseWhiteLabel", "canUseCustomEmailDomain", "canUseSMTP", "canUseAPI", "canUseWebhooks"] as const;

  it.each(UNBUILT)("%s is off for Free", (capability) => {
    expect(FREE[capability]).toBe(false);
  });

  it.each(UNBUILT)("%s is off for Pro", (capability) => {
    expect(PRO[capability]).toBe(false);
  });
});
