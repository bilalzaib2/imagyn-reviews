import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData, useLocation, useRevalidator } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { RangeSlider, Select, TextField, Frame, Toast } from "@shopify/polaris";

import { Button } from "../components/ui/Button";
import { ColorField, toDisplayHex } from "../components/ui/ColorField";
import { Container } from "../components/ui/Container";
import { Section } from "../components/ui/Section";
import { UpgradePrompt } from "../components/ui/UpgradePrompt";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { appearanceService, type AppearanceRecord } from "../services/appearance.server";
import { appearancePresets, type AppearancePresetDefinition } from "../services/appearance.presets";
import { assertPermission, getStorePermissions } from "../services/permissions";
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
  // Gates only the Advanced section and Saved Themes below — every other control on this
  // page (presets, colors, typography, logo, layout basics, live preview, reset) is Free.
  // See permissions.ts's canUseBrandStudio; unchanged flag, narrower meaning.
  canUseBrandStudio: boolean;
  savedThemes: AppearanceRecord[];
};

type ActionData =
  | { ok: true; intent: "save" }
  | { ok: true; intent: "reset"; tokens: AppearanceTokens; preset: AppearancePreset }
  | { ok: true; intent: "createTheme" }
  | { ok: true; intent: "setActiveTheme"; tokens: AppearanceTokens; preset: AppearancePreset }
  | { ok: false; intent: string; error: string };

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const permissions = await getStorePermissions(store.id);

  const [active, savedThemes] = await Promise.all([
    appearanceService.getActive(store.id),
    // Saved Themes is Pro-only — no point listing rows a Free store can't act on.
    permissions.canUseBrandStudio ? appearanceService.list(store.id) : Promise.resolve([]),
  ]);

  return {
    tokens: active?.tokens ?? getDefaultAppearanceTokens(),
    preset: active?.preset ?? "editorial",
    canUseBrandStudio: permissions.canUseBrandStudio,
    savedThemes,
  };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const formData = await request.formData();
  const intent = String(formData.get("_intent") || "save");

  try {
    const permissions = await getStorePermissions(store.id);

    if (intent === "save") {
      const tokens = JSON.parse(String(formData.get("tokens") || "{}")) as AppearanceTokens;
      const preset = String(formData.get("preset") || "custom") as AppearancePreset;

      // Defense in depth — the Advanced section (layout/animation) is Pro-only in the UI, but
      // a direct POST bypassing it shouldn't be able to set those fields on a non-Pro store
      // either. Mirrors widget.server.ts's layout coercion from the Widgets phase.
      const safeTokens: AppearanceTokens = permissions.canUseBrandStudio
        ? tokens
        : {
            ...tokens,
            layout: getDefaultAppearanceTokens().layout,
            animation: getDefaultAppearanceTokens().animation,
          };

      await appearanceService.upsertActive(store.id, { tokens: safeTokens, preset });
      return { ok: true, intent: "save" };
    }

    if (intent === "reset") {
      const defaults = getDefaultAppearanceTokens();
      const resetPreset: AppearancePreset = "editorial";
      await appearanceService.upsertActive(store.id, { tokens: defaults, preset: resetPreset });
      return { ok: true, intent: "reset", tokens: defaults, preset: resetPreset };
    }

    if (intent === "createTheme") {
      assertPermission(permissions, "canUseBrandStudio", "Saved themes require the Growth plan or higher.", "growth");

      const name = String(formData.get("name") || "").trim();
      if (!name) {
        return { ok: false, intent, error: "Name your theme before saving it." };
      }
      const tokens = JSON.parse(String(formData.get("tokens") || "{}")) as AppearanceTokens;
      await appearanceService.create(store.id, { name, tokens });
      return { ok: true, intent: "createTheme" };
    }

    if (intent === "setActiveTheme") {
      assertPermission(permissions, "canUseBrandStudio", "Saved themes require the Growth plan or higher.", "growth");

      const themeId = String(formData.get("themeId") || "");
      if (!themeId) {
        return { ok: false, intent, error: "Select a theme." };
      }
      const activated = await appearanceService.setActive(store.id, themeId);
      return { ok: true, intent: "setActiveTheme", tokens: activated.tokens, preset: activated.preset };
    }

    return { ok: false, intent, error: "Unsupported action." };
  } catch (error) {
    return { ok: false, intent, error: error instanceof Error ? error.message : "Unable to save. Please try again." };
  }
};

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
      <span className={styles.comingSoonTag}>Coming to Pro</span>
    </div>
  );
}

type PreviewMode = "desktop" | "mobile";

export default function AppearancePage() {
  const { tokens: initialTokens, preset: initialPreset, canUseBrandStudio, savedThemes } =
    useLoaderData<typeof loader>();
  const location = useLocation();
  const revalidator = useRevalidator();
  const fetcher = useFetcher<ActionData>();
  const themeFetcher = useFetcher<ActionData>();
  const isSaving = fetcher.state !== "idle";
  const isThemeBusy = themeFetcher.state !== "idle";

  const [draftTokens, setDraftTokens] = useState<AppearanceTokens>(initialTokens);
  const [baselineTokens, setBaselineTokens] = useState<AppearanceTokens>(initialTokens);
  const [preset, setPreset] = useState<AppearancePreset>(initialPreset);
  const [toastState, setToastState] = useState<{ content: string; error?: boolean } | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  const [newThemeName, setNewThemeName] = useState("");

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
      setToastState({ content: fetcher.data.error, error: true });
      return;
    }
    if (fetcher.data.intent === "save") {
      setToastState({ content: "Saved. Your storefront now reflects these changes." });
      setBaselineTokens(draftTokens);
    } else if (fetcher.data.intent === "reset") {
      setDraftTokens(fetcher.data.tokens);
      setBaselineTokens(fetcher.data.tokens);
      setPreset(fetcher.data.preset);
      setToastState({ content: "Reset to the default look." });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  useEffect(() => {
    if (!themeFetcher.data) return;
    if (!themeFetcher.data.ok) {
      setToastState({ content: themeFetcher.data.error, error: true });
      return;
    }
    if (themeFetcher.data.intent === "createTheme") {
      setToastState({ content: "Theme saved." });
      setNewThemeName("");
      revalidator.revalidate();
    } else if (themeFetcher.data.intent === "setActiveTheme") {
      setDraftTokens(themeFetcher.data.tokens);
      setBaselineTokens(themeFetcher.data.tokens);
      setPreset(themeFetcher.data.preset);
      setToastState({ content: "Theme activated." });
      revalidator.revalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeFetcher.data]);

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
    formData.append("_intent", "save");
    formData.append("tokens", JSON.stringify(draftTokens));
    formData.append("preset", preset);
    fetcher.submit(formData, { method: "post" });
  };

  const handleDiscard = () => {
    setDraftTokens(baselineTokens);
  };

  const handleReset = () => {
    const formData = new FormData();
    formData.append("_intent", "reset");
    fetcher.submit(formData, { method: "post" });
  };

  const handleCreateTheme = () => {
    if (!newThemeName.trim()) return;
    const formData = new FormData();
    formData.append("_intent", "createTheme");
    formData.append("name", newThemeName.trim());
    formData.append("tokens", JSON.stringify(draftTokens));
    themeFetcher.submit(formData, { method: "post" });
  };

  const handleSetActiveTheme = (themeId: string) => {
    const formData = new FormData();
    formData.append("_intent", "setActiveTheme");
    formData.append("themeId", themeId);
    themeFetcher.submit(formData, { method: "post" });
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
                  <span className={styles.comingSoonTag}>Coming to Pro</span>
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

              <GroupLabel>Branding</GroupLabel>

              <Section title="Logo" description="A small mark shown in the Ratings & Reviews section.">
                <TextField
                  label="Logo URL"
                  labelHidden
                  placeholder="https://…"
                  value={draftTokens.images.logoUrl ?? ""}
                  onChange={(value) => update("images", { logoUrl: value || null })}
                  autoComplete="off"
                />
                <p className={styles.mutedHint}>
                  Paste a link to a hosted image (e.g. from your Shopify files). Leave blank to show no logo.
                </p>
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

              <GroupLabel>Advanced</GroupLabel>

              {canUseBrandStudio ? (
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
              ) : (
                <UpgradePrompt
                  feature="Advanced customization"
                  description="Fine-tune maximum content width and motion — plus star size/shape and media gallery treatments as they ship."
                  benefit="Growth and above include deeper layout controls on top of everything in Free Brand Studio."
                  requiredPlanName="Growth"
                  billingHref={`/app/billing${location.search}`}
                />
              )}

              <GroupLabel>Saved Themes</GroupLabel>

              {canUseBrandStudio ? (
                <Section title="Saved Themes" description="Save your current configuration and switch between saved looks.">
                  <div className={styles.savedThemeForm}>
                    <TextField
                      label="Theme name"
                      labelHidden
                      placeholder="e.g. Holiday"
                      value={newThemeName}
                      onChange={setNewThemeName}
                      autoComplete="off"
                    />
                    <Button
                      type="button"
                      onClick={handleCreateTheme}
                      disabled={!newThemeName.trim() || isThemeBusy}
                    >
                      Save as new theme
                    </Button>
                  </div>

                  {savedThemes.length === 0 ? (
                    <p className={styles.mutedHint}>
                      No saved themes yet — save your current configuration above to create one.
                    </p>
                  ) : (
                    <ul className={styles.savedThemeList}>
                      {savedThemes.map((theme) => (
                        <li key={theme.id} className={styles.savedThemeRow}>
                          <span className={styles.savedThemeName}>
                            {theme.name}
                            {theme.isActive ? <span className={styles.savedThemeActiveTag}>Active</span> : null}
                          </span>
                          {!theme.isActive ? (
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => handleSetActiveTheme(theme.id)}
                              disabled={isThemeBusy}
                            >
                              Set Active
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              ) : (
                <UpgradePrompt
                  feature="Saved Themes"
                  description="Save multiple configurations — a holiday look, a sale look, your everyday brand look — and switch between them instantly."
                  benefit="Growth and above include unlimited saved themes on top of everything in Free Brand Studio."
                  requiredPlanName="Growth"
                  billingHref={`/app/billing${location.search}`}
                />
              )}
            </div>

            <div className={styles.previewColumn}>
              <div className={styles.previewToggle} role="group" aria-label="Preview device">
                <button
                  type="button"
                  className={`${styles.previewToggleButton} ${previewMode === "desktop" ? styles.previewToggleActive : ""}`}
                  onClick={() => setPreviewMode("desktop")}
                >
                  Desktop
                </button>
                <button
                  type="button"
                  className={`${styles.previewToggleButton} ${previewMode === "mobile" ? styles.previewToggleActive : ""}`}
                  onClick={() => setPreviewMode("mobile")}
                >
                  Mobile
                </button>
              </div>

              <div className={styles.previewCard} data-mode={previewMode}>
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
                <Button variant="ghost" onClick={handleReset} disabled={isSaving}>
                  Reset to Default
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
