import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Frame, Toast } from "@shopify/polaris";

import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ColorField } from "../components/ui/ColorField";
import { Container } from "../components/ui/Container";
import { Section } from "../components/ui/Section";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { getStorePermissions } from "../services/permissions";
import { emailTemplateService } from "../services/emailTemplate.server";
import { buildReviewRequestEmail } from "../services/notifications/templates.server";
import {
  EMAIL_TEMPLATE_VARIABLES,
  getDefaultEmailTemplateContent,
  sanitizeEmailTemplateContentForPlan,
  type EmailTemplateContent,
} from "../services/email.shared";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.email-studio.module.css";

type LoaderData = {
  content: EmailTemplateContent;
  storeName: string;
  canUseAdvancedEmailStudio: boolean;
};

type ActionData =
  | { ok: true; intent: "save" }
  | { ok: true; intent: "reset"; content: EmailTemplateContent }
  | { ok: true; intent: "preview"; html: string }
  | { ok: false; intent: string; error: string };

const readContentFromForm = (formData: FormData): EmailTemplateContent => ({
  subject: String(formData.get("subject") || "").trim(),
  heading: String(formData.get("heading") || "").trim(),
  bodyText: String(formData.get("bodyText") || "").trim(),
  buttonText: String(formData.get("buttonText") || "").trim(),
  accentColor: String(formData.get("accentColor") || "").trim(),
  logoUrl: String(formData.get("logoUrl") || "").trim() || null,
});

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
  const [permissions, content] = await Promise.all([
    getStorePermissions(store.id),
    emailTemplateService.getActiveContent(store.id),
  ]);

  return {
    content,
    storeName: store.name,
    canUseAdvancedEmailStudio: permissions.canUseAdvancedEmailStudio,
  };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const formData = await request.formData();
  const intent = String(formData.get("_intent") || "");

  try {
    if (intent === "reset") {
      await emailTemplateService.resetToDefault(store.id);
      return { ok: true, intent: "reset", content: getDefaultEmailTemplateContent() };
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
        customMessage: null,
        template: content,
      });

      return { ok: true, intent: "preview", html };
    }

    if (intent === "save") {
      if (error) {
        return { ok: false, intent, error };
      }

      // Server-side enforcement of canUseAdvancedEmailStudio, not just the UI hiding the
      // "Coming to Pro" card below — see sanitizeEmailTemplateContentForPlan's own comment.
      const permissions = await getStorePermissions(store.id);
      const safeContent = sanitizeEmailTemplateContentForPlan(content, permissions.canUseAdvancedEmailStudio);

      await emailTemplateService.upsertActive(store.id, { content: safeContent });
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
  const { content: initialContent, storeName, canUseAdvancedEmailStudio } = useLoaderData<typeof loader>();

  const saveFetcher = useFetcher<ActionData>();
  const resetFetcher = useFetcher<ActionData>();
  const previewFetcher = useFetcher<ActionData>();

  const [draft, setDraft] = useState<EmailTemplateContent>(initialContent);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);

  const isSaving = saveFetcher.state !== "idle";
  const isResetting = resetFetcher.state !== "idle";
  const isBusy = isSaving || isResetting;

  const updateField = <K extends keyof EmailTemplateContent>(key: K, value: EmailTemplateContent[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const insertVariable = (key: "subject" | "heading" | "bodyText", token: string) => {
    setDraft((prev) => ({ ...prev, [key]: `${prev[key]}${prev[key].endsWith(" ") || !prev[key] ? "" : " "}${token}` }));
  };

  const handleSave = () => {
    const formData = new FormData();
    formData.set("_intent", "save");
    Object.entries(draft).forEach(([key, value]) => formData.set(key, value ?? ""));
    saveFetcher.submit(formData, { method: "post" });
  };

  const handleReset = () => {
    const formData = new FormData();
    formData.set("_intent", "reset");
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
      Object.entries(draft).forEach(([key, value]) => formData.set(key, value ?? ""));
      previewFetcherRef.current.submit(formData, { method: "post" });
    }, 400);

    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  const hasUnsavedChanges = JSON.stringify(draft) !== JSON.stringify(initialContent);

  return (
    <>
      <Container as="main">
        <div className={shellStyles.page}>
          <header className={shellStyles.header}>
            <div className={shellStyles.headerContent}>
              <p className={shellStyles.eyebrow}>Imagyn Reviews</p>
              <h1 className={shellStyles.title}>Email Studio</h1>
              <p className={shellStyles.subtitle}>
                Customize the review-request email your customers receive — subject, message, branding, and the
                review link.
              </p>
            </div>
          </header>

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
                  <p className={styles.fieldHint}>
                    A merchant note added to an individual request always overrides this default message for that
                    one send.
                  </p>
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

              <Section title="Branding" description="Store logo and accent color basics.">
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="logoUrl">
                    Logo URL
                  </label>
                  <input
                    id="logoUrl"
                    className={styles.textInput}
                    type="text"
                    placeholder="https://…"
                    value={draft.logoUrl ?? ""}
                    onChange={(event) => updateField("logoUrl", event.target.value || null)}
                    disabled={isBusy}
                  />
                  <p className={styles.fieldHint}>
                    Paste a link to a hosted image (e.g. from your Shopify files). Leave blank to use the default
                    mark.
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

              {canUseAdvancedEmailStudio ? null : (
                <Card className={styles.proCard}>
                  <p className={styles.proEyebrow}>Coming to Pro</p>
                  <ul className={styles.proList}>
                    <li>Multiple email templates &amp; themes</li>
                    <li>A dedicated follow-up / reminder email</li>
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

      <Frame>
        {toast ? <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} /> : null}
      </Frame>
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
