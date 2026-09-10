import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData, useLocation, useRevalidator } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { RangeSlider, Select, TextField, Frame, Toast } from "@shopify/polaris";

import { Button } from "../components/ui/Button";
import { ColorField, toDisplayHex } from "../components/ui/ColorField";
import { Container } from "../components/ui/Container";
import { ContextualSaveBar } from "../components/ui/ContextualSaveBar";
import { Section } from "../components/ui/Section";
import { UpgradePrompt } from "../components/ui/UpgradePrompt";
import { SettingsBreadcrumb } from "../components/ui/SettingsBreadcrumb";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { appearanceService, type AppearanceRecord } from "../services/appearance.server";
import { appearancePresets, type AppearancePresetDefinition } from "../services/appearance.presets";
import { generateAiBrandSuggestion, type BrandSuggestion } from "../services/brandSuggestion.server";
import { emailTemplateService } from "../services/emailTemplate.server";
import { assertPermission, getStorePermissions } from "../services/permissions";
import {
  getDefaultAppearanceTokens,
  mergeAppearanceTokens,
  checkAppearanceContrast,
  SURFACE_KEYS,
  SURFACE_LABELS,
  type AppearancePreset,
  type AppearanceTokens,
  type ContrastWarning,
  type SurfaceKey,
} from "../services/appearance.shared";
import {
  getSurfaceOverrideTokens,
  setSurfaceOverride,
  resetSurfaceOverride,
} from "../services/surfaceBrandOverride.server";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.appearance.module.css";

type LoaderData = {
  tokens: AppearanceTokens;
  preset: AppearancePreset;
  // Gates the Advanced section, Saved Themes, and One-Click Branding below — every other
  // control on this page (presets, colors, typography, logo, layout basics, live preview,
  // reset) is Free. See permissions.ts's canUseBrandStudio.
  canUseBrandStudio: boolean;
  savedThemes: AppearanceRecord[];
  // Global Brand → Surface Default → Surface Override — which real surfaces currently have
  // an explicit override saved (see surfaceBrandOverride.server.ts), so the Surface
  // Overrides section below can show real state, never a guess.
  surfaceOverrides: Partial<Record<SurfaceKey, Partial<AppearanceTokens>>>;
};

type ActionData =
  | { ok: true; intent: "save" }
  | { ok: true; intent: "reset"; tokens: AppearanceTokens; preset: AppearancePreset }
  | { ok: true; intent: "createTheme" }
  | { ok: true; intent: "setActiveTheme"; tokens: AppearanceTokens; preset: AppearancePreset }
  | { ok: true; intent: "aiSuggestBrand"; suggestion: BrandSuggestion }
  | { ok: true; intent: "applyEmailBranding" }
  | { ok: true; intent: "applyBrandEverywhere"; emailApplied: boolean }
  | { ok: true; intent: "saveOverride"; surfaceKey: SurfaceKey; tokens: Partial<AppearanceTokens> }
  | { ok: true; intent: "resetOverride"; surfaceKey: SurfaceKey }
  | { ok: false; intent: string; error: string };

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const permissions = await getStorePermissions(store.id);

  const [active, savedThemes, overrideEntries] = await Promise.all([
    appearanceService.getActive(store.id),
    // Saved Themes is Pro-only — no point listing rows a Free store can't act on.
    permissions.canUseBrandStudio ? appearanceService.list(store.id) : Promise.resolve([]),
    Promise.all(SURFACE_KEYS.map(async (key) => [key, await getSurfaceOverrideTokens(store.id, key)] as const)),
  ]);

  const surfaceOverrides: Partial<Record<SurfaceKey, Partial<AppearanceTokens>>> = {};
  for (const [key, tokens] of overrideEntries) {
    if (tokens) surfaceOverrides[key] = tokens;
  }

  return {
    tokens: active?.tokens ?? getDefaultAppearanceTokens(),
    preset: active?.preset ?? "editorial",
    canUseBrandStudio: permissions.canUseBrandStudio,
    savedThemes,
    surfaceOverrides,
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
      assertPermission(permissions, "canUseBrandStudio", "Saved themes require the Pro plan.", "growth");

      const name = String(formData.get("name") || "").trim();
      if (!name) {
        return { ok: false, intent, error: "Name your theme before saving it." };
      }
      const tokens = JSON.parse(String(formData.get("tokens") || "{}")) as AppearanceTokens;
      await appearanceService.create(store.id, { name, tokens });
      return { ok: true, intent: "createTheme" };
    }

    if (intent === "setActiveTheme") {
      assertPermission(permissions, "canUseBrandStudio", "Saved themes require the Pro plan.", "growth");

      const themeId = String(formData.get("themeId") || "");
      if (!themeId) {
        return { ok: false, intent, error: "Select a theme." };
      }
      const activated = await appearanceService.setActive(store.id, themeId);
      return { ok: true, intent: "setActiveTheme", tokens: activated.tokens, preset: activated.preset };
    }

    if (intent === "aiSuggestBrand") {
      // Same Brand Studio gate as Brand Match — this is a paid-tier capability, not core
      // widget editing.
      assertPermission(permissions, "canUseBrandStudio", "AI brand suggestions require the Pro plan.", "growth");

      // Sent by the client rather than re-fetched here — the loader already fetched Brand
      // Match once for the page; re-querying Shopify's Brand API on every suggestion click
      // would be a duplicate GraphQL request for data the client already has.
      const detectedColor = String(formData.get("detectedColor") || "").trim() || null;
      const suggestion = await generateAiBrandSuggestion({ shopName: store.name, detectedColor });
      return { ok: true, intent: "aiSuggestBrand", suggestion };
    }

    if (intent === "applyEmailBranding") {
      // One-Click Branding: Shopify's Admin API exposes no reliable, universal way to detect
      // a merchant's brand color/logo (there is no `Shop.brand` field — confirmed against the
      // live schema; see docs/DECISIONS.md), so this reads the merchant's own already-saved
      // Imagyn brand settings (Accent Color + Logo, configured further down this same page)
      // and pushes them into Email Studio's three templates. Reads the ACTIVE record, not an
      // unsaved draft, so this never applies a color/logo the merchant hasn't actually saved.
      assertPermission(
        permissions,
        "canUseBrandStudio",
        "Applying your brand to email templates requires the Pro plan.",
        "growth",
      );

      const active = await appearanceService.getActive(store.id);
      const tokens = active?.tokens ?? getDefaultAppearanceTokens();
      await emailTemplateService.applyBrandingToAllTemplates(store.id, {
        accentColor: tokens.colors.starColor,
        logoUrl: tokens.images.logoUrl,
      });
      return { ok: true, intent: "applyEmailBranding" };
    }

    // The main CTA — "Apply Brand Everywhere". A real, two-part operation, not a relabeled
    // Save: (1) persists the current draft as the store's one global Appearance record,
    // which every live-fetching storefront surface (every widget/block's own backend route
    // — see appearance.server.ts's getStorefrontAppearance) picks up on its very next page
    // load with zero further action needed; (2) pushes the same accent color + logo into
    // the three stored email templates, since email HTML is a snapshot, not something a
    // shopper's inbox re-fetches live. Surface-specific overrides are deliberately left
    // untouched — Apply Brand Everywhere sets the new global DEFAULT; a surface with its own
    // explicit override keeps it, exactly as this page's own "Reset to Brand Studio" control
    // describes.
    if (intent === "applyBrandEverywhere") {
      const tokens = JSON.parse(String(formData.get("tokens") || "{}")) as AppearanceTokens;
      const preset = String(formData.get("preset") || "custom") as AppearancePreset;

      const safeTokens: AppearanceTokens = permissions.canUseBrandStudio
        ? tokens
        : {
            ...tokens,
            layout: getDefaultAppearanceTokens().layout,
            animation: getDefaultAppearanceTokens().animation,
          };

      await appearanceService.upsertActive(store.id, { tokens: safeTokens, preset });

      let emailApplied = false;
      if (permissions.canUseBrandStudio) {
        await emailTemplateService.applyBrandingToAllTemplates(store.id, {
          accentColor: safeTokens.colors.starColor,
          logoUrl: safeTokens.images.logoUrl,
        });
        emailApplied = true;
      }

      return { ok: true, intent: "applyBrandEverywhere", emailApplied };
    }

    // Surface-Specific Override — the third tier of Global Brand → Surface Default →
    // Surface Override → Final Rendered Style. `tokens` is a PARTIAL (only the categories
    // this one surface actually diverges on); every other category keeps inheriting the
    // live global value forever, even if the merchant changes it later.
    if (intent === "saveOverride") {
      const surfaceKey = String(formData.get("surfaceKey") || "") as SurfaceKey;
      if (!SURFACE_KEYS.includes(surfaceKey)) {
        return { ok: false, intent, error: "Unknown surface." };
      }
      const overrideTokens = JSON.parse(String(formData.get("tokens") || "{}")) as Partial<AppearanceTokens>;
      await setSurfaceOverride(store.id, surfaceKey, overrideTokens);
      return { ok: true, intent: "saveOverride", surfaceKey, tokens: overrideTokens };
    }

    // "Reset to Brand Studio" — deletes the override row so this surface goes back to pure
    // global inheritance immediately, including any global change made while it was
    // overridden.
    if (intent === "resetOverride") {
      const surfaceKey = String(formData.get("surfaceKey") || "") as SurfaceKey;
      if (!SURFACE_KEYS.includes(surfaceKey)) {
        return { ok: false, intent, error: "Unknown surface." };
      }
      await resetSurfaceOverride(store.id, surfaceKey);
      return { ok: true, intent: "resetOverride", surfaceKey };
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
  const {
    tokens: initialTokens,
    preset: initialPreset,
    canUseBrandStudio,
    savedThemes,
    surfaceOverrides,
  } = useLoaderData<typeof loader>();
  const location = useLocation();
  // Same real, allow-listed deep-link route the Widgets page's own "Add to Theme"/"Open Theme
  // Editor" actions use (app.widgets.add-to-theme.tsx) — reused here rather than duplicated,
  // so Brand Studio's color/typography controls and the actual storefront placement are one
  // click apart. Store Reviews specifically: it's the one widget whose own theme editor
  // settings (width/size/element visibility) live outside Brand Studio's reach entirely.
  const storeReviewsThemeEditorHref = (() => {
    const params = new URLSearchParams(location.search);
    params.set("handle", "store_reviews");
    return `/app/widgets/add-to-theme?${params.toString()}`;
  })();
  const revalidator = useRevalidator();
  const fetcher = useFetcher<ActionData>();
  const themeFetcher = useFetcher<ActionData>();
  const aiSuggestFetcher = useFetcher<ActionData>();
  const emailBrandFetcher = useFetcher<ActionData>();
  const overrideFetcher = useFetcher<ActionData>();
  const isSaving = fetcher.state !== "idle";
  const isThemeBusy = themeFetcher.state !== "idle";
  const isAiSuggesting = aiSuggestFetcher.state !== "idle";
  const isApplyingEmailBranding = emailBrandFetcher.state !== "idle";
  const isOverrideBusy = overrideFetcher.state !== "idle";

  const [draftTokens, setDraftTokens] = useState<AppearanceTokens>(initialTokens);
  const [baselineTokens, setBaselineTokens] = useState<AppearanceTokens>(initialTokens);
  const [preset, setPreset] = useState<AppearancePreset>(initialPreset);
  const [toastState, setToastState] = useState<{ content: string; error?: boolean } | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  const [newThemeName, setNewThemeName] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState<BrandSuggestion | null>(null);
  const [aiSuggestError, setAiSuggestError] = useState<string | null>(null);

  // Surface Overrides — Global Brand → Surface Default → Surface Override. `overridesState`
  // starts from the loader's real, persisted rows and only ever changes in response to a
  // real saveOverride/resetOverride response below — never a purely local/optimistic value,
  // since "does this surface have an override" is exactly the fact a merchant needs to trust.
  const [overridesState, setOverridesState] =
    useState<Partial<Record<SurfaceKey, Partial<AppearanceTokens>>>>(surfaceOverrides);
  const [selectedSurface, setSelectedSurface] = useState<SurfaceKey>(SURFACE_KEYS[0]);
  const selectedOverride = overridesState[selectedSurface] ?? null;
  const [overrideDraft, setOverrideDraft] = useState<Partial<AppearanceTokens>>(selectedOverride ?? {});

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
    } else if (fetcher.data.intent === "applyBrandEverywhere") {
      setToastState({
        content: fetcher.data.emailApplied
          ? "Applied everywhere — every widget, block, and page now reflects this brand, and your email templates were updated too."
          : "Applied everywhere — every widget, block, and page now reflects this brand. (Email template sync requires Pro.)",
      });
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

  useEffect(() => {
    if (!aiSuggestFetcher.data) return;
    if (!aiSuggestFetcher.data.ok) {
      setAiSuggestError(aiSuggestFetcher.data.error);
      return;
    }
    if (aiSuggestFetcher.data.intent === "aiSuggestBrand") {
      setAiSuggestError(null);
      setAiSuggestion(aiSuggestFetcher.data.suggestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiSuggestFetcher.data]);

  useEffect(() => {
    if (!emailBrandFetcher.data) return;
    if (!emailBrandFetcher.data.ok) {
      setToastState({ content: emailBrandFetcher.data.error, error: true });
      return;
    }
    if (emailBrandFetcher.data.intent === "applyEmailBranding") {
      setToastState({
        content:
          "Applied your current brand color and logo to all email templates (Review Request, Reminder #1, Final Reminder).",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailBrandFetcher.data]);

  useEffect(() => {
    if (!overrideFetcher.data) return;
    if (!overrideFetcher.data.ok) {
      setToastState({ content: overrideFetcher.data.error, error: true });
      return;
    }
    if (overrideFetcher.data.intent === "saveOverride") {
      const { surfaceKey, tokens } = overrideFetcher.data;
      setOverridesState((current) => ({ ...current, [surfaceKey]: tokens }));
      setToastState({ content: `Override saved for ${SURFACE_LABELS[surfaceKey]}.` });
    } else if (overrideFetcher.data.intent === "resetOverride") {
      const { surfaceKey } = overrideFetcher.data;
      setOverridesState((current) => {
        const next = { ...current };
        delete next[surfaceKey];
        return next;
      });
      setOverrideDraft({});
      setToastState({ content: `${SURFACE_LABELS[surfaceKey]} reset to Brand Studio.` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrideFetcher.data]);

  // Switching which surface is being inspected always shows THAT surface's real saved
  // override (or a blank draft if it has none) — never carries over a draft from whichever
  // surface was selected before.
  useEffect(() => {
    setOverrideDraft(overridesState[selectedSurface] ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSurface]);

  const hasSelectedOverride = selectedSurface in overridesState;
  const overrideResolvedTokens = useMemo(
    () => mergeAppearanceTokens(overrideDraft, draftTokens),
    [overrideDraft, draftTokens],
  );

  // Real validation over the merchant's own chosen colors, never a fabricated warning —
  // see appearance.shared.ts's checkAppearanceContrast for exactly what pairs this checks.
  const contrastWarnings: ContrastWarning[] = useMemo(() => checkAppearanceContrast(draftTokens), [draftTokens]);

  const update = <C extends keyof AppearanceTokens>(category: C, patch: Partial<AppearanceTokens[C]>) => {
    setPreset("custom");
    setDraftTokens((current) => ({ ...current, [category]: { ...current[category], ...patch } }));
  };

  const updateOverride = <C extends keyof AppearanceTokens>(category: C, patch: Partial<AppearanceTokens[C]>) => {
    setOverrideDraft((current) => ({
      ...current,
      [category]: { ...(current[category] as AppearanceTokens[C] | undefined), ...patch },
    }));
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

  // One-Click Branding: no external "detected" source exists (Shopify's Admin API has no
  // reliable, universal way to read a merchant's brand color/logo — see the action's
  // applyEmailBranding intent), so this pushes the merchant's own already-saved Imagyn brand
  // settings (Accent Color + Logo, configured further down this page) into Email Studio's
  // three templates. Independent of the Save button/draft state on purpose — always a single
  // click, and never applies an unsaved edit.
  const handleApplyEmailBranding = () => {
    const formData = new FormData();
    formData.append("_intent", "applyEmailBranding");
    emailBrandFetcher.submit(formData, { method: "post" });
  };

  const handleRequestAiSuggestion = () => {
    setAiSuggestError(null);
    const formData = new FormData();
    formData.append("_intent", "aiSuggestBrand");
    aiSuggestFetcher.submit(formData, { method: "post" });
  };

  // Same "instant local draft update, nothing persisted until Save" contract as
  // handleApplyBrandMatch above — an AI suggestion is just a different source for a partial
  // token update (colors.starColor + typography), never a different mechanism.
  const handleApplyAiSuggestion = () => {
    if (!aiSuggestion) return;
    setPreset("custom");
    setDraftTokens((current) => ({
      ...current,
      colors: { ...current.colors, starColor: aiSuggestion.starColor },
      typography: {
        ...current.typography,
        scale: aiSuggestion.typography.scale,
        letterSpacing: aiSuggestion.typography.letterSpacing,
      },
    }));
    setToastState({ content: "Applied the AI suggestion — review the preview, then Save to publish." });
  };

  // The main CTA. A real operation: persists the draft as the global brand (every
  // live-fetching storefront surface reflects it on its next page load, automatically,
  // with zero further action) and pushes accent color + logo into the stored email
  // templates — see the action's own "applyBrandEverywhere" intent for exactly what this
  // does and does not touch (surface overrides are left alone by design).
  const handleApplyBrandEverywhere = () => {
    const formData = new FormData();
    formData.append("_intent", "applyBrandEverywhere");
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

  const handleSaveOverride = () => {
    const formData = new FormData();
    formData.append("_intent", "saveOverride");
    formData.append("surfaceKey", selectedSurface);
    formData.append("tokens", JSON.stringify(overrideDraft));
    overrideFetcher.submit(formData, { method: "post" });
  };

  const handleResetOverride = () => {
    const formData = new FormData();
    formData.append("_intent", "resetOverride");
    formData.append("surfaceKey", selectedSurface);
    overrideFetcher.submit(formData, { method: "post" });
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
      <ContextualSaveBar
        id="brand-studio-save-bar"
        open={hasUnsavedChanges}
        saving={isSaving}
        saveLabel="Apply Brand Everywhere"
        onSave={handleApplyBrandEverywhere}
        onDiscard={handleDiscard}
      />
      <Container as="main">
        <div className={`${shellStyles.page} ${styles.page} ${shellStyles.reveal}`}>
          <header className={shellStyles.header}>
            <div className={shellStyles.headerContent}>
              <SettingsBreadcrumb current="Brand Studio" />
              <h1 className={shellStyles.title}>Brand Studio</h1>
              <p className={shellStyles.subtitle}>
                Configure your brand once, then click Apply Brand Everywhere — every IMAGYN widget, Theme App
                Block, and email inherits it automatically. Changes preview instantly on the right.
              </p>
              <a className={styles.themeEditorShortcut} href={storeReviewsThemeEditorHref}>
                Customize the Store Reviews widget in your Theme Editor →
              </a>
            </div>
          </header>

          <div className={styles.layout}>
            <div className={styles.settingsColumn}>
              <GroupLabel>One-Click Branding</GroupLabel>

              {canUseBrandStudio ? (
                <>
                <div className={styles.heroSection}>
                <Section
                  title="Re-sync email templates only"
                  description="Apply Brand Everywhere (below) already does this — use this only if you want to push your current Accent Color and Logo into emails again without touching anything else."
                >
                  <div className={styles.brandMatchCard}>
                    <div className={styles.brandMatchPreview}>
                      <span
                        className={styles.brandMatchSwatch}
                        style={{ background: toDisplayHex(draftTokens.colors.starColor) }}
                        aria-hidden="true"
                      />
                      {draftTokens.images.logoUrl ? (
                        <img
                          className={styles.brandMatchLogo}
                          src={draftTokens.images.logoUrl}
                          alt=""
                          aria-hidden="true"
                        />
                      ) : null}
                      <span className={styles.brandMatchDetectedTag}>Your current brand settings</span>
                    </div>
                    <Button
                      type="button"
                      variant="primary"
                      // Imagyn's own brand accent for this one specific moment (a genuinely
                      // new capability's primary action) — inline, not a Button variant,
                      // since every other primary action on this page and across the app
                      // stays on the shared black `--color-accent` (see button.module.css);
                      // this isn't a global restyle. Kept as the sole place lime appears in
                      // Brand Studio, per "use selectively, don't force it everywhere."
                      style={{ background: "#EAFBB2", color: "#000000", borderColor: "#EAFBB2" }}
                      onClick={handleApplyEmailBranding}
                      disabled={isApplyingEmailBranding}
                    >
                      {isApplyingEmailBranding ? "Applying…" : "Apply to email templates"}
                    </Button>
                    {hasUnsavedChanges ? (
                      <p className={styles.mutedHint}>
                        You have unsaved color/logo changes below — Save them first so your email templates match
                        what you see here.
                      </p>
                    ) : null}
                  </div>
                </Section>
                </div>

                {/* A separate, optional action from Brand Match above — not a replacement for
                    it. Deliberately narrow: only colors.starColor + typography, never card
                    style/spacing/logo/full token generation (see brandSuggestion.server.ts). */}
                <Section
                  title="AI Suggestion"
                  description="Let AI suggest an accent color and typography feel for your reviews."
                >
                  {aiSuggestion ? (
                    <div className={styles.brandMatchCard}>
                      <div className={styles.brandMatchPreview}>
                        <span
                          className={styles.brandMatchSwatch}
                          style={{ background: aiSuggestion.starColor }}
                          aria-hidden="true"
                        />
                        <span className={styles.brandMatchDetectedTag}>
                          {aiSuggestion.rationale || "AI-suggested accent color and typography"}
                        </span>
                      </div>
                      <div className={styles.aiSuggestionActions}>
                        <Button
                          type="button"
                          variant="primary"
                          style={{ background: "#EAFBB2", color: "#000000", borderColor: "#EAFBB2" }}
                          onClick={handleApplyAiSuggestion}
                        >
                          Apply suggestion
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={handleRequestAiSuggestion}
                          disabled={isAiSuggesting}
                        >
                          {isAiSuggesting ? "Thinking…" : "Try another"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Button type="button" onClick={handleRequestAiSuggestion} disabled={isAiSuggesting}>
                        {isAiSuggesting ? "Thinking…" : "Suggest with AI"}
                      </Button>
                      {aiSuggestError ? <p className={styles.aiSuggestionError}>{aiSuggestError}</p> : null}
                    </>
                  )}
                </Section>
                </>
              ) : (
                <UpgradePrompt
                  feature="Brand Match"
                  description="Pull your primary color and logo straight from Shopify's own Brand settings and apply them to your reviews in one click."
                  benefit="Growth and above include Brand Match on top of everything in Free Brand Studio."
                  requiredPlanName="Pro"
                  billingHref={`/app/billing${location.search}`}
                />
              )}

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
                  requiredPlanName="Pro"
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
                  requiredPlanName="Pro"
                  billingHref={`/app/billing${location.search}`}
                />
              )}

              <GroupLabel>Surface Overrides</GroupLabel>

              <Section
                title="Override one surface"
                description="Every surface inherits this global brand by default. Pick one below to give it its own look instead — the global brand keeps applying to everything else, and changing it later never touches an overridden surface."
              >
                <Select
                  label="Surface"
                  labelHidden
                  options={SURFACE_KEYS.map((key) => ({
                    label: key in overridesState ? `${SURFACE_LABELS[key]} — Overridden` : SURFACE_LABELS[key],
                    value: key,
                  }))}
                  value={selectedSurface}
                  onChange={(value) => setSelectedSurface(value as SurfaceKey)}
                />

                <p className={styles.mutedHint}>
                  {hasSelectedOverride
                    ? `${SURFACE_LABELS[selectedSurface]} is using its own override below.`
                    : `${SURFACE_LABELS[selectedSurface]} is currently inheriting your global brand.`}
                </p>

                <div className={styles.fieldGrid}>
                  <ColorField
                    label="Accent color"
                    value={overrideResolvedTokens.colors.starColor}
                    onChange={(value) => updateOverride("colors", { starColor: value })}
                  />
                  <ColorField
                    label="Background"
                    value={overrideResolvedTokens.colors.surfaceColor}
                    onChange={(value) => updateOverride("colors", { surfaceColor: value })}
                  />
                </div>
                <Select
                  label="Button style"
                  options={[
                    { label: "Filled", value: "solid" },
                    { label: "Outline", value: "outline" },
                    { label: "Ghost", value: "ghost" },
                  ]}
                  value={overrideResolvedTokens.buttons.style}
                  onChange={(value) => updateOverride("buttons", { style: value as "solid" | "outline" | "ghost" })}
                />
                <ValueSlider
                  label="Border radius"
                  min={0}
                  max={24}
                  step={1}
                  value={overrideResolvedTokens.corners.radius}
                  format={(value) => `${value}px`}
                  onChange={(value) => updateOverride("corners", { radius: value })}
                />

                <div className={styles.actionsBar}>
                  <Button type="button" variant="primary" onClick={handleSaveOverride} disabled={isOverrideBusy}>
                    {isOverrideBusy ? "Saving…" : `Save override for ${SURFACE_LABELS[selectedSurface]}`}
                  </Button>
                  <Button type="button" variant="ghost" onClick={handleResetOverride} disabled={!hasSelectedOverride || isOverrideBusy}>
                    Reset to Brand Studio
                  </Button>
                </div>
              </Section>
            </div>

            <div className={styles.previewColumn}>
              <div className={styles.previewToggle} role="group" aria-label="Preview device">
                <button
                  type="button"
                  className={`${styles.previewToggleButton} ${previewMode === "desktop" ? styles.previewToggleActive : ""}`}
                  onClick={() => setPreviewMode("desktop")}
                  aria-pressed={previewMode === "desktop"}
                >
                  Desktop
                </button>
                <button
                  type="button"
                  className={`${styles.previewToggleButton} ${previewMode === "mobile" ? styles.previewToggleActive : ""}`}
                  onClick={() => setPreviewMode("mobile")}
                  aria-pressed={previewMode === "mobile"}
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

              {contrastWarnings.length > 0 ? (
                <div className={styles.contrastWarning} role="alert">
                  <p className={styles.contrastWarningTitle}>Low contrast — some text may be hard to read</p>
                  <ul className={styles.contrastWarningList}>
                    {contrastWarnings.map((warning) => (
                      <li key={warning.pair}>
                        {warning.pair === "text-on-surface"
                          ? `Text color against your background is only ${warning.ratio.toFixed(1)}:1 (recommended: 4.5:1 or higher).`
                          : `Your accent color against your background is only ${warning.ratio.toFixed(1)}:1 (recommended: 4.5:1 or higher).`}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className={styles.actionsBar}>
                <Button variant="primary" onClick={handleApplyBrandEverywhere} disabled={!hasUnsavedChanges || isSaving}>
                  {isSaving ? "Applying…" : "Apply Brand Everywhere"}
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
