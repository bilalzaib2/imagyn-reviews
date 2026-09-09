import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Checkbox, Frame, Toast } from "@shopify/polaris";
import { StatusBadge } from "../components/ui/StatusBadge";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { getStorePermissions } from "../services/permissions";
import { getFeedReadiness, setGoogleFeedEnabled, type FeedReadiness } from "../services/googleReviewFeed.server";
import { getReviewSiteUrl } from "../services/reviewSite.server";
import { getStoreAiSummary, regenerateStoreAiSummary, type StoreAiSummaryRecord } from "../services/aiSummary.server";
import buttonStyles from "../components/ui/button.module.css";
import managementStyles from "../styles/app.management.module.css";
import styles from "../styles/app.settings.seo.module.css";

// Settings > Growth > Google, SEO & AI — IMAGYN's "growth command center": every card here
// either already works (structured data, the review feed, AI summaries + AI reply drafting —
// all genuinely shipped) or is honestly marked as not built yet under "Coming next." No
// toggle exists for anything without a real backend, per the "never pretend" rule. Loader/
// action shape is unchanged from before this visual pass — this file only changes how the
// same real data is presented. Copy is merchant-facing only.
//
// "Search engine visibility" and "structured data / SEO status" are the same real fact
// (the JSON-LD this app writes IS the rich-snippet markup) — presented as one honest card
// below rather than two cards making the same claim differently.
type LoaderData = {
  canUseAI: boolean;
  feed: FeedReadiness;
  reviewSiteUrl: string;
  storeAiSummary: StoreAiSummaryRecord | null;
};

type ActionData = {
  ok: boolean;
  error?: string;
  feedUrl?: string | null;
  distributionFeedUrl?: string | null;
  storeAiSummary?: StoreAiSummaryRecord;
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const [permissions, feed, storeAiSummary] = await Promise.all([
    getStorePermissions(store.id),
    getFeedReadiness(store.id),
    getStoreAiSummary(store.id),
  ]);

  return { canUseAI: permissions.canUseAI, feed, reviewSiteUrl: getReviewSiteUrl(store.slug), storeAiSummary };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "toggleFeed");

  try {
    if (intent === "generateStoreSummary") {
      const summary = await regenerateStoreAiSummary(store.id);
      return { ok: true, storeAiSummary: summary };
    }

    const enabled = formData.get("enabled") === "true";
    const result = await setGoogleFeedEnabled(store.id, enabled);
    return { ok: true, feedUrl: result.feedUrl, distributionFeedUrl: result.distributionFeedUrl };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Something went wrong.",
    };
  }
};

// Minimal inline line-icons — no external icon library, matching the "restrained, no
// gratuitous decoration" direction. Single-color (currentColor), 20x20 viewBox.
function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <line x1="17" y1="17" x2="13" y2="13" />
    </svg>
  );
}

function ShoppingBagIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 7h10l-.8 9.2a1 1 0 0 1-1 .8H6.8a1 1 0 0 1-1-.8L5 7z" />
      <path d="M7.5 7V5.5a2.5 2.5 0 0 1 5 0V7" />
    </svg>
  );
}

function ShareNodesIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="5" cy="10" r="2.2" />
      <circle cx="15" cy="4.5" r="2.2" />
      <circle cx="15" cy="15.5" r="2.2" />
      <line x1="7" y1="9" x2="13" y2="5.5" />
      <line x1="7" y1="11" x2="13" y2="14.5" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="10" cy="10" r="7.2" />
      <ellipse cx="10" cy="10" rx="3.1" ry="7.2" />
      <line x1="2.8" y1="10" x2="17.2" y2="10" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 2.2c.3 3 1.4 5 3.3 6.5 1.9 1.5 3.3 1.6 3.3 1.3s-1.4-.2-3.3 1.3c-1.9 1.5-3 3.5-3.3 6.5-.3-3-1.4-5-3.3-6.5C4.8 9.8 3.4 9.7 3.4 10s1.4.2 3.3-1.3c1.9-1.5 3-3.5 3.3-6.5z" />
    </svg>
  );
}

function formatGeneratedAt(value: Date | string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export default function SettingsSeoPage() {
  const { canUseAI, feed, reviewSiteUrl, storeAiSummary: loaderStoreAiSummary } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const storeSummaryFetcher = useFetcher<ActionData>();
  const [enabled, setEnabled] = useState(feed.feedEnabled);
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);
  const feedUrl = fetcher.data?.ok ? fetcher.data.feedUrl : feed.feedUrl;
  const distributionFeedUrl = fetcher.data?.ok ? fetcher.data.distributionFeedUrl : feed.distributionFeedUrl;
  const storeAiSummary = storeSummaryFetcher.data?.ok ? (storeSummaryFetcher.data.storeAiSummary ?? loaderStoreAiSummary) : loaderStoreAiSummary;
  const isGeneratingStoreSummary = storeSummaryFetcher.state !== "idle";

  const totalFeedReviews = feed.eligibleReviewCount + feed.excludedReviewCount;
  const eligibleSharePercent = totalFeedReviews > 0 ? Math.round((feed.eligibleReviewCount / totalFeedReviews) * 100) : null;

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

  useEffect(() => {
    if (!storeSummaryFetcher.data) return;
    if (!storeSummaryFetcher.data.ok) {
      setToast({ content: storeSummaryFetcher.data.error || "Unable to generate the store AI summary.", error: true });
      return;
    }
    setToast({ content: "Store AI summary generated." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeSummaryFetcher.data]);

  const toggle = (next: boolean) => {
    setEnabled(next);
    const formData = new FormData();
    formData.set("intent", "toggleFeed");
    formData.set("enabled", String(next));
    fetcher.submit(formData, { method: "post" });
  };

  const generateStoreSummary = () => {
    const formData = new FormData();
    formData.set("intent", "generateStoreSummary");
    storeSummaryFetcher.submit(formData, { method: "post" });
  };

  return (
    <>
      <div className={styles.intro}>
        <p className={styles.introEyebrow}>Growth</p>
        <p className={styles.introText}>
          How your real, approved reviews reach shoppers beyond your storefront — search engines, Google Shopping, AI
          summaries, and anywhere else you choose to share them.
        </p>
      </div>

      <div className={styles.grid}>
        <div className={styles.card} data-tone="success">
          <div className={styles.cardHeader}>
            <div className={styles.cardHeaderLeft}>
              <span className={styles.iconChip} data-tone="success">
                <SearchIcon />
              </span>
              <p className={styles.cardTitle}>Search engine visibility</p>
            </div>
            <StatusBadge tone="success">Live</StatusBadge>
          </div>
          <p className={styles.cardDescription}>
            Every product page automatically publishes real structured data (star rating + approved reviews, in the
            format search engines look for) — no setup needed. Turn this off for a specific theme from the
            &quot;Product Reviews Widget&quot; block&apos;s &quot;Include reviews in search engine markup&quot;
            setting in the Shopify Theme Editor.
          </p>
        </div>

        <div className={`${styles.card} ${styles.cardWide}`} data-tone="info">
          <div className={styles.cardHeader}>
            <div className={styles.cardHeaderLeft}>
              <span className={styles.iconChip} data-tone="info">
                <ShoppingBagIcon />
              </span>
              <p className={styles.cardTitle}>Google Shopping — review feed</p>
            </div>
            <StatusBadge tone={enabled ? "success" : "neutral"}>{enabled ? "On" : "Off"}</StatusBadge>
          </div>
          <p className={styles.cardDescription}>
            A live feed of your approved reviews, in the format Google Merchant Center accepts, ready for you to
            connect.
          </p>

          <Checkbox label="Turn on the review feed" checked={enabled} onChange={toggle} disabled={fetcher.state !== "idle"} />

          {enabled && feedUrl ? (
            <>
              {totalFeedReviews > 0 ? (
                <div>
                  <div className={styles.metricRow}>
                    <p className={styles.metricValue}>{feed.eligibleReviewCount}</p>
                    <p className={styles.metricLabel}>
                      of {totalFeedReviews} review{totalFeedReviews === 1 ? "" : "s"} included right now
                    </p>
                  </div>
                  <div className={styles.ratioTrack} role="presentation">
                    <span className={styles.ratioFill} style={{ width: `${eligibleSharePercent ?? 0}%` }} />
                  </div>
                  {feed.excludedReviewCount > 0 ? (
                    <p className={managementStyles.mutedText}>
                      {feed.excludedReviewCount} excluded — {feed.excludedReasons.noProductHandle} missing a storefront
                      product link, {feed.excludedReasons.missingContent} with no written content.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className={managementStyles.mutedText}>No reviews are eligible for the feed yet.</p>
              )}

              <p className={managementStyles.mutedText}>
                Feed URL: <code className={styles.codeUrl}>{feedUrl}</code>
              </p>
              <div className={styles.ctaRow}>
                <a href={feedUrl} target="_blank" rel="noreferrer" className={`${buttonStyles.button} ${buttonStyles.secondary}`}>
                  Preview feed
                </a>
              </div>
              <p className={managementStyles.mutedText}>
                To show these on Google Shopping, add this URL as a scheduled fetch in Google Merchant Center under{" "}
                <strong>Products &gt; Feeds</strong>. This requires a Google Merchant Center account, which is a separate
                step you complete directly with Google — Imagyn doesn&apos;t create or manage that account for you.
              </p>
            </>
          ) : null}

          {!feed.hasStoreDomain ? (
            <p className={managementStyles.mutedText}>Your store needs a storefront domain on file before the feed can include any products.</p>
          ) : null}
        </div>

        <div className={styles.card} data-tone="info">
          <div className={styles.cardHeader}>
            <div className={styles.cardHeaderLeft}>
              <span className={styles.iconChip} data-tone="info">
                <ShareNodesIcon />
              </span>
              <p className={styles.cardTitle}>Other distribution channels</p>
            </div>
          </div>
          <p className={styles.cardDescription}>
            The same approved reviews as plain JSON, for any ad network, affiliate feed, or script that isn&apos;t
            Google Merchant Center specifically. Same on/off switch as the feed above.
          </p>
          {enabled && distributionFeedUrl ? (
            <>
              <p className={managementStyles.mutedText}>
                Feed URL: <code className={styles.codeUrl}>{distributionFeedUrl}</code>
              </p>
              <div className={styles.ctaRow}>
                <a
                  href={distributionFeedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`${buttonStyles.button} ${buttonStyles.secondary}`}
                >
                  Preview feed
                </a>
              </div>
            </>
          ) : (
            <p className={managementStyles.mutedText}>Turn on the review feed above to get a URL here.</p>
          )}
        </div>

        <div className={styles.card} data-tone="success">
          <div className={styles.cardHeader}>
            <div className={styles.cardHeaderLeft}>
              <span className={styles.iconChip} data-tone="success">
                <GlobeIcon />
              </span>
              <p className={styles.cardTitle}>Public review page</p>
            </div>
            <StatusBadge tone="success">Live</StatusBadge>
          </div>
          <p className={styles.cardDescription}>
            A shareable page listing your real approved reviews — link to it from an email signature, social bio, or ad
            landing page. Always available; these are the same reviews your storefront widgets show.
          </p>
          <p className={managementStyles.mutedText}>
            Page URL: <code className={styles.codeUrl}>{reviewSiteUrl}</code>
          </p>
          <div className={styles.ctaRow}>
            <a href={reviewSiteUrl} target="_blank" rel="noreferrer" className={`${buttonStyles.button} ${buttonStyles.secondary}`}>
              View page
            </a>
          </div>
        </div>

        <div className={`${styles.card} ${styles.cardWide}`} data-tone="ai">
          <div className={styles.cardHeader}>
            <div className={styles.cardHeaderLeft}>
              <span className={styles.iconChip} data-tone="ai">
                <SparkleIcon />
              </span>
              <p className={styles.cardTitle}>AI Review Intelligence</p>
            </div>
            <span className={`${styles.pill} ${styles.pillAi}`}>{canUseAI ? "Available on your plan" : "Requires Pro"}</span>
          </div>
          <p className={styles.cardDescription}>
            Generated from your store&apos;s own real, approved reviews — never fabricated.
          </p>

          <div>
            <div className={styles.aiFeatureRow}>
              <div>
                <p className={styles.aiFeatureName}>AI Review Summaries</p>
                <p className={styles.aiFeatureDetail}>
                  A short summary of what customers say about a product, shown in your admin and (where enabled) on
                  your storefront. Regenerate any time from a product&apos;s detail page.
                </p>
              </div>
            </div>
            <div className={styles.aiFeatureRow}>
              <div>
                <p className={styles.aiFeatureName}>AI Reply Drafting</p>
                <p className={styles.aiFeatureDetail}>
                  Suggests a starting reply to a customer review, based on its real content — you always review and
                  edit before sending. Available from a review&apos;s detail panel.
                </p>
              </div>
            </div>
            <div className={styles.aiFeatureRow}>
              <div style={{ width: "100%" }}>
                <p className={styles.aiFeatureName}>Store AI Summary</p>
                <p className={styles.aiFeatureDetail}>
                  A single summary synthesized across every approved review in your store, not just one product —
                  what customers say about your store as a whole.
                </p>

                {!canUseAI ? (
                  <p className={managementStyles.mutedText}>Requires the Pro plan.</p>
                ) : storeAiSummary ? (
                  <>
                    <p className={managementStyles.mutedText} style={{ marginTop: "0.75rem" }}>
                      &ldquo;{storeAiSummary.summary}&rdquo;
                    </p>
                    <p className={managementStyles.mutedText}>
                      Based on {storeAiSummary.reviewCountUsed} approved review{storeAiSummary.reviewCountUsed === 1 ? "" : "s"} ·
                      Last generated {formatGeneratedAt(storeAiSummary.generatedAt)}
                    </p>
                  </>
                ) : (
                  <p className={managementStyles.mutedText} style={{ marginTop: "0.75rem" }}>
                    Not generated yet. This will use your store&apos;s real approved reviews only.
                  </p>
                )}

                <div className={styles.ctaRow}>
                  <button
                    type="button"
                    className={`${buttonStyles.button} ${buttonStyles.secondary}`}
                    onClick={generateStoreSummary}
                    disabled={!canUseAI || isGeneratingStoreSummary}
                  >
                    {isGeneratingStoreSummary ? "Generating…" : storeAiSummary ? "Regenerate" : "Generate summary"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.roadmapCard}>
        <p className={styles.roadmapLabel}>Coming next</p>
        <p className={styles.roadmapText}>
          AI shopping assistant visibility — making your review content easier for AI shopping assistants to reference
          when customers ask about your products. Not available yet; nothing on this page claims otherwise.
        </p>
      </div>

      <div className={managementStyles.toastFrame}>
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
