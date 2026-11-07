// Review Management layout — the 2026-11-06 full-width redesign.
//
// The screen itself is not rendered here: it needs a Shopify session, a loader and a live
// database, and the surrounding suite already covers its data path. What IS worth pinning is
// the structural contract of the redesign, because the failure modes are silent — a stale CSS
// rule or a reintroduced placeholder panel does not break a build or a unit test, it just
// quietly gives the table a third of its width back.
//
// These assert against the real source files, which is the only place that contract lives.
import { existsSync, readFileSync } from "node:fs";
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
  it("sheds columns in order, rather than all at once", () => {
    // Both used to carry hideOnNarrow, so opening the detail on an ordinary 1200px screen
    // left the table 616px wide and took Customer AND Product with it — the merchant lost
    // the name of the person who wrote the review they were reading. Measured in a browser.
    //
    // Product goes first: the detail panel beside the table already names it. Customer is
    // how a merchant recognises a row at all, so it survives to a much narrower frame.
    const column = (key: string) => {
      const at = ROUTE.indexOf(`key: "${key}"`);
      return ROUTE.slice(at, ROUTE.indexOf("render:", at));
    };

    expect(column("product")).toContain("hideOnCramped: true");
    expect(column("customer")).toContain("hideOnNarrow: true");
    expect(column("customer")).not.toContain("hideOnCramped");

    for (const key of ["rating", "review", "status"]) {
      expect(column(key)).not.toMatch(/hideOnNarrow|hideOnCramped/);
    }
  });

  it("gives the customer column a fixed minimum rather than a percentage", () => {
    // 16% of a 616px split-view table is 98px, which rendered "Amelia H…".
    const at = ROUTE.indexOf('key: "customer"');
    expect(ROUTE.slice(at, ROUTE.indexOf("render:", at))).toMatch(/width: "\d+(\.\d+)?rem"/);
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

  it("links Reviews, Review Requests and Customer Questions, from one shared tab set", () => {
    expect(TABS).toContain('to: "/app/reviews"');
    expect(TABS).toContain('to: "/app/requests"');
    expect(TABS).toContain('to: "/app/questions"');
  });

  it("renders the same navigation on both pages in the workspace", () => {
    for (const source of [ROUTE, REQUESTS]) {
      expect(source).toContain("REVIEW_WORKSPACE_TABS");
      expect(source).toContain("<WorkspaceTabs");
    }
  });

  // The rule this used to enforce — no tab without a model behind it — still stands. It is
  // now enforced the other way round: the Customer Questions tab is allowed precisely
  // because the model, the service and the route all exist. If any of them is deleted, this
  // fails and the tab must come back out.
  it("offers a Customer Questions tab only because something stands behind it", () => {
    const labels = [...TABS.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
    const routes = [...TABS.matchAll(/to: "([^"]+)"/g)].map((match) => match[1]);

    expect(labels).toEqual(["Reviews", "Review Requests", "Customer Questions"]);
    expect(routes).toEqual(["/app/reviews", "/app/requests", "/app/questions"]);

    // The route, the service and the model the tab depends on.
    expect(existsSync("app/routes/app.questions.tsx")).toBe(true);
    expect(existsSync("app/services/question.server.ts")).toBe(true);
    expect(readFileSync("prisma/schema.prisma", "utf8")).toMatch(/^model Question \{/m);
  });

  it("every tab points at a route file that exists", () => {
    const routes = [...TABS.matchAll(/to: "\/app\/([^"]+)"/g)].map((match) => match[1]);
    for (const route of routes) {
      expect(existsSync(`app/routes/app.${route}.tsx`), `no route file for /app/${route}`).toBe(true);
    }
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
    expect(TABLE_CSS).toMatch(/\.wrap \{[\s\S]{0,600}container-type: inline-size/);
    expect(TABLE_CSS).toMatch(/@container \(max-width: 560px\)[\s\S]{0,400}\.hideOnNarrow \{\s*display: none/);
    expect(TABLE_CSS).toMatch(/@container \(max-width: 820px\)[\s\S]{0,400}\.hideOnCramped \{\s*display: none/);
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

describe("one heading, and counts on the status tabs", () => {
  it("does not head the only table on the page a second time", () => {
    // The admin showed "Reviews" + subtitle, then "Review management", then a count line.
    // Judge.me heads the same screen once.
    expect(ROUTE).not.toContain('<Section title="Review management">');
  });

  it("lets a section render without a title at all", () => {
    const SECTION = readFileSync("app/components/ui/Section.tsx", "utf8");
    expect(SECTION).toMatch(/title\?: string/);
    // ...and renders no empty header bar when there is neither title nor actions.
    expect(SECTION).toMatch(/title \|\| actions \?/);
  });

  it("prints a count beside every status tab", () => {
    expect(ROUTE).toMatch(/styles\.statusSegmentCount[\s\S]{0,120}statusCountFor\(option\.value\)/);
  });

  it("reads the All count from the total, not from a status key", () => {
    expect(ROUTE).toMatch(/status === "" \? statusCounts\.all/);
  });

  it("loads the counts in the same round trip as the summaries", () => {
    // A second sequential await here would add a query's latency to every page load.
    expect(ROUTE).toMatch(/Promise\.all\(\[\s*getAiSummariesForProducts[\s\S]{0,200}getStoreReviewStatusCounts/);
  });

  it("still returns counts when the loader falls into its error branch", () => {
    // The component indexes into statusCounts unconditionally; omitting it here would throw
    // on the very page that is already reporting a failure.
    const errorBranch = ROUTE.slice(ROUTE.indexOf("} catch (error) {"));
    expect(errorBranch).toMatch(/statusCounts: \{ all: 0/);
  });

  it("keeps the tab counts from being filtered by the tab you are on", () => {
    const SERVICE = readFileSync("app/services/review.server.ts", "utf8");
    expect(SERVICE).toMatch(/\.\.\.options, status: undefined/);
  });

  it("builds the count filter from the same helper as the list", () => {
    const SERVICE = readFileSync("app/services/review.server.ts", "utf8");
    // Two hand-written where clauses would drift; one helper cannot.
    expect(SERVICE).toMatch(/function buildReviewWhere/);
    expect(SERVICE.match(/buildReviewWhere\(/g)!.length).toBeGreaterThanOrEqual(3);
  });
});
