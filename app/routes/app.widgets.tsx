import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData, useNavigation, useRevalidator, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  AppProvider as PolarisAppProvider,
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  Collapsible,
  Divider,
  EmptyState,
  Frame,
  InlineStack,
  RangeSlider,
  Select,
  SkeletonBodyText,
  SkeletonDisplayText,
  Text,
  TextField,
  Toast,
} from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

import { Container } from "../components/ui/Container";
import { authenticate } from "../shopify.server";
import {
  widgetService,
} from "../services/widget.server";
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
  error: string | null;
};

type LibraryItem = {
  type: WidgetType;
  title: string;
  description: string;
  icon: string;
};

type SettingSectionKey =
  | "general"
  | "colors"
  | "typography"
  | "cards"
  | "reviewer"
  | "stars"
  | "buttons"
  | "spacing"
  | "advanced";

const widgetLibrary: LibraryItem[] = [
  { type: "star-rating", title: "Star Rating", description: "Compact social proof for product pages.", icon: "★★★★★" },
  { type: "review-list", title: "Review List", description: "Classic stacked reviews with strong readability.", icon: "≣" },
  { type: "review-carousel", title: "Review Carousel", description: "A premium rotating showcase for featured reviews.", icon: "↔" },
  { type: "review-grid", title: "Review Grid", description: "Balanced grid for homepage and collection layouts.", icon: "▦" },
  { type: "masonry-grid", title: "Masonry Grid", description: "Editorial-style layout for varied review lengths.", icon: "▤" },
  { type: "floating-badge", title: "Floating Badge", description: "Persistent trust signal anchored to the viewport.", icon: "◎" },
];

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

const initialOpenSections: Record<SettingSectionKey, boolean> = {
  general: true,
  colors: true,
  typography: false,
  cards: false,
  reviewer: false,
  stars: false,
  buttons: false,
  spacing: false,
  advanced: false,
};

const toNumberValue = (value: number | [number, number]) => (typeof value === "number" ? value : value[0]);

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  await authenticate.admin(request);

  try {
    const widgets = await widgetService.listWidgets();
    return { widgets, error: null };
  } catch (error) {
    return {
      widgets: [],
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
        return { ok: false, error: "Select a widget to duplicate." };
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

function SettingsSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingSm">
            {title}
          </Text>
          <Button variant="plain" onClick={onToggle} accessibilityLabel={`Toggle ${title}`}>
            {open ? "Collapse" : "Expand"}
          </Button>
        </InlineStack>
        <Collapsible open={open} id={`section-${title.toLowerCase().replace(/\s+/g, "-")}`}>
          <div className={styles.sectionContent}>{children}</div>
        </Collapsible>
      </BlockStack>
    </Card>
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

function WidgetPreview({ type, settings }: { type: WidgetType; settings: WidgetSettings }) {
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

          {type === "star-rating" ? (
            <div className={styles.starRatingPreview} style={{ justifyContent }}>
              <div className={styles.previewStars}>{renderStars(5, settings.starSize, settings.starColor, settings.starFilled, settings.starOutline)}</div>
              <Text as="span" variant="bodyMd">
                4.9 from 1,284 reviews
              </Text>
            </div>
          ) : null}

          {type === "review-list" ? (
            <div className={styles.listPreview}>
              {sampleReviews.map((review) => (
                <ReviewPreviewCard key={review.id} settings={settings} review={review} />
              ))}
            </div>
          ) : null}

          {type === "review-carousel" ? (
            <div className={styles.carouselPreview}>
              {sampleReviews.map((review) => (
                <div key={review.id} className={styles.carouselSlide} style={{ width: `${settings.cardWidth}px` }}>
                  <ReviewPreviewCard settings={settings} review={review} />
                </div>
              ))}
            </div>
          ) : null}

          {type === "review-grid" ? (
            <div className={styles.gridPreview} style={{ gap: `${settings.verticalSpacing}px` }}>
              {sampleReviews.map((review) => (
                <div key={review.id} style={{ width: `min(100%, ${settings.cardWidth}px)` }}>
                  <ReviewPreviewCard settings={settings} review={review} />
                </div>
              ))}
            </div>
          ) : null}

          {type === "masonry-grid" ? (
            <div className={styles.masonryPreview} style={{ gap: `${settings.verticalSpacing}px` }}>
              {sampleReviews.map((review, index) => (
                <div key={review.id} className={styles.masonryCell} style={{ marginTop: index === 1 ? "40px" : index === 2 ? "16px" : "0", width: `min(100%, ${settings.cardWidth}px)` }}>
                  <ReviewPreviewCard settings={settings} review={review} />
                </div>
              ))}
            </div>
          ) : null}

          {type === "floating-badge" ? (
            <div className={styles.floatingBadgePreview} style={{ justifyContent }}>
              <div
                className={styles.floatingBadge}
                style={{ borderRadius: `${settings.borderRadius}px`, background: settings.backgroundColor, color: settings.textColor, borderColor: settings.borderColor }}
              >
                <div className={styles.previewStars}>{renderStars(5, settings.starSize, settings.starColor, settings.starFilled, settings.starOutline)}</div>
                <Text as="span" variant="bodySm">
                  Loved by 1,200+ shoppers
                </Text>
              </div>
            </div>
          ) : null}

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
  const { widgets, error } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const isLoading = navigation.state !== "idle";
  const isMutating = fetcher.state !== "idle";

  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(widgets[0]?.id ?? null);
  const [selectedType, setSelectedType] = useState<WidgetType>(widgets[0]?.type ?? "review-list");
  const [draftName, setDraftName] = useState(widgets[0]?.name ?? getDefaultWidgetSettings("review-list").widgetName);
  const [draftSettings, setDraftSettings] = useState<WidgetSettings>(widgets[0]?.settings ?? getDefaultWidgetSettings("review-list"));
  const [baselineSettings, setBaselineSettings] = useState<WidgetSettings>(widgets[0]?.settings ?? getDefaultWidgetSettings("review-list"));
  const [baselineName, setBaselineName] = useState(widgets[0]?.name ?? getDefaultWidgetSettings("review-list").widgetName);
  const [toastState, setToastState] = useState<{ content: string; error?: boolean } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<SettingSectionKey, boolean>>(initialOpenSections);
  const [optimisticDeletedIds, setOptimisticDeletedIds] = useState<Record<string, true>>({});

  const effectiveWidgets = useMemo(
    () => widgets.filter((widget) => !optimisticDeletedIds[widget.id]),
    [widgets, optimisticDeletedIds],
  );

  useEffect(() => {
    if (!effectiveWidgets.length) {
      return;
    }

    if (!selectedWidgetId || !effectiveWidgets.some((widget) => widget.id === selectedWidgetId)) {
      const nextWidget = effectiveWidgets[0];
      setSelectedWidgetId(nextWidget.id);
      setSelectedType(nextWidget.type);
      setDraftName(nextWidget.name);
      setBaselineName(nextWidget.name);
      setDraftSettings(nextWidget.settings);
      setBaselineSettings(nextWidget.settings);
    }
  }, [effectiveWidgets, selectedWidgetId]);

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

    if (fetcher.data.widgetId) {
      setSelectedWidgetId(fetcher.data.widgetId);
    }

    setOptimisticDeletedIds({});
    revalidator.revalidate();
  }, [fetcher.data, revalidator]);

  const selectedSavedWidget = useMemo(
    () => effectiveWidgets.find((widget) => widget.id === selectedWidgetId) ?? null,
    [effectiveWidgets, selectedWidgetId],
  );

  const hasUnsavedChanges = useMemo(
    () => draftName !== baselineName || JSON.stringify(draftSettings) !== JSON.stringify(baselineSettings),
    [baselineName, baselineSettings, draftName, draftSettings],
  );

  const applyDraftFromWidget = (widget: WidgetRecord) => {
    setSelectedWidgetId(widget.id);
    setSelectedType(widget.type);
    setDraftName(widget.name);
    setBaselineName(widget.name);
    setDraftSettings(widget.settings);
    setBaselineSettings(widget.settings);
  };

  const submitAction = (payload: Record<string, string>) => {
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => formData.append(key, value));
    fetcher.submit(formData, { method: "post" });
  };

  const updateSetting = <K extends keyof WidgetSettings>(key: K, value: WidgetSettings[K]) => {
    setDraftSettings((current) => ({ ...current, [key]: value }));
  };

  const handleLibrarySelect = (item: LibraryItem) => {
    setSelectedType(item.type);
    const defaults = getDefaultWidgetSettings(item.type);
    setDraftSettings(defaults);
    setBaselineSettings(defaults);
    setDraftName(defaults.widgetName);
    setBaselineName(defaults.widgetName);
    setSelectedWidgetId(null);
  };

  const handleSave = () => {
    submitAction({
      _intent: "save",
      widgetId: selectedWidgetId ?? "",
      widgetName: draftName,
      type: selectedType,
      settings: JSON.stringify({ ...draftSettings, widgetName: draftName }),
    });
    setBaselineName(draftName);
    setBaselineSettings({ ...draftSettings, widgetName: draftName });
  };

  const handleDiscard = () => {
    setDraftName(baselineName);
    setDraftSettings(baselineSettings);
    setSelectedType(selectedSavedWidget?.type ?? selectedType);
  };

  const handleDuplicate = () => {
    if (!selectedWidgetId) {
      setToastState({ content: "Save this widget before duplicating it.", error: true });
      return;
    }

    submitAction({ _intent: "duplicate", widgetId: selectedWidgetId });
  };

  const handleDelete = () => {
    if (!selectedWidgetId) {
      const defaults = getDefaultWidgetSettings(selectedType);
      setDraftName(defaults.widgetName);
      setDraftSettings(defaults);
      setBaselineName(defaults.widgetName);
      setBaselineSettings(defaults);
      return;
    }

    setOptimisticDeletedIds((current) => ({ ...current, [selectedWidgetId]: true }));
    submitAction({ _intent: "delete", widgetId: selectedWidgetId });
  };

  const handleReset = () => {
    if (!selectedWidgetId) {
      const defaults = getDefaultWidgetSettings(selectedType);
      setDraftName(defaults.widgetName);
      setDraftSettings(defaults);
      setBaselineName(defaults.widgetName);
      setBaselineSettings(defaults);
      setToastState({ content: "Draft reset to defaults." });
      return;
    }

    const defaults = getDefaultWidgetSettings(selectedType);
    setDraftSettings(defaults);
    setBaselineSettings(defaults);
    submitAction({ _intent: "reset", widgetId: selectedWidgetId });
  };

  return (
    <PolarisAppProvider i18n={enTranslations}>
      <Container as="main">
        <div className={`${shellStyles.page} ${styles.page}`}>
          <header className={`${shellStyles.header} ${styles.header}`}>
            <div className={shellStyles.headerContent}>
              <p className={`${shellStyles.eyebrow} ${styles.eyebrow}`}>Imagyn Reviews</p>
              <h1 className={`${shellStyles.title} ${styles.title}`}>Widgets</h1>
              <p className={`${shellStyles.subtitle} ${styles.subtitle}`}>
                Visually tune premium storefront review widgets with a live Shopify-native preview.
              </p>
            </div>
            <InlineStack gap="200" wrap>
              <Button onClick={handleSave} loading={isMutating && fetcher.formData?.get("_intent")?.toString() === "save"} disabled={!hasUnsavedChanges}>
                Save
              </Button>
              <Button variant="secondary" onClick={handleDiscard} disabled={!hasUnsavedChanges || isMutating}>
                Discard Changes
              </Button>
              <Button variant="secondary" onClick={handleReset} disabled={isMutating}>
                Reset to Default
              </Button>
              <Button variant="secondary" onClick={handleDuplicate} disabled={isMutating}>
                Duplicate
              </Button>
              <Button variant="secondary" tone="critical" onClick={handleDelete} disabled={isMutating}>
                Delete
              </Button>
            </InlineStack>
          </header>

          {error ? <Banner tone="critical">{error}</Banner> : null}
          {actionError ? <Banner tone="critical">{actionError}</Banner> : null}

          {isLoading && !widgets.length ? (
            <Card>
              <BlockStack gap="400">
                <SkeletonDisplayText size="small" />
                <SkeletonBodyText lines={10} />
              </BlockStack>
            </Card>
          ) : (
            <div className={styles.builderLayout}>
              <div className={styles.sidebarPanel}>
                <Card>
                  <BlockStack gap="400">
                    <div>
                      <Text as="h2" variant="headingMd">
                        Widget Library
                      </Text>
                      <Text as="p" variant="bodyMd" tone="subdued">
                        Choose the presentation style to load into the live preview.
                      </Text>
                    </div>
                    <div className={styles.libraryList}>
                      {widgetLibrary.map((item) => (
                        <button
                          key={item.type}
                          type="button"
                          className={`${styles.libraryItem} ${selectedType === item.type ? styles.libraryItemActive : ""}`}
                          onClick={() => handleLibrarySelect(item)}
                        >
                          <span className={styles.libraryIcon}>{item.icon}</span>
                          <span className={styles.libraryText}>
                            <strong>{item.title}</strong>
                            <small>{item.description}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                    <Divider />
                    <div>
                      <Text as="h3" variant="headingSm">
                        Saved Widgets
                      </Text>
                    </div>
                    {effectiveWidgets.length === 0 ? (
                      <EmptyState
                        heading="No saved widgets yet"
                        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                      >
                        <p>Customize a widget from the library and save it when you are ready.</p>
                      </EmptyState>
                    ) : (
                      <BlockStack gap="200">
                        {effectiveWidgets.map((widget) => (
                          <button
                            key={widget.id}
                            type="button"
                            className={`${styles.savedWidgetItem} ${selectedWidgetId === widget.id ? styles.savedWidgetItemActive : ""}`}
                            onClick={() => applyDraftFromWidget(widget)}
                          >
                            <span>{widget.name}</span>
                            <small>{widget.type.replace(/-/g, " ")}</small>
                          </button>
                        ))}
                      </BlockStack>
                    )}
                  </BlockStack>
                </Card>
              </div>

              <div className={styles.previewPanel}>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <div>
                        <Text as="h2" variant="headingMd">
                          Live Preview
                        </Text>
                        <Text as="p" variant="bodyMd" tone="subdued">
                          Storefront simulation updates instantly as you edit settings.
                        </Text>
                      </div>
                      <Badge tone={draftSettings.enabled ? "success" : "attention"}>{draftSettings.enabled ? "Enabled" : "Disabled"}</Badge>
                    </InlineStack>
                    <WidgetPreview type={selectedType} settings={{ ...draftSettings, widgetName: draftName }} />
                  </BlockStack>
                </Card>
              </div>

              <div className={styles.settingsPanel}>
                <BlockStack gap="300">
                  <SettingsSection title="General" open={openSections.general} onToggle={() => setOpenSections((current) => ({ ...current, general: !current.general }))}>
                    <BlockStack gap="300">
                      <TextField label="Widget Name" value={draftName} onChange={setDraftName} autoComplete="off" />
                      <Checkbox label="Enable Widget" checked={draftSettings.enabled} onChange={(value) => updateSetting("enabled", value)} />
                      <Select
                        label="Widget Placement"
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
                        label="Animation"
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
                  </SettingsSection>

                  <SettingsSection title="Colors" open={openSections.colors} onToggle={() => setOpenSections((current) => ({ ...current, colors: !current.colors }))}>
                    <div className={styles.settingsGrid}>
                      <TextField label="Primary Color" value={draftSettings.primaryColor} onChange={(value) => updateSetting("primaryColor", value)} autoComplete="off" />
                      <TextField label="Accent Color" value={draftSettings.accentColor} onChange={(value) => updateSetting("accentColor", value)} autoComplete="off" />
                      <TextField label="Background" value={draftSettings.backgroundColor} onChange={(value) => updateSetting("backgroundColor", value)} autoComplete="off" />
                      <TextField label="Text Color" value={draftSettings.textColor} onChange={(value) => updateSetting("textColor", value)} autoComplete="off" />
                      <TextField label="Border Color" value={draftSettings.borderColor} onChange={(value) => updateSetting("borderColor", value)} autoComplete="off" />
                      <TextField label="Star Color" value={draftSettings.starColor} onChange={(value) => updateSetting("starColor", value)} autoComplete="off" />
                      <TextField label="Button Color" value={draftSettings.buttonColor} onChange={(value) => updateSetting("buttonColor", value)} autoComplete="off" />
                    </div>
                  </SettingsSection>

                  <SettingsSection title="Typography" open={openSections.typography} onToggle={() => setOpenSections((current) => ({ ...current, typography: !current.typography }))}>
                    <BlockStack gap="300">
                      <RangeSlider label="Heading Font Size" min={14} max={40} value={draftSettings.headingFontSize} onChange={(value) => updateSetting("headingFontSize", toNumberValue(value))} output />
                      <RangeSlider label="Body Font Size" min={12} max={22} value={draftSettings.bodyFontSize} onChange={(value) => updateSetting("bodyFontSize", toNumberValue(value))} output />
                      <Select label="Font Weight" options={[{ label: "Regular", value: "400" }, { label: "Medium", value: "500" }, { label: "Semibold", value: "600" }, { label: "Bold", value: "700" }]} value={draftSettings.fontWeight} onChange={(value) => updateSetting("fontWeight", value)} />
                      <RangeSlider label="Letter Spacing" min={0} max={4} step={0.5} value={draftSettings.letterSpacing} onChange={(value) => updateSetting("letterSpacing", toNumberValue(value))} output />
                      <RangeSlider label="Line Height" min={1} max={2} step={0.1} value={draftSettings.lineHeight} onChange={(value) => updateSetting("lineHeight", toNumberValue(value))} output />
                    </BlockStack>
                  </SettingsSection>

                  <SettingsSection title="Cards" open={openSections.cards} onToggle={() => setOpenSections((current) => ({ ...current, cards: !current.cards }))}>
                    <BlockStack gap="300">
                      <RangeSlider label="Border Radius" min={0} max={40} value={draftSettings.borderRadius} onChange={(value) => updateSetting("borderRadius", toNumberValue(value))} output />
                      <RangeSlider label="Border Width" min={0} max={4} value={draftSettings.borderWidth} onChange={(value) => updateSetting("borderWidth", toNumberValue(value))} output />
                      <Select label="Shadow" options={[{ label: "None", value: "none" }, { label: "Soft", value: "soft" }, { label: "Medium", value: "medium" }]} value={draftSettings.shadow} onChange={(value) => updateSetting("shadow", value)} />
                      <RangeSlider label="Padding" min={8} max={40} value={draftSettings.padding} onChange={(value) => updateSetting("padding", toNumberValue(value))} output />
                      <RangeSlider label="Gap" min={8} max={32} value={draftSettings.gap} onChange={(value) => updateSetting("gap", toNumberValue(value))} output />
                      <Select label="Alignment" options={[{ label: "Left", value: "left" }, { label: "Center", value: "center" }, { label: "Right", value: "right" }]} value={draftSettings.alignment} onChange={(value) => updateSetting("alignment", value)} />
                    </BlockStack>
                  </SettingsSection>

                  <SettingsSection title="Reviewer" open={openSections.reviewer} onToggle={() => setOpenSections((current) => ({ ...current, reviewer: !current.reviewer }))}>
                    <BlockStack gap="300">
                      <Checkbox label="Avatar" checked={draftSettings.showAvatar} onChange={(value) => updateSetting("showAvatar", value)} />
                      <Select label="Avatar Shape" options={[{ label: "Circle", value: "circle" }, { label: "Rounded", value: "rounded" }, { label: "Square", value: "square" }]} value={draftSettings.avatarShape} onChange={(value) => updateSetting("avatarShape", value)} />
                      <Checkbox label="Verified Badge" checked={draftSettings.showVerifiedBadge} onChange={(value) => updateSetting("showVerifiedBadge", value)} />
                      <Checkbox label="Reviewer Name" checked={draftSettings.showReviewerName} onChange={(value) => updateSetting("showReviewerName", value)} />
                      <Checkbox label="Date" checked={draftSettings.showDate} onChange={(value) => updateSetting("showDate", value)} />
                      <Checkbox label="Country" checked={draftSettings.showCountry} onChange={(value) => updateSetting("showCountry", value)} />
                    </BlockStack>
                  </SettingsSection>

                  <SettingsSection title="Stars" open={openSections.stars} onToggle={() => setOpenSections((current) => ({ ...current, stars: !current.stars }))}>
                    <BlockStack gap="300">
                      <RangeSlider label="Star Size" min={12} max={28} value={draftSettings.starSize} onChange={(value) => updateSetting("starSize", toNumberValue(value))} output />
                      <TextField label="Star Color" value={draftSettings.starColor} onChange={(value) => updateSetting("starColor", value)} autoComplete="off" />
                      <Checkbox label="Filled" checked={draftSettings.starFilled} onChange={(value) => updateSetting("starFilled", value)} />
                      <Checkbox label="Outline" checked={draftSettings.starOutline} onChange={(value) => updateSetting("starOutline", value)} />
                    </BlockStack>
                  </SettingsSection>

                  <SettingsSection title="Buttons" open={openSections.buttons} onToggle={() => setOpenSections((current) => ({ ...current, buttons: !current.buttons }))}>
                    <BlockStack gap="300">
                      <Checkbox label="Load More" checked={draftSettings.showLoadMoreButton} onChange={(value) => updateSetting("showLoadMoreButton", value)} />
                      <Checkbox label="Write Review" checked={draftSettings.showWriteReviewButton} onChange={(value) => updateSetting("showWriteReviewButton", value)} />
                      <RangeSlider label="Button Radius" min={0} max={999} value={draftSettings.buttonRadius} onChange={(value) => updateSetting("buttonRadius", toNumberValue(value))} output />
                      <Select label="Button Style" options={[{ label: "Solid", value: "solid" }, { label: "Outline", value: "outline" }, { label: "Ghost", value: "ghost" }]} value={draftSettings.buttonStyle} onChange={(value) => updateSetting("buttonStyle", value)} />
                    </BlockStack>
                  </SettingsSection>

                  <SettingsSection title="Spacing" open={openSections.spacing} onToggle={() => setOpenSections((current) => ({ ...current, spacing: !current.spacing }))}>
                    <BlockStack gap="300">
                      <RangeSlider label="Container Width" min={280} max={1200} value={draftSettings.containerWidth} onChange={(value) => updateSetting("containerWidth", toNumberValue(value))} output />
                      <RangeSlider label="Card Width" min={220} max={420} value={draftSettings.cardWidth} onChange={(value) => updateSetting("cardWidth", toNumberValue(value))} output />
                      <RangeSlider label="Margins" min={0} max={48} value={draftSettings.margins} onChange={(value) => updateSetting("margins", toNumberValue(value))} output />
                      <RangeSlider label="Vertical Spacing" min={8} max={32} value={draftSettings.verticalSpacing} onChange={(value) => updateSetting("verticalSpacing", toNumberValue(value))} output />
                    </BlockStack>
                  </SettingsSection>

                  <SettingsSection title="Advanced" open={openSections.advanced} onToggle={() => setOpenSections((current) => ({ ...current, advanced: !current.advanced }))}>
                    <BlockStack gap="300">
                      <TextField label="Custom CSS" value={draftSettings.customCss} onChange={(value) => updateSetting("customCss", value)} autoComplete="off" multiline={6} />
                      <Checkbox label="Enable Animations" checked={draftSettings.enableAnimations} onChange={(value) => updateSetting("enableAnimations", value)} />
                      <Checkbox label="Dark Mode" checked={draftSettings.darkMode} onChange={(value) => updateSetting("darkMode", value)} />
                    </BlockStack>
                  </SettingsSection>
                </BlockStack>
              </div>
            </div>
          )}
        </div>
      </Container>
      <Frame>
        {toastState ? <Toast content={toastState.content} error={toastState.error} onDismiss={() => setToastState(null)} /> : null}
      </Frame>
    </PolarisAppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
