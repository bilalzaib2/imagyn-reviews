import { NavLink, Outlet, useLoaderData, useRouteError } from "react-router";
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
   *  already-real product page that lives outside the Settings workspace. Both use the same
   *  client-side <NavLink> transition; this only controls whether "active" highlighting
   *  applies (a merchant looking at Widgets shouldn't see a stale-highlighted sidebar once
   *  they've left the shell entirely). */
  internal?: boolean;
  tag?: string;
};

type SettingsGroup = {
  label: string;
  items: SettingsLink[];
};

export default function SettingsWorkspace() {
  const { canUseAI } = useLoaderData<typeof loader>();

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
        { label: "Coupons", href: "/app/settings/coupons", internal: true, tag: "Roadmap" },
        { label: "Referrals", href: "/app/settings/referrals", internal: true, tag: "Roadmap" },
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
          <nav className={styles.sidebar} aria-label="Settings sections">
            {groups.map((group) => (
              <div key={group.label} className={styles.sidebarGroup}>
                <p className={styles.sidebarGroupLabel}>{group.label}</p>
                {group.items.map((item) =>
                  item.internal ? (
                    <NavLink
                      key={item.href}
                      to={item.href}
                      className={({ isActive }) => `${styles.sidebarLink} ${isActive ? styles.sidebarLinkActive : ""}`}
                    >
                      {item.label}
                      {item.tag ? <span className={styles.sidebarTag}>{item.tag}</span> : null}
                    </NavLink>
                  ) : (
                    <NavLink key={item.href} to={item.href} className={styles.sidebarLink}>
                      {item.label}
                      {item.tag ? <span className={styles.sidebarTag}>{item.tag}</span> : null}
                    </NavLink>
                  ),
                )}
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
