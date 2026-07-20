import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData, useNavigation, useRevalidator, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  ActionList,
  Badge,
  BlockStack,
  Button as PolarisButton,
  Checkbox,
  Frame,
  Popover,
  RangeSlider,
  Select,
  Text,
  TextField,
  Toast,
} from "@shopify/polaris";

import { Button } from "../components/ui/Button";
import { Container } from "../components/ui/Container";
import { authenticate } from "../shopify.server";
import { widgetService } from "../services/widget.server";
import { getDefaultWidgetSettings, type WidgetSettings, type WidgetType } from "../services/widget.shared";
import type { WidgetRecord } from "../services/widget.server";
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
};

type PageView = "gallery" | "customize";

// The theme extension ships exactly three real, installable blocks (see
// extensions/imagyn-review-widgets/blocks/*.liquid — names below match their Shopify
// block names exactly). Only "review-list" is wired to admin-editable settings today
// (getStorefrontWidgetSettings always resolves that one type); Product Rating Badge and
// Collection Rating Badge are configured entirely in the Shopify Theme Editor and have no
// in-app settings to open, so their cards link out instead of pretending to have a
// working Customize flow. Featured Collection Badge and Related Products Badge don't
// exist as blocks at all yet — reserved placeholders only, per explicit product direction.
type WidgetCardStatus = "editable" | "theme-editor" | "reserved";

interface WidgetCardDef {
  key: string;
  title: string;
  description: string;
  status: WidgetCardStatus;
  blockName?: string;
}

const widgetCards: WidgetCardDef[] = [
  {
    key: "product-reviews-widget",
    title: "Product Reviews Widget",
    description: "The full review experience on product pages — summary, histogram, review list, and write-a-review form.",
    status: "editable",
    blockName: "Imagyn Reviews",
  },
  {
    key: "product-rating-badge",
    title: "Product Rating Badge",
    description: "A compact star-and-count trust signal placed near the buy box.",
    status: "theme-editor",
    blockName: "Product Rating Badge",
  },
  {
    key: "collection-rating-badge",
    title: "Collection Rating Badge",
    description: "Star ratings on product cards across collection and search grids.",
    status: "theme-editor",
    blockName: "Collection Ratings",
  },
  {
    key: "featured-collection-badge",
    title: "Featured Collection Badge",
    description: "A curated ratings highlight for featured-collection sections.",
    status: "reserved",
  },
  {
    key: "related-products-badge",
    title: "Related Products Badge",
    description: "Ratings shown alongside related and recommended products.",
    status: "reserved",
  },
];

const reservedRoadmapItems = ["AI Summary styling", "Video Reviews", "Review Highlights"];

const sampleReviews = [
  {
    id: "r1",
    name: "Ava Patel",
    country: "US",
    date: "Jun 12, 2026",
    verified: true,
    title: "Elegant and surprisingly fast",
    body: "Setup took minutes and the storefront presentation feels much more premium than our previous reviews app.",
    rating: 5,
  },
  {
    id: "r2",
    name: "Luca Moretti",
    country: "IT",
    date: "Jun 9, 2026",
    verified: true,
    title: "Clean design, better conversion",
    body: "The widget blends into our theme naturally and customers are actually spending time reading the reviews now.",
    rating: 5,
  },
  {
    id: "r3",
    name: "Harper Chen",
    country: "CA",
    date: "May 28, 2026",
    verified: false,
    title: "Feels native to Shopify",
    body: "The controls are simple for merchants but still flexible enough to tune the experience exactly how we want.",
    rating: 4,
  },
];

const toNumberValue = (value: number | [number, number]) => (typeof value === "number" ? value : value[0]);
const REVIEWS_WIDGET_TYPE: WidgetType = "review-list";

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticate.admin(request);

  try {
    const widgets = await widgetService.listWidgets();
    return { widgets, shop: session.shop, error: null };
  } catch (error) {
    return {
      widgets: [],
      shop: session.shop,
      error: error instanceof Error ? error.message : "Unable to load widgets.",
    };
  }
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = String(formData.get("_intent") || "");

  try {
    if (intent === "save") {
      const widgetId = String(formData.get("widgetId") || "");
      const widgetName = String(formData.get("widgetName") || "");
      const type = String(formData.get("type") || "review-list") as WidgetType;
      const settings = JSON.parse(String(formData.get("settings") || "{}")) as WidgetSettings;

      if (widgetId) {
        const updated = await widgetService.updateWidget(widgetId, {
          name: widgetName,
          type,
          settings,
        });
        return { ok: true, message: "Widget saved.", widgetId: updated.id };
      }

      const created = await widgetService.createWidget({
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

      const duplicate = await widgetService.duplicateWidget(widgetId);
      return { ok: true, message: "Widget duplicated.", widgetId: duplicate.id };
    }

    if (intent === "delete") {
      const widgetId = String(formData.get("widgetId") || "");
      if (!widgetId) {
        return { ok: false, error: "Select a widget to delete." };
      }

      await widgetService.deleteWidget(widgetId);
      return { ok: true, message: "Widget deleted." };
    }

    if (intent === "reset") {
      const widgetId = String(formData.get("widgetId") || "");
      if (!widgetId) {
        return { ok: false, error: "Save the widget before resetting it." };
      }

      const reset = await widgetService.resetWidget(widgetId);
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
      <span className={styles.comingSoonPill}>Coming soon</span>
    </div>
  );
}

function renderStars(count: number, size: number, color: string, filled: boolean, outline: boolean) {
  return Array.from({ length: 5 }, (_, index) => {
    const active = index < count;
    const symbol = outline && !filled ? "☆" : active ? "★" : "☆";
    return (
      <span key={`${symbol}-${index}`} style={{ fontSize: `${size}px`, color: active ? color : `${color}66`, lineHeight: 1 }}>
        {symbol}
      </span>
    );
  });
}

function ReviewPreviewCard({ settings, review }: { settings: WidgetSettings; review: (typeof sampleReviews)[number] }) {
  const avatarRadius = settings.avatarShape === "square" ? 12 : settings.avatarShape === "rounded" ? 18 : 999;

  return (
    <div
      className={styles.previewCard}
      style={{
        background: settings.backgroundColor,
        color: settings.textColor,
        borderColor: settings.borderColor,
        borderRadius: `${settings.borderRadius}px`,
        borderWidth: `${settings.borderWidth}px`,
        padding: `${settings.padding}px`,
        gap: `${settings.gap}px`,
        boxShadow:
          settings.shadow === "none"
            ? "none"
            : settings.shadow === "soft"
              ? "0 10px 30px rgba(17,17,17,0.06)"
              : "0 18px 40px rgba(17,17,17,0.10)",
      }}
    >
      <div className={styles.previewMetaTop}>
        {settings.showAvatar ? (
          <div
            className={styles.previewAvatar}
            style={{ borderRadius: `${avatarRadius}px`, background: settings.accentColor, color: settings.backgroundColor }}
          >
            {review.name
              .split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2)}
          </div>
        ) : null}
        <div className={styles.previewHeaderBlock}>
          <div className={styles.previewStars}>{renderStars(review.rating, settings.starSize, settings.starColor, settings.starFilled, settings.starOutline)}</div>
          <div className={styles.previewIdentity}>
            {settings.showReviewerName ? <span>{review.name}</span> : null}
            {settings.showVerifiedBadge && review.verified ? <Badge tone="success">Verified</Badge> : null}
            {settings.showCountry ? <span>{review.country}</span> : null}
            {settings.showDate ? <span>{review.date}</span> : null}
          </div>
        </div>
      </div>
      <div className={styles.previewBodyBlock}>
        <div style={{ fontSize: `${settings.headingFontSize}px`, fontWeight: Number(settings.fontWeight), letterSpacing: `${settings.letterSpacing}px` }}>
          {review.title}
        </div>
        <p style={{ fontSize: `${settings.bodyFontSize}px`, lineHeight: settings.lineHeight, margin: 0 }}>{review.body}</p>
      </div>
    </div>
  );
}

function WidgetPreview({ settings }: { settings: WidgetSettings }) {
  const previewBackground = settings.darkMode ? "#111111" : "#F5F4EF";
  const previewSurface = settings.darkMode ? "#1B1B1B" : "#FFFFFF";
  const justifyContent = settings.alignment === "center" ? "center" : settings.alignment === "right" ? "flex-end" : "flex-start";

  return (
    <div className={styles.previewFrame} style={{ background: previewBackground }}>
      <div className={styles.previewBrowserBar}>
        <span />
        <span />
        <span />
      </div>
      <div className={styles.previewStorefront} style={{ background: previewSurface, padding: `${settings.margins}px` }}>
        <div className={styles.previewProductShell} style={{ width: `min(100%, ${settings.containerWidth}px)` }}>
          <div className={styles.previewProductHeader}>
            <Text as="h2" variant="headingLg">
              Coastal Cotton Tee
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Premium basics with a calm, storefront-native review presentation.
            </Text>
          </div>

          <div className={styles.listPreview}>
            {sampleReviews.map((review) => (
              <ReviewPreviewCard key={review.id} settings={settings} review={review} />
            ))}
          </div>

          <div className={styles.previewActions} style={{ justifyContent }}>
            {settings.showWriteReviewButton ? (
              <button
                type="button"
                className={styles.previewButton}
                style={{
                  background: settings.buttonStyle === "outline" ? "transparent" : settings.buttonColor,
                  color: settings.buttonStyle === "outline" ? settings.buttonColor : "#FFFFFF",
                  borderColor: settings.buttonColor,
                  borderRadius: `${settings.buttonRadius}px`,
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
                  background: settings.buttonStyle === "ghost" ? "transparent" : settings.buttonColor,
                  color: settings.buttonStyle === "ghost" ? settings.buttonColor : "#FFFFFF",
                  borderColor: settings.buttonColor,
                  borderRadius: `${settings.buttonRadius}px`,
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

export default function WidgetsPage() {
  const { widgets, shop, error } = useLoaderData<typeof loader>();
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

  const themeEditorUrl = `https://${shop}/admin/themes/current/editor`;

  return (
    <>
      <Container as="main">
        <div className={`${shellStyles.page} ${styles.page}`}>
          <header className={`${shellStyles.header} ${styles.header}`}>
            <div className={shellStyles.headerContent}>
              <p className={`${shellStyles.eyebrow} ${styles.eyebrow}`}>Imagyn Reviews</p>
              <h1 className={`${shellStyles.title} ${styles.title}`}>Widgets</h1>
              <p className={`${shellStyles.subtitle} ${styles.subtitle}`}>
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
                if (card.status === "reserved") {
                  return (
                    <div key={card.key} className={styles.widgetCard} data-reserved="true">
                      <div className={styles.widgetCardHeader}>
                        <h2 className={styles.widgetCardTitle}>{card.title}</h2>
                        <span className={styles.comingSoonPill}>Coming soon</span>
                      </div>
                      <p className={styles.widgetCardDescription}>{card.description}</p>
                      <div className={styles.widgetCardThumbnailPlaceholder}>Preview not yet available</div>
                    </div>
                  );
                }

                if (card.status === "theme-editor") {
                  return (
                    <div key={card.key} className={styles.widgetCard}>
                      <div className={styles.widgetCardHeader}>
                        <h2 className={styles.widgetCardTitle}>{card.title}</h2>
                        <span className={styles.installBadge}>Available</span>
                      </div>
                      <p className={styles.widgetCardDescription}>{card.description}</p>
                      <div className={styles.widgetCardThumbnailPlaceholder}>
                        <span className={styles.previewStars}>{renderStars(5, 16, "#111111", true, false)}</span>
                      </div>
                      <div className={styles.widgetCardMeta}>
                        <span className={styles.widgetCardMetaLabel}>Configured in the Shopify Theme Editor</span>
                      </div>
                      <div className={styles.widgetCardActions}>
                        <a
                          className={styles.themeEditorLink}
                          href={themeEditorUrl}
                          target="_top"
                          rel="noreferrer"
                        >
                          Open in Theme Editor
                        </a>
                      </div>
                    </div>
                  );
                }

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
                        <WidgetPreview settings={{ ...draftSettings, widgetName: draftName }} />
                      </div>
                    </div>
                    <div className={styles.widgetCardMeta}>
                      <span className={styles.installBadge}>Available</span>
                      <span className={styles.widgetCardMetaLabel}>Block: {card.blockName}</span>
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
                          <TextField label="Primary color" value={draftSettings.primaryColor} onChange={(value) => updateSetting("primaryColor", value)} autoComplete="off" />
                          <TextField label="Star color" value={draftSettings.starColor} onChange={(value) => updateSetting("starColor", value)} autoComplete="off" />
                          <PolarisButton
                            variant="primary"
                            onClick={() => {
                              handleSave();
                              setQuickEditOpen(false);
                            }}
                            disabled={!hasUnsavedChanges || isMutating}
                          >
                            Save
                          </PolarisButton>
                        </div>
                      </Popover>
                      <Button type="button" variant="primary" onClick={() => setView("customize")}>
                        Customize
                      </Button>
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
                  <WidgetPreview settings={{ ...draftSettings, widgetName: draftName }} />
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
                  <TextField label="Widget name" labelHidden value={draftName} onChange={setDraftName} autoComplete="off" />
                </InspectorSection>

                <div className={styles.inspectorDivider} />

                <InspectorSection title="Appearance">
                  <p className={styles.inspectorGroupLabel}>Colors</p>
                  <div className={styles.settingsGrid}>
                    <TextField label="Primary" value={draftSettings.primaryColor} onChange={(value) => updateSetting("primaryColor", value)} autoComplete="off" />
                    <TextField label="Accent" value={draftSettings.accentColor} onChange={(value) => updateSetting("accentColor", value)} autoComplete="off" />
                    <TextField label="Background" value={draftSettings.backgroundColor} onChange={(value) => updateSetting("backgroundColor", value)} autoComplete="off" />
                    <TextField label="Text" value={draftSettings.textColor} onChange={(value) => updateSetting("textColor", value)} autoComplete="off" />
                    <TextField label="Border" value={draftSettings.borderColor} onChange={(value) => updateSetting("borderColor", value)} autoComplete="off" />
                    <TextField label="Star" value={draftSettings.starColor} onChange={(value) => updateSetting("starColor", value)} autoComplete="off" />
                    <TextField label="Button" value={draftSettings.buttonColor} onChange={(value) => updateSetting("buttonColor", value)} autoComplete="off" />
                  </div>

                  <p className={styles.inspectorGroupLabel}>Typography</p>
                  <BlockStack gap="300">
                    <RangeSlider label="Heading size" min={14} max={40} value={draftSettings.headingFontSize} onChange={(value) => updateSetting("headingFontSize", toNumberValue(value))} output />
                    <RangeSlider label="Body size" min={12} max={22} value={draftSettings.bodyFontSize} onChange={(value) => updateSetting("bodyFontSize", toNumberValue(value))} output />
                    <Select label="Weight" options={[{ label: "Regular", value: "400" }, { label: "Medium", value: "500" }, { label: "Semibold", value: "600" }, { label: "Bold", value: "700" }]} value={draftSettings.fontWeight} onChange={(value) => updateSetting("fontWeight", value)} />
                    <RangeSlider label="Letter spacing" min={0} max={4} step={0.5} value={draftSettings.letterSpacing} onChange={(value) => updateSetting("letterSpacing", toNumberValue(value))} output />
                    <RangeSlider label="Line height" min={1} max={2} step={0.1} value={draftSettings.lineHeight} onChange={(value) => updateSetting("lineHeight", toNumberValue(value))} output />
                  </BlockStack>

                  <p className={styles.inspectorGroupLabel}>Corner radius</p>
                  <RangeSlider label="Card corner radius" labelHidden min={0} max={40} value={draftSettings.borderRadius} onChange={(value) => updateSetting("borderRadius", toNumberValue(value))} output />

                  <p className={styles.inspectorGroupLabel}>Border</p>
                  <RangeSlider label="Border width" min={0} max={4} value={draftSettings.borderWidth} onChange={(value) => updateSetting("borderWidth", toNumberValue(value))} output />

                  <p className={styles.inspectorGroupLabel}>Shadow</p>
                  <Select label="Shadow" labelHidden options={[{ label: "None", value: "none" }, { label: "Soft", value: "soft" }, { label: "Medium", value: "medium" }]} value={draftSettings.shadow} onChange={(value) => updateSetting("shadow", value)} />

                  <p className={styles.inspectorGroupLabel}>Buttons</p>
                  <BlockStack gap="300">
                    <RangeSlider label="Button radius" min={0} max={999} value={draftSettings.buttonRadius} onChange={(value) => updateSetting("buttonRadius", toNumberValue(value))} output />
                    <Select label="Button style" options={[{ label: "Solid", value: "solid" }, { label: "Outline", value: "outline" }, { label: "Ghost", value: "ghost" }]} value={draftSettings.buttonStyle} onChange={(value) => updateSetting("buttonStyle", value)} />
                  </BlockStack>
                </InspectorSection>

                <div className={styles.inspectorDivider} />

                <InspectorSection title="Layout">
                  <p className={styles.inspectorGroupLabel}>Spacing</p>
                  <BlockStack gap="300">
                    <RangeSlider label="Padding" min={8} max={40} value={draftSettings.padding} onChange={(value) => updateSetting("padding", toNumberValue(value))} output />
                    <RangeSlider label="Gap" min={8} max={32} value={draftSettings.gap} onChange={(value) => updateSetting("gap", toNumberValue(value))} output />
                    <RangeSlider label="Margins" min={0} max={48} value={draftSettings.margins} onChange={(value) => updateSetting("margins", toNumberValue(value))} output />
                    <RangeSlider label="Vertical spacing" min={8} max={32} value={draftSettings.verticalSpacing} onChange={(value) => updateSetting("verticalSpacing", toNumberValue(value))} output />
                  </BlockStack>

                  <p className={styles.inspectorGroupLabel}>Alignment</p>
                  <Select label="Alignment" labelHidden options={[{ label: "Left", value: "left" }, { label: "Center", value: "center" }, { label: "Right", value: "right" }]} value={draftSettings.alignment} onChange={(value) => updateSetting("alignment", value)} />

                  <p className={styles.inspectorGroupLabel}>Width</p>
                  <BlockStack gap="300">
                    <RangeSlider label="Container width" min={280} max={1200} value={draftSettings.containerWidth} onChange={(value) => updateSetting("containerWidth", toNumberValue(value))} output />
                    <RangeSlider label="Card width" min={220} max={420} value={draftSettings.cardWidth} onChange={(value) => updateSetting("cardWidth", toNumberValue(value))} output />
                  </BlockStack>

                  <p className={styles.inspectorGroupLabel}>Card style</p>
                  <div className={styles.cardStyleRow}>
                    <span className={styles.cardStyleActive}>List</span>
                    <span className={styles.cardStyleReserved}>Carousel · Coming soon</span>
                    <span className={styles.cardStyleReserved}>Floating Review Widget · Coming soon</span>
                  </div>
                </InspectorSection>

                <div className={styles.inspectorDivider} />

                <InspectorSection title="Content">
                  <p className={styles.inspectorGroupLabel}>Stars</p>
                  <BlockStack gap="300">
                    <RangeSlider label="Star size" min={12} max={28} value={draftSettings.starSize} onChange={(value) => updateSetting("starSize", toNumberValue(value))} output />
                    <Checkbox label="Filled" checked={draftSettings.starFilled} onChange={(value) => updateSetting("starFilled", value)} />
                    <Checkbox label="Outline" checked={draftSettings.starOutline} onChange={(value) => updateSetting("starOutline", value)} />
                  </BlockStack>

                  <p className={styles.inspectorGroupLabel}>Rating text</p>
                  <ReservedRow label="Show numeral alongside stars" />

                  <p className={styles.inspectorGroupLabel}>Reviewer name</p>
                  <Checkbox label="Show reviewer name" checked={draftSettings.showReviewerName} onChange={(value) => updateSetting("showReviewerName", value)} />

                  <p className={styles.inspectorGroupLabel}>Verified badge</p>
                  <Checkbox label="Show verified buyer badge" checked={draftSettings.showVerifiedBadge} onChange={(value) => updateSetting("showVerifiedBadge", value)} />

                  <p className={styles.inspectorGroupLabel}>Date</p>
                  <BlockStack gap="300">
                    <Checkbox label="Show date" checked={draftSettings.showDate} onChange={(value) => updateSetting("showDate", value)} />
                    <Checkbox label="Show country" checked={draftSettings.showCountry} onChange={(value) => updateSetting("showCountry", value)} />
                  </BlockStack>

                  <p className={styles.inspectorGroupLabel}>Photos</p>
                  <ReservedRow label="Show customer photos in the review list" />
                </InspectorSection>

                <div className={styles.inspectorDivider} />

                <InspectorSection title="Behaviour">
                  <p className={styles.inspectorGroupLabel}>Pagination</p>
                  <Checkbox label="Show Load More button" checked={draftSettings.showLoadMoreButton} onChange={(value) => updateSetting("showLoadMoreButton", value)} />

                  <p className={styles.inspectorGroupLabel}>Infinite scroll</p>
                  <ReservedRow label="Load more reviews automatically while scrolling" />

                  <p className={styles.inspectorGroupLabel}>Sorting</p>
                  <ReservedRow label="Merchant-configurable default sort order" />

                  <p className={styles.inspectorGroupLabel}>Default filter</p>
                  <ReservedRow label="Pre-select a rating or status filter" />

                  <p className={styles.inspectorGroupLabel}>Interactions</p>
                  <BlockStack gap="300">
                    <Checkbox label="Show Write a Review button" checked={draftSettings.showWriteReviewButton} onChange={(value) => updateSetting("showWriteReviewButton", value)} />
                    <Select
                      label="Placement"
                      options={[
                        { label: "Product header", value: "product-header" },
                        { label: "Product body", value: "product-body" },
                        { label: "Homepage featured", value: "homepage-featured" },
                        { label: "Collection highlight", value: "collection-highlight" },
                        { label: "Floating corner", value: "floating-corner" },
                      ]}
                      value={draftSettings.placement}
                      onChange={(value) => updateSetting("placement", value)}
                    />
                    <Select
                      label="Entrance animation"
                      options={[
                        { label: "Fade", value: "fade" },
                        { label: "Slide", value: "slide" },
                        { label: "Lift", value: "lift" },
                        { label: "Stagger", value: "stagger" },
                      ]}
                      value={draftSettings.animation}
                      onChange={(value) => updateSetting("animation", value)}
                    />
                  </BlockStack>
                </InspectorSection>

                <div className={styles.inspectorDivider} />

                <InspectorSection title="Advanced">
                  <BlockStack gap="300">
                    <Checkbox label="Enable animations" checked={draftSettings.enableAnimations} onChange={(value) => updateSetting("enableAnimations", value)} />
                    <Checkbox label="Dark mode preview" checked={draftSettings.darkMode} onChange={(value) => updateSetting("darkMode", value)} />
                    <TextField label="Custom CSS" value={draftSettings.customCss} onChange={(value) => updateSetting("customCss", value)} autoComplete="off" multiline={6} />
                  </BlockStack>
                </InspectorSection>
              </div>
            </div>
          )}

          {view === "gallery" ? (
            <div className={styles.roadmapSection}>
              <p className={styles.detailEyebrow}>Coming soon</p>
              <div className={styles.comingSoonRow}>
                {reservedRoadmapItems.map((item) => (
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
