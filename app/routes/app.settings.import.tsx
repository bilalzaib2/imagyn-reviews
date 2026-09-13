import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Banner, Frame, Toast } from "@shopify/polaris";
import { Button } from "../components/ui/Button";
import { Section } from "../components/ui/Section";
import { EmptyState } from "../components/ui/EmptyState";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import {
  IMPORT_SOURCES,
  PUBLICATION_MODES,
  type ImportSource,
  type HeaderOverrides,
  type ColumnDetectionResult,
  type PublicationMode,
} from "../services/importers/types";
import {
  importReviews,
  detectImportColumns,
  listImportBatches,
  undoImportBatch,
  type ImportResult,
} from "../services/reviewImportExport.server";
import styles from "../styles/app.import.module.css";
import managementStyles from "../styles/app.management.module.css";

type ImportBatchSummary = Awaited<ReturnType<typeof listImportBatches>>[number];

type LoaderData = {
  sources: typeof IMPORT_SOURCES;
  batches: ImportBatchSummary[];
};

type ActionData =
  | { ok: true; intent: "detect"; detection: ColumnDetectionResult }
  | { ok: true; intent: "preview" | "import"; result: ImportResult }
  | { ok: true; intent: "undo"; message: string }
  | { ok: false; intent: string; error: string };

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const batches = await listImportBatches(store.id, 20);

  return { sources: IMPORT_SOURCES, batches };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { admin, session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("_intent") || "");

  try {
    if (intent === "detect") {
      const source = String(formData.get("source") || "csv") as ImportSource;
      const fileContent = String(formData.get("fileContent") || "");
      if (!fileContent.trim()) {
        return { ok: false, intent, error: "The file is empty." };
      }
      const detection = detectImportColumns(source, fileContent);
      return { ok: true, intent: "detect", detection };
    }

    if (intent === "preview" || intent === "import") {
      const source = String(formData.get("source") || "csv") as ImportSource;
      const fileContent = String(formData.get("fileContent") || "");
      const filename = String(formData.get("filename") || "") || null;
      const overridesRaw = String(formData.get("overrides") || "{}");
      let overrides: HeaderOverrides = {};
      try {
        overrides = JSON.parse(overridesRaw);
      } catch {
        // Malformed override payload — proceed with no overrides rather than failing the
        // whole import over a client-side JSON bug.
      }
      const publicationModeRaw = String(formData.get("publicationMode") || "preserve");
      const publicationMode: PublicationMode = PUBLICATION_MODES.some((mode) => mode.value === publicationModeRaw)
        ? (publicationModeRaw as PublicationMode)
        : "preserve";

      if (!fileContent.trim()) {
        return { ok: false, intent, error: "The file is empty." };
      }

      const result = await importReviews(store.id, source, fileContent, admin, intent === "preview", filename, overrides, publicationMode);
      return { ok: true, intent, result };
    }

    if (intent === "undo") {
      const importBatchId = String(formData.get("importBatchId") || "");
      if (!importBatchId) {
        return { ok: false, intent, error: "Missing import batch id." };
      }
      const { restored } = await undoImportBatch(store.id, importBatchId);
      return { ok: true, intent: "undo", message: `Undone — ${restored} review${restored === 1 ? "" : "s"} removed.` };
    }

    return { ok: false, intent, error: "Unsupported action." };
  } catch (error) {
    console.error(`[app.settings.import] action "${intent}" failed:`, error);
    return { ok: false, intent, error: error instanceof Error ? error.message : "Action failed." };
  }
};

const FIELD_LABELS: Record<string, string> = {
  product: "Product title",
  productId: "Shopify product ID",
  variantId: "Variant ID",
  productHandle: "Product handle",
  productUrl: "Product URL",
  productSlug: "Product slug",
  sku: "SKU",
  rating: "Rating",
  title: "Review title",
  content: "Review content",
  reviewerName: "Reviewer name",
  reviewerEmail: "Reviewer email",
  reviewerLocation: "Reviewer location",
  verifiedPurchase: "Verified purchase",
  createdAt: "Created date",
  status: "Status",
  externalId: "External ID",
  reply: "Merchant reply",
  repliedAt: "Reply date",
  mediaUrls: "Photo URLs",
};

const REQUIRED_HINT_FIELDS = ["rating", "content"];

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );
}

export default function ImportReviewsPage() {
  const { sources, batches } = useLoaderData<typeof loader>();
  const detectFetcher = useFetcher<ActionData>();
  const previewFetcher = useFetcher<ActionData>();
  const importFetcher = useFetcher<ActionData>();
  const undoFetcher = useFetcher<ActionData>();

  const [source, setSource] = useState<ImportSource>("csv");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [overrides, setOverrides] = useState<HeaderOverrides>({});
  const [publicationMode, setPublicationMode] = useState<PublicationMode>("preserve");
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDetecting = detectFetcher.state !== "idle";
  const isPreviewing = previewFetcher.state !== "idle";
  const isImporting = importFetcher.state !== "idle";

  const detection = detectFetcher.data?.ok && detectFetcher.data.intent === "detect" ? detectFetcher.data.detection : null;
  const previewResult = previewFetcher.data?.ok && previewFetcher.data.intent === "preview" ? previewFetcher.data.result : null;
  const importResult = importFetcher.data?.ok && importFetcher.data.intent === "import" ? importFetcher.data.result : null;

  useEffect(() => {
    if (undoFetcher.data?.ok && undoFetcher.data.intent === "undo") {
      setToast({ content: undoFetcher.data.message });
    } else if (undoFetcher.data && !undoFetcher.data.ok) {
      setToast({ content: undoFetcher.data.error, error: true });
    }
  }, [undoFetcher.data]);

  const resetForNewFile = () => {
    setFileContent(null);
    setFileName(null);
    setOverrides({});
  };

  const readFile = (file: File) => {
    resetForNewFile();
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setFileContent(text);

      const formData = new FormData();
      formData.append("_intent", "detect");
      formData.append("source", source);
      formData.append("fileContent", text);
      detectFetcher.submit(formData, { method: "post" });
    };
    reader.onerror = () => setToast({ content: "Unable to read the file.", error: true });
    reader.readAsText(file);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) readFile(file);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) readFile(file);
  };

  const handleSourceChange = (next: ImportSource) => {
    setSource(next);
    resetForNewFile();
  };

  const runPreview = () => {
    if (!fileContent) return;
    const formData = new FormData();
    formData.append("_intent", "preview");
    formData.append("source", source);
    formData.append("fileContent", fileContent);
    formData.append("filename", fileName || "");
    formData.append("overrides", JSON.stringify(overrides));
    formData.append("publicationMode", publicationMode);
    previewFetcher.submit(formData, { method: "post" });
  };

  const runImport = () => {
    if (!fileContent) return;
    const formData = new FormData();
    formData.append("_intent", "import");
    formData.append("source", source);
    formData.append("fileContent", fileContent);
    formData.append("filename", fileName || "");
    formData.append("overrides", JSON.stringify(overrides));
    formData.append("publicationMode", publicationMode);
    importFetcher.submit(formData, { method: "post" });
  };

  const handleUndo = (importBatchId: string) => {
    if (!window.confirm("Undo this import? Every review it created will be removed. This can't be undone.")) {
      return;
    }
    const formData = new FormData();
    formData.append("_intent", "undo");
    formData.append("importBatchId", importBatchId);
    undoFetcher.submit(formData, { method: "post" });
  };

  const canPreview = Boolean(fileContent) && !isDetecting && (detection ? detection.missingRequired.length === 0 : false);

  return (
    <>
      <Section
        title="Import reviews"
        description="Bring your existing reviews to Imagyn from Judge.me, Loox, Stamped, Ali Reviews, or a generic CSV export."
      >
        <ul className={styles.stepList} aria-label="Import steps">
          <li className={`${styles.step} ${!fileContent ? styles.stepActive : styles.stepDone}`}>1. Choose source &amp; upload</li>
          <li className={`${styles.step} ${fileContent && !previewResult ? styles.stepActive : previewResult ? styles.stepDone : ""}`}>
            2. Review mapping &amp; preview
          </li>
          <li className={`${styles.step} ${previewResult && !importResult ? styles.stepActive : importResult ? styles.stepDone : ""}`}>
            3. Import
          </li>
        </ul>

        <p className={managementStyles.settingsGroupLabel}>1. Choose source</p>
        <div className={styles.sourceGrid} role="radiogroup" aria-label="Import source">
          {sources.map((entry) => (
            <button
              key={entry.value}
              type="button"
              role="radio"
              aria-checked={source === entry.value}
              disabled={!entry.available}
              className={`${styles.sourceCard} ${source === entry.value ? styles.sourceCardActive : ""}`}
              onClick={() => handleSourceChange(entry.value)}
            >
              <span className={styles.sourceCardLabel}>{entry.label}</span>
              <span className={styles.sourceCardTag}>{entry.available ? "Available" : "Coming soon"}</span>
            </button>
          ))}
        </div>

        <p className={managementStyles.settingsGroupLabel}>2. Upload your export</p>
        <label
          className={`${styles.uploadZone} ${isDragging ? styles.uploadZoneDragging : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          {fileName ? (
            <span className={styles.uploadZoneFilename}>{fileName}</span>
          ) : (
            <span>Drag a CSV file here, or click to choose one.</span>
          )}
          <span className={managementStyles.mutedText}>.csv files only, up to 25MB.</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className={styles.hiddenFileInput}
            onChange={handleFileChange}
          />
        </label>

        {isDetecting ? <p className={managementStyles.mutedText}>Analyzing file…</p> : null}

        {detection ? (
          <>
            <p className={managementStyles.settingsGroupLabel}>Detected columns — correct anything that&apos;s wrong</p>
            {detection.missingRequired.length > 0 ? (
              <Banner tone="critical">
                Missing required column{detection.missingRequired.length === 1 ? "" : "s"}:{" "}
                {detection.missingRequired.map((field) => FIELD_LABELS[field] ?? field).join(", ")}. Map{" "}
                {detection.missingRequired.length === 1 ? "it" : "them"} below or fix your export.
              </Banner>
            ) : null}
            <div style={{ overflowX: "auto" }}>
              <table className={styles.mappingTable}>
                <thead>
                  <tr>
                    <th>Imagyn field</th>
                    <th>Mapped column</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(FIELD_LABELS).map((field) => {
                    const currentValue = overrides[field as keyof HeaderOverrides] ?? detection.detected[field as keyof typeof detection.detected] ?? "";
                    const isRequired = REQUIRED_HINT_FIELDS.includes(field);
                    return (
                      <tr key={field}>
                        <td className={isRequired ? styles.mappingFieldRequired : undefined}>{FIELD_LABELS[field]}</td>
                        <td>
                          <select
                            className={styles.mappingSelect}
                            value={currentValue}
                            onChange={(event) =>
                              setOverrides((current) => ({ ...current, [field]: event.target.value }))
                            }
                          >
                            <option value="">Not mapped</option>
                            {detection.headers.map((header) => (
                              <option key={header} value={header}>
                                {header}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className={managementStyles.settingsGroupLabel}>Publication status</p>
            <div className={styles.sourceGrid} role="radiogroup" aria-label="Publication status for imported reviews">
              {PUBLICATION_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  role="radio"
                  aria-checked={publicationMode === mode.value}
                  className={`${styles.sourceCard} ${publicationMode === mode.value ? styles.sourceCardActive : ""}`}
                  onClick={() => setPublicationMode(mode.value)}
                >
                  <span className={styles.sourceCardLabel}>{mode.label}</span>
                  <span className={managementStyles.mutedText}>{mode.description}</span>
                </button>
              ))}
            </div>

            <div className={styles.actionsBar}>
              <Button variant="primary" onClick={runPreview} disabled={!canPreview || isPreviewing}>
                {isPreviewing ? "Analyzing…" : "Preview import"}
              </Button>
            </div>
          </>
        ) : null}

        {previewResult ? (
          <>
            <p className={managementStyles.settingsGroupLabel}>3. Preview — nothing has been imported yet</p>
            <ImportResultBreakdown result={previewResult} />
            {previewResult.errors.length === 0 || previewResult.imported > 0 ? (
              <div className={styles.actionsBar}>
                <Button variant="primary" onClick={runImport} disabled={isImporting}>
                  {isImporting ? "Importing…" : `Import ${previewResult.expectedImportedCount} review${previewResult.expectedImportedCount === 1 ? "" : "s"}`}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}

        {importResult ? (
          <div className={styles.resultBanner}>
            <p className={styles.resultBannerTitle}>Import complete</p>
            <ImportResultBreakdown result={importResult} />
          </div>
        ) : null}
      </Section>

      <Section title="Import history" description="Every review migration this store has run.">
        {batches.length === 0 ? (
          <EmptyState title="No imports yet" description="Once you run your first import, it will show up here." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className={styles.historyTable}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Source</th>
                  <th>File</th>
                  <th>Imported</th>
                  <th>Duplicates</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => {
                  const sourceLabel = sources.find((entry) => entry.value === batch.source)?.label ?? batch.source;
                  const statusClass =
                    batch.status === "completed"
                      ? styles.statusPillCompleted
                      : batch.status === "failed"
                        ? styles.statusPillFailed
                        : batch.status === "undone"
                          ? styles.statusPillUndone
                          : "";
                  return (
                    <tr key={batch.id}>
                      <td>{formatDate(batch.createdAt)}</td>
                      <td>{sourceLabel}</td>
                      <td>{batch.filename || "—"}</td>
                      <td>{batch.imported}</td>
                      <td>{batch.duplicates}</td>
                      <td>
                        <span className={`${styles.statusPill} ${statusClass}`}>{batch.status}</span>
                      </td>
                      <td>
                        {batch.status === "completed" && batch.imported > 0 ? (
                          <Button variant="ghost" onClick={() => handleUndo(batch.id)} disabled={undoFetcher.state !== "idle"}>
                            Undo
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className={managementStyles.toastFrame}>
        <Frame>{toast ? <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} /> : null}</Frame>
      </div>
    </>
  );
}

function ImportResultBreakdown({ result }: { result: ImportResult }) {
  return (
    <>
      <div className={styles.previewGrid}>
        <Stat label="Total rows" value={result.totalRows} />
        <Stat label="Matched products" value={result.matchedRows} />
        <Stat label="Unmatched products" value={result.unmatchedRows} tone={result.unmatchedRows > 0 ? "warning" : undefined} />
        <Stat label="Ambiguous products" value={result.ambiguousRows} tone={result.ambiguousRows > 0 ? "warning" : undefined} />
        <Stat label="Duplicates" value={result.duplicateRows} />
        <Stat label="Invalid rows" value={result.invalidRows} tone={result.invalidRows > 0 ? "danger" : undefined} />
        <Stat label="Held for moderation" value={result.heldForModeration} />
        <Stat label={result.dryRun ? "Would import" : "Imported"} value={result.expectedImportedCount} />
        <Stat label="Media imported" value={result.importedMedia} />
        <Stat label="Media skipped" value={result.skippedMedia.length} tone={result.skippedMedia.length > 0 ? "warning" : undefined} />
      </div>

      {result.missingProducts.length > 0 ? (
        <>
          <p className={managementStyles.settingsGroupLabel}>Unmatched products</p>
          <ul className={styles.issueList}>
            {result.missingProducts.map((issue, index) => (
              <li key={index} className={styles.issueRow}>
                Row {issue.row}: {issue.reason}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {result.ambiguousProducts.length > 0 ? (
        <>
          <p className={managementStyles.settingsGroupLabel}>Ambiguous products — not imported</p>
          <ul className={styles.issueList}>
            {result.ambiguousProducts.map((issue, index) => (
              <li key={index} className={styles.issueRow}>
                Row {issue.row}: {issue.reason}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {result.errors.length > 0 ? (
        <>
          <p className={managementStyles.settingsGroupLabel}>Errors</p>
          <ul className={styles.issueList}>
            {result.errors.map((issue, index) => (
              <li key={index} className={styles.issueRow}>
                {issue.row > 0 ? `Row ${issue.row}: ` : ""}
                {issue.reason}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {result.warnings.length > 0 ? (
        <>
          <p className={managementStyles.settingsGroupLabel}>Warnings</p>
          <ul className={styles.issueList}>
            {result.warnings.map((issue, index) => (
              <li key={index} className={styles.issueRow}>
                Row {issue.row}: {issue.reason}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {result.skippedMedia.length > 0 ? (
        <>
          <p className={managementStyles.settingsGroupLabel}>Skipped media</p>
          <ul className={styles.issueList}>
            {result.skippedMedia.map((issue, index) => (
              <li key={index} className={styles.issueRow}>
                Row {issue.row}: {issue.reason}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warning" | "danger" }) {
  const toneClass = tone === "warning" ? styles.previewStatWarning : tone === "danger" ? styles.previewStatDanger : "";
  return (
    <div className={`${styles.previewStat} ${toneClass}`}>
      <p className={styles.previewStatValue}>{value}</p>
      <p className={styles.previewStatLabel}>{label}</p>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
