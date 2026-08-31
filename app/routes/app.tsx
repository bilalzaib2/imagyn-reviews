import type { MouseEvent } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Outlet,
  isRouteErrorResponse,
  redirect,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import { NavMenu } from "@shopify/app-bridge-react";
import enTranslations from "@shopify/polaris/locales/en.json";

import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { ensureDevelopmentStoreFlag, getBillingSnapshot } from "../services/billing/billing.server";
import { FloatingHelp } from "../components/ui/FloatingHelp";
import styles from "../styles/app.shell.module.css";

// The billing page must stay reachable even for a store with no access — otherwise a
// gated-out merchant could never reach the page that lets them fix that. This is the only
// route exempted; every other /app/* route goes through the gate below.
const BILLING_PATH = "/app/billing";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticateAdminDeduped(request);

  const url = new URL(request.url);
  if (url.pathname !== BILLING_PATH) {
    const store = await getOrCreateStore(session.shop);
    const isDevelopmentStore = await ensureDevelopmentStoreFlag(admin, store);
    const snapshot = getBillingSnapshot({ ...store, isDevelopmentStore });

    if (!snapshot.hasAccess) {
      throw redirect(`${BILLING_PATH}${url.search}`);
    }
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isNavigating = navigation.state !== "idle";
  const appContextQuery = location.search;
  // Kept intentionally short — the day-to-day merchant workflows only. Everything else
  // (Products, Requests, Email Studio, Widgets, Brand Studio, Medals, Billing) is real,
  // unchanged, and still reachable at its existing URL — just relocated to the Settings
  // workspace's own secondary navigation (app.settings.tsx) or, for Requests, a tab on the
  // Reviews page itself — rather than permanently occupying primary nav.
  const navItems = [
    { label: "Dashboard", path: "/app" },
    { label: "Reviews", path: "/app/reviews" },
    { label: "Analytics", path: "/app/analytics" },
    { label: "Settings", path: "/app/settings" },
  ];

  // NavMenu renders real <a> elements for Shopify Admin's own sidebar chrome. Left-clicking
  // one should always resolve as a React Router SPA transition (so it carries a session-token
  // header) rather than a full document request; modified clicks (new tab, etc.) still fall
  // through to the browser's native anchor behavior via href.
  const handleNavClick = (event: MouseEvent<HTMLAnchorElement>, path: string) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(`${path}${appContextQuery}`);
  };

  return (
    <AppProvider embedded apiKey={apiKey}>
      <NavMenu>
        {navItems.map((item) => (
          <a key={item.path} href={`${item.path}${appContextQuery}`} onClick={(event) => handleNavClick(event, item.path)}>
            {item.label}
          </a>
        ))}
      </NavMenu>
      <PolarisAppProvider i18n={enTranslations}>
        {isNavigating ? <div className={styles.navProgress} aria-hidden="true" /> : null}
        <Outlet />
        <FloatingHelp />
      </PolarisAppProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included
// in the response — boundary.error handles exactly that case (a thrown Response, e.g. Shopify's
// own re-auth redirect) and nothing else: for any other thrown value it just re-throws
// (@shopify/shopify-app-react-router's error.js), which — with no ErrorBoundary above this one in
// the tree (root.tsx has none) — is indistinguishable from a blank/broken embedded app to a
// merchant. A transient Shopify Admin API hiccup, a Prisma blip, or any bug in any /app/* loader
// all take this second path today. This renders a real, honest fallback for that case instead —
// no fake data, no hidden failure, just an accurate "something went wrong" with a working reload.
export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return boundary.error(error);
  }

  return (
    <div className={styles.errorPage}>
      <div className={styles.errorCard}>
        <h1 className={styles.errorTitle}>Something went wrong</h1>
        <p className={styles.errorMessage}>
          Imagyn Reviews hit an unexpected error loading this page. This is usually temporary.
        </p>
        <button type="button" className={styles.errorReload} onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
