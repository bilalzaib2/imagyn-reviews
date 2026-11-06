// Review Management layout — the 2026-11-06 full-width redesign.
//
// The screen itself is not rendered here: it needs a Shopify session, a loader and a live
// database, and the surrounding suite already covers its data path. What IS worth pinning is
// the structural contract of the redesign, because the failure modes are silent — a stale CSS
// rule or a reintroduced placeholder panel does not break a build or a unit test, it just
// quietly gives the table a third of its width back.
//
// These assert against the real source files, which is the only place that contract lives.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROUTE = readFileSync("app/routes/app.reviews.tsx", "utf8");
const CSS = readFileSync("app/styles/app.reviews.module.css", "utf8");

describe("the table is full width", () => {
  // The whole point of the redesign. A two-column grid here means the permanent detail
  // column is back.
  it("lays the list out in a single column", () => {
    const rule = CSS.match(/\.splitLayout \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("grid-template-columns: minmax(0, 1fr)");
  });

  it("no longer applies the mobile drill-down class", () => {
    // .splitLayoutDetailActive used to hide the list entirely on a phone so the flowing panel
    // could be seen. A drawer overlays instead, so the merchant keeps their place in the
    // table — the class must not be applied to the wrapper any more.
    expect(ROUTE).not.toMatch(/styles\.splitLayoutDetailActive/);
  });

  it("mounts no detail panel until a review is actually selected", () => {
    // There were two always-mounted panels: a "Select a review" placeholder and a loading
    // skeleton. Both existed only to fill a column that no longer exists.
    expect(ROUTE).not.toContain("Select a review");
    expect(ROUTE).not.toMatch(/styles\.skeletonTitle/);
  });
});

describe("the detail is a dismissible drawer", () => {
  it("is fixed to the viewport, not flowing in the grid", () => {
    const rule = CSS.match(/\.detailPanel \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("position: fixed");
    // Previously sticky with a 32rem cap, which is what made it borrow height from the list.
    expect(rule![0]).not.toContain("position: sticky");
    expect(rule![0]).not.toContain("max-height: 32rem");
  });

  it("sits above its own scrim", () => {
    const panel = CSS.match(/\.detailPanel \{[^}]*\}/)![0];
    const scrim = CSS.match(/\.detailScrim \{[^}]*\}/);
    expect(scrim).not.toBeNull();

    const z = (rule: string) => Number(rule.match(/z-index:\s*(\d+)/)![1]);
    expect(z(panel)).toBeGreaterThan(z(scrim![0]));
  });

  // Three ways out, because an overlay with one is an overlay a merchant gets stuck in.
  it("can be dismissed by the scrim, the close button and Escape", () => {
    expect(ROUTE).toMatch(/styles\.detailScrim[\s\S]{0,400}setSelectedReviewId\(null\)/);
    expect(ROUTE).toMatch(/styles\.mobileBackButton[\s\S]{0,300}setSelectedReviewId\(null\)/);
    expect(ROUTE).toMatch(/event\.key === "Escape"[\s\S]{0,80}setSelectedReviewId\(null\)/);
  });

  it("gives the scrim an accessible name, since it is a real button", () => {
    expect(ROUTE).toMatch(/className=\{styles\.detailScrim\}[\s\S]{0,200}aria-label="Close review details"/);
  });

  it("shows the close control at every width, not only on mobile", () => {
    const rule = CSS.match(/\.mobileBackButton \{[^}]*\}/);
    expect(rule).not.toBeNull();
    // It used to be display: none by default and revealed only under a media query.
    expect(rule![0]).not.toContain("display: none");
    expect(rule![0]).toContain("display: inline-flex");
  });

  it("removes the Escape listener when nothing is open", () => {
    // A listener left attached would keep firing on a page with no drawer.
    expect(ROUTE).toMatch(/removeEventListener\("keydown"/);
  });
});

describe("the columns the extra width paid for", () => {
  const columnKeys = [...ROUTE.matchAll(/key: "(customer|rating|review|product|status|date)"/g)].map(
    (match) => match[1],
  );

  it("renders customer, rating, review, product, status and date", () => {
    for (const key of ["customer", "rating", "review", "product", "status", "date"]) {
      expect(columnKeys, `missing the ${key} column`).toContain(key);
    }
  });

  it("puts the customer first and the date last", () => {
    expect(columnKeys[0]).toBe("customer");
    expect(columnKeys[columnKeys.length - 1]).toBe("date");
  });

  // Customer and Product are the two that drop on a narrow frame; rating, review and status
  // are what a merchant triages on and must always survive.
  it("drops only the affordable columns on a narrow frame", () => {
    const column = (key: string) => {
      const at = ROUTE.indexOf(`key: "${key}"`);
      return ROUTE.slice(at, ROUTE.indexOf("render:", at));
    };

    expect(column("customer")).toContain("hideOnNarrow: true");
    expect(column("product")).toContain("hideOnNarrow: true");
    expect(column("rating")).not.toContain("hideOnNarrow");
    expect(column("review")).not.toContain("hideOnNarrow");
    expect(column("status")).not.toContain("hideOnNarrow");
  });

  it("does not repeat the customer or product inside the review cell", () => {
    // Both have their own column now. Repeating them was what the cramped layout forced.
    expect(ROUTE).not.toMatch(/styles\.metaCustomer/);
    expect(ROUTE).not.toMatch(/styles\.metaProduct/);
  });

  it("keeps the verification indicator on the row, beside the customer", () => {
    const at = ROUTE.indexOf('key: "customer"');
    const cell = ROUTE.slice(at, ROUTE.indexOf('key: "rating"', at));
    expect(cell).toContain("verifiedPurchase");
    expect(cell).toContain("Verified");
  });

  it("previews the review body, clamped rather than untruncated", () => {
    expect(ROUTE).toMatch(/styles\.reviewPreview/);
    const rule = CSS.match(/\.reviewPreview \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("-webkit-line-clamp: 2");
    expect(rule![0]).toContain("overflow: hidden");
  });
});

describe("nothing was lost to the redesign", () => {
  // The redesign touched a 1,000-line stylesheet and a 2,400-line route. These are the
  // features most at risk from a careless edit, and each one is a real merchant workflow.
  it.each([
    ["bulk selection", /selectedIds/],
    ["keyboard row navigation", /ArrowDown/],
    ["merchant reply", /draftReplyWithAi/],
    ["AI reply voices", /replyTone/],
    ["approve and reject", /"approve"[\s\S]{0,4000}"reject"/],
    ["bulk moderation", /"bulkApprove"[\s\S]{0,4000}"bulkReject"/],
    ["delete with confirmation", /_intent: "delete"/],
    ["review media", /review\.media/],
    ["verified buyer", /verifiedPurchase/],
    ["server-side search", /searchParams/],
    ["cursor pagination", /goToNextPage/],
  ])("still has %s", (_label, pattern) => {
    expect(ROUTE).toMatch(pattern);
  });

  it("still uses the shared table primitive rather than a hand-rolled one", () => {
    expect(ROUTE).toContain('from "../components/ui/Table"');
    expect(ROUTE).not.toMatch(/<table\s+className=\{styles\.table\}/);
  });
});
