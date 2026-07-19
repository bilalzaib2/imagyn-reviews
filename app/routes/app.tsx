import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useLocation, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import { NavMenu } from "@shopify/app-bridge-react";
import enTranslations from "@shopify/polaris/locales/en.json";

import { authenticate } from "../shopify.server";
import styles from "../styles/app.shell.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigation = useNavigation();
  const isNavigating = navigation.state !== "idle";
  const appContextQuery = location.search;
  const navItems = [
    { label: "Dashboard", path: "/app" },
    { label: "Reviews", path: "/app/reviews" },
    { label: "Products", path: "/app/products" },
    { label: "Requests", path: "/app/requests" },
    { label: "Widgets", path: "/app/widgets" },
    { label: "Settings", path: "/app/settings" },
  ];

  return (
    <AppProvider embedded apiKey={apiKey}>
      <NavMenu>
        {navItems.map((item) => (
          <a key={item.path} href={`${item.path}${appContextQuery}`}>
            {item.label}
          </a>
        ))}
      </NavMenu>
      <PolarisAppProvider i18n={enTranslations}>
        {isNavigating ? <div className={styles.navProgress} aria-hidden="true" /> : null}
        <Outlet />
      </PolarisAppProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
