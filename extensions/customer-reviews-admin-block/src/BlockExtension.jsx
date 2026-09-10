// Registers the Preact bindings for Shopify's admin extension web components
// (s-admin-block, s-stack, s-text, etc.) — without this, the custom elements mount but
// their props/children never bind correctly. Missing this was the root cause of an earlier
// bug where this block's heading rendered but its body never did (confirmed by diffing
// against `shopify app generate extension -t admin_block`, the CLI's own known-good scaffold).
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

// Calls our own app's backend (api.admin-extensions.customer-reviews.tsx), not Shopify's
// Admin GraphQL directly — review data lives in our own database, keyed by the customer's
// email (see that route's own comment for why). fetch() to the app's configured domain
// automatically carries a verifiable Shopify ID token; no manual token handling needed here.
async function getCustomerReviewStats(customerId) {
  const response = await fetch(`/api/admin-extensions/customer-reviews?customerId=${encodeURIComponent(customerId)}`);
  if (!response.ok) {
    throw new Error("Request failed");
  }
  return response.json();
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export default async () => {
  render(<Extension />, document.body);

  function Extension() {
    const { data, i18n } = shopify;
    const customerId = data.selected[0]?.id;

    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState(null);
    const [error, setError] = useState(false);

    useEffect(() => {
      if (!customerId) {
        setLoading(false);
        return;
      }

      let cancelled = false;
      (async function fetchStats() {
        try {
          const result = await getCustomerReviewStats(customerId);
          if (!cancelled) {
            setStats(result.ok ? result : null);
          }
        } catch {
          if (!cancelled) {
            setError(true);
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [customerId]);

    if (loading) {
      return (
        <s-admin-block heading={i18n.translate("name")}>
          <s-stack direction="inline" gap="small">
            <s-spinner />
          </s-stack>
        </s-admin-block>
      );
    }

    if (error) {
      return (
        <s-admin-block heading={i18n.translate("name")}>
          <s-text tone="subdued">Couldn&apos;t load review data right now.</s-text>
        </s-admin-block>
      );
    }

    if (!stats || stats.reviewCount === 0) {
      return (
        <s-admin-block heading={i18n.translate("name")}>
          <s-text tone="subdued">No reviews from this customer yet.</s-text>
        </s-admin-block>
      );
    }

    return (
      <s-admin-block heading={i18n.translate("name")}>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small">
            <s-badge tone="success">
              {stats.averageRating != null ? `${stats.averageRating.toFixed(1)} ★ average` : "No rating"}
            </s-badge>
            <s-text>
              {stats.reviewCount} review{stats.reviewCount === 1 ? "" : "s"}
            </s-text>
          </s-stack>

          {stats.mostRecent ? (
            <s-stack direction="block" gap="small-300">
              <s-text tone="subdued">Most recent — {formatDate(stats.mostRecent.createdAt)}</s-text>
              <s-text>
                {stats.mostRecent.rating} ★{stats.mostRecent.title ? ` — ${stats.mostRecent.title}` : ""}
              </s-text>
              {stats.mostRecent.productTitle ? (
                <s-text tone="subdued">{stats.mostRecent.productTitle}</s-text>
              ) : null}
            </s-stack>
          ) : null}
        </s-stack>
      </s-admin-block>
    );
  }
};
