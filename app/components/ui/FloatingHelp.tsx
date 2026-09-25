import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher, useLocation } from "react-router";
import { Modal, Select, TextField } from "@shopify/polaris";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_INBOX,
  type SupportActionData,
} from "../../services/supportRequest.shared";
import styles from "./floating-help.module.css";

// The app's single support surface, present on every /app/* screen via app.tsx's shell.
//
// "Contact Support" used to be a mailto: link. Inside Shopify's embedded admin that navigates
// the app's own iframe to a mailto: URL, which the frame's sandbox refuses — the merchant just
// saw "This content is blocked. Contact the site owner to fix the issue." It now opens a form
// in the app and posts to /app/support, which sends the mail server-side. Nothing leaves the
// admin, no new tab, no mail client.
//
// There is still no help centre, chat, or ticketing backend, and none is invented here: this
// sends one email to one inbox and tells the merchant it was sent.

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.3 9.6a2.7 2.7 0 0 1 5.2.9c0 1.8-2.5 2.3-2.5 3.6" />
      <circle cx="12" cy="17.1" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 3 3 10.5l7 2.5 2.5 7L21 3z" />
      <path d="M12.5 13.5 21 3" />
    </svg>
  );
}

function SuccessIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.3 10.8 15 16 9.5" />
    </svg>
  );
}

const CATEGORY_OPTIONS = [
  { label: "Select a category (optional)", value: "" },
  ...SUPPORT_CATEGORIES.map((category) => ({ label: category, value: category })),
];

export interface FloatingHelpProps {
  /** Store display name, shown in the panel so the merchant can see which store they're
   *  writing about. The support email's own copy of it is resolved server-side. */
  storeName?: string | null;
}

export function FloatingHelp({ storeName = null }: FloatingHelpProps) {
  const [open, setOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("");
  const [sent, setSent] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();

  const fetcher = useFetcher<SupportActionData>();
  const isSending = fetcher.state !== "idle";
  // The server's own message when it rejected the request. Kept distinct from fieldError so a
  // client-side "fill this in" note never looks like a delivery failure.
  const serverError = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setSent(true);
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (!open) {
      return;
    }

    firstItemRef.current?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    // Only closes the little popover. While the form modal is open, Polaris owns Escape for
    // the dialog itself, so this listener deliberately stands down.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !formOpen) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, formOpen]);

  const openForm = () => {
    setOpen(false);
    setSent(false);
    setFieldError(null);
    setFormOpen(true);
  };

  // Deliberately does NOT clear subject/message: if the merchant closes the modal mid-draft,
  // reopening it should still have their words. They're only cleared after a successful send.
  const closeForm = useCallback(() => {
    setFormOpen(false);
    setFieldError(null);
    if (sent) {
      setSubject("");
      setMessage("");
      setCategory("");
      setSent(false);
    }
  }, [sent]);

  const handleSubmit = () => {
    if (!subject.trim()) {
      setFieldError("Enter a subject.");
      return;
    }
    if (!message.trim()) {
      setFieldError("Enter a message.");
      return;
    }

    setFieldError(null);
    const formData = new FormData();
    formData.set("subject", subject);
    formData.set("message", message);
    formData.set("category", category);
    // Path only — the embedded app's query string carries App Bridge session parameters
    // (host, id_token, hmac) and must never be sent anywhere.
    formData.set("appSection", location.pathname);
    fetcher.submit(formData, { method: "post", action: "/app/support" });
  };

  return (
    <>
      <div className={styles.wrap} ref={wrapRef}>
        {open ? (
          <div className={styles.panel} role="dialog" aria-label="Support">
            <div className={styles.panelHeader}>
              <p className={styles.panelTitle}>Need help?</p>
              <p className={styles.panelText}>Our support team is here to help.</p>
              {storeName ? <p className={styles.panelText}>Writing about {storeName}</p> : null}
            </div>

            <button ref={firstItemRef} type="button" className={styles.primaryItem} onClick={openForm}>
              <span className={styles.itemIcon}>
                <HelpIcon />
              </span>
              Contact Support
            </button>

            <button type="button" className={styles.item} onClick={openForm}>
              <span className={styles.itemIcon}>
                <SendIcon />
              </span>
              Send Feedback
            </button>
          </div>
        ) : null}
        <button
          ref={triggerRef}
          type="button"
          className={`${styles.trigger} ${open ? styles.triggerOpen : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Help and support"
          onClick={() => setOpen((value) => !value)}
        >
          <HelpIcon />
        </button>
      </div>

      {/* Polaris Modal rather than a bespoke dialog: it already handles the focus trap,
          Escape, scroll lock and portal correctly inside the embedded admin iframe, and it is
          the same modal component this app already uses for review imports. */}
      <Modal
        open={formOpen}
        onClose={closeForm}
        title={sent ? "Support request sent" : "Contact Support"}
        primaryAction={
          sent
            ? { content: "Close", onAction: closeForm }
            : {
                content: isSending ? "Sending…" : "Send request",
                onAction: handleSubmit,
                loading: isSending,
                disabled: isSending,
              }
        }
        secondaryActions={sent ? undefined : [{ content: "Cancel", onAction: closeForm, disabled: isSending }]}
      >
        <Modal.Section>
          {sent ? (
            <div className={styles.supportSuccess}>
              <span className={styles.supportSuccessIcon}>
                <SuccessIcon />
              </span>
              <p className={styles.supportSuccessTitle}>Support request sent</p>
              <p className={styles.supportSuccessText}>
                Thanks. Our support team will get back to you at the email associated with your store.
              </p>
            </div>
          ) : (
            <div className={styles.supportForm}>
              <p className={styles.supportIntro}>
                Tell us what you need help with and our support team will get back to you.
              </p>

              {serverError ? (
                <div className={styles.supportError} role="alert">
                  <p className={styles.supportErrorTitle}>Couldn&apos;t send your request</p>
                  <p className={styles.supportErrorText}>{serverError}</p>
                </div>
              ) : null}

              <TextField
                label="Subject"
                value={subject}
                onChange={setSubject}
                autoComplete="off"
                maxLength={200}
                requiredIndicator
                disabled={isSending}
                error={fieldError === "Enter a subject." ? fieldError : undefined}
                placeholder="A short summary of what you need"
              />

              <Select
                label="Category"
                options={CATEGORY_OPTIONS}
                value={category}
                onChange={setCategory}
                disabled={isSending}
              />

              <TextField
                label="Message"
                value={message}
                onChange={setMessage}
                autoComplete="off"
                multiline={6}
                maxLength={5000}
                requiredIndicator
                disabled={isSending}
                error={fieldError === "Enter a message." ? fieldError : undefined}
                placeholder="What's happening, and what were you trying to do?"
              />

              <p className={styles.supportFootnote}>
                Your store name, shop domain, plan and current page are included automatically so we have the
                context to help. Goes to {SUPPORT_INBOX}.
              </p>
            </div>
          )}
        </Modal.Section>
      </Modal>
    </>
  );
}
