# Judge.me — Competitive Research

**Date:** 2026-11-05
**Benchmark product:** Judge.me Product Reviews (the Reviews product only — not Judge.me Email,
Importer, Reviews site, or Community, which are separate products)
**Companion document:** `docs/JUDGEME_PARITY_AUDIT.md` holds the feature-by-feature gap matrix.
This document holds the research itself: sources, plan structure, and the released-versus-
early-access distinction.

No Judge.me code, asset, or branding is reproduced here. Only publicly documented behaviour is
recorded, for competitive analysis.

---

## 1. Sources used

All findings come from Judge.me's own published surfaces, read directly. Third-party review
sites and aggregators were explicitly discarded where they conflicted.

| Source | What it established |
|---|---|
| Shopify App Store listing (`apps.shopify.com/judgeme`) | Plan names, prices, trial length, per-plan feature bullets |
| Help centre, widget overview (`judge.me/help/en/articles/8415708-…`) | The complete widget table with plan tier and supported pages |
| Help centre, review collection flow (`…/11419250-review-collection-flow`) | Form layouts, fields, character limits, media limits, plan restrictions |
| Help centre, early user program (`…/8389897-judge-me-early-user-program`) | **The authoritative early-access list — see §3** |
| Help centre, getting started, new app design 2025 (`…/11632753-…`) | Admin navigation and information architecture |
| Help centre, reminders and scheduling | Reminder count and per-order-type timing |
| Help centre, AI replies and translations | Tone options, daily caps, translation mechanism |

**Not accessible, therefore not researched:** anything behind a Judge.me merchant login. No
attempt was made to bypass access restrictions, per the mission's own instruction.

---

## 2. Plan structure

| | Judge.me | Imagyn Reviews |
|---|---|---|
| Free tier | Forever Free | Free |
| Paid tier | Awesome, **$15/month** | Pro, **$9.99/month** |
| Trial | 15 days | 7 days |

Judge.me's Free tier is genuinely generous: unlimited product and store reviews, unlimited
photo and video reviews, review widget and star rating badge, three carousels, Google review
sync and rich snippets, trust badge and medals, Shop App / Etsy / Amazon sync, and the reviews
importer with AliExpress sync.

Awesome adds: AI (replies, summary, translations), 130+ integrations, 16 widgets including
Snippets, Q&A and the Reviews Page, advanced collection with auto-reminders, coupons and
referrals, Google Shopping, Meta and TikTok Shop sync with social-media push, and widget plus
email design customisation with CSS.

**Strategic read.** Imagyn is priced at roughly two-thirds of the benchmark while already giving
away several Awesome-tier capabilities for free — notably Email Studio customisation, which
Judge.me charges for. That is a deliberate and defensible position. The gap to close is feature
*depth*, not price.

---

## 3. The correction that matters: released vs early access

**This materially changes the parity picture, and in Imagyn's favour.**

The mission required distinguishing released functionality from early access, beta, deprecated,
and plan-restricted features. Judge.me's early-user-program page lists what is *currently in
early access* — meaning it is **not generally available**, even to paying Awesome merchants, and
requires opting in under Settings → Advanced.

Features in Judge.me early access as of this research:

| Early-access feature | Previously recorded in our audit as |
|---|---|
| Custom reminder timing per order type (domestic / international / POS) | A missing Awesome feature, 4 days of work |
| Custom review request schedules per product | Not separately recorded |
| Reminders for unopened review requests | Not recorded |
| "Review request ready" Shopify Flow trigger, for routing requests through your own email/SMS/WhatsApp | The replacement for the deprecated SMS path |
| Referral emails with expiry reminder | Part of the referral gap |
| Group and bundle reviews in the Review Snippets widget | Not recorded |
| Translated product and variant names in widgets | Part of the multi-language gap |
| Per-review Google Shopping verdicts with one-click resubmit | Part of the Google Shopping gap |

**Consequences for our roadmap:**

1. **Per-order-type reminder timing drops in priority.** Judge.me has not generally released it.
   Building it is a chance to *lead*, not catch up, and it should not be sequenced as a parity
   blocker.
2. **SMS is not a Judge.me feature.** The old SMSBump integration is deprecated, and the
   replacement is an early-access Shopify Flow trigger that routes through the *merchant's own*
   SMS tooling. Judge.me does not send SMS itself. Imagyn already has a Shopify Flow trigger for
   new reviews; adding a request-ready trigger would reach parity cheaply, without building an
   SMS sender.
3. **Multi-language is partly early access.** Translated product and variant names in widgets
   are not generally available, so the full 8-day multi-language estimate overstates the parity
   requirement. Review translation itself does appear to be a released Awesome feature.
4. **The real parity gap is narrower than the original audit stated.** The audit's roughly 109
   engineering days includes work on features Judge.me itself has not shipped generally.

The early-user program is itself available on the Free plan, which is worth noting: Judge.me
uses its free tier as a testing population.

---

## 4. Review submission experience, documented in detail

The richest area of genuine, released difference. Judge.me's forms:

- **Two form types.** An in-store popup, and a Judge.me-hosted external page opening in a new
  tab (whose mint-green background cannot be customised).
- **Two layouts.** Multi-step, the default, across up to four screens: star rating, review
  content, customer information, reviewer media. Selecting a star rating auto-advances. A
  Compact two-screen layout exists but is **early access**.

| Field | Limit / behaviour | Plan |
|---|---|---|
| Star rating | Required; "Poor"/"Great" labels editable | Free |
| Review content | Up to 5,000 characters; can be made optional via quick star ratings | Free |
| Review title | Optional, 100 characters; auto-fills from the first 50 characters of the body, editable, and the auto-fill can be disabled | Free |
| Media | Up to 5 images at 10 MB each, 1 video at 100 MB; YouTube watch and youtu.be links supported, Shorts not | Free |
| Email and display name | Both required in most layouts; email cannot be made optional | Free |
| Anonymous option | Compact layouts only | Early access |

**Post-submission prompts**, both released and both absent from Imagyn: prompt to review the
store after a product review, and prompt to review other products in the same order. The second
is shown for web and email-link reviews but not for QR-code or shareable-link reviews.

Customisation split: Free gets a custom star colour. Awesome gets text, form, field, button and
overlay colours, corner style, and text customisation.

Hard constraints worth copying as product behaviour: character limits enforced on both frontend
and backend, and a GDPR statement on the review-content screen that cannot be removed or edited.

---

## 5. Widgets

Judge.me's own table documents 18 widget entries while the marketing site says "16 widgets". The
full list with plan tiers is reproduced in the gap matrix in `JUDGEME_PARITY_AUDIT.md` §3 rather
than duplicated here.

Summary: Imagyn has 11 theme blocks against roughly 18. Six are genuinely missing — Testimonials
Carousel, Review Snippets, Questions and Answers, Happy Customers, Pop-up Reviews, and UGC
Instagram Shopping. Four more are partial overlaps where Imagyn covers the capability through a
different surface.

Notable: the Floating Reviews Tab is an Awesome-tier widget, and Imagyn already has its
equivalent. The All Reviews Page is also Awesome-tier, and Imagyn's public review site covers it.

---

## 6. Admin information architecture

Useful as a functional reference for the dashboard redesign. Judge.me's 2025 app design
organises around:

- **Home** — a setup-guide checklist for new users.
- **Reviews** — publish, hide, reply, pin, feature.
- **Settings** — Import Reviews, Request Reviews (with a dashboard tracking automatic requests),
  Request Scheduling, Email Templates, Widgets, Social Sharing, Google/SEO/AI, Coupons,
  Referrals, Integrations, Advanced.

**There is no analytics section** in the documented navigation, which is worth noting given that
Awesome advertises advanced analytics. Imagyn already ships a dedicated analytics page.

Review-collection methods documented: automatic requests via scheduling rules including
delivery-based triggers, requests for past Shopify orders, manual requests sent individually or
in batch, links and QR codes, and imports from CSV, AliExpress, Amazon, Google Business Profile,
Etsy and Shop App.

---

## 7. AI features, released behaviour

- **AI replies.** Per-review draft generation with a tone choice of Direct, Elegant, or
  Friendly. Bulk auto-replies are explicitly not supported. Capped at 500 per day.
- **Translations.** Automatic or manual review translation, using a combination of the Chrome
  Translation API and AI translation. Store-owner replies are *not* translated.
- **AI summary.** A widget showing an AI-generated summary with top keywords, sentiment, and
  review highlights.

Imagyn has AI replies and AI summaries already. The two concrete gaps are the tone selector,
roughly a day of work, and translation.

---

## 8. What this research changes

1. Re-sequence the roadmap so early-access Judge.me features are not treated as parity blockers.
2. Replace the "build SMS" line item with "add a request-ready Shopify Flow trigger", which is
   both cheaper and what Judge.me actually does.
3. Prioritise the released submission-experience gaps — multi-step form, quick star ratings,
   title auto-fill, store-review prompt, other-products prompt — above the widget backlog. They
   are small, released, and directly affect review-collection conversion.
4. Treat custom questions and Q&A as the single largest genuine gap. Both are released Awesome
   features with no Imagyn equivalent at all.
