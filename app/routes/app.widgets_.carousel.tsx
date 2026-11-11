import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { getCarouselCustomization, saveCarouselCustomization } from "../services/widget.server";
import {
  CAROUSEL_LIMITS,
  CAROUSEL_PRESETS,
  DEFAULT_CAROUSEL_SETTINGS,
  applyCarouselPreset,
  carouselCssVariables,
  normalizeCarouselSettings,
  type CarouselSettings,
} from "../services/carouselSettings.shared";
import { CarouselPreviewCard, type PreviewReview } from "../components/carousel/CarouselPreviewCard";
import { Container } from "../components/ui/Container";
import { ContextualSaveBar } from "../components/ui/ContextualSaveBar";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.widgets.carousel.module.css";

/*
 * Filename note: the underscore in `app.widgets_.carousel` is load-bearing.
 *
 * Without it this file is a CHILD of app.widgets.tsx, which renders no <Outlet/>, so
 * /app/widgets/carousel matched the parent and silently rendered the Widgets list instead of
 * this screen — including on a direct hard refresh. The trailing underscore opts out of that
 * parent layout while keeping the same URL, which is the convention app.products_.$id.tsx and
 * app.reviews_.new.tsx already use here.
 *
 * Worth knowing: the preview harness renders route components directly and therefore cannot
 * catch this class of bug. It only showed up in the real embedded app.
 */
type LoaderData = {
  settings: CarouselSettings;
  reviews: PreviewReview[];
  usingSampleData: boolean;
};

/**
 * Preview reviews, drawn from the merchant's own approved reviews when they have any.
 *
 * The sample set below is only used by a store with nothing published yet, and is written to
 * exercise the cases that actually break a carousel layout: a text-only review, a single
 * image, several images, a video, a very long body and a low rating. A preview that only ever
 * shows one tidy five-star review with one square photo is how layout bugs reach production.
 */
const SAMPLE_REVIEWS: PreviewReview[] = [
  {
    id: "sample-1",
    title: "Exactly what I hoped for",
    body: "Arrived two days early and the finish is lovely — photos genuinely do not do it justice. I have already ordered a second one for my sister's birthday next month.",
    rating: 5,
    reviewerName: "Amelia R.",
    date: "2 days ago",
    productName: "Brown Ceramic Plate",
    verified: true,
    images: ["/assets/preview/review-1.svg"],
    hasVideo: false,
  },
  {
    id: "sample-2",
    title: "Good, with one caveat",
    body: "Comfortable and well made. The sizing runs a little small, so size up if you are between sizes.",
    rating: 4,
    reviewerName: "Jonas P.",
    date: "1 week ago",
    productName: "Glacier Merino Hoodie",
    verified: true,
    images: [],
    hasVideo: false,
  },
  {
    id: "sample-3",
    title: "Beautiful set",
    body: "Bought these for a dinner party and they were the thing everyone commented on. The glaze has a depth to it that is hard to photograph, though I have tried — see below. Washing has not dulled them at all after a month of regular use, which is more than I can say for the last set I owned.",
    rating: 5,
    reviewerName: "Priya N.",
    date: "3 weeks ago",
    productName: "Atlas Linen Bedding Set",
    verified: true,
    images: ["/assets/preview/review-2.svg", "/assets/preview/review-3.svg", "/assets/preview/review-1.svg"],
    hasVideo: true,
  },
  {
    id: "sample-4",
    title: "Not for me",
    body: "Quality is fine but the colour is noticeably warmer than it looks on screen.",
    rating: 3,
    reviewerName: "Dana K.",
    date: "1 month ago",
    productName: "Cirrus Ambient Lamp",
    verified: false,
    images: ["/assets/preview/review-2.svg"],
    hasVideo: false,
  },
];

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const [settings, prisma] = await Promise.all([
    getCarouselCustomization(store.id),
    import("../db.server").then((m) => m.default),
  ]);

  const rows = await prisma.review.findMany({
    where: { storeId: store.id, status: "APPROVED", deletedAt: null, archivedAt: null },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true,
      title: true,
      content: true,
      rating: true,
      reviewerName: true,
      createdAt: true,
      verifiedPurchase: true,
      productTitle: true,
      product: { select: { name: true } },
      media: { select: { url: true, type: true } },
    },
  });

  const reviews: PreviewReview[] = rows.map((row) => ({
    id: row.id,
    title: row.title ?? "",
    body: row.content,
    rating: row.rating,
    reviewerName: row.reviewerName,
    date: row.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
    productName: row.product?.name ?? row.productTitle ?? "",
    verified: row.verifiedPurchase,
    images: row.media.filter((m) => m.type !== "VIDEO").map((m) => m.url),
    hasVideo: row.media.some((m) => m.type === "VIDEO"),
  }));

  return {
    settings,
    reviews: reviews.length > 0 ? reviews : SAMPLE_REVIEWS,
    usingSampleData: reviews.length === 0,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const formData = await request.formData();
  const raw = String(formData.get("settings") || "{}");

  let parsed: unknown = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false as const, error: "Could not read those settings." };
  }

  // Normalized again here, not just in the browser: the form is a convenience, not a
  // trust boundary.
  const saved = await saveCarouselCustomization(store.id, parsed);
  return { ok: true as const, settings: saved };
};

type Viewport = "desktop" | "tablet" | "mobile";

const VIEWPORT_WIDTH: Record<Viewport, number> = { desktop: 980, tablet: 680, mobile: 390 };

function cardsForViewport(settings: CarouselSettings, viewport: Viewport): number {
  if (viewport === "mobile") return settings.cardsMobile;
  if (viewport === "tablet") return settings.cardsTablet;
  return settings.cardsDesktop;
}

/* ------------------------------------------------------------------ small control primitives */

function Group({ title, summary, children, defaultOpen = false }: { title: string; summary: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details className={styles.group} open={defaultOpen}>
      <summary className={styles.groupSummary}>
        <span>
          <span className={styles.groupTitle}>{title}</span>
          <span className={styles.groupHint}>{summary}</span>
        </span>
        <span className={styles.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.groupBody}>{children}</div>
    </details>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className={styles.row}>
      <span className={styles.rowLabel}>
        {label}
        {hint ? <span className={styles.rowHint}>{hint}</span> : null}
      </span>
      <span className={styles.rowControl}>{children}</span>
    </label>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <input type="checkbox" className={styles.toggle} checked={checked} onChange={(e) => onChange(e.target.checked)} />
  );
}

function Select<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (next: T) => void }) {
  return (
    <select className={styles.select} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

function Slider({
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (next: number) => void;
}) {
  return (
    <span className={styles.slider}>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output className={styles.sliderValue}>
        {value}
        {suffix}
      </output>
    </span>
  );
}

function Color({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <span className={styles.color}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Colour" />
      <code>{value}</code>
    </span>
  );
}

/* --------------------------------------------------------------------------------- the screen */

export default function CarouselCustomizePage() {
  const { settings: persisted, reviews, usingSampleData } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const [draft, setDraft] = useState<CarouselSettings>(persisted);
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [savedSettings, setSavedSettings] = useState<CarouselSettings>(persisted);

  useEffect(() => {
    if (fetcher.data && "ok" in fetcher.data && fetcher.data.ok && fetcher.data.settings) {
      setSavedSettings(fetcher.data.settings);
      setDraft(fetcher.data.settings);
    }
  }, [fetcher.data]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(savedSettings), [draft, savedSettings]);
  const saving = fetcher.state !== "idle";

  const set = <K extends keyof CarouselSettings>(key: K, value: CarouselSettings[K]) =>
    setDraft((current) => normalizeCarouselSettings({ ...current, [key]: value }));

  const save = () => {
    const form = new FormData();
    form.set("settings", JSON.stringify(draft));
    fetcher.submit(form, { method: "post" });
  };

  const previewVars = carouselCssVariables(draft) as CSSProperties;
  const visibleCards = cardsForViewport(draft, viewport);

  // The preview frame is always its true viewport width — 980/680/390 — and is scaled down
  // uniformly when the dashboard column is narrower than that. Scaling rather than reflowing
  // matters: a preview that squeezed 980px of cards into 700px would be showing a layout the
  // storefront never produces, which is the one thing a preview must not do.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const frameWidth = VIEWPORT_WIDTH[viewport];

  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const available = stage.clientWidth - 32;
    setScale(Math.min(1, available / frameWidth));
  }, [frameWidth]);

  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (stageRef.current) observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <Container as="main">
      <div className={`${shellStyles.page} ${shellStyles.reveal}`}>
        <header className={styles.topBar}>
          <div>
            <nav className={styles.breadcrumb} aria-label="Breadcrumb">
              <a href="/app/widgets">Widgets</a>
              <span aria-hidden="true">/</span>
              <span>Review Carousel</span>
            </nav>
            <h1 className={shellStyles.title}>Customize Review Carousel</h1>
            <p className={shellStyles.subtitle}>
              {usingSampleData
                ? "Previewing with sample reviews — your own reviews appear here once you have approved some."
                : "Previewing with your own approved reviews."}
            </p>
          </div>

          <div className={styles.topActions}>
            <span className={dirty ? styles.statusDirty : styles.statusSaved}>
              {dirty ? "Unsaved changes" : "All changes saved"}
            </span>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setDraft(DEFAULT_CAROUSEL_SETTINGS)}
              disabled={saving}
            >
              Reset to default
            </button>
            <button type="button" className={styles.primaryButton} onClick={save} disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </header>

        <div className={styles.layout}>
          {/* ------------------------------------------------------------------ controls */}
          <section className={styles.controls} aria-label="Carousel settings">
            <Group title="Presets" summary="A starting point you can then change" defaultOpen>
              <div className={styles.presets}>
                {CAROUSEL_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={styles.preset}
                    onClick={() => setDraft(applyCarouselPreset(draft, preset.id))}
                  >
                    <span className={styles.presetName}>{preset.name}</span>
                    <span className={styles.presetDescription}>{preset.description}</span>
                  </button>
                ))}
              </div>
            </Group>

            <Group title="Images" summary="Placement, size, shape and fit">
              <Row label="Show images">
                <Select
                  value={draft.imageVisibility}
                  onChange={(v) => set("imageVisibility", v)}
                  options={[
                    ["when-present", "Only when the review has media"],
                    ["always", "Always (placeholder if none)"],
                    ["never", "Never — text only"],
                  ]}
                />
              </Row>
              <Row label="Position">
                <Select
                  value={draft.imagePosition}
                  onChange={(v) => set("imagePosition", v)}
                  options={[
                    ["above", "Above the text"],
                    ["below", "Below the text"],
                    ["left", "Left of the text"],
                    ["right", "Right of the text"],
                    ["background", "Card background"],
                  ]}
                />
              </Row>
              <Row label="Size">
                <Select
                  value={draft.imageSize}
                  onChange={(v) => set("imageSize", v)}
                  options={[
                    ["small", "Small"],
                    ["medium", "Medium"],
                    ["large", "Large"],
                    ["custom", "Custom height"],
                  ]}
                />
              </Row>
              {draft.imageSize === "custom" ? (
                <Row label="Custom height">
                  <Slider
                    value={draft.imageCustomHeight}
                    min={CAROUSEL_LIMITS.imageCustomHeight.min}
                    max={CAROUSEL_LIMITS.imageCustomHeight.max}
                    suffix="px"
                    onChange={(v) => set("imageCustomHeight", v)}
                  />
                </Row>
              ) : null}
              <Row label="Aspect ratio">
                <Select
                  value={draft.imageAspectRatio}
                  onChange={(v) => set("imageAspectRatio", v)}
                  options={[
                    ["original", "Original"],
                    ["square", "Square 1:1"],
                    ["portrait", "Portrait 4:5"],
                    ["landscape", "Landscape 16:9"],
                  ]}
                />
              </Row>
              <Row label="Fit" hint="Cover crops, contain letterboxes — neither distorts">
                <Select
                  value={draft.imageFit}
                  onChange={(v) => set("imageFit", v)}
                  options={[
                    ["cover", "Cover"],
                    ["contain", "Contain"],
                  ]}
                />
              </Row>
              <Row label="Corner radius">
                <Slider value={draft.imageRadius} min={0} max={CAROUSEL_LIMITS.imageRadius.max} suffix="px" onChange={(v) => set("imageRadius", v)} />
              </Row>
              <Row label="Border width">
                <Slider value={draft.imageBorderWidth} min={0} max={CAROUSEL_LIMITS.imageBorderWidth.max} suffix="px" onChange={(v) => set("imageBorderWidth", v)} />
              </Row>
              <Row label="Border colour">
                <Color value={draft.imageBorderColor} onChange={(v) => set("imageBorderColor", v)} />
              </Row>
              <Row label="Spacing below image">
                <Slider value={draft.imageSpacing} min={0} max={CAROUSEL_LIMITS.imageSpacing.max} suffix="px" onChange={(v) => set("imageSpacing", v)} />
              </Row>
              <Row label="Zoom on hover">
                <Toggle checked={draft.imageHoverZoom} onChange={(v) => set("imageHoverZoom", v)} />
              </Row>
            </Group>

            <Group title="Content" summary="What each card shows">
              {(
                [
                  ["showRating", "Star rating"],
                  ["showTitle", "Review title"],
                  ["showBody", "Review text"],
                  ["showReviewerName", "Reviewer name"],
                  ["showVerifiedBadge", "Verified buyer badge"],
                  ["showDate", "Review date"],
                  ["showProductName", "Product name"],
                  ["showProductImage", "Product image"],
                  ["showMedia", "Review photos and video"],
                ] as Array<[keyof CarouselSettings, string]>
              ).map(([key, label]) => (
                <Row key={key} label={label}>
                  <Toggle checked={draft[key] as boolean} onChange={(v) => set(key, v as never)} />
                </Row>
              ))}
              <Row label="Verified badge style">
                <Select
                  value={draft.verifiedBadgeStyle}
                  onChange={(v) => set("verifiedBadgeStyle", v)}
                  options={[
                    ["both", "Icon and text"],
                    ["icon", "Icon only"],
                    ["text", "Text only"],
                  ]}
                />
              </Row>
            </Group>

            <Group title="Typography" summary="Font, sizes, colour and alignment">
              <Row label="Font">
                <Select
                  value={draft.fontFamily}
                  onChange={(v) => set("fontFamily", v)}
                  options={[
                    ["theme", "Use my theme's font"],
                    ["system", "System sans"],
                    ["serif", "Serif"],
                  ]}
                />
              </Row>
              <Row label="Title size">
                <Slider value={draft.titleFontSize} min={CAROUSEL_LIMITS.titleFontSize.min} max={CAROUSEL_LIMITS.titleFontSize.max} suffix="px" onChange={(v) => set("titleFontSize", v)} />
              </Row>
              <Row label="Body size">
                <Slider value={draft.bodyFontSize} min={CAROUSEL_LIMITS.bodyFontSize.min} max={CAROUSEL_LIMITS.bodyFontSize.max} suffix="px" onChange={(v) => set("bodyFontSize", v)} />
              </Row>
              <Row label="Name size">
                <Slider value={draft.nameFontSize} min={CAROUSEL_LIMITS.nameFontSize.min} max={CAROUSEL_LIMITS.nameFontSize.max} suffix="px" onChange={(v) => set("nameFontSize", v)} />
              </Row>
              <Row label="Weight">
                <Select
                  value={draft.fontWeight}
                  onChange={(v) => set("fontWeight", v)}
                  options={[
                    ["regular", "Regular"],
                    ["medium", "Medium"],
                    ["semibold", "Semibold"],
                  ]}
                />
              </Row>
              <Row label="Line height">
                <Slider value={draft.lineHeight} min={CAROUSEL_LIMITS.lineHeight.min} max={CAROUSEL_LIMITS.lineHeight.max} step={0.1} onChange={(v) => set("lineHeight", v)} />
              </Row>
              <Row label="Text colour">
                <Color value={draft.textColor} onChange={(v) => set("textColor", v)} />
              </Row>
              <Row label="Secondary text colour">
                <Color value={draft.mutedTextColor} onChange={(v) => set("mutedTextColor", v)} />
              </Row>
              <Row label="Alignment">
                <Select
                  value={draft.textAlign}
                  onChange={(v) => set("textAlign", v)}
                  options={[
                    ["left", "Left"],
                    ["center", "Centre"],
                    ["right", "Right"],
                  ]}
                />
              </Row>
            </Group>

            <Group title="Review text" summary="Length, truncation and spacing">
              <Row label="Show">
                <Select
                  value={draft.textDisplay}
                  onChange={(v) => set("textDisplay", v)}
                  options={[
                    ["truncate", "Shortened"],
                    ["full", "Full review"],
                  ]}
                />
              </Row>
              {draft.textDisplay === "truncate" ? (
                <>
                  <Row label="Maximum lines">
                    <Slider value={draft.maxLines} min={CAROUSEL_LIMITS.maxLines.min} max={CAROUSEL_LIMITS.maxLines.max} onChange={(v) => set("maxLines", v)} />
                  </Row>
                  <Row label="Read more link">
                    <Toggle checked={draft.readMore} onChange={(v) => set("readMore", v)} />
                  </Row>
                </>
              ) : null}
              <Row label="Spacing between elements">
                <Slider value={draft.contentSpacing} min={CAROUSEL_LIMITS.contentSpacing.min} max={CAROUSEL_LIMITS.contentSpacing.max} suffix="px" onChange={(v) => set("contentSpacing", v)} />
              </Row>
            </Group>

            <Group title="Card" summary="Shape, colour, border, shadow and spacing">
              <Row label="Corner radius">
                <Slider value={draft.cardRadius} min={0} max={CAROUSEL_LIMITS.cardRadius.max} suffix="px" onChange={(v) => set("cardRadius", v)} />
              </Row>
              <Row label="Background">
                <Color value={draft.cardBackground} onChange={(v) => set("cardBackground", v)} />
              </Row>
              <Row label="Border style">
                <Select
                  value={draft.cardBorderStyle}
                  onChange={(v) => set("cardBorderStyle", v)}
                  options={[
                    ["solid", "Solid"],
                    ["dashed", "Dashed"],
                    ["none", "None"],
                  ]}
                />
              </Row>
              {draft.cardBorderStyle !== "none" ? (
                <>
                  <Row label="Border width">
                    <Slider value={draft.cardBorderWidth} min={0} max={CAROUSEL_LIMITS.cardBorderWidth.max} suffix="px" onChange={(v) => set("cardBorderWidth", v)} />
                  </Row>
                  <Row label="Border colour">
                    <Color value={draft.cardBorderColor} onChange={(v) => set("cardBorderColor", v)} />
                  </Row>
                </>
              ) : null}
              <Row label="Shadow">
                <Select
                  value={draft.cardShadow}
                  onChange={(v) => set("cardShadow", v)}
                  options={[
                    ["none", "None"],
                    ["subtle", "Subtle"],
                    ["medium", "Medium"],
                    ["strong", "Strong"],
                  ]}
                />
              </Row>
              <Row label="Padding">
                <Slider value={draft.cardPadding} min={0} max={CAROUSEL_LIMITS.cardPadding.max} suffix="px" onChange={(v) => set("cardPadding", v)} />
              </Row>
              <Row label="Minimum height" hint="0 lets cards size to their content">
                <Slider value={draft.cardMinHeight} min={0} max={CAROUSEL_LIMITS.cardMinHeight.max} step={10} suffix="px" onChange={(v) => set("cardMinHeight", v)} />
              </Row>
              <Row label="Equal height cards">
                <Toggle checked={draft.equalHeight} onChange={(v) => set("equalHeight", v)} />
              </Row>
              <Row label="Star colour">
                <Color value={draft.starColor} onChange={(v) => set("starColor", v)} />
              </Row>
              <Row label="Hover effect">
                <Select
                  value={draft.hoverEffect}
                  onChange={(v) => set("hoverEffect", v)}
                  options={[
                    ["none", "None"],
                    ["lift", "Lift"],
                    ["zoom", "Zoom"],
                  ]}
                />
              </Row>
              <Row label="Transition">
                <Slider value={draft.transitionMs} min={0} max={CAROUSEL_LIMITS.transitionMs.max} step={20} suffix="ms" onChange={(v) => set("transitionMs", v)} />
              </Row>
            </Group>

            <Group title="Layout and behaviour" summary="Cards per screen, navigation and autoplay">
              <Row label="Cards — desktop">
                <Slider value={draft.cardsDesktop} min={1} max={CAROUSEL_LIMITS.cardsDesktop.max} onChange={(v) => set("cardsDesktop", v)} />
              </Row>
              <Row label="Cards — tablet">
                <Slider value={draft.cardsTablet} min={1} max={CAROUSEL_LIMITS.cardsTablet.max} onChange={(v) => set("cardsTablet", v)} />
              </Row>
              <Row label="Cards — mobile">
                <Slider value={draft.cardsMobile} min={1} max={CAROUSEL_LIMITS.cardsMobile.max} onChange={(v) => set("cardsMobile", v)} />
              </Row>
              <Row label="Gap between cards">
                <Slider value={draft.cardGap} min={0} max={CAROUSEL_LIMITS.cardGap.max} suffix="px" onChange={(v) => set("cardGap", v)} />
              </Row>
              <Row label="Autoplay">
                <Toggle checked={draft.autoplay} onChange={(v) => set("autoplay", v)} />
              </Row>
              {draft.autoplay ? (
                <Row label="Autoplay interval">
                  <Slider value={draft.autoplaySpeed} min={CAROUSEL_LIMITS.autoplaySpeed.min} max={CAROUSEL_LIMITS.autoplaySpeed.max} suffix="s" onChange={(v) => set("autoplaySpeed", v)} />
                </Row>
              ) : null}
              <Row label="Loop infinitely">
                <Toggle checked={draft.loop} onChange={(v) => set("loop", v)} />
              </Row>
              <Row label="Navigation arrows">
                <Toggle checked={draft.showArrows} onChange={(v) => set("showArrows", v)} />
              </Row>
              {draft.showArrows ? (
                <Row label="Arrow position">
                  <Select
                    value={draft.arrowPosition}
                    onChange={(v) => set("arrowPosition", v)}
                    options={[
                      ["inside", "Inside the track"],
                      ["outside", "Outside the track"],
                    ]}
                  />
                </Row>
              ) : null}
              <Row label="Pagination dots">
                <Toggle checked={draft.showDots} onChange={(v) => set("showDots", v)} />
              </Row>
              {draft.showDots ? (
                <Row label="Dot style">
                  <Select
                    value={draft.dotStyle}
                    onChange={(v) => set("dotStyle", v)}
                    options={[
                      ["dot", "Dots"],
                      ["bar", "Bars"],
                    ]}
                  />
                </Row>
              ) : null}
              <Row label="Slide animation">
                <Slider value={draft.animationMs} min={0} max={CAROUSEL_LIMITS.animationMs.max} step={50} suffix="ms" onChange={(v) => set("animationMs", v)} />
              </Row>
              <Row label="Swipe and drag">
                <Toggle checked={draft.swipe} onChange={(v) => set("swipe", v)} />
              </Row>
            </Group>
          </section>

          {/* ------------------------------------------------------------------- preview */}
          <section className={styles.previewPane} aria-label="Live preview">
            <div className={styles.previewToolbar} role="group" aria-label="Preview size">
              {(["desktop", "tablet", "mobile"] as Viewport[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={viewport === option ? styles.viewportActive : styles.viewport}
                  onClick={() => setViewport(option)}
                  aria-pressed={viewport === option}
                >
                  {option[0].toUpperCase() + option.slice(1)}
                </button>
              ))}
              <span className={styles.previewWidth}>{VIEWPORT_WIDTH[viewport]}px</span>
            </div>

            <div className={styles.previewStage} ref={stageRef}>
              <div
                className={styles.previewScaler}
                style={{ width: frameWidth * scale, height: scale < 1 ? undefined : undefined }}
              >
              <div
                className={styles.previewFrame}
                style={{ width: frameWidth, transform: `scale(${scale})`, ...previewVars }}
              >
                {draft.showArrows && draft.arrowPosition === "outside" ? (
                  <span className={styles.arrowOutside} aria-hidden="true">
                    ‹
                  </span>
                ) : null}

                <div className={styles.previewTrack} data-imagyn-carousel-track>
                  {reviews.slice(0, Math.max(visibleCards, 1) + 1).map((review) => (
                    <div
                      key={review.id}
                      className={styles.previewSlide}
                      style={{ flexBasis: `calc((100% - ${(visibleCards - 1) * draft.cardGap}px) / ${visibleCards})` }}
                    >
                      <CarouselPreviewCard review={review} settings={draft} />
                    </div>
                  ))}
                </div>

                {draft.showArrows && draft.arrowPosition === "inside" ? (
                  <>
                    <span className={`${styles.arrowInside} ${styles.arrowLeft}`} aria-hidden="true">
                      ‹
                    </span>
                    <span className={`${styles.arrowInside} ${styles.arrowRight}`} aria-hidden="true">
                      ›
                    </span>
                  </>
                ) : null}

                {draft.showDots ? (
                  <div className={styles.dots} aria-hidden="true">
                    {[0, 1, 2].map((dot) => (
                      <span key={dot} className={draft.dotStyle === "bar" ? styles.dotBar : styles.dot} data-active={dot === 0} />
                    ))}
                  </div>
                ) : null}
              </div>
              </div>
            </div>

            <p className={styles.previewNote}>
              The preview and the storefront widget are driven by the same values, so what you see here is what the
              block renders. Autoplay and swipe are not simulated in the preview.
            </p>
          </section>
        </div>
      </div>

      <ContextualSaveBar id="carousel-save-bar" open={dirty} onSave={save} onDiscard={() => setDraft(savedSettings)} saving={saving} />
    </Container>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
