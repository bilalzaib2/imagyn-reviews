// The product is locked to exactly two merchant-facing plans — see plans.ts's header comment.
// This is the regression test for that lockdown: getAllPlans()/PLAN_ORDER must never grow a
// third entry, and the two that remain must be named exactly "Free" and "Pro".
import { describe, expect, it } from "vitest";
import { formatPlanPrice, getAllPlans, getPlan, PLAN_ORDER } from "./plans";

describe("PLAN_ORDER — exactly two merchant-facing plans", () => {
  it("contains exactly starter and growth, in that order", () => {
    expect(PLAN_ORDER).toEqual(["starter", "growth"]);
  });

  it("never includes the retired scale tier or the internal owner plan", () => {
    expect(PLAN_ORDER).not.toContain("scale");
    expect(PLAN_ORDER).not.toContain("owner");
  });
});

describe("getAllPlans", () => {
  it("returns exactly two plans", () => {
    expect(getAllPlans()).toHaveLength(2);
  });

  it("names them exactly Free and Pro", () => {
    const names = getAllPlans().map((plan) => plan.name);
    expect(names).toEqual(["Free", "Pro"]);
  });

  // The confirmed commercial price, owner-locked 2026-11-10. Pinned exactly rather than
  // "greater than zero", because a silent change here would reprice the product everywhere
  // the app quotes it — and because it must stay equal to the Shopify Managed Pricing
  // setting, which this repository cannot read.
  it("prices Pro at exactly $9.99 a month", () => {
    expect(getPlan("growth").price).toBe(9.99);
  });

  it("formats both plans the one way, so no two screens can disagree", () => {
    expect(formatPlanPrice(getPlan("starter"))).toBe("Free");
    expect(formatPlanPrice(getPlan("growth"))).toBe("$9.99/month");
  });

  it("formats a whole-number price with cents, which raw interpolation did not", () => {
    // The widget upgrade note used `${plan.price}` and billing used toFixed(2). At 9.99 both
    // read the same, so the divergence was invisible; at 10 they would have printed "$10"
    // and "$10.00".
    expect(formatPlanPrice({ price: 10 })).toBe("$10.00/month");
  });

  it("prices Free at $0 and Pro above $0", () => {
    const [free, pro] = getAllPlans();
    expect(free.price).toBe(0);
    expect(pro.price).toBeGreaterThan(0);
  });

  // Pro's trial is offered by Shopify Managed Pricing, not by this codebase — this value is
  // only what the billing page advertises, and it must stay equal to the trial configured on
  // the Pro plan in the Partner Dashboard. Free has no trial: it is already free.
  it("advertises a 7-day trial on Pro and no trial on Free", () => {
    const [free, pro] = getAllPlans();
    expect(free.trialDays).toBe(0);
    expect(pro.trialDays).toBe(7);
  });
});

describe("getPlan — retired/internal plans stay resolvable but are never listed", () => {
  it("scale and owner still resolve (so an existing subscriber/internal store never crashes a lookup)", () => {
    expect(getPlan("scale").id).toBe("scale");
    expect(getPlan("owner").id).toBe("owner");
  });

  it("neither scale nor owner appears in getAllPlans()", () => {
    const ids = getAllPlans().map((plan) => plan.id);
    expect(ids).not.toContain("scale");
    expect(ids).not.toContain("owner");
  });
});
