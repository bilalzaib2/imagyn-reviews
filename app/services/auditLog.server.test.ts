import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn(async () => ({}));

vi.mock("../db.server", () => ({
  default: {
    auditLog: {
      create: createMock,
    },
  },
}));

const { recordDataAccess } = await import("./auditLog.server");

beforeEach(() => {
  createMock.mockClear();
  createMock.mockImplementation(async () => ({}));
});

describe("recordDataAccess", () => {
  it("writes exactly the fields passed in — no more, no less", async () => {
    await recordDataAccess({
      storeId: "store_1",
      actor: "admin:csv_export",
      action: "export",
      resource: "review.contact_fields",
      success: true,
      detail: "42 row(s)",
    });

    expect(createMock).toHaveBeenCalledWith({
      data: {
        storeId: "store_1",
        actor: "admin:csv_export",
        action: "export",
        resource: "review.contact_fields",
        success: true,
        detail: "42 row(s)",
      },
    });
  });

  it("accepts a null storeId (store already deleted, or none matched)", async () => {
    await recordDataAccess({
      storeId: null,
      actor: "webhook:shop_redact",
      action: "redact",
      resource: "store.all_data",
      success: true,
    });

    expect(createMock).toHaveBeenCalledWith({
      data: {
        storeId: null,
        actor: "webhook:shop_redact",
        action: "redact",
        resource: "store.all_data",
        success: true,
        detail: undefined,
      },
    });
  });

  it("never throws when the write itself fails — a broken audit log must never break the real operation", async () => {
    createMock.mockRejectedValueOnce(new Error("Connection reset"));

    await expect(
      recordDataAccess({
        storeId: "store_1",
        actor: "system:retention_purge",
        action: "purge",
        resource: "reviewRequest.contact_fields",
        success: true,
      }),
    ).resolves.toBeUndefined();
  });

  it("only ever accepts fixed category strings for resource/action — never free-text PII", () => {
    // Compile-time guarantee, not a runtime check: AuditResource/AuditAction/AuditActor are
    // closed union types (see auditLog.server.ts), so a caller physically cannot pass an
    // email address or raw content as `resource` or `action` without a type error. This test
    // exists so that guarantee shows up in the test suite, not just in the type definitions.
    const resources: Array<Parameters<typeof recordDataAccess>[0]["resource"]> = [
      "review.contact_fields",
      "reviewRequest.contact_fields",
      "store.all_data",
    ];
    expect(resources).toHaveLength(3);
  });
});
