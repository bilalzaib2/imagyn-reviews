import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Checkbox, Frame, Toast } from "@shopify/polaris";
import { Section } from "../components/ui/Section";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { getStorePermissions } from "../services/permissions";
import { getFeedReadiness, setGoogleFeedEnabled, type FeedReadiness } from "../services/googleReviewFeed.server";
import buttonStyles from "../components/ui/button.module.css";
import styles from "../styles/app.management.module.css";

// Settings > Growth > Google, SEO & AI — a real status page, not a settings form: every item
// here either already works (structured data, AI summaries, the review feed below — all
// genuinely shipped) or is honestly marked as not built. No toggle exists for anything
// without a real backend, per the "never pretend" rule — a merchant reading this page should
// never wonder if a switch here actually does anything. Copy here is merchant-facing only —
// no file paths, service names, or other implementation details; that's what
// DECISIONS.md/code comments are for.
type LoaderData = {
  canUseAI: boolean;
  feed: FeedReadiness;
};

type ActionData = {
  ok: boolean;
  error?: string;
  feedUrl?: string | null;
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const [permissions, feed] = await Promise.all([getStorePermissions(store.id), getFeedReadiness(store.id)]);

  return { canUseAI: permissions.canUseAI, feed };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const formData = await request.formData();

  try {
    const enabled = formData.get("enabled") === "true";
    const result = await setGoogleFeedEnabled(store.id, enabled);
    return { ok: true, feedUrl: result.feedUrl };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to update the feed." };
  }
};

function StatusRow({ label, state, description }: { label: string; state: string; description: string }) {
  return (
    <div className={styles.fieldGroup}>
      <p className={styles.settingsGroupLabel}>
        {label} — {state}
      </p>
      <p className={styles.mutedText}>{description}</p>
    </div>
  );
}

export default function SettingsSeoPage() {
  const { canUseAI, feed } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const [enabled, setEnabled] = useState(feed.feedEnabled);
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);
  const feedUrl = fetcher.data?.ok ? fetcher.data.feedUrl : feed.feedUrl;

  useEffect(() => {
    if (!fetcher.data) return;
    if (!fetcher.data.ok) {
      setToast({ content: fetcher.data.error || "Unable to update the feed.", error: true });
      setEnabled(feed.feedEnabled);
      return;
    }
    setToast({ content: enabled ? "Review feed turned on." : "Review feed turned off." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const toggle = (next: boolean) => {
    setEnabled(next);
    const formData = new FormData();
    formData.set("enabled", String(next));
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <>
      <Section
        title="Search engine visibility"
        description="Helps Google and other search engines show your star rating directly in search results."
      >
        <StatusRow
          label="Review & rating rich snippets"
          state="Live"
          description={
            'Every product page automatically publishes your real approved reviews and average rating in the format search engines look for — no setup needed. You can turn this off for a specific theme from the "Product Reviews Widget" block\'s "Include reviews in search engine markup" setting in the Shopify Theme Editor.'
          }
        />
      </Section>

      <Section
        title="Google Shopping — review feed"
        description="A live feed of your approved reviews, in the format Google Merchant Center accepts, ready for you to connect."
      >
        <Checkbox label="Turn on the review feed" checked={enabled} onChange={toggle} disabled={fetcher.state !== "idle"} />

        {enabled && feedUrl ? (
          <>
            <p className={styles.mutedText}>
              Feed URL: <code>{feedUrl}</code>
            </p>
            <div className={styles.inlineActions}>
              <a href={feedUrl} target="_blank" rel="noreferrer" className={`${buttonStyles.button} ${buttonStyles.secondary}`}>
                Preview feed
              </a>
            </div>
            <p className={styles.mutedText}>
              {feed.eligibleReviewCount} review{feed.eligibleReviewCount === 1 ? "" : "s"} included right now
              {feed.excludedReviewCount > 0
                ? ` (${feed.excludedReviewCount} excluded — ${feed.excludedReasons.noProductHandle} missing a storefront product link, ${feed.excludedReasons.missingContent} with no written content)`
                : ""}
              .
            </p>
            <p className={styles.mutedText}>
              To show these on Google Shopping, add this URL as a scheduled fetch in Google Merchant Center under{" "}
              <strong>Products &gt; Feeds</strong>. This requires a Google Merchant Center account, which is a separate step you
              complete directly with Google — Imagyn doesn&apos;t create or manage that account for you.
            </p>
          </>
        ) : null}

        {!feed.hasStoreDomain ? (
          <p className={styles.mutedText}>Your store needs a storefront domain on file before the feed can include any products.</p>
        ) : null}
      </Section>

      <Section
        title="AI Review Summaries"
        description="A short, AI-generated summary of what customers say about a product, shown in your admin and (where enabled) on your storefront."
      >
        <StatusRow
          label="AI Review Summaries"
          state={canUseAI ? "Available on your plan" : "Requires Pro"}
          description="Generated from your store's own real, approved reviews — never fabricated. Regenerate it any time from a product's detail page."
        />
      </Section>

      <Section title="Coming next" description="Ideas on our roadmap. Nothing below is available yet, and nothing on this page claims otherwise.">
        <StatusRow
          label="AI shopping assistant visibility"
          state="Not available yet"
          description="Making your review content easier for AI shopping assistants to reference when customers ask about your products."
        />
      </Section>

      <div className={styles.toastFrame}>
        <Frame>{toast ? <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} /> : null}</Frame>
      </div>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
