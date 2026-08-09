import type { LoaderFunctionArgs } from "react-router";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore, getProductSyncState } from "../services/store.server";

// Polled by app.products.tsx while a sync is running (see its useEffect) — deliberately
// separate from that page's own loader so polling every 1-2s doesn't re-fetch and re-serialize
// the full product table (which can be tens of thousands of rows) on every tick, just the
// small sync-state row.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  return getProductSyncState(store.id);
};
