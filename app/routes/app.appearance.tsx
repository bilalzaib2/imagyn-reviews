import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { RangeSlider, Select, TextField, Frame, Toast } from "@shopify/polaris";

import { Button } from "../components/ui/Button";
import { Container } from "../components/ui/Container";
import { Section } from "../components/ui/Section";
import { authenticate } from "../shopify.server";
import { getOrCreateStore } from "../services/store.server";
import { appearanceService } from "../services/appearance.server";
import { appearancePresets, type AppearancePresetDefinition } from "../services/appearance.presets";
import {
  getDefaultAppearanceTokens,
  mergeAppearanceTokens,
  type AppearancePreset,
  type AppearanceTokens,
} from "../services/appearance.shared";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.appearance.module.css";

type LoaderData = {
  tokens: AppearanceTokens;
  preset: AppearancePreset;
};

type ActionData = {
  ok: boolean;
  error?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticate.admin(request);
  const store = await getOrCreateStore(session.shop);
  const active = await appearanceService.getActive(store.id);

  return {
    tokens: active?.tokens ?? getDefaultAppearanceTokens(),
    preset: active?.preset ?? "editorial",
  };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session } = await authenticate.admin(request);
  const store = await getOrCreateStore(session.shop);

  const formData = await request.formData();

  try {
    const tokens = JSON.parse(String(formData.get("tokens") || "{}")) as AppearanceTokens;
    const preset = String(formData.get("preset") || "custom") as AppearancePreset;
    await appearanceService.upsertActive(store.id, { tokens, preset });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to save. Please try again." };
  }
};

// A merchant should never have to read or type rgba(...) — but the underlying default for
// a couple of tokens (border, empty star) is a transparent black overlay so it adapts to
// any theme background, which a plain hex value can't do. This approximates that overlay
// as a flat hex over white purely for display in the swatch/text field; the moment a
// merchant actually edits the field, the stored value becomes a real hex color like any
// other — the same tradeoff Accent Color already makes with its own fixed hex default.
function toDisplayHex(value: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    return value;
  }

  const match = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)/);
  if (!match) {
    return "#cccccc";
  }

  const alpha = match[4] !== undefined ? parseFloat(match[4]) : 1;
  const blend = (channel: string) => Math.round(Number(channel) * alpha + 255 * (1 - alpha));
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(blend(match[1]))}${toHex(blend(match[2]))}${toHex(blend(match[3]))}`;
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const displayValue = toDisplayHex(value);

  return (
    <div className={styles.colorField}>
      <span className={styles.colorFieldLabel}>{label}</span>
      <div className={styles.colorFieldControl}>
        <input
          type="color"
          className={styles.colorSwatchInput}
          value={displayValue}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`${label} color`}
        />
        <TextField label={label} labelHidden value={displayValue} onChange={onChange} autoComplete="off" />
      </div>
    </div>
  );
}

function ValueSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className={styles.valueSlider}>
      <div className={styles.valueSliderHeader}>
        <span className={styles.valueSliderLabel}>{label}</span>
        <span className={styles.valueSliderValue}>{format(value)}</span>
      </div>
      <RangeSlider
        label={label}
        labelHidden
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(next) => onChange(Array.isArray(next) ? next[0] : next)}
      />
    </div>
  );
}

function GroupLabel({ children }: { children: string }) {
  return <p className={styles.groupLabel}>{children}</p>;
}

function ReservedNote({ label }: { label: string }) {
  return (
    <div className={styles.reservedNote}>
      <span>{label}</span>
      <span className={styles.comingSoonTag}>Coming later</span>
    </div>
  );
}

export default function AppearancePage() {
  const { tokens: initialTokens, preset: initialPreset } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const isSaving = fetcher.state !== "idle";

  const [draftTokens, setDraftTokens] = useState<AppearanceTokens>(initialTokens);
  const [baselineTokens, setBaselineTokens] = useState<AppearanceTokens>(initialTokens);
  const [preset, setPreset] = useState<AppearancePreset>(initialPreset);
  const [toastState, setToastState] = useState<{ content: string; error?: boolean } | null>(null);

  const previewFrameRef = useRef<HTMLIFrameElement>(null);

  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(draftTokens) !== JSON.stringify(baselineTokens),
    [draftTokens, baselineTokens],
  );

  // Instant reactivity via the exact same code path the real storefront uses
  // (imagyn-appearance.js), not a second preview implementation — see
  // app/routes/appearance-preview.tsx.
  useEffect(() => {
    previewFrameRef.current?.contentWindow?.postMessage(
      { source: "imagyn-appearance-draft", tokens: draftTokens },
      "*",
    );
  }, [draftTokens]);

  useEffect(() => {
    if (!fetcher.data) return;
    if (!fetcher.data.ok) {
      setToastState({ content: fetcher.data.error || "Unable to save. Please try again.", error: true });
      return;
    }
    setToastState({ content: "Saved. Your storefront now reflects these changes." });
    setBaselineTokens(draftTokens);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const update = <C extends keyof AppearanceTokens>(category: C, patch: Partial<AppearanceTokens[C]>) => {
    setPreset("custom");
    setDraftTokens((current) => ({ ...current, [category]: { ...current[category], ...patch } }));
  };

  // A Widget Style preset only carries structural categories (typography scale, spacing,
  // corners, borders, buttons, card treatment) — never `colors`, so switching styles never
  // overwrites the merchant's own Accent Color. mergeAppearanceTokens's second argument
  // (base) is the current draft, not the documented defaults, for exactly that reason.
  const handlePresetSelect = (definition: AppearancePresetDefinition) => {
    setPreset(definition.id);
    if (definition.tokens) {
      setDraftTokens((current) => mergeAppearanceTokens(definition.tokens, current));
    }
  };

  const handleSave = () => {
    const formData = new FormData();
    formData.append("tokens", JSON.stringify(draftTokens));
    formData.append("preset", preset);
    fetcher.submit(formData, { method: "post" });
  };

  const handleDiscard = () => {
    setDraftTokens(baselineTokens);
  };

  const isBoxed = draftTokens.reviewCards.separator === "boxed";

  return (
    <>
      <Container as="main">
        <div className={`${shellStyles.page} ${styles.page}`}>
          <header className={shellStyles.header}>
            <div className={shellStyles.headerContent}>
              <p className={shellStyles.eyebrow}>Imagyn Reviews</p>
              <h1 className={shellStyles.title}>Brand Studio</h1>
              <p className={shellStyles.subtitle}>
                Design how reviews look on your storefront — no code, no theme editing. Changes preview instantly
                on the right and apply the moment you save.
              </p>
            </div>
          </header>

          <div className={styles.layout}>
            <div className={styles.settingsColumn}>
              <GroupLabel>Style</GroupLabel>

              <Section title="Widget Style" description="Start from a look, then fine-tune anything below.">
                <div className={styles.presetGrid}>
                  {appearancePresets.map((definition) =>
                    definition.available ? (
                      <button
                        key={definition.id}
                        type="button"
                        className={`${styles.presetCard} ${preset === definition.id ? styles.presetCardActive : ""}`}
                        onClick={() => handlePresetSelect(definition)}
                      >
                        <span className={styles.presetCardLabel}>{definition.label}</span>
                        <span className={styles.presetCardDescription}>{definition.description}</span>
                      </button>
                    ) : (
                      <span key={definition.id} className={`${styles.presetCard} ${styles.presetCardDisabled}`}>
                        <span className={styles.presetCardLabel}>{definition.label}</span>
                        <span className={styles.comingSoonTag}>Soon</span>
                      </span>
                    ),
                  )}
                </div>
              </Section>

              <Section title="Button Style" description="How buttons appear across your reviews.">
                <Select
                  label="Style"
                  labelHidden
                  options={[
                    { label: "Filled", value: "solid" },
                    { label: "Outline", value: "outline" },
                    { label: "Ghost", value: "ghost" },
                  ]}
                  value={draftTokens.buttons.style}
                  onChange={(value) => update("buttons", { style: value as "solid" | "outline" | "ghost" })}
                />
              </Section>

              <Section title="Border Radius" description="Sharp to soft — how rounded corners feel.">
                <ValueSlider
                  label="Border radius"
                  min={0}
                  max={24}
                  step={1}
                  value={draftTokens.corners.radius}
                  format={(value) => `${value}px`}
                  onChange={(value) => update("corners", { radius: value })}
                />
              </Section>

              <GroupLabel>Typography</GroupLabel>

              <Section title="Text Size" description="Make review text larger or smaller.">
                <ValueSlider
                  label="Text size"
                  min={0.9}
                  max={1.15}
                  step={0.01}
                  value={draftTokens.typography.scale}
                  format={(value) => `${Math.round(value * 100)}%`}
                  onChange={(value) => update("typography", { scale: value })}
                />
              </Section>

              <Section title="Letter Spacing" description="Tight feels compact; Normal feels relaxed.">
                <Select
                  label="Letter spacing"
                  labelHidden
                  options={[
                    { label: "Tight", value: "tight" },
                    { label: "Normal", value: "normal" },
                  ]}
                  value={draftTokens.typography.letterSpacing}
                  onChange={(value) => update("typography", { letterSpacing: value as "tight" | "normal" })}
                />
                <div className={styles.reservedNote}>
                  <span>Custom fonts</span>
                  <span className={styles.comingSoonTag}>Coming later</span>
                </div>
              </Section>

              <Section title="Text Color" description="Leave blank to match your store's theme.">
                <TextField
                  label="Text color"
                  labelHidden
                  placeholder="Matches your theme"
                  value={draftTokens.colors.textColor ?? ""}
                  onChange={(value) => update("colors", { textColor: value || null })}
                  autoComplete="off"
                />
              </Section>

              <GroupLabel>Colors</GroupLabel>

              <Section title="Accent Color" description="Your brand's one accent color — used for star ratings.">
                <div className={styles.fieldGrid}>
                  <ColorField
                    label="Filled Star"
                    value={draftTokens.colors.starColor}
                    onChange={(value) => update("colors", { starColor: value })}
                  />
                  <ColorField
                    label="Empty Star"
                    value={draftTokens.colors.starEmptyColor}
                    onChange={(value) => update("colors", { starEmptyColor: value })}
                  />
                </div>
                <div className={styles.accentPreview} aria-hidden="true">
                  <span className={styles.accentPreviewStars} style={{ color: toDisplayHex(draftTokens.colors.starColor) }}>
                    &#9733;&#9733;&#9733;&#9733;&#9733;
                  </span>
                </div>
              </Section>

              <GroupLabel>Layout</GroupLabel>

              <Section title="Card Appearance" description="How individual reviews separate from one another.">
                <Select
                  label="Card style"
                  labelHidden
                  options={[
                    { label: "Simple line", value: "border" },
                    { label: "Clean spacing", value: "spacing" },
                    { label: "Boxed card", value: "boxed" },
                  ]}
                  value={draftTokens.reviewCards.separator}
                  onChange={(value) => update("reviewCards", { separator: value as "border" | "spacing" | "boxed" })}
                />
                {isBoxed ? (
                  <div className={styles.cardAppearanceFields}>
                    <div className={styles.fieldGrid}>
                      <ColorField
                        label="Background"
                        value={draftTokens.colors.surfaceColor}
                        onChange={(value) => update("colors", { surfaceColor: value })}
                      />
                      <ColorField
                        label="Border"
                        value={draftTokens.colors.borderColor}
                        onChange={(value) => update("colors", { borderColor: value })}
                      />
                    </div>
                    <ValueSlider
                      label="Border width"
                      min={0}
                      max={2}
                      step={1}
                      value={draftTokens.borders.width}
                      format={(value) => `${value}px`}
                      onChange={(value) => update("borders", { width: value })}
                    />
                    <Select
                      label="Shadow"
                      options={[
                        { label: "None", value: "none" },
                        { label: "Subtle", value: "subtle" },
                        { label: "Medium", value: "medium" },
                      ]}
                      value={draftTokens.cards.shadowIntensity}
                      onChange={(value) => update("cards", { shadowIntensity: value as "none" | "subtle" | "medium" })}
                    />
                  </div>
                ) : (
                  <p className={styles.mutedHint}>Choose &ldquo;Boxed card&rdquo; to set a background, border, and shadow.</p>
                )}
              </Section>

              <Section title="Spacing" description="How much breathing room reviews get.">
                <Select
                  label="Density"
                  labelHidden
                  options={[
                    { label: "Compact", value: "compact" },
                    { label: "Balanced", value: "balanced" },
                    { label: "Spacious", value: "spacious" },
                  ]}
                  value={draftTokens.spacing.density}
                  onChange={(value) => update("spacing", { density: value as "compact" | "balanced" | "spacious" })}
                />
              </Section>

              <Section title="Advanced" description="Rarely needed.">
                <div className={styles.fieldGrid}>
                  <TextField
                    label="Max content width (px, blank = default)"
                    type="number"
                    value={draftTokens.layout.maxContentWidth ? String(draftTokens.layout.maxContentWidth) : ""}
                    onChange={(value) => update("layout", { maxContentWidth: value ? Number(value) : null })}
                    autoComplete="off"
                  />
                  <Select
                    label="Motion"
                    options={[
                      { label: "Full", value: "full" },
                      { label: "Reduced", value: "reduced" },
                    ]}
                    value={draftTokens.animation.motion}
                    onChange={(value) => update("animation", { motion: value as "full" | "reduced" })}
                  />
                </div>
                <ReservedNote label="Star size & shape" />
                <ReservedNote label="Media gallery & avatar treatments" />
              </Section>
            </div>

            <div className={styles.previewColumn}>
              <div className={styles.previewCard}>
                <iframe
                  ref={previewFrameRef}
                  className={styles.previewFrame}
                  src="/appearance-preview"
                  title="Live preview"
                  onLoad={() =>
                    previewFrameRef.current?.contentWindow?.postMessage(
                      { source: "imagyn-appearance-draft", tokens: draftTokens },
                      "*",
                    )
                  }
                />
              </div>

              <div className={styles.actionsBar}>
                <Button variant="primary" onClick={handleSave} disabled={!hasUnsavedChanges || isSaving}>
                  Save
                </Button>
                <Button variant="secondary" onClick={handleDiscard} disabled={!hasUnsavedChanges || isSaving}>
                  Discard
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Container>
      <Frame>
        {toastState ? <Toast content={toastState.content} error={toastState.error} onDismiss={() => setToastState(null)} /> : null}
      </Frame>
    </>
  );
}
