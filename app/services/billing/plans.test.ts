// The product is locked to exactly two merchant-facing plans — see plans.ts's header comment.
// This is the regression test for that lockdown: getAllPlans()/PLAN_ORDER must never grow a
// third entry, and the two that remain must be named exactly "Free" and "Pro".
import { describe, expect, it } from "vitest";
import { getAllPlans, getPlan, PLAN_ORDER } from "./plans";

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

  it("prices Free at $0 and Pro above $0", () => {
    const [free, pro] = getAllPlans();
    expect(free.price).toBe(0);
    expect(pro.price).toBeGreaterThan(0);
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
