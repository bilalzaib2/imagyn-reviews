import { useLoaderData, useRouteError } from "react-router";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Section } from "../components/ui/Section";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { getStorePermissions } from "../services/permissions";
import styles from "../styles/app.management.module.css";

// Settings > Growth > Google, SEO & AI — a real status page, not a settings form: every item
// here either already works (structured data, AI summaries — both genuinely shipped) or is
// honestly marked as not built. No toggle exists for anything without a real backend, per the
// "never pretend" rule — a merchant reading this page should never wonder if a switch here
// actually does anything. Copy here is merchant-facing only — no file paths, service names, or
// other implementation details; that's what DECISIONS.md/code comments are for.
type LoaderData = {
  canUseAI: boolean;
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const permissions = await getStorePermissions(store.id);

  return { canUseAI: permissions.canUseAI };
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
  const { canUseAI } = useLoaderData<typeof loader>();

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
        title="AI Review Summaries"
        description="A short, AI-generated summary of what customers say about a product, shown in your admin and (where enabled) on your storefront."
      >
        <StatusRow
          label="AI Review Summaries"
          state={canUseAI ? "Available on your plan" : "Requires Pro"}
          description="Generated from your store's own real, approved reviews — never fabricated. Regenerate it any time from a product's detail page."
        />
      </Section>

      <Section
        title="Coming next"
        description="Ideas on our roadmap. Nothing below is available yet, and nothing on this page claims otherwise."
      >
        <StatusRow
          label="Google Shopping review feed"
          state="Not available yet"
          description="Syncing your reviews into Google Merchant Center so they can appear on Google Shopping listings."
        />
        <StatusRow
          label="AI shopping assistant visibility"
          state="Not available yet"
          description="Making your review content easier for AI shopping assistants to reference when customers ask about your products."
        />
      </Section>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
