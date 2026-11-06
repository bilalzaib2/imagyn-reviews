// Top-level navigation between the sections of one workspace — Reviews and Review Requests
// are two views of the same job, and a merchant moderating feedback moves between them
// constantly.
//
// They are real navigation, not decorative tabs: each one is an <a href> to a route that
// exists, and the active state is derived from the current pathname rather than from local
// state, so it is correct on a cold load, a back-button press and a deep link alike.
//
// WHY <a href> AND NOT A <Link>
//
// App Bridge owns navigation in an embedded Shopify app. It intercepts the native click on an
// anchor and dispatches "shopify:navigate", which AppProvider turns into the real navigate()
// call. A react-router <Link> preventDefaults that click and runs its own transition, which in
// this context never updates the URL at all. See app.tsx's own note and the product cell in
// app.products.tsx, which hit exactly this.
//
// WHAT IS NOT HERE
//
// A "Customer Questions" tab. Product Q&A has no data model in this app — no table, no
// service, nothing behind it — so a tab would navigate to a page that cannot exist. A tab that
// looks like the other two and does nothing is worse than its absence, so it is left out until
// the model exists rather than shipped disabled or as a "coming soon".
import type { ReactNode } from "react";

import styles from "./workspace-tabs.module.css";

export interface WorkspaceTab {
  label: string;
  /** A real route. Never a placeholder. */
  to: string;
  /** Live count, when the page already has the number on hand. Omitted renders no chip at
   *  all rather than a zero, because "0" and "not loaded" look identical and only one of them
   *  is a fact. */
  count?: number;
}

interface WorkspaceTabsProps {
  tabs: readonly WorkspaceTab[];
  /** The current pathname. Passed in rather than read from a hook so this stays a pure
   *  presentational component and is trivial to render in a test. */
  currentPath: string;
  /** Appended to every href, so the embedded app's host/shop query survives navigation. */
  search?: string;
  /** Right-aligned actions that belong to the workspace rather than to one tab. */
  actions?: ReactNode;
}

/** Matches the tab whose route is the current page, preferring the longest match so
 *  "/app/reviews/new" resolves to Reviews rather than to nothing. */
function isActive(tabPath: string, currentPath: string): boolean {
  return currentPath === tabPath || currentPath.startsWith(`${tabPath}/`);
}

export function WorkspaceTabs({ tabs, currentPath, search = "", actions }: WorkspaceTabsProps) {
  return (
    <nav className={styles.tabs} aria-label="Reviews workspace">
      <ul className={styles.list}>
        {tabs.map((tab) => {
          const active = isActive(tab.to, currentPath);

          return (
            <li key={tab.to}>
              <a
                href={`${tab.to}${search}`}
                className={`${styles.tab} ${active ? styles.tabActive : ""}`}
                // aria-current, not aria-selected: these are links in a nav, not tabs in a
                // tablist widget, and aria-selected is only meaningful inside one.
                aria-current={active ? "page" : undefined}
              >
                {tab.label}
                {typeof tab.count === "number" ? <span className={styles.count}>{tab.count}</span> : null}
              </a>
            </li>
          );
        })}
      </ul>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </nav>
  );
}
