// Exercises emailTemplateService against a fake in-memory EmailTemplate table — no real
// database. See product.server.test.ts for the same mocking convention this file follows.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultEmailTemplateContent, type EmailTemplateContent } from "./email.shared";

interface FakeRow {
  id: string;
  storeId: string;
  name: string;
  type: string;
  isActive: boolean;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

let rows: FakeRow[];
let nextId: number;

vi.mock("../db.server", () => ({
  default: {
    emailTemplate: {
      findFirst: vi.fn(async (args: { where: { storeId: string; type: string; isActive: boolean } }) => {
        return (
          rows.find(
            (row) =>
              row.storeId === args.where.storeId && row.type === args.where.type && row.isActive === args.where.isActive,
          ) ?? null
        );
      }),
      create: vi.fn(
        async (args: { data: { storeId: string; type: string; name: string; isActive: boolean; content: string } }) => {
          const row: FakeRow = {
            id: `et_${nextId++}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...args.data,
          };
          rows.push(row);
          return row;
        },
      ),
      update: vi.fn(async (args: { where: { id: string }; data: Partial<FakeRow> }) => {
        const row = rows.find((candidate) => candidate.id === args.where.id);
        if (!row) throw new Error("Row not found");
        Object.assign(row, args.data, { updatedAt: new Date() });
        return row;
      }),
      deleteMany: vi.fn(async (args: { where: { storeId: string; type: string; isActive: boolean } }) => {
        const before = rows.length;
        rows = rows.filter(
          (row) =>
            !(row.storeId === args.where.storeId && row.type === args.where.type && row.isActive === args.where.isActive),
        );
        return { count: before - rows.length };
      }),
    },
  },
}));

const { emailTemplateService } = await import("./emailTemplate.server");

describe("emailTemplateService", () => {
  beforeEach(() => {
    rows = [];
    nextId = 1;
    vi.clearAllMocks();
  });

  it("getActive returns null when the store has never customized anything", async () => {
    expect(await emailTemplateService.getActive("store_1")).toBeNull();
  });

  it("getActiveContent falls back to defaults when no row exists", async () => {
    expect(await emailTemplateService.getActiveContent("store_1")).toEqual(getDefaultEmailTemplateContent());
  });

  it("upsertActive creates a row on first save and getActiveContent then returns it", async () => {
    const content: EmailTemplateContent = {
      subject: "Loved your order?",
      heading: "Hi {{customer_name}}!",
      bodyText: "Tell us what you thought.",
      buttonText: "Leave a review",
      accentColor: "#ff6600",
      logoUrl: "https://example.com/logo.png",
    };

    await emailTemplateService.upsertActive("store_1", { content });

    expect(await emailTemplateService.getActiveContent("store_1")).toEqual(content);
  });

  it("upsertActive updates the existing row on a second save instead of creating a duplicate", async () => {
    await emailTemplateService.upsertActive("store_1", {
      content: { ...getDefaultEmailTemplateContent(), subject: "First save" },
    });
    await emailTemplateService.upsertActive("store_1", {
      content: { ...getDefaultEmailTemplateContent(), subject: "Second save" },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].content).toContain("Second save");
  });

  it("upsertActive for one store never affects another store's template", async () => {
    await emailTemplateService.upsertActive("store_1", {
      content: { ...getDefaultEmailTemplateContent(), subject: "Store 1 subject" },
    });

    expect(await emailTemplateService.getActiveContent("store_2")).toEqual(getDefaultEmailTemplateContent());
  });

  it("resetToDefault deletes the row, so getActiveContent falls back to defaults again", async () => {
    await emailTemplateService.upsertActive("store_1", {
      content: { ...getDefaultEmailTemplateContent(), subject: "Customized" },
    });
    expect((await emailTemplateService.getActiveContent("store_1")).subject).toBe("Customized");

    await emailTemplateService.resetToDefault("store_1");

    expect(await emailTemplateService.getActiveContent("store_1")).toEqual(getDefaultEmailTemplateContent());
  });

  it("resetToDefault on a store with no saved template is a safe no-op", async () => {
    await expect(emailTemplateService.resetToDefault("store_never_customized")).resolves.toBeUndefined();
  });
});
