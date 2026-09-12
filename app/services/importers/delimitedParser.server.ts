// Shared CSV-parsing core behind csv.server.ts (generic), judgeme.server.ts (Judge.me-specific
// column names + moderation-status vocabulary), loox.server.ts, and stamped.server.ts — every
// provider that exports CSV reuses this instead of re-implementing header-matching. A provider
// whose export isn't CSV at all would implement Importer directly instead of calling this.
import Papa from "papaparse";
import type { ParsedImport, ParsedReviewRow } from "./types";

export type FieldAliases = Record<keyof Omit<ParsedReviewRow, "row">, string[]>;

// A merchant-supplied correction, keyed by field name, valued by the RAW (original-cased)
// header from their file to use instead of whatever the alias table auto-detected — or the
// literal string "" to explicitly force a field to "not mapped" even if an alias matched.
// Partial: a merchant only overrides the fields the auto-detection got wrong, everything else
// still resolves via the normal alias chain.
export type HeaderOverrides = Partial<Record<keyof FieldAliases, string>>;

export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function buildHeaderMap(
  headers: string[],
  aliases: FieldAliases,
  overrides?: HeaderOverrides,
): Partial<Record<keyof ParsedReviewRow, string>> {
  const normalized = headers.map((header) => ({ original: header, normalized: normalizeHeader(header) }));
  const map: Partial<Record<keyof ParsedReviewRow, string>> = {};

  for (const [field, fieldAliases] of Object.entries(aliases) as Array<
    [keyof FieldAliases, string[]]
  >) {
    const override = overrides?.[field];
    if (override !== undefined) {
      // Empty string is a deliberate "leave this field unmapped" instruction — distinct from
      // "no override was given at all" (undefined), which falls through to normal detection.
      if (override !== "" && headers.includes(override)) {
        map[field] = override;
      }
      continue;
    }

    const match = normalized.find((header) => fieldAliases.includes(header.normalized));
    if (match) {
      map[field] = match.original;
    }
  }

  return map;
}

export interface ColumnDetectionResult {
  // Every raw header exactly as it appears in the file, in file order.
  headers: string[];
  // What the alias table auto-detected for each field, before any merchant override —
  // the "here's what we found" half of the mapping-transparency contract.
  detected: Partial<Record<keyof ParsedReviewRow, string>>;
  requiredFields: Array<keyof FieldAliases>;
  missingRequired: Array<keyof FieldAliases>;
}

// Cheap, header-only analysis — reads just the first row, never the full file — so the import
// UI can show a merchant "here's what we detected" and let them correct it BEFORE committing to
// a full parse/dry-run of a potentially large file.
export function detectColumns(
  fileContent: string,
  aliases: FieldAliases,
  requiredFields: Array<keyof FieldAliases>,
): ColumnDetectionResult {
  const result = Papa.parse<Record<string, string>>(fileContent, {
    header: true,
    skipEmptyLines: true,
    preview: 1,
    transformHeader: (header) => header,
  });

  const headers = result.meta.fields ?? [];
  const detected = buildHeaderMap(headers, aliases);
  const missingRequired = requiredFields.filter((field) => !detected[field]);

  return { headers, detected, requiredFields, missingRequired };
}

export function parseDelimitedReviewFile(
  fileContent: string,
  aliases: FieldAliases,
  requiredFields: Array<keyof FieldAliases>,
  // Applied to each row after the generic field mapping — a provider-specific hook for
  // translating that source's own vocabulary (e.g. Judge.me's `curated` states) into the
  // shared one the rest of the import pipeline understands, without a second parsing pass.
  postProcess?: (row: ParsedReviewRow, record: Record<string, string>) => ParsedReviewRow,
  // Merchant corrections to the auto-detected mapping — see HeaderOverrides's own comment.
  // Optional: every existing call site that doesn't pass this behaves exactly as before.
  overrides?: HeaderOverrides,
): ParsedImport {
  const result = Papa.parse<Record<string, string>>(fileContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header,
  });

  if (result.data.length === 0) {
    return { rows: [], fileErrors: ["The file has no data rows."] };
  }

  const headerMap = buildHeaderMap(result.meta.fields ?? [], aliases, overrides);
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
      mediaUrls: get("mediaUrls") || undefined,
    };

    return postProcess ? postProcess(row, record) : row;
  });

  return { rows, fileErrors: [] };
}
