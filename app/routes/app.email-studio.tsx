import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Frame, Toast } from "@shopify/polaris";

import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ColorField } from "../components/ui/ColorField";
import { Container } from "../components/ui/Container";
import { Section } from "../components/ui/Section";
import { SettingsBreadcrumb } from "../components/ui/SettingsBreadcrumb";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { getStorePermissions } from "../services/permissions";
import { emailTemplateService } from "../services/emailTemplate.server";
import { buildReviewRequestEmail } from "../services/notifications/templates.server";
import { getStorageProvider } from "../services/storage/provider.server";
import {
  EMAIL_TEMPLATE_VARIABLES,
  getDefaultEmailTemplateContent,
  sanitizeEmailTemplateContentForPlan,
  type EmailTemplateContent,
  type EmailTemplateType,
} from "../services/email.shared";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.email-studio.module.css";

// Review Request and Reward are available on every plan (Review Rewards' base functionality
// is deliberately Free — see app.settings.rewards.tsx); the two reminder types are Pro-only
// (canUseEmailReminders) — see the loader/action's own gating below.
const TEMPLATE_TABS: Array<{ type: EmailTemplateType; label: string }> = [
  { type: "review_request", label: "Review Request" },
  { type: "reminder_1", label: "Reminder #1" },
  { type: "reminder_final", label: "Final Reminder" },
  { type: "reward", label: "Review Reward" },
];
const ALLOWED_TYPES: EmailTemplateType[] = TEMPLATE_TABS.map((tab) => tab.type);
const isReminderType = (type: EmailTemplateType) => type === "reminder_1" || type === "reminder_final";

// A logo renders tiny (see ReviewRequestEmail.tsx — capped at 40px tall in the actual email),
// so there's no reason to accept anything large; keeping this well under
// reviewMedia.server.ts's 5MB review-photo limit is deliberate, not copied from it.
const MAX_LOGO_SIZE_BYTES = 1 * 1024 * 1024;
// No SVG — email clients have famously inconsistent/poor inline-SVG support, so accepting one
// here would just produce logos that silently fail to render in a real inbox.
const ALLOWED_LOGO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

type LoaderData = {
  type: EmailTemplateType;
  content: EmailTemplateContent;
  storeName: string;
  canUseAdvancedEmailStudio: boolean;
  canUseEmailReminders: boolean;
  canUseCustomBranding: boolean;
};

type ActionData =
  | { ok: true; intent: "save" }
  | { ok: true; intent: "reset"; content: EmailTemplateContent }
  | { ok: true; intent: "preview"; html: string }
  | { ok: true; intent: "upload-logo"; url: string }
  | { ok: false; intent: string; error: string };

const readContentFromForm = (formData: FormData): EmailTemplateContent => ({
  subject: String(formData.get("subject") || "").trim(),
  heading: String(formData.get("heading") || "").trim(),
  bodyText: String(formData.get("bodyText") || "").trim(),
  buttonText: String(formData.get("buttonText") || "").trim(),
  accentColor: String(formData.get("accentColor") || "").trim(),
  logoUrl: String(formData.get("logoUrl") || "").trim() || null,
  displayName: String(formData.get("displayName") || "").trim() || null,
  // Absent/anything-but-"false" defaults true — matches every other boolean form field this
  // app already serializes this way (e.g. app.settings.tsx's reminderEmailsEnabled).
  showStoreName: formData.get("showStoreName") !== "false",
  showPoweredBy: formData.get("showPoweredBy") !== "false",
});

const readTypeFromForm = (formData: FormData): EmailTemplateType => {
  const raw = String(formData.get("type") || "review_request");
  return (ALLOWED_TYPES as string[]).includes(raw) ? (raw as EmailTemplateType) : "review_request";
};

const validateContent = (content: EmailTemplateContent): string | null => {
  if (!content.subject) return "Subject can't be empty.";
  if (!content.heading) return "Heading can't be empty.";
  if (!content.bodyText) return "Email content can't be empty.";
  if (!content.buttonText) return "The review button needs text.";
  if (!/^#[0-9a-fA-F]{6}$/.test(content.accentColor)) return "Accent color must be a valid hex color.";
  return null;
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const permissions = await getStorePermissions(store.id);

  // A Free store hitting ?type=reminder_1 directly (e.g. a stale bookmark after a downgrade)
  // falls back to the Review Request template rather than editing content it can't use —
  // mirrors the action's own server-side enforcement below.
  const requestedType = new URL(request.url).searchParams.get("type");
  const type: EmailTemplateType =
    requestedType &&
    (ALLOWED_TYPES as string[]).includes(requestedType) &&
    (!isReminderType(requestedType as EmailTemplateType) || permissions.canUseEmailReminders)
      ? (requestedType as EmailTemplateType)
      : "review_request";

  const content = await emailTemplateService.getActiveContent(store.id, type);

  return {
    type,
    content,
    storeName: store.name,
    canUseAdvancedEmailStudio: permissions.canUseAdvancedEmailStudio,
    canUseEmailReminders: permissions.canUseEmailReminders,
    canUseCustomBranding: permissions.canUseCustomBranding,
  };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session, admin } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const formData = await request.formData();
  const intent = String(formData.get("_intent") || "");
  const type = readTypeFromForm(formData);

  try {
    // Server-side enforcement — not just the UI hiding the Reminder #1 / Final Reminder tabs
    // below — so a Free store can never save/reset/preview a reminder-type template by posting
    // directly, same convention as canUseAdvancedEmailStudio's sanitize step further down.
    const permissions = await getStorePermissions(store.id);
    if (isReminderType(type) && !permissions.canUseEmailReminders) {
      return { ok: false, intent, error: "Reminder email templates require the Pro plan." };
    }

    if (intent === "upload-logo") {
      // Not persisted here — mirrors "preview": this only uploads the file and hands back a
      // URL, the same way the draft's other fields work. The merchant still has to hit Save
      // for it to become the real template's logoUrl.
      const file = formData.get("logo");
      if (!(file instanceof File) || file.size === 0) {
        return { ok: false, intent, error: "Choose an image file to upload." };
      }
      if (!ALLOWED_LOGO_MIME_TYPES.includes(file.type)) {
        return { ok: false, intent, error: "Logo must be a JPEG, PNG, or WebP image." };
      }
      if (file.size > MAX_LOGO_SIZE_BYTES) {
        return { ok: false, intent, error: "Logo must be under 1MB." };
      }

      const uploaded = await getStorageProvider().uploadImage(
        {
          buffer: Buffer.from(await file.arrayBuffer()),
          filename: file.name || "logo",
          mimeType: file.type,
        },
        { admin },
      );

      return { ok: true, intent: "upload-logo", url: uploaded.url };
    }

    if (intent === "reset") {
      await emailTemplateService.resetToDefault(store.id, type);
      return { ok: true, intent: "reset", content: getDefaultEmailTemplateContent(type) };
    }

    const content = readContentFromForm(formData);
    const error = validateContent(content);

    if (intent === "preview") {
      // Sample data only — this never touches a real request/token, and nothing here is
      // persisted, so it's safe to call on every draft change.
      if (error) {
        return { ok: false, intent, error };
      }

      const { html } = await buildReviewRequestEmail({
        customerName: "Jordan Avery",
        productName: "Sample Product",
        storeName: store.name,
        reviewUrl: "https://example.com/r/sample-token",
        // Sample-only, matching the sample-token URL's own "never real" convention — a
        // reward preview needs *some* code to show {{discount_code}} substituted, but this
        // string is never a real, redeemable Shopify discount.
        discountCode: type === "reward" ? "SAMPLE-CODE" : undefined,
        customMessage: null,
        template: content,
      });

      return { ok: true, intent: "preview", html };
    }

    if (intent === "save") {
      if (error) {
        return { ok: false, intent, error };
      }

      // Server-side enforcement of canUseAdvancedEmailStudio/canUseCustomBranding, not just
      // the UI hiding/disabling the corresponding controls below — see
      // sanitizeEmailTemplateContentForPlan's own comment.
      const safeContent = sanitizeEmailTemplateContentForPlan(content, permissions);

      await emailTemplateService.upsertActive(store.id, { content: safeContent, type });
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

type PreviewMode = "desktop" | "mobile";

export default function EmailStudioPage() {
  const {
    type: activeType,
    content: initialContent,
    storeName,
    canUseAdvancedEmailStudio,
    canUseEmailReminders,
    canUseCustomBranding,
  } = useLoaderData<typeof loader>();

  const saveFetcher = useFetcher<ActionData>();
  const resetFetcher = useFetcher<ActionData>();
  const previewFetcher = useFetcher<ActionData>();
  const logoFetcher = useFetcher<ActionData>();

  const [draft, setDraft] = useState<EmailTemplateContent>(initialContent);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);

  const isSaving = saveFetcher.state !== "idle";
  const isResetting = resetFetcher.state !== "idle";
  const isUploadingLogo = logoFetcher.state !== "idle";
  const isBusy = isSaving || isResetting;

  const handleLogoUpload = (file: File) => {
    const formData = new FormData();
    formData.set("_intent", "upload-logo");
    formData.set("type", activeType);
    formData.set("logo", file);
    logoFetcher.submit(formData, { method: "post", encType: "multipart/form-data" });
  };

  useEffect(() => {
    const result = logoFetcher.data;
    if (!result) return;
    if (!result.ok) {
      setToast({ content: result.error, error: true });
      return;
    }
    if (result.intent === "upload-logo") {
      setDraft((prev) => ({ ...prev, logoUrl: result.url }));
      setToast({ content: "Logo uploaded." });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logoFetcher.data]);

  // Switching tabs (a real navigation to ?type=...) re-runs the loader with new content, but
  // doesn't remount this component — sync the draft to match whenever the active type changes,
  // the same way a fresh page load would have initialized it.
  useEffect(() => {
    setDraft(initialContent);
    setPreviewHtml(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType]);

  const updateField = <K extends keyof EmailTemplateContent>(key: K, value: EmailTemplateContent[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const insertVariable = (key: "subject" | "heading" | "bodyText", token: string) => {
    setDraft((prev) => ({ ...prev, [key]: `${prev[key]}${prev[key].endsWith(" ") || !prev[key] ? "" : " "}${token}` }));
  };

  const handleSave = () => {
    const formData = new FormData();
    formData.set("_intent", "save");
    formData.set("type", activeType);
    Object.entries(draft).forEach(([key, value]) => formData.set(key, value ?? ""));
    saveFetcher.submit(formData, { method: "post" });
  };

  const handleReset = () => {
    const formData = new FormData();
    formData.set("_intent", "reset");
    formData.set("type", activeType);
    resetFetcher.submit(formData, { method: "post" });
  };

  useEffect(() => {
    if (!saveFetcher.data) return;
    if (!saveFetcher.data.ok) {
      setToast({ content: saveFetcher.data.error, error: true });
      return;
    }
    if (saveFetcher.data.intent === "save") {
      setToast({ content: "Email Studio saved." });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFetcher.data]);

  useEffect(() => {
    if (!resetFetcher.data) return;
    if (!resetFetcher.data.ok) {
      setToast({ content: resetFetcher.data.error, error: true });
      return;
    }
    if (resetFetcher.data.intent === "reset") {
      setDraft(resetFetcher.data.content);
      setToast({ content: "Reset to the default template." });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetFetcher.data]);

  useEffect(() => {
    if (previewFetcher.data?.ok && previewFetcher.data.intent === "preview") {
      setPreviewHtml(previewFetcher.data.html);
    }
  }, [previewFetcher.data]);

  // Debounced live preview — re-renders the real email template on the server (React Email
  // isn't a browser-safe API) every time the draft settles for 400ms, rather than on every
  // keystroke.
  const draftKey = useMemo(() => JSON.stringify(draft), [draft]);
  const previewFetcherRef = useRef(previewFetcher);
  previewFetcherRef.current = previewFetcher;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const formData = new FormData();
      formData.set("_intent", "preview");
      formData.set("type", activeType);
      Object.entries(draft).forEach(([key, value]) => formData.set(key, value ?? ""));
      previewFetcherRef.current.submit(formData, { method: "post" });
    }, 400);

    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, activeType]);

  const hasUnsavedChanges = JSON.stringify(draft) !== JSON.stringify(initialContent);

  return (
    <>
      <Container as="main">
        <div className={shellStyles.page}>
          <header className={shellStyles.header}>
            <div className={shellStyles.headerContent}>
              <SettingsBreadcrumb current="Email Studio" />
              <h1 className={shellStyles.title}>Email Studio</h1>
              <p className={shellStyles.subtitle}>
                Customize the emails your customers receive — subject, message, branding, and the review link.
              </p>
            </div>
          </header>

          <div className={styles.previewToggle} role="tablist" aria-label="Email template">
            {TEMPLATE_TABS.map((tab) => {
              const locked = isReminderType(tab.type) && !canUseEmailReminders;
              return (
                <Link
                  key={tab.type}
                  to={tab.type === "review_request" ? "?" : `?type=${tab.type}`}
                  role="tab"
                  aria-selected={activeType === tab.type}
                  className={`${styles.previewToggleButton} ${activeType === tab.type ? styles.previewToggleActive : ""}`}
                  onClick={(event) => {
                    if (locked) {
                      event.preventDefault();
                      return;
                    }
                    if (hasUnsavedChanges && !window.confirm("Discard unsaved changes to this template?")) {
                      event.preventDefault();
                    }
                  }}
                >
                  {tab.label}
                  {locked ? <span className={styles.lockedTag}>Pro</span> : null}
                </Link>
              );
            })}
          </div>

          <div className={styles.layout}>
            <div className={styles.editorColumn}>
              <Section title="Content" description="What the customer reads before clicking through to leave a review.">
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="subject">
                    Subject line
                  </label>
                  <input
                    id="subject"
                    className={styles.textInput}
                    type="text"
                    value={draft.subject}
                    onChange={(event) => updateField("subject", event.target.value)}
                    disabled={isBusy}
                  />
                  <VariableRow onInsert={(token) => insertVariable("subject", token)} disabled={isBusy} />
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="heading">
                    Heading
                  </label>
                  <input
                    id="heading"
                    className={styles.textInput}
                    type="text"
                    value={draft.heading}
                    onChange={(event) => updateField("heading", event.target.value)}
                    disabled={isBusy}
                  />
                  <VariableRow onInsert={(token) => insertVariable("heading", token)} disabled={isBusy} />
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="bodyText">
                    Message
                  </label>
                  <textarea
                    id="bodyText"
                    className={styles.textArea}
                    rows={4}
                    value={draft.bodyText}
                    onChange={(event) => updateField("bodyText", event.target.value)}
                    disabled={isBusy}
                  />
                  <VariableRow onInsert={(token) => insertVariable("bodyText", token)} disabled={isBusy} />
                  {activeType === "review_request" ? (
                    <p className={styles.fieldHint}>
                      A merchant note added to an individual request always overrides this default message for that
                      one send. Reminder emails always use this template's own message.
                    </p>
                  ) : null}
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="buttonText">
                    Review button text
                  </label>
                  <input
                    id="buttonText"
                    className={styles.textInput}
                    type="text"
                    value={draft.buttonText}
                    onChange={(event) => updateField("buttonText", event.target.value)}
                    disabled={isBusy}
                  />
                </div>
              </Section>

              <Section title="Branding" description="Store logo, name, and accent color.">
                <p className={styles.senderIdentityNote}>
                  Emails send as <strong>&ldquo;{storeName}&rdquo;</strong> — customers see your store name as the
                  sender, not Imagyn Reviews. They&apos;re delivered through Imagyn&apos;s email infrastructure;
                  sending from your own domain isn&apos;t available yet.
                </p>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="logoUpload">
                    Logo
                  </label>
                  <div className={styles.logoUploadRow}>
                    {draft.logoUrl ? (
                      <img src={draft.logoUrl} alt="" className={styles.logoPreview} />
                    ) : (
                      <div className={styles.logoPreviewEmpty} aria-hidden="true" />
                    )}
                    <div className={styles.logoUploadControls}>
                      <input
                        id="logoUpload"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={isBusy || isUploadingLogo}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) handleLogoUpload(file);
                          event.target.value = "";
                        }}
                      />
                      {draft.logoUrl ? (
                        <Button type="button" variant="ghost" onClick={() => updateField("logoUrl", null)} disabled={isBusy}>
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <p className={styles.fieldHint}>
                    {isUploadingLogo
                      ? "Uploading…"
                      : "JPEG, PNG, or WebP, under 1MB. Shown at a fixed height with its original aspect ratio preserved. Leave empty to show no logo — the store name below still identifies you."}
                  </p>
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="displayName">
                    Store name shown in email
                  </label>
                  <input
                    id="displayName"
                    className={styles.textInput}
                    type="text"
                    placeholder={storeName}
                    value={draft.displayName ?? ""}
                    onChange={(event) => updateField("displayName", event.target.value || null)}
                    disabled={isBusy || !draft.showStoreName}
                  />
                  <p className={styles.fieldHint}>
                    Optional — shows instead of &quot;{storeName}&quot; in the email itself. The email is still sent
                    from your store&apos;s real identity either way.
                  </p>
                </div>

                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={draft.showStoreName}
                    onChange={(event) => updateField("showStoreName", event.target.checked)}
                    disabled={isBusy}
                  />
                  Show store name in the email
                </label>

                <div className={styles.fieldGroup}>
                  <div className={styles.poweredByRow}>
                    <label className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={canUseCustomBranding ? !draft.showPoweredBy : false}
                        onChange={(event) => updateField("showPoweredBy", !event.target.checked)}
                        disabled={isBusy || !canUseCustomBranding}
                      />
                      Remove &quot;Powered by Imagyn Reviews&quot;
                    </label>
                    {!canUseCustomBranding ? <span className={styles.lockedTag}>Pro</span> : null}
                  </div>
                  <p className={styles.fieldHint}>
                    {canUseCustomBranding
                      ? "Off by default. When checked, the small footer attribution line is removed from this email."
                      : 'Free stores always show the small "Powered by Imagyn Reviews" footer line. Upgrade to Pro to remove it.'}
                  </p>
                </div>

                <ColorField label="Accent color" value={draft.accentColor} onChange={(value) => updateField("accentColor", value)} />
              </Section>

              <div className={styles.actionsBar}>
                <Button type="button" variant="ghost" onClick={handleReset} disabled={isBusy}>
                  {isResetting ? "Resetting…" : "Reset to default"}
                </Button>
                <Button type="button" variant="primary" onClick={handleSave} disabled={isBusy || !hasUnsavedChanges}>
                  {isSaving ? "Saving…" : "Save"}
                </Button>
              </div>

              {canUseEmailReminders ? null : (
                <Card className={styles.proCard}>
                  <p className={styles.proEyebrow}>Upgrade to Pro</p>
                  <ul className={styles.proList}>
                    <li>Reminder #1 and Final Reminder emails (3 &amp; 7 days, automatic)</li>
                    <li>Independent templates for each email</li>
                  </ul>
                </Card>
              )}

              {canUseAdvancedEmailStudio ? null : (
                <Card className={styles.proCard}>
                  <p className={styles.proEyebrow}>Coming to Pro</p>
                  <ul className={styles.proList}>
                    <li>Advanced layout &amp; styling control</li>
                  </ul>
                </Card>
              )}
            </div>

            <aside className={styles.previewColumn}>
              <div className={styles.previewHeader}>
                <p className={styles.previewLabel}>Preview</p>
                <div className={styles.previewToggle}>
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
              </div>
              <div className={styles.previewFrame} data-mode={previewMode}>
                {previewHtml ? (
                  <iframe title="Email preview" srcDoc={previewHtml} className={styles.previewIframe} />
                ) : (
                  <div className={styles.previewSkeleton} aria-hidden="true" />
                )}
              </div>
              <p className={styles.previewNote}>Preview uses sample data from &ldquo;{storeName}&rdquo;.</p>
            </aside>
          </div>
        </div>
      </Container>

      {/* Frame exists solely to satisfy Toast's required-ancestor context — see .toastFrame
          in app.email-studio.module.css for why it needs a layout override. */}
      <div className={styles.toastFrame}>
        <Frame>
          {toast ? <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} /> : null}
        </Frame>
      </div>
    </>
  );
}

function VariableRow({ onInsert, disabled }: { onInsert: (token: string) => void; disabled: boolean }) {
  return (
    <div className={styles.variableRow}>
      {EMAIL_TEMPLATE_VARIABLES.map((variable) => (
        <button
          key={variable.token}
          type="button"
          className={styles.variableChip}
          onClick={() => onInsert(variable.token)}
          disabled={disabled}
          title={variable.describe}
        >
          {variable.token}
        </button>
      ))}
    </div>
  );
}
