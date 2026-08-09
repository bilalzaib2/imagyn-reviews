// Shared CSV-parsing core behind both csv.server.ts (generic) and judgeme.server.ts
// (Judge.me-specific column names + moderation-status vocabulary) — every future provider that
// exports CSV (Stamped, Ryviu, Ali Reviews all do) reuses this instead of re-implementing
// header-matching. Providers whose export isn't CSV at all (Loox uses JSON) implement Importer
// directly instead of calling this.
import Papa from "papaparse";
import type { ParsedImport, ParsedReviewRow } from "./types";

export type FieldAliases = Record<keyof Omit<ParsedReviewRow, "row">, string[]>;

export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function buildHeaderMap(
  headers: string[],
  aliases: FieldAliases,
): Partial<Record<keyof ParsedReviewRow, string>> {
  const normalized = headers.map((header) => ({ original: header, normalized: normalizeHeader(header) }));
  const map: Partial<Record<keyof ParsedReviewRow, string>> = {};

  for (const [field, fieldAliases] of Object.entries(aliases) as Array<
    [keyof FieldAliases, string[]]
  >) {
    const match = normalized.find((header) => fieldAliases.includes(header.normalized));
    if (match) {
      map[field] = match.original;
    }
  }

  return map;
}

export function parseDelimitedReviewFile(
  fileContent: string,
  aliases: FieldAliases,
  requiredFields: Array<keyof FieldAliases>,
  // Applied to each row after the generic field mapping — a provider-specific hook for
  // translating that source's own vocabulary (e.g. Judge.me's `curated` states) into the
  // shared one the rest of the import pipeline understands, without a second parsing pass.
  postProcess?: (row: ParsedReviewRow, record: Record<string, string>) => ParsedReviewRow,
): ParsedImport {
  const result = Papa.parse<Record<string, string>>(fileContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header,
  });

  if (result.data.length === 0) {
    return { rows: [], fileErrors: ["The file has no data rows."] };
  }

  const headerMap = buildHeaderMap(result.meta.fields ?? [], aliases);
  const missingRequired = requiredFields.filter((field) => !headerMap[field]);

  if (missingRequired.length > 0) {
    return {
      rows: [],
      fileErrors: missingRequired.map(
        (field) => `Missing required column: ${field} (expected one of: ${aliases[field].join(", ")}).`,
      ),
    };
  }

  const rows: ParsedReviewRow[] = result.data.map((record, index) => {
    const get = (field: keyof FieldAliases) => {
      const header = headerMap[field];
      return header ? String(record[header] ?? "").trim() : "";
    };

    const row: ParsedReviewRow = {
      row: index + 2, // +1 for 1-based, +1 for the header row itself
      product: get("product"),
      productId: get("productId"),
      variantId: get("variantId"),
      productHandle: get("productHandle"),
      productUrl: get("productUrl"),
      productSlug: get("productSlug"),
      sku: get("sku"),
      rating: get("rating"),
      title: get("title"),
      content: get("content"),
      reviewerName: get("reviewerName"),
      reviewerEmail: get("reviewerEmail"),
      reviewerLocation: get("reviewerLocation"),
      verifiedPurchase: get("verifiedPurchase"),
      createdAt: get("createdAt"),
      status: get("status"),
      externalId: get("externalId") || undefined,
      reply: get("reply") || undefined,
      repliedAt: get("repliedAt") || undefined,
    };

    return postProcess ? postProcess(row, record) : row;
  });

  return { rows, fileErrors: [] };
}
