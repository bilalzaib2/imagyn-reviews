// One importer per review-export source. CSV is the only implementation today; adding
// Judge.me/Loox/Stamped/Ryviu later is a new file in this directory plus one case in
// provider.server.ts's factory — nothing in the UI or the DB-side import logic
// (reviewImportExport.server.ts) needs to change, since both only ever depend on this
// interface. Mirrors the AI/Storage/Notification/Billing provider pattern already used
// throughout this codebase.
export type ImportSource = "csv" | "judgeme" | "loox" | "stamped" | "alireviews" | "ryviu";

// How a merchant wants imported reviews' published/pending state decided. "preserve" (the
// default) trusts each row's own status column where the source provides one; "approved" and
// "pending" are an explicit merchant override applied uniformly to every row in the file,
// regardless of what (if anything) the source claims. Never auto-publish silently — the
// merchant always makes this choice, even implicitly by accepting the "preserve" default shown
// in the import wizard. See reviewImportExport.server.ts's resolveAutoApprove.
export type PublicationMode = "preserve" | "approved" | "pending";

export const PUBLICATION_MODES: Array<{ value: PublicationMode; label: string; description: string }> = [
  {
    value: "preserve",
    label: "Preserve source status",
    description: "Use each review's own approved/pending status from the source file where it provides one.",
  },
  {
    value: "approved",
    label: "Import all as approved",
    description: "Publish every imported review immediately, regardless of its source status.",
  },
  {
    value: "pending",
    label: "Import all as pending",
    description: "Hold every imported review for your own moderation before it publishes.",
  },
];

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
  // The review's stable ID on its source platform, when the source provides one (Judge.me's
  // export calls this `metaobject_handle`). Optional — a source with no stable ID per-review
  // leaves this unset, and reviewImportExport.server.ts's isDuplicate falls back to
  // content-based matching. Stored on Review.externalId so a second import of the same file
  // is idempotent by ID, not just by content.
  externalId?: string;
  reply?: string;
  repliedAt?: string;
  // Raw, source-delimited list of image URLs (Judge.me's picture_urls, Ali Reviews' "Image
  // link", etc.) — see reviewMedia.server.ts's parseImportedMediaUrls/validateImportedMediaUrl
  // for how this gets split and validated. Never fetched/downloaded, only referenced.
  mediaUrls?: string;
}

export interface ParsedImport {
  rows: ParsedReviewRow[];
  // File-level problems (unreadable file, no rows, missing required columns entirely) —
  // distinct from per-row validation, which happens later once products can be resolved
  // against the database (see reviewImportExport.server.ts).
  fileErrors: string[];
}

// Forward-declared here (not imported from delimitedParser.server.ts) to avoid this shared,
// non-.server type file depending on a .server-only module purely for a type alias — the
// two are kept structurally identical by convention, checked by every adapter's own tests.
export type HeaderOverrides = Partial<Record<keyof Omit<ParsedReviewRow, "row">, string>>;

export interface ColumnDetectionResult {
  headers: string[];
  detected: Partial<Record<keyof ParsedReviewRow, string>>;
  requiredFields: Array<keyof Omit<ParsedReviewRow, "row">>;
  missingRequired: Array<keyof Omit<ParsedReviewRow, "row">>;
}

export interface Importer {
  readonly name: string;
  readonly source: ImportSource;
  parse(fileContent: string, overrides?: HeaderOverrides): ParsedImport;
  // Cheap, header-only analysis for the "here's what we detected" preview step — every
  // delimited-file importer implements this via delimitedParser.server.ts's detectColumns.
  detectColumns(fileContent: string): ColumnDetectionResult;
}

export class ImportSourceNotSupportedError extends Error {
  constructor(source: string) {
    super(`Import from "${source}" isn't supported yet.`);
    this.name = "ImportSourceNotSupportedError";
  }
}

// What the UI's "Import from" selector offers today. Lives here (not provider.server.ts) so
// route components can import it without pulling in a .server-only module.
//
// Loox, Stamped, and Ali Reviews are built against each platform's own officially documented
// CSV import-template column spec (see loox.server.ts / stamped.server.ts / alireviews.server.ts's
// own comments) — real, tested importers, not stubs — but none has been verified against a live
// export file from a real account, since none of the three platforms publishes its raw export
// column names separately from that template. Ryviu stays unavailable: public documentation only
// confirms a partial column set (product_handle, rating, photo_urls, created_at) with no
// confirmed reviewer-name/content/email columns, which isn't enough to build a real importer
// without guessing field mappings — exactly the kind of silent mis-mapping this app's import
// pipeline is built to avoid.
export const IMPORT_SOURCES: Array<{ value: ImportSource; label: string; available: boolean }> = [
  { value: "csv", label: "Generic CSV", available: true },
  { value: "judgeme", label: "Judge.me", available: true },
  { value: "loox", label: "Loox", available: true },
  { value: "stamped", label: "Stamped", available: true },
  { value: "alireviews", label: "Ali Reviews", available: true },
  { value: "ryviu", label: "Ryviu", available: false },
];
