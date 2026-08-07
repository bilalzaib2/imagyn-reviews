// One importer per review-export source. CSV is the only implementation today; adding
// Judge.me/Loox/Stamped/Ryviu later is a new file in this directory plus one case in
// provider.server.ts's factory — nothing in the UI or the DB-side import logic
// (reviewImportExport.server.ts) needs to change, since both only ever depend on this
// interface. Mirrors the AI/Storage/Notification/Billing provider pattern already used
// throughout this codebase.
export type ImportSource = "csv" | "judgeme" | "loox" | "stamped" | "ryviu";

export interface ParsedReviewRow {
  // 1-based row number as it appeared in the source file, for error messages a merchant can
  // actually act on ("Row 14: ...") rather than an opaque array index.
  row: number;
  // Free-text product name/title as the source labeled it — always populated when the source
  // has *some* product column, used as the exact/normalized/fuzzy title-match fallback and for
  // "Product not found" error messages. The structured identifiers below (when the source
  // provides them) are tried first, in priority order, by productMatcher.server.ts.
  product: string;
  productId?: string;
  variantId?: string;
  productHandle?: string;
  productUrl?: string;
  productSlug?: string;
  sku?: string;
  rating: string;
  title: string;
  content: string;
  reviewerName: string;
  reviewerEmail: string;
  reviewerLocation: string;
  verifiedPurchase: string;
  createdAt: string;
  status: string;
}

export interface ParsedImport {
  rows: ParsedReviewRow[];
  // File-level problems (unreadable file, no rows, missing required columns entirely) —
  // distinct from per-row validation, which happens later once products can be resolved
  // against the database (see reviewImportExport.server.ts).
  fileErrors: string[];
}

export interface Importer {
  readonly name: string;
  readonly source: ImportSource;
  parse(fileContent: string): ParsedImport;
}

export class ImportSourceNotSupportedError extends Error {
  constructor(source: string) {
    super(`Import from "${source}" isn't supported yet.`);
    this.name = "ImportSourceNotSupportedError";
  }
}

// What the UI's "Import from" selector offers today — only "csv" has a real Importer behind
// it; the rest are listed so the picker's shape never needs to change when they're wired up,
// only provider.server.ts's factory. Lives here (not provider.server.ts) so route components
// can import it without pulling in a .server-only module.
export const IMPORT_SOURCES: Array<{ value: ImportSource; label: string; available: boolean }> = [
  { value: "csv", label: "Generic CSV", available: true },
  { value: "judgeme", label: "Judge.me", available: true },
  { value: "loox", label: "Loox", available: false },
  { value: "stamped", label: "Stamped", available: false },
  { value: "ryviu", label: "Ryviu", available: false },
];
