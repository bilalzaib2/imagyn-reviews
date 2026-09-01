import { Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { getStorePermissions } from "../services/permissions";
import { Container } from "../components/ui/Container";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.settingsWorkspace.module.css";

// The Settings workspace shell — a dedicated secondary navigation, not a single flat page.
// Everything that used to be its own top-level nav item (Products, Requests already moved to
// a Reviews tab, Email Studio, Widgets, Brand Studio, Medals, Billing) is real, unchanged,
// and still lives at its existing URL; this shell only adds ONE place a merchant can find all
// of it, grouped by what it's actually for, instead of a flat list in primary nav. Settings
// content that's genuinely new here (Automatic Requests, Moderation, Reminder Emails) was
// split out of the former single app.settings.tsx into its own child route per section —
// see app.settings.requests.tsx / app.settings.moderation.tsx.
type LoaderData = {
  canUseAI: boolean;
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const permissions = await getStorePermissions(store.id);

  return {
    canUseAI: permissions.canUseAI,
  };
};

type SettingsLink = {
  label: string;
  href: string;
  /** Internal settings sub-route (rendered in this shell's own Outlet) vs. an existing,
   *  already-real product page that lives outside the Settings workspace. Both are real
   *  top-level <a> navigations (see the header comment above the sidebar below for why); this
   *  only controls whether "active" highlighting applies (a merchant looking at Widgets
   *  shouldn't see a stale-highlighted sidebar once they've left the shell entirely). */
  internal?: boolean;
  tag?: string;
};

type SettingsGroup = {
  label: string;
  items: SettingsLink[];
};

export default function SettingsWorkspace() {
  const { canUseAI } = useLoaderData<typeof loader>();
  const location = useLocation();

  const groups: SettingsGroup[] = [
    {
      label: "Review Collection",
      items: [
        { label: "Request Scheduling", href: "/app/settings/requests", internal: true },
        { label: "Email Studio", href: "/app/email-studio" },
        { label: "Product Management", href: "/app/products" },
      ],
    },
    {
      label: "Review Display",
      items: [
        { label: "Widgets", href: "/app/widgets" },
        { label: "Publishing & Moderation", href: "/app/settings/moderation", internal: true },
      ],
    },
    {
      label: "Rewards & Engagement",
      items: [
        { label: "Review Rewards", href: "/app/settings/rewards", internal: true },
        { label: "Coupons", href: "/app/settings/coupons", internal: true, tag: "Coming soon" },
        { label: "Referrals", href: "/app/settings/referrals", internal: true, tag: "Coming soon" },
      ],
    },
    {
      label: "Growth",
      items: [
        { label: "Google, SEO & AI", href: "/app/settings/seo", internal: true, tag: canUseAI ? undefined : "Pro" },
      ],
    },
    {
      label: "Brand",
      items: [
        { label: "Brand Studio", href: "/app/appearance" },
        { label: "Medals", href: "/app/medals" },
      ],
    },
    {
      label: "Account",
      items: [
        { label: "Plan & Billing", href: "/app/billing" },
      ],
    },
  ];

  return (
    <Container as="main">
      <div className={shellStyles.page}>
        <header className={shellStyles.header}>
          <div className={shellStyles.headerContent}>
            <p className={shellStyles.eyebrow}>Imagyn Reviews</p>
            <h1 className={shellStyles.title}>Settings</h1>
            <p className={shellStyles.subtitle}>
              Everything that configures how Imagyn Reviews collects, displays, and rewards reviews for your store.
            </p>
          </div>
        </header>

        <div className={styles.workspace}>
          {/* Every Settings navigation link below is a REAL, plain <a href> — not a React
              Router <Link>/<NavLink> — and deliberately so. Shopify Admin's embedded-app shell
              owns the outer iframe URL via the <NavMenu> registration in app.tsx, which only
              knows about the four PRIMARY nav items; it silently reverts any *other* client-side
              history.pushState it doesn't recognize back to its own last-known URL a few hundred
              ms later (already reproduced and documented for the Requests page's search/filter
              state — see app.requests.tsx's identical comment; that page's fix was to route
              through a fetcher instead of touching window.history at all). A <NavLink> click
              here hits the exact same class of bug: confirmed live — clicking a Settings
              subsection correctly changed the URL and content, but left the SIDEBAR'S OWN active
              highlight on a stale, unrelated item once Shopify's shell fought the pushState.
              A real anchor triggers a genuine top-level navigation with no synthetic history
              entry for the shell to revert, which is why this reads `location.pathname` (fresh
              on every real navigation, always correct) instead of NavLink's own isActive. */}
          <select
            className={styles.mobileSectionSelect}
            aria-label="Settings sections"
            value={location.pathname}
            onChange={(event) => {
              window.location.href = event.target.value;
            }}
          >
            <option value="/app/settings">Overview</option>
            {groups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.items.map((item) => (
                  <option key={item.href} value={item.href}>
                    {item.label}
                    {item.tag ? ` — ${item.tag}` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <nav className={styles.sidebar} aria-label="Settings sections">
            <div className={styles.sidebarGroup}>
              <a
                href="/app/settings"
                aria-current={location.pathname === "/app/settings" ? "page" : undefined}
                className={
                  location.pathname === "/app/settings"
                    ? `${styles.sidebarLink} ${styles.sidebarLinkActive}`
                    : styles.sidebarLink
                }
              >
                Overview
              </a>
            </div>
            {groups.map((group) => (
              <div key={group.label} className={styles.sidebarGroup}>
                <p className={styles.sidebarGroupLabel}>{group.label}</p>
                {group.items.map((item) => {
                  const isActive = item.internal && location.pathname === item.href;
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      className={isActive ? `${styles.sidebarLink} ${styles.sidebarLinkActive}` : styles.sidebarLink}
                    >
                      {item.label}
                      {item.tag ? <span className={styles.sidebarTag}>{item.tag}</span> : null}
                    </a>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className={styles.content}>
            <Outlet />
          </div>
        </div>
      </div>
    </Container>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
