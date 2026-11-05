// Server-side authorization for the Branded Email Sender Identity, exercised through
// app.email-studio.tsx's REAL action against the REAL plan tables.
//
// Why this file exists. The resolver tests in emailSenderIdentity.server.test.ts all build
// their own `{ canUseBrandedEmailSender: true }` literal, so they only ever described a
// hypothetical Pro. They passed for months while the actual `growth` plan granted the flag
// false — the feature was advertised to Pro in Email Studio and reachable by nobody. The
// permissions module is deliberately NOT mocked here: this asserts the end-to-end answer a
// real merchant's POST receives on each real plan, which is the thing that was broken.
//
// Hiding the input in the UI is cosmetic. This action is the boundary that actually stops an
// unentitled store from saving a branded sender with a hand-rolled POST.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/auth-dedupe.server", () => ({
  authenticateAdminDeduped: vi.fn(async () => ({
    session: { shop: "gracestoreofficial.myshopify.com" },
    admin: {},
  })),
}));

// The plan under test. getStorePermissions resolves it through the real
// PERMISSIONS_BY_PLAN table, so this single value is what distinguishes a Free store from a
// Pro one for every assertion below.
let storePlan = "starter";

vi.mock("../db.server", () => ({
  default: {
    store: {
      findUnique: vi.fn(async () => ({ plan: storePlan })),
    },
  },
}));

vi.mock("../services/store.server", () => ({
  getOrCreateStore: vi.fn(async () => ({
    id: "store_1",
    name: "gracestoreofficial",
    emailSenderName: null,
    emailLogoUrl: null,
    emailLogoDarkUrl: null,
    replyToEmail: null,
    replyToVerifiedAt: null,
    contactEmail: null,
  })),
  updateEmailSenderName: (storeId: string, senderName: string | null) =>
    updateEmailSenderNameMock(storeId, senderName),
  updateEmailBrandingLogos: vi.fn(async () => ({})),
}));

// Echoes its arguments back so the parameters are genuinely used (the repo's eslint config
// has no underscore exemption) and the recorded call is self-describing in a failure message.
const updateEmailSenderNameMock = vi.fn(async (storeId: string, senderName: string | null) => ({
  storeId,
  senderName,
}));

vi.mock("../services/emailTemplate.server", () => ({
  emailTemplateService: {
    getActiveContent: vi.fn(async () => ({ replyToEmail: null })),
  },
}));

const { action } = await import("./app.email-studio");

function saveSenderName(name: string) {
  const formData = new FormData();
  formData.set("_intent", "save-sender-identity");
  formData.set("emailSenderName", name);
  formData.set("type", "review_request");

  return action({
    request: new Request("https://example.com/app/email-studio", { method: "POST", body: formData }),
  } as never) as Promise<{ ok: boolean; error?: string; emailSenderName?: string | null }>;
}

beforeEach(() => {
  updateEmailSenderNameMock.mockClear();
  process.env.RESEND_FROM_EMAIL = "Imagyn Reviews <reviews@notifications.imagyn.co>";
});

describe("Free plan — direct POST is rejected server-side", () => {
  beforeEach(() => {
    storePlan = "starter";
  });

  it("refuses to save a branded sender name and names the plan required", async () => {
    const result = await saveSenderName("Grace Store");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Pro plan/i);
  });

  it("writes nothing — the rejection happens before any persistence", async () => {
    await saveSenderName("Grace Store");

    expect(updateEmailSenderNameMock).not.toHaveBeenCalled();
  });

  // The UI never renders this field for a Free store, so reaching this path at all means
  // someone crafted the request by hand. It must still fail.
  it("cannot be bypassed by a crafted request that omits the UI entirely", async () => {
    const formData = new FormData();
    formData.set("_intent", "save-sender-identity");
    formData.set("emailSenderName", "Totally Legit Brand");

    const result = (await action({
      request: new Request("https://example.com/app/email-studio", { method: "POST", body: formData }),
    } as never)) as { ok: boolean };

    expect(result.ok).toBe(false);
    expect(updateEmailSenderNameMock).not.toHaveBeenCalled();
  });
});

describe("Pro plan — the advertised feature actually works", () => {
  beforeEach(() => {
    storePlan = "growth";
  });

  // The regression itself. Before the fix this returned ok: false with "requires the Pro
  // plan" for a store that was already ON the Pro plan.
  it("saves the branded sender name", async () => {
    const result = await saveSenderName("Grace Store");

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(updateEmailSenderNameMock).toHaveBeenCalledWith("store_1", "Grace Store");
  });

  it("sanitises the stored value, since it ends up in a mail header", async () => {
    await saveSenderName("  Grace   Store  ");

    const [, stored] = updateEmailSenderNameMock.mock.calls[0];
    expect(stored).not.toMatch(/^\s|\s$/);
    expect(stored).not.toMatch(/[\r\n]/);
  });
});

// A trialing Pro store carries plan "growth" with planStatus "trialing"; getStorePlanId reads
// `plan` and never `status`, so the trial resolves to the full Pro table. A merchant must not
// have to wait for the first charge before a feature they are currently being sold works.
describe("Pro trial — entitled from the start of the trial", () => {
  beforeEach(() => {
    storePlan = "growth";
  });

  it("saves the branded sender name during the trial window", async () => {
    const result = await saveSenderName("Grace Store");

    expect(result.ok).toBe(true);
    expect(updateEmailSenderNameMock).toHaveBeenCalledWith("store_1", "Grace Store");
  });
});

// Legacy Scale subscribers must not lose a capability that moved up into Pro.
describe("retired Scale tier — existing subscribers keep the capability", () => {
  beforeEach(() => {
    storePlan = "scale";
  });

  it("still saves the branded sender name", async () => {
    const result = await saveSenderName("Grace Store");

    expect(result.ok).toBe(true);
  });
});
