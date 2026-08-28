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

describe("emailTemplateService — multiple types per store", () => {
  beforeEach(() => {
    rows = [];
    nextId = 1;
    vi.clearAllMocks();
  });

  it("getActiveContent falls back to that type's own defaults, not review_request's", async () => {
    const reminder1Content = await emailTemplateService.getActiveContent("store_1", "reminder_1");
    const reviewRequestContent = await emailTemplateService.getActiveContent("store_1", "review_request");

    expect(reminder1Content).toEqual(getDefaultEmailTemplateContent("reminder_1"));
    expect(reminder1Content.subject).not.toBe(reviewRequestContent.subject);
  });

  it("saving one type never affects another type on the same store", async () => {
    await emailTemplateService.upsertActive("store_1", {
      type: "review_request",
      content: { ...getDefaultEmailTemplateContent("review_request"), subject: "Review request subject" },
    });
    await emailTemplateService.upsertActive("store_1", {
      type: "reminder_1",
      content: { ...getDefaultEmailTemplateContent("reminder_1"), subject: "Reminder 1 subject" },
    });

    expect((await emailTemplateService.getActiveContent("store_1", "review_request")).subject).toBe(
      "Review request subject",
    );
    expect((await emailTemplateService.getActiveContent("store_1", "reminder_1")).subject).toBe("Reminder 1 subject");
    expect(rows).toHaveLength(2);
  });

  it("all three types can be independently saved and read back for the same store", async () => {
    await emailTemplateService.upsertActive("store_1", {
      type: "reminder_1",
      content: { ...getDefaultEmailTemplateContent("reminder_1"), subject: "R1" },
    });
    await emailTemplateService.upsertActive("store_1", {
      type: "reminder_final",
      content: { ...getDefaultEmailTemplateContent("reminder_final"), subject: "Final" },
    });

    expect((await emailTemplateService.getActiveContent("store_1", "reminder_1")).subject).toBe("R1");
    expect((await emailTemplateService.getActiveContent("store_1", "reminder_final")).subject).toBe("Final");
    expect(rows).toHaveLength(2);
  });

  it("resetToDefault on one type never deletes another type's row", async () => {
    await emailTemplateService.upsertActive("store_1", {
      type: "review_request",
      content: { ...getDefaultEmailTemplateContent("review_request"), subject: "Kept" },
    });
    await emailTemplateService.upsertActive("store_1", {
      type: "reminder_1",
      content: { ...getDefaultEmailTemplateContent("reminder_1"), subject: "Removed" },
    });

    await emailTemplateService.resetToDefault("store_1", "reminder_1");

    expect((await emailTemplateService.getActiveContent("store_1", "review_request")).subject).toBe("Kept");
    expect((await emailTemplateService.getActiveContent("store_1", "reminder_1")).subject).toBe(
      getDefaultEmailTemplateContent("reminder_1").subject,
    );
  });

  it("a second save to the same (store, type) updates in place rather than creating a duplicate row", async () => {
    await emailTemplateService.upsertActive("store_1", {
      type: "reminder_final",
      content: { ...getDefaultEmailTemplateContent("reminder_final"), subject: "First" },
    });
    await emailTemplateService.upsertActive("store_1", {
      type: "reminder_final",
      content: { ...getDefaultEmailTemplateContent("reminder_final"), subject: "Second" },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].content).toContain("Second");
  });
});

describe("emailTemplateService.applyBrandingToAllTemplates", () => {
  beforeEach(() => {
    rows = [];
    nextId = 1;
    vi.clearAllMocks();
  });

  it("applies the same accent color and logo to all three template types", async () => {
    await emailTemplateService.applyBrandingToAllTemplates("store_1", {
      accentColor: "#ff6600",
      logoUrl: "https://example.com/logo.png",
    });

    for (const type of ["review_request", "reminder_1", "reminder_final"] as const) {
      const content = await emailTemplateService.getActiveContent("store_1", type);
      expect(content.accentColor).toBe("#ff6600");
      expect(content.logoUrl).toBe("https://example.com/logo.png");
    }
    expect(rows).toHaveLength(3);
  });

  it("preserves each template's own subject/heading/bodyText/buttonText — never overwrites copy", async () => {
    await emailTemplateService.upsertActive("store_1", {
      type: "review_request",
      content: { ...getDefaultEmailTemplateContent("review_request"), subject: "Custom subject the merchant wrote" },
    });

    await emailTemplateService.applyBrandingToAllTemplates("store_1", {
      accentColor: "#111111",
      logoUrl: null,
    });

    const content = await emailTemplateService.getActiveContent("store_1", "review_request");
    expect(content.subject).toBe("Custom subject the merchant wrote");
    expect(content.accentColor).toBe("#111111");
  });

  it("applies branding to a type even if it was never customized before (uses that type's own defaults as the base)", async () => {
    const before = await emailTemplateService.getActiveContent("store_1", "reminder_final");
    expect(before).toEqual(getDefaultEmailTemplateContent("reminder_final"));

    await emailTemplateService.applyBrandingToAllTemplates("store_1", {
      accentColor: "#00ff00",
      logoUrl: null,
    });

    const after = await emailTemplateService.getActiveContent("store_1", "reminder_final");
    expect(after.accentColor).toBe("#00ff00");
    expect(after.heading).toBe(getDefaultEmailTemplateContent("reminder_final").heading);
  });

  it("accepts a null logoUrl (clears the logo) without error", async () => {
    await emailTemplateService.upsertActive("store_1", {
      type: "review_request",
      content: { ...getDefaultEmailTemplateContent("review_request"), logoUrl: "https://example.com/old-logo.png" },
    });

    await emailTemplateService.applyBrandingToAllTemplates("store_1", { accentColor: "#123456", logoUrl: null });

    expect((await emailTemplateService.getActiveContent("store_1", "review_request")).logoUrl).toBeNull();
  });

  it("is store-scoped — applying branding for one store never touches another store's templates", async () => {
    await emailTemplateService.upsertActive("store_2", {
      type: "review_request",
      content: { ...getDefaultEmailTemplateContent("review_request"), subject: "Store 2's own subject" },
    });

    await emailTemplateService.applyBrandingToAllTemplates("store_1", { accentColor: "#abcdef", logoUrl: null });

    const store2Content = await emailTemplateService.getActiveContent("store_2", "review_request");
    expect(store2Content.subject).toBe("Store 2's own subject");
    expect(store2Content.accentColor).not.toBe("#abcdef");
  });
});
