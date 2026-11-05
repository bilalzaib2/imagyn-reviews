# Resend sender configuration — accelerated reminder test

**Status:** prepared, not applied. The accelerated harness is blocked on item 1 below.
**Audience:** whoever holds the Resend account and the DNS for `imagyn.co`.

The harness (`scripts/accelerated-reminder-test.ts`) runs today in capture mode, where nothing
leaves the process. To run its `--live` leg and prove real delivery, Resend needs one specific
thing it does not currently have locally.

---

## 1. What is missing, exactly

`RESEND_FROM_EMAIL` is present in `.env` but **empty**.

```
RESEND_FROM_EMAIL=
```

`RESEND_API_KEY` is set. `app/services/notifications/resend.server.ts` throws before sending
when the From value is absent:

> `RESEND_FROM_EMAIL is not configured. Set it in the environment to send review request emails.`

So the live leg cannot run, and the harness refuses it up front with that explanation rather
than failing mid-run.

---

## 2. The exact value required

Set it to a mailbox on a domain **verified in the Resend account**. Either form is accepted —
`resend.server.ts` handles a bare address or a `Name <address>` pair:

```
RESEND_FROM_EMAIL="Imagyn Reviews <reviews@notifications.imagyn.co>"
```

`notifications.imagyn.co` is the subdomain the codebase already references in its own comments
and tests, so it is the expected value unless the account uses a different one. **Confirm the
actual verified domain in the Resend dashboard before setting this** — a domain that is not
verified causes Resend to reject every send with a 403, which looks like a code fault and is not.

### Why a verified domain is mandatory

Resend will not relay mail for a domain it cannot authenticate. Verification means these DNS
records exist and have propagated:

| Record | Purpose |
|---|---|
| DKIM (`resend._domainkey`, TXT or CNAME as the dashboard specifies) | Cryptographically signs outbound mail |
| SPF (TXT on the sending domain) | Authorises Resend's servers to send as that domain |
| DMARC (TXT on `_dmarc`) | Optional but strongly recommended; without it Gmail and Outlook increasingly filter |

A `@gmail.com` or `@outlook.com` address can never be the From value. Those domains publish
DMARC policies that reject third-party sending, so the message would be dropped or spam-foldered
regardless of Resend's own configuration.

---

## 3. How the From and Reply-To actually resolve

Worth knowing before reading the test results, because the headers are not what a naive reading
of `RESEND_FROM_EMAIL` suggests. Resolution lives in `emailSenderIdentity.shared.ts`.

**From address** — always on the platform's verified domain, never merchant-controlled. The
local part is scoped per merchant. A merchant cannot inject their own address, by design: that
would require per-merchant domain verification which the product does not do.

**From display name** — the store's own name, or the merchant's branded name on Pro
(`canUseBrandedEmailSender`, the entitlement fixed earlier in this engagement). Never "Imagyn"
on a customer-facing send.

**Reply-To**, in strict precedence order:

1. The store's **verified** Reply-To address, if one is verified. An unverified saved address is
   ignored entirely — saving is not verifying.
2. The Email Studio template's Reply-To.
3. Shopify's `shop.contactEmail`.
4. The platform fallback address.

Reply-To is deliberately **not** plan-gated. A merchant who proved they own an inbox receives
replies on any plan, and gating it would silently drop customer replies on downgrade.

---

## 4. Running the live leg once configured

```bash
# Capture mode — no message leaves the process. Safe to run now.
npx tsx scripts/accelerated-reminder-test.ts --i-understand-this-writes-to-my-local-db --fast

# Live mode — real email, authorised recipient only.
npx tsx scripts/accelerated-reminder-test.ts --i-understand-this-writes-to-my-local-db --live
```

Live mode is restricted to **`bilal.zaib@outlook.com`**, hard-coded as
`AUTHORISED_LIVE_RECIPIENT`. There is no flag or environment variable that widens it. It also
refuses to start without both `RESEND_API_KEY` and `RESEND_FROM_EMAIL`.

Timing: roughly five minutes of wall clock, producing the initial request at about minute one,
the first reminder at minute three, and the final reminder at minute five. Omit `--fast` for the
real-time run; `--fast` asserts the same things with no waiting.

### What to verify in the inbox

Three messages arrive. For each, check:

- **From display name** is the store name, not "Imagyn".
- **Reply-To** matches the precedence in section 3.
- **Subject** is correct for its stage and carries no raw `{{variable}}` tokens.
- **Rendered body** shows the product name, the star prompt, and a working review link.
- **Unsubscribe link** is present and resolves.
- The reminders are **distinct** from the initial email, not re-sends of it.

The first two are the ones most likely to be wrong, since they depend on the entitlement and the
Reply-To precedence rather than on template rendering.

---

## 5. What stays untouched

- No production reminder interval, delay, or schedule is modified. The harness accelerates only
  the clock it injects into the sweeps, which already accept one.
- No production database is read or written. The harness aborts unless `DATABASE_URL` resolves
  to localhost.
- No customer address can receive anything. The only live recipient is the authorised inbox.
- The harness creates its own store, product, and request rows under an `imagyn-accel-test`
  prefix and deletes them in a `finally` block.
