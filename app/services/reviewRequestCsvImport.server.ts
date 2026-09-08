import Papa from "papaparse";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { reviewRequestService } from "./review-request.server";
import { ProductMatcher } from "./importers/productMatcher.server";

// Bulk counterpart of the "Individual Customer" Send Request tab, for merchants whose
// customer/product list doesn't come from a Shopify order at all (e.g. reviews collected
// off-platform, a pre-launch customer list) — the one real gap the "Upload CSV" tab
// (app.requests.tsx's SEND_SOURCE_TABS) used to sit on as a permanent "Coming soon". Reuses
// reviewRequestService.createRequest (the exact same single-request creation path the
// "Individual Customer" tab already calls) so a CSV-created request is indistinguishable from
// a hand-typed one — no second request-creation code path to keep in sync.
export interface CsvRequestRowIssue {
  row: number;
  reason: string;
}

export interface CsvRequestImportResult {
  totalRows: number;
  created: number;
  skippedDuplicates: number;
  missingProducts: CsvRequestRowIssue[];
  errors: CsvRequestRowIssue[];
}

const HEADER_ALIASES: Record<string, string[]> = {
  name: ["name", "customer_name", "full_name"],
  email: ["email", "customer_email", "e-mail"],
  product: ["product", "product_name", "product_title"],
  productHandle: ["product_handle", "handle"],
  orderNumber: ["order_number", "order", "order_no"],
  delayDays: ["delay_days", "delay", "days"],
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function buildHeaderMap(headers: string[]): Partial<Record<keyof typeof HEADER_ALIASES, string>> {
  const normalizedToRaw = new Map(headers.map((header) => [normalizeHeader(header), header]));
  const map: Partial<Record<keyof typeof HEADER_ALIASES, string>> = {};

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const raw = normalizedToRaw.get(alias);
      if (raw) {
        map[field as keyof typeof HEADER_ALIASES] = raw;
        break;
      }
    }
  }

  return map;
}

// storeId is the caller's already-authenticated store (see app.requests.tsx's action) — never
// derived from the file itself. Each row is resolved and created independently so one bad or
// unmatched row never aborts the rest of the file, mirroring reviewImportExport.server.ts's
// own per-row isolation.
export async function importReviewRequestsFromCsv(
  storeId: string,
  fileContent: string,
  admin: AdminApiContext | null,
  defaultDelayDays: number,
): Promise<CsvRequestImportResult> {
  const result: CsvRequestImportResult = {
    totalRows: 0,
    created: 0,
    skippedDuplicates: 0,
    missingProducts: [],
    errors: [],
  };

  const parsed = Papa.parse<Record<string, string>>(fileContent, { header: true, skipEmptyLines: true });
  const rows = parsed.data;
  result.totalRows = rows.length;

  if (rows.length === 0) {
    result.errors.push({ row: 0, reason: "The file has no data rows." });
    return result;
  }

  const headerMap = buildHeaderMap(parsed.meta.fields ?? []);
  if (!headerMap.email || (!headerMap.product && !headerMap.productHandle)) {
    result.errors.push({
      row: 0,
      reason: "The file must have an email column and either a product name or product handle column.",
    });
    return result;
  }

  const matcher = await ProductMatcher.forStore(storeId);

  // One bulk duplicate-check query set for the whole file, not one per row — same reasoning as
  // getExistingRequestContextBulk's own comment (this is that function's caller, not a new
  // duplicate-checking implementation).
  const resolvedRows: Array<{ row: number; email: string; name: string; productId: string; orderNumber: string | null; delayDays: number }> = [];

  for (let i = 0; i < rows.length; i += 1) {
    const rowNumber = i + 2; // header is row 1, so the first data row is row 2 for a merchant reading the file
    const raw = rows[i];

    const email = (headerMap.email ? raw[headerMap.email] : "")?.trim() || "";
    if (!email) {
      result.errors.push({ row: rowNumber, reason: "Missing email." });
      continue;
    }

    const name = (headerMap.name ? raw[headerMap.name] : "")?.trim() || email;
    const productTitle = headerMap.product ? raw[headerMap.product]?.trim() : "";
    const productHandle = headerMap.productHandle ? raw[headerMap.productHandle]?.trim() : "";

    if (!productTitle && !productHandle) {
      result.missingProducts.push({ row: rowNumber, reason: "No product name or handle given for this row." });
      continue;
    }

    const match = await matcher.match({ title: productTitle || undefined, handle: productHandle || undefined }, admin);
    if (!match.productId) {
      result.missingProducts.push({
        row: rowNumber,
        reason: `No product matched "${productHandle || productTitle}".`,
      });
      continue;
    }

    const orderNumber = headerMap.orderNumber ? raw[headerMap.orderNumber]?.trim() || null : null;
    const delayRaw = headerMap.delayDays ? raw[headerMap.delayDays]?.trim() : "";
    const delayDays = delayRaw && Number.isFinite(Number(delayRaw)) ? Math.max(0, Number(delayRaw)) : defaultDelayDays;

    resolvedRows.push({ row: rowNumber, email, name, productId: match.productId, orderNumber, delayDays });
  }

  const duplicateContext = await reviewRequestService.getExistingRequestContextBulk(
    storeId,
    resolvedRows.map((row) => ({ email: row.email, productId: row.productId })),
  );

  for (const row of resolvedRows) {
    const context = duplicateContext.get(`${row.email.toLowerCase()}||${row.productId}`);
    if (context && (context.hasExistingReview || context.hasPendingRequest || context.hasSentRequest)) {
      result.skippedDuplicates += 1;
      continue;
    }

    try {
      await reviewRequestService.createRequest(storeId, {
        productId: row.productId,
        email: row.email,
        name: row.name,
        orderNumber: row.orderNumber,
        delayDays: row.delayDays,
      });
      result.created += 1;
    } catch (error) {
      result.errors.push({
        row: row.row,
        reason: error instanceof Error ? error.message : "Could not create this request.",
      });
    }
  }

  return result;
}
