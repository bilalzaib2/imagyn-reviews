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
import { appearancePresets } from "../services/appearance.presets";
import {
  getDefaultAppearanceTokens,
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
    preset: active?.preset ?? "custom",
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
    setDraftTokens((current) => ({ ...current, [category]: { ...current[category], ...patch } }));
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

              <div className={styles.presetRow}>
                {appearancePresets.map((definition) =>
                  definition.available ? (
                    <button
                      key={definition.id}
                      type="button"
                      className={`${styles.presetPill} ${preset === definition.id ? styles.presetPillActive : ""}`}
                      onClick={() => setPreset(definition.id)}
                    >
                      {definition.label}
                    </button>
                  ) : (
                    <span key={definition.id} className={`${styles.presetPill} ${styles.presetPillDisabled}`}>
                      {definition.label}
                      <span className={styles.comingSoonTag}>Soon</span>
                    </span>
                  ),
                )}
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

            <div className={styles.settingsColumn}>
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
                </div>
              </Section>

              <Section title="Colors" description="The one deliberate brand accent (star), plus the neutral surface colors around it.">
                <div className={styles.fieldGrid}>
                  <TextField
                    label="Star"
                    value={draftTokens.colors.starColor}
                    onChange={(value) => update("colors", { starColor: value })}
                    autoComplete="off"
                  />
                  <TextField
                    label="Empty star"
                    value={draftTokens.colors.starEmptyColor}
                    onChange={(value) => update("colors", { starEmptyColor: value })}
                    autoComplete="off"
                  />
                  <TextField
                    label="Border"
                    value={draftTokens.colors.borderColor}
                    onChange={(value) => update("colors", { borderColor: value })}
                    autoComplete="off"
                  />
                  <TextField
                    label="Surface"
                    value={draftTokens.colors.surfaceColor}
                    onChange={(value) => update("colors", { surfaceColor: value })}
                    autoComplete="off"
                  />
                  <TextField
                    label="Text (blank = inherit theme)"
                    value={draftTokens.colors.textColor ?? ""}
                    onChange={(value) => update("colors", { textColor: value || null })}
                    autoComplete="off"
                  />
                </div>
              </Section>

              <Section title="Spacing" description="A single density control keeps within- and between-component spacing in sync.">
                <Select
                  label="Density"
                  labelHidden
                  options={[
                    { label: "Compact", value: "compact" },
                    { label: "Comfortable", value: "comfortable" },
                    { label: "Spacious", value: "spacious" },
                  ]}
                  value={draftTokens.spacing.density}
                  onChange={(value) => update("spacing", { density: value as "compact" | "comfortable" | "spacious" })}
                />
              </Section>

              <Section title="Corners" description="Proportional across every rounded surface — pills always stay fully round.">
                <Select
                  label="Radius"
                  labelHidden
                  options={[
                    { label: "Sharp", value: "sharp" },
                    { label: "Soft", value: "soft" },
                    { label: "Round", value: "round" },
                  ]}
                  value={draftTokens.corners.radiusScale}
                  onChange={(value) => update("corners", { radiusScale: value as "sharp" | "soft" | "round" })}
                />
              </Section>

              <Section title="Borders" description="0 removes hairline dividers system-wide in favor of whitespace alone.">
                <RangeSlider
                  label="Width"
                  labelHidden
                  min={0}
                  max={2}
                  step={1}
                  value={draftTokens.borders.width}
                  onChange={(value) => update("borders", { width: Array.isArray(value) ? value[0] : value })}
                  output
                />
              </Section>

              <Section title="Buttons" description="Applied to future widgets built on the shared button primitive.">
                <Select
                  label="Style"
                  labelHidden
                  options={[
                    { label: "Solid", value: "solid" },
                    { label: "Outline", value: "outline" },
                    { label: "Ghost", value: "ghost" },
                  ]}
                  value={draftTokens.buttons.style}
                  onChange={(value) => update("buttons", { style: value as "solid" | "outline" | "ghost" })}
                />
              </Section>

              <Section title="Review Cards" description="How individual reviews separate from one another in a list.">
                <Select
                  label="Separator"
                  labelHidden
                  options={[
                    { label: "Hairline border", value: "border" },
                    { label: "Whitespace only", value: "spacing" },
                  ]}
                  value={draftTokens.reviewCards.separator}
                  onChange={(value) => update("reviewCards", { separator: value as "border" | "spacing" })}
                />
              </Section>

              <Section title="Layout" description="Optional max-width for the Ratings & Reviews section shell.">
                <TextField
                  label="Max content width (px, blank = default)"
                  type="number"
                  value={draftTokens.layout.maxContentWidth ? String(draftTokens.layout.maxContentWidth) : ""}
                  onChange={(value) => update("layout", { maxContentWidth: value ? Number(value) : null })}
                  autoComplete="off"
                />
              </Section>

              <Section title="Animation" description="Reduced motion applies system-wide, independent of a visitor's own OS setting.">
                <Select
                  label="Motion"
                  labelHidden
                  options={[
                    { label: "Full", value: "full" },
                    { label: "Reduced", value: "reduced" },
                  ]}
                  value={draftTokens.animation.motion}
                  onChange={(value) => update("animation", { motion: value as "full" | "reduced" })}
                />
              </Section>

              <Section title="Stars & Images" description="Reserved categories with no independent tokens yet.">
                <ReservedNote label="Star size & shape" />
                <ReservedNote label="Media Gallery & avatar treatments" />
              </Section>
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
