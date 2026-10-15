import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, ShouldRevalidateFunctionArgs } from "react-router";
import { Frame, Toast } from "@shopify/polaris";

import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ColorField } from "../components/ui/ColorField";
import { Container } from "../components/ui/Container";
import { ContextualSaveBar } from "../components/ui/ContextualSaveBar";
import { Section } from "../components/ui/Section";
import { SettingsBreadcrumb } from "../components/ui/SettingsBreadcrumb";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore, updateEmailSenderName } from "../services/store.server";
import { getStorePermissions } from "../services/permissions";
import { resolveSenderIdentity } from "../services/emailSenderIdentity.server";
import {
  MAX_SENDER_NAME_LENGTH,
  sanitizeSenderName,
  type SenderIdentity,
} from "../services/emailSenderIdentity.shared";
import { emailTemplateService } from "../services/emailTemplate.server";
import { buildReviewRequestEmail } from "../services/notifications/templates.server";
import { sendTestReviewRequestEmail } from "../services/notifications/testEmail.server";
import { getStorageProvider } from "../services/storage/provider.server";
import { sanitizeEmailHtml, sanitizeSvgMarkup, validateSvgLogo } from "../services/emailSanitize.server";
import {
  CONTENT_WIDTH_RANGE,
  CORNER_RADIUS_RANGE,
  EMAIL_SECTION_LABELS,
  LOGO_WIDTH_RANGE,
  findUnknownVariables,
  getDefaultEmailTemplateContent,
  isEmailTemplateType,
  normalizeEmailSections,
  normalizeEmailTemplateContent,
  sanitizeEmailTemplateContentForPlan,
  variablesForType,
  type EmailAlign,
  type EmailDensity,
  type EmailFontFamily,
  type EmailSection,
  type EmailSectionId,
  type EmailTemplateContent,
  type EmailTemplateType,
  type EmailTextSize,
  type EmailTheme,
} from "../services/email.shared";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.email-studio.module.css";

// Email Studio — the merchant's editor for every customer-facing email this app sends.
//
// PLAN POLICY: every control on this page works on every plan, including Free. A merchant can
// install the app, send the ready-made emails immediately, and customize copy, colour,
// typography, spacing, layout, logos, sections and raw HTML without upgrading. The single
// exception is the "Powered by Imagyn Reviews" footer toggle, which is white-labelling rather
// than email customization and stays on canUseCustomBranding — enforced server-side by
// sanitizeEmailTemplateContentForPlan, not merely disabled in the UI below.
//
// Reminder TEMPLATES are editable on every plan too. What remains Pro is the automatic
// 3-day/7-day reminder SWEEP (canUseEmailReminders, enforced in
// reviewRequestScheduler.server.ts — untouched by this page). Editing is customization;
// sending on a schedule is the paid capability. The reminder tabs therefore say "Sending
// requires Pro" rather than locking the editor, which is the honest description of what a
// Free merchant actually gets.
const TEMPLATE_TABS: Array<{ type: EmailTemplateType; label: string }> = [
  { type: "review_request", label: "Review Request" },
  { type: "reminder_1", label: "Reminder #1" },
  { type: "reminder_final", label: "Final Reminder" },
  { type: "reward", label: "Review Reward" },
];
const isReminderType = (type: EmailTemplateType) => type === "reminder_1" || type === "reminder_final";

// A logo renders small (see ReviewRequestEmail.tsx), so there is no reason to accept anything
// large; keeping this well under reviewMedia.server.ts's 5MB review-photo limit is deliberate.
const MAX_LOGO_SIZE_BYTES = 1 * 1024 * 1024;
// Raster formats are uploaded as-is. SVG is handled by a separate two-step path (validate +
// sanitize server-side, rasterize to PNG client-side) — see the validate-svg intent below and
// uploadLogoFile() in the component, which is why it is not in this list.
const ALLOWED_LOGO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const SVG_MIME_TYPE = "image/svg+xml";
/** A logo is a small drawing. Anything larger is almost certainly an embedded raster or a
 *  pathological file, and a browser has to parse this before rasterizing it. */
const MAX_SVG_SIZE_BYTES = 256 * 1024;

type LogoSlot = "light" | "dark";

type LoaderData = {
  type: EmailTemplateType;
  content: EmailTemplateContent;
  storeName: string;
  /** Gates the "Powered by Imagyn Reviews" toggle only — the single Pro field on this page. */
  canUseCustomBranding: boolean;
  /** Does NOT gate editing. Drives the "Sending requires Pro" note on the reminder tabs. */
  canUseEmailReminders: boolean;
  /** Branded Email Sender Identity — Pro. Gates saving a custom sender display name. */
  canUseBrandedEmailSender: boolean;
  /** The saved value, shown even to a downgraded store so their configuration is visible. */
  emailSenderName: string | null;
  /** What will actually be sent, entitlement already applied. */
  senderIdentity: SenderIdentity;
};

type ActionData =
  | { ok: true; intent: "save" }
  | { ok: true; intent: "save-sender-identity"; emailSenderName: string | null; senderIdentity: SenderIdentity }
  | { ok: true; intent: "reset"; content: EmailTemplateContent }
  | { ok: true; intent: "preview"; html: string }
  | { ok: true; intent: "upload-logo"; slot: LogoSlot; url: string }
  | { ok: true; intent: "validate-svg"; svg: string }
  | { ok: true; intent: "send-test"; to: string }
  | { ok: true; intent: "duplicate"; targetType: EmailTemplateType }
  | { ok: false; intent: string; error: string };

const readBool = (formData: FormData, key: string) => formData.get(key) !== "false";

const readInt = (formData: FormData, key: string, fallback: number) => {
  const parsed = Number.parseInt(String(formData.get(key) ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readSections = (formData: FormData): EmailSection[] => {
  const raw = String(formData.get("sections") || "");
  if (!raw) return normalizeEmailSections([]);
  try {
    return normalizeEmailSections(JSON.parse(raw));
  } catch {
    // A malformed payload falls back to the canonical order rather than failing the save —
    // normalizeEmailSections is the authority on what a valid list looks like either way.
    return normalizeEmailSections([]);
  }
};

/** Reads the posted form into a content object, then runs it through the shared normalizer so
 *  every bounded value is clamped and every enum validated server-side — the form is just a
 *  transport, never the authority on what is valid. */
const readContentFromForm = (formData: FormData, type: EmailTemplateType): EmailTemplateContent => {
  const defaults = getDefaultEmailTemplateContent(type);

  return normalizeEmailTemplateContent(
    {
      subject: String(formData.get("subject") || "").trim(),
      previewText: String(formData.get("previewText") || "").trim(),
      heading: String(formData.get("heading") || "").trim(),
      bodyText: String(formData.get("bodyText") || ""),
      closingText: String(formData.get("closingText") || ""),
      buttonText: String(formData.get("buttonText") || "").trim(),

      accentColor: String(formData.get("accentColor") || "").trim(),
      buttonTextColor: String(formData.get("buttonTextColor") || "").trim(),
      theme: String(formData.get("theme") || defaults.theme) as EmailTheme,
      fontFamily: String(formData.get("fontFamily") || defaults.fontFamily) as EmailFontFamily,
      headingSize: String(formData.get("headingSize") || defaults.headingSize) as EmailTextSize,
      bodySize: String(formData.get("bodySize") || defaults.bodySize) as EmailTextSize,
      density: String(formData.get("density") || defaults.density) as EmailDensity,
      contentWidth: readInt(formData, "contentWidth", defaults.contentWidth),
      cornerRadius: readInt(formData, "cornerRadius", defaults.cornerRadius),
      buttonStyle: String(formData.get("buttonStyle") || defaults.buttonStyle) as "filled" | "outline",
      buttonAlign: String(formData.get("buttonAlign") || defaults.buttonAlign) as EmailAlign,

      logoUrl: String(formData.get("logoUrl") || "").trim() || null,
      logoDarkUrl: String(formData.get("logoDarkUrl") || "").trim() || null,
      logoWidth: readInt(formData, "logoWidth", defaults.logoWidth),

      displayName: String(formData.get("displayName") || "").trim() || null,
      // Absent/anything-but-"false" defaults true — matches every other boolean form field
      // this app serializes (e.g. app.settings.tsx's reminderEmailsEnabled).
      showStoreName: readBool(formData, "showStoreName"),
      showProduct: readBool(formData, "showProduct"),
      showPoweredBy: readBool(formData, "showPoweredBy"),
      replyToEmail: String(formData.get("replyToEmail") || "").trim() || null,

      sections: readSections(formData),

      customHtmlEnabled: formData.get("customHtmlEnabled") === "true",
      // Sanitized at the save boundary so nothing dangerous is ever persisted. The render
      // path sanitizes again (templates.server.tsx) because persisted data is not trusted
      // just because it is persisted.
      customHtml: sanitizeEmailHtml(String(formData.get("customHtml") || "")),
    },
    type,
  );
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const readTypeFromForm = (formData: FormData): EmailTemplateType => {
  const raw = String(formData.get("type") || "review_request");
  return isEmailTemplateType(raw) ? raw : "review_request";
};

/** Returns every problem at once rather than the first, so a merchant fixes one round of
 *  errors instead of rediscovering them one save at a time. */
const validateContent = (content: EmailTemplateContent, type: EmailTemplateType): string[] => {
  const errors: string[] = [];

  if (!content.subject) errors.push("Subject can't be empty.");

  if (content.customHtmlEnabled) {
    if (!content.customHtml.trim()) errors.push("Custom HTML can't be empty while HTML mode is on.");
  } else {
    if (!content.heading) errors.push("Heading can't be empty.");
    if (!content.bodyText.trim()) errors.push("Email content can't be empty.");
  }

  if (!content.buttonText) errors.push("The review button needs text.");
  if (content.replyToEmail && !EMAIL_PATTERN.test(content.replyToEmail)) {
    errors.push("Reply-to must be a valid email address.");
  }

  // An unrecognized {{token}} is rendered literally rather than dropped (see
  // renderTemplateVariables), so catching it here is what stops "{{frist_name}}" reaching a
  // real customer's inbox.
  const unknown = new Set<string>();
  for (const field of [content.subject, content.previewText, content.heading, content.bodyText, content.closingText, content.customHtml]) {
    for (const token of findUnknownVariables(field, type)) unknown.add(token);
  }
  if (unknown.size > 0) {
    errors.push(
      `Unknown variable${unknown.size > 1 ? "s" : ""}: ${[...unknown].join(", ")}. Use the Insert variable buttons.`,
    );
  }

  return errors;
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const permissions = await getStorePermissions(store.id);

  const requested = new URL(request.url).searchParams.get("type");
  // Every template type is editable on every plan, so the only check here is that the
  // requested type actually exists.
  const type: EmailTemplateType = isEmailTemplateType(requested) ? requested : "review_request";

  const content = await emailTemplateService.getActiveContent(store.id, type);

  return {
    type,
    content,
    storeName: store.name,
    canUseCustomBranding: permissions.canUseCustomBranding,
    canUseEmailReminders: permissions.canUseEmailReminders,
    canUseBrandedEmailSender: permissions.canUseBrandedEmailSender,
    // The raw saved value, so a downgraded merchant still sees what they configured and can
    // tell it apart from never having set one. What will ACTUALLY be sent is senderIdentity
    // below, which applies the entitlement.
    emailSenderName: store.emailSenderName,
    senderIdentity: resolveSenderIdentity(store, permissions, content.replyToEmail),
  };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session, admin } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const formData = await request.formData();
  const intent = String(formData.get("_intent") || "");
  const type = readTypeFromForm(formData);

  try {
    const permissions = await getStorePermissions(store.id);

    // ---- Branded Email Sender Identity (Pro) -----------------------------------------
    // The entitlement is enforced HERE, on the server, before anything is written. Hiding
    // the field in the UI is a courtesy; this is what stops a Free store setting a branded
    // sender with a direct POST. resolveSenderIdentity enforces it a second time at send
    // time, so even a value saved during a Pro period stops applying after a downgrade.
    if (intent === "save-sender-identity") {
      if (!permissions.canUseBrandedEmailSender) {
        return {
          ok: false,
          intent,
          error: "A custom sender name requires the Pro plan.",
        };
      }

      const raw = String(formData.get("emailSenderName") || "");
      // Sanitised, not merely validated: this value ends up inside a mail header, so what
      // gets persisted is already free of CR/LF and the quoting characters.
      const sanitized = sanitizeSenderName(raw);

      if (raw.trim().length > 0 && sanitized === null) {
        return {
          ok: false,
          intent,
          error: "That sender name has no usable characters. Use your brand name as customers know it.",
        };
      }

      await updateEmailSenderName(store.id, sanitized);

      const content = await emailTemplateService.getActiveContent(store.id, type);
      return {
        ok: true,
        intent,
        emailSenderName: sanitized,
        senderIdentity: resolveSenderIdentity(
          { name: store.name, emailSenderName: sanitized },
          permissions,
          content.replyToEmail,
        ),
      };
    }

    // ---- Logo: SVG validation step -------------------------------------------------
    // Email clients do not render SVG, so an SVG logo can never be the asset the email
    // points at. This step validates and sanitizes the file server-side and hands the safe
    // markup back; the browser then rasterizes it to a PNG and uploads that through
    // upload-logo below. Validation is authoritative here, on the server — the client-side
    // rasterization is a convenience, never a security boundary.
    if (intent === "validate-svg") {
      const file = formData.get("logo");
      if (!(file instanceof File) || file.size === 0) {
        return { ok: false, intent, error: "Choose an SVG file to upload." };
      }
      if (file.size > MAX_SVG_SIZE_BYTES) {
        return { ok: false, intent, error: "SVG must be under 256KB." };
      }

      const svgText = await file.text();
      const rejection = validateSvgLogo(svgText);
      if (rejection) {
        return { ok: false, intent, error: `${rejection.reason} Please upload a PNG instead.` };
      }

      return { ok: true, intent: "validate-svg", svg: sanitizeSvgMarkup(svgText) };
    }

    // ---- Logo: raster upload -------------------------------------------------------
    if (intent === "upload-logo") {
      // Not persisted here — mirrors "preview": this only uploads the file and hands back a
      // URL. The merchant still has to hit Save for it to become the template's logo.
      const file = formData.get("logo");
      const slot: LogoSlot = formData.get("slot") === "dark" ? "dark" : "light";

      if (!(file instanceof File) || file.size === 0) {
        return { ok: false, intent, error: "Choose an image file to upload." };
      }
      if (!ALLOWED_LOGO_MIME_TYPES.includes(file.type)) {
        return { ok: false, intent, error: "Logo must be a JPEG, PNG, WebP or SVG image." };
      }
      if (file.size > MAX_LOGO_SIZE_BYTES) {
        return { ok: false, intent, error: "Logo must be under 1MB." };
      }

      const uploaded = await getStorageProvider().uploadImage(
        { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name || "logo", mimeType: file.type },
        { admin },
      );

      return { ok: true, intent: "upload-logo", slot, url: uploaded.url };
    }

    if (intent === "reset") {
      await emailTemplateService.resetToDefault(store.id, type);
      return { ok: true, intent: "reset", content: getDefaultEmailTemplateContent(type) };
    }

    const content = readContentFromForm(formData, type);
    const errors = validateContent(content, type);

    if (intent === "preview") {
      if (errors.length > 0) {
        return { ok: false, intent, error: errors[0] };
      }

      // The preview may be rendered in the opposite palette without changing what gets
      // saved, so a merchant can check both appearances before committing to one.
      const requestedPreviewTheme = String(formData.get("previewTheme") || "");
      const previewContent: EmailTemplateContent =
        requestedPreviewTheme === "light" || requestedPreviewTheme === "dark"
          ? { ...content, theme: requestedPreviewTheme as EmailTheme }
          : content;

      // Sample data only — never a real request/token, and nothing is persisted, so this is
      // safe to call on every draft change.
      const { html } = await buildReviewRequestEmail({
        customerName: "Jordan Avery",
        productName: "Sample Product",
        storeName: store.name,
        reviewUrl: "https://example.com/r/sample-token",
        discountCode: type === "reward" ? "SAMPLE-CODE" : undefined,
        customMessage: null,
        template: previewContent,
      });

      return { ok: true, intent: "preview", html };
    }

    if (intent === "send-test") {
      const to = String(formData.get("testEmail") || "").trim();
      if (!EMAIL_PATTERN.test(to)) {
        return { ok: false, intent, error: "Enter a valid email address to send the test to." };
      }
      if (errors.length > 0) {
        return { ok: false, intent, error: errors[0] };
      }

      // Sends the on-screen draft rather than the last saved version — testing what you are
      // looking at is the only behaviour that is actually useful here. Plan rules still
      // apply, so a Free store's test email carries the attribution footer exactly as a real
      // send would.
      const sanitizedDraft = sanitizeEmailTemplateContentForPlan(content, permissions);
      await sendTestReviewRequestEmail(to, store.id, store.name, {
        type,
        draft: sanitizedDraft,
        // Same sender the real send would use, so this test is a true preview of the From
        // header and not just the body.
        senderIdentity: resolveSenderIdentity(store, permissions, sanitizedDraft.replyToEmail),
      });

      return { ok: true, intent: "send-test", to };
    }

    if (intent === "duplicate") {
      // Copies this template's content onto another type. The data model keeps exactly one
      // active row per (store, type) — see EmailTemplate.isActive — so "duplicate" means
      // "reuse this design for another email", not "keep two versions of the same one".
      const rawTarget = String(formData.get("targetType") || "");
      if (!isEmailTemplateType(rawTarget)) {
        return { ok: false, intent, error: "Pick a template to copy into." };
      }
      if (rawTarget === type) {
        return { ok: false, intent, error: "Pick a different template to copy into." };
      }
      if (errors.length > 0) {
        return { ok: false, intent, error: errors[0] };
      }

      await emailTemplateService.upsertActive(store.id, {
        content: sanitizeEmailTemplateContentForPlan(content, permissions),
        type: rawTarget,
      });

      return { ok: true, intent: "duplicate", targetType: rawTarget };
    }

    if (intent === "save") {
      if (errors.length > 0) {
        return { ok: false, intent, error: errors.join(" ") };
      }

      // Server-side entitlement enforcement, not just the UI disabling the one Pro control —
      // see sanitizeEmailTemplateContentForPlan's own comment.
      await emailTemplateService.upsertActive(store.id, {
        content: sanitizeEmailTemplateContentForPlan(content, permissions),
        type,
      });

      return { ok: true, intent: "save" };
    }

    return { ok: false, intent, error: "Unsupported action." };
  } catch (error) {
    console.error(`[app.email-studio] action "${intent}" failed:`, error);
    return {
      ok: false,
      intent,
      error: error instanceof Error ? error.message : "Something went wrong. Please try again.",
    };
  }
};

// Only two intents change what the loader reads back: save and reset. The others (preview,
// logo upload, SVG validation, test send, duplicate-into-another-template) leave this
// template's persisted row untouched, so revalidating after them is pure waste — and, before
// the draft-reset fix above, actively harmful.
export function shouldRevalidate({ formData, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  const intent = formData?.get("_intent");
  if (typeof intent === "string") {
    return intent === "save" || intent === "reset";
  }
  return defaultShouldRevalidate;
}

type PreviewMode = "desktop" | "mobile";

const THEME_OPTIONS: Array<{ value: EmailTheme; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const FONT_OPTIONS: Array<{ value: EmailFontFamily; label: string }> = [
  { value: "sans", label: "Sans (Helvetica)" },
  { value: "serif", label: "Serif (Georgia)" },
  { value: "mono", label: "Mono" },
];

const SIZE_OPTIONS: Array<{ value: EmailTextSize; label: string }> = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

const DENSITY_OPTIONS: Array<{ value: EmailDensity; label: string }> = [
  { value: "compact", label: "Compact" },
  { value: "normal", label: "Normal" },
  { value: "relaxed", label: "Relaxed" },
];

/**
 * Rasterizes a sanitized SVG to a PNG blob in the browser.
 *
 * Email clients do not render SVG, so a PNG is the only logo an inbox will reliably show —
 * this is the "fallback" half of SVG support, not an optimization. Done client-side because
 * the browser already has a renderer; adding a native rasterizer (sharp/resvg) to the server
 * for one small image would be a heavy dependency on every deploy.
 *
 * Safe despite handling merchant input: the SVG has already been validated and sanitized
 * server-side, and scripts inside an SVG loaded through <img> do not execute in any browser.
 * Rendered at 3x the display width so the logo stays sharp on retina displays.
 */
async function rasterizeSvgToPng(svgMarkup: string, displayWidth: number): Promise<Blob> {
  const blob = new Blob([svgMarkup], { type: SVG_MIME_TYPE });
  const url = URL.createObjectURL(blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("The SVG could not be rendered."));
      element.src = url;
    });

    const scale = 3;
    const naturalWidth = image.naturalWidth || displayWidth;
    const naturalHeight = image.naturalHeight || displayWidth;
    const targetWidth = displayWidth * scale;
    const targetHeight = Math.round((naturalHeight / naturalWidth) * targetWidth);

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("The SVG could not be rendered.");
    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("The SVG could not be converted to PNG."))),
        "image/png",
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function EmailStudioPage() {
  const {
    type: activeType,
    content: initialContent,
    storeName,
    canUseCustomBranding,
    canUseEmailReminders,
    canUseBrandedEmailSender,
    emailSenderName,
    senderIdentity,
  } = useLoaderData<typeof loader>();

  const saveFetcher = useFetcher<ActionData>();
  const resetFetcher = useFetcher<ActionData>();
  const previewFetcher = useFetcher<ActionData>();
  const uploadFetcher = useFetcher<ActionData>();
  const testFetcher = useFetcher<ActionData>();
  const duplicateFetcher = useFetcher<ActionData>();
  const senderFetcher = useFetcher<ActionData>();

  const [draft, setDraft] = useState<EmailTemplateContent>(initialContent);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  /** Which palette the preview pane shows. Starts at the draft's own theme and can be flipped
   *  to inspect the other one without changing what will be saved. */
  const [previewTheme, setPreviewTheme] = useState<EmailTheme>(initialContent.theme);
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [duplicateTarget, setDuplicateTarget] = useState<EmailTemplateType>(
    activeType === "review_request" ? "reminder_1" : "review_request",
  );
  const [uploadingSlot, setUploadingSlot] = useState<LogoSlot | null>(null);

  const isBusy =
    saveFetcher.state !== "idle" ||
    resetFetcher.state !== "idle" ||
    uploadFetcher.state !== "idle" ||
    testFetcher.state !== "idle" ||
    duplicateFetcher.state !== "idle" ||
    uploadingSlot !== null;

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(initialContent),
    [draft, initialContent],
  );

  const variables = useMemo(() => variablesForType(activeType), [activeType]);

  const validationErrors = useMemo(() => validateContent(draft, activeType), [draft, activeType]);

  // Reset local state only when a DIFFERENT template is loaded — switching tabs is a
  // navigation, so the draft must follow it rather than leaking one template's edits into
  // another's editor.
  //
  // Keyed on activeType, deliberately NOT on the initialContent object. useLoaderData returns
  // a fresh object identity after every revalidation, and a non-GET fetcher submission
  // revalidates by default — so depending on it made the debounced preview POST (which fires
  // 400ms after any edit) reset the draft to the last saved values. The visible symptom was
  // the Custom HTML and light/dark toggles snapping back a moment after being clicked, and
  // typed text silently reverting. Fix 2 below stops the needless revalidation; this stops the
  // clobber even when a revalidation is legitimate.
  const loadedType = useRef(activeType);
  useEffect(() => {
    if (loadedType.current === activeType) return;
    loadedType.current = activeType;
    setDraft(initialContent);
    setPreviewTheme(initialContent.theme);
  }, [activeType, initialContent]);

  const updateField = <K extends keyof EmailTemplateContent>(key: K, value: EmailTemplateContent[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const toFormData = (extra: Record<string, string> = {}): FormData => {
    const formData = new FormData();
    formData.set("type", activeType);
    formData.set("subject", draft.subject);
    formData.set("previewText", draft.previewText);
    formData.set("heading", draft.heading);
    formData.set("bodyText", draft.bodyText);
    formData.set("closingText", draft.closingText);
    formData.set("buttonText", draft.buttonText);
    formData.set("accentColor", draft.accentColor);
    formData.set("buttonTextColor", draft.buttonTextColor);
    formData.set("theme", draft.theme);
    formData.set("fontFamily", draft.fontFamily);
    formData.set("headingSize", draft.headingSize);
    formData.set("bodySize", draft.bodySize);
    formData.set("density", draft.density);
    formData.set("contentWidth", String(draft.contentWidth));
    formData.set("cornerRadius", String(draft.cornerRadius));
    formData.set("buttonStyle", draft.buttonStyle);
    formData.set("buttonAlign", draft.buttonAlign);
    formData.set("logoUrl", draft.logoUrl ?? "");
    formData.set("logoDarkUrl", draft.logoDarkUrl ?? "");
    formData.set("logoWidth", String(draft.logoWidth));
    formData.set("displayName", draft.displayName ?? "");
    formData.set("showStoreName", String(draft.showStoreName));
    formData.set("showProduct", String(draft.showProduct));
    formData.set("showPoweredBy", String(draft.showPoweredBy));
    formData.set("replyToEmail", draft.replyToEmail ?? "");
    formData.set("sections", JSON.stringify(draft.sections));
    formData.set("customHtmlEnabled", String(draft.customHtmlEnabled));
    formData.set("customHtml", draft.customHtml);
    for (const [key, value] of Object.entries(extra)) formData.set(key, value);
    return formData;
  };

  // Re-render the preview as the draft settles. Debounced because every keystroke would
  // otherwise be a server round-trip that renders a whole email.
  useEffect(() => {
    const timer = setTimeout(() => {
      // A draft that fails validation is rejected by the preview action, so submitting it
      // only burns a round-trip and leaves the pane showing a stale render.
      if (validationErrors.length > 0) return;
      previewFetcher.submit(toFormData({ _intent: "preview", previewTheme }), { method: "post" });
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, previewTheme, activeType, validationErrors.length]);

  useEffect(() => {
    if (previewFetcher.data?.ok && previewFetcher.data.intent === "preview") {
      setPreviewHtml(previewFetcher.data.html);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewFetcher.data]);

  useEffect(() => {
    const result = saveFetcher.data;
    if (!result) return;
    setToast(result.ok ? { content: "Email template saved." } : { content: result.error, error: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFetcher.data]);

  useEffect(() => {
    const result = resetFetcher.data;
    if (!result) return;
    if (result.ok && result.intent === "reset") {
      setDraft(result.content);
      setToast({ content: "Restored the default template." });
    } else if (!result.ok) {
      setToast({ content: result.error, error: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetFetcher.data]);

  useEffect(() => {
    const result = uploadFetcher.data;
    if (!result) return;
    if (result.ok && result.intent === "upload-logo") {
      updateField(result.slot === "dark" ? "logoDarkUrl" : "logoUrl", result.url);
      setToast({ content: "Logo uploaded. Save to apply it." });
    } else if (!result.ok) {
      setToast({ content: result.error, error: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadFetcher.data]);

  useEffect(() => {
    const result = testFetcher.data;
    if (!result) return;
    setToast(
      result.ok && result.intent === "send-test"
        ? { content: `Test email sent to ${result.to}.` }
        : { content: result.ok ? "Test email sent." : result.error, error: !result.ok },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testFetcher.data]);

  useEffect(() => {
    const result = duplicateFetcher.data;
    if (!result) return;
    if (result.ok && result.intent === "duplicate") {
      const label = TEMPLATE_TABS.find((tab) => tab.type === result.targetType)?.label ?? "template";
      setToast({ content: `Copied into ${label}.` });
    } else if (!result.ok) {
      setToast({ content: result.error, error: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duplicateFetcher.data]);

  /** Raster files upload directly. An SVG goes through the server for validation and
   *  sanitization first, then is rasterized to a PNG here, because no mainstream email client
   *  renders SVG — the PNG is what actually reaches the inbox. */
  const uploadLogoFile = async (file: File, slot: LogoSlot) => {
    if (file.type !== SVG_MIME_TYPE) {
      const formData = new FormData();
      formData.set("_intent", "upload-logo");
      formData.set("type", activeType);
      formData.set("slot", slot);
      formData.set("logo", file);
      uploadFetcher.submit(formData, { method: "post", encType: "multipart/form-data" });
      return;
    }

    if (file.size > MAX_SVG_SIZE_BYTES) {
      setToast({ content: "SVG must be under 256KB.", error: true });
      return;
    }

    setUploadingSlot(slot);
    try {
      const validateForm = new FormData();
      validateForm.set("_intent", "validate-svg");
      validateForm.set("type", activeType);
      validateForm.set("logo", file);

      const response = await fetch(window.location.pathname + window.location.search, {
        method: "POST",
        body: validateForm,
      });
      const result = (await response.json()) as ActionData;

      if (!result.ok || result.intent !== "validate-svg") {
        setToast({ content: result.ok ? "Could not read that SVG." : result.error, error: true });
        return;
      }

      const png = await rasterizeSvgToPng(result.svg, draft.logoWidth);
      const uploadForm = new FormData();
      uploadForm.set("_intent", "upload-logo");
      uploadForm.set("type", activeType);
      uploadForm.set("slot", slot);
      uploadForm.set("logo", new File([png], (file.name || "logo").replace(/\.svg$/i, "") + ".png", { type: "image/png" }));
      uploadFetcher.submit(uploadForm, { method: "post", encType: "multipart/form-data" });
    } catch (error) {
      setToast({
        content: error instanceof Error ? error.message : "Could not convert that SVG. Please upload a PNG.",
        error: true,
      });
    } finally {
      setUploadingSlot(null);
    }
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      const next = [...current.sections];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, sections: next };
    });
  };

  const toggleSection = (id: EmailSectionId) => {
    setDraft((current) => ({
      ...current,
      sections: normalizeEmailSections(
        current.sections.map((section) => (section.id === id ? { ...section, enabled: !section.enabled } : section)),
      ),
    }));
  };

  const insertVariable = (field: "subject" | "previewText" | "heading" | "bodyText" | "closingText" | "customHtml", token: string) => {
    setDraft((current) => ({ ...current, [field]: `${current[field]}${current[field] ? " " : ""}${token}` }));
  };

  const [senderNameDraft, setSenderNameDraft] = useState(emailSenderName ?? "");
  // The identity the server last confirmed. Held in state rather than read straight from the
  // loader so the inbox preview updates the moment a save succeeds, without a full reload.
  const [savedIdentity, setSavedIdentity] = useState(senderIdentity);
  const [senderError, setSenderError] = useState<string | null>(null);
  const isSavingSender = senderFetcher.state !== "idle";

  useEffect(() => {
    const data = senderFetcher.data;
    if (!data) return;
    if (!data.ok) {
      if (data.intent === "save-sender-identity") setSenderError(data.error);
      return;
    }
    if (data.intent === "save-sender-identity") {
      setSenderError(null);
      setSenderNameDraft(data.emailSenderName ?? "");
      setSavedIdentity(data.senderIdentity);
    }
  }, [senderFetcher.data]);

  const senderNameDirty = (emailSenderName ?? "") !== senderNameDraft;

  // What the inbox will show once saved — the typed name while editing, falling back to the
  // real store name exactly as resolveSenderIdentity would.
  const previewSenderName =
    canUseBrandedEmailSender && senderNameDraft.trim().length > 0 ? senderNameDraft.trim() : storeName;

  const submitIntent = (fetcher: ReturnType<typeof useFetcher<ActionData>>, intent: string, extra: Record<string, string> = {}) => {
    fetcher.submit(toFormData({ _intent: intent, ...extra }), { method: "post" });
  };

  return (
    <Frame>
      <div className={shellStyles.page}>
        <Container>
          <SettingsBreadcrumb current="Email Studio" />

          <div className={styles.previewToggle} role="tablist" aria-label="Email template">
            {TEMPLATE_TABS.map((tab) => {
              const isActive = tab.type === activeType;
              const sendingNeedsPro = isReminderType(tab.type) && !canUseEmailReminders;
              return (
                <Link
                  key={tab.type}
                  to={`/app/email-studio?type=${tab.type}`}
                  role="tab"
                  aria-selected={isActive}
                  className={`${styles.previewToggleButton} ${isActive ? styles.previewToggleActive : ""}`}
                  onClick={(event) => {
                    // Unsaved edits would be lost by the navigation, so make that explicit
                    // rather than silently discarding the merchant's work.
                    if (isDirty && !window.confirm("You have unsaved changes. Leave this template?")) {
                      event.preventDefault();
                    }
                  }}
                >
                  {tab.label}
                  {sendingNeedsPro ? <span className={styles.lockedTag}>Sending: Pro</span> : null}
                </Link>
              );
            })}
          </div>

          <div className={styles.layout}>
            <div className={styles.editorColumn}>
              {isReminderType(activeType) && !canUseEmailReminders ? (
                <Card className={styles.proCard}>
                  <p className={styles.proEyebrow}>Editable now · Sending needs Pro</p>
                  <ul className={styles.proList}>
                    <li>
                      You can write and save this reminder on any plan. Automatic sending (3 and 7 days after
                      fulfilment) starts when you upgrade — nothing here is lost in the meantime.
                    </li>
                  </ul>
                </Card>
              ) : null}

              <Section title="Delivery" description="What shows in the inbox before the email is opened.">
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="subject">
                    Subject line
                  </label>
                  <input
                    id="subject"
                    className={styles.textInput}
                    value={draft.subject}
                    onChange={(event) => updateField("subject", event.target.value)}
                    disabled={isBusy}
                  />
                  <VariableRow variables={variables} onInsert={(token) => insertVariable("subject", token)} disabled={isBusy} />
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="previewText">
                    Preview text
                  </label>
                  <input
                    id="previewText"
                    className={styles.textInput}
                    value={draft.previewText}
                    onChange={(event) => updateField("previewText", event.target.value)}
                    disabled={isBusy}
                  />
                  <p className={styles.fieldHint}>
                    The snippet most inboxes show next to the subject. Leave empty to reuse the subject.
                  </p>
                  <VariableRow variables={variables} onInsert={(token) => insertVariable("previewText", token)} disabled={isBusy} />
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="replyToEmail">
                    Reply-to address
                  </label>
                  <input
                    id="replyToEmail"
                    className={styles.textInput}
                    type="email"
                    value={draft.replyToEmail ?? ""}
                    onChange={(event) => updateField("replyToEmail", event.target.value || null)}
                    placeholder="support@yourstore.com"
                    disabled={isBusy}
                  />
                  <p className={styles.fieldHint}>
                    Where customer replies land, for this template. The sender ADDRESS stays on our verified domain —
                    changing that needs your own domain verified, which this app doesn&apos;t support yet. The sender
                    NAME is set under Sender identity.
                  </p>
                </div>
              </Section>

              <div className={styles.modeToggle} role="tablist" aria-label="Editor mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={!draft.customHtmlEnabled}
                  className={`${styles.previewToggleButton} ${!draft.customHtmlEnabled ? styles.previewToggleActive : ""}`}
                  onClick={() => updateField("customHtmlEnabled", false)}
                  disabled={isBusy}
                >
                  Visual
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={draft.customHtmlEnabled}
                  className={`${styles.previewToggleButton} ${draft.customHtmlEnabled ? styles.previewToggleActive : ""}`}
                  onClick={() => updateField("customHtmlEnabled", true)}
                  disabled={isBusy}
                >
                  Custom HTML
                </button>
              </div>

              {draft.customHtmlEnabled ? (
                <Section title="Custom HTML" description="Full control over the email body.">
                  <div className={styles.fieldGroup}>
                    <textarea
                      id="customHtml"
                      className={styles.htmlEditor}
                      value={draft.customHtml}
                      onChange={(event) => updateField("customHtml", event.target.value)}
                      rows={16}
                      spellCheck={false}
                      disabled={isBusy}
                    />
                    <VariableRow variables={variables} onInsert={(token) => insertVariable("customHtml", token)} disabled={isBusy} />
                    <p className={styles.fieldHint}>
                      Scripts, event handlers, stylesheets and unsafe links are removed when you save — your markup is
                      cleaned, not rejected. The unsubscribe link and the review button&apos;s fallback URL are always
                      appended below your HTML, so the email stays compliant.
                    </p>
                  </div>
                </Section>
              ) : (
                <>
                  <Section title="Content" description="What the customer reads before clicking through.">
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel} htmlFor="heading">
                        Heading
                      </label>
                      <input
                        id="heading"
                        className={styles.textInput}
                        value={draft.heading}
                        onChange={(event) => updateField("heading", event.target.value)}
                        disabled={isBusy}
                      />
                      <VariableRow variables={variables} onInsert={(token) => insertVariable("heading", token)} disabled={isBusy} />
                    </div>

                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel} htmlFor="bodyText">
                        Message
                      </label>
                      <textarea
                        id="bodyText"
                        className={styles.textArea}
                        value={draft.bodyText}
                        onChange={(event) => updateField("bodyText", event.target.value)}
                        rows={7}
                        disabled={isBusy}
                      />
                      <p className={styles.fieldHint}>Leave a blank line between paragraphs.</p>
                      <VariableRow variables={variables} onInsert={(token) => insertVariable("bodyText", token)} disabled={isBusy} />
                    </div>

                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel} htmlFor="buttonText">
                        Button text
                      </label>
                      <input
                        id="buttonText"
                        className={styles.textInput}
                        value={draft.buttonText}
                        onChange={(event) => updateField("buttonText", event.target.value)}
                        disabled={isBusy}
                      />
                    </div>

                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel} htmlFor="closingText">
                        Closing
                      </label>
                      <textarea
                        id="closingText"
                        className={styles.textArea}
                        value={draft.closingText}
                        onChange={(event) => updateField("closingText", event.target.value)}
                        rows={3}
                        disabled={isBusy}
                      />
                      <VariableRow variables={variables} onInsert={(token) => insertVariable("closingText", token)} disabled={isBusy} />
                    </div>
                  </Section>

                  <Section title="Sections" description="Reorder or hide the blocks of the email body.">
                    <ul className={styles.sectionList}>
                      {draft.sections.map((section, index) => {
                        const required = section.id === "button";
                        return (
                          <li key={section.id} className={styles.sectionRow} data-disabled={!section.enabled}>
                            <span className={styles.sectionName}>{EMAIL_SECTION_LABELS[section.id]}</span>
                            <div className={styles.sectionActions}>
                              <button
                                type="button"
                                className={styles.iconButton}
                                aria-label={`Move ${EMAIL_SECTION_LABELS[section.id]} up`}
                                onClick={() => moveSection(index, -1)}
                                disabled={isBusy || index === 0}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className={styles.iconButton}
                                aria-label={`Move ${EMAIL_SECTION_LABELS[section.id]} down`}
                                onClick={() => moveSection(index, 1)}
                                disabled={isBusy || index === draft.sections.length - 1}
                              >
                                ↓
                              </button>
                              <label className={styles.checkboxRow}>
                                <input
                                  type="checkbox"
                                  checked={section.enabled}
                                  onChange={() => toggleSection(section.id)}
                                  disabled={isBusy || required}
                                />
                                <span>{required ? "Always on" : "Show"}</span>
                              </label>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <p className={styles.fieldHint}>
                      The review button can&apos;t be hidden — without it the email has no way to leave a review. The
                      product block only appears when the order actually has product details.
                    </p>
                  </Section>
                </>
              )}

              {/* Sender identity — who the email comes FROM, as distinct from the Branding
                  section below, which is what the email looks like once opened. */}
              <Section
                title="Sender identity"
                description="Who this email appears to come from in your customer's inbox."
              >
                <div className={styles.fieldGroup}>
                  <div className={styles.poweredByRow}>
                    <label className={styles.fieldLabel} htmlFor="emailSenderName">
                      Sender name
                    </label>
                    {!canUseBrandedEmailSender ? <span className={styles.lockedTag}>Pro</span> : null}
                  </div>
                  <input
                    id="emailSenderName"
                    className={styles.textInput}
                    value={senderNameDraft}
                    maxLength={MAX_SENDER_NAME_LENGTH}
                    onChange={(event) => setSenderNameDraft(event.target.value)}
                    placeholder={storeName}
                    disabled={isSavingSender || !canUseBrandedEmailSender}
                  />
                  <p className={styles.fieldHint}>
                    {canUseBrandedEmailSender
                      ? `The name customers see in their inbox. Leave empty to use your store name (${storeName}).`
                      : `On the Free plan emails are sent as your store name (${storeName}). Pro lets you use your brand name instead.`}
                  </p>
                  {senderError ? <p className={styles.fieldError}>{senderError}</p> : null}
                </div>

                {/* Stated plainly rather than implied. A merchant who expects their own
                    address here should find out now, not after a deliverability problem. */}
                <div className={styles.fieldGroup}>
                  <span className={styles.fieldLabel}>From address</span>
                  <p className={styles.senderIdentityNote}>
                    {savedIdentity.fromAddressConfigured ? (
                      <>
                        <strong>{savedIdentity.fromAddress}</strong> — verified sending domain.
                      </>
                    ) : (
                      <>No verified sending address is configured. Review emails cannot be sent until one is.</>
                    )}
                  </p>
                  <p className={styles.fieldHint}>
                    This address is shared and always verified, which is what keeps your emails out of spam. Sending
                    from your own domain would need that domain verified first, which this app doesn&apos;t support
                    yet — so replies are the supported way to reach your own inbox.
                  </p>
                </div>

                <div className={styles.fieldGroup}>
                  <span className={styles.fieldLabel}>Reply-to</span>
                  <p className={styles.senderIdentityNote}>
                    {savedIdentity.replyTo ? (
                      <strong>{savedIdentity.replyTo}</strong>
                    ) : (
                      <>Not set — replies go to the shared address above.</>
                    )}
                  </p>
                  <p className={styles.fieldHint}>Set this per template under Delivery.</p>
                </div>

                {/* A realistic inbox row, so the merchant sees the combination rather than
                    three separate fields they have to assemble in their head. */}
                <div className={styles.fieldGroup}>
                  <span className={styles.fieldLabel}>How it appears in the inbox</span>
                  <div className={styles.inboxPreview}>
                    {draft.logoUrl ? (
                      <img className={styles.inboxPreviewAvatar} src={draft.logoUrl} alt="" />
                    ) : (
                      <span className={styles.inboxPreviewAvatar} aria-hidden="true">
                        {previewSenderName.trim().charAt(0).toUpperCase() || "S"}
                      </span>
                    )}
                    <span className={styles.inboxPreviewBody}>
                      <span className={styles.inboxPreviewSender}>{previewSenderName}</span>
                      <span className={styles.inboxPreviewSubject}>
                        {draft.subject.replace(/\{\{\s*store_name\s*\}\}/g, previewSenderName) || "(no subject)"}
                      </span>
                      <span className={styles.inboxPreviewSnippet}>
                        {draft.previewText || draft.subject || ""}
                      </span>
                    </span>
                  </div>
                </div>

                {canUseBrandedEmailSender ? (
                  <div className={styles.actionsRow}>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() =>
                        submitIntent(senderFetcher, "save-sender-identity", { emailSenderName: senderNameDraft })
                      }
                      disabled={isSavingSender || !senderNameDirty}
                    >
                      {isSavingSender ? "Saving…" : "Save sender name"}
                    </Button>
                    {senderNameDirty ? <span className={styles.fieldHint}>Unsaved</span> : null}
                  </div>
                ) : null}
              </Section>

              <Section title="Branding" description="Logo, store name, and how the email body reads.">
                <p className={styles.senderIdentityNote}>
                  These change what the email looks like once opened. Who it comes from is set above.
                </p>

                <LogoField
                  slot="light"
                  label="Logo (light background)"
                  url={draft.logoUrl}
                  busy={isBusy}
                  uploading={uploadingSlot === "light"}
                  onPick={(file) => uploadLogoFile(file, "light")}
                  onClear={() => updateField("logoUrl", null)}
                />

                <LogoField
                  slot="dark"
                  label="Logo (dark background)"
                  url={draft.logoDarkUrl}
                  busy={isBusy}
                  uploading={uploadingSlot === "dark"}
                  onPick={(file) => uploadLogoFile(file, "dark")}
                  onClear={() => updateField("logoDarkUrl", null)}
                  hint="Used when the email theme is dark. Falls back to the light logo if empty."
                />

                <RangeField
                  id="logoWidth"
                  label="Logo width"
                  value={draft.logoWidth}
                  min={LOGO_WIDTH_RANGE.min}
                  max={LOGO_WIDTH_RANGE.max}
                  suffix="px"
                  disabled={isBusy}
                  onChange={(value) => updateField("logoWidth", value)}
                />

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="displayName">
                    Display name
                  </label>
                  <input
                    id="displayName"
                    className={styles.textInput}
                    value={draft.displayName ?? ""}
                    onChange={(event) => updateField("displayName", event.target.value || null)}
                    placeholder={storeName}
                    disabled={isBusy}
                  />
                  <p className={styles.fieldHint}>
                    Shown inside the email and used by {"{{store_name}}"}. Leave empty to use &ldquo;{storeName}&rdquo;.
                  </p>
                </div>

                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={draft.showStoreName}
                    onChange={(event) => updateField("showStoreName", event.target.checked)}
                    disabled={isBusy}
                  />
                  <span>Show the store name above the heading</span>
                </label>

                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={draft.showProduct}
                    onChange={(event) => updateField("showProduct", event.target.checked)}
                    disabled={isBusy}
                  />
                  <span>Show the purchased product when available</span>
                </label>

                <div className={styles.fieldGroup}>
                  <div className={styles.poweredByRow}>
                    <label className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={!draft.showPoweredBy}
                        onChange={(event) => updateField("showPoweredBy", !event.target.checked)}
                        disabled={isBusy || !canUseCustomBranding}
                      />
                      <span>Remove &ldquo;Powered by Imagyn Reviews&rdquo;</span>
                    </label>
                    {!canUseCustomBranding ? <span className={styles.lockedTag}>Pro</span> : null}
                  </div>
                  <p className={styles.fieldHint}>
                    Everything else on this page is free. Removing our attribution is part of custom branding.
                  </p>
                </div>
              </Section>

              <Section title="Design" description="Colour, type, and layout of the email.">
                <div className={styles.optionGrid}>
                  <SelectField
                    id="theme"
                    label="Appearance"
                    value={draft.theme}
                    options={THEME_OPTIONS}
                    disabled={isBusy}
                    onChange={(value) => {
                      updateField("theme", value);
                      setPreviewTheme(value);
                    }}
                  />
                  <SelectField
                    id="fontFamily"
                    label="Typeface"
                    value={draft.fontFamily}
                    options={FONT_OPTIONS}
                    disabled={isBusy}
                    onChange={(value) => updateField("fontFamily", value)}
                  />
                  <SelectField
                    id="headingSize"
                    label="Heading size"
                    value={draft.headingSize}
                    options={SIZE_OPTIONS}
                    disabled={isBusy}
                    onChange={(value) => updateField("headingSize", value)}
                  />
                  <SelectField
                    id="bodySize"
                    label="Body size"
                    value={draft.bodySize}
                    options={SIZE_OPTIONS}
                    disabled={isBusy}
                    onChange={(value) => updateField("bodySize", value)}
                  />
                  <SelectField
                    id="density"
                    label="Spacing"
                    value={draft.density}
                    options={DENSITY_OPTIONS}
                    disabled={isBusy}
                    onChange={(value) => updateField("density", value)}
                  />
                  <SelectField
                    id="buttonStyle"
                    label="Button style"
                    value={draft.buttonStyle}
                    options={[
                      { value: "filled" as const, label: "Filled" },
                      { value: "outline" as const, label: "Outline" },
                    ]}
                    disabled={isBusy}
                    onChange={(value) => updateField("buttonStyle", value)}
                  />
                  <SelectField
                    id="buttonAlign"
                    label="Button alignment"
                    value={draft.buttonAlign}
                    options={[
                      { value: "left" as const, label: "Left" },
                      { value: "center" as const, label: "Centre" },
                    ]}
                    disabled={isBusy}
                    onChange={(value) => updateField("buttonAlign", value)}
                  />
                </div>

                <RangeField
                  id="contentWidth"
                  label="Content width"
                  value={draft.contentWidth}
                  min={CONTENT_WIDTH_RANGE.min}
                  max={CONTENT_WIDTH_RANGE.max}
                  step={10}
                  suffix="px"
                  disabled={isBusy}
                  onChange={(value) => updateField("contentWidth", value)}
                />

                <RangeField
                  id="cornerRadius"
                  label="Corner radius"
                  value={draft.cornerRadius}
                  min={CORNER_RADIUS_RANGE.min}
                  max={CORNER_RADIUS_RANGE.max}
                  suffix="px"
                  disabled={isBusy}
                  onChange={(value) => updateField("cornerRadius", value)}
                />

                <ColorField
                  label="Accent colour"
                  value={draft.accentColor}
                  onChange={(value) => updateField("accentColor", value)}
                />
                <ColorField
                  label="Button text colour"
                  value={draft.buttonTextColor}
                  onChange={(value) => updateField("buttonTextColor", value)}
                />
              </Section>

              {validationErrors.length > 0 ? (
                <Card className={styles.validationCard}>
                  <p className={styles.validationTitle}>Fix before saving</p>
                  <ul className={styles.validationList}>
                    {validationErrors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              <Section title="Test & reuse" description="Send yourself a copy, or reuse this design elsewhere.">
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="testEmail">
                    Send a test to
                  </label>
                  <div className={styles.inlineRow}>
                    <input
                      id="testEmail"
                      className={styles.textInput}
                      type="email"
                      value={testEmail}
                      onChange={(event) => setTestEmail(event.target.value)}
                      placeholder="you@yourstore.com"
                      disabled={isBusy}
                    />
                    <Button
                      variant="secondary"
                      onClick={() => submitIntent(testFetcher, "send-test", { testEmail })}
                      disabled={isBusy || validationErrors.length > 0 || !testEmail}
                    >
                      {testFetcher.state !== "idle" ? "Sending…" : "Send test"}
                    </Button>
                  </div>
                  <p className={styles.fieldHint}>
                    Sends exactly what&apos;s on screen right now, including unsaved changes, with sample customer data.
                  </p>
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="duplicateTarget">
                    Copy this design into
                  </label>
                  <div className={styles.inlineRow}>
                    <select
                      id="duplicateTarget"
                      className={styles.selectInput}
                      value={duplicateTarget}
                      onChange={(event) => setDuplicateTarget(event.target.value as EmailTemplateType)}
                      disabled={isBusy}
                    >
                      {TEMPLATE_TABS.filter((tab) => tab.type !== activeType).map((tab) => (
                        <option key={tab.type} value={tab.type}>
                          {tab.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="secondary"
                      onClick={() => submitIntent(duplicateFetcher, "duplicate", { targetType: duplicateTarget })}
                      disabled={isBusy || validationErrors.length > 0}
                    >
                      Copy
                    </Button>
                  </div>
                  <p className={styles.fieldHint}>
                    Overwrites that template with this one&apos;s content and styling. Its own copy is replaced.
                  </p>
                </div>
              </Section>

              <div className={styles.actionsBar}>
                <Button onClick={() => submitIntent(saveFetcher, "save")} disabled={isBusy || !isDirty || validationErrors.length > 0}>
                  {saveFetcher.state !== "idle" ? "Saving…" : "Save"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (window.confirm("Replace this template with the original default?")) {
                      submitIntent(resetFetcher, "reset");
                    }
                  }}
                  disabled={isBusy}
                >
                  Restore default
                </Button>
                <span className={styles.statusTag} data-dirty={isDirty}>
                  {isDirty ? "Unsaved changes" : "All changes saved"}
                </span>
              </div>
            </div>

            <aside className={styles.previewColumn}>
              <div className={styles.previewHeader}>
                <p className={styles.previewLabel}>Preview</p>
                <div className={styles.previewToggle}>
                  {(["desktop", "mobile"] as PreviewMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`${styles.previewToggleButton} ${previewMode === mode ? styles.previewToggleActive : ""}`}
                      onClick={() => setPreviewMode(mode)}
                    >
                      {mode === "desktop" ? "Desktop" : "Mobile"}
                    </button>
                  ))}
                </div>
                <div className={styles.previewToggle}>
                  {THEME_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`${styles.previewToggleButton} ${previewTheme === option.value ? styles.previewToggleActive : ""}`}
                      onClick={() => setPreviewTheme(option.value)}
                      aria-pressed={previewTheme === option.value}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.previewFrame} data-mode={previewMode}>
                {validationErrors.length > 0 ? (
                  <div className={styles.previewPaused}>
                    <p className={styles.previewPausedTitle}>Preview paused</p>
                    <p className={styles.previewPausedBody}>
                      {validationErrors.length === 1
                        ? "Fix the issue listed above and the preview will update."
                        : `Fix the ${validationErrors.length} issues listed above and the preview will update.`}
                    </p>
                  </div>
                ) : previewHtml ? (
                  // sandbox="" gives the frame a unique opaque origin with scripts, forms and
                  // navigation all disabled. The HTML inside is already sanitized server-side;
                  // this is the second layer, so that even a sanitizer bypass cannot reach the
                  // merchant's authenticated admin session from inside this preview.
                  <iframe
                    title="Email preview"
                    srcDoc={previewHtml}
                    className={styles.previewIframe}
                    sandbox=""
                  />
                ) : (
                  <div className={styles.previewSkeleton} aria-hidden="true" />
                )}
              </div>
              <p className={styles.previewNote}>
                Sample data from &ldquo;{storeName}&rdquo;
                {previewTheme !== draft.theme ? ` · previewing ${previewTheme} (saved appearance stays ${draft.theme})` : ""}.
              </p>
            </aside>
          </div>
        </Container>
      </div>

      <ContextualSaveBar
        id="email-studio-save-bar"
        open={isDirty}
        saving={saveFetcher.state !== "idle"}
        onSave={() => submitIntent(saveFetcher, "save")}
        onDiscard={() => setDraft(initialContent)}
      />

      <div className={styles.toastFrame}>
        {toast ? (
          <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} duration={4000} />
        ) : null}
      </div>
    </Frame>
  );
}

function VariableRow({
  variables,
  onInsert,
  disabled,
}: {
  variables: Array<{ token: string; describe: string }>;
  onInsert: (token: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className={styles.variableRow}>
      {variables.map((variable) => (
        <button
          key={variable.token}
          type="button"
          className={styles.variableChip}
          title={variable.describe}
          onClick={() => onInsert(variable.token)}
          disabled={disabled}
        >
          {variable.token}
        </button>
      ))}
    </div>
  );
}

function SelectField<T extends string>({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className={styles.selectInput}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        disabled={disabled}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function RangeField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
        <span className={styles.rangeValue}>
          {value}
          {suffix}
        </span>
      </label>
      <input
        id={id}
        type="range"
        className={styles.rangeInput}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number.parseInt(event.target.value, 10))}
        disabled={disabled}
      />
    </div>
  );
}

function LogoField({
  slot,
  label,
  url,
  busy,
  uploading,
  onPick,
  onClear,
  hint,
}: {
  slot: LogoSlot;
  label: string;
  url: string | null;
  busy: boolean;
  uploading: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel} htmlFor={`logoUpload-${slot}`}>
        {label}
      </label>
      <div className={styles.logoUploadRow} data-slot={slot}>
        {url ? (
          <img src={url} alt="" className={styles.logoPreview} />
        ) : (
          <div className={styles.logoPreviewEmpty} aria-hidden="true" />
        )}
        <div className={styles.logoUploadControls}>
          <input
            id={`logoUpload-${slot}`}
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/svg+xml"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onPick(file);
              // Cleared so re-picking the same file fires onChange again.
              event.target.value = "";
            }}
          />
          <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
            {uploading ? "Converting…" : url ? "Replace" : "Upload"}
          </Button>
          {url ? (
            <Button variant="secondary" onClick={onClear} disabled={busy}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      <p className={styles.fieldHint}>
        {hint ? `${hint} ` : ""}
        PNG, JPEG, WebP or SVG, under 1MB. SVGs are checked for embedded scripts and converted to PNG, because email
        clients don&apos;t render SVG.
      </p>
    </div>
  );
}
