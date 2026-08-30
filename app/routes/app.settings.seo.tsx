import { useLoaderData } from "react-router";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useRouteError } from "react-router";
import { Section } from "../components/ui/Section";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { getStorePermissions } from "../services/permissions";
import styles from "../styles/app.management.module.css";

// Settings > Growth > Google, SEO & AI — a real status page, not a settings form: every item
// here either already works (structured data, AI summaries — both genuinely shipped) or is
// honestly marked as not built. No toggle exists for anything without a real backend, per the
// "never pretend" rule — a merchant reading this page should never wonder if a switch here
// actually does anything.
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
        title="Structured data (JSON-LD)"
        description="Real, shipped, and already live on every store — see app/services/structuredData."
      >
        <StatusRow
          label="Review & rating rich snippets"
          state="Live"
          description={
            'Every product page renders real AggregateRating/Review JSON-LD, sourced from your actual approved reviews — no separate toggle needed here. Merchants can turn the embed off per-theme from the "Product Reviews Widget" block’s own "Include reviews in search engine markup" setting in the Shopify Theme Editor.'
          }
        />
      </Section>

      <Section
        title="AI Review Summaries"
        description="A real AI-generated summary of a product's reviews, shown in the admin and (where enabled) on the storefront."
      >
        <StatusRow
          label="AI Review Summaries"
          state={canUseAI ? "Available on your plan" : "Requires Pro"}
          description="Generated from your store's own real, approved reviews — never fabricated. Regenerate it from any product's detail page."
        />
      </Section>

      <Section
        title="Google Shopping & AI shopping surfaces"
        description="Not built yet — shown here honestly rather than as a decorative toggle."
      >
        <StatusRow
          label="Google Shopping review feed"
          state="Not available yet"
          description="No integration exists today. This would require a real Google Merchant Center connection — nothing here claims otherwise."
        />
        <StatusRow
          label="AI shopping assistant visibility"
          state="Not available yet"
          description="No integration exists today."
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
