import type { LoaderFunctionArgs } from "react-router";
import { exportReviewsToCsv } from "../services/reviewImportExport.server";
import { getOrCreateStore } from "../services/store.server";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const csv = await exportReviewsToCsv(store.id);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reviews-export.csv"`,
    },
  });
};
