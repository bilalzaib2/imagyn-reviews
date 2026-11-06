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

// The base rules, at the start of a line — `.splitLayoutWithDetail .detailPanel` contains
// the substring ".detailPanel {" too, and an unanchored match would pick up whichever of the
// two appears first in the file rather than the one under test.
const baseRule = (name: string) => CSS.match(new RegExp(`^\\.${name} \\{[^}]*\\}`, "m"));

describe("the detail is a dismissible drawer", () => {
  it("is fixed to the viewport, not flowing in the grid", () => {
    const rule = baseRule("detailPanel");
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("position: fixed");
    // Previously sticky with a 32rem cap, which is what made it borrow height from the list.
    expect(rule![0]).not.toContain("position: sticky");
    expect(rule![0]).not.toContain("max-height: 32rem");
  });

  it("sits above its own scrim", () => {
    const panel = baseRule("detailPanel")![0];
    const scrim = baseRule("detailScrim");
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

describe("workspace navigation", () => {
  const TABS = readFileSync("app/components/ui/reviewWorkspaceTabs.ts", "utf8");
  const REQUESTS = readFileSync("app/routes/app.requests.tsx", "utf8");

  it("links Reviews and Review Requests, from one shared tab set", () => {
    expect(TABS).toContain('to: "/app/reviews"');
    expect(TABS).toContain('to: "/app/requests"');
  });

  it("renders the same navigation on both pages in the workspace", () => {
    for (const source of [ROUTE, REQUESTS]) {
      expect(source).toContain("REVIEW_WORKSPACE_TABS");
      expect(source).toContain("<WorkspaceTabs");
    }
  });

  // Product Q&A has no table, no service and no route. A tab that looks like the other two
  // and navigates nowhere is worse than its absence, so it must stay out until the model
  // exists — not ship disabled or as a "coming soon".
  it("does not offer a Customer Questions tab while Q&A has no data model", () => {
    // Checked against the tab DATA, not the whole file — the module's own comment explains
    // the omission by name, and a blunt text scan would match that explanation.
    const labels = [...TABS.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
    const routes = [...TABS.matchAll(/to: "([^"]+)"/g)].map((match) => match[1]);

    expect(labels).toEqual(["Reviews", "Review Requests"]);
    expect(routes).toEqual(["/app/reviews", "/app/requests"]);
    expect(labels.some((label) => /question/i.test(label))).toBe(false);
  });

  it("uses real anchors, because App Bridge owns navigation in an embedded app", () => {
    const NAV = readFileSync("app/components/ui/WorkspaceTabs.tsx", "utf8");
    expect(NAV).toMatch(/<a\s/);
    // A react-router <Link> preventDefaults the click and never updates the embedded URL.
    expect(NAV).not.toMatch(/from "react-router"/);
  });

  it("derives the active tab from the pathname, not from local state", () => {
    const NAV = readFileSync("app/components/ui/WorkspaceTabs.tsx", "utf8");
    expect(NAV).toContain("currentPath");
    expect(NAV).not.toMatch(/useState/);
  });
});

describe("the repeated eyebrow label is gone", () => {
  // "Imagyn Reviews" was printed above the title of every page inside the app — information
  // the merchant already has from the Shopify Admin chrome around the iframe, repeated on
  // every screen, costing a line of vertical space each time.
  it.each([
    "app/routes/app.reviews.tsx",
    "app/routes/app.requests.tsx",
    "app/routes/app.analytics.tsx",
    "app/routes/app.settings.tsx",
    "app/routes/app.reviews_.new.tsx",
    "app/routes/app.reviews_.$id.edit.tsx",
    "app/routes/app.products_.$id.tsx",
  ])("%s no longer prints it", (path) => {
    expect(readFileSync(path, "utf8")).not.toContain("Imagyn Reviews</p>");
  });

  it("PageHeader renders no eyebrow unless a caller passes a real one", () => {
    const HEADER = readFileSync("app/components/ui/PageHeader.tsx", "utf8");
    expect(HEADER).not.toContain('eyebrow ?? "Imagyn Reviews"');
    expect(HEADER).toMatch(/\{eyebrow \? <p/);
  });

  // The Settings breadcrumb is a real eyebrow — it says where you are — and must survive.
  it("keeps the Settings breadcrumb, which carries actual context", () => {
    expect(readFileSync("app/components/ui/SettingsBreadcrumb.tsx", "utf8")).toContain("shellStyles.eyebrow");
  });
});

describe("on a wide screen the detail shares the row instead of covering the table", () => {
  // The defect this fixes, seen in the real embedded admin: as a fixed drawer the panel
  // covered the right half of the table, hiding Product, Status and Date — three of the six
  // columns, and the ones a merchant actually moderates on.
  const wide = CSS.slice(CSS.indexOf("@media (min-width: 64rem)"));

  it("gives the panel a real second column only when a review is selected", () => {
    expect(CSS).toMatch(/\.splitLayoutWithDetail \{[^}]*grid-template-columns: minmax\(0, 1fr\) 26rem/);
    // The base layout must stay single column, or the empty column is back.
    expect(baseRule("splitLayout")![0]).toContain("grid-template-columns: minmax(0, 1fr)");
  });

  it("applies the modifier only while a review is open", () => {
    expect(ROUTE).toMatch(/selectedReview \? styles\.splitLayoutWithDetail : ""/);
  });

  it("stops overlaying, so the table keeps its own width", () => {
    const panel = wide.match(/\.splitLayoutWithDetail \.detailPanel \{[^}]*\}/);
    expect(panel).not.toBeNull();
    expect(panel![0]).toContain("position: sticky");
  });

  it("drops the scrim, so the table stays usable while the panel is open", () => {
    // With a scrim the merchant must close one review before opening the next; Judge.me
    // lets them move straight down the queue.
    expect(wide).toMatch(/\.splitLayoutWithDetail \.detailScrim \{[^}]*display: none/);
  });

  it("lets the table shed columns on its own width, not the window's", () => {
    // A viewport media query cannot see that the table just lost 26rem to the panel, so the
    // columns would stay put and every one of them would truncate instead.
    const TABLE_CSS = readFileSync("app/components/ui/table.module.css", "utf8");
    expect(TABLE_CSS).toMatch(/\.wrap \{[^}]*container-type: inline-size/);
    expect(TABLE_CSS).toMatch(/@container \(max-width: 640px\)[\s\S]{0,200}\.hideOnNarrow \{\s*display: none/);
  });
});

describe("column headers are readable", () => {
  // "I DO NOT want tiny uppercase, letter-spaced headings everywhere" — and a column header
  // is read far more often than any other label on the screen.
  it("sets table headers in sentence case, not uppercase", () => {
    const TABLE_CSS = readFileSync("app/components/ui/table.module.css", "utf8");
    const header = TABLE_CSS.match(/\.table thead th \{[^}]*\}/);
    expect(header).not.toBeNull();
    expect(header![0]).not.toContain("text-transform: uppercase");
    expect(header![0]).not.toContain("letter-spacing: var(--tracking-caps)");
  });
});

describe("one navigation, not two", () => {
  // Both pages rendered WorkspaceTabs AND the older .workflowTabs nav, so the real admin
  // showed two stacked tab rows — "Reviews | Review Requests" directly above
  // "Reviews | Requests". Caught in the browser, not by any test.
  it.each(["app/routes/app.reviews.tsx", "app/routes/app.requests.tsx"])(
    "%s renders no second tab row",
    (path) => {
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/workflowTabs/);
      expect(source).toContain("<WorkspaceTabs");
    },
  );

  it("drops the dead stylesheet rules with it", () => {
    expect(readFileSync("app/styles/shared.module.css", "utf8")).not.toMatch(/\.workflowTab/);
  });
});
