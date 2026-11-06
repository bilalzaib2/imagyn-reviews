// Which coupon operations a merchant can actually reach.
//
// coupons.server.ts has been complete and tested for a while, but three of its methods had
// no caller anywhere in the UI — so a merchant could issue a discount code and then had no
// way to withdraw it, and no way to learn whether it had ever been used. A service with no
// caller is not a feature, and nothing in a service-level test suite notices the difference.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROUTE = readFileSync("app/routes/app.settings.coupons.tsx", "utf8");
const SERVICE = readFileSync("app/services/coupons.server.ts", "utf8");

/** Every method on the exported couponsService object. */
function serviceMethods(): string[] {
  const start = SERVICE.indexOf("export const couponsService = {");
  return [...SERVICE.slice(start).matchAll(/^ {2}async ([a-zA-Z]+)\(/gm)].map((match) => match[1]);
}

describe("every coupon operation is reachable", () => {
  it("finds the service methods, so this cannot go vacuous", () => {
    expect(serviceMethods().length).toBeGreaterThanOrEqual(10);
  });

  it.each([
    ["listCoupons", "listing campaigns"],
    ["createCoupon", "creating a campaign"],
    ["activateCoupon", "activating, which mints the real Shopify discount"],
    ["pauseCoupon", "pausing"],
    ["endCoupon", "ending, which deactivates the real discount"],
    ["issueRedemption", "issuing a code to a customer"],
    ["listRedemptions", "seeing which codes went out"],
    ["revokeRedemption", "withdrawing a code already issued"],
    ["checkRedemptionUsage", "asking Shopify whether a code was actually used"],
  ])("%s is wired to the UI (%s)", (method) => {
    expect(ROUTE).toContain(`couponsService.${method}(`);
  });

  it("names every unreachable method, so the gap is explicit rather than forgotten", () => {
    const unreachable = serviceMethods().filter((method) => !ROUTE.includes(`couponsService.${method}(`));

    // Listed deliberately rather than asserted empty, so the gap stays visible:
    //
    //   updateCoupon  a real merchant-facing gap — a campaign cannot be edited once created,
    //                 so a typo in the name or a wrong minimum spend means ending it and
    //                 starting again. Wiring it needs an edit form, not just an intent.
    //   getCoupon     a read helper with no independent UI of its own; it is what an edit
    //                 form would load from, so it lands with updateCoupon.
    //
    // When the edit form ships, this expectation becomes [].
    expect(unreachable).toEqual(["getCoupon", "updateCoupon"]);
  });
});

describe("the lifecycle actions behave honestly", () => {
  it("revoking goes through the service, which deactivates the real Shopify discount", () => {
    expect(ROUTE).toMatch(/intent === "revokeRedemption"[\s\S]{0,600}couponsService\.revokeRedemption/);
  });

  it("reports a missing usage count as a failure rather than as zero", () => {
    // "0 uses" is a claim about the merchant's revenue. If Shopify did not answer, saying it
    // anyway is inventing a fact.
    expect(ROUTE).toMatch(/used === null[\s\S]{0,300}ok: false/);
  });

  it("distinguishes never-used from used-n-times", () => {
    expect(ROUTE).toMatch(/used === 0 \?/);
  });

  it("only offers Revoke on a code that is still issued", () => {
    expect(ROUTE).toMatch(/row\.status === "issued" \?[\s\S]{0,300}Revoke/);
  });

  it("only offers a usage check on a code Shopify actually minted", () => {
    expect(ROUTE).toMatch(/row\.discountCode \?[\s\S]{0,300}Check usage/);
  });

  it("still confirms the irreversible End action", () => {
    expect(ROUTE).toMatch(/window\.confirm/);
  });
});
