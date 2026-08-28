import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData, useLocation, useNavigation, useRevalidator, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { ActionList, Checkbox, Frame, Popover, Text, Toast } from "@shopify/polaris";

import { Button } from "../components/ui/Button";
import { Container } from "../components/ui/Container";
import { Medallion } from "../components/medals/Medallion";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { getStorePermissions } from "../services/permissions";
import { getStorefrontAppearance } from "../services/appearance.server";
import { getDefaultAppearanceTokens, type AppearanceTokens } from "../services/appearance.shared";
import { widgetService } from "../services/widget.server";
import { getDefaultWidgetSettings, type WidgetSettings, type WidgetType } from "../services/widget.shared";
import type { WidgetRecord } from "../services/widget.server";
import { detectWidgetInstallStatus, type WidgetInstallKey, type WidgetInstallStatus } from "../services/widgetInstallDetection.server";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.widgets.module.css";

type ActionData = {
  ok: boolean;
  error?: string;
  message?: string;
  widgetId?: string;
};

type LoaderData = {
  widgets: WidgetRecord[];
  shop: string;
  error: string | null;
  // Gates Grid/Carousel — see widget.server.ts's getStorefrontWidgetSettings for why the real
  // enforcement lives server-side, not just in whether this page shows the option.
  canUseMultipleWidgetThemes: boolean;
  appearanceTokens: AppearanceTokens;
  installStatus: Record<WidgetInstallKey, WidgetInstallStatus>;
};

const UNKNOWN_INSTALL_STATUS: WidgetInstallStatus = { state: "unknown", reason: "Not checked yet." };
const fallbackInstallStatus: Record<WidgetInstallKey, WidgetInstallStatus> = {
  "product-reviews-widget": UNKNOWN_INSTALL_STATUS,
  "product-rating-badge": UNKNOWN_INSTALL_STATUS,
  "collection-rating-badge": UNKNOWN_INSTALL_STATUS,
  "review-carousel": UNKNOWN_INSTALL_STATUS,
  "medals-showcase": UNKNOWN_INSTALL_STATUS,
};

type PageView = "gallery" | "customize";

// The theme extension ships five real, installable blocks (see
// extensions/imagyn-review-widgets/blocks/*.liquid — names below match their Shopify
// block names exactly). Only "review-list" is wired to admin-editable settings today
// (getStorefrontWidgetSettings always resolves that one type); Product Rating Badge,
// Collection Rating Badge, Review Carousel, and Medals Showcase are configured entirely in
// the Shopify Theme Editor and have no in-app settings to open, so their cards link out
// instead of pretending to have a working Customize flow (Review Carousel's/Medals
// Showcase's real settings — heading, etc. — live in each block's own schema, editable
// there).
//
// "Featured Collection Badge" and "Related Products Badge" were previously listed as
// separate, unimplemented ("reserved") cards. They are not a distinct feature: Collection
// Rating Badge's own schema text and its collection-rating-badges.js DOM-scan are already
// theme-section-agnostic — they inject onto any Dawn-style product card found anywhere on
// the page, confirmed live on a real merchant (Katran): 16 visible badges rendered on the
// homepage's Featured Collection grid using the exact same Collection Ratings embed used on
// plain collection pages, with zero separate placement or code. Keeping two "Coming soon"
// cards for a surface the shipped block already covers was the actual bug — see this card's
// description below, which now says so explicitly instead of implying it's still pending.
type WidgetCardStatus = "editable" | "theme-editor";

interface WidgetCardDef {
  key: string;
  title: string;
  description: string;
  status: WidgetCardStatus;
  blockName?: string;
  // The block's Liquid filename (extensions/imagyn-review-widgets/blocks/{handle}.liquid) —
  // passed to app.widgets.add-to-theme.tsx, which resolves it against its own allow-list to
  // build the theme-editor deep link, so a merchant can add the block with one click instead
  // of finding it manually.
  blockHandle?: string;
}

const widgetCards: WidgetCardDef[] = [
  {
    key: "product-reviews-widget",
    title: "Product Reviews Widget",
    description: "The full review experience on product pages — summary, histogram, review list, and write-a-review form.",
    status: "editable",
    blockName: "Imagyn Reviews",
    blockHandle: "star_rating",
  },
  {
    key: "product-rating-badge",
    title: "Product Rating Badge",
    description: "A compact star-and-count trust signal placed near the buy box.",
    status: "theme-editor",
    blockName: "Product Rating Badge",
    blockHandle: "rating_badge",
  },
  {
    key: "collection-rating-badge",
    title: "Collection Rating Badge",
    // One embed, enabled once, that already covers every product-grid surface on the
    // storefront — including Featured Collection sections and most Related Products
    // sections, not just plain collection/search grids. Previously listed as two
    // additional "Coming soon" cards implying they needed separate work; they don't.
    description:
      "Star ratings on product cards everywhere they appear in a grid — collection pages, search results, featured collections, and most related-product sections. One embed, enabled once in the Shopify Theme Editor.",
    status: "theme-editor",
    blockName: "Collection Ratings",
    blockHandle: "collection_rating_badges",
  },
  {
    key: "review-carousel",
    title: "Review Carousel",
    description: "A store-wide, scrollable showcase of your best real reviews — typically placed on the homepage.",
    status: "theme-editor",
    blockName: "Review Carousel",
    blockHandle: "review_carousel",
  },
  {
    key: "medals-showcase",
    title: "Medals Showcase",
    description: "A store-wide showcase of your earned achievement medals as realistic brushed-metal medallions — typically placed on the homepage.",
    status: "theme-editor",
    blockName: "Medals Showcase",
    blockHandle: "medals_showcase",
  },
];

// Genuinely not built anywhere yet — no enforcement point in reviews-widget.js for any of
// these, on any plan. Shown as an honest "Coming to Pro" list rather than as editable
// controls that would silently do nothing (see this file's previous version, and
// docs/DESIGN_SYSTEM.md's "never show a feature as included unless it's genuinely built"
// rule, already established for plans.ts's PlanFeature.comingSoon).
const proRoadmapItems = [
  "Multiple saved widget themes",
  "Custom CSS injection",
  "Numeral display alongside stars",
  "Customer-photo toggle in the review list",
  "Infinite scroll",
  "Default sort & filter presets",
];

const sampleReviews = [
  {
    id: "r1",
    name: "Ava Patel",
    date: "Jun 12, 2026",
    verified: true,
    title: "Elegant and surprisingly fast",
    body: "Setup took minutes and the storefront presentation feels much more premium than our previous reviews app.",
    rating: 5,
  },
  {
    id: "r2",
    name: "Luca Moretti",
    date: "Jun 9, 2026",
    verified: true,
    title: "Clean design, better conversion",
    body: "The widget blends into our theme naturally and customers are actually spending time reading the reviews now.",
    rating: 5,
  },
  {
    id: "r3",
    name: "Harper Chen",
    date: "May 28, 2026",
    verified: false,
    title: "Feels native to Shopify",
    body: "The controls are simple for merchants but still flexible enough to tune the experience exactly how we want.",
    rating: 4,
  },
];

const REVIEWS_WIDGET_TYPE: WidgetType = "review-list";

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  try {
    // Detection hits the merchant's own live storefront (see widgetInstallDetection.server.ts)
    // — kept out of the main Promise.all and given its own catch so a slow/unreachable
    // storefront degrades to "unknown" for every widget instead of failing the whole page.
    const [widgets, permissions, appearanceTokens, installStatus] = await Promise.all([
      widgetService.listWidgets(store.id),
      getStorePermissions(store.id),
      getStorefrontAppearance(store.id),
      detectWidgetInstallStatus(session.shop, store.id).catch(() => fallbackInstallStatus),
    ]);

    return {
      widgets,
      shop: session.shop,
      error: null,
      canUseMultipleWidgetThemes: permissions.canUseMultipleWidgetThemes,
      appearanceTokens,
      installStatus,
    };
  } catch (error) {
    return {
      widgets: [],
      shop: session.shop,
      error: error instanceof Error ? error.message : "Unable to load widgets.",
      canUseMultipleWidgetThemes: false,
      appearanceTokens: getDefaultAppearanceTokens(),
      installStatus: fallbackInstallStatus,
    };
  }
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const formData = await request.formData();
  const intent = String(formData.get("_intent") || "");

  try {
    if (intent === "save") {
      const widgetId = String(formData.get("widgetId") || "");
      const widgetName = String(formData.get("widgetName") || "");
      const type = String(formData.get("type") || "review-list") as WidgetType;
      const settings = JSON.parse(String(formData.get("settings") || "{}")) as WidgetSettings;

      // Defense in depth — the admin UI never offers a non-"list" layout control, but a
      // direct POST bypassing it shouldn't be able to set one on a non-Pro store either. See
      // widget.server.ts's getStorefrontWidgetSettings for the storefront-side coercion.
      if (settings.layout && settings.layout !== "list") {
        const permissions = await getStorePermissions(store.id);
        if (!permissions.canUseMultipleWidgetThemes) {
          settings.layout = "list";
        }
      }

      if (widgetId) {
        const updated = await widgetService.updateWidget(store.id, widgetId, {
          name: widgetName,
          type,
          settings,
        });
        return { ok: true, message: "Widget saved.", widgetId: updated.id };
      }

      const created = await widgetService.createWidget({
        storeId: store.id,
        name: widgetName,
        type,
        settings,
      });
      return { ok: true, message: "Widget created.", widgetId: created.id };
    }

    if (intent === "duplicate") {
      const widgetId = String(formData.get("widgetId") || "");
      if (!widgetId) {
        return { ok: false, error: "Save the widget before duplicating it." };
      }

      const duplicate = await widgetService.duplicateWidget(store.id, widgetId);
      return { ok: true, message: "Widget duplicated.", widgetId: duplicate.id };
    }

    if (intent === "delete") {
      const widgetId = String(formData.get("widgetId") || "");
      if (!widgetId) {
        return { ok: false, error: "Select a widget to delete." };
      }

      await widgetService.deleteWidget(store.id, widgetId);
      return { ok: true, message: "Widget deleted." };
    }

    if (intent === "reset") {
      const widgetId = String(formData.get("widgetId") || "");
      if (!widgetId) {
        return { ok: false, error: "Save the widget before resetting it." };
      }

      const reset = await widgetService.resetWidget(store.id, widgetId);
      return { ok: true, message: "Widget reset to defaults.", widgetId: reset.id };
    }

    return { ok: false, error: "Unsupported widget action." };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to complete widget action.",
    };
  }
};

function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.inspectorSection}>
      <h3 className={styles.inspectorSectionTitle}>{title}</h3>
      <div className={styles.inspectorSectionBody}>{children}</div>
    </div>
  );
}

function ReservedRow({ label }: { label: string }) {
  return (
    <div className={styles.reservedRow}>
      <span className={styles.reservedRowLabel}>{label}</span>
      <span className={styles.comingSoonPill}>Coming to Pro</span>
    </div>
  );
}

function renderStars(count: number, size: number, color: string) {
  return Array.from({ length: 5 }, (_, index) => {
    const active = index < count;
    return (
      <span key={index} style={{ fontSize: `${size}px`, color: active ? color : `${color}66`, lineHeight: 1 }}>
        ★
      </span>
    );
  });
}

// Every color/radius/font value here comes from the store's real, saved Appearance System
// tokens (Brand Studio) — the actual source of truth the live storefront resolves to, per
// reviews-widget.css's Appearance-first CSS variable fallback chain. This preview no longer
// reads WidgetSettings' own color/typography/spacing fields at all: those are legacy and, for
// this widget, always superseded by Appearance on the real storefront (see reviews-widget.css),
// so styling this preview from them would show a merchant something they'd never actually see.
// Review name/title/body text is still representative sample copy, not live data — matching
// how a settings preview conventionally works, distinct from the styling engine above it.
function ReviewPreviewCard({
  tokens,
  settings,
  review,
}: {
  tokens: AppearanceTokens;
  settings: WidgetSettings;
  review: (typeof sampleReviews)[number];
}) {
  const textColor = tokens.colors.textColor ?? "#111111";

  return (
    <div
      className={styles.previewCard}
      style={{
        background: tokens.colors.surfaceColor,
        color: textColor,
        borderColor: tokens.colors.borderColor,
        borderRadius: `${tokens.corners.radius}px`,
        borderWidth: `${tokens.borders.width}px`,
        padding: "20px",
        gap: "12px",
      }}
    >
      <div className={styles.previewCardHeader}>
        <div className={styles.previewIdentity}>
          <span>{review.name}</span>
          {settings.showVerifiedBadge && review.verified ? (
            <span className={styles.previewVerified}>
              <svg className={styles.previewVerifiedIcon} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <circle cx="10" cy="10" r="10" fill="currentColor" />
                <path d="M6 10.4 8.7 13 14 7.5" stroke={tokens.colors.surfaceColor} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className={styles.previewVerifiedLabel}>Verified Buyer</span>
            </span>
          ) : null}
          <span>{review.date}</span>
        </div>
        <div className={styles.previewStars}>{renderStars(review.rating, 15, tokens.colors.starColor)}</div>
      </div>
      <div className={styles.previewBodyBlock}>
        <div style={{ fontSize: `${18 * tokens.typography.scale}px`, fontWeight: 600 }}>{review.title}</div>
        <p style={{ fontSize: `${14 * tokens.typography.scale}px`, lineHeight: 1.6, margin: 0 }}>{review.body}</p>
      </div>
    </div>
  );
}

// Review Carousel's gallery-card thumbnail — reuses ReviewPreviewCard (the same real-structure
// card the Product Reviews Widget's own thumbnail renders below) laid out as a fixed-width
// horizontal row instead of a grid/list, so the gallery card reads as an actual carousel
// snapshot rather than the generic star-row placeholder every other "theme-editor" card gets
// (see the widgetCards.map branch below). 260px card width matches the real storefront
// carousel's own slide width (imagyn-component-carousel.css's .imagyn-carousel__slide), so the
// preview's proportions match what a merchant actually sees after adding the block.
const carouselPreviewSettings = getDefaultWidgetSettings(REVIEWS_WIDGET_TYPE);

function CarouselThumbnailPreview({ tokens }: { tokens: AppearanceTokens }) {
  return (
    <div className={styles.carouselThumbnailTrack}>
      {sampleReviews.map((review) => (
        <div key={review.id} className={styles.carouselThumbnailCard}>
          <ReviewPreviewCard tokens={tokens} settings={carouselPreviewSettings} review={review} />
        </div>
      ))}
    </div>
  );
}

// Product Rating Badge's gallery thumbnail — matches rating-badge.js's actual rendered
// structure exactly: star row, then a bold numeric average, then a muted "(N reviews)"
// count — not just a bare star row. rating-badge.js's own markup has no separate
// "average" element unless totalReviews > 0, which is always true for this representative
// preview (a badge with zero reviews is designed to hide itself entirely on the real
// storefront — showing that state here would just be an empty box, not useful as a preview).
function RatingBadgeThumbnailPreview({ tokens }: { tokens: AppearanceTokens }) {
  const sampleAverage = 4.6;
  const sampleCount = 128;

  return (
    <div className={styles.ratingBadgePreviewRow}>
      <span className={styles.previewStars}>{renderStars(Math.round(sampleAverage), 15, tokens.colors.starColor)}</span>
      <span className={styles.ratingBadgePreviewAverage} style={{ color: tokens.colors.textColor ?? "#111111" }}>
        {sampleAverage.toFixed(1)}
      </span>
      <span className={styles.ratingBadgePreviewCount}>({sampleCount} reviews)</span>
    </div>
  );
}

// Collection Rating Badge's gallery thumbnail — the real block never renders as an isolated
// badge; it's injected as its own row directly beneath the price on an existing product
// card (collection-rating-badges.js's findPriceAnchor + collection-rating-badges.css's
// centered, full-width row — see both for the placement/centering this preview mirrors).
// Shown here inside a small mock product card, since a bare badge with nothing around it
// wouldn't communicate that context at all. Card chrome (image/title/price) is
// representative-only; the badge row's structure/centering/star treatment matches the real
// embed exactly, including its lack of a separate numeric average (Collection Ratings only
// ever shows stars + count, unlike Product Rating Badge's average+count).
function CollectionBadgeThumbnailPreview({ tokens }: { tokens: AppearanceTokens }) {
  const sampleCount = 24;

  return (
    <div className={styles.collectionBadgeMockCard}>
      <div className={styles.collectionBadgeMockImage} aria-hidden="true" />
      <div className={styles.collectionBadgeMockTitle} style={{ color: tokens.colors.textColor ?? "#111111" }}>
        Coastal Cotton Tee
      </div>
      <div className={styles.collectionBadgeMockPrice} style={{ color: tokens.colors.textColor ?? "#111111" }}>
        $48.00
      </div>
      <div className={styles.collectionBadgeMockBadgeRow}>
        <span className={styles.previewStars}>{renderStars(5, 13, tokens.colors.starColor)}</span>
        <span className={styles.collectionBadgeMockCount}>({sampleCount})</span>
      </div>
    </div>
  );
}

// Medals Showcase's gallery thumbnail — three representative medallions (one per finish
// tier, not four, to keep the preview compact) using the real Medallion component so the
// preview is pixel-for-pixel what a merchant actually gets, same reasoning as
// CarouselThumbnailPreview reusing ReviewPreviewCard above.
const MEDALS_PREVIEW_SAMPLES: Array<{ category: "verified" | "trust" | "ranking"; tier: number; name: string }> = [
  { category: "verified", tier: 2, name: "Momentum" },
  { category: "trust", tier: 3, name: "Highly Trusted" },
  { category: "ranking", tier: 1, name: "Rising Tier" },
];

function MedalsShowcaseThumbnailPreview() {
  return (
    <div className={styles.medalsShowcasePreviewRow}>
      {MEDALS_PREVIEW_SAMPLES.map((sample) => (
        <div key={sample.name} className={styles.medalsShowcasePreviewItem}>
          <Medallion category={sample.category} unlocked tier={sample.tier} size={44} />
          <span className={styles.medalsShowcasePreviewName}>{sample.name}</span>
        </div>
      ))}
    </div>
  );
}

function WidgetPreview({ tokens, settings }: { tokens: AppearanceTokens; settings: WidgetSettings }) {
  const layoutReviews = settings.layout === "grid" ? sampleReviews : sampleReviews.slice(0, settings.layout === "carousel" ? 2 : 3);

  return (
    <div className={styles.previewFrame} style={{ background: "#F5F4EF" }}>
      <div className={styles.previewBrowserBar}>
        <span />
        <span />
        <span />
      </div>
      <div className={styles.previewStorefront} style={{ background: "#FFFFFF", padding: "24px" }}>
        <div className={styles.previewProductShell}>
          <div className={styles.previewProductHeader}>
            <Text as="h2" variant="headingLg">
              Coastal Cotton Tee
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Premium basics with a calm, storefront-native review presentation.
            </Text>
          </div>

          <div className={settings.layout === "grid" ? styles.gridPreview : styles.listPreview}>
            {layoutReviews.map((review) => (
              <ReviewPreviewCard key={review.id} tokens={tokens} settings={settings} review={review} />
            ))}
          </div>

          <div className={styles.previewActions}>
            {settings.showWriteReviewButton ? (
              <button
                type="button"
                className={styles.previewButton}
                style={{
                  background: tokens.buttons.style === "solid" ? tokens.colors.starColor : "transparent",
                  color: tokens.buttons.style === "solid" ? tokens.colors.surfaceColor : tokens.colors.starColor,
                  borderColor: tokens.colors.starColor,
                  borderRadius: `${tokens.corners.radius}px`,
                }}
              >
                Write Review
              </button>
            ) : null}
            {settings.showLoadMoreButton ? (
              <button
                type="button"
                className={styles.previewButton}
                style={{
                  background: "transparent",
                  color: tokens.colors.textColor ?? "#111111",
                  borderColor: tokens.colors.borderColor,
                  borderRadius: `${tokens.corners.radius}px`,
                }}
              >
                Load More
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// One place to turn a WidgetInstallStatus into what the card actually renders — the single
// spot that guarantees an installed widget can never show "Add to Theme" (see
// widgetInstallDetection.server.ts's docblock), since every card branch below calls this
// instead of building its own label/pill logic.
function InstallStateBadge({ status }: { status: WidgetInstallStatus }) {
  if (status.state === "installed") {
    return <span className={styles.installStateInstalled}>Installed</span>;
  }
  if (status.state === "not-installed") {
    return <span className={styles.installStateNotInstalled}>Not Installed</span>;
  }
  return <span className={styles.installBadge}>Available</span>;
}

function InstallStateAction({ status, addToThemeHref }: { status: WidgetInstallStatus; addToThemeHref: string }) {
  if (status.state === "installed") {
    return (
      <span className={styles.installedIndicator}>
        <span aria-hidden="true">✓</span> Installed
      </span>
    );
  }
  if (status.state === "not-installed") {
    return (
      <a className={styles.themeEditorLink} href={addToThemeHref}>
        Add to Theme
      </a>
    );
  }
  // Unknown must never claim "Add to Theme" — it may already be installed. "Open Theme
  // Editor" is neutral either way.
  return (
    <a className={styles.themeEditorLink} href={addToThemeHref}>
      Open Theme Editor
    </a>
  );
}

export default function WidgetsPage() {
  const { widgets, error, canUseMultipleWidgetThemes, appearanceTokens, installStatus } = useLoaderData<typeof loader>();
  const location = useLocation();
  // Carries embedded/host/shop context the same way app.billing.tsx's manageUrl does — this is
  // a real top-level navigation (required to break out of the iframe), not a fetcher, so it
  // needs that context in its own URL.
  const addToThemeHref = (blockHandle: string) => {
    const params = new URLSearchParams(location.search);
    params.set("handle", blockHandle);
    return `/app/widgets/add-to-theme?${params.toString()}`;
  };
  const fetcher = useFetcher<ActionData>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const isLoading = navigation.state !== "idle";
  const isMutating = fetcher.state !== "idle";

  const [view, setView] = useState<PageView>("gallery");
  const [quickEditOpen, setQuickEditOpen] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [optimisticDeletedIds, setOptimisticDeletedIds] = useState<Record<string, true>>({});
  const [toastState, setToastState] = useState<{ content: string; error?: boolean } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const effectiveWidgets = useMemo(
    () => widgets.filter((widget) => !optimisticDeletedIds[widget.id]),
    [widgets, optimisticDeletedIds],
  );

  const reviewsWidget = useMemo(
    () => effectiveWidgets.find((widget) => widget.type === REVIEWS_WIDGET_TYPE) ?? null,
    [effectiveWidgets],
  );

  const [draftName, setDraftName] = useState(reviewsWidget?.name ?? getDefaultWidgetSettings(REVIEWS_WIDGET_TYPE).widgetName);
  const [draftSettings, setDraftSettings] = useState<WidgetSettings>(
    reviewsWidget?.settings ?? getDefaultWidgetSettings(REVIEWS_WIDGET_TYPE),
  );
  const [baselineSettings, setBaselineSettings] = useState<WidgetSettings>(
    reviewsWidget?.settings ?? getDefaultWidgetSettings(REVIEWS_WIDGET_TYPE),
  );
  const [baselineName, setBaselineName] = useState(
    reviewsWidget?.name ?? getDefaultWidgetSettings(REVIEWS_WIDGET_TYPE).widgetName,
  );

  useEffect(() => {
    if (reviewsWidget) {
      setDraftName(reviewsWidget.name);
      setBaselineName(reviewsWidget.name);
      setDraftSettings(reviewsWidget.settings);
      setBaselineSettings(reviewsWidget.settings);
    }
  }, [reviewsWidget?.id, reviewsWidget?.updatedAt]);

  useEffect(() => {
    if (!fetcher.data) {
      return;
    }

    if (!fetcher.data.ok) {
      setActionError(fetcher.data.error || "Widget action failed.");
      setToastState({ content: fetcher.data.error || "Widget action failed.", error: true });
      setOptimisticDeletedIds({});
      return;
    }

    setActionError(null);
    setToastState({ content: fetcher.data.message || "Widget updated." });
    setOptimisticDeletedIds({});
    revalidator.revalidate();
  }, [fetcher.data, revalidator]);

  const hasUnsavedChanges = useMemo(
    () => draftName !== baselineName || JSON.stringify(draftSettings) !== JSON.stringify(baselineSettings),
    [baselineName, baselineSettings, draftName, draftSettings],
  );

  const submitAction = (payload: Record<string, string>) => {
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => formData.append(key, value));
    fetcher.submit(formData, { method: "post" });
  };

  const updateSetting = <K extends keyof WidgetSettings>(key: K, value: WidgetSettings[K]) => {
    setDraftSettings((current) => ({ ...current, [key]: value }));
  };

  const handleSave = () => {
    submitAction({
      _intent: "save",
      widgetId: reviewsWidget?.id ?? "",
      widgetName: draftName,
      type: REVIEWS_WIDGET_TYPE,
      settings: JSON.stringify({ ...draftSettings, widgetName: draftName }),
    });
    setBaselineName(draftName);
    setBaselineSettings({ ...draftSettings, widgetName: draftName });
  };

  const handleDiscard = () => {
    setDraftName(baselineName);
    setDraftSettings(baselineSettings);
  };

  const handleDuplicate = () => {
    if (!reviewsWidget) {
      setToastState({ content: "Save this widget before duplicating it.", error: true });
      return;
    }
    submitAction({ _intent: "duplicate", widgetId: reviewsWidget.id });
  };

  const handleDelete = () => {
    if (!reviewsWidget) {
      const defaults = getDefaultWidgetSettings(REVIEWS_WIDGET_TYPE);
      setDraftName(defaults.widgetName);
      setDraftSettings(defaults);
      setBaselineName(defaults.widgetName);
      setBaselineSettings(defaults);
      return;
    }
    setOptimisticDeletedIds((current) => ({ ...current, [reviewsWidget.id]: true }));
    submitAction({ _intent: "delete", widgetId: reviewsWidget.id });
  };

  const handleReset = () => {
    const defaults = getDefaultWidgetSettings(REVIEWS_WIDGET_TYPE);
    setDraftSettings(defaults);
    setBaselineSettings(defaults);
    if (reviewsWidget) {
      submitAction({ _intent: "reset", widgetId: reviewsWidget.id });
    } else {
      setToastState({ content: "Draft reset to defaults." });
    }
  };

  return (
    <>
      <Container as="main">
        <div className={shellStyles.page}>
          <header className={`${shellStyles.header} ${styles.header}`}>
            <div className={shellStyles.headerContent}>
              <p className={shellStyles.eyebrow}>Imagyn Reviews</p>
              <h1 className={shellStyles.title}>Widgets</h1>
              <p className={shellStyles.subtitle}>
                Customize how reviews present across your storefront.
              </p>
            </div>
            {view === "customize" ? (
              <button type="button" className={styles.backLink} onClick={() => setView("gallery")}>
                ← Back to Widgets
              </button>
            ) : null}
          </header>

          {error ? (
            <div className={styles.errorState} role="alert">
              <h2 className={styles.errorStateTitle}>Unable to load widgets</h2>
              <p className={styles.errorStateText}>{error}</p>
            </div>
          ) : actionError ? (
            <p className={styles.feedbackError}>{actionError}</p>
          ) : null}

          {isLoading && !widgets.length ? (
            <div className={styles.skeletonGrid} aria-hidden="true">
              {Array.from({ length: 5 }, (_, index) => (
                <div key={index} className={styles.skeletonCard} />
              ))}
            </div>
          ) : view === "gallery" ? (
            <div className={styles.cardGrid}>
              {widgetCards.map((card) => {
                if (card.status === "theme-editor") {
                  const status = installStatus[card.key as WidgetInstallKey] ?? UNKNOWN_INSTALL_STATUS;
                  // Detected live against this store's own storefront (see
                  // widgetInstallDetection.server.ts) — for installed/not-installed the meta
                  // label states the fact plainly; for unknown it surfaces the actual reason
                  // detection couldn't tell, rather than a generic action nudge that would read
                  // as a status claim either way.
                  const metaLabel =
                    status.state === "installed"
                      ? `Block: ${card.blockName} — detected live on your storefront.`
                      : status.state === "not-installed"
                        ? `Block: ${card.blockName} — not yet added to your theme.`
                        : status.reason ?? "Install state can't be determined automatically.";

                  return (
                    <div key={card.key} className={styles.widgetCard}>
                      <div className={styles.widgetCardHeader}>
                        <h2 className={styles.widgetCardTitle}>{card.title}</h2>
                        <InstallStateBadge status={status} />
                      </div>
                      <p className={styles.widgetCardDescription}>{card.description}</p>
                      {card.key === "review-carousel" ? (
                        // The only one of these three that's genuinely a scaled-down full
                        // storefront mockup (matches WidgetPreview's own big-shell-shrunk-to-
                        // thumbnail pattern) — the scale wrapper exists for that reason, not
                        // for the two smaller, single-row previews below.
                        <div className={styles.widgetCardThumbnail}>
                          <div className={styles.widgetCardThumbnailScale}>
                            <CarouselThumbnailPreview tokens={appearanceTokens} />
                          </div>
                        </div>
                      ) : card.key === "product-rating-badge" ? (
                        <div className={styles.widgetCardThumbnailPlaceholder}>
                          <RatingBadgeThumbnailPreview tokens={appearanceTokens} />
                        </div>
                      ) : card.key === "collection-rating-badge" ? (
                        <div className={styles.widgetCardThumbnailPlaceholder}>
                          <CollectionBadgeThumbnailPreview tokens={appearanceTokens} />
                        </div>
                      ) : card.key === "medals-showcase" ? (
                        <div className={styles.widgetCardThumbnailPlaceholder}>
                          <MedalsShowcaseThumbnailPreview />
                        </div>
                      ) : null}
                      <div className={styles.widgetCardMeta}>
                        <span className={styles.widgetCardMetaLabel}>{metaLabel}</span>
                      </div>
                      <div className={styles.widgetCardActions}>
                        <InstallStateAction status={status} addToThemeHref={addToThemeHref(card.blockHandle!)} />
                      </div>
                    </div>
                  );
                }

                const reviewsInstallStatus = installStatus["product-reviews-widget"] ?? UNKNOWN_INSTALL_STATUS;
                // Enabled/Disabled (header pill) is this widget's own DB-backed on/off
                // setting — a different axis from whether the block has been added to the
                // theme at all. Both are real, so both are shown, in two different places, so
                // neither reads as a restatement of the other (see this card's previous
                // "no separate Available pill" fix for why that distinction matters here).
                const reviewsMetaLabel =
                  reviewsInstallStatus.state === "installed"
                    ? `Block: ${card.blockName} — detected live on your storefront.`
                    : reviewsInstallStatus.state === "not-installed"
                      ? `Block: ${card.blockName} — not yet added to your theme.`
                      : `Block: ${card.blockName}. ${reviewsInstallStatus.reason ?? "Install state can't be determined automatically."}`;

                return (
                  <div key={card.key} className={styles.widgetCard}>
                    <div className={styles.widgetCardHeader}>
                      <h2 className={styles.widgetCardTitle}>{card.title}</h2>
                      <span className={draftSettings.enabled ? styles.statusEnabled : styles.statusDisabled}>
                        {draftSettings.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    <p className={styles.widgetCardDescription}>{card.description}</p>
                    <div className={styles.widgetCardThumbnail}>
                      <div className={styles.widgetCardThumbnailScale}>
                        <WidgetPreview tokens={appearanceTokens} settings={{ ...draftSettings, widgetName: draftName }} />
                      </div>
                    </div>
                    <div className={styles.widgetCardMeta}>
                      <span className={styles.widgetCardMetaLabel}>{reviewsMetaLabel}</span>
                    </div>
                    <div className={styles.widgetCardActions}>
                      <Popover
                        active={quickEditOpen}
                        onClose={() => setQuickEditOpen(false)}
                        activator={
                          <Button type="button" onClick={() => setQuickEditOpen((open) => !open)} disabled={isMutating}>
                            Quick Edit
                          </Button>
                        }
                      >
                        <div className={styles.quickEditPopover}>
                          <Checkbox label="Enable widget" checked={draftSettings.enabled} onChange={(value) => updateSetting("enabled", value)} />
                          <Checkbox label="Show verified buyer badge" checked={draftSettings.showVerifiedBadge} onChange={(value) => updateSetting("showVerifiedBadge", value)} />
                          <Button
                            type="button"
                            variant="primary"
                            onClick={() => {
                              handleSave();
                              setQuickEditOpen(false);
                            }}
                            disabled={!hasUnsavedChanges || isMutating}
                          >
                            Save
                          </Button>
                        </div>
                      </Popover>
                      <Button type="button" variant="primary" onClick={() => setView("customize")}>
                        Customize
                      </Button>
                      <InstallStateAction status={reviewsInstallStatus} addToThemeHref={addToThemeHref(card.blockHandle!)} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.inspectorLayout}>
              <div className={styles.inspectorPreviewColumn}>
                <div className={styles.inspectorPreviewCard}>
                  <div className={styles.inspectorPreviewHeader}>
                    <div>
                      <p className={styles.detailEyebrow}>Live preview</p>
                      <h2 className={styles.inspectorTitle}>{draftName}</h2>
                    </div>
                    <span className={draftSettings.enabled ? styles.statusEnabled : styles.statusDisabled}>
                      {draftSettings.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <WidgetPreview tokens={appearanceTokens} settings={{ ...draftSettings, widgetName: draftName }} />
                  <p className={styles.previewNote}>
                    Colors, typography, and spacing come from{" "}
                    <a href={`/app/appearance${location.search}`}>Brand Studio</a>.
                  </p>
                </div>

                <div className={styles.inspectorActionsBar}>
                  <div className={styles.inspectorActionsPrimary}>
                    <Button variant="primary" onClick={handleSave} disabled={!hasUnsavedChanges || isMutating}>
                      Save
                    </Button>
                    <Button variant="secondary" onClick={handleDiscard} disabled={!hasUnsavedChanges || isMutating}>
                      Discard Changes
                    </Button>
                  </div>
                  <Popover
                    active={actionsMenuOpen}
                    onClose={() => setActionsMenuOpen(false)}
                    activator={
                      <Button
                        type="button"
                        variant="secondary"
                        className={styles.actionsMenuButton}
                        onClick={() => setActionsMenuOpen((open) => !open)}
                        disabled={isMutating}
                        aria-label="Widget actions"
                        aria-haspopup="menu"
                        aria-expanded={actionsMenuOpen}
                      >
                        <span aria-hidden="true">&#8226;&#8226;&#8226;</span>
                        <span>Actions</span>
                      </Button>
                    }
                  >
                    <ActionList
                      sections={[
                        {
                          items: [
                            { content: "Duplicate", onAction: () => { setActionsMenuOpen(false); handleDuplicate(); } },
                            { content: "Reset to Default", onAction: () => { setActionsMenuOpen(false); handleReset(); } },
                          ],
                        },
                        {
                          items: [
                            {
                              content: "Delete",
                              destructive: true,
                              onAction: () => {
                                setActionsMenuOpen(false);
                                handleDelete();
                              },
                            },
                          ],
                        },
                      ]}
                    />
                  </Popover>
                </div>
              </div>

              <div className={styles.inspectorSettingsColumn}>
                <InspectorSection title="Name">
                  <input
                    className={styles.textInput}
                    type="text"
                    aria-label="Widget name"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                  />
                </InspectorSection>

                <div className={styles.inspectorDivider} />

                <InspectorSection title="Content">
                  <p className={styles.inspectorGroupLabel}>Trust signals</p>
                  <div className={styles.checkboxStack}>
                    <Checkbox label="Show verified buyer badge" checked={draftSettings.showVerifiedBadge} onChange={(value) => updateSetting("showVerifiedBadge", value)} />
                  </div>

                  <p className={styles.inspectorGroupLabel}>Actions</p>
                  <div className={styles.checkboxStack}>
                    <Checkbox label="Show Write a Review button" checked={draftSettings.showWriteReviewButton} onChange={(value) => updateSetting("showWriteReviewButton", value)} />
                    <Checkbox label="Show Load More button" checked={draftSettings.showLoadMoreButton} onChange={(value) => updateSetting("showLoadMoreButton", value)} />
                  </div>
                </InspectorSection>

                <div className={styles.inspectorDivider} />

                <InspectorSection title="Layout">
                  <p className={styles.inspectorText}>
                    Choose List, Grid, or Carousel directly in the block&apos;s settings in the Shopify Theme Editor.
                  </p>
                  {canUseMultipleWidgetThemes ? (
                    <p className={styles.planNoteIncluded}>✓ Grid and Carousel are available on your plan.</p>
                  ) : (
                    <div className={styles.reservedRow}>
                      <span className={styles.reservedRowLabel}>Grid &amp; Carousel layouts</span>
                      <span className={styles.comingSoonPill}>Pro</span>
                    </div>
                  )}
                </InspectorSection>

                <div className={styles.inspectorDivider} />

                <InspectorSection title="Coming to Pro">
                  <div className={styles.checkboxStack}>
                    {proRoadmapItems.map((item) => (
                      <ReservedRow key={item} label={item} />
                    ))}
                  </div>
                </InspectorSection>
              </div>
            </div>
          )}

          {view === "gallery" ? (
            <div className={styles.roadmapSection}>
              <p className={styles.detailEyebrow}>Coming to Pro</p>
              <div className={styles.comingSoonRow}>
                {proRoadmapItems.map((item) => (
                  <span key={item} className={styles.comingSoonPill}>
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Container>
      <Frame>
        {toastState ? <Toast content={toastState.content} error={toastState.error} onDismiss={() => setToastState(null)} /> : null}
      </Frame>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
