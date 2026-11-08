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
import { dashboardLoaderData, reviewsLoaderData, questionsLoaderData } from "./fixtures";

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
