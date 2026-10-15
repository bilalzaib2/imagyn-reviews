// Branded Email Sender Identity.
//
// The entitlement assertions are the important ones. Hiding the field in Email Studio is
// cosmetic; this resolver is what every customer-facing send actually calls, so if it ever
// honours a brand name for an unentitled store the feature is free in practice no matter
// what the UI shows.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_SENDER_NAME_LENGTH,
  platformFromAddress,
  resolveSenderIdentity,
  sanitizeSenderName,
} from "./emailSenderIdentity.server";

const PRO = { canUseBrandedEmailSender: true };
const FREE = { canUseBrandedEmailSender: false };

const originalFrom = process.env.RESEND_FROM_EMAIL;

beforeEach(() => {
  process.env.RESEND_FROM_EMAIL = "Imagyn Reviews <reviews@notifications.imagyn.co>";
});

afterEach(() => {
  if (originalFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
  else process.env.RESEND_FROM_EMAIL = originalFrom;
});

function store(emailSenderName: string | null, name = "gracestoreofficial") {
  return { name, emailSenderName };
}

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);

describe("entitlement", () => {
  it("uses the merchant's brand name on Pro", () => {
    const identity = resolveSenderIdentity(store("Grace Store"), PRO);

    expect(identity.displayName).toBe("Grace Store");
    expect(identity.brandedNameActive).toBe(true);
    expect(identity.brandedNameBlockedReason).toBeNull();
  });

  it("falls back to the real store name on Free, even with a name saved", () => {
    const identity = resolveSenderIdentity(store("Grace Store"), FREE);

    expect(identity.displayName).toBe("gracestoreofficial");
    expect(identity.brandedNameActive).toBe(false);
    expect(identity.brandedNameBlockedReason).toBe("not-entitled");
  });

  it("cannot be unlocked by the stored value alone — entitlement comes from billing", () => {
    expect(resolveSenderIdentity(store("Anything"), FREE).displayName).toBe("gracestoreofficial");
    expect(resolveSenderIdentity(store("Anything"), PRO).displayName).toBe("Anything");
  });

  it("says the name is simply unset when a Pro store has not configured one", () => {
    const identity = resolveSenderIdentity(store(null), PRO);

    expect(identity.displayName).toBe("gracestoreofficial");
    expect(identity.brandedNameBlockedReason).toBe("not-configured");
  });
});

describe("downgrade and re-upgrade", () => {
  it("stops applying the brand name on downgrade without destroying it", () => {
    const saved = store("Grace Store");

    expect(resolveSenderIdentity(saved, PRO).displayName).toBe("Grace Store");
    expect(resolveSenderIdentity(saved, FREE).displayName).toBe("gracestoreofficial");
    expect(resolveSenderIdentity(saved, PRO).displayName).toBe("Grace Store");
    expect(saved.emailSenderName).toBe("Grace Store");
  });
});

describe("the From address is never merchant-controlled", () => {
  it("always uses the platform's verified address", () => {
    expect(resolveSenderIdentity(store("Grace Store"), PRO).fromAddress).toBe(
      "reviews@notifications.imagyn.co",
    );
  });

  it("strips a display name already configured on the platform address", () => {
    expect(platformFromAddress()).toBe("reviews@notifications.imagyn.co");
  });

  it("accepts a bare address too", () => {
    process.env.RESEND_FROM_EMAIL = "reviews@notifications.imagyn.co";
    expect(platformFromAddress()).toBe("reviews@notifications.imagyn.co");
  });

  it("reports an unusable configuration instead of inventing an address", () => {
    process.env.RESEND_FROM_EMAIL = "not-an-address";
    const identity = resolveSenderIdentity(store("Grace Store"), PRO);

    expect(identity.fromAddressConfigured).toBe(false);
    expect(identity.fromAddress).toBe("");
  });

  it("reports an absent configuration rather than throwing mid-send", () => {
    delete process.env.RESEND_FROM_EMAIL;
    expect(resolveSenderIdentity(store("Grace Store"), PRO).fromAddressConfigured).toBe(false);
  });

  it("a merchant brand name never becomes part of the address", () => {
    const identity = resolveSenderIdentity(store("evil@attacker.test"), PRO);

    expect(identity.fromAddress).toBe("reviews@notifications.imagyn.co");
    expect(identity.displayName).toBe("evil@attacker.test");
  });
});

describe("reply-to", () => {
  it("passes a configured merchant address through", () => {
    expect(resolveSenderIdentity(store("Grace"), PRO, "hello@grace.test").replyTo).toBe("hello@grace.test");
  });

  it("is null when not configured, so the send omits the header entirely", () => {
    expect(resolveSenderIdentity(store("Grace"), PRO).replyTo).toBeNull();
    expect(resolveSenderIdentity(store("Grace"), PRO, "   ").replyTo).toBeNull();
  });

  it("is independent of the branded-name entitlement", () => {
    expect(resolveSenderIdentity(store(null), FREE, "hello@grace.test").replyTo).toBe("hello@grace.test");
  });
});

describe("sanitizeSenderName — this value ends up inside a mail header", () => {
  it("strips CR and LF so a second header cannot be injected", () => {
    expect(sanitizeSenderName("Grace" + CR + LF + "Bcc: victim@example.com")).toBe(
      "Grace Bcc: victim@example.com",
    );
    expect(sanitizeSenderName("Grace" + LF + "X-Evil: 1")).not.toContain(LF);
  });

  it("strips the quoting characters that would break Name <address>", () => {
    expect(sanitizeSenderName('Grace "Store" <x@y.test>')).toBe("Grace Store x@y.test");
  });

  it("strips other control characters", () => {
    expect(sanitizeSenderName("Grace" + NUL + BEL + "Store")).toBe("GraceStore");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeSenderName("  Grace   Store  ")).toBe("Grace Store");
  });

  it("treats an empty or whitespace-only name as not configured", () => {
    expect(sanitizeSenderName("")).toBeNull();
    expect(sanitizeSenderName("   ")).toBeNull();
    expect(sanitizeSenderName(null)).toBeNull();
    expect(sanitizeSenderName(undefined)).toBeNull();
  });

  it("caps the length", () => {
    expect(sanitizeSenderName("A".repeat(200))!.length).toBe(MAX_SENDER_NAME_LENGTH);
  });

  it("keeps ordinary brand names untouched", () => {
    expect(sanitizeSenderName("Pure Nutrition")).toBe("Pure Nutrition");
    expect(sanitizeSenderName("Café Noir & Co.")).toBe("Café Noir & Co.");
  });

  it("sanitises on the way out too, not just on the way in", () => {
    const identity = resolveSenderIdentity(store("Grace" + CR + LF + "Bcc: victim@example.com"), PRO);
    expect(identity.displayName).not.toContain(CR);
    expect(identity.displayName).not.toContain(LF);
  });
});

describe("store isolation", () => {
  it("resolves purely from the store it was handed", () => {
    const a = resolveSenderIdentity(store("Store A", "store-a"), PRO);
    const b = resolveSenderIdentity(store(null, "store-b"), PRO);

    expect(a.displayName).toBe("Store A");
    expect(b.displayName).toBe("store-b");
  });
});
