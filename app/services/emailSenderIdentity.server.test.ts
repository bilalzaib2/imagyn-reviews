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

  it("falls back to the platform address rather than omitting the header", () => {
    // REVISED: this used to assert null. With a merchant-scoped From local part there is no
    // mailbox behind the From address, so omitting Reply-To would send replies nowhere. The
    // platform address is exactly where replies landed before the change.
    expect(resolveSenderIdentity(store("Grace"), PRO).replyTo).toBe("reviews@notifications.imagyn.co");
    expect(resolveSenderIdentity(store("Grace"), PRO, "   ").replyTo).toBe("reviews@notifications.imagyn.co");
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

// Verified Reply-To precedence. The rule that matters: an address nobody has proven they
// can read must never be used, and must never displace one that was proven.
describe("verified store Reply-To", () => {
  const VERIFIED = new Date("2026-10-19T12:00:00.000Z");

  function storeWith(extra: Record<string, unknown>) {
    return { name: "gracestoreofficial", emailSenderName: null, ...extra };
  }

  it("uses a verified store address in preference to the template's", () => {
    const identity = resolveSenderIdentity(
      storeWith({ replyToEmail: "support@grace.test", replyToVerifiedAt: VERIFIED }),
      PRO,
      "template@grace.test",
    );

    expect(identity.replyTo).toBe("support@grace.test");
    expect(identity.replyToSource).toBe("verified-store");
  });

  it("ignores an UNVERIFIED store address entirely", () => {
    // Saving is not verifying. The template address remains in effect.
    const identity = resolveSenderIdentity(
      storeWith({ replyToEmail: "unproven@grace.test", replyToVerifiedAt: null }),
      PRO,
      "template@grace.test",
    );

    expect(identity.replyTo).toBe("template@grace.test");
    expect(identity.replyToSource).toBe("template");
  });

  it("never falls back to an UNVERIFIED store address, even with no template address", () => {
    const identity = resolveSenderIdentity(
      storeWith({ replyToEmail: "unproven@grace.test", replyToVerifiedAt: null }),
      PRO,
      null,
    );

    // The property that matters is unchanged: an unproven address is never used. What it falls
    // back TO is now the platform address rather than nothing.
    expect(identity.replyTo).not.toBe("unproven@grace.test");
    expect(identity.replyTo).toBe("reviews@notifications.imagyn.co");
    expect(identity.replyToSource).toBe("platform");
  });

  it("honours a verified store address on EVERY plan", () => {
    // DELIBERATE CHANGE. This was Pro-gated. A merchant who proved they own an inbox should
    // receive their customers' replies regardless of plan, and gating it meant replies silently
    // stopped reaching them on downgrade. Judge.me's default sender likewise routes replies to
    // the merchant's admin address with no plan condition. The custom brand-NAME override
    // remains the Pro feature; this is not it.
    for (const plan of [FREE, PRO]) {
      const identity = resolveSenderIdentity(
        storeWith({ replyToEmail: "support@grace.test", replyToVerifiedAt: VERIFIED }),
        plan,
        "template@grace.test",
      );

      expect(identity.replyTo).toBe("support@grace.test");
      expect(identity.replyToSource).toBe("verified-store");
    }
  });

  it("leaves the From DOMAIN untouched — this is inbox proof, not domain authentication", () => {
    const identity = resolveSenderIdentity(
      storeWith({ replyToEmail: "support@grace.test", replyToVerifiedAt: VERIFIED }),
      PRO,
    );

    expect(identity.fromAddress).toBe("reviews@notifications.imagyn.co");
  });

  it("reports 'platform' when nothing merchant-specific is configured anywhere", () => {
    expect(resolveSenderIdentity(storeWith({}), PRO).replyToSource).toBe("platform");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MERCHANT-SCOPED FROM ADDRESS.
//
// Mirrors Judge.me's documented default sender (requests+<myshopify_domain>@judge.me): the
// DOMAIN stays the platform's verified one so DKIM still signs d=<platform>, while the LOCAL
// PART identifies the merchant. The security property under test throughout is that this is
// merchant-SCOPED, never merchant-CONTROLLED — no store-supplied value may change which domain
// the mail claims to come from.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("merchant-scoped From address", () => {
  const PLATFORM = "reviews@notifications.imagyn.co";

  function shop(extra: Record<string, unknown> = {}) {
    return { name: "Grace Store", emailSenderName: null, domain: "gracestoreofficial.myshopify.com", ...extra };
  }

  it("scopes the local part to the shop domain on the platform's domain", () => {
    const identity = resolveSenderIdentity(shop(), FREE);

    expect(identity.fromAddress).toBe("requests+gracestoreofficial.myshopify.com@notifications.imagyn.co");
    expect(identity.fromAddressIsMerchantScoped).toBe(true);
    expect(identity.fromAddressConfigured).toBe(true);
  });

  it("applies on every plan — identifying the merchant is the product, not an upsell", () => {
    for (const plan of [FREE, PRO]) {
      expect(resolveSenderIdentity(shop(), plan).fromAddress).toBe(
        "requests+gracestoreofficial.myshopify.com@notifications.imagyn.co",
      );
    }
  });

  it("always stays on the platform domain, whatever the store claims its domain is", () => {
    // The spoofing case. A store row whose domain is an attacker-controlled host must not move
    // the From onto that host.
    const identity = resolveSenderIdentity(shop({ domain: "attacker.com" }), PRO);

    expect(identity.fromAddress.endsWith("@notifications.imagyn.co")).toBe(true);
    expect(identity.fromAddress).toBe("requests+attacker.com@notifications.imagyn.co");
  });

  it("cannot be used to inject a different address or a second recipient", () => {
    for (const hostile of [
      "evil@attacker.com",
      "x@attacker.com>, y@attacker.com",
      'a" <b@attacker.com',
      "a\r\nBcc: c@attacker.com",
      "a b@attacker.com",
      "a;b@attacker.com",
    ]) {
      const identity = resolveSenderIdentity(shop({ domain: hostile }), PRO);
      const at = identity.fromAddress.split("@");

      expect(at).toHaveLength(2);
      expect(at[1]).toBe("notifications.imagyn.co");
      expect(identity.fromAddress).not.toMatch(/[\s<>,;"]/);
    }
  });

  it("falls back to the shared platform address when no usable identifier exists", () => {
    for (const domain of [null, undefined, "", "   ", "...", "---"]) {
      const identity = resolveSenderIdentity(shop({ domain, slug: null }), PRO);

      expect(identity.fromAddress).toBe(PLATFORM);
      expect(identity.fromAddressIsMerchantScoped).toBe(false);
      // Still a usable configuration — a send must not be blocked by this.
      expect(identity.fromAddressConfigured).toBe(true);
    }
  });

  it("uses the slug when the domain is missing on an older row", () => {
    const identity = resolveSenderIdentity(shop({ domain: null, slug: "gracestoreofficial" }), PRO);

    expect(identity.fromAddress).toBe("requests+gracestoreofficial@notifications.imagyn.co");
  });

  it("keeps the local part within the 64-octet limit", () => {
    const identity = resolveSenderIdentity(shop({ domain: `${"a".repeat(200)}.myshopify.com` }), PRO);
    const localPart = identity.fromAddress.split("@")[0];

    expect(localPart.length).toBeLessThanOrEqual(64);
    expect(localPart.startsWith("requests+")).toBe(true);
  });

  it("isolates stores — two shops never resolve to the same address", () => {
    const a = resolveSenderIdentity(shop({ domain: "shop-a.myshopify.com" }), PRO);
    const b = resolveSenderIdentity(shop({ domain: "shop-b.myshopify.com" }), PRO);

    expect(a.fromAddress).not.toBe(b.fromAddress);
    expect(a.fromAddress).toContain("shop-a.myshopify.com");
    expect(b.fromAddress).toContain("shop-b.myshopify.com");
  });

  it("reports an unusable platform configuration instead of inventing a domain", () => {
    process.env.RESEND_FROM_EMAIL = "not-an-address";

    const identity = resolveSenderIdentity(shop(), PRO);

    expect(identity.fromAddressConfigured).toBe(false);
    expect(identity.fromAddress).toBe("");
    expect(identity.fromAddressIsMerchantScoped).toBe(false);
  });

  it("pairs the merchant display name with the merchant-scoped address", () => {
    // What a customer's inbox actually shows, end to end.
    const identity = resolveSenderIdentity(shop({ emailSenderName: "Grace" }), PRO);

    expect(identity.displayName).toBe("Grace");
    expect(identity.fromAddress).toBe("requests+gracestoreofficial.myshopify.com@notifications.imagyn.co");
  });

  it("falls back to the real store name for the display name on Free, address unchanged", () => {
    const identity = resolveSenderIdentity(shop({ emailSenderName: "Grace" }), FREE);

    expect(identity.displayName).toBe("Grace Store");
    expect(identity.fromAddressIsMerchantScoped).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SHOPIFY CONTACT EMAIL AS THE DEFAULT REPLY-TO.
//
// shop.contactEmail is what Shopify designates for customers to reach the shop owner ("Customers
// will use this email to communicate with the shop owner"), as distinct from shop.email, the
// owner's own account address. It sits BELOW the two deliberate merchant choices and ABOVE the
// platform fallback, so an explicit Email Studio setting still wins while a merchant who
// configured nothing still receives their own customers' replies.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("Shopify contact email as the default Reply-To", () => {
  const PLATFORM = "reviews@notifications.imagyn.co";
  const VERIFIED = new Date("2026-10-19T12:00:00.000Z");

  function shop(extra: Record<string, unknown> = {}) {
    return { name: "Grace Store", emailSenderName: null, domain: "grace.myshopify.com", ...extra };
  }

  it("is used when the merchant has configured nothing else", () => {
    const identity = resolveSenderIdentity(shop({ contactEmail: "hello@gracestore.com" }), FREE);

    expect(identity.replyTo).toBe("hello@gracestore.com");
    expect(identity.replyToSource).toBe("shopify-contact");
  });

  it("applies on every plan", () => {
    for (const plan of [FREE, PRO]) {
      expect(resolveSenderIdentity(shop({ contactEmail: "hello@gracestore.com" }), plan).replyTo).toBe(
        "hello@gracestore.com",
      );
    }
  });

  it("reflects an updated contact email", () => {
    // What a re-sync produces: same store, newer value.
    expect(resolveSenderIdentity(shop({ contactEmail: "old@gracestore.com" }), PRO).replyTo).toBe(
      "old@gracestore.com",
    );
    expect(resolveSenderIdentity(shop({ contactEmail: "new@gracestore.com" }), PRO).replyTo).toBe(
      "new@gracestore.com",
    );
  });

  it("yields to a deliberate merchant choice — a verified store address wins", () => {
    const identity = resolveSenderIdentity(
      shop({ contactEmail: "hello@gracestore.com", replyToEmail: "support@grace.test", replyToVerifiedAt: VERIFIED }),
      PRO,
    );

    expect(identity.replyTo).toBe("support@grace.test");
    expect(identity.replyToSource).toBe("verified-store");
  });

  it("yields to a per-template address too", () => {
    const identity = resolveSenderIdentity(shop({ contactEmail: "hello@gracestore.com" }), PRO, "tpl@grace.test");

    expect(identity.replyTo).toBe("tpl@grace.test");
    expect(identity.replyToSource).toBe("template");
  });

  it("falls back to the platform address when the contact email is missing or blank", () => {
    for (const contactEmail of [null, undefined, "", "   "]) {
      const identity = resolveSenderIdentity(shop({ contactEmail }), PRO);

      expect(identity.replyTo).toBe(PLATFORM);
      expect(identity.replyToSource).toBe("platform");
    }
  });

  it("rejects anything that could control the header, falling back instead", () => {
    for (const hostile of [
      "not-an-address",
      "a@b@c.test",
      "a b@c.test",
      "x@y.test, evil@attacker.com",
      "x@y.test; evil@attacker.com",
      'x@y.test" <evil@attacker.com>',
      "x@y.test\r\nBcc: evil@attacker.com",
      "<evil@attacker.com>",
      "no-at-sign.test",
      `${"a".repeat(300)}@x.test`,
    ]) {
      const identity = resolveSenderIdentity(shop({ contactEmail: hostile }), PRO);

      expect(identity.replyTo).toBe(PLATFORM);
      expect(identity.replyToSource).toBe("platform");
      expect(identity.replyTo).not.toContain("attacker.com");
    }
  });

  it("never leaks into the From header", () => {
    const identity = resolveSenderIdentity(shop({ contactEmail: "hello@gracestore.com" }), PRO);

    // Reply-To needs no domain authentication; From does. The merchant's own domain must never
    // appear in From, which is the whole reason this value is Reply-To only.
    expect(identity.fromAddress).toBe("requests+grace.myshopify.com@notifications.imagyn.co");
    expect(identity.fromAddress).not.toContain("gracestore.com");
  });

  it("isolates stores — one shop's contact email never reaches another's email", () => {
    const a = resolveSenderIdentity(shop({ domain: "a.myshopify.com", contactEmail: "a@a.test" }), PRO);
    const b = resolveSenderIdentity(shop({ domain: "b.myshopify.com", contactEmail: "b@b.test" }), PRO);

    expect(a.replyTo).toBe("a@a.test");
    expect(b.replyTo).toBe("b@b.test");
  });
});
