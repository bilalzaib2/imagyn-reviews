// Imagyn Reviews — Email Studio service layer.
//
// Same shape as appearance.server.ts (getActive/upsertActive over a JSON-string column, one
// active row per scope) — this file reuses that pattern, not any appearance-specific logic.
// Scope here is (storeId, type) rather than just storeId — EmailTemplateType (email.shared.ts)
// has three values: "review_request" (every plan) and "reminder_1"/"reminder_final" (Pro-only,
// gated by canUseEmailReminders — see app.email-studio.tsx), all sharing this same model.

import prisma from "../db.server";
import {
  getDefaultEmailTemplateContent,
  mergeEmailTemplateContent,
  type EmailTemplateContent,
  type EmailTemplateType,
} from "./email.shared";

export type { EmailTemplateType };

export interface EmailTemplateRecord {
  id: string;
  storeId: string;
  name: string;
  type: EmailTemplateType;
  isActive: boolean;
  content: EmailTemplateContent;
  createdAt: Date;
  updatedAt: Date;
}

const parseContent = (raw: string | null, type: EmailTemplateType): EmailTemplateContent => {
  if (!raw) {
    return getDefaultEmailTemplateContent(type);
  }

  try {
    return mergeEmailTemplateContent(JSON.parse(raw) as Partial<EmailTemplateContent>, type);
  } catch {
    return getDefaultEmailTemplateContent(type);
  }
};

const toEmailTemplateRecord = (row: {
  id: string;
  storeId: string;
  name: string;
  type: string;
  isActive: boolean;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}): EmailTemplateRecord => {
  const type = row.type as EmailTemplateType;
  return {
    id: row.id,
    storeId: row.storeId,
    name: row.name,
    type,
    isActive: row.isActive,
    content: parseContent(row.content, type),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

export const emailTemplateService = {
  async getActive(storeId: string, type: EmailTemplateType = "review_request"): Promise<EmailTemplateRecord | null> {
    const row = await prisma.emailTemplate.findFirst({
      where: { storeId, type, isActive: true },
      orderBy: { updatedAt: "desc" },
    });

    return row ? toEmailTemplateRecord(row) : null;
  },

  // Convenience for senders (review-request.server.ts) that only need the resolved content,
  // never the full record — falls back to documented defaults when the store hasn't
  // customized anything, so every existing/unconfigured store's emails are unaffected.
  async getActiveContent(storeId: string, type: EmailTemplateType = "review_request"): Promise<EmailTemplateContent> {
    const active = await this.getActive(storeId, type);
    return active?.content ?? getDefaultEmailTemplateContent(type);
  },

  async upsertActive(
    storeId: string,
    data: { content: EmailTemplateContent; type?: EmailTemplateType; name?: string },
  ): Promise<EmailTemplateRecord> {
    const type = data.type ?? "review_request";
    const existing = await prisma.emailTemplate.findFirst({ where: { storeId, type, isActive: true } });

    const row = existing
      ? await prisma.emailTemplate.update({
          where: { id: existing.id },
          data: {
            content: JSON.stringify(data.content),
            ...(data.name !== undefined ? { name: data.name } : {}),
          },
        })
      : await prisma.emailTemplate.create({
          data: {
            storeId,
            type,
            name: data.name ?? "Default",
            isActive: true,
            content: JSON.stringify(data.content),
          },
        });

    return toEmailTemplateRecord(row);
  },

  // "Reset to default" is a real delete, not a content overwrite — once the row is gone,
  // getActiveContent's fallback (getDefaultEmailTemplateContent) takes over automatically, the
  // same source of truth the very first, never-customized send already used.
  async resetToDefault(storeId: string, type: EmailTemplateType = "review_request"): Promise<void> {
    await prisma.emailTemplate.deleteMany({ where: { storeId, type, isActive: true } });
  },
};
