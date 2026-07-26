import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Frame, RangeSlider, Select, TextField, Toast } from "@shopify/polaris";

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
    return { ok: false, error: error instanceof Error ? error.message : "Unable to save appearance." };
  }
};

function ReservedNote({ label }: { label: string }) {
  return (
    <div className={styles.reservedNote}>
      <span>{label}</span>
      <span className={styles.comingSoonTag}>Reserved for future widgets</span>
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
      setToastState({ content: fetcher.data.error || "Unable to save appearance.", error: true });
      return;
    }
    setToastState({ content: "Appearance saved." });
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
              <h1 className={shellStyles.title}>Appearance</h1>
              <p className={shellStyles.subtitle}>
                The design system every storefront widget shares — Product Reviews, Rating Badge, Collection
                Ratings, and everything built after them.
              </p>
            </div>
          </header>

          <div className={styles.layout}>
            <div className={styles.settingsColumn}>
              <Section title="Widget Style" description="A complete look, applied instantly — fine-tune any of it below.">
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

              <Section title="Accent Color" description="The one deliberate brand accent color in the entire system.">
                <div className={styles.accentRow}>
                  <input
                    type="color"
                    className={styles.colorSwatchInput}
                    value={draftTokens.colors.starColor}
                    onChange={(event) => update("colors", { starColor: event.target.value })}
                    aria-label="Accent color picker"
                  />
                  <div className={styles.accentField}>
                    <TextField
                      label="Accent color"
                      labelHidden
                      value={draftTokens.colors.starColor}
                      onChange={(value) => update("colors", { starColor: value })}
                      autoComplete="off"
                    />
                  </div>
                  <div className={styles.accentPreview} aria-hidden="true">
                    <span className={styles.accentPreviewStars} style={{ color: draftTokens.colors.starColor }}>
                      &#9733;&#9733;&#9733;&#9733;&#9733;
                    </span>
                  </div>
                </div>
                <div className={styles.fieldGrid}>
                  <TextField
                    label="Empty star"
                    value={draftTokens.colors.starEmptyColor}
                    onChange={(value) => update("colors", { starEmptyColor: value })}
                    autoComplete="off"
                  />
                </div>
              </Section>

              <Section title="Border Radius" description="0–24px — every rounded surface scales together from this one value.">
                <RangeSlider
                  label="Radius"
                  labelHidden
                  min={0}
                  max={24}
                  step={1}
                  value={draftTokens.corners.radius}
                  onChange={(value) => update("corners", { radius: Array.isArray(value) ? value[0] : value })}
                  output
                  suffix={<span className={styles.sliderSuffix}>{draftTokens.corners.radius}px</span>}
                />
              </Section>

              <Section title="Button Style" description="Applied to buttons built on the shared button primitive.">
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

              <Section title="Typography" description="How type establishes hierarchy across every widget.">
                <div className={styles.fieldGrid}>
                  <RangeSlider
                    label="Scale"
                    min={0.9}
                    max={1.15}
                    step={0.01}
                    value={draftTokens.typography.scale}
                    onChange={(value) => update("typography", { scale: Array.isArray(value) ? value[0] : value })}
                    output
                  />
                  <Select
                    label="Letter spacing"
                    options={[
                      { label: "Tight", value: "tight" },
                      { label: "Normal", value: "normal" },
                    ]}
                    value={draftTokens.typography.letterSpacing}
                    onChange={(value) => update("typography", { letterSpacing: value as "tight" | "normal" })}
                  />
                  <TextField
                    label="Text color (blank = inherit theme)"
                    value={draftTokens.colors.textColor ?? ""}
                    onChange={(value) => update("colors", { textColor: value || null })}
                    autoComplete="off"
                  />
                </div>
                <div className={styles.reservedNote}>
                  <span>Custom fonts</span>
                  <span className={styles.comingSoonTag}>Coming soon — Brand Studio</span>
                </div>
              </Section>

              <Section title="Card Appearance" description="How individual reviews separate from one another.">
                <Select
                  label="Card style"
                  labelHidden
                  options={[
                    { label: "Hairline divider", value: "border" },
                    { label: "Whitespace only", value: "spacing" },
                    { label: "Boxed card", value: "boxed" },
                  ]}
                  value={draftTokens.reviewCards.separator}
                  onChange={(value) => update("reviewCards", { separator: value as "border" | "spacing" | "boxed" })}
                />
                {isBoxed ? (
                  <div className={styles.fieldGrid}>
                    <TextField
                      label="Background"
                      value={draftTokens.colors.surfaceColor}
                      onChange={(value) => update("colors", { surfaceColor: value })}
                      autoComplete="off"
                    />
                    <TextField
                      label="Border color"
                      value={draftTokens.colors.borderColor}
                      onChange={(value) => update("colors", { borderColor: value })}
                      autoComplete="off"
                    />
                    <RangeSlider
                      label="Border width"
                      min={0}
                      max={2}
                      step={1}
                      value={draftTokens.borders.width}
                      onChange={(value) => update("borders", { width: Array.isArray(value) ? value[0] : value })}
                      output
                    />
                    <Select
                      label="Shadow intensity"
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
                  <p className={styles.mutedHint}>Choose &ldquo;Boxed card&rdquo; to reveal background, border, and shadow controls.</p>
                )}
              </Section>

              <Section title="Spacing" description="A single density control keeps within- and between-component spacing in sync.">
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

              <Section title="Advanced" description="Occasional-use settings.">
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
                <ReservedNote label="Media Gallery & avatar treatments" />
              </Section>
            </div>

            <div className={styles.previewColumn}>
              <div className={styles.previewCard}>
                <iframe
                  ref={previewFrameRef}
                  className={styles.previewFrame}
                  src="/appearance-preview"
                  title="Appearance live preview"
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
