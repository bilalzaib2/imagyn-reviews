import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

import "@shopify/polaris/build/esm/styles.css";
import "../../app/styles/design-system.css";

import DashboardPage from "../../app/routes/app._index";
import ReviewsPage from "../../app/routes/app.reviews";
import QuestionsPage from "../../app/routes/app.questions";
import AppearancePage from "../../app/routes/app.appearance";
import EmailStudioPage from "../../app/routes/app.email-studio";
import CouponsPage from "../../app/routes/app.settings.coupons";
import SettingsRequestsPage from "../../app/routes/app.settings.requests";
import SettingsModerationPage from "../../app/routes/app.settings.moderation";
import SettingsSeoPage from "../../app/routes/app.settings.seo";
import SettingsTrustPage from "../../app/routes/app.settings.trust";
import {
  appearanceLoaderData,
  dashboardLoaderData,
  couponsLoaderData,
  settingsRequestsLoaderData,
  settingsModerationLoaderData,
  settingsSeoLoaderData,
  settingsTrustLoaderData,
  emailStudioLoaderData,
  reviewsLoaderData,
  questionsLoaderData,
} from "./fixtures";

// Each screen is mounted through a memory router whose loader returns the fixture, which is
// exactly how the real route receives its data — so useLoaderData, useSearchParams and
// useNavigation all behave normally.
const SCREENS: Record<string, { label: string; path: string; element: JSX.Element; data: unknown }> = {
  dashboard: { label: "Dashboard", path: "/app", element: <DashboardPage />, data: dashboardLoaderData() },
  "dashboard-fresh": {
    label: "Dashboard — fresh install",
    path: "/app",
    element: <DashboardPage />,
    data: dashboardLoaderData({ fresh: true }),
  },
  reviews: { label: "Review management", path: "/app/reviews", element: <ReviewsPage />, data: reviewsLoaderData() },
  "reviews-empty": {
    label: "Review management — empty",
    path: "/app/reviews",
    element: <ReviewsPage />,
    data: reviewsLoaderData({ empty: true }),
  },
  appearance: {
    label: "Brand Studio — fresh install",
    path: "/app/appearance",
    element: <AppearancePage />,
    data: appearanceLoaderData(),
  },
  "appearance-free": {
    label: "Brand Studio — Free plan",
    path: "/app/appearance",
    element: <AppearancePage />,
    data: appearanceLoaderData({ pro: false }),
  },
  "email-studio": {
    label: "Email Studio — defaults",
    path: "/app/email-studio",
    element: <EmailStudioPage />,
    data: emailStudioLoaderData(),
  },
  "email-studio-free": {
    label: "Email Studio — Free plan",
    path: "/app/email-studio",
    element: <EmailStudioPage />,
    data: emailStudioLoaderData({ pro: false }),
  },
  coupons: {
    label: "Settings › Coupons",
    path: "/app/settings/coupons",
    element: <CouponsPage />,
    data: couponsLoaderData(),
  },
  "coupons-empty": {
    label: "Settings › Coupons — empty",
    path: "/app/settings/coupons",
    element: <CouponsPage />,
    data: couponsLoaderData({ empty: true }),
  },
  "settings-requests": {
    label: "Settings › Review requests",
    path: "/app/settings/requests",
    element: <SettingsRequestsPage />,
    data: settingsRequestsLoaderData(),
  },
  "settings-requests-free": {
    label: "Settings › Review requests — Free plan",
    path: "/app/settings/requests",
    element: <SettingsRequestsPage />,
    data: settingsRequestsLoaderData({ pro: false }),
  },
  "settings-moderation": {
    label: "Settings › Moderation",
    path: "/app/settings/moderation",
    element: <SettingsModerationPage />,
    data: settingsModerationLoaderData(),
  },
  "settings-seo": {
    label: "Settings › SEO",
    path: "/app/settings/seo",
    element: <SettingsSeoPage />,
    data: settingsSeoLoaderData(),
  },
  "settings-trust": {
    label: "Settings › Trust",
    path: "/app/settings/trust",
    element: <SettingsTrustPage />,
    data: settingsTrustLoaderData(),
  },
  questions: { label: "Customer questions", path: "/app/questions", element: <QuestionsPage />, data: questionsLoaderData() },
  "questions-empty": {
    label: "Customer questions — empty",
    path: "/app/questions",
    element: <QuestionsPage />,
    data: questionsLoaderData({ empty: true }),
  },
};

const key = new URLSearchParams(window.location.search).get("screen") ?? "reviews";
const screen = SCREENS[key] ?? SCREENS.reviews;

const router = createMemoryRouter(
  [{ path: screen.path, element: screen.element, loader: () => screen.data, action: async () => ({ ok: true }) }],
  { initialEntries: [screen.path] },
);

document.title = `${screen.label} — Imagyn design review`;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PolarisAppProvider i18n={enTranslations}>
      <RouterProvider router={router} />
    </PolarisAppProvider>
  </StrictMode>,
);
