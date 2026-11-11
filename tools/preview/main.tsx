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
import WidgetsPage from "../../app/routes/app.widgets";
import AnalyticsPage from "../../app/routes/app.analytics";
import SettingsIndexPage from "../../app/routes/app.settings._index";
import RequestsPage from "../../app/routes/app.requests";
import BillingPage from "../../app/routes/app.billing";
import ProductsPage from "../../app/routes/app.products";
import SettingsImportPage from "../../app/routes/app.settings.import";
import SettingsProductGroupsPage from "../../app/routes/app.settings.productGroups";
import SettingsRewardsPage from "../../app/routes/app.settings.rewards";
import SettingsReferralsPage from "../../app/routes/app.settings.referrals";
import NewReviewPage from "../../app/routes/app.reviews_.new";
import EditReviewPage from "../../app/routes/app.reviews_.$id.edit";
import ProductDetailPage from "../../app/routes/app.products_.$id";
import {
  appearanceLoaderData,
  dashboardLoaderData,
  couponsLoaderData,
  settingsRequestsLoaderData,
  settingsModerationLoaderData,
  settingsSeoLoaderData,
  settingsTrustLoaderData,
  widgetsLoaderData,
  analyticsLoaderData,
  settingsIndexLoaderData,
  requestsLoaderData,
  billingLoaderData,
  productsLoaderData,
  settingsImportLoaderData,
  settingsProductGroupsLoaderData,
  settingsRewardsLoaderData,
  settingsReferralsLoaderData,
  emailStudioLoaderData,
  reviewsLoaderData,
  questionsLoaderData,
  newReviewLoaderData,
  editReviewLoaderData,
  productDetailLoaderData,
} from "./fixtures";

// Each screen is mounted through a memory router whose loader returns the fixture, which is
// exactly how the real route receives its data — so useLoaderData, useSearchParams and
// useNavigation all behave normally.
import CarouselCustomizePage from "../../app/routes/app.widgets_.carousel";
import { DEFAULT_CAROUSEL_SETTINGS, applyCarouselPreset } from "../../app/services/carouselSettings.shared";

/** The loader shape app.widgets.carousel.tsx returns. Sample reviews cover the awkward cases:
 *  text-only, one image, several images plus video, a long body and a low rating. */
function carouselLoaderData(presetId?: string) {
  return {
    settings: presetId ? applyCarouselPreset(DEFAULT_CAROUSEL_SETTINGS, presetId) : DEFAULT_CAROUSEL_SETTINGS,
    usingSampleData: true,
    reviews: [
      { id: "p1", title: "Exactly what I hoped for", body: "Arrived two days early and the finish is lovely — photos genuinely do not do it justice. I have already ordered a second one for my sister's birthday next month.", rating: 5, reviewerName: "Amelia R.", date: "9 Nov 2026", productName: "Brown Ceramic Plate", verified: true, images: ["/preview-media/one.svg"], hasVideo: false },
      { id: "p2", title: "Good, with one caveat", body: "Comfortable and well made. The sizing runs a little small, so size up if you are between sizes.", rating: 4, reviewerName: "Jonas P.", date: "4 Nov 2026", productName: "Glacier Merino Hoodie", verified: true, images: [], hasVideo: false },
      { id: "p3", title: "Beautiful set", body: "Bought these for a dinner party and they were the thing everyone commented on. The glaze has a depth to it that is hard to photograph, though I have tried. Washing has not dulled them at all after a month of regular use.", rating: 5, reviewerName: "Priya N.", date: "20 Oct 2026", productName: "Atlas Linen Bedding Set", verified: true, images: ["/preview-media/two.svg", "/preview-media/three.svg"], hasVideo: true },
      { id: "p4", title: "Not quite for me", body: "Quality is fine but the colour is noticeably warmer than it looks on screen.", rating: 3, reviewerName: "Dana K.", date: "8 Oct 2026", productName: "Cirrus Ambient Lamp", verified: false, images: ["/preview-media/three.svg"], hasVideo: false },
    ],
  };
}

const SCREENS: Record<string, { label: string; path: string; element: JSX.Element; data: unknown }> = {
  dashboard: { label: "Dashboard", path: "/app", element: <DashboardPage />, data: dashboardLoaderData() },
  "carousel-customize": {
    label: "Widgets → Review Carousel → Customize",
    path: "/app/widgets/carousel",
    element: <CarouselCustomizePage />,
    data: carouselLoaderData(),
  },
  "carousel-customize-editorial": {
    label: "Carousel Customize — Editorial preset",
    path: "/app/widgets/carousel",
    element: <CarouselCustomizePage />,
    data: carouselLoaderData("editorial"),
  },
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
  widgets: {
    label: "Widgets — fresh install",
    path: "/app/widgets",
    element: <WidgetsPage />,
    data: widgetsLoaderData(),
  },
  "widgets-existing": {
    label: "Widgets — existing merchant",
    path: "/app/widgets",
    element: <WidgetsPage />,
    data: widgetsLoaderData({ fresh: false }),
  },
  "widgets-free": {
    label: "Widgets — Free plan",
    path: "/app/widgets",
    element: <WidgetsPage />,
    data: widgetsLoaderData({ fresh: false, pro: false }),
  },
  analytics: {
    label: "Analytics",
    path: "/app/analytics",
    element: <AnalyticsPage />,
    data: analyticsLoaderData(),
  },
  "analytics-empty": {
    label: "Analytics — no data yet",
    path: "/app/analytics",
    element: <AnalyticsPage />,
    data: analyticsLoaderData({ empty: true }),
  },
  "analytics-free": {
    label: "Analytics — Free plan",
    path: "/app/analytics",
    element: <AnalyticsPage />,
    data: analyticsLoaderData({ pro: false }),
  },
  "settings-index": {
    label: "Settings › overview",
    path: "/app/settings",
    element: <SettingsIndexPage />,
    data: settingsIndexLoaderData(),
  },
  "settings-rewards": {
    label: "Settings › Review rewards",
    path: "/app/settings/rewards",
    element: <SettingsRewardsPage />,
    data: settingsRewardsLoaderData(),
  },
  "settings-rewards-empty": {
    label: "Settings › Review rewards — nothing issued",
    path: "/app/settings/rewards",
    element: <SettingsRewardsPage />,
    data: settingsRewardsLoaderData({ empty: true, enabled: false }),
  },
  "settings-referrals": {
    label: "Settings › Referrals",
    path: "/app/settings/referrals",
    element: <SettingsReferralsPage />,
    data: settingsReferralsLoaderData(),
  },
  requests: {
    label: "Review requests",
    path: "/app/requests",
    element: <RequestsPage />,
    data: requestsLoaderData(),
  },
  "requests-empty": {
    label: "Review requests — empty",
    path: "/app/requests",
    element: <RequestsPage />,
    data: requestsLoaderData({ empty: true }),
  },
  "requests-free": {
    label: "Review requests — Free plan",
    path: "/app/requests",
    element: <RequestsPage />,
    data: requestsLoaderData({ pro: false }),
  },
  billing: {
    label: "Billing — Starter",
    path: "/app/billing",
    element: <BillingPage />,
    data: billingLoaderData(),
  },
  "billing-trial": {
    label: "Billing — Pro trial",
    path: "/app/billing",
    element: <BillingPage />,
    data: billingLoaderData({ plan: "pro", trialing: true }),
  },
  products: {
    label: "Products",
    path: "/app/products",
    element: <ProductsPage />,
    data: productsLoaderData(),
  },
  "products-empty": {
    label: "Products — none synced",
    path: "/app/products",
    element: <ProductsPage />,
    data: productsLoaderData({ empty: true }),
  },
  "products-error": {
    label: "Products — load error",
    path: "/app/products",
    element: <ProductsPage />,
    data: productsLoaderData({ error: true }),
  },
  "settings-import": {
    label: "Settings › Import",
    path: "/app/settings/import",
    element: <SettingsImportPage />,
    data: settingsImportLoaderData(),
  },
  "settings-import-empty": {
    label: "Settings › Import — nothing imported",
    path: "/app/settings/import",
    element: <SettingsImportPage />,
    data: settingsImportLoaderData({ empty: true }),
  },
  "settings-groups": {
    label: "Settings › Product groups",
    path: "/app/settings/productGroups",
    element: <SettingsProductGroupsPage />,
    data: settingsProductGroupsLoaderData(),
  },
  questions: { label: "Customer questions", path: "/app/questions", element: <QuestionsPage />, data: questionsLoaderData() },
  "questions-empty": {
    label: "Customer questions — empty",
    path: "/app/questions",
    element: <QuestionsPage />,
    data: questionsLoaderData({ empty: true }),
  },

  // Reached by URL rather than by a nav item, which is exactly why these three went unrendered
  // until 2026-11-10 — a sweep driven by the sidebar never arrives at them.
  "review-new": {
    label: "Add a review manually",
    path: "/app/reviews/new",
    element: <NewReviewPage />,
    data: newReviewLoaderData(),
  },
  "review-edit": {
    label: "Edit a review",
    path: "/app/reviews/rev_1/edit",
    element: <EditReviewPage />,
    data: editReviewLoaderData(),
  },
  "review-edit-missing": {
    label: "Edit a review — not this store's",
    path: "/app/reviews/rev_other/edit",
    element: <EditReviewPage />,
    data: editReviewLoaderData({ found: false }),
  },
  "product-detail": {
    label: "Product detail",
    path: "/app/products/prod_0",
    element: <ProductDetailPage />,
    data: productDetailLoaderData(),
  },
  "product-detail-empty": {
    label: "Product detail — no reviews yet",
    path: "/app/products/prod_0",
    element: <ProductDetailPage />,
    data: productDetailLoaderData({ reviews: false }),
  },
  "product-detail-missing": {
    label: "Product detail — not found",
    path: "/app/products/prod_other",
    element: <ProductDetailPage />,
    data: productDetailLoaderData({ found: false }),
  },
};

const key = new URLSearchParams(window.location.search).get("screen") ?? "reviews";
const screen = SCREENS[key] ?? SCREENS.reviews;

const router = createMemoryRouter(
  [
    { path: screen.path, element: screen.element, loader: () => screen.data, action: async () => ({ ok: true }) },
    // Several screens load data from a RESOURCE route through a fetcher — app.requests.tsx's
    // "Send Request" reaches /app/requests/orders, for instance. Those routes render no UI, so
    // they are not screens and have no SCREENS entry, but without a route to match them
    // React Router answers the fetcher with a 404 and the DEFAULT ErrorBoundary replaces the
    // whole page with "Unexpected Application Error!". That looked exactly like a crash in the
    // Requests screen during the 2026-11-10 interaction sweep, and was not one.
    //
    // A catch-all under /app returning an empty payload keeps the router whole, so a fetcher
    // resolves to "no results" — a state the UI is built to handle — and the sweep can carry
    // on into the drawer the fetcher opens.
    {
      path: "/app/*",
      loader: () => ({ orders: [], products: [], results: [], hasMore: false, nextCursor: null, error: null }),
      action: async () => ({ ok: true }),
    },
  ],
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
