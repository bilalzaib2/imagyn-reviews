import prisma from "../db.server";

// Minimal audit trail for MEANINGFUL access to protected customer data — not a general query
// log. Wired into exactly two kinds of event today: the GDPR compliance webhooks
// (webhooks.compliance.tsx — data_request/redact/shop_redact are, by definition, protected
// customer data access events) and bulk export of reviewer contact fields
// (reviewImportExport.server.ts's exportReviewsToCsv). Deliberately NOT wired into every
// individual review read/list/detail-panel view — that would be "every generic database
// query," which is exactly what this was asked not to become.
//
// Hard rule, enforced here (the single write path for this table): never pass an email,
// name, token, or raw review/order content as `detail`. `resource` is always a fixed
// category string; `detail` is short, non-PII context only (e.g. a row count or a generic
// reason). If a caller needs to log something more specific than that, the category system
// needs a new value, not a detail string carrying PII.
export type AuditActor =
  | "webhook:customers_data_request"
  | "webhook:customers_redact"
  | "webhook:shop_redact"
  | "admin:csv_export"
  | "system:retention_purge";

export type AuditAction = "data_request" | "redact" | "export" | "purge";

export type AuditResource = "review.contact_fields" | "reviewRequest.contact_fields" | "store.all_data";

export async function recordDataAccess(entry: {
  storeId: string | null;
  actor: AuditActor;
  action: AuditAction;
  resource: AuditResource;
  success: boolean;
  detail?: string;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        storeId: entry.storeId,
        actor: entry.actor,
        action: entry.action,
        resource: entry.resource,
        success: entry.success,
        detail: entry.detail,
      },
    });
  } catch (error) {
    // An audit-log write failure must never break the real operation it's describing (a
    // GDPR webhook response, a CSV export) — log it for visibility and move on, the same
    // "never let a side-effect break the primary action" convention already used throughout
    // this codebase (e.g. review-request.server.ts's fire-and-forget reward evaluation).
    console.error("[auditLog] Failed to record audit entry:", error);
  }
}
