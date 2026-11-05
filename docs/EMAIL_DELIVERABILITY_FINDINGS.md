# Email deliverability — investigation findings

**Date:** 2026-11-05
**Trigger:** three observations from real test mail received in Apple Mail — missing merchant
logo, generic design with a test identifier visible, and both messages landing in Junk.

Each was investigated separately rather than attributed to one cause. Two had a real product
defect behind them; one did not.

---

## 1. Junk placement — authentication is NOT the cause

The obvious hypothesis was broken SPF, DKIM or DMARC. **That hypothesis is wrong.** Resend's
full DNS setup is correctly in place. Verified by direct DNS lookup:

| Record | Value found | Verdict |
|---|---|---|
| DKIM, `resend._domainkey.notifications.imagyn.co` | RSA public key present | **Correct** |
| DKIM, `resend._domainkey.imagyn.co` | RSA public key present | Correct |
| SPF, `send.notifications.imagyn.co` | `v=spf1 include:amazonses.com ~all` | **Correct** |
| Return-Path MX, `send.notifications.imagyn.co` | `feedback-smtp.ap-northeast-1.amazonses.com` | Correct |
| DMARC, `_dmarc.imagyn.co` | `v=DMARC1; p=none;` | Present, unenforced |

The record on `notifications.imagyn.co` itself is IONOS's (`include:_spf-us.ionos.com`), which
looks alarming but is **not** the record that matters. SPF authenticates the *envelope* sender,
and Resend uses `send.notifications.imagyn.co` as its MAIL FROM — which carries the correct
Amazon SES include. DKIM additionally signs with the From domain, so DMARC alignment passes on
the DKIM side regardless.

**So why Junk?** The remaining explanations, in order of likely weight:

1. **No sending reputation.** These were the first messages ever sent from this domain. Outlook
   and Hotmail are particularly aggressive toward unknown domains, and a brand-new domain with
   zero engagement history is filtered on principle, not on content.
2. **The From address looked like spam.** The actual header was
   `Imagyn Live Test 47e35939 <requests+imagyn-live-header-test-47e35939.myshopify.com@notifications.imagyn.co>`.
   A long, plus-addressed, machine-generated local part containing the word "test", with a
   display name also containing "Test" and a hex string. This is a strong negative signal to
   both a filter and a human. **Fixed** — see §3.
3. **DMARC is `p=none`.** No enforcement gives providers less confidence than `p=quarantine`.

**Recommended actions, all owner-side and all DNS or policy:**

- Raise DMARC to `p=quarantine` once a few days of clean sending have accumulated. Do not jump
  straight to `p=reject`.
- Warm the domain gradually rather than with bursts.
- Mark the test messages "not junk" in the receiving client; engagement signals matter
  disproportionately early on.

**Not verified:** actual inbox placement after these changes. Placement can only be confirmed by
sending again and observing, and it will improve with reputation over days, not instantly. **Do
not record this as fixed.**

---

## 2. Missing merchant logo — a real product gap, now closed

**This was a genuine defect, not an Apple Mail image-blocking artefact.**

Before this change, the only logo an email could render was one the merchant had uploaded
themselves in Email Studio (`Store.emailLogoUrl`) or set per template. A store that had never
opened Email Studio had **no logo at all**, and the renderer correctly fell back to a text-only
brand header. The test store had uploaded nothing, so there was no image to block — there was no
image at all.

Apple Mail's remote-image blocking is real and worth designing around, but it is not what
happened here.

**Implemented:** `app/services/shopBrandLogo.server.ts` reads the merchant's own brand logo from
Shopify (`shop.brand.logo`, falling back to `shop.brand.squareLogo`) and caches it on the store
with a 24-hour TTL, mirroring the existing contact-email sync exactly.

Precedence, which is now pinned by tests in `emailBranding.shared.test.ts`:

1. The template's own custom logo, when it explicitly overrides.
2. The store's shared Email Studio logo.
3. **New:** the Shopify brand logo.
4. Nothing, and the renderer shows the text brand header.

It is a fallback and never an override. A merchant who uploaded a logo keeps it; a merchant who
explicitly set a template to have no logo does not get Shopify's silently reinstated.

The URL is validated at the rendering boundary even though Shopify is a trusted source: HTTPS
only, length-capped, and anything containing a quote, angle bracket or whitespace is rejected, so
no value can break out of the `img src` attribute. 27 tests cover this.

The Email Studio preview was updated to resolve the same logo the real send will, so the preview
cannot drift from what customers receive.

---

## 3. Test identifier in the email — fixture naming, now fixed

Not a product defect. The From display name and the merchant-scoped From local part are both
derived from the store's own name and domain, and the test fixtures were called
`Imagyn Live Test <hex>` with a slug containing `imagyn-live-header-test`. A real merchant's mail
carries their real store name.

Both harnesses now create their fixture store as `Coastal Threads`, so future live test mail
looks like a real merchant's and does not carry a spam-triggering identifier. The row prefix on
the *slug* is retained deliberately, because cleanup matches on it.

**Worth confirming separately:** no production code path can emit a fixture name, because fixture
names only ever exist on rows a harness created and deleted. The live-test scripts are not
imported by application code.

---

## 4. Still unverified

- Inbox placement after reputation accumulates and DMARC is tightened.
- Rendering in Apple Mail with remote images **enabled** — the received screenshots were taken
  with remote content blocked.
- Rendering across other major clients. Gmail, Outlook web and Apple Mail all differ.
- Whether the new Shopify brand logo actually appears in a real send: it requires a store whose
  Shopify Branding settings contain a logo, and the local fixtures have none. **Implemented and
  unit-tested, not yet observed in delivered mail.**
