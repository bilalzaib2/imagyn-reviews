# Imagyn Reviews — Brand Book

> **Status:** Single source of truth for brand identity, together with
> [`DESIGN-SYSTEM.md`](./DESIGN-SYSTEM.md) (tokens and components) and
> [`UI-UX-GUIDELINES.md`](./UI-UX-GUIDELINES.md) (behaviour, accessibility, layout).
> Approved 2026-11-02. The visual reference with live component previews is the
> **Imagyn Reviews design system** artifact (claude.ai), built from the same decisions.

## How to read this document

Every rule is tagged:

- **Established** means it is true in the shipped code today. Follow it.
- **Proposed** means it is approved brand direction that the code does not match yet. Do **not**
  migrate existing screens towards a Proposed rule as a side effect of unrelated work. Apply it
  to new surfaces only where this book says so, or in a dedicated migration task. Every gap is
  listed in [§13 Known conflicts](#13-known-conflicts-between-brand-and-implementation).

Where an older document disagrees with this one (`DESIGN_PRINCIPLES.md`,
`docs/07_UI_GUIDELINES.md`, `docs/08_BRANDING.md`, `docs/11_DESIGN_SYSTEM.md`,
`docs/DESIGN_SYSTEM.md`, `docs/CLAUDE.md`), this document wins. `docs/STOREFRONT_DESIGN_SYSTEM.md`
and `docs/13_INTERACTION_PRINCIPLES.md` remain the detailed references for their areas; the
precedence and every disagreement are recorded in `DESIGN-SYSTEM.md`.

---

## 1. Brand overview and positioning

Imagyn Reviews is a premium Shopify reviews platform that helps merchants collect, manage,
understand and showcase customer reviews. The long-term ambition is a complete reviews ecosystem
that grows beyond Shopify into a public review platform. Its first step is already live: every
approved review is published twice, on the merchant's storefront and on the public discovery
network (`reviews-site.$slug`, `api.public.v1.*`).

The core idea is that **trust has to be earned**. The product never inflates, fakes or sells a
signal of trust. That runs through the code, not only the copy:

- A Verified buyer badge appears only when Imagyn matched a real order. An imported review's
  source claim (`Review.sourceVerified`) never drives the badge. See
  `docs/IMPORT_VERIFICATION_POLICY.md`.
- The trust certification passes only when every pillar passes on real store data.
- Features without an enforcement point are labelled "Coming soon" instead of being claimed.

**Positioning line (Established, live on reviews.imagyn.co):** "Build trust with every customer review."
**Product promise:** "Every review, published twice."
**Competitive line:** "Not the only review app. The one built to be trusted."

`docs/08_BRANDING.md`'s older tagline ("Beautiful reviews for modern Shopify brands.") is
retired. Use the lines above.

We are a serious SaaS product, not a generic Shopify app. The quality bar is Linear, Stripe and
Apple: calm, exact and typography first.

## 2. Brand personality and voice

Personality: premium, trustworthy, intelligent, modern, minimal, confident, professional,
approachable.

### Voice rules

- **Plain and confident.** Use short declarative sentences. Headlines are full sentences ending
  in a full stop: "Every review, published twice." "A trust badge that has to earn it." "Set the
  schedule once. It runs itself."
- **Argue through contrast:** "Free to start. Simple when you grow."
- **Promise only what is enforced.** Say what the product will not do when that builds trust:
  "never on request", "never a purchased seal".
- **Address the merchant as "you".** Their buyers are "customers" or "shoppers", never "users".
- **Name the product correctly.** Write "Imagyn Reviews" in full on first mention and "Imagyn"
  afterwards. Write "IMAGYN" only inside existing code comments; never in UI copy.
- **Name features consistently.** "Brand Studio", "Email Studio", "Review Requests", "AI Summary",
  "Trust certification". Write "AI Brand Match™" and "Review DNA™" only once they ship (§11).
- **No emoji, exclamation marks or invented superlatives** ("revolutionary", "best-in-class").
- **Label sample data honestly:** "Example storefront, not real merchant data."

### Casing

**Sentence case everywhere, with no all caps anywhere.** That covers headings, buttons, tabs, table
headers, badges, kickers, email subjects and email labels.

- **Proposed:** the rule is approved, but about 60 places in the code still use
  `text-transform: uppercase` (§13 C-07).
- Don't add new uppercase, and don't fake labels with wide letter-spacing.

### Microcopy

| Situation | Write | Not |
|---|---|---|
| Primary action | "Send request", "Publish review" | "Submit", "OK" |
| Completed action | "Review published" (same verb as the button) | "Success!" |
| Error | "This review has no order to match. Ask the customer for their order number." | "Oops, something went wrong" |
| Empty list | "No reviews yet. Send your first review request." | "Nothing here 🙁" |
| Plan gate | "AI brand suggestions require the Pro plan." | "Upgrade now to unlock!" |

## 3. Logo guidelines

### The mark

The mark is eight dots in a three-by-three grid with the centre left empty: large dots on the
cross, small dots on the corners (radius ratio 1.5 : 1). The empty centre is where the customer's
voice sits. The wordmark is Helvetica, regular weight.

### Files

| File | Status | Use |
|---|---|---|
| `public/assets/imagyn-app-logo.svg`, `public/assets/Imagyn-Reviews-logo.svg` | Established | Black outlined wordmark and mark (`#070808` / `#231f20`). In-app and on light backgrounds. |
| `public/assets/imagyn-emblem.svg` | Established | Black mark only. |
| `public/favicon.svg` | Established | Black dots on a white disc. |
| `public/assets/favicon-dark.svg` | Established | White dots on a `#0d0e0f` disc. |
| `marketing/App Store Listing/Logoa/App-icon.svg` | Established | Shopify app icon: white dots on a `#0a0a0a` rounded square (rx 22%). |
| Green-dot colour logos (`#487541` dots), from the brand files | **Proposed** | Marketing site, emails and social. Stored in the design system artifact. Not in the repo yet (§13 C-10). |

The repo wordmarks are outlined paths, so they render identically everywhere. Prefer them over
the brand-file versions, whose wordmark is live `<text>`.

### Rules

- **Clear space:** at least one large dot's diameter on every side.
- **Minimum size:** wordmark 20px tall on screen (26px in the site header). The mark alone is
  16px (favicon) and 24px in UI.
- **Colour by background:**
  - black logo on light surfaces
  - white logo on black, forest or a green fill
  - green-dot logo (Proposed) on paper or white only
- **Don't** recolour the dots in any other colour, add glows, shadows or gradients, stretch the
  logo, rebuild the mark, or reset the wordmark in another face.
- **Don't** use the mark as a decorative pattern inside product UI. Its dot rhythm is borrowed
  only by the loader and certification pips (§9).

## 4. Colour system

The brand is monochrome first. Black ink on light neutral surfaces carries the interface. Green
is restrained and intentional.

### 4.1 Established colours (in code today)

**Admin (`app/styles/design-system.css`)**

| Token | Value | Role |
|---|---|---|
| `--color-background` | `#f6f6f8` | Page background |
| `--color-surface` | `#ffffff` | Cards, panels |
| `--color-surface-muted` | `#f1f1f4` | Hover fills, inset panels |
| `--color-surface-strong` | `#e6e6ea` | Pressed and selected fills |
| `--color-text` | `#18181b` | Primary text (17.7:1 on white) |
| `--color-text-muted` | `#6a6a73` | Secondary text (AA on every neutral surface) |
| `--color-border` / `--color-border-strong` | `#e5e5e9` / `#cecdd4` | Hairlines and borders |
| `--color-accent` | `#18181b` | Primary buttons, focus, selected states |
| `--color-highlight` (+ `-strong`, `-soft`) | `#97a819` / `#6f7a13` / `#eafbb2` | Restrained chartreuse emphasis |
| `--color-success` / `--color-warning` / `--color-danger` | `#1f7a45` / `#b06a06` / `#c23b2b` | Status |
| `--color-info` | `#3a5bc7` | Integration and connection states |
| `--color-ai` | `#7a5cc4` | AI-generated content |

**Storefront (`extensions/imagyn-review-widgets/assets/imagyn-tokens.css`)** inherits the
merchant's text colour (`currentColor`) and uses:
- muted text: 0.6 opacity
- stars: amber `#f5a623` (merchant-editable)
- success: `#1a7f4b`
- danger: `#c0392b`
- focus: `#0a0a0a`

**Emails** (`ReviewRequestEmail.tsx` palettes): light `#ffffff` / `#111111`, dark `#0e0e10` / `#f4f4f5`.

### 4.2 Brand palette (Proposed target, approved 2026-11-02)

| Name | Value | Role |
|---|---|---|
| Ink | `#0a0a0a` | Text, primary buttons, focus |
| Ink muted | `#6b6b6b` | Secondary text (4.7:1 on paper) |
| Paper | `#f1f1f1` | Page background |
| Card | `#fafafa` | Cards on paper |
| White | `#ffffff` | Raised surfaces, inputs |
| Line | `#e0e0e0` | Hairlines |
| **Brand green** | `#5C9754` | The accent. Fills only: link underline, progress, certification pips, lit dot. **Never text** on light surfaces (3.5:1). |
| Brand green, deep | `#487541` | Logo dots. Solid green fills carrying white text (5.4:1): the brand button and the feature card. Green text (`leaf`). |
| Forest | `#0e1710` | Dark marketing bands, dark theme |
| Forest surface | `#16221a` | Cards on forest |
| Sage | `#9db797` | Muted text on forest (8.4:1) |

Status colours keep their meaning and always come with a word or icon. Success is green text on a
pale green fill.

### 4.3 Colour rules (apply now)

1. **One accent per surface.** Admin uses `--color-highlight` today. Don't add a second accent and
   don't hard-code `#5C9754` into admin screens until the accent migration (§13 C-02) is done.
2. **Black is the primary action colour.** It is Established in the admin and on the site. Use
   green for the primary action only for conversion moments ("Start Pro", "Upgrade").
3. **Never use colour alone for meaning.** Pair it with a label, an icon or both.
4. **No new hues.** No blue-purple gradients, neon or decorative colour.
5. **Contrast:** body text 4.5:1 and large text 3:1. Borders, focus rings and meaningful icons
   are 3:1 or better, in every theme.
6. **Stars are a merchant choice.** The storefront star colour is the merchant's Accent Color in
   Brand Studio (`colors.starColor`).
   - Established default: amber `#f5a623`.
   - **Proposed** default: ink filled over grey empty (§13 C-04).

## 5. Typography system

**Typeface (Established, locked):** Helvetica, then Arial, then system sans. No webfonts in the
app, storefront or emails, ever. Storefront licensing makes this mandatory; see
`STOREFRONT_DESIGN_SYSTEM.md` §3.

**Proposed:** put `"Helvetica Neue"` first in the stack on surfaces we control (admin, marketing,
emails). Geist Sans is acceptable **only on the marketing site**, never in the app, storefront or
emails, because those must load no external fonts. There are no serifs anywhere.

**Weights:** 400 and 600 everywhere; the storefront also uses 500. Never use 700 or `bold`.

**Scales (Established):**
- Admin: `--text-xs` 12 → `--text-3xl` 32px (rem tokens).
- Storefront: 12 / 13 / 15 / 17 / 20 / 26 / 34px (px tokens, never rem).
- Marketing site: display 44/600/-1.98px, title 28/600/-0.98px, lead 18/29.25.

The full scales are in `DESIGN-SYSTEM.md` §3.

**Rules:**
- Hierarchy comes from size and weight before colour, borders or boxes.
- Headlines are one colour. Don't highlight a single word in green, italic or a second colour.
- Use tabular figures for metrics and counts.
- Tight tracking is for headline sizes only.
- Keep line length under about 75 characters; review bodies are capped at 620px.

## 6. Layout and spacing

- **Spacing:** the scale is on 4px steps. Admin uses `--space-1` to `--space-16` (4 → 64px).
  The storefront has em steps inside components and px steps between them.
- **Containers:** admin `--container-width` is 1120px (Established); the marketing site is 1200px.
- **Alignment:** left-aligned. Copy sits on the left and the visual on the right. Centre only the
  storefront section heading and a final call to action.
- **Whitespace is structure.** Separate with space first, a hairline second, and a shadow last.
- **Vary by hierarchy.** Avoid grids of identical cards with identical shadows: one item leads
  and the rest stay quiet.

## 7. UI component library (overview)

Components live in three places. Reuse them before creating anything new:

| Surface | Location | Examples |
|---|---|---|
| Admin, custom | `app/components/ui/` | Button, LinkButton, Card (`default`/`subtle`/`quiet`), Section, PageHeader, Banner, EmptyState, StatusBadge, ProgressBar, ActionCard, UpgradePrompt, ContextualSaveBar, ColorField, SettingsBreadcrumb, PillarStatusIcon, FloatingHelp |
| Admin, review domain | `app/components/reviews/`, `requests/`, `medals/` | StarRating, Verified/Imported/Featured/Reward/ReviewStatus badges, ReviewForm, RequestStatusBadge, RequestLifecycleTimeline, Medallion |
| Admin, Polaris | `@shopify/polaris` 13 (29 files) | DataTable, Modal, Toast, Frame and similar where no custom component exists |
| Storefront | `extensions/imagyn-review-widgets/assets/imagyn-component-*.css` + JS | badge, button, carousel, chip, drawer, empty state, filters, histogram, input, lightbox, modal, review card, skeleton, summary, tag, trust badge, video carousel, medals |
| Emails | `app/services/notifications/emails/*.tsx` (React Email) | ReviewRequestEmail, NewReviewEmail, ReviewHeldEmail, SupportRequestEmail |

Specifications, props and states are in `DESIGN-SYSTEM.md` §6.

## 8. Product-specific patterns

See `UI-UX-GUIDELINES.md` §4 for the full patterns per area. In short:

- **Dashboard:** greeting, one line of status, quick actions, then a few key metrics. No metric
  walls.
- **Reviews:** a moderation queue built for volume, with selection that opens detail and the
  status always shown as words.
- **Brand Studio and Live Preview:** every change previews instantly in the real storefront
  renderer (`/appearance-preview`). Nothing goes live until the merchant presses Save.
- **AI anywhere:** labelled in words ("AI Summary"), never with sparkles or gradients, and
  always reviewable before it is published.

## 9. Motion and interaction

- **Established:**
  - admin: one timing, `--transition-base` 150ms ease-out
  - storefront: 120 / 200 / 320ms with one curve, `cubic-bezier(0.22, 1, 0.36, 1)`
  - every transition has a `prefers-reduced-motion` variant (46 rules in CSS)
- Motion answers an action (open, expand, confirm, hover). No entrance animations, parallax,
  bounce or looping decoration.
- Use skeletons for loading content. Spinners are only for short, user-started actions.
- **Proposed:** the eight-dot loader (the mark's dots lit in turn) for long-running jobs such as
  imports and AI generation, and a lime underline that grows on text-link hover.

## 10. Responsive guidelines

- Mobile first on the storefront, where most traffic is mobile.
- Touch targets are at least 44×44px.
- Modals become full-screen sheets on mobile, and filters move into a bottom sheet.
- The admin runs inside Shopify Admin at any width. Layouts reflow to one column below 640px.
- The breakpoint set is in `DESIGN-SYSTEM.md` §8. The code currently has 15 ad-hoc values;
  consolidating them is Proposed.

## 11. Brand applications

### Product areas and their status (do not present planned features as shipped)

| Area | Status | Where |
|---|---|---|
| Dashboard | Shipped | `app._index.tsx` |
| Analytics | Shipped (advanced analytics "Coming soon") | `app.analytics.tsx` |
| Review management | Shipped | `app.reviews*.tsx` |
| Review request automation | Shipped (order automation live since 2026-09-09) | `app.requests*.tsx`, `app.settings.requests.tsx` |
| Email Studio | Shipped | `app.email-studio.tsx` |
| Brand Studio | Shipped (foundation) | `app.appearance.tsx` |
| Live Preview | Shipped | `appearance-preview.tsx` (iframe, postMessage) |
| Widget Presets | Shipped: Minimal, Modern, Editorial, Luxury (+ Custom). Preset marketplace planned. | `app/services/appearance.presets.ts` |
| AI brand suggestion (accent colour + typography) | Shipped | `brandSuggestion.server.ts` |
| AI Brand Match™ (brand analysis from a URL) | **Planned.** The deterministic Brand Match was removed on 2026-08-25 (`DECISIONS.md`). | `docs/future/future/AI_BRAND_MATCH.md` |
| AI Summary (product and store) | Shipped | `aiSummary.server.ts`, storefront `ai-review-summary.js` |
| AI Product Insights | **Planned** | `docs/future/future/AI_PRODUCT_INSIGHTS.md` |
| Review DNA™ | **Planned** | `docs/future/future/REVIEW_DNA.md` |
| Review Carousel, Video carousel, Floating reviews | Shipped | theme blocks |
| Trust certification and badge | Shipped | `app.settings.trust.tsx`, `trust_badge.liquid` |
| Billing and plans | Shipped: Free and Pro ($9.99/mo, 14-day trial) | `app.billing*.tsx`, `services/billing/plans.ts` |

### Website and landing pages (reviews.imagyn.co, a separate codebase)

- Light paper sections, plus forest bands for the hero and dark sections.
- Black primary buttons with 10px corners.
- Sentence-case headlines at 44 / 28px.
- One floating product mock per section.

### Shopify embedded app

- Grey page, white cards and black primary actions.
- Polaris for platform-native pieces; custom components for brand surfaces.
- The black logo only.

### Review request and reminder emails

- System fonts.
- Light or dark palette, chosen by the merchant.
- The merchant's logo via Shared Email Branding (`emailBranding.shared.ts`). Customer-facing
  emails carry the **merchant's** brand, not Imagyn's.
- Reply-to goes to the merchant.

### Storefront widgets

The widgets belong to the merchant's store. They inherit the theme's text colour and look as if
they were built in-house. No Imagyn logo or caption appears in storefront widgets today
(Established). A "Powered by Imagyn Reviews" line exists only in emails (`email.shared.ts`).

### Social media graphics

- Paper or forest backgrounds with ink or paper type.
- One green accent at most.
- Real product UI, or UI clearly labelled as an example.
- No 3D renders, stock people or emoji.

### Product screenshots and promotional visuals

- Take them from the real product (`marketing/screenshots/`).
- Sample stores and data must be plausible and labelled as examples.
- **Proposed:** the App Store set (`marketing/App Store Listing/*.png`) uses a blue accent
  (#3a6bc7-like) for highlighted words. That breaks the one-colour headline rule and the green
  accent, so regenerate it in the brand palette (§13 C-11).

## 12. Do's and Don'ts

**Do**
- Reuse a component from §7 before writing a new one.
- Use tokens, never raw hex, px or rem values.
- Write in sentence case with a verb-first action label.
- Give every state a word: Pending, Published, Verified buyer.
- Keep one primary action per screen.
- Label AI output as AI.

**Don't**
- Use all caps, tracked-out eyebrow labels above every heading, or meta strings joined with "·".
- Recolour one word in a headline.
- Use gradient washes, glassmorphism or glows in product UI. Glass and forest glow are
  marketing-only.
- Use emoji as icons, sparkles for AI, or "→" appended to every link.
- Build rows of identical rounded cards with the same shadow.
- Use a monospace font for small data labels.
- Add new colours, fonts, radii or shadows outside the token files.
- Fake, inflate or pre-fill trust signals, or show sample data as real.

## 13. Known conflicts between brand and implementation

Each conflict is a decision to make or a migration to plan. **None are to be fixed silently.**
The full table, with exact files, is in `DESIGN-SYSTEM.md` §10. In summary:

| ID | Conflict |
|---|---|
| C-01 | Neutrals: admin uses a cool grey family (`#f6f6f8`, `#18181b`); brand uses neutral paper/ink (`#f1f1f1`, `#0a0a0a`). |
| C-02 | Accent: admin chartreuse `#97a819`; brand green `#5C9754` / `#487541`. |
| C-03 | Admin has blue info `#3a5bc7` and purple AI `#7a5cc4`. The brand book has neither, and its anti-slop rules forbid blue-purple. Needs a decision. |
| C-04 | Storefront star default is amber `#f5a623`; brand default is ink and grey (still merchant-editable). |
| C-05 | `STOREFRONT_DESIGN_SYSTEM.md` says focus `#2563eb`; the code uses `#0a0a0a`. The code matches the brand, so the doc is stale. |
| C-06 | `STOREFRONT_DESIGN_SYSTEM.md` §3 forbids merchant-theme font fallbacks; `imagyn-tokens.css` uses `var(--font-body-family, Helvetica…)`. |
| C-07 | Uppercase is forbidden, but there are 54 CSS rules in 23 files, plus 5 email labels in 4 email components. |
| C-08 | Radius: admin 8/12/16/20px, storefront 4/8/12px, brand book 6/10/12/16/28px. |
| C-09 | Email `faint` `#a0a0a0` on white is 2.6:1, used for 12px footer text, so it fails AA. |
| C-10 | Green-dot logo is not in the repo; repo logos are monochrome. |
| C-11 | App Store images use a blue word accent. |
| C-12 | `docs/PROJECT_STATE.md` lists Brand Match as shipped; `DECISIONS.md` (2026-08-25) records its removal. |
