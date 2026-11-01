# Imagyn Reviews — UI/UX Guidelines

> **Status:** Single source of truth for product UX patterns, interaction rules, accessibility
> and layout conventions. Read with [`BRAND-BOOK.md`](./BRAND-BOOK.md) and
> [`DESIGN-SYSTEM.md`](./DESIGN-SYSTEM.md). Approved 2026-11-02.
> Detailed behaviour (selection, detail panels, search, forms) lives in
> [`13_INTERACTION_PRINCIPLES.md`](./13_INTERACTION_PRINCIPLES.md), which stays in force.
> Storefront specifics live in [`STOREFRONT_DESIGN_SYSTEM.md`](./STOREFRONT_DESIGN_SYSTEM.md),
> with the exceptions recorded in `DESIGN-SYSTEM.md` §10.

## 1. Principles

1. **Content first.** Reviews, ratings and the merchant's data are the product. Chrome recedes.
2. **One primary action per screen.** It is black (`Button variant="primary"`). Secondary actions
   are visibly lower.
3. **Calm by default.** No unnecessary borders, colours, buttons or motion. Whitespace is
   structure.
4. **Honest always.**
   - Never show fake rows, sample data presented as real, or trust signals that aren't enforced.
   - Features that aren't built are labelled "Coming soon" or not shown at all.
5. **Progressive disclosure.** Show the core path first and the advanced controls on request.
6. **Consistency over novelty.** A new pattern needs a reason that no existing one covers.

## 2. Layout conventions

### Admin (embedded in Shopify Admin)

- **Page anatomy:**
  1. `PageHeader`: an optional sentence-case area name, the title, a one-line description,
     and actions on the right.
  2. Content in `Card` and `Section` blocks.
  3. A `ContextualSaveBar` when there are unsaved changes.
- **Width:**
  - Content is capped at `--container-width` (1120px).
  - Settings forms are about 720px wide.
  - Review bodies are 620px at most.
- **Grid:**
  - one or two columns
  - three only for short metric rows
  - collapses to one column at 640px
- **Spacing:** cards use `--space-6` padding. Use `--space-6` to `--space-8` between cards and
  `--space-12` between major groups.
- **Alignment:** left-aligned text. Numbers in tables are right-aligned with tabular figures.
- **Navigation:**
  - The App Bridge `NavMenu` is the primary navigation: Dashboard, Reviews, Analytics, Settings.
  - Settings areas are reached from the Settings index and `SettingsBreadcrumb`.
  - Don't add a custom sidebar or reorder the primary navigation.

### Storefront

- Widgets inherit the theme and must look built in-house.
- Product page order:
  1. Rating Badge above the title.
  2. The full-width Ratings & Reviews section, in the order: heading, average, histogram,
     recommendation %, AI Summary, media, filters/sort, cards, "Load more".
- Never shift layout. Reserve space for badges, and render nothing at zero reviews for
  passive badges.

### Emails

- One column, 480px by default (`DEFAULT_CONTENT_WIDTH`), adjustable 320–720px in Email Studio.
- The merchant's logo, then the message, one primary button, and the footer with unsubscribe.
- System fonts. The palette is light or dark as the merchant chooses.

## 3. Interaction rules

| Topic | Rule |
|---|---|
| Selection | A click selects and opens detail in one action. Selection is persistent and survives returning from detail. Multi-select is opt-in and shows a visible count before bulk actions. |
| Detail | Prefer a side panel or detail route that closes back to the list, with filters and scroll position kept (list filters and paging live in URL params, so they survive the round trip). |
| Modals | Only for decisions that must be made before continuing, or irreversible confirmations. Destructive confirmations name the object and the consequence ("Delete 3 reviews? This can't be undone."). |
| Forms | Labels are always visible. Validate on blur and show the error at the field with the fix. Mark required fields and keep them few. Long or configuration-heavy forms use a draft with Save/Discard (`ContextualSaveBar`). |
| Saving | The action label and the result share a verb: "Publish" → "Review published". Use a Toast for success. Errors give the cause and the fix. Never leave a silent failure. |
| Search and filters | Results update as you type. Filters are reflected in the URL so views can be shared and survive reload. Offer "Clear filters" when the result is empty because of filters. |
| Bulk actions | Show only after selection, state the count, and offer undo where possible. |
| Hover | Reveals row actions. Information needed to decide is visible without hover. |
| Keyboard | Everything is reachable by Tab. Escape closes overlays and focus returns to the trigger. Arrow keys work in galleries and lightboxes. |
| Motion | Only in response to an action. Admin `--transition-base` 150ms; storefront 120 / 200 / 320ms with one easing. Reduced motion is always honoured. |

## 4. Product area patterns

Feature status is from `BRAND-BOOK.md` §11. **Do not build UI that implies a planned feature
exists.**

### Dashboard (`app._index.tsx`)

- Greet by store name with one line of status ("15 reviews waiting for you.").
- Quick actions follow as a short row of text links, then a few key metric cards.
- At most one emphasised metric per row; the rest are neutral.
- Metrics have a plain label and a real value. A trend shows its total first.
- Empty data states explain what will appear and give the one action that fills them.

### Analytics (`app.analytics.tsx`)

- Every chart leads with a headline number.
- Bars only: no axis clutter, start/end date labels only, widths proportional to real values.
- The range is 7d, 30d (default), 90d or all, held in the `range` URL param.
- Advanced analytics is "Coming soon" on the plan page. Don't add it as UI before it exists.

### Review management (`app.reviews*.tsx`)

- The moderation queue is built for volume: dense but readable rows, status as words through the
  status badges, and filters and search synced to the URL.
- Approve and Reject are the primary row actions. Destructive actions are separated and
  confirmed.
- The Verified badge appears only on order-matched reviews. Imported reviews show `ImportedBadge`
  and never claim verification.
- AI reply drafts (`aiReplyDraft.server.ts`) are suggestions the merchant edits and sends.
  Nothing is auto-posted.

### Review request automation (`app.requests*.tsx`, `app.settings.requests.tsx`)

- Show the request lifecycle as a timeline (`RequestLifecycleTimeline`) and status as
  `RequestStatusBadge`.
- Automation settings state the trigger, the delay and who will receive it, in plain words.
- Suppression and unsubscribe are always respected and visible.
- Plan-gated automation uses `UpgradePrompt`, never a disabled control without explanation.

### Email Studio (`app.email-studio.tsx`)

- Edit on the left and a live preview on the right. The preview uses the same renderer as the
  real send.
- Shared Email Branding (logo, accent) applies to all templates unless a template overrides it,
  and the UI states which one is in effect.
- Show the light/dark palette choice in the preview.
- Customer-facing emails always carry the merchant's identity and reply-to.

### Brand Studio and Live Preview (`app.appearance.tsx`, `appearance-preview.tsx`)

- Every control updates the iframe preview instantly through `postMessage`. Nothing is written
  until Save, and Discard restores the saved state.
- **Widget Presets** (Minimal, Modern, Editorial, Luxury) change structure only and never the
  merchant's accent colour.
- **AI brand suggestion** (accent + typography) is a separate, clearly labelled section. Its
  result is applied to the draft for review, never saved automatically.
- **AI Brand Match™** (analysis from a URL) is planned and not built. Don't add a URL field or
  "match my brand" copy until it exists.
- Star colour legibility is judged filled-against-empty (`checkStarLegibility`). Warn, don't
  block.

### AI features in general

- Label AI output in words: "AI Summary", "Suggested by AI". Never use sparkle icons, gradients,
  glows or "magic" language.
- AI output is always reviewable and editable before it affects a customer or a store.
- Failures degrade quietly with a clear message ("AI suggestions are unavailable right now.").
- **AI Product Insights** and **Review DNA™** are planned. Don't add entry points, empty shells
  or teaser cards for them.

### Review Carousel, video carousel, floating reviews (theme blocks)

- They follow the storefront rules. Keyboard and swipe navigation with visible controls.
- They render nothing when there is no content.
- Autoplay is off by default (`data-autoplay`), must be pausable, and is disabled under reduced motion (Established in `review-carousel.js`).

### Billing and plans (`app.billing*.tsx`)

- Two plans: Free and Pro ($9.99/mo, 14-day trial).
- Show the current plan plainly. Features without an enforcement point are "Coming soon".
- Upgrade uses the green brand button only here and in `UpgradePrompt` (Proposed). Otherwise the
  standard primary button.
- Never use urgency or dark patterns.

### Trust certification (`app.settings.trust.tsx`, `trust_badge.liquid`)

- There are four pillars, shown as pass or in progress with words.
- "Certified" appears only when every pillar passes. It's never purchasable and never
  hand-toggled.

## 5. Empty, loading and error states

| State | Pattern |
|---|---|
| Empty (admin) | `EmptyState`: a title saying what is missing, one sentence on what will appear, and one real action. No illustrations unless they explain something. |
| Empty (storefront) | Passive badges render nothing. Visited sections show one quiet line, and "Write a review" is always available. |
| Empty because of filters | Say so and offer "Clear filters". |
| Loading | A skeleton shaped like the content. Buttons switch to a progress label ("Sending…") and disable. Long jobs (imports, AI) show progress or a status line. |
| Error | What happened, why if known, and the fix. Never apologise or say "Oops". Field errors at the field; action errors in a Toast; page errors in a `Banner` with a retry. |
| Plan gate | `UpgradePrompt` with the feature, the benefit and the required plan. |

## 6. Accessibility (non-negotiable)

- WCAG 2.1 AA on every surface:
  - text 4.5:1, large text 3:1
  - borders, focus rings and meaningful icons 3:1
  - checked in every palette (email dark too)
- **Focus:** `:focus-visible` ring, 2px solid with a 2px offset. Admin is defined once globally in
  `design-system.css`; never remove it per component.
- **Keyboard:**
  - full operation without a mouse
  - modal focus trap, and focus returns to the trigger on close
  - Escape closes
- **Screen readers:**
  - semantic headings in order
  - every control has a name
  - stars carry text ("Rated 4.6 out of 5")
  - histogram rows carry text
  - icon-only buttons have `aria-label`
- **Colour is never the only signal.** Statuses have words; Verified has a check and a label.
- **Touch targets:** 44×44px on the storefront and in mobile admin.
- **Motion:** every animation has a `prefers-reduced-motion` variant.
- **Language:** plain words, no jargon ("webhook", "token") in merchant copy.

## 7. Avoiding generic AI-generated UI

Code written by AI drifts towards the same templates. Reject these in review unless this
document explicitly asks for one:

**Visual**
- Gradient washes, blue-to-purple anything, glows, glassmorphism or 3D renders in product UI.
- Identical rounded cards in a grid, all with the same shadow. Vary them by hierarchy.
- A coloured left border on cards as decoration.
- Emoji as icons or decoration. Sparkle icons for AI.
- A big number, small label and gradient accent as a default hero.
- New colours, fonts, radii or shadows outside the token files.
- A monospace font for small labels.

**Typography and copy**
- All caps, or tracked-out eyebrow labels above every heading.
- One word in a headline recoloured or italicised.
- Meta strings joined with " · " and labels written "WORD — fragment".
- "→" appended to every link and button.
- Numbered markers (01 / 02 / 03) on content that isn't a sequence.
- Filler copy: "Unlock the power of…", "Seamlessly", "Supercharge", "Oops!", "🎉".
- Generic labels: "Submit", "Click here", "Learn more" with no object.

**Behaviour**
- Fade-and-slide-up on every section, or hover lift on every card.
- Spinners for page loads.
- Modals for things that should be a panel or a page.
- Disabled buttons with no explanation.

**Before shipping UI, check:**
1. Does every value come from a token?
2. Did I reuse an existing component?
3. Is there exactly one primary action?
4. Is everything in sentence case?
5. Does every state have words?
6. Does it work by keyboard and at 640px?
7. Does it honour reduced motion?
8. Is anything planned presented as shipped?

## 8. Writing in the interface

- Use active voice and plain verbs, in sentence case.
- Name things by what the merchant manages ("Review requests", not "Request queue jobs").
- One element does one job. Keep descriptions to one sentence.
- Keep the same name for an action through the whole flow.
- Use numbers with units and context ("41% opened, last 30 days").
