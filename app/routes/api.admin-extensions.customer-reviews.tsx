import type { LoaderFunctionArgs } from "react-router";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { getCustomerReviewStatsByEmail } from "../services/review.server";

// Backs extensions/customer-reviews-admin-block — an Admin UI Extension on the Customer
// Details page. Admin UI extensions authenticate their own fetch() calls to the app's
// configured domain with a Shopify ID token automatically (no manual session-token plumbing
// needed on the extension side); authenticateAdminDeduped verifies that token exactly the
// same way it verifies every embedded /app/* route's session token, since both are Shopify-
// signed JWTs the same underlying authenticate.admin() call accepts.
//
// The extension only ever sends us a customer's Shopify GID, never their email — this route
// resolves the email itself via the caller's own already-authenticated admin session, rather
// than trusting an email the client could otherwise supply directly.
const CUSTOMER_EMAIL_QUERY = `#graphql
  query CustomerEmail($id: ID!) {
    customer(id: $id) {
      email
    }
  }
`;

interface CustomerEmailResponse {
  data?: {
    customer?: { email: string | null } | null;
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const customerId = new URL(request.url).searchParams.get("customerId");
  if (!customerId) {
    return { ok: false, error: "customerId is required." };
  }

  const response = await admin.graphql(CUSTOMER_EMAIL_QUERY, { variables: { id: customerId } });
  const json = (await response.json()) as CustomerEmailResponse;
  const email = json.data?.customer?.email;

  if (!email) {
    return { ok: true, reviewCount: 0, averageRating: null, mostRecent: null };
  }

  const stats = await getCustomerReviewStatsByEmail(store.id, email);
  return { ok: true, ...stats };
};
