import Papa from "papaparse";
import type { Importer, ParsedImport, ParsedReviewRow } from "./types";

// Accepted header spellings per field — lets CSVs exported from a spreadsheet or another
// review tool work without forcing merchants onto one exact header set, while staying a
// plain lookup table rather than a fuzzy-matching engine.
const FIELD_ALIASES: Record<keyof Omit<ParsedReviewRow, "row">, string[]> = {
  product: ["product", "product_name", "product_title", "product_handle"],
  rating: ["rating", "stars", "score"],
  title: ["title", "headline", "summary"],
  content: ["content", "review", "body", "text", "review_text", "review_content"],
  reviewerName: ["reviewer_name", "customer_name", "name", "author"],
  reviewerEmail: ["reviewer_email", "customer_email", "email"],
  reviewerLocation: ["reviewer_location", "location"],
  verifiedPurchase: ["verified_purchase", "verified"],
  createdAt: ["created_at", "date", "review_date"],
  status: ["status", "approved"],
};

const REQUIRED_FIELDS: Array<keyof typeof FIELD_ALIASES> = ["product", "rating", "content"];

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function buildHeaderMap(headers: string[]): Partial<Record<keyof ParsedReviewRow, string>> {
  const normalized = headers.map((header) => ({ original: header, normalized: normalizeHeader(header) }));
  const map: Partial<Record<keyof ParsedReviewRow, string>> = {};

  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as Array<
    [keyof typeof FIELD_ALIASES, string[]]
  >) {
    const match = normalized.find((header) => aliases.includes(header.normalized));
    if (match) {
      map[field] = match.original;
    }
  }

  return map;
}

export function createCsvImporter(): Importer {
  return {
    name: "CSV file",
    source: "csv",
    parse(fileContent: string): ParsedImport {
      const result = Papa.parse<Record<string, string>>(fileContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header,
      });

      if (result.data.length === 0) {
        return { rows: [], fileErrors: ["The file has no data rows."] };
      }

      const headerMap = buildHeaderMap(result.meta.fields ?? []);
      const missingRequired = REQUIRED_FIELDS.filter((field) => !headerMap[field]);

      if (missingRequired.length > 0) {
        return {
          rows: [],
          fileErrors: missingRequired.map(
            (field) => `Missing required column: ${field} (expected one of: ${FIELD_ALIASES[field].join(", ")}).`,
          ),
        };
      }

      const rows: ParsedReviewRow[] = result.data.map((record, index) => {
        const get = (field: keyof typeof FIELD_ALIASES) => {
          const header = headerMap[field];
          return header ? String(record[header] ?? "").trim() : "";
        };

        return {
          row: index + 2, // +1 for 1-based, +1 for the header row itself
          product: get("product"),
          rating: get("rating"),
          title: get("title"),
          content: get("content"),
          reviewerName: get("reviewerName"),
          reviewerEmail: get("reviewerEmail"),
          reviewerLocation: get("reviewerLocation"),
          verifiedPurchase: get("verifiedPurchase"),
          createdAt: get("createdAt"),
          status: get("status"),
        };
      });

      return { rows, fileErrors: [] };
    },
  };
}
