import type { LoaderFunctionArgs } from "react-router";
import { exportReviewsToCsv } from "../services/reviewImportExport.server";
import { getOrCreateStore } from "../services/store.server";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const { csv, totalCount, exportedCount, truncated } = await exportReviewsToCsv(store.id);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reviews-export.csv"`,
      // Never silent about a capped export — no UI reads these today, but the real row
      // counts are always in the response rather than only discoverable by noticing the
      // file looks short. See exportReviewsToCsv's own MAX_EXPORT_ROWS comment.
      "X-Export-Total-Count": String(totalCount),
      "X-Export-Exported-Count": String(exportedCount),
      "X-Export-Truncated": String(truncated),
    },
  });
};
